const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionsBitField } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { addRoleEntry, findRoleByOwner, getGuildConfig, isManager } = require('../utils/customRolesSystem.js');
const { resolveIconBuffer } = require('../utils/roleIconUtils.js');

const name = 'انشاء';
const aliases = ['srole'];

const activeCreates = new Map();

const PRESET_COLORS = [
  { label: 'أحمر', value: '#e74c3c' },
  { label: 'أزرق', value: '#3498db' },
  { label: 'أخضر', value: '#2ecc71' },
  { label: 'بنفسجي', value: '#9b59b6' },
  { label: 'ذهبي', value: '#f1c40f' },
  { label: 'وردي', value: '#ff5fa2' },
  { label: 'أسود', value: '#2c3e50' },
  { label: 'رمادي', value: '#95a5a6' }
];

function buildStateEmbed(state) {
  const created = state.createdBy ? `<@${state.createdBy}>` : 'غير محدد';
  const description = [
    `المالك: <@${state.ownerId}>`,
    `الاسم: ${state.name ? `**${state.name}**` : 'غير محدد'}`,
    `الحد: ${state.maxMembers ? `${state.maxMembers} عضو` : 'غير محدد'}`,
    `اللون: ${state.color || 'غير محدد'}`,
    `الأيقونة: ${state.iconLabel || 'غير محددة'}`,
    `المنشئ: ${created}`
  ].join('\n');

  return new EmbedBuilder()
    .setTitle('✨ إنشاء رول خاص')
    .setDescription(description)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(state.clientAvatar);
}

function buildButtons(state) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`srole_name_${state.sessionId}`).setLabel('اسم الرول').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`srole_limit_${state.sessionId}`).setLabel('حد الرول').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`srole_color_${state.sessionId}`).setLabel('لون الرول').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`srole_icon_${state.sessionId}`).setLabel('أيقونة الرول').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`srole_finish_${state.sessionId}`).setLabel('إنهاء').setStyle(ButtonStyle.Success).setDisabled(!state.name),
    new ButtonBuilder().setCustomId(`srole_cancel_${state.sessionId}`).setLabel('إلغاء').setStyle(ButtonStyle.Danger)
  );

  return [row, row2];
}

