const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, PermissionsBitField } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { findRoleByOwner, addRoleEntry, deleteRoleEntry, getGuildConfig } = require('../utils/customRolesSystem.js');
const { resolveIconBuffer, applyRoleIcon } = require('../utils/roleIconUtils.js');
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
const activeRolePanels = new Map();

function formatDurationShort(ms) {
  if (!ms || ms <= 0) return '0 د';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days} ي ${remainingHours} س`;
  }
  if (hours > 0) return `${hours} س ${minutes} د`;
  return `${minutes} د`;
}

function ensureMemberMeta(roleEntry) {
  if (!roleEntry.memberMeta) roleEntry.memberMeta = {};
  return roleEntry.memberMeta;
}

function setMemberAssignment(roleEntry, memberId, assignedById, assignedByIsBot) {
  const meta = ensureMemberMeta(roleEntry);
  meta[memberId] = {
    assignedAt: Date.now(),
    assignedBy: assignedById,
    assignedByIsBot: Boolean(assignedByIsBot)
  };
}

function removeMemberAssignment(roleEntry, memberId) {
  const meta = ensureMemberMeta(roleEntry);
  delete meta[memberId];
}

async function promptForMessage(channel, userId, promptText, interaction) {
  const prompt = interaction
    ? await respondEphemeralWithMessage(interaction, { content: promptText })
    : await channel.send(promptText);
  const collected = await channel.awaitMessages({
    filter: msg => msg.author.id === userId,
    max: 1,
    time: 60000
  });

  const response = collected.first();
  if (prompt && !interaction) scheduleDelete(prompt, 1000);
  if (response) scheduleDelete(response, 1000);

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

async function respondEphemeralWithMessage(interaction, payload) {
  if (!interaction) return null;
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ ...payload, ephemeral: true, fetchReply: true }).catch(() => null);
  }
  return interaction.reply({ ...payload, ephemeral: true, fetchReply: true }).catch(() => null);
}

function scheduleDelete(message, delay = 180000) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delay);
}

async function sendTemp(channel, payload, delay = 5000) {
  if (!channel) return null;
  const message = typeof payload === 'string'
    ? await channel.send(payload)
    : await channel.send(payload);
  scheduleDelete(message, delay);
  return message;
}

async function logRoleAction(guild, description, fields = []) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig?.logChannelId) return;
  const channel = await guild.channels.fetch(guildConfig.logChannelId).catch(() => null);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setTitle('📝 سجل الرولات الخاصة')
    .setDescription(description)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setTimestamp();
  if (fields.length) embed.addFields(fields);
  await channel.send({ embeds: [embed] }).catch(() => {});
}

function buildControlEmbed(roleEntry, role, membersCount) {
  const createdAt = moment(roleEntry.createdAt).tz('Asia/Riyadh').format('YYYY-MM-DD HH:mm');
  const description = [
    `الرول: <@&${roleEntry.roleId}>`,
    `المالك: <@${roleEntry.ownerId}>`,
    `الإنشاء: ${createdAt}`,
    `الأعضاء: ${membersCount}`,
    `الحد: ${roleEntry.maxMembers ? `${roleEntry.maxMembers} عضو` : 'بدون'}`,
    `اللون: ${roleEntry.color || role.hexColor || 'غير محدد'}`
  ].join('\n');

  return new EmbedBuilder()
    .setTitle('🎛️ لوحة التحكم بالرول الخاص')
    .setDescription(description)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(role.guild.client.user.displayAvatarURL({ size: 128 }));
}

function buildControlComponents(sessionId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`myrole_action_${sessionId}`)
    .setPlaceholder('اختر إجراءً...')
    .addOptions([
      { label: 'تغيير الاسم', value: 'name', emoji: '✏️' },
      { label: 'تغيير اللون', value: 'color', emoji: '🎨' },
      { label: 'تغيير الأيقونة', value: 'icon', emoji: '✨' },
      { label: 'إضافة/إزالة', value: 'manage', emoji: '➕' },
      { label: 'الأعضاء', value: 'members', emoji: '👥' },
      { label: 'نقل الملكية', value: 'transfer', emoji: '🔁' }
    ]);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`myrole_delete_${sessionId}`).setLabel('حذف الرول').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`myrole_close_${sessionId}`).setLabel('إغلاق').setStyle(ButtonStyle.Secondary)
  );

  return [new ActionRowBuilder().addComponents(menu), buttons];
}

async function handleManageMembers({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  const sessionId = Date.now();
  const perPage = 25;
  let currentPage = 0;
  let statusText = null;

  const getMembers = () => [...role.members.values()];

  const buildPayload = () => {
    const members = getMembers();
    const totalPages = Math.max(1, Math.ceil(members.length / perPage));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    const pageMembers = members.slice(currentPage * perPage, (currentPage + 1) * perPage);
    const list = pageMembers.map((member, index) => `${index + 1 + currentPage * perPage}. ${member.displayName} (<@${member.id}>)`).join('\n') || 'لا يوجد أعضاء حالياً.';

    const addMenu = new UserSelectMenuBuilder()
      .setCustomId(`myrole_manage_add_${sessionId}`)
      .setPlaceholder('إضافة أعضاء...')
      .setMinValues(1)
      .setMaxValues(25);

    const removeOptions = pageMembers.map(member => ({
      label: member.displayName.slice(0, 100),
      value: member.id
    }));

    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId(`myrole_manage_remove_${sessionId}`)
      .setPlaceholder('إزالة أعضاء...')
      .setMinValues(1)
      .setMaxValues(Math.min(25, removeOptions.length || 1));

    if (removeOptions.length) {
      removeMenu.addOptions(removeOptions);
    } else {
      removeMenu.addOptions([{ label: 'لا يوجد أعضاء', value: 'none' }]).setDisabled(true);
    }

    const components = [
      new ActionRowBuilder().addComponents(addMenu),
      new ActionRowBuilder().addComponents(removeMenu)
    ];

    if (members.length > perPage) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`myrole_manage_prev_${sessionId}`)
          .setLabel('السابق')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(`myrole_manage_next_${sessionId}`)
          .setLabel('التالي')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      ));
    }

    const description = [
      statusText ? `**آخر عملية:** ${statusText}` : null,
      `**الأعضاء الحاليون (صفحة ${currentPage + 1}/${totalPages}):**`,
      list,
      '',
      '**اختر من القوائم لإضافة أو إزالة الأعضاء.**'
    ].filter(Boolean).join('\n');

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('👥 إدارة الأعضاء')
          .setDescription(description)
          .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
          .setThumbnail(channel.client.user.displayAvatarURL({ size: 128 }))
      ],
      components
    };
  };

  const infoMessage = interaction
    ? await respondEphemeralWithMessage(interaction, buildPayload())
    : await channel.send(buildPayload());
  if (!infoMessage) return;
  if (!interaction) {
    scheduleDelete(infoMessage);
  }

  const collector = infoMessage.createMessageComponentCollector({
    filter: i => i.user.id === userId,
    time: 60000
  });

  collector.on('collect', async selection => {
    const maxMembers = roleEntry.maxMembers || null;
    const added = [];
    const removed = [];

    if (selection.isButton()) {
      if (selection.customId === `myrole_manage_prev_${sessionId}`) currentPage = Math.max(0, currentPage - 1);
      if (selection.customId === `myrole_manage_next_${sessionId}`) currentPage += 1;
      await selection.update(buildPayload()).catch(() => {});
      return;
    }

    if (selection.isUserSelectMenu() && selection.customId === `myrole_manage_add_${sessionId}`) {
      for (const id of selection.values) {
        const member = await role.guild.members.fetch(id).catch(() => null);
        if (!member) continue;
        if (maxMembers && role.members.size >= maxMembers) break;
        await member.roles.add(role, 'إضافة إلى رول خاص').catch(() => {});
        setMemberAssignment(roleEntry, member.id, userId, selection.user.bot);
        added.push(member.id);
      }
    }

    if (selection.isStringSelectMenu() && selection.customId === `myrole_manage_remove_${sessionId}`) {
      if (!selection.values.includes('none')) {
        for (const id of selection.values) {
          const member = await role.guild.members.fetch(id).catch(() => null);
          if (!member) continue;
          await member.roles.remove(role, 'إزالة من رول خاص').catch(() => {});
          removeMemberAssignment(roleEntry, member.id);
          removed.push(member.id);
        }
      }
    }

    if (added.length || removed.length) {
      roleEntry.updatedAt = Date.now();
      addRoleEntry(role.id, roleEntry);
      statusText = `✅ إضافة ${added.length} | 🗑️ إزالة ${removed.length}`;
      await logRoleAction(role.guild, 'تم تحديث أعضاء رول خاص.', [
        { name: 'الرول', value: `<@&${role.id}>`, inline: true },
        { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true },
        { name: 'إضافة', value: `${added.length}`, inline: true },
        { name: 'إزالة', value: `${removed.length}`, inline: true }
      ]);
    }

    await selection.update(buildPayload()).catch(() => {});

    if (panelMessage) {
      const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
      await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
    }
  });

  collector.on('end', async () => {
    statusText = statusText || 'انتهت المهلة.';
    await infoMessage.edit({ components: [], embeds: buildPayload().embeds }).catch(() => {});
  });
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

  const colorMessage = await respondEphemeralWithMessage(interaction, {
    content: '**اختر لون الرول:**',
    components: [new ActionRowBuilder().addComponents(colorMenu)],
  });

  const selection = await colorMessage?.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id && i.customId === `myrole_color_select_${interaction.id}`,
    time: 60000
  }).catch(() => null);

  if (!selection) return;
  if (selection.values[0] === 'custom') {
    await selection.deferUpdate();
    const response = await promptForMessage(interaction.channel, interaction.user.id, '**اكتب كود اللون (Hex) مثل #ff0000:**', interaction);
    if (response && /^#?[0-9A-Fa-f]{6}$/.test(response.content.trim())) {
      const value = response.content.trim().startsWith('#') ? response.content.trim() : `#${response.content.trim()}`;
      await role.setColor(value).catch(() => {});
      roleEntry.color = value;
      roleEntry.updatedAt = Date.now();
      addRoleEntry(role.id, roleEntry);
    }
  } else {
    await selection.deferUpdate();
    await role.setColor(selection.values[0]).catch(() => {});
    roleEntry.color = selection.values[0];
    roleEntry.updatedAt = Date.now();
    addRoleEntry(role.id, roleEntry);
  }

  if (panelMessage) {
    const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
    await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
  }
  await respondEphemeral(interaction, { content: '**✅ تم تحديث لون الرول.**' });
  await logRoleAction(role.guild, 'تم تغيير لون رول خاص.', [
    { name: 'الرول', value: `<@&${role.id}>`, inline: true },
    { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true },
    { name: 'اللون', value: roleEntry.color || 'غير محدد', inline: true }
  ]);
}

