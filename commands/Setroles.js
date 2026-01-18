const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getGuildConfig, updateGuildConfig } = require('../utils/customRolesSystem.js');

const name = 'setroles';

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
  if (!isOwner) {
    await message.react('❌').catch(() => {});
    return;
  }

  const guildConfig = getGuildConfig(message.guild.id);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ إعدادات نظام الرولات الخاصة')
    .setDescription('اختر الإعداد الذي ترغب بتحديثه.')
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`setroles_menu_${message.author.id}`)
    .setPlaceholder('اختر إعداداً...')
    .addOptions([
      { label: 'تحديد رولات المسؤولين', description: 'الرولات التي تتحكم بالنظام', value: 'manager_roles', emoji: '🛡️' },
      { label: 'تحديد مسؤولين بالأعضاء', description: 'أعضاء محددين للتحكم', value: 'manager_users', emoji: '👤' },
      { label: 'روم السجلات', description: 'تحديد روم سجلات النظام', value: 'log_channel', emoji: '📝' },
      { label: 'روم لوحة الطلبات', description: 'الروم الذي تعرض فيه لوحة الطلبات', value: 'requests_channel', emoji: '📥' },
      { label: 'روم استقبال الطلبات', description: 'الروم الذي تصل إليه الطلبات', value: 'requests_inbox_channel', emoji: '📨' },
      { label: 'روم تحكم المسؤولين', description: 'لوحة الإدارة للرولات', value: 'admin_control_channel', emoji: '🧰' },
      { label: 'روم تحكم الأعضاء', description: 'لوحة الأعضاء للرولات', value: 'member_control_channel', emoji: '🎛️' }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);
  const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id,
    time: 120000
  });

  collector.on('collect', async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    const selection = interaction.values[0];

    if (selection === 'manager_roles') {
      const roleMenu = new RoleSelectMenuBuilder()
        .setCustomId(`setroles_manager_roles_${message.author.id}`)
        .setPlaceholder('اختر رولات المسؤولين...')
        .setMinValues(1)
        .setMaxValues(10);

      await interaction.update({
        content: '**اختر رولات المسؤولين:**',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(roleMenu)]
      });
      return;
    }

    if (selection === 'manager_users') {
      const userMenu = new UserSelectMenuBuilder()
        .setCustomId(`setroles_manager_users_${message.author.id}`)
        .setPlaceholder('اختر المسؤولين بالأعضاء...')
        .setMinValues(1)
        .setMaxValues(10);

      await interaction.update({
        content: '**اختر الأعضاء المسؤولين:**',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(userMenu)]
      });
      return;
    }

    if (selection === 'log_channel' || selection === 'requests_channel' || selection === 'requests_inbox_channel' || selection === 'admin_control_channel' || selection === 'member_control_channel') {
      const channelMenu = new ChannelSelectMenuBuilder()
        .setCustomId(`setroles_channel_${selection}_${message.author.id}`)
        .setPlaceholder('اختر الروم...')
        .addChannelTypes(ChannelType.GuildText);

      await interaction.update({
        content: '**اختر الروم المطلوب:**',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(channelMenu)]
      });
    }
  });

  collector.on('end', async () => {
    try {
      await sentMessage.edit({ components: [] });
    } catch (error) {
      // ignore
    }
  });

  const interactionHandler = async interaction => {
    if (interaction.user.id !== message.author.id) return;

    if (interaction.isRoleSelectMenu() && interaction.customId === `setroles_manager_roles_${message.author.id}`) {
      updateGuildConfig(message.guild.id, { managerRoleIds: interaction.values });
      await interaction.update({ content: '✅ تم تحديث رولات المسؤولين بنجاح.', components: [] });
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === `setroles_manager_users_${message.author.id}`) {
      updateGuildConfig(message.guild.id, { managerUserIds: interaction.values });
      await interaction.update({ content: '✅ تم تحديث المسؤولين بالأعضاء بنجاح.', components: [] });
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('setroles_channel_')) {
      const payload = interaction.customId.replace('setroles_channel_', '');
      const parts = payload.split('_');
      const targetUserId = parts.pop();
      if (targetUserId !== message.author.id) {
        await interaction.reply({ content: '❌ هذا الخيار ليس لك.', ephemeral: true });
        return;
      }
      const selection = parts.join('_');
      const channelId = interaction.values[0];

      if (selection === 'log_channel') {
        updateGuildConfig(message.guild.id, { logChannelId: channelId });
      } else if (selection === 'requests_channel') {
        updateGuildConfig(message.guild.id, { requestsChannelId: channelId });
      } else if (selection === 'requests_inbox_channel') {
        updateGuildConfig(message.guild.id, { requestInboxChannelId: channelId });
      } else if (selection === 'admin_control_channel') {
        updateGuildConfig(message.guild.id, { adminControlChannelId: channelId });
      } else if (selection === 'member_control_channel') {
        updateGuildConfig(message.guild.id, { memberControlChannelId: channelId });
      }

      await interaction.update({ content: '✅ تم حفظ الروم بنجاح.', components: [] });
    }
  };

  client.on('interactionCreate', interactionHandler);

  collector.on('end', () => {
    client.removeListener('interactionCreate', interactionHandler);
  });
}

module.exports = { name, execute };
