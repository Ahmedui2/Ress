const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getGuildConfig, getRoleEntry, deleteRoleEntry, getGuildRoles, isManager } = require('../utils/customRolesSystem.js');

const name = 'حذف';
const aliases = ['dsrole'];

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const guildConfig = getGuildConfig(message.guild.id);
  const canManage = isManager(message.member, guildConfig, BOT_OWNERS);
  if (!canManage) {
    await message.react('❌').catch(() => {});
    return;
  }

  const roleMention = message.mentions.roles.first();
  const roleIdFromArgs = args.find(arg => /^\d{17,19}$/.test(arg));
  const targetRoleId = roleMention?.id || roleIdFromArgs;

  if (targetRoleId) {
    const roleEntry = getRoleEntry(targetRoleId);
    if (!roleEntry || roleEntry.guildId !== message.guild.id) {
      await message.reply('**❌ هذا الرول ليس ضمن الرولات الخاصة.**');
      return;
    }

    if (roleEntry.ownerId !== message.author.id && !canManage) {
      await message.reply('**❌ لا تملك صلاحية حذف هذا الرول.**');
      return;
    }

    const role = message.guild.roles.cache.get(targetRoleId);
    const embed = new EmbedBuilder()
      .setTitle('تأكيد حذف الرول')
      .setDescription(`**الرول : ${role ? `<@&${targetRoleId}>` : targetRoleId}\n الأونر : <@${roleEntry.ownerId}>**`)
      .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
      .setThumbnail('https://cdn.discordapp.com/attachments/1465209977378439262/1465221268692275251/delete_5.png?ex=69785124&is=6976ffa4&hm=84c2e9633637ab34f90545a3196a5243cebb0f5272247f03ff430ea0fbbf089e&');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dsrole_confirm_${targetRoleId}_${message.author.id}`).setLabel('تأكيد الحذف').setEmoji('<:emoji_7:1465221394966253768>').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`dsrole_cancel_${targetRoleId}_${message.author.id}`).setLabel('إلغاء').setEmoji('<:emoji_7:1465221361839505622>').setStyle(ButtonStyle.Secondary)
    );

    const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

    const collector = sentMessage.createMessageComponentCollector({
      filter: interaction => interaction.user.id === message.author.id,
      time: 60000
    });

    collector.on('collect', async interaction => {
      if (interaction.customId.startsWith('dsrole_cancel_')) {
        await interaction.update({ content: '**تم إلغاء العملية.**', embeds: [], components: [] });
        collector.stop('cancelled');
        return;
      }

      await interaction.deferUpdate();
      const targetRole = message.guild.roles.cache.get(targetRoleId);
      if (targetRole) {
        if (!targetRole.editable) {
          await sentMessage.edit({ content: '**❌ لا يمكن حذف هذا الرول بسبب صلاحيات البوت.**', embeds: [], components: [] });
          collector.stop('forbidden');
          return;
        }
        await targetRole.delete(`حذف رول خاص بواسطة ${message.author.tag}`).catch(() => {});
      }
      deleteRoleEntry(targetRoleId, message.author.id);
      await sentMessage.edit({ content: '**✅ تم حذف الرول الخاص بنجاح.**', embeds: [], components: [] });
      collector.stop('deleted');
    });

    return;
  }

  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
  if (!isOwner) {
    await message.reply('**❌ الحذف المتعدد متاح للأونرز فقط.**');
    return;
  }

  const guildRoles = getGuildRoles(message.guild.id);
  if (guildRoles.length === 0) {
    await message.reply('**لا توجد رولات خاصة حالياً.**');
    return;
  }

  const options = guildRoles.slice(0, 25).map(role => ({
    label: role.name || role.roleId,
    value: role.roleId,
    description: `اي دي الأونر  : ${role.ownerId}`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`dsrole_bulk_${message.author.id}`)
    .setPlaceholder('اختر الرولات للحذف...')
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  const embed = new EmbedBuilder()
    .setTitle('Delete roles')
    .setDescription('**اختر الرولات المراد حذفها :**')
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail('https://cdn.discordapp.com/attachments/1465209977378439262/1465221268692275251/delete_5.png?ex=69785124&is=6976ffa4&hm=84c2e9633637ab34f90545a3196a5243cebb0f5272247f03ff430ea0fbbf089e&')
.setFooter({ text: 'Roles sys;' });

  const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id,
    time: 60000
  });

  collector.on('collect', async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    const selectedRoles = interaction.values;
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dsrole_bulk_confirm_${message.author.id}`).setLabel('تأكيد الحذف').setEmoji('<:emoji_7:1465221394966253768>').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`dsrole_bulk_cancel_${message.author.id}`).setLabel('إلغاء').setEmoji('<:emoji_7:1465221361839505622>').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      content: `**سيتم حذف ${selectedRoles.length} رول. هل أنت متأكد؟**`,
      embeds: [],
      components: [confirmRow]
    });

    const confirmCollector = sentMessage.createMessageComponentCollector({
      filter: btn => btn.user.id === message.author.id,
      time: 30000
    });

    confirmCollector.on('collect', async btn => {
      if (btn.customId.includes('cancel')) {
        await btn.update({ content: '**تم إلغاء الحذف المتعدد.**', components: [] });
        confirmCollector.stop('cancelled');
        return;
      }

      await btn.deferUpdate();
      for (const roleId of selectedRoles) {
        const role = message.guild.roles.cache.get(roleId);
        if (role) {
          await role.delete(`حذف متعدد بواسطة ${message.author.tag}`).catch(() => {});
        }
        deleteRoleEntry(roleId, message.author.id);
      }
      await sentMessage.edit({ content: '**✅ تم حذف الرولات المحددة بنجاح.**', components: [] });
      confirmCollector.stop('done');
    });
  });
}

module.exports = { name, aliases, execute };