async function handleNameChange({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  if (!role.editable) {
    await respondEphemeral(interaction, { content: '**❌ لا يمكن تعديل اسم هذا الرول بسبب صلاحيات البوت.**' });
    return;
  }

  const response = await promptForMessage(channel, userId, '**اكتب الاسم الجديد للرول:**', interaction);
  if (!response) return;
  const newName = response.content.trim().slice(0, 100);
  if (!newName) {
    await respondEphemeral(interaction, { content: '**❌ الاسم غير صالح.**' });
    return;
  }

  try {
    await role.setName(newName).catch(() => {});
    roleEntry.name = newName;
    roleEntry.updatedAt = Date.now();
    addRoleEntry(role.id, roleEntry);
    if (panelMessage) {
      const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
      await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
    }
    await respondEphemeral(interaction, { content: '**✅ تم تحديث اسم الرول.**' });
    await logRoleAction(role.guild, 'تم تحديث اسم رول خاص.', [
      { name: 'الرول', value: `<@&${role.id}>`, inline: true },
      { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true },
      { name: 'الاسم الجديد', value: newName, inline: true }
    ]);
  } catch (error) {
    await respondEphemeral(interaction, { content: '**❌ فشل تحديث اسم الرول.**' });
  }
}

async function handleIconChange({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  if (!role.editable) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ لا يمكن تعديل أيقونة هذا الرول بسبب صلاحيات البوت.**' });
    } else {
      await sendTemp(channel, '**❌ لا يمكن تعديل أيقونة هذا الرول بسبب صلاحيات البوت.**');
    }
    return;
  }
  const response = await promptForMessage(channel, userId, '**أرسل إيموجي أو رابط صورة أو أرفق صورة لتعيين أيقونة الرول:**', interaction);
  if (!response) return;

  try {
    const buffer = await resolveIconBuffer(response.content, [...response.attachments.values()]);
    if (!buffer) {
      if (interaction) {
        await respondEphemeral(interaction, { content: '**❌ لم أتمكن من معالجة هذه الأيقونة.**' });
      } else {
        await sendTemp(channel, '**❌ لم أتمكن من معالجة هذه الأيقونة.**');
      }
      return;
    }
    const refreshedRole = await applyRoleIcon(role, buffer);
    roleEntry.icon = refreshedRole.iconURL();
    roleEntry.updatedAt = Date.now();
    addRoleEntry(role.id, roleEntry);
    if (panelMessage) {
      const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
      await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
    }
    if (interaction) {
      await respondEphemeral(interaction, { content: '**✅ تم تحديث أيقونة الرول.**' });
    } else {
      await sendTemp(channel, '**✅ تم تحديث أيقونة الرول.**');
    }
    await logRoleAction(role.guild, 'تم تحديث أيقونة رول خاص.', [
      { name: 'الرول', value: `<@&${role.id}>`, inline: true },
      { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true }
    ]);
  } catch (error) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ فشل تحديث الأيقونة.**' });
    } else {
      await sendTemp(channel, '**❌ فشل تحديث الأيقونة.**');
    }
  }
}

