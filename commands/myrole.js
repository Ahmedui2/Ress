const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionsBitField } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { findRoleByOwner, addRoleEntry } = require('../utils/customRolesSystem.js');
const { resolveIconBuffer } = require('../utils/roleIconUtils.js');
const moment = require('moment-timezone');

const name = 'رولي';
const aliases = ['myrole'];

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

async function respondEphemeral(interaction, payload) {
  if (!interaction) return;
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ...payload, ephemeral: true }).catch(() => {});
  } else {
    await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
  }
}

function buildControlEmbed(roleEntry, role, membersCount) {
  const createdAt = moment(roleEntry.createdAt).tz('Asia/Riyadh').format('YYYY-MM-DD HH:mm');
  const description = [
    `الرول: <@&${roleEntry.roleId}>`,
    `المالك: <@${roleEntry.ownerId}>`,
    `الإنشاء: ${createdAt}`,
    `الأعضاء: ${membersCount}`
  ].join('\n');

  return new EmbedBuilder()
    .setTitle('🎛️ لوحة التحكم بالرول الخاص')
    .setDescription(description)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(role.guild.client.user.displayAvatarURL({ size: 128 }));
}

function buildControlButtons(sessionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`myrole_manage_${sessionId}`).setLabel('إضافة/إزالة').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`myrole_color_${sessionId}`).setLabel('تغيير اللون').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`myrole_icon_${sessionId}`).setLabel('تغيير الأيقونة').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`myrole_members_${sessionId}`).setLabel('الأعضاء').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`myrole_transfer_${sessionId}`).setLabel('نقل الملكية').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`myrole_close_${sessionId}`).setLabel('إغلاق').setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function handleManageMembers({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  const members = [...role.members.values()];
  const list = members.slice(0, 40).map((member, index) => `${index + 1}. ${member.displayName} (<@${member.id}>)`).join('\n') || 'لا يوجد أعضاء حالياً.';

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('👥 إدارة الأعضاء')
        .setDescription(`**الأعضاء الحاليون:**\n${list}\n\n**أوامر الإدخال:**\n- اكتب أرقام الأعضاء للحذف (مثال: 1 3 5)\n- أو اكتب منشن/ID لإضافة أعضاء جدد\n**يمكنك دمج الاثنين في رسالة واحدة.**`)
        .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
        .setThumbnail(channel.client.user.displayAvatarURL({ size: 128 }))
    ]
  });

  const response = await promptForMessage(channel, userId, '**اكتب الآن اختياراتك:**');
  if (!response) return;

  const tokens = response.content.split(/\s+/);
  const idsToAdd = new Set();
  const numbersToRemove = new Set();

  for (const token of tokens) {
    if (/^\d{17,19}$/.test(token)) {
      idsToAdd.add(token);
    } else if (/^<@!?\d{17,19}>$/.test(token)) {
      idsToAdd.add(token.replace(/<@!?|>/g, ''));
    } else if (/^\d+$/.test(token)) {
      numbersToRemove.add(parseInt(token, 10));
    }
  }

  const membersToRemove = [...numbersToRemove]
    .map(num => members[num - 1])
    .filter(Boolean);

  const maxMembers = roleEntry.maxMembers || null;

  const added = [];
  const removed = [];

  for (const member of membersToRemove) {
    await member.roles.remove(role, 'إزالة من رول خاص').catch(() => {});
    removed.push(member.id);
  }

  for (const id of idsToAdd) {
    const member = await role.guild.members.fetch(id).catch(() => null);
    if (!member) continue;

    if (maxMembers && role.members.size >= maxMembers) break;
    await member.roles.add(role, 'إضافة إلى رول خاص').catch(() => {});
    added.push(member.id);
  }

  const summary = `**تم التحديث:**\n✅ تمت إضافة ${added.length} عضو\n🗑️ تمت إزالة ${removed.length} عضو`;
  if (interaction) {
    await interaction.followUp({ content: summary, ephemeral: true }).catch(() => {});
  } else {
    await channel.send(summary);
  }

  if (panelMessage) {
    const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
    await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
  }
}