async function promptForMessage(channel, userId, promptText) {
  const prompt = await channel.send(promptText);
  const collected = await channel.awaitMessages({
    filter: msg => msg.author.id === userId,
    max: 1,
    time: 60000
  });

  const response = collected.first();

  setTimeout(() => {
    prompt.delete().catch(() => {});
    if (response) response.delete().catch(() => {});
  }, 3000);

  return response;
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const mentionId = message.mentions.users.first()?.id || args.find(arg => /^\d{17,19}$/.test(arg));
  const ownerId = mentionId || message.author.id;

  const guildConfig = getGuildConfig(message.guild.id);
  const canManage = isManager(message.member, guildConfig, BOT_OWNERS);

  if (!canManage && ownerId !== message.author.id) {
    await message.reply('**❌ لا يمكنك إنشاء رول لشخص آخر.**');
    return;
  }

  const existingRole = findRoleByOwner(message.guild.id, ownerId);
  if (existingRole) {
    await message.reply('**⚠️ هذا العضو يمتلك رول خاص بالفعل.**');
    return;
  }

  const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
  if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await message.reply('**❌ البوت يحتاج صلاحية Manage Roles لإنشاء الرولات.**');
    return;
  }

  const sessionId = `${message.author.id}_${Date.now()}`;
  const state = {
    sessionId,
    ownerId,
    createdBy: message.author.id,
    name: null,
    color: null,
    maxMembers: null,
    iconBuffer: null,
    iconLabel: null,
    clientAvatar: message.client.user.displayAvatarURL({ size: 128 })
  };

  activeCreates.set(sessionId, state);

  const embed = buildStateEmbed(state);
  const components = buildButtons(state);
  const sentMessage = await message.channel.send({ embeds: [embed], components });

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id,
    time: 300000
  });

  collector.on('collect', async interaction => {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const id = parts.slice(2).join('_');
    if (id !== sessionId) return;

    if (action === 'cancel') {
      activeCreates.delete(sessionId);
      await interaction.update({ content: '**❌ تم إلغاء إنشاء الرول.**', embeds: [], components: [] });
      collector.stop('cancelled');
      return;
    }

    if (action === 'name') {
      await interaction.deferUpdate();
      const response = await promptForMessage(message.channel, message.author.id, '**اكتب اسم الرول المطلوب:**');
      if (!response) return;
      state.name = response.content.slice(0, 100);
    }

    if (action === 'limit') {
      await interaction.deferUpdate();
      const response = await promptForMessage(message.channel, message.author.id, '**اكتب حد الأعضاء (رقم) أو اكتب "بدون" لإزالته:**');
      if (!response) return;
      if (response.content.trim().toLowerCase() === 'بدون') {
        state.maxMembers = null;
      } else {
        const limit = parseInt(response.content.trim(), 10);
        if (!Number.isNaN(limit) && limit > 0) {
          state.maxMembers = limit;
        }
      }
    }

    if (action === 'color') {
      const colorMenu = new StringSelectMenuBuilder()
        .setCustomId(`srole_color_select_${sessionId}`)
        .setPlaceholder('اختر لوناً...')
        .addOptions([
          ...PRESET_COLORS.map(color => ({ label: color.label, value: color.value })),
          { label: 'لون مخصص', value: 'custom' }
        ]);

      await interaction.update({
        content: '**اختر لون الرول من القائمة:**',
        embeds: [buildStateEmbed(state)],
        components: [new ActionRowBuilder().addComponents(colorMenu)]
      });
      return;
    }

    if (action === 'icon') {
      await interaction.deferUpdate();
      const response = await promptForMessage(message.channel, message.author.id, '**أرسل إيموجي أو رابط صورة أو أرفق صورة لاستخدامها كأيقونة:**');
      if (!response) return;
      try {
        const buffer = await resolveIconBuffer(response.content, [...response.attachments.values()]);
        if (!buffer) {
          await message.channel.send('**❌ لم يتم العثور على صورة أو إيموجي صالح.**');
          return;
        }
        state.iconBuffer = buffer;
        state.iconLabel = response.content || 'صورة مرفقة';
      } catch (error) {
        await message.channel.send('**❌ فشل تحميل الأيقونة، تأكد من صحة الرابط أو الإيموجي.**');
      }
    }

    if (action === 'finish') {
      await interaction.deferUpdate();
      if (!state.name) return;

      try {
        const role = await message.guild.roles.create({
          name: state.name,
          color: state.color || undefined,
          reason: `إنشاء رول خاص بواسطة ${message.author.tag}`
        });

        if (state.iconBuffer) {
          await role.setIcon(state.iconBuffer).catch(() => {});
        }

        const ownerMember = await message.guild.members.fetch(state.ownerId).catch(() => null);
        if (ownerMember) {
          await ownerMember.roles.add(role, 'منح رول خاص جديد').catch(() => {});
        }

        addRoleEntry(role.id, {
          roleId: role.id,
          guildId: message.guild.id,
          ownerId: state.ownerId,
          createdAt: Date.now(),
          createdBy: state.createdBy,
          name: role.name,
          color: role.hexColor,
          icon: role.iconURL(),
          maxMembers: state.maxMembers
        });

        const details = new EmbedBuilder()
          .setTitle('✅ تم إنشاء الرول الخاص')
          .setDescription(`الرول: <@&${role.id}>\nالمالك: <@${state.ownerId}>`)
          .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
          .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));

        await message.channel.send({ embeds: [details] });

        if (ownerMember) {
          await ownerMember.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('🎉 تم إنشاء رولك الخاص')
                .setDescription(`الرول: ${role.name}\nتم الإنشاء بواسطة: <@${state.createdBy}>`)
                .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
                .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }))
            ]
          }).catch(() => {});
        }

        activeCreates.delete(sessionId);
        await sentMessage.edit({ embeds: [], components: [], content: '**✅ تم إكمال إنشاء الرول.**' });
        collector.stop('completed');
        return;
      } catch (error) {
        console.error('خطأ في إنشاء الرول الخاص:', error);
        await message.channel.send('**❌ حدث خطأ أثناء إنشاء الرول.**');
      }
    }

    await sentMessage.edit({ embeds: [buildStateEmbed(state)], components: buildButtons(state) });
  });

  collector.on('end', async (_collected, reason) => {
    activeCreates.delete(sessionId);
    if (reason === 'completed' || reason === 'cancelled') return;
    if (!sentMessage.editable) return;
    await sentMessage.edit({ components: [], content: '**⏱️ انتهت مهلة الإنشاء.**' }).catch(() => {});
  });

  const interactionHandler = async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.user.id !== message.author.id) return;

    if (interaction.customId === `srole_color_select_${sessionId}`) {
      const selected = interaction.values[0];
      if (selected === 'custom') {
        await interaction.deferUpdate();
        const response = await promptForMessage(message.channel, message.author.id, '**اكتب كود اللون (Hex) مثل #ff0000:**');
        if (response && /^#?[0-9A-Fa-f]{6}$/.test(response.content.trim())) {
          const value = response.content.trim().startsWith('#') ? response.content.trim() : `#${response.content.trim()}`;
          state.color = value;
        }
      } else {
        await interaction.deferUpdate();
        state.color = selected;
      }

      await interaction.message.edit({ embeds: [buildStateEmbed(state)], components: buildButtons(state) });
    }
  };

  client.on('interactionCreate', interactionHandler);

  collector.on('end', () => {
    client.removeListener('interactionCreate', interactionHandler);
  });
}

module.exports = { name, aliases, execute };