async function handleMembersList({ channel, role, interaction, roleEntry }) {
  const sessionId = Date.now();
  const perPage = 25;
  let currentPage = 0;
  let detailsText = null;

  const buildPayload = () => {
    const members = [...role.members.values()];
    const totalPages = Math.max(1, Math.ceil(members.length / perPage));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    const pageMembers = members.slice(currentPage * perPage, (currentPage + 1) * perPage);
    const list = pageMembers.map((member, index) => `**${index + 1 + currentPage * perPage}.** ${member.displayName} (<@${member.id}>)`).join('\n') || 'لا يوجد أعضاء حالياً.';

    const options = pageMembers.map(member => ({
      label: member.displayName.slice(0, 100),
      value: member.id
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`myrole_members_select_${sessionId}`)
      .setPlaceholder('اختر الأعضاء لعرض التفاصيل...')
      .setMinValues(1)
      .setMaxValues(Math.min(25, options.length || 1));

    if (options.length) {
      selectMenu.addOptions(options);
    } else {
      selectMenu.addOptions([{ label: 'لا يوجد أعضاء', value: 'none' }]).setDisabled(true);
    }

    const components = [new ActionRowBuilder().addComponents(selectMenu)];
    if (members.length > perPage) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`myrole_members_prev_${sessionId}`)
          .setLabel('السابق')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId(`myrole_members_next_${sessionId}`)
          .setLabel('التالي')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      ));
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 أعضاء الرول')
      .setDescription(list)
      .setFooter({ text: `صفحة ${currentPage + 1}/${totalPages} | إجمالي الأعضاء: ${members.length}` })
      .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
      .setThumbnail(channel.client.user.displayAvatarURL({ size: 128 }));

    if (detailsText) {
      embed.addFields({ name: 'تفاصيل المحددين', value: detailsText.slice(0, 1024), inline: false });
    }

    return { embeds: [embed], components };
  };

  const infoMessage = interaction
    ? await respondEphemeralWithMessage(interaction, buildPayload())
    : await channel.send(buildPayload());
  if (!infoMessage) return;
  if (!interaction) {
    scheduleDelete(infoMessage);
  }

  const collector = infoMessage.createMessageComponentCollector({
    filter: i => i.user.id === (interaction?.user?.id || roleEntry?.ownerId),
    time: 60000
  });

  collector.on('collect', async selection => {
    if (selection.isButton()) {
      if (selection.customId === `myrole_members_prev_${sessionId}`) currentPage = Math.max(0, currentPage - 1);
      if (selection.customId === `myrole_members_next_${sessionId}`) currentPage += 1;
      await selection.update(buildPayload()).catch(() => {});
      return;
    }

    if (selection.isStringSelectMenu() && selection.customId === `myrole_members_select_${sessionId}`) {
      if (selection.values.includes('none')) {
        await selection.update(buildPayload()).catch(() => {});
        return;
      }
      const now = Date.now();
      const details = [];
      for (const id of selection.values) {
        const member = await role.guild.members.fetch(id).catch(() => null);
        if (!member) continue;
        const meta = roleEntry?.memberMeta?.[member.id];
        const assignedAt = meta?.assignedAt
          ? moment(meta.assignedAt).tz('Asia/Riyadh').format('YYYY-MM-DD HH:mm')
          : 'غير معروف';
        const since = meta?.assignedAt ? formatDurationShort(now - meta.assignedAt) : 'غير معروف';
        const assignedBy = meta?.assignedBy
          ? (meta.assignedByIsBot ? 'بوت' : `<@${meta.assignedBy}>`)
          : 'غير معروف';
        details.push(`**${member.displayName}** (<@${member.id}>)\n• حصل على الرول: ${assignedAt}\n• منذ: ${since}\n• بواسطة: ${assignedBy}`);
      }
      detailsText = details.join('\n\n') || null;
      await selection.update(buildPayload()).catch(() => {});
    }
  });

  collector.on('end', async () => {
    await infoMessage.edit({ components: [], embeds: buildPayload().embeds }).catch(() => {});
  });
}