async function handleColorChange({ interaction, role, roleEntry, panelMessage }) {
  if (!role.editable) {
    await respondEphemeral(interaction, { content: '**❌ لا يمكن تعديل هذا الرول بسبب صلاحيات البوت.**' });
    return;
  }
  const colorMenu = new StringSelectMenuBuilder()
    .setCustomId(`myrole_color_select_${interaction.id}`)
    .setPlaceholder('اختر لوناً...')
    .addOptions([
      ...PRESET_COLORS.map(color => ({ label: color.label, value: color.value })),
      { label: 'لون مخصص', value: 'custom' }
    ]);

  await respondEphemeral(interaction, {
    content: '**اختر لون الرول:**',
    components: [new ActionRowBuilder().addComponents(colorMenu)],
  });

  const selection = await interaction.channel.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id && i.customId === `myrole_color_select_${interaction.id}`,
    time: 60000
  }).catch(() => null);

  if (!selection) return;
  if (selection.values[0] === 'custom') {
    await selection.deferUpdate();
    const response = await promptForMessage(interaction.channel, interaction.user.id, '**اكتب كود اللون (Hex) مثل #ff0000:**');
    if (response && /^#?[0-9A-Fa-f]{6}$/.test(response.content.trim())) {
      const value = response.content.trim().startsWith('#') ? response.content.trim() : `#${response.content.trim()}`;
      await role.setColor(value).catch(() => {});
      roleEntry.color = value;
      addRoleEntry(role.id, roleEntry);
    }
  } else {
    await selection.deferUpdate();
    await role.setColor(selection.values[0]).catch(() => {});
    roleEntry.color = selection.values[0];
    addRoleEntry(role.id, roleEntry);
  }

  if (panelMessage) {
    const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
    await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
  }
  await respondEphemeral(interaction, { content: '**✅ تم تحديث لون الرول.**' });
}

async function handleIconChange({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  if (!role.editable) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ لا يمكن تعديل أيقونة هذا الرول بسبب صلاحيات البوت.**' });
    } else {
      await channel.send('**❌ لا يمكن تعديل أيقونة هذا الرول بسبب صلاحيات البوت.**');
    }
    return;
  }
  const response = await promptForMessage(channel, userId, '**أرسل إيموجي أو رابط صورة أو أرفق صورة لتعيين أيقونة الرول:**');
  if (!response) return;

  try {
    const buffer = await resolveIconBuffer(response.content, [...response.attachments.values()]);
    if (!buffer) {
      await channel.send('**❌ لم أتمكن من معالجة هذه الأيقونة.**');
      return;
    }
    await role.setIcon(buffer).catch(() => {});
    roleEntry.icon = role.iconURL();
    addRoleEntry(role.id, roleEntry);
    if (panelMessage) {
      const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
      await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
    }
    if (interaction) {
      await respondEphemeral(interaction, { content: '**✅ تم تحديث أيقونة الرول.**' });
    } else {
      await channel.send('**✅ تم تحديث أيقونة الرول.**');
    }
  } catch (error) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ فشل تحديث الأيقونة.**' });
    } else {
      await channel.send('**❌ فشل تحديث الأيقونة.**');
    }
  }
}

async function handleMembersList({ channel, role, interaction }) {
  const members = [...role.members.values()];
  const list = members.slice(0, 50).map((member, index) => `**${index + 1}.** ${member.displayName} (<@${member.id}>)`).join('\n') || 'لا يوجد أعضاء حالياً.';
  const embed = new EmbedBuilder()
    .setTitle('📋 أعضاء الرول')
    .setDescription(list)
    .setFooter({ text: `إجمالي الأعضاء: ${members.length}` })
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(channel.client.user.displayAvatarURL({ size: 128 }));

  if (interaction) {
    await respondEphemeral(interaction, { embeds: [embed] });
  } else {
    await channel.send({ embeds: [embed] });
  }
}

async function handleTransfer({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  if (!role.editable) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ لا يمكن نقل الملكية بسبب صلاحيات البوت.**' });
    } else {
      await channel.send('**❌ لا يمكن نقل الملكية بسبب صلاحيات البوت.**');
    }
    return;
  }
  const response = await promptForMessage(channel, userId, '**منشن أو اكتب ID المالك الجديد:**');
  if (!response) return;

  const mentionId = response.mentions.users.first()?.id || response.content.match(/\d{17,19}/)?.[0];
  if (!mentionId) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ لم يتم العثور على عضو صالح.**' });
    } else {
      await channel.send('**❌ لم يتم العثور على عضو صالح.**');
    }
    return;
  }

  const confirmMessage = await channel.send('**هل تريد تأكيد نقل الملكية؟**');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`myrole_transfer_confirm_${Date.now()}`).setLabel('تأكيد').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`myrole_transfer_cancel_${Date.now()}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
  );
  await confirmMessage.edit({ components: [row] });

  const confirm = await confirmMessage.awaitMessageComponent({
    filter: i => i.user.id === userId,
    time: 30000
  }).catch(() => null);

  if (!confirm) return;

  if (confirm.customId.includes('cancel')) {
    await confirm.update({ content: '**تم إلغاء نقل الملكية.**', components: [] });
    return;
  }

  await confirm.deferUpdate();

  const newOwner = await role.guild.members.fetch(mentionId).catch(() => null);
  if (!newOwner) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ العضو غير موجود.**' });
    } else {
      await channel.send('**❌ العضو غير موجود.**');
    }
    return;
  }

  roleEntry.ownerId = mentionId;
  addRoleEntry(role.id, roleEntry);
  await newOwner.roles.add(role, 'نقل ملكية رول خاص').catch(() => {});
  if (panelMessage) {
    const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
    await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
  }
  if (interaction) {
    await respondEphemeral(interaction, { content: '**✅ تم نقل ملكية الرول.**' });
  } else {
    await channel.send('**✅ تم نقل ملكية الرول.**');
  }
}

async function startMyRoleFlow({ member, channel, client }) {
  const roleEntry = findRoleByOwner(member.guild.id, member.id);
  if (!roleEntry) {
    await channel.send('**❌ ليس لديك رول خاص.**');
    return;
  }

  const role = member.guild.roles.cache.get(roleEntry.roleId);
  if (!role) {
    await channel.send('**❌ لم يتم العثور على الرول في السيرفر.**');
    return;
  }

  const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await channel.send('**❌ البوت يحتاج صلاحية Manage Roles لإدارة الرولات.**');
    return;
  }

  const membersCount = role.members.size;
  const embed = buildControlEmbed(roleEntry, role, membersCount);

  const sessionId = `${member.id}_${Date.now()}`;
  const sentMessage = await channel.send({ embeds: [embed], components: buildControlButtons(sessionId) });

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === member.id,
    time: 180000
  });

  collector.on('collect', async interaction => {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const session = parts.slice(2).join('_');
    if (session !== sessionId) return;

    if (action === 'close') {
      await interaction.update({ content: '**تم إغلاق لوحة التحكم.**', embeds: [], components: [] });
      collector.stop('closed');
      return;
    }

    if (action === 'manage') {
      await interaction.deferUpdate();
      if (!role.editable) {
        await channel.send('**❌ لا يمكن تعديل الأعضاء بسبب صلاحيات البوت.**');
        return;
      }
      await handleManageMembers({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
    }

    if (action === 'color') {
      await handleColorChange({ interaction, role, roleEntry, panelMessage: sentMessage });
    }

    if (action === 'icon') {
      await interaction.deferUpdate();
      await handleIconChange({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
    }

    if (action === 'members') {
      await interaction.deferUpdate();
      await handleMembersList({ channel, role, interaction });
    }

    if (action === 'transfer') {
      await interaction.deferUpdate();
      await handleTransfer({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'closed') return;
    if (!sentMessage.editable) return;
    await sentMessage.edit({ components: [], content: '**⏱️ انتهت مهلة لوحة الرول.**' }).catch(() => {});
  });
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  await startMyRoleFlow({ member: message.member, channel: message.channel, client });
}

async function handleMemberAction(interaction, action, client) {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: '❌ العضو غير موجود.', ephemeral: true });
    return;
  }
  const roleEntry = findRoleByOwner(member.guild.id, member.id);
  if (!roleEntry) {
    await interaction.reply({ content: '❌ ليس لديك رول خاص.', ephemeral: true });
    return;
  }
  const role = member.guild.roles.cache.get(roleEntry.roleId);
  if (!role) {
    await interaction.reply({ content: '❌ لم يتم العثور على الرول في السيرفر.', ephemeral: true });
    return;
  }

  if (action === 'members') {
    await handleMembersList({ channel: interaction.channel, role, interaction });
    return;
  }
  if (action === 'color') {
    await handleColorChange({ interaction, role, roleEntry });
    return;
  }
  if (action === 'icon') {
    await interaction.deferReply({ ephemeral: true });
    await handleIconChange({ channel: interaction.channel, userId: member.id, role, roleEntry, interaction });
    return;
  }
  if (action === 'transfer') {
    await interaction.deferReply({ ephemeral: true });
    await handleTransfer({ channel: interaction.channel, userId: member.id, role, roleEntry, interaction });
    return;
  }
  if (action === 'manage') {
    await interaction.deferReply({ ephemeral: true });
    await handleManageMembers({ channel: interaction.channel, userId: member.id, role, roleEntry, interaction });
    return;
  }

  await interaction.reply({ content: '❌ خيار غير معروف.', ephemeral: true });
}

module.exports = { name, aliases, execute, startMyRoleFlow, handleMemberAction };