async function handleTransfer({ channel, userId, role, roleEntry, interaction, panelMessage }) {
  if (!role.editable) {
    if (interaction) {
      await respondEphemeral(interaction, { content: '**❌ لا يمكن نقل الملكية بسبب صلاحيات البوت.**' });
    } else {
      await sendTemp(channel, '**❌ لا يمكن نقل الملكية بسبب صلاحيات البوت.**');
    }
    return;
  }
  const transferMenu = new UserSelectMenuBuilder()
    .setCustomId(`myrole_transfer_select_${Date.now()}`)
    .setPlaceholder('اختر المالك الجديد...')
    .setMinValues(1)
    .setMaxValues(1);

  const transferPayload = {
    content: '**اختر المالك الجديد:**',
    components: [new ActionRowBuilder().addComponents(transferMenu)]
  };
  const transferMessage = interaction
    ? await respondEphemeralWithMessage(interaction, transferPayload)
    : await channel.send(transferPayload);
  if (!interaction) {
    scheduleDelete(transferMessage);
  }

  const selection = await transferMessage.awaitMessageComponent({
    filter: i => i.user.id === userId,
    time: 60000
  }).catch(() => null);

  if (!selection) return;
  const mentionId = selection.values[0];
  await selection.update({ content: '**تم اختيار المالك الجديد.**', components: [] }).catch(() => {});

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`myrole_transfer_confirm_${Date.now()}`).setLabel('تأكيد').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`myrole_transfer_cancel_${Date.now()}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
  );
  const confirmPayload = { content: '**هل تريد تأكيد نقل الملكية؟**', components: [row] };
  const confirmMessage = interaction
    ? await respondEphemeralWithMessage(interaction, confirmPayload)
    : await channel.send(confirmPayload);
  if (!interaction) {
    scheduleDelete(confirmMessage);
  }

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
      await sendTemp(channel, '**❌ العضو غير موجود.**');
    }
    return;
  }

  const previousOwnerId = roleEntry.ownerId;
  roleEntry.ownerId = mentionId;
  roleEntry.updatedAt = Date.now();
  setMemberAssignment(roleEntry, mentionId, userId, interaction?.user?.bot);
  addRoleEntry(role.id, roleEntry);
  await newOwner.roles.add(role, 'نقل ملكية رول خاص').catch(() => {});
  if (panelMessage) {
    const refreshed = buildControlEmbed(roleEntry, role, role.members.size);
    await panelMessage.edit({ embeds: [refreshed], components: panelMessage.components }).catch(() => {});
  }
  if (interaction) {
    await respondEphemeral(interaction, { content: '**✅ تم نقل ملكية الرول.**' });
  } else {
    await sendTemp(channel, '**✅ تم نقل ملكية الرول.**');
  }
  await logRoleAction(role.guild, 'تم نقل ملكية رول خاص.', [
    { name: 'الرول', value: `<@&${role.id}>`, inline: true },
    { name: 'المالك الجديد', value: `<@${mentionId}>`, inline: true },
    { name: 'المالك السابق', value: `<@${previousOwnerId}>`, inline: true }
  ]);
}

async function startMyRoleFlow({ member, channel, client }) {
  if (activeRolePanels.has(member.id)) {
    await sendTemp(channel, '**⚠️ لديك لوحة مفتوحة بالفعل.**');
    return;
  }
  const roleEntry = findRoleByOwner(member.guild.id, member.id);
  if (!roleEntry) {
    await sendTemp(channel, '**❌ ليس لديك رول خاص.**');
    return;
  }

  const role = member.guild.roles.cache.get(roleEntry.roleId);
  if (!role) {
    await sendTemp(channel, '**❌ لم يتم العثور على الرول في السيرفر.**');
    return;
  }

  const botMember = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!botMember || !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await sendTemp(channel, '**❌ البوت يحتاج صلاحية Manage Roles لإدارة الرولات.**');
    return;
  }

  const membersCount = role.members.size;
  const embed = buildControlEmbed(roleEntry, role, membersCount);

  const sessionId = `${member.id}_${Date.now()}`;
  const sentMessage = await channel.send({ embeds: [embed], components: buildControlComponents(sessionId) });
  scheduleDelete(sentMessage);
  activeRolePanels.set(member.id, sentMessage.id);
  setTimeout(() => {
    if (activeRolePanels.get(member.id) === sentMessage.id) {
      activeRolePanels.delete(member.id);
    }
  }, 240000);

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === member.id,
    time: 180000
  });

  collector.on('collect', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('myrole_action_')) {
      const session = interaction.customId.split('_').slice(2).join('_');
      if (session !== sessionId) return;
      const action = interaction.values[0];

      if (action === 'name') {
        await interaction.deferUpdate();
        await handleNameChange({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
        return;
      }

      if (action === 'color') {
        await handleColorChange({ interaction, role, roleEntry, panelMessage: sentMessage });
        return;
      }

      if (action === 'icon') {
        await interaction.deferUpdate();
        await handleIconChange({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
        return;
      }

      if (action === 'manage') {
        await interaction.deferUpdate();
        if (!role.editable) {
          await respondEphemeral(interaction, { content: '**❌ لا يمكن تعديل الأعضاء بسبب صلاحيات البوت.**' });
          return;
        }
        await handleManageMembers({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
        return;
      }

      if (action === 'members') {
        await interaction.deferUpdate();
        await handleMembersList({ channel, role, interaction, roleEntry });
        return;
      }

      if (action === 'transfer') {
        await interaction.deferUpdate();
        await handleTransfer({ channel, userId: member.id, role, roleEntry, interaction, panelMessage: sentMessage });
        return;
      }
    }

    const parts = interaction.customId.split('_');
    const action = parts[1];
    const session = parts.slice(2).join('_');
    if (session !== sessionId) return;

    if (action === 'close') {
      await interaction.update({ content: '**تم إغلاق لوحة التحكم.**', embeds: [], components: [] });
      collector.stop('closed');
      return;
    }

    if (action === 'delete') {
      await interaction.deferUpdate();
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`myrole_delete_confirm_${sessionId}`).setLabel('تأكيد الحذف').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`myrole_delete_cancel_${sessionId}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
      );
      const confirmMessage = await respondEphemeralWithMessage(interaction, {
        content: '**هل أنت متأكد من حذف الرول الخاص؟**',
        components: [confirmRow]
      });
      const confirmation = await confirmMessage.awaitMessageComponent({
        filter: i => i.user.id === member.id,
        time: 60000
      }).catch(() => null);
      if (!confirmation) return;

      if (confirmation.customId === `myrole_delete_cancel_${sessionId}`) {
        await confirmation.update({ content: 'تم إلغاء الحذف.', components: [] }).catch(() => {});
        return;
      }

      const targetRole = role.guild.roles.cache.get(role.id);
      if (targetRole && !targetRole.editable) {
        await confirmation.update({ content: '❌ لا يمكن حذف الرول بسبب صلاحيات البوت.', components: [] }).catch(() => {});
        return;
      }
      if (targetRole) {
        await targetRole.delete(`حذف رول خاص بواسطة المالك ${member.user.tag}`).catch(() => {});
      }
      deleteRoleEntry(role.id, member.id);
      await confirmation.update({ content: '✅ تم حذف الرول الخاص بنجاح.', components: [] }).catch(() => {});
      await sentMessage.edit({ components: [], content: '**تم حذف الرول.**', embeds: [] }).catch(() => {});
    }
  });

  collector.on('end', async (_collected, reason) => {
    activeRolePanels.delete(member.id);
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
    await handleMembersList({ channel: interaction.channel, role, interaction, roleEntry });
    return;
  }
  if (action === 'name') {
    await interaction.deferReply({ ephemeral: true });
    await handleNameChange({ channel: interaction.channel, userId: member.id, role, roleEntry, interaction });
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

async function runRoleAction({ interaction, action, roleEntry, role, panelMessage }) {
  if (action === 'members') {
    await handleMembersList({ channel: interaction.channel, role, interaction, roleEntry });
    return;
  }
  if (action === 'name') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    await handleNameChange({ channel: interaction.channel, userId: interaction.user.id, role, roleEntry, interaction, panelMessage });
    return;
  }
  if (action === 'color') {
    await handleColorChange({ interaction, role, roleEntry, panelMessage });
    return;
  }
  if (action === 'icon') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    await handleIconChange({ channel: interaction.channel, userId: interaction.user.id, role, roleEntry, interaction, panelMessage });
    return;
  }
  if (action === 'transfer') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    await handleTransfer({ channel: interaction.channel, userId: interaction.user.id, role, roleEntry, interaction, panelMessage });
    return;
  }
  if (action === 'manage') {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    await handleManageMembers({ channel: interaction.channel, userId: interaction.user.id, role, roleEntry, interaction, panelMessage });
    return;
  }

  await respondEphemeral(interaction, { content: '❌ خيار غير معروف.' });
}

module.exports = { name, aliases, execute, startMyRoleFlow, handleMemberAction, runRoleAction };
