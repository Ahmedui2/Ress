const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const colorManager = require('../utils/colorManager');
const { ticketManager } = require('../utils/ticketManager');
const interactionRouter = require('../utils/interactionRouter');

const name = 'ticket';

const DEFAULT_SETTINGS = {
  enabled: true,
  panel_channel_id: null,
  panel_message_id: null,
  panel_configs: [],
  panel_style: 'menu',
  use_embed: true,
  default_category_id: null,
  log_channel_id: null,
  transcript_channel_id: null,
  ticket_numbering: true,
  max_open_tickets: 1,
  max_claimed_tickets: 0,
  cooldown_seconds: 300,
  require_claim: false,
  hide_after_claim: false,
  allow_user_add: true,
  allow_user_remove: true,
  allow_user_rename: true,
  acceptance_mode: 'channel',
  allow_other_reason: true,
  other_reason_label: 'سبب آخر',
  other_reason_prompt: 'اكتب سبب التكت بالتفصيل',
  ticket_mention_template: '<@{userId}>',
  acceptance_mention_template: '{admins}',
  ticket_embed_title: '🎫 تم فتح التكت',
  ticket_embed_description: '**السبب:** {reason}\\n**العميل:** <@{userId}>',
  ticket_embed_thumbnail: null,
  ticket_embed_image: null,
  panel_embed_thumbnail: null,
  panel_embed_image: null,
  acceptance_embed_title: '📥 تكت جديد بانتظار الاستلام',
  acceptance_embed_description: '{message}\\n**الروم:** <#{channelId}>',
  acceptance_channel_thumbnail: null,
  acceptance_channel_image: null,
  acceptance_inside_thumbnail: null,
  acceptance_inside_image: null,
  close_action: 'delete',
  closed_category_id: null,
  button_config: {
    claim: { label: 'استلام', emoji: null, style: 'Primary', enabled: true },
    add_user: { label: 'إضافة عضو', emoji: null, style: 'Secondary', enabled: true },
    remove_user: { label: 'حذف عضو', emoji: null, style: 'Secondary', enabled: true },
    rename: { label: 'تغيير الاسم', emoji: null, style: 'Secondary', enabled: true },
    transfer: { label: 'تحويل المسؤولية', emoji: null, style: 'Secondary', enabled: true },
    close: { label: 'إغلاق', emoji: null, style: 'Danger', enabled: true }
  }
};

const ticketSessions = new Map();

function isAdminMember(member, adminRoleIds, BOT_OWNERS) {
  if (!member) return false;
  return (
    BOT_OWNERS.includes(member.id) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    adminRoleIds.some(roleId => member.roles.cache.has(roleId))
  );
}

async function getSettings() {
  const stored = await ticketManager.getAllSettings();
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function setSettings(updates) {
  for (const [key, value] of Object.entries(updates)) {
    await ticketManager.setSetting(key, value);
  }
}

function buildSettingsEmbed(settings, guild, adminRoles, reasons) {
  const panelChannel = settings.panel_channel_id ? `<#${settings.panel_channel_id}>` : 'غير محدد';
  const categoryChannel = settings.default_category_id ? `<#${settings.default_category_id}>` : 'غير محدد';
  const logChannel = settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'غير محدد';
  const transcriptChannel = settings.transcript_channel_id ? `<#${settings.transcript_channel_id}>` : 'غير محدد';
  const closedCategory = settings.closed_category_id ? `<#${settings.closed_category_id}>` : 'غير محدد';
  const adminRoleText = adminRoles.length > 0 ? adminRoles.map(r => `<@&${r.role_id}>`).join(', ') : 'غير محدد';
  const statusText = settings.enabled ? '✅ مفعل' : '⛔ متوقف';
  const acceptanceModeText = settings.acceptance_mode === 'inside' ? 'داخل التكت' : 'روم الاستلام';
  const otherReasonText = settings.allow_other_reason ? 'مفعل' : 'معطل';
  const panelsCount = settings.panel_configs?.length ? settings.panel_configs.length : 0;
  const embedText = settings.use_embed ? 'مفعل' : 'معطل';
  const claimLimitText = settings.max_claimed_tickets > 0 ? `${settings.max_claimed_tickets}` : 'بدون حد';
  const closeActionText = settings.close_action === 'archive' ? 'احتفاظ بالتكت' : 'حذف بعد الإغلاق';

  return colorManager.createEmbed()
    .setTitle('🎫 إعدادات نظام التكت')
    .setDescription('نظام متكامل لإدارة التذاكر مع تخصيص كامل لكل جزء.')
    .addFields(
      { name: 'الحالة', value: statusText, inline: true },
      { name: 'لوحة التذاكر', value: panelChannel, inline: true },
      { name: 'كاتقوري التذاكر', value: categoryChannel, inline: true },
      { name: 'رولات الإدارة', value: adminRoleText, inline: false },
      { name: 'اللوق', value: logChannel, inline: true },
      { name: 'الترانسكربت', value: transcriptChannel, inline: true },
      { name: 'عدد الأسباب', value: `${reasons.length}`, inline: true },
      { name: 'طريقة الاستلام', value: acceptanceModeText, inline: true },
      { name: 'سبب آخر', value: otherReasonText, inline: true },
      { name: 'عدد اللوحات', value: `${panelsCount}`, inline: true },
      { name: 'الإيمبد', value: embedText, inline: true },
      { name: 'الحد الأعلى للتكتات', value: `${settings.max_open_tickets}`, inline: true },
      { name: 'حد استلام الإدارة', value: claimLimitText, inline: true },
      { name: 'الكولداون', value: `${settings.cooldown_seconds} ثانية`, inline: true },
      { name: 'الترقيم', value: settings.ticket_numbering ? 'مفعل' : 'معطل', inline: true },
      { name: 'إغلاق التكت', value: closeActionText, inline: true },
      { name: 'كاتقوري المقفلة', value: closedCategory, inline: true }
    )
    .setFooter({ text: guild ? `السيرفر: ${guild.name}` : 'Ticket System' });
}

function buildMainComponents(sessionId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_settings_toggle_${sessionId}`)
      .setLabel('تشغيل/إيقاف')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_panel_${sessionId}`)
      .setLabel('لوحة التذاكر')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_reasons_${sessionId}`)
      .setLabel('أسباب التكت')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_permissions_${sessionId}`)
      .setLabel('الصلاحيات')
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_settings_logs_${sessionId}`)
      .setLabel('اللوق والنسخ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_limits_${sessionId}`)
      .setLabel('الحدود والكولداون')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_behavior_${sessionId}`)
      .setLabel('السلوك')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_help_${sessionId}`)
      .setLabel('شرح الأزرار')
      .setStyle(ButtonStyle.Success)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_settings_messages_${sessionId}`)
      .setLabel('تخصيص الرسائل')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_buttons_${sessionId}`)
      .setLabel('تخصيص الأزرار')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ticket_settings_panels_${sessionId}`)
      .setLabel('لوحات متعددة')
      .setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_settings_embed_${sessionId}`)
      .setLabel('ايمبد')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3, row4];
}

function buildBackRow(sessionId, target = 'main') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_settings_back:${target}:${sessionId}`)
      .setLabel('رجوع')
      .setStyle(ButtonStyle.Secondary)
  );
}

function parseSessionId(customId) {
  const parts = customId.split(/[_:]/);
  return parts[parts.length - 1];
}

function parseUserId(input) {
  if (!input) return null;
  const match = input.match(/\d{17,20}/);
  return match ? match[0] : null;
}

function applyTemplate(text, params) {
  if (!text) return text;
  return Object.entries(params).reduce((output, [key, value]) => {
    const safeValue = value ?? '';
    return output.replaceAll(`{${key}}`, safeValue);
  }, text);
}

function resolveButtonStyle(style) {
  const mapping = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger
  };
  return mapping[String(style || '').toLowerCase()] || ButtonStyle.Secondary;
}

function buildActionButton(actionKey, config, customId) {
  if (!config?.enabled) return null;
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(config.label || actionKey)
    .setStyle(resolveButtonStyle(config.style));
  if (config.emoji) button.setEmoji(config.emoji);
  return button;
}

async function applyResponsibilityPermissions(channel, responsibilityConfig) {
  if (!responsibilityConfig) return;
  const roleIds = responsibilityConfig.roles || [];
  const userIds = responsibilityConfig.responsibles || [];

  for (const roleId of roleIds) {
    await channel.permissionOverwrites.edit(roleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }).catch(() => {});
  }

  for (const userId of userIds) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }).catch(() => {});
  }
}

function parseFormSchema(text) {
  if (!text) return [];
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [label, requiredRaw, minRaw, maxRaw, placeholder] = line.split('|').map(value => value.trim());
    return {
      label,
      required: ['yes', 'true', '1', 'نعم'].includes((requiredRaw || '').toLowerCase()),
      min: minRaw ? parseInt(minRaw, 10) : null,
      max: maxRaw ? parseInt(maxRaw, 10) : null,
      placeholder: placeholder || null
    };
  }).filter(field => field.label);
}

function buildFormModal(reason, panelId) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_reason_form:${reason.reason_id}:${panelId}`)
    .setTitle(`نموذج: ${reason.reason_name}`);
  const fields = Array.isArray(reason.form_schema) ? reason.form_schema : [];
  const rows = fields.slice(0, 5).map((field, index) => {
    const input = new TextInputBuilder()
      .setCustomId(`form_field_${index}`)
      .setLabel(field.label.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setRequired(Boolean(field.required));
    if (field.placeholder) {
      input.setPlaceholder(field.placeholder);
    }
    if (field.max) {
      input.setMaxLength(field.max);
    }
    if (field.min) {
      input.setMinLength(field.min);
    }
    return new ActionRowBuilder().addComponents(input);
  });
  modal.addComponents(...rows);
  return modal;
}

function formatFormResponses(schema, responses) {
  if (!schema?.length) return '';
  const lines = schema.map((field, index) => {
    const value = responses[index] || '—';
    return `**${field.label}:** ${value}`;
  });
  return lines.join('\n');
}

function buildRatingComponents(ticketId, disabled = false) {
  const options = [
    { value: -2, label: '-2', style: ButtonStyle.Danger },
    { value: -1, label: '-1', style: ButtonStyle.Danger },
    { value: 0, label: '0', style: ButtonStyle.Secondary },
    { value: 1, label: '+1', style: ButtonStyle.Success },
    { value: 2, label: '+2', style: ButtonStyle.Success }
  ];
  const buttons = options.map(option => new ButtonBuilder()
    .setCustomId(`ticket_rate:${ticketId}:${option.value}`)
    .setLabel(option.label)
    .setStyle(option.style)
    .setDisabled(disabled));
  return [new ActionRowBuilder().addComponents(buttons)];
}

async function finalizeTicketClose(interaction, ticket) {
  const settings = await getSettings();
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const adminRoles = await ticketManager.getAdminRoles();
  const isAdmin = member && isAdminMember(member, adminRoles.map(r => r.role_id), global.BOT_OWNERS || []);

  let transcriptPath = null;
  if (settings.transcript_channel_id) {
    transcriptPath = await ticketManager.createTranscript(interaction.channel);
    const transcriptChannel = await interaction.guild.channels.fetch(settings.transcript_channel_id).catch(() => null);
    if (transcriptChannel && transcriptPath) {
      await transcriptChannel.send({
        content: `📄 نسخة التكت: <#${interaction.channel.id}>`,
        files: [transcriptPath]
      }).catch(() => {});
    }
  }

  await ticketManager.closeTicket(ticket.ticket_id, interaction.user.id);
  await ticketManager.logTicket({
    ticketId: ticket.ticket_id,
    userId: ticket.user_id,
    staffId: isAdmin ? interaction.user.id : null,
    reasonId: ticket.reason_id,
    pointsGiven: isAdmin ? 1 : 0,
    actionType: 'closed',
    transcriptPath
  });

  if (settings.log_channel_id) {
    const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (logChannel) {
      const closeEmbed = colorManager.createEmbed()
        .setTitle('🔒 تم إغلاق تكت')
        .setDescription(`**الروم:** <#${interaction.channel.id}>\n**بواسطة:** <@${interaction.user.id}>`)
        .setFooter({ text: `ID: ${ticket.ticket_id}` });
      await logChannel.send({ embeds: [closeEmbed] }).catch(() => {});
    }
  }

  if (isAdmin) {
    await ticketManager.givePoints(interaction.user.id, 1);
  }

  const ratedUserId = ticket.claimed_by || ticket.closed_by || interaction.user.id;
  const ratingPrompt = `🧾 يرجى تقييم التكت: <@${ratedUserId}>`;
  if (settings.log_channel_id) {
    const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (logChannel) {
      await logChannel.send({
        content: ratingPrompt,
        components: buildRatingComponents(ticket.ticket_id)
      }).catch(() => {});
    }
  } else if (settings.transcript_channel_id) {
    const transcriptChannel = await interaction.guild.channels.fetch(settings.transcript_channel_id).catch(() => null);
    if (transcriptChannel) {
      await transcriptChannel.send({
        content: ratingPrompt,
        components: buildRatingComponents(ticket.ticket_id)
      }).catch(() => {});
    }
  } else if (settings.close_action === 'archive' && settings.closed_category_id) {
    await interaction.channel.send({
      content: ratingPrompt,
      components: buildRatingComponents(ticket.ticket_id)
    }).catch(() => {});
  }

  await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: false
  }).catch(() => {});

  if (ticket.claimed_by) {
    await interaction.channel.permissionOverwrites.edit(ticket.claimed_by, {
      ViewChannel: false
    }).catch(() => {});
  }

  if (settings.close_action === 'archive' && settings.closed_category_id) {
    await interaction.channel.setParent(settings.closed_category_id, { lockPermissions: false }).catch(() => {});
    if (!interaction.channel.name.startsWith('closed-')) {
      await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100)).catch(() => {});
    }
    const everyoneRole = interaction.guild.roles.everyone?.id;
    if (everyoneRole) {
      await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false }).catch(() => {});
    }
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true
    }).catch(() => {});
    for (const roleData of adminRoles) {
      await interaction.channel.permissionOverwrites.edit(roleData.role_id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }
  } else {
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 5000);
  }
}

async function sendOrUpdatePanel(guild, settings, reasons, panelConfig = null) {
  const targetChannelId = panelConfig?.channel_id || settings.panel_channel_id;
  if (!targetChannelId) {
    return { success: false, message: 'يرجى تحديد روم لوحة التذاكر أولاً.' };
  }

  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel) {
    return { success: false, message: 'تعذر العثور على روم لوحة التذاكر.' };
  }

  const panelTitle = panelConfig?.title || '🎫 فتح تذكرة';
  const panelDescription = panelConfig?.description || 'اختر سبب التذكرة من القائمة لفتح تكت جديد.';

  const filteredReasons = panelConfig?.reason_ids?.length
    ? reasons.filter(reason => panelConfig.reason_ids.includes(reason.reason_id))
    : reasons;

  let panelEmbed = null;
  if (settings.use_embed) {
    panelEmbed = colorManager.createEmbed()
      .setTitle(panelTitle)
      .setDescription(panelDescription)
      .setFooter({ text: `عدد الأسباب المتاحة: ${filteredReasons.length}` });
    if (settings.panel_embed_thumbnail) {
      panelEmbed.setThumbnail(settings.panel_embed_thumbnail);
    }
    if (settings.panel_embed_image) {
      panelEmbed.setImage(settings.panel_embed_image);
    }
  }

  const options = filteredReasons.slice(0, 24).map(reason => ({
    label: reason.reason_name,
    description: reason.reason_description ? reason.reason_description.slice(0, 80) : 'بدون وصف',
    value: reason.reason_id,
    emoji: reason.reason_emoji || '🎫'
  }));

  if (settings.allow_other_reason) {
    options.push({
      label: settings.other_reason_label || 'سبب آخر',
      description: 'اكتب السبب الخاص بك عبر نموذج سريع',
      value: 'other_reason',
      emoji: '📝'
    });
  }

  const panelStyle = panelConfig?.panel_style || settings.panel_style || 'menu';
  let components = [];

  if (panelStyle === 'buttons') {
    let buttonOptions = options.slice(0, 5);
    const otherOption = options.find(option => option.value === 'other_reason');
    if (otherOption && !buttonOptions.some(option => option.value === 'other_reason')) {
      buttonOptions[buttonOptions.length - 1] = otherOption;
    }
    const buttonItems = buttonOptions.map(option => {
      const button = new ButtonBuilder()
        .setCustomId(`ticket_open_button:${panelConfig?.id || 'default'}:${option.value}`)
        .setLabel(option.label)
        .setStyle(ButtonStyle.Primary);
      if (option.emoji) button.setEmoji(option.emoji);
      return button;
    });
    if (buttonItems.length) {
      components.push(new ActionRowBuilder().addComponents(buttonItems));
    }
  } else {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_open_select:${panelConfig?.id || 'default'}`)
      .setPlaceholder('اختر سبب التذكرة')
      .setDisabled(options.length === 0)
      .addOptions(options.length ? options : [{ label: 'لا توجد أسباب', value: 'no_reasons' }]);
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const panelMessageId = panelConfig?.message_id || settings.panel_message_id;
  const panelPayload = panelEmbed
    ? { embeds: [panelEmbed], components }
    : { content: `**${panelTitle}**\n${panelDescription}`, components };

  if (panelMessageId) {
    const existingMessage = await channel.messages.fetch(panelMessageId).catch(() => null);
    if (existingMessage) {
      await existingMessage.edit(panelPayload);
      return { success: true, message: 'تم تحديث لوحة التذاكر.' };
    }
  }

  const sent = await channel.send(panelPayload);
  if (panelConfig) {
    panelConfig.message_id = sent.id;
    await setSettings({ panel_configs: settings.panel_configs });
  } else {
    await setSettings({ panel_message_id: sent.id });
  }
  return { success: true, message: 'تم إرسال لوحة التذاكر بنجاح.' };
}

async function updateSessionMessage(interaction, sessionId, embed, components) {
  const session = ticketSessions.get(sessionId);
  if (!session) return;
  await interaction.update({ embeds: [embed], components });
}

async function handleSettingsHelp(interaction, sessionId) {
  const embed = colorManager.createEmbed()
    .setTitle('شرح أزرار إعدادات التكت')
    .setDescription('ملخص سريع لكل زر في لوحة الإعدادات.')
    .addFields(
      { name: 'تشغيل/إيقاف', value: 'تفعيل أو تعطيل النظام بالكامل.', inline: false },
      { name: 'لوحة التذاكر', value: 'تحديد روم اللوحة وإرسال/تحديث رسالة فتح التكت.', inline: false },
      { name: 'أسباب التكت', value: 'إضافة/تعديل/حذف أسباب التكت مع إعدادات مخصصة لكل سبب.', inline: false },
      { name: 'الصلاحيات', value: 'تحديد رولات الإدارة التي ترى وتدير التكتات.', inline: false },
      { name: 'اللوق والنسخ', value: 'تحديد روم اللوق وروم الترانسكربت.', inline: false },
      { name: 'الحدود والكولداون', value: 'تحديد عدد التكتات المسموح بها والكولداون وحد استلام الإدارة.', inline: false },
      { name: 'السلوك', value: 'خيارات مثل طلب الاستلام، الإخفاء بعد الاستلام، وإعدادات إغلاق التكت.', inline: false },
      { name: 'تخصيص الرسائل', value: 'تغيير شكل الإيمبدات والمنشن وسبب آخر.', inline: false },
      { name: 'تخصيص الأزرار', value: 'تعديل اسم وإيموجي وستايل أزرار التكت.', inline: false },
      { name: 'لوحات متعددة', value: 'إضافة لوحات تكت متعددة برومات مختلفة.', inline: false },
      { name: 'ايمبد', value: 'تفعيل/تعطيل الإيمبد (نصي بالكامل عند الإيقاف).', inline: false },
      { name: 'صور اللوحة/الاستلام', value: 'تخصيص صور اللوحة وصور الاستلام (روم/داخل).', inline: false }
    );

  await updateSessionMessage(interaction, sessionId, embed, [buildBackRow(sessionId, 'main')]);
}

async function handleTicketOpen(interaction, panelId = 'default', selectedValue = null) {
  const settings = await getSettings();
  if (!settings.enabled) {
    await interaction.reply({ content: '⛔ نظام التكت متوقف حالياً.', flags: MessageFlags.Ephemeral });
    return;
  }

  const selectedReason = selectedValue ?? interaction.values?.[0];
  if (selectedReason === 'no_reasons') {
    await interaction.reply({ content: 'لا توجد أسباب متاحة للتكت حالياً.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (selectedReason === 'other_reason') {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_other_reason:${panelId}`)
      .setTitle('سبب التكت');
    const input = new TextInputBuilder()
      .setCustomId('ticket_other_reason_value')
      .setLabel(settings.other_reason_prompt || 'اكتب سبب التكت بالتفصيل')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  const reason = await ticketManager.getReason(selectedReason);
  if (!reason) {
    await interaction.reply({ content: '❌ السبب غير موجود أو تم حذفه.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (Array.isArray(reason.form_schema) && reason.form_schema.length > 0) {
    const modal = buildFormModal(reason, panelId);
    await interaction.showModal(modal);
    return;
  }

  const blocked = await ticketManager.isUserBlocked(interaction.user.id);
  if (blocked) {
    const info = await ticketManager.getBlockInfo(interaction.guild.id, interaction.user.id);
    await interaction.reply({
      content: `🚫 أنت محظور من فتح التكت.\n${info?.reason ? `**السبب:** ${info.reason}` : ''}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const openTickets = await ticketManager.getUserOpenTickets(interaction.guild.id, interaction.user.id);
  if (openTickets.length >= settings.max_open_tickets) {
    await interaction.reply({
      content: `⚠️ لديك بالفعل ${openTickets.length} تكت مفتوح. الحد الأعلى: ${settings.max_open_tickets}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const cooldownInfo = await ticketManager.checkCooldown(interaction.user.id, 'ticket_open');
  if (cooldownInfo.onCooldown) {
    await interaction.reply({
      content: `⏳ يرجى الانتظار ${cooldownInfo.remaining} ثانية قبل فتح تكت جديد.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const result = await ticketManager.createTicket(interaction.guild, interaction.user, reason, null, { panelId });
  if (!result) {
    await interaction.reply({ content: '❌ حدث خطأ أثناء إنشاء التكت.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (reason.role_to_give) {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (member) {
      await member.roles.add(reason.role_to_give).catch(() => {});
    }
  }

  const templateParams = {
    userId: interaction.user.id,
    user: interaction.user.username,
    reason: reason.reason_name,
    channelId: result.channel.id,
    number: result.ticketNumber,
    panelId,
    fields: ''
  };

  let ticketEmbed = null;
  if (settings.use_embed) {
    ticketEmbed = colorManager.createEmbed()
      .setTitle(applyTemplate(settings.ticket_embed_title, templateParams))
      .setDescription(applyTemplate(settings.ticket_embed_description, templateParams))
      .setFooter({ text: `رقم التكت: ${result.ticketNumber}` });

    if (settings.ticket_embed_thumbnail) {
      ticketEmbed.setThumbnail(applyTemplate(settings.ticket_embed_thumbnail, templateParams));
    }
    if (settings.ticket_embed_image) {
      ticketEmbed.setImage(applyTemplate(settings.ticket_embed_image, templateParams));
    }
  }

  const buttons = [];
  const buttonConfig = settings.button_config || DEFAULT_SETTINGS.button_config;
  const claimButton = buildActionButton('claim', buttonConfig.claim, 'ticket_action_claim');
  const addButton = buildActionButton('add_user', buttonConfig.add_user, 'ticket_action_add_user');
  const removeButton = buildActionButton('remove_user', buttonConfig.remove_user, 'ticket_action_remove_user');
  const renameButton = buildActionButton('rename', buttonConfig.rename, 'ticket_action_rename');
  const transferButton = buildActionButton('transfer', buttonConfig.transfer, 'ticket_action_transfer');
  const closeButton = buildActionButton('close', buttonConfig.close, 'ticket_action_close');

  [claimButton, addButton, removeButton, renameButton, transferButton, closeButton].forEach(button => {
    if (button) buttons.push(button);
  });

  const rows = [];
  if (buttons.length) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
    if (buttons.length > 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(5, 10)));
    }
  }

  const mentionText = applyTemplate(settings.ticket_mention_template, templateParams);
  const ticketPayload = settings.use_embed
    ? { content: mentionText, embeds: [ticketEmbed], components: rows }
    : { content: `${mentionText}\n${applyTemplate(settings.ticket_embed_description, templateParams)}`, components: rows };
  await result.channel.send(ticketPayload);

  if (reason.ticket_message) {
    await result.channel.send({ content: reason.ticket_message });
  }

  if (settings.log_channel_id) {
    const logChannel = await interaction.guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (logChannel) {
      const logEmbed = colorManager.createEmbed()
        .setTitle('📝 تكت جديد')
        .setDescription(`**السبب:** ${reason.reason_name}\n**العميل:** <@${interaction.user.id}>\n**الروم:** <#${result.channel.id}>`)
        .setFooter({ text: `رقم التكت: ${result.ticketNumber}` });
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  const acceptanceMode = reason.acceptance_mode || settings.acceptance_mode;
  if (acceptanceMode === 'channel' && reason.acceptance_channel_id) {
    const acceptanceChannel = await interaction.guild.channels.fetch(reason.acceptance_channel_id).catch(() => null);
    if (acceptanceChannel) {
      const adminRoles = await ticketManager.getAdminRoles();
      const mentions = adminRoles.length ? adminRoles.map(r => `<@&${r.role_id}>`).join(' ') : '';
      const messageText = reason.acceptance_message || 'تم فتح تكت جديد، يرجى الاستلام.';
      const acceptanceParams = {
        ...templateParams,
        message: messageText,
        admins: mentions
      };
      const mentionText = applyTemplate(settings.acceptance_mention_template, acceptanceParams);
      const claimButton = buildActionButton('claim', settings.button_config?.claim || DEFAULT_SETTINGS.button_config.claim, `ticket_accept_channel:${result.ticketId}`);
      const row = claimButton ? [new ActionRowBuilder().addComponents(claimButton)] : [];
      if (settings.use_embed) {
        const acceptEmbed = colorManager.createEmbed()
          .setTitle(applyTemplate(settings.acceptance_embed_title, acceptanceParams))
          .setDescription(applyTemplate(settings.acceptance_embed_description, acceptanceParams));
        if (settings.acceptance_channel_thumbnail) {
          acceptEmbed.setThumbnail(applyTemplate(settings.acceptance_channel_thumbnail, acceptanceParams));
        }
        if (settings.acceptance_channel_image) {
          acceptEmbed.setImage(applyTemplate(settings.acceptance_channel_image, acceptanceParams));
        }
        await acceptanceChannel.send({ content: mentionText, embeds: [acceptEmbed], components: row }).catch(() => {});
      } else {
        await acceptanceChannel.send({
          content: `${mentionText}\n${applyTemplate(settings.acceptance_embed_description, acceptanceParams)}`,
          components: row
        }).catch(() => {});
      }
    }
  }

  if (acceptanceMode === 'inside') {
    const messageText = reason.inside_ticket_message || reason.acceptance_message || 'يرجى استلام التكت عبر الزر أدناه.';
    const insideParams = { ...templateParams, message: messageText };
    if (settings.use_embed) {
      const insideEmbed = colorManager.createEmbed()
        .setTitle(applyTemplate(settings.acceptance_embed_title, insideParams))
        .setDescription(applyTemplate(settings.acceptance_embed_description, insideParams));
      if (settings.acceptance_inside_thumbnail) {
        insideEmbed.setThumbnail(applyTemplate(settings.acceptance_inside_thumbnail, insideParams));
      }
      if (settings.acceptance_inside_image) {
        insideEmbed.setImage(applyTemplate(settings.acceptance_inside_image, insideParams));
      }
      await result.channel.send({ embeds: [insideEmbed] }).catch(() => {});
    } else {
      await result.channel.send({ content: applyTemplate(settings.acceptance_embed_description, insideParams) }).catch(() => {});
    }
  }

  if (settings.cooldown_seconds > 0) {
    await ticketManager.addCooldown(interaction.guild.id, interaction.user.id, settings.cooldown_seconds * 1000);
  }

  await interaction.reply({
    content: `✅ تم فتح تكتك بنجاح: <#${result.channel.id}>`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleTicketAction(interaction, action) {
  const settings = await getSettings();
  const ticket = await ticketManager.getTicket(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: '❌ هذا الروم ليس تكت صالح.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const adminRoles = await ticketManager.getAdminRoles();
  const isAdmin = member && isAdminMember(member, adminRoles.map(r => r.role_id), global.BOT_OWNERS || []);
  const isOwner = ticket.user_id === interaction.user.id;
  const isClaimedByUser = ticket.claimed_by && ticket.claimed_by === interaction.user.id;

  if (settings.require_claim && ticket.claimed_by && !isClaimedByUser && !isAdmin) {
    await interaction.reply({ content: '⚠️ هذا التكت مستلم من مسؤول آخر.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'claim') {
    if (!isAdmin) {
      await interaction.reply({ content: '❌ ليس لديك صلاحية استلام التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (settings.max_claimed_tickets > 0) {
      const claimedCount = await ticketManager.countClaimedTickets(interaction.user.id);
      if (claimedCount >= settings.max_claimed_tickets) {
        await interaction.reply({
          content: `⚠️ وصلت للحد الأعلى لاستلام التكتات (${settings.max_claimed_tickets}).`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    await ticketManager.updateTicket(ticket.ticket_id, { claimed_by: interaction.user.id });
    if (settings.hide_after_claim) {
      const adminRoles = await ticketManager.getAdminRoles();
      for (const roleData of adminRoles) {
        await interaction.channel.permissionOverwrites.edit(roleData.role_id, {
          ViewChannel: false
        }).catch(() => {});
      }
      const reason = ticket.reason_id ? await ticketManager.getReason(ticket.reason_id) : null;
      if (reason?.display_roles) {
        for (const roleId of reason.display_roles) {
          await interaction.channel.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }).catch(() => {});
        }
      }
      if (ticket.responsibility && global.responsibilities?.[ticket.responsibility]) {
        await applyResponsibilityPermissions(interaction.channel, global.responsibilities[ticket.responsibility]);
      }
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }
    await interaction.reply({ content: `✅ تم استلام التكت بواسطة <@${interaction.user.id}>` });
    return;
  }

  if (action === 'close') {
    if (!isOwner && !isAdmin) {
      await interaction.reply({ content: '❌ لا يمكنك إغلاق هذا التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: '⏳ جاري إغلاق التكت وحفظ النسخة...', flags: MessageFlags.Ephemeral });
    await finalizeTicketClose(interaction, ticket);
    return;
  }

  if (action === 'add_user') {
    if (!settings.allow_user_add && !isAdmin) {
      await interaction.reply({ content: '❌ إضافة الأعضاء غير مسموحة حالياً.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isAdmin && !isOwner) {
      await interaction.reply({ content: '❌ لا يمكنك إضافة أعضاء لهذا التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_add_user')
      .setTitle('إضافة عضو للتكت');
    const input = new TextInputBuilder()
      .setCustomId('ticket_add_user_id')
      .setLabel('منشن أو آيدي العضو')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (action === 'remove_user') {
    if (!settings.allow_user_remove && !isAdmin) {
      await interaction.reply({ content: '❌ حذف الأعضاء غير مسموح حالياً.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isAdmin && !isOwner) {
      await interaction.reply({ content: '❌ لا يمكنك حذف أعضاء من هذا التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_remove_user')
      .setTitle('حذف عضو من التكت');
    const input = new TextInputBuilder()
      .setCustomId('ticket_remove_user_id')
      .setLabel('منشن أو آيدي العضو')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (action === 'rename') {
    if (!settings.allow_user_rename && !isAdmin) {
      await interaction.reply({ content: '❌ تغيير اسم التكت غير مسموح حالياً.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isAdmin && !isOwner) {
      await interaction.reply({ content: '❌ لا يمكنك تغيير اسم التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('ticket_modal_rename')
      .setTitle('تغيير اسم التكت');
    const input = new TextInputBuilder()
      .setCustomId('ticket_rename_value')
      .setLabel('الاسم الجديد (بدون #)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  if (action === 'transfer') {
    if (!isAdmin) {
      await interaction.reply({ content: '❌ لا يمكنك تحويل التكت.', flags: MessageFlags.Ephemeral });
      return;
    }
    const responsibilities = global.responsibilities || {};
    const keys = Object.keys(responsibilities);
    if (keys.length === 0) {
      await interaction.reply({ content: '⚠️ لا توجد مسؤوليات متاحة للتحويل.', flags: MessageFlags.Ephemeral });
      return;
    }
    const options = keys.slice(0, 25).map(key => ({
      label: key,
      description: responsibilities[key]?.description ? responsibilities[key].description.slice(0, 80) : 'بدون وصف',
      value: key
    }));
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_transfer_select')
      .setPlaceholder('اختر المسؤولية لتحويل التكت')
      .addOptions(options);
    await interaction.reply({
      content: 'اختر المسؤولية المطلوبة لتحويل التكت:',
      components: [new ActionRowBuilder().addComponents(selectMenu)],
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith('ticket_modal_other_reason:')) {
    const [, panelId] = interaction.customId.split(':');
    const customReason = interaction.fields.getTextInputValue('ticket_other_reason_value').trim();
    if (!customReason) {
      await interaction.reply({ content: '❌ يجب كتابة سبب التكت.', flags: MessageFlags.Ephemeral });
      return;
    }
    const settings = await getSettings();
    const reasonData = {
      reason_id: null,
      reason_name: customReason,
      reason_description: customReason,
      category_id: settings.default_category_id,
      acceptance_channel_id: null,
      acceptance_mode: settings.acceptance_mode,
      ticket_name_format: 't-{number}',
      ticket_message: null,
      acceptance_message: null,
      inside_ticket_message: null,
      form_schema: null,
      role_to_give: null,
      display_roles: []
    };

    const result = await ticketManager.createTicket(
      interaction.guild,
      interaction.user,
      reasonData,
      null,
      { panelId, customReason }
    );

    if (!result) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء إنشاء التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    const templateParams = {
      userId: interaction.user.id,
      user: interaction.user.username,
      reason: customReason,
      channelId: result.channel.id,
      number: result.ticketNumber,
      panelId
    };

    let ticketEmbed = null;
    if (settings.use_embed) {
      ticketEmbed = colorManager.createEmbed()
        .setTitle(applyTemplate(settings.ticket_embed_title, templateParams))
        .setDescription(applyTemplate(settings.ticket_embed_description, templateParams))
        .setFooter({ text: `رقم التكت: ${result.ticketNumber}` });

      if (settings.ticket_embed_thumbnail) {
        ticketEmbed.setThumbnail(applyTemplate(settings.ticket_embed_thumbnail, templateParams));
      }
      if (settings.ticket_embed_image) {
        ticketEmbed.setImage(applyTemplate(settings.ticket_embed_image, templateParams));
      }
    }

    const buttonConfig = settings.button_config || DEFAULT_SETTINGS.button_config;
    const buttons = [];
    const claimButton = buildActionButton('claim', buttonConfig.claim, 'ticket_action_claim');
    const addButton = buildActionButton('add_user', buttonConfig.add_user, 'ticket_action_add_user');
    const removeButton = buildActionButton('remove_user', buttonConfig.remove_user, 'ticket_action_remove_user');
    const renameButton = buildActionButton('rename', buttonConfig.rename, 'ticket_action_rename');
    const transferButton = buildActionButton('transfer', buttonConfig.transfer, 'ticket_action_transfer');
    const closeButton = buildActionButton('close', buttonConfig.close, 'ticket_action_close');

    [claimButton, addButton, removeButton, renameButton, transferButton, closeButton].forEach(button => {
      if (button) buttons.push(button);
    });

    const rows = [];
    if (buttons.length) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
      if (buttons.length > 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(5, 10)));
      }
    }
    const mentionText = applyTemplate(settings.ticket_mention_template, templateParams);

    const ticketPayload = settings.use_embed
      ? { content: mentionText, embeds: [ticketEmbed], components: rows }
      : { content: `${mentionText}\n${applyTemplate(settings.ticket_embed_description, templateParams)}`, components: rows };
    await result.channel.send(ticketPayload);
    if (settings.acceptance_mode === 'inside') {
      const insideParams = { ...templateParams, message: 'يرجى استلام التكت عبر الزر أدناه.' };
      if (settings.use_embed) {
        const insideEmbed = colorManager.createEmbed()
          .setTitle(applyTemplate(settings.acceptance_embed_title, insideParams))
          .setDescription(applyTemplate(settings.acceptance_embed_description, insideParams));
        if (settings.acceptance_inside_thumbnail) {
          insideEmbed.setThumbnail(applyTemplate(settings.acceptance_inside_thumbnail, insideParams));
        }
        if (settings.acceptance_inside_image) {
          insideEmbed.setImage(applyTemplate(settings.acceptance_inside_image, insideParams));
        }
        await result.channel.send({ embeds: [insideEmbed] }).catch(() => {});
      } else {
        await result.channel.send({ content: applyTemplate(settings.acceptance_embed_description, insideParams) }).catch(() => {});
      }
    }
    await interaction.reply({ content: `✅ تم فتح تكتك بنجاح: <#${result.channel.id}>`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'ticket_modal_add_user') {
    const userId = parseUserId(interaction.fields.getTextInputValue('ticket_add_user_id'));
    if (!userId) {
      await interaction.reply({ content: '❌ لم يتم العثور على آيدي صالح.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }).catch(() => {});
    await interaction.reply({ content: `✅ تم إضافة <@${userId}> للتكت.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'ticket_modal_remove_user') {
    const userId = parseUserId(interaction.fields.getTextInputValue('ticket_remove_user_id'));
    if (!userId) {
      await interaction.reply({ content: '❌ لم يتم العثور على آيدي صالح.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.permissionOverwrites.delete(userId).catch(() => {});
    await interaction.reply({ content: `✅ تم حذف <@${userId}> من التكت.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'ticket_modal_rename') {
    const newName = interaction.fields.getTextInputValue('ticket_rename_value').trim().toLowerCase();
    if (!newName) {
      await interaction.reply({ content: '❌ الاسم غير صالح.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.channel.setName(newName).catch(() => {});
    await interaction.reply({ content: `✅ تم تغيير اسم التكت إلى ${newName}.`, flags: MessageFlags.Ephemeral });
  }
}

async function handleSettingsInteraction(interaction, sessionId) {
  const session = ticketSessions.get(sessionId);
  if (!session) {
    await interaction.reply({ content: 'انتهت صلاحية هذه الجلسة.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.user.id !== session.userId) {
    await interaction.reply({ content: 'هذه القائمة ليست لك.', flags: MessageFlags.Ephemeral });
    return;
  }

  const settings = await getSettings();
  const adminRoles = await ticketManager.getAdminRoles();
  const reasons = await ticketManager.getAllReasons();
  const guild = interaction.guild;

  if (interaction.customId.startsWith('ticket_settings_toggle_')) {
    const nextState = !settings.enabled;
    await setSettings({ enabled: nextState });
    const updatedSettings = await getSettings();
    const embed = buildSettingsEmbed(updatedSettings, guild, adminRoles, reasons);
    await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_embed_')) {
    const nextState = !settings.use_embed;
    await setSettings({ use_embed: nextState });
    const updatedSettings = await getSettings();
    const embed = buildSettingsEmbed(updatedSettings, guild, adminRoles, reasons);
    await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_help_')) {
    await handleSettingsHelp(interaction, sessionId);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_panel_')) {
    const panelEmbed = colorManager.createEmbed()
      .setTitle('🎫 إعدادات لوحة التذاكر')
      .setDescription('حدد روم اللوحة وأرسل رسالة فتح التكت.')
      .addFields(
        { name: 'روم اللوحة', value: settings.panel_channel_id ? `<#${settings.panel_channel_id}>` : 'غير محدد', inline: true },
        { name: 'كاتقوري التكت', value: settings.default_category_id ? `<#${settings.default_category_id}>` : 'غير محدد', inline: true }
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_panel_set_channel_${sessionId}`)
        .setLabel('تحديد روم اللوحة')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_panel_send_${sessionId}`)
        .setLabel('إرسال/تحديث اللوحة')
        .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_panel_set_category_${sessionId}`)
        .setLabel('تحديد الكاتقوري')
        .setStyle(ButtonStyle.Secondary)
    );

    await updateSessionMessage(interaction, sessionId, panelEmbed, [row1, row2, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_logs_')) {
    const logsEmbed = colorManager.createEmbed()
      .setTitle('🧾 إعدادات اللوق والنسخ')
      .addFields(
        { name: 'روم اللوق', value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'غير محدد', inline: true },
        { name: 'روم الترانسكربت', value: settings.transcript_channel_id ? `<#${settings.transcript_channel_id}>` : 'غير محدد', inline: true }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_logs_set_channel_${sessionId}`)
        .setLabel('تحديد روم اللوق')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_logs_set_transcript_${sessionId}`)
        .setLabel('تحديد روم الترانسكربت')
        .setStyle(ButtonStyle.Secondary)
    );

    await updateSessionMessage(interaction, sessionId, logsEmbed, [row, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_limits_')) {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_limits_${sessionId}`)
      .setTitle('تعديل الحدود والكولداون');

    const maxTicketsInput = new TextInputBuilder()
      .setCustomId('ticket_limits_max')
      .setLabel('عدد التكتات لكل عضو')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(settings.max_open_tickets));

    const cooldownInput = new TextInputBuilder()
      .setCustomId('ticket_limits_cooldown')
      .setLabel('الكولداون بالثواني')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(settings.cooldown_seconds));

    const maxClaimedInput = new TextInputBuilder()
      .setCustomId('ticket_limits_claims')
      .setLabel('عدد استلام التكت للإدارة (0 = بدون حد)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(settings.max_claimed_tickets ?? 0));

    const numberingInput = new TextInputBuilder()
      .setCustomId('ticket_limits_numbering')
      .setLabel('ترقيم التكت؟ (نعم/لا)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(settings.ticket_numbering ? 'نعم' : 'لا');

    modal.addComponents(
      new ActionRowBuilder().addComponents(maxTicketsInput),
      new ActionRowBuilder().addComponents(cooldownInput),
      new ActionRowBuilder().addComponents(maxClaimedInput),
      new ActionRowBuilder().addComponents(numberingInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_permissions_')) {
    const permEmbed = colorManager.createEmbed()
      .setTitle('🛡️ صلاحيات التكت')
      .setDescription('اختر رولات الإدارة التي تستطيع استلام وإدارة التكتات.');

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`ticket_permissions_set_admin_roles_${sessionId}`)
      .setPlaceholder('حدد رولات الإدارة')
      .setMinValues(0)
      .setMaxValues(10);

    const row = new ActionRowBuilder().addComponents(roleSelect);
    await updateSessionMessage(interaction, sessionId, permEmbed, [row, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_behavior_')) {
    const closeActionText = settings.close_action === 'archive' ? 'احتفاظ بالتكت' : 'حذف بعد الإغلاق';
    const closedCategoryText = settings.closed_category_id ? `<#${settings.closed_category_id}>` : 'غير محدد';
    const behaviorEmbed = colorManager.createEmbed()
      .setTitle('⚙️ سلوك التكت')
      .addFields(
        { name: 'طلب الاستلام', value: settings.require_claim ? 'مفعل' : 'معطل', inline: true },
        { name: 'إخفاء بعد الاستلام', value: settings.hide_after_claim ? 'مفعل' : 'معطل', inline: true },
        { name: 'إضافة الأعضاء', value: settings.allow_user_add ? 'مفعل' : 'معطل', inline: true },
        { name: 'حذف الأعضاء', value: settings.allow_user_remove ? 'مفعل' : 'معطل', inline: true },
        { name: 'تغيير الاسم', value: settings.allow_user_rename ? 'مفعل' : 'معطل', inline: true },
        { name: 'إغلاق التكت', value: closeActionText, inline: true },
        { name: 'كاتقوري المقفلة', value: closedCategoryText, inline: true }
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_toggle_claim_${sessionId}`)
        .setLabel('طلب الاستلام')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_toggle_hide_${sessionId}`)
        .setLabel('إخفاء بعد الاستلام')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_toggle_add_${sessionId}`)
        .setLabel('إضافة الأعضاء')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_toggle_remove_${sessionId}`)
        .setLabel('حذف الأعضاء')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_toggle_rename_${sessionId}`)
        .setLabel('تغيير الاسم')
        .setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_close_toggle_${sessionId}`)
        .setLabel('تبديل الإغلاق')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_behavior_close_category_${sessionId}`)
        .setLabel('كاتقوري المقفلة')
        .setStyle(ButtonStyle.Secondary)
    );

    await updateSessionMessage(interaction, sessionId, behaviorEmbed, [row1, row2, row3, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_messages_')) {
    const messageEmbed = colorManager.createEmbed()
      .setTitle('✉️ تخصيص الرسائل')
      .setDescription('تخصيص شكل الرسائل والإيمبدات والمنشن وسبب آخر.')
      .addFields(
        { name: 'رسالة التكت', value: settings.ticket_embed_title || 'بدون عنوان', inline: true },
        { name: 'رسالة الاستلام', value: settings.acceptance_embed_title || 'بدون عنوان', inline: true },
        { name: 'طريقة الاستلام', value: settings.acceptance_mode === 'inside' ? 'داخل التكت' : 'روم الاستلام', inline: true },
        { name: 'سبب آخر', value: settings.allow_other_reason ? 'مفعل' : 'معطل', inline: true }
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_messages_ticket_${sessionId}`)
        .setLabel('رسالة التكت')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_messages_acceptance_${sessionId}`)
        .setLabel('رسالة الاستلام')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_messages_mentions_${sessionId}`)
        .setLabel('المنشن وسبب آخر')
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_messages_mode_${sessionId}`)
        .setLabel('تبديل طريقة الاستلام')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ticket_messages_other_toggle_${sessionId}`)
        .setLabel('تفعيل/تعطيل سبب آخر')
        .setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_messages_panel_images_${sessionId}`)
        .setLabel('صور اللوحة')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ticket_messages_accept_images_${sessionId}`)
        .setLabel('صور الاستلام')
        .setStyle(ButtonStyle.Secondary)
    );

    await updateSessionMessage(interaction, sessionId, messageEmbed, [row1, row2, row3, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_buttons_')) {
    const buttonsEmbed = colorManager.createEmbed()
      .setTitle('🧩 تخصيص الأزرار')
      .setDescription('اختر الزر الذي تريد تخصيصه (اسم/إيموجي/ستايل/تفعيل).');

    const buttonOptions = [
      { label: 'زر الاستلام', value: 'claim' },
      { label: 'زر إضافة عضو', value: 'add_user' },
      { label: 'زر حذف عضو', value: 'remove_user' },
      { label: 'زر تغيير الاسم', value: 'rename' },
      { label: 'زر تحويل المسؤولية', value: 'transfer' },
      { label: 'زر الإغلاق', value: 'close' }
    ];

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_buttons_select_${sessionId}`)
      .setPlaceholder('اختر الزر للتخصيص')
      .addOptions(buttonOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await updateSessionMessage(interaction, sessionId, buttonsEmbed, [row, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_panels_')) {
    const panels = settings.panel_configs || [];
    const panelLines = panels.length
      ? panels.map(panel => `• **${panel.id}** → <#${panel.channel_id}>`).join('\n')
      : 'لا توجد لوحات إضافية';

    const panelsEmbed = colorManager.createEmbed()
      .setTitle('📋 لوحات متعددة')
      .setDescription(panelLines);

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_panels_add_${sessionId}`)
        .setLabel('إضافة لوحة')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ticket_panels_remove_${sessionId}`)
        .setLabel('حذف لوحة')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ticket_panels_send_${sessionId}`)
        .setLabel('تحديث جميع اللوحات')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ticket_panels_style_${sessionId}`)
        .setLabel('تبديل نمط اللوحة')
        .setStyle(ButtonStyle.Secondary)
    );

    await updateSessionMessage(interaction, sessionId, panelsEmbed, [row1, buildBackRow(sessionId)]);
    return;
  }

  if (interaction.customId.startsWith('ticket_settings_reasons_')) {
    const reasonEmbed = colorManager.createEmbed()
      .setTitle('📌 أسباب التكت')
      .setDescription('اختر سبب للتعديل أو أضف سبب جديد.');

    const options = reasons.slice(0, 25).map(reason => ({
      label: reason.reason_name,
      description: reason.reason_description ? reason.reason_description.slice(0, 80) : 'بدون وصف',
      value: reason.reason_id
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_reason_select_${sessionId}`)
      .setPlaceholder('اختر سبب للتعديل')
      .setDisabled(options.length === 0)
      .addOptions(options.length ? options : [{ label: 'لا توجد أسباب', value: 'no_reasons' }]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_reason_add_${sessionId}`)
        .setLabel('إضافة سبب')
        .setStyle(ButtonStyle.Success)
    );

    await updateSessionMessage(interaction, sessionId, reasonEmbed, [row, row2, buildBackRow(sessionId)]);
  }
}

async function showReasonDetail(interaction, reasonId, sessionId) {
  const reason = await ticketManager.getReason(reasonId);
  if (!reason) {
    await interaction.reply({ content: '❌ السبب غير موجود.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = colorManager.createEmbed()
    .setTitle(`تعديل السبب: ${reason.reason_name}`)
    .setDescription(reason.reason_description || 'بدون وصف')
    .addFields(
      { name: 'الإيموجي', value: reason.reason_emoji || '🎫', inline: true },
      { name: 'كاتقوري', value: reason.category_id ? `<#${reason.category_id}>` : 'غير محدد', inline: true },
      { name: 'روم الاستلام', value: reason.acceptance_channel_id ? `<#${reason.acceptance_channel_id}>` : 'غير محدد', inline: true },
      { name: 'طريقة الاستلام', value: reason.acceptance_mode === 'inside' ? 'داخل التكت' : 'روم الاستلام', inline: true },
      { name: 'تنسيق الاسم', value: reason.ticket_name_format || 't-{number}', inline: true },
      { name: 'رول يتم منحه', value: reason.role_to_give ? `<@&${reason.role_to_give}>` : 'غير محدد', inline: true },
      { name: 'رولات عرض التكت', value: reason.display_roles ? reason.display_roles.map(r => `<@&${r}>`).join(', ') : 'غير محدد', inline: false }
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:edit_basic:${reason.reason_id}:${sessionId}`)
      .setLabel('تعديل الاسم والوصف')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_category:${reason.reason_id}:${sessionId}`)
      .setLabel('تحديد الكاتقوري')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_accept_channel:${reason.reason_id}:${sessionId}`)
      .setLabel('روم الاستلام')
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_message:${reason.reason_id}:${sessionId}`)
      .setLabel('رسالة التكت')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_accept_message:${reason.reason_id}:${sessionId}`)
      .setLabel('رسالة الاستلام')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_inside_message:${reason.reason_id}:${sessionId}`)
      .setLabel('رسالة داخل التكت')
      .setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_format:${reason.reason_id}:${sessionId}`)
      .setLabel('تنسيق الاسم')
      .setStyle(ButtonStyle.Secondary)
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_accept_mode:${reason.reason_id}:${sessionId}`)
      .setLabel('طريقة الاستلام')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_form:${reason.reason_id}:${sessionId}`)
      .setLabel('حقول النموذج')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_display_roles:${reason.reason_id}:${sessionId}`)
      .setLabel('رولات العرض')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:set_role:${reason.reason_id}:${sessionId}`)
      .setLabel('رول يمنح للعضو')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_reason_action:delete:${reason.reason_id}:${sessionId}`)
      .setLabel('حذف السبب')
      .setStyle(ButtonStyle.Danger)
  );

  await updateSessionMessage(interaction, sessionId, embed, [row1, row2, row3, row4, buildBackRow(sessionId, 'reasons')]);
}

async function handleReasonSelect(interaction, sessionId) {
  if (interaction.values[0] === 'no_reasons') {
    await interaction.reply({ content: 'لا توجد أسباب متاحة.', flags: MessageFlags.Ephemeral });
    return;
  }

  await showReasonDetail(interaction, interaction.values[0], sessionId);
}

async function handleReasonButtons(interaction, reasonId, sessionId, action) {
  if (action === 'edit_basic') {
    const reason = await ticketManager.getReason(reasonId);
    if (!reason) {
      await interaction.reply({ content: '❌ السبب غير موجود.', flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`ticket_reason_modal:edit_basic:${reasonId}:${sessionId}`)
      .setTitle('تعديل بيانات السبب');
    const nameInput = new TextInputBuilder()
      .setCustomId('reason_name')
      .setLabel('اسم السبب')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(reason.reason_name);
    const emojiInput = new TextInputBuilder()
      .setCustomId('reason_emoji')
      .setLabel('الإيموجي')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(reason.reason_emoji || '🎫');
    const descInput = new TextInputBuilder()
      .setCustomId('reason_desc')
      .setLabel('الوصف')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setValue(reason.reason_description || '');
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(emojiInput),
      new ActionRowBuilder().addComponents(descInput)
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === 'set_message' || action === 'set_accept_message' || action === 'set_inside_message' || action === 'set_format') {
    const titleMap = {
      set_message: 'رسالة التكت',
      set_accept_message: 'رسالة الاستلام',
      set_inside_message: 'رسالة داخل التكت',
      set_format: 'تنسيق اسم التكت'
    };
    const modal = new ModalBuilder()
      .setCustomId(`ticket_reason_modal:${action}:${reasonId}:${sessionId}`)
      .setTitle(titleMap[action]);
    const input = new TextInputBuilder()
      .setCustomId('reason_text')
      .setLabel('النص')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (action === 'set_category' || action === 'set_accept_channel') {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`ticket_reason_select:${action}:${reasonId}:${sessionId}`)
      .setPlaceholder('اختر الروم')
      .setMinValues(0)
      .setMaxValues(1)
      .addChannelTypes(action === 'set_category' ? [ChannelType.GuildCategory] : [ChannelType.GuildText]);
    await interaction.update({
      components: [new ActionRowBuilder().addComponents(channelSelect), buildBackRow(sessionId, 'reasons')]
    });
    return;
  }

  if (action === 'set_accept_mode') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`ticket_reason_select:accept_mode:${reasonId}:${sessionId}`)
      .setPlaceholder('اختر طريقة الاستلام')
      .addOptions([
        { label: 'روم الاستلام', value: 'channel' },
        { label: 'داخل التكت', value: 'inside' }
      ]);
    await interaction.update({
      components: [new ActionRowBuilder().addComponents(selectMenu), buildBackRow(sessionId, 'reasons')]
    });
    return;
  }

  if (action === 'set_form') {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_reason_modal_form:${reasonId}:${sessionId}`)
      .setTitle('حقول نموذج التكت');
    const schemaInput = new TextInputBuilder()
      .setCustomId('reason_form_schema')
      .setLabel('الصيغة: label|required|min|max|placeholder')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(schemaInput));
    await interaction.showModal(modal);
    return;
  }

  if (action === 'set_display_roles' || action === 'set_role') {
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`ticket_reason_select:${action}:${reasonId}:${sessionId}`)
      .setPlaceholder('اختر الرولات')
      .setMinValues(0)
      .setMaxValues(action === 'set_role' ? 1 : 10);
    await interaction.update({
      components: [new ActionRowBuilder().addComponents(roleSelect), buildBackRow(sessionId, 'reasons')]
    });
    return;
  }

  if (action === 'delete') {
    await ticketManager.deleteReason(reasonId);
    await interaction.reply({ content: '✅ تم حذف السبب.', flags: MessageFlags.Ephemeral });
  }
}

async function handleSettingsSelects(interaction, customId) {
  if (customId.startsWith('ticket_permissions_set_admin_roles_')) {
    const sessionId = parseSessionId(customId);
    const selectedRoles = interaction.values;
    const existingRoles = await ticketManager.getAdminRoles();
    const existingIds = existingRoles.map(r => r.role_id);

    for (const roleId of existingIds) {
      if (!selectedRoles.includes(roleId)) {
        await ticketManager.removeAdminRole(roleId);
      }
    }

    for (const roleId of selectedRoles) {
      if (!existingIds.includes(roleId)) {
        await ticketManager.addAdminRole(roleId, interaction.user.id);
      }
    }

    await interaction.reply({ content: '✅ تم تحديث رولات الإدارة.', flags: MessageFlags.Ephemeral });
    const updatedSettings = await getSettings();
    const adminRoles = await ticketManager.getAdminRoles();
    const reasons = await ticketManager.getAllReasons();
    const embed = buildSettingsEmbed(updatedSettings, interaction.guild, adminRoles, reasons);
    await interaction.message.edit({ embeds: [embed], components: buildMainComponents(sessionId) });
    return true;
  }

  if (customId.startsWith('ticket_panel_set_channel_')) {
    const channelId = interaction.values[0];
    await setSettings({ panel_channel_id: channelId });
    await interaction.reply({ content: `✅ تم تحديد روم اللوحة <#${channelId}>`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith('ticket_panel_set_category_')) {
    const channelId = interaction.values[0];
    await setSettings({ default_category_id: channelId });
    await interaction.reply({ content: `✅ تم تحديد كاتقوري التكت <#${channelId}>`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith('ticket_logs_set_channel_')) {
    const channelId = interaction.values[0];
    await setSettings({ log_channel_id: channelId });
    await interaction.reply({ content: `✅ تم تحديد روم اللوق <#${channelId}>`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith('ticket_logs_set_transcript_')) {
    const channelId = interaction.values[0];
    await setSettings({ transcript_channel_id: channelId });
    await interaction.reply({ content: `✅ تم تحديد روم الترانسكربت <#${channelId}>`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (customId.startsWith('ticket_behavior_closed_category_')) {
    const channelId = interaction.values[0] || null;
    await setSettings({ closed_category_id: channelId });
    await interaction.reply({
      content: channelId ? `✅ تم تحديد كاتقوري المقفلة <#${channelId}>` : '✅ تم إزالة كاتقوري المقفلة.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (customId.startsWith('ticket_reason_select:')) {
    const [, action, reasonId, sessionId] = customId.split(':');
    if (action === 'set_category' || action === 'set_accept_channel') {
      const channelId = interaction.values[0] || null;
      const updates = action === 'set_accept_channel'
        ? { acceptanceChannelId: channelId }
        : { categoryId: channelId };
      await ticketManager.updateReason(reasonId, updates);
      await showReasonDetail(interaction, reasonId, sessionId);
      await interaction.followUp({ content: '✅ تم تحديث الروم.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (action === 'accept_mode') {
      const mode = interaction.values[0];
      await ticketManager.updateReason(reasonId, { acceptanceMode: mode });
      await showReasonDetail(interaction, reasonId, sessionId);
      await interaction.followUp({ content: '✅ تم تحديث طريقة الاستلام.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (action === 'set_display_roles' || action === 'set_role') {
      const updates = action === 'set_display_roles'
        ? { displayRoles: interaction.values }
        : { roleToGive: interaction.values[0] || null };
      await ticketManager.updateReason(reasonId, updates);
      await showReasonDetail(interaction, reasonId, sessionId);
      await interaction.followUp({ content: '✅ تم تحديث الرولات.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
  }

  return false;
}

async function handleSettingsModals(interaction) {
  if (interaction.customId.startsWith('ticket_modal_limits_')) {
    const sessionId = parseSessionId(interaction.customId);
    const maxTickets = parseInt(interaction.fields.getTextInputValue('ticket_limits_max'), 10);
    const cooldown = parseInt(interaction.fields.getTextInputValue('ticket_limits_cooldown'), 10);
    const maxClaims = parseInt(interaction.fields.getTextInputValue('ticket_limits_claims'), 10);
    const numberingInput = interaction.fields.getTextInputValue('ticket_limits_numbering').trim();
    const enableNumbering = !['لا', 'no', 'false', '0'].includes(numberingInput.toLowerCase());

    await setSettings({
      max_open_tickets: Number.isNaN(maxTickets) ? DEFAULT_SETTINGS.max_open_tickets : maxTickets,
      cooldown_seconds: Number.isNaN(cooldown) ? DEFAULT_SETTINGS.cooldown_seconds : cooldown,
      max_claimed_tickets: Number.isNaN(maxClaims) ? DEFAULT_SETTINGS.max_claimed_tickets : maxClaims,
      ticket_numbering: enableNumbering
    });

    await interaction.reply({ content: '✅ تم تحديث الحدود.', flags: MessageFlags.Ephemeral });
    const updatedSettings = await getSettings();
    const adminRoles = await ticketManager.getAdminRoles();
    const reasons = await ticketManager.getAllReasons();
    const embed = buildSettingsEmbed(updatedSettings, interaction.guild, adminRoles, reasons);
    const session = ticketSessions.get(sessionId);
    if (session) {
      const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
      if (channel) {
        const message = await channel.messages.fetch(session.messageId).catch(() => null);
        if (message) {
          await message.edit({ embeds: [embed], components: buildMainComponents(sessionId) });
        }
      }
    }
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_message_ticket:')) {
    const [, sessionId] = interaction.customId.split(':');
    await setSettings({
      ticket_embed_title: interaction.fields.getTextInputValue('ticket_message_title'),
      ticket_embed_description: interaction.fields.getTextInputValue('ticket_message_desc'),
      ticket_embed_thumbnail: interaction.fields.getTextInputValue('ticket_message_thumb') || null,
      ticket_embed_image: interaction.fields.getTextInputValue('ticket_message_image') || null
    });
    await interaction.reply({ content: '✅ تم تحديث رسالة التكت.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_message_acceptance:')) {
    const [, sessionId] = interaction.customId.split(':');
    await setSettings({
      acceptance_embed_title: interaction.fields.getTextInputValue('accept_message_title'),
      acceptance_embed_description: interaction.fields.getTextInputValue('accept_message_desc'),
      acceptance_embed_thumbnail: interaction.fields.getTextInputValue('accept_message_thumb') || null,
      acceptance_embed_image: interaction.fields.getTextInputValue('accept_message_image') || null
    });
    await interaction.reply({ content: '✅ تم تحديث رسالة الاستلام.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_message_mentions:')) {
    const [, sessionId] = interaction.customId.split(':');
    await setSettings({
      ticket_mention_template: interaction.fields.getTextInputValue('ticket_mention_template'),
      acceptance_mention_template: interaction.fields.getTextInputValue('accept_mention_template') || '{admins}',
      other_reason_label: interaction.fields.getTextInputValue('other_reason_label') || 'سبب آخر',
      other_reason_prompt: interaction.fields.getTextInputValue('other_reason_prompt') || 'اكتب سبب التكت بالتفصيل'
    });
    await interaction.reply({ content: '✅ تم تحديث إعدادات المنشن وسبب آخر.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_panel_images:')) {
    const [, sessionId] = interaction.customId.split(':');
    await setSettings({
      panel_embed_thumbnail: interaction.fields.getTextInputValue('panel_image_thumb') || null,
      panel_embed_image: interaction.fields.getTextInputValue('panel_image_main') || null
    });
    await interaction.reply({ content: '✅ تم تحديث صور اللوحة.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_accept_images:')) {
    const [, sessionId] = interaction.customId.split(':');
    await setSettings({
      acceptance_channel_thumbnail: interaction.fields.getTextInputValue('accept_channel_thumb') || null,
      acceptance_channel_image: interaction.fields.getTextInputValue('accept_channel_image') || null,
      acceptance_inside_thumbnail: interaction.fields.getTextInputValue('accept_inside_thumb') || null,
      acceptance_inside_image: interaction.fields.getTextInputValue('accept_inside_image') || null
    });
    await interaction.reply({ content: '✅ تم تحديث صور الاستلام.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_button:')) {
    const [, actionKey, sessionId] = interaction.customId.split(':');
    const label = interaction.fields.getTextInputValue('button_label');
    const emoji = interaction.fields.getTextInputValue('button_emoji') || null;
    const style = interaction.fields.getTextInputValue('button_style');
    const enabledRaw = interaction.fields.getTextInputValue('button_enabled');
    const applyAllRaw = interaction.fields.getTextInputValue('button_apply_all') || 'لا';
    const enabled = !['لا', 'no', 'false', '0'].includes(enabledRaw.toLowerCase());
    const applyAll = ['نعم', 'yes', 'true', '1'].includes(applyAllRaw.toLowerCase());

    const settings = await getSettings();
    const buttonConfig = settings.button_config || DEFAULT_SETTINGS.button_config;
    if (applyAll) {
      Object.keys(buttonConfig).forEach(key => {
        buttonConfig[key] = { ...buttonConfig[key], label, emoji, style, enabled };
      });
    } else {
      buttonConfig[actionKey] = { ...buttonConfig[actionKey], label, emoji, style, enabled };
    }
    await setSettings({ button_config: buttonConfig });
    await interaction.reply({ content: '✅ تم تحديث إعدادات الزر.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_panel_add:')) {
    const [, sessionId] = interaction.customId.split(':');
    const settings = await getSettings();
    const panelId = interaction.fields.getTextInputValue('panel_id').trim();
    const channelId = interaction.fields.getTextInputValue('panel_channel').trim();
    const title = interaction.fields.getTextInputValue('panel_title') || null;
    const description = interaction.fields.getTextInputValue('panel_description') || null;
    const reasonIdsRaw = interaction.fields.getTextInputValue('panel_reason_ids') || '';
    const reasonIds = reasonIdsRaw
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (!panelId || !channelId) {
      await interaction.reply({ content: '❌ يجب إدخال معرف اللوحة وروم اللوحة.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const panels = settings.panel_configs || [];
    if (panels.some(panel => panel.id === panelId)) {
      await interaction.reply({ content: '❌ معرف اللوحة مستخدم مسبقاً.', flags: MessageFlags.Ephemeral });
      return true;
    }

    panels.push({
      id: panelId,
      channel_id: channelId,
      message_id: null,
      title,
      description,
      reason_ids: reasonIds
    });
    await setSettings({ panel_configs: panels });
    await interaction.reply({ content: '✅ تم إضافة اللوحة.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_modal_panel_remove:')) {
    const [, sessionId] = interaction.customId.split(':');
    const panelId = interaction.fields.getTextInputValue('panel_remove_id').trim();
    const settings = await getSettings();
    const panels = (settings.panel_configs || []).filter(panel => panel.id !== panelId);
    await setSettings({ panel_configs: panels });
    await interaction.reply({ content: '✅ تم حذف اللوحة.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_reason_modal:edit_basic:')) {
    const [, , reasonId] = interaction.customId.split(':');
    const nameValue = interaction.fields.getTextInputValue('reason_name').trim();
    const emojiValue = interaction.fields.getTextInputValue('reason_emoji').trim();
    const descValue = interaction.fields.getTextInputValue('reason_desc').trim();
    await ticketManager.updateReason(reasonId, {
      name: nameValue,
      emoji: emojiValue || '🎫',
      description: descValue
    });
    await interaction.reply({ content: '✅ تم تحديث السبب.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_reason_modal:')) {
    const [, action, reasonId] = interaction.customId.split(':');
    const value = interaction.fields.getTextInputValue('reason_text');
    const updates = action === 'set_message'
      ? { ticketMessage: value }
      : action === 'set_accept_message'
        ? { acceptanceMessage: value }
        : action === 'set_inside_message'
          ? { insideTicketMessage: value }
        : { ticketNameFormat: value || 't-{number}' };
    await ticketManager.updateReason(reasonId, updates);
    await interaction.reply({ content: '✅ تم التحديث.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_reason_modal_form:')) {
    const [, , reasonId] = interaction.customId.split(':');
    const schemaText = interaction.fields.getTextInputValue('reason_form_schema');
    const schema = parseFormSchema(schemaText);
    await ticketManager.updateReason(reasonId, { formSchema: schema });
    await interaction.reply({ content: '✅ تم تحديث حقول النموذج.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith('ticket_reason_form:')) {
    const [, reasonId, panelId] = interaction.customId.split(':');
    const reason = await ticketManager.getReason(reasonId);
    if (!reason) {
      await interaction.reply({ content: '❌ السبب غير موجود.', flags: MessageFlags.Ephemeral });
      return;
    }
    const fields = Array.isArray(reason.form_schema) ? reason.form_schema : [];
    const responses = fields.slice(0, 5).map((field, index) => {
      const value = interaction.fields.getTextInputValue(`form_field_${index}`)?.trim() || '';
      if (field.required && !value) {
        return null;
      }
      return value;
    });
    if (responses.includes(null)) {
      await interaction.reply({ content: '❌ يرجى تعبئة الحقول المطلوبة.', flags: MessageFlags.Ephemeral });
      return;
    }

    const settings = await getSettings();
    const result = await ticketManager.createTicket(
      interaction.guild,
      interaction.user,
      reason,
      null,
      { panelId }
    );
    if (!result) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء إنشاء التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    const fieldsText = formatFormResponses(fields, responses);
    const templateParams = {
      userId: interaction.user.id,
      user: interaction.user.username,
      reason: reason.reason_name,
      channelId: result.channel.id,
      number: result.ticketNumber,
      panelId,
      fields: fieldsText
    };

    let ticketEmbed = null;
    if (settings.use_embed) {
      ticketEmbed = colorManager.createEmbed()
        .setTitle(applyTemplate(settings.ticket_embed_title, templateParams))
        .setDescription(`${applyTemplate(settings.ticket_embed_description, templateParams)}\n${fieldsText}`)
        .setFooter({ text: `رقم التكت: ${result.ticketNumber}` });
      if (settings.ticket_embed_thumbnail) {
        ticketEmbed.setThumbnail(applyTemplate(settings.ticket_embed_thumbnail, templateParams));
      }
      if (settings.ticket_embed_image) {
        ticketEmbed.setImage(applyTemplate(settings.ticket_embed_image, templateParams));
      }
    }

    const buttonConfig = settings.button_config || DEFAULT_SETTINGS.button_config;
    const buttons = [];
    const claimButton = buildActionButton('claim', buttonConfig.claim, 'ticket_action_claim');
    const addButton = buildActionButton('add_user', buttonConfig.add_user, 'ticket_action_add_user');
    const removeButton = buildActionButton('remove_user', buttonConfig.remove_user, 'ticket_action_remove_user');
    const renameButton = buildActionButton('rename', buttonConfig.rename, 'ticket_action_rename');
    const transferButton = buildActionButton('transfer', buttonConfig.transfer, 'ticket_action_transfer');
    const closeButton = buildActionButton('close', buttonConfig.close, 'ticket_action_close');

    [claimButton, addButton, removeButton, renameButton, transferButton, closeButton].forEach(button => {
      if (button) buttons.push(button);
    });

    const rows = [];
    if (buttons.length) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
      if (buttons.length > 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(5, 10)));
      }
    }

    const mentionText = applyTemplate(settings.ticket_mention_template, templateParams);
    const ticketPayload = settings.use_embed
      ? { content: mentionText, embeds: [ticketEmbed], components: rows }
      : { content: `${mentionText}\n${applyTemplate(settings.ticket_embed_description, templateParams)}\n${fieldsText}`, components: rows };
    await result.channel.send(ticketPayload);

    await result.channel.send({ content: fieldsText }).catch(() => {});
    await interaction.reply({ content: `✅ تم فتح تكتك بنجاح: <#${result.channel.id}>`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'ticket_modal_add_reason') {
    const reasonName = interaction.fields.getTextInputValue('reason_name').trim();
    const reasonEmoji = interaction.fields.getTextInputValue('reason_emoji').trim();
    const reasonDesc = interaction.fields.getTextInputValue('reason_desc').trim();
    if (!reasonName) {
      await interaction.reply({ content: '❌ يجب إدخال اسم السبب.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const settings = await getSettings();
    await ticketManager.addReason({
      name: reasonName,
      emoji: reasonEmoji || '🎫',
      description: reasonDesc,
      acceptanceMode: settings.acceptance_mode
    });
    await interaction.reply({ content: '✅ تم إضافة السبب.', flags: MessageFlags.Ephemeral });
    return true;
  }

  return false;
}

async function handleBehaviorToggles(interaction, sessionId, action) {
  const settings = await getSettings();
  const updates = {};
  if (action === 'claim') updates.require_claim = !settings.require_claim;
  if (action === 'hide') updates.hide_after_claim = !settings.hide_after_claim;
  if (action === 'add') updates.allow_user_add = !settings.allow_user_add;
  if (action === 'remove') updates.allow_user_remove = !settings.allow_user_remove;
  if (action === 'rename') updates.allow_user_rename = !settings.allow_user_rename;

  await setSettings(updates);
  const updatedSettings = await getSettings();
  const adminRoles = await ticketManager.getAdminRoles();
  const reasons = await ticketManager.getAllReasons();
  const embed = buildSettingsEmbed(updatedSettings, interaction.guild, adminRoles, reasons);
  await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
}

async function handlePanelActions(interaction, sessionId) {
  if (interaction.customId.startsWith('ticket_panel_set_channel_')) {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`ticket_panel_set_channel_${sessionId}`)
      .setPlaceholder('اختر روم اللوحة')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes([ChannelType.GuildText]);
    await interaction.update({ components: [new ActionRowBuilder().addComponents(channelSelect), buildBackRow(sessionId)] });
    return;
  }

  if (interaction.customId.startsWith('ticket_panel_set_category_')) {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`ticket_panel_set_category_${sessionId}`)
      .setPlaceholder('اختر الكاتقوري')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes([ChannelType.GuildCategory]);
    await interaction.update({ components: [new ActionRowBuilder().addComponents(channelSelect), buildBackRow(sessionId)] });
    return;
  }

  if (interaction.customId.startsWith('ticket_panel_send_')) {
    const settings = await getSettings();
    const reasons = await ticketManager.getAllReasons();
    const result = await sendOrUpdatePanel(interaction.guild, settings, reasons);
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
  }
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_open_select:')) {
    const [, panelId] = interaction.customId.split(':');
    await handleTicketOpen(interaction, panelId);
    return;
  }

  if (interaction.isModalSubmit()) {
    if (await handleSettingsModals(interaction)) return;
    if (interaction.customId.startsWith('ticket_modal_')) {
      await handleModalSubmit(interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('ticket_open_button:')) {
      const [, panelId, reasonId] = interaction.customId.split(':');
      if (reasonId === 'no_reasons') {
        await interaction.reply({ content: 'لا توجد أسباب متاحة.', flags: MessageFlags.Ephemeral });
        return;
      }
      await handleTicketOpen(interaction, panelId, reasonId);
      return;
    }

    if (interaction.customId.startsWith('ticket_rate:')) {
      const [, ticketId, ratingRaw] = interaction.customId.split(':');
      const rating = Number(ratingRaw);
      if (!Number.isFinite(rating) || ![-2, -1, 0, 1, 2].includes(rating)) {
        await interaction.reply({ content: '❌ التقييم غير صالح.', flags: MessageFlags.Ephemeral });
        return;
      }
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const adminRoles = await ticketManager.getAdminRoles();
      const isAdmin = member && isAdminMember(member, adminRoles.map(r => r.role_id), global.BOT_OWNERS || []);
      if (!isAdmin) {
        await interaction.reply({ content: '❌ ليس لديك صلاحية تقييم التكت.', flags: MessageFlags.Ephemeral });
        return;
      }
      const hasRating = await ticketManager.hasTicketRating(ticketId);
      if (hasRating) {
        await interaction.reply({ content: '⚠️ تم تقييم هذا التكت مسبقاً.', flags: MessageFlags.Ephemeral });
        return;
      }
      const ticket = await ticketManager.getTicketById(ticketId);
      if (!ticket) {
        await interaction.reply({ content: '❌ التكت غير موجود.', flags: MessageFlags.Ephemeral });
        return;
      }
      const ratedUserId = ticket.claimed_by || ticket.closed_by;
      if (ratedUserId) {
        await ticketManager.givePoints(ratedUserId, rating);
        await ticketManager.logAction(ticket.ticket_id, ratedUserId, 'rating', {
          rating,
          ratedBy: interaction.user.id
        });
      }
      await interaction.update({
        content: `✅ تم تسجيل تقييم ${rating} للتكت.`,
        components: buildRatingComponents(ticket.ticket_id, true)
      });
      return;
    }

    if (interaction.customId.startsWith('ticket_accept_channel:')) {
      const [, ticketId] = interaction.customId.split(':');
      const ticketData = await ticketManager.getTicketById(ticketId);
      if (!ticketData) {
        await interaction.reply({ content: '❌ التكت غير موجود.', flags: MessageFlags.Ephemeral });
        return;
      }
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const adminRoles = await ticketManager.getAdminRoles();
      const isAdmin = member && isAdminMember(member, adminRoles.map(r => r.role_id), global.BOT_OWNERS || []);
      if (!isAdmin) {
        await interaction.reply({ content: '❌ ليس لديك صلاحية استلام التكت.', flags: MessageFlags.Ephemeral });
        return;
      }
      const settings = await getSettings();
      if (settings.max_claimed_tickets > 0) {
        const claimedCount = await ticketManager.countClaimedTickets(interaction.user.id);
        if (claimedCount >= settings.max_claimed_tickets) {
          await interaction.reply({
            content: `⚠️ وصلت للحد الأعلى لاستلام التكتات (${settings.max_claimed_tickets}).`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }
      await ticketManager.updateTicket(ticketData.ticket_id, { claimed_by: interaction.user.id });
      const ticketChannel = await interaction.guild.channels.fetch(ticketData.channel_id).catch(() => null);
      if (ticketChannel) {
        await ticketChannel.send(`✅ تم استلام التكت بواسطة <@${interaction.user.id}>`).catch(() => {});
        if (settings.hide_after_claim) {
          const adminRolesData = await ticketManager.getAdminRoles();
          for (const roleData of adminRolesData) {
            await ticketChannel.permissionOverwrites.edit(roleData.role_id, { ViewChannel: false }).catch(() => {});
          }
          const reason = ticketData.reason_id ? await ticketManager.getReason(ticketData.reason_id) : null;
          if (reason?.display_roles) {
            for (const roleId of reason.display_roles) {
              await ticketChannel.permissionOverwrites.edit(roleId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }).catch(() => {});
            }
          }
          if (ticketData.responsibility && global.responsibilities?.[ticketData.responsibility]) {
            await applyResponsibilityPermissions(ticketChannel, global.responsibilities[ticketData.responsibility]);
          }
          await ticketChannel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }).catch(() => {});
        }
      }
      await interaction.reply({ content: '✅ تم استلام التكت.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId.startsWith('ticket_action_')) {
      const action = interaction.customId.replace('ticket_action_', '');
      await handleTicketAction(interaction, action);
      return;
    }

    if (interaction.customId.startsWith('ticket_behavior_close_toggle_')) {
      const sessionId = parseSessionId(interaction.customId);
      const settings = await getSettings();
      const nextAction = settings.close_action === 'archive' ? 'delete' : 'archive';
      await setSettings({ close_action: nextAction });
      const updatedSettings = await getSettings();
      const adminRoles = await ticketManager.getAdminRoles();
      const reasons = await ticketManager.getAllReasons();
      const embed = buildSettingsEmbed(updatedSettings, interaction.guild, adminRoles, reasons);
      await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
      return;
    }

    if (interaction.customId.startsWith('ticket_behavior_close_category_')) {
      const sessionId = parseSessionId(interaction.customId);
      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`ticket_behavior_closed_category_${sessionId}`)
        .setPlaceholder('اختر كاتقوري التكتات المقفلة')
        .setMinValues(0)
        .setMaxValues(1)
        .addChannelTypes([ChannelType.GuildCategory]);
      await interaction.update({ components: [new ActionRowBuilder().addComponents(channelSelect), buildBackRow(sessionId)] });
      return;
    }

    if (interaction.customId.startsWith('ticket_behavior_toggle_')) {
      const sessionId = parseSessionId(interaction.customId);
      const action = interaction.customId.split('_')[3];
      await handleBehaviorToggles(interaction, sessionId, action);
      return;
    }

    if (interaction.customId.startsWith('ticket_messages_')) {
      const sessionId = parseSessionId(interaction.customId);
      if (interaction.customId.startsWith('ticket_messages_ticket_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_message_ticket:${sessionId}`)
          .setTitle('تخصيص رسالة التكت');
        const titleInput = new TextInputBuilder()
          .setCustomId('ticket_message_title')
          .setLabel('عنوان الإيمبد')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const descInput = new TextInputBuilder()
          .setCustomId('ticket_message_desc')
          .setLabel('وصف الإيمبد')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        const thumbInput = new TextInputBuilder()
          .setCustomId('ticket_message_thumb')
          .setLabel('رابط الصورة المصغرة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const imageInput = new TextInputBuilder()
          .setCustomId('ticket_message_image')
          .setLabel('رابط الصورة الكبيرة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(thumbInput),
          new ActionRowBuilder().addComponents(imageInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_acceptance_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_message_acceptance:${sessionId}`)
          .setTitle('تخصيص رسالة الاستلام');
        const titleInput = new TextInputBuilder()
          .setCustomId('accept_message_title')
          .setLabel('عنوان الإيمبد')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const descInput = new TextInputBuilder()
          .setCustomId('accept_message_desc')
          .setLabel('وصف الإيمبد')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        const thumbInput = new TextInputBuilder()
          .setCustomId('accept_message_thumb')
          .setLabel('رابط الصورة المصغرة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const imageInput = new TextInputBuilder()
          .setCustomId('accept_message_image')
          .setLabel('رابط الصورة الكبيرة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(thumbInput),
          new ActionRowBuilder().addComponents(imageInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_mentions_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_message_mentions:${sessionId}`)
          .setTitle('تخصيص المنشن وسبب آخر');
        const mentionInput = new TextInputBuilder()
          .setCustomId('ticket_mention_template')
          .setLabel('منشن التكت (مثال: <@{userId}>)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const acceptMentionInput = new TextInputBuilder()
          .setCustomId('accept_mention_template')
          .setLabel('منشن الاستلام (مثال: {admins})')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const otherLabelInput = new TextInputBuilder()
          .setCustomId('other_reason_label')
          .setLabel('اسم خيار السبب الآخر')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const otherPromptInput = new TextInputBuilder()
          .setCustomId('other_reason_prompt')
          .setLabel('نص مودال السبب الآخر')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(mentionInput),
          new ActionRowBuilder().addComponents(acceptMentionInput),
          new ActionRowBuilder().addComponents(otherLabelInput),
          new ActionRowBuilder().addComponents(otherPromptInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_panel_images_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_panel_images:${sessionId}`)
          .setTitle('صور لوحة التكت');
        const thumbInput = new TextInputBuilder()
          .setCustomId('panel_image_thumb')
          .setLabel('رابط صورة مصغرة')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const imageInput = new TextInputBuilder()
          .setCustomId('panel_image_main')
          .setLabel('رابط صورة كبيرة')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(thumbInput),
          new ActionRowBuilder().addComponents(imageInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_accept_images_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_accept_images:${sessionId}`)
          .setTitle('صور الاستلام');
        const channelThumb = new TextInputBuilder()
          .setCustomId('accept_channel_thumb')
          .setLabel('صورة مصغرة (روم الاستلام)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const channelImage = new TextInputBuilder()
          .setCustomId('accept_channel_image')
          .setLabel('صورة كبيرة (روم الاستلام)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const insideThumb = new TextInputBuilder()
          .setCustomId('accept_inside_thumb')
          .setLabel('صورة مصغرة (داخل التكت)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const insideImage = new TextInputBuilder()
          .setCustomId('accept_inside_image')
          .setLabel('صورة كبيرة (داخل التكت)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(channelThumb),
          new ActionRowBuilder().addComponents(channelImage),
          new ActionRowBuilder().addComponents(insideThumb),
          new ActionRowBuilder().addComponents(insideImage)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_mode_')) {
        const settings = await getSettings();
        const nextMode = settings.acceptance_mode === 'inside' ? 'channel' : 'inside';
        await setSettings({ acceptance_mode: nextMode });
        const updatedSettings = await getSettings();
        const adminRoles = await ticketManager.getAdminRoles();
        const reasons = await ticketManager.getAllReasons();
        const embed = buildSettingsEmbed(updatedSettings, interaction.guild, adminRoles, reasons);
        await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
        return;
      }

      if (interaction.customId.startsWith('ticket_messages_other_toggle_')) {
        const settings = await getSettings();
        await setSettings({ allow_other_reason: !settings.allow_other_reason });
        await interaction.reply({
          content: `✅ تم ${settings.allow_other_reason ? 'تعطيل' : 'تفعيل'} سبب آخر.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.customId.startsWith('ticket_panels_')) {
      const sessionId = parseSessionId(interaction.customId);
      if (interaction.customId.startsWith('ticket_panels_add_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_panel_add:${sessionId}`)
          .setTitle('إضافة لوحة جديدة');
        const idInput = new TextInputBuilder()
          .setCustomId('panel_id')
          .setLabel('معرف اللوحة (فريد)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const channelInput = new TextInputBuilder()
          .setCustomId('panel_channel')
          .setLabel('ID روم اللوحة')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const titleInput = new TextInputBuilder()
          .setCustomId('panel_title')
          .setLabel('عنوان اللوحة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        const descInput = new TextInputBuilder()
          .setCustomId('panel_description')
          .setLabel('وصف اللوحة (اختياري)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);
        const reasonInput = new TextInputBuilder()
          .setCustomId('panel_reason_ids')
          .setLabel('IDs للأسباب (افصل بفاصلة، اختياري)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(channelInput),
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(reasonInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_panels_remove_')) {
        const modal = new ModalBuilder()
          .setCustomId(`ticket_modal_panel_remove:${sessionId}`)
          .setTitle('حذف لوحة');
        const idInput = new TextInputBuilder()
          .setCustomId('panel_remove_id')
          .setLabel('معرف اللوحة للحذف')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(idInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('ticket_panels_send_')) {
        const settings = await getSettings();
        const reasons = await ticketManager.getAllReasons();
        const results = [];
        for (const panel of settings.panel_configs || []) {
          const result = await sendOrUpdatePanel(interaction.guild, settings, reasons, panel);
          results.push(`${panel.id}: ${result.success ? '✅' : '❌'}`);
        }
        const defaultPanelResult = await sendOrUpdatePanel(interaction.guild, settings, reasons);
        results.push(`default: ${defaultPanelResult.success ? '✅' : '❌'}`);
        await interaction.reply({ content: results.join('\n'), flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.customId.startsWith('ticket_panels_style_')) {
        const settings = await getSettings();
        const nextStyle = settings.panel_style === 'buttons' ? 'menu' : 'buttons';
        await setSettings({ panel_style: nextStyle });
        await interaction.reply({
          content: `✅ تم تغيير نمط اللوحة إلى: ${nextStyle === 'buttons' ? 'أزرار' : 'منيو'}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    if (interaction.customId.startsWith('ticket_panel_')) {
      const sessionId = parseSessionId(interaction.customId);
      await handlePanelActions(interaction, sessionId);
      return;
    }

    if (interaction.customId.startsWith('ticket_reason_add_')) {
      const modal = new ModalBuilder()
        .setCustomId('ticket_modal_add_reason')
        .setTitle('إضافة سبب جديد');
      const nameInput = new TextInputBuilder()
        .setCustomId('reason_name')
        .setLabel('اسم السبب')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const emojiInput = new TextInputBuilder()
        .setCustomId('reason_emoji')
        .setLabel('الإيموجي')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      const descInput = new TextInputBuilder()
        .setCustomId('reason_desc')
        .setLabel('الوصف')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(descInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith('ticket_reason_action:')) {
      const [, action, reasonId, sessionId] = interaction.customId.split(':');
      await handleReasonButtons(interaction, reasonId, sessionId, action);
      return;
    }

    if (interaction.customId.startsWith('ticket_settings_back:')) {
      const [, target, sessionId] = interaction.customId.split(':');
      const settings = await getSettings();
      const adminRoles = await ticketManager.getAdminRoles();
      const reasons = await ticketManager.getAllReasons();
      if (target === 'reasons') {
        const reasonEmbed = colorManager.createEmbed()
          .setTitle('📌 أسباب التكت')
          .setDescription('اختر سبب للتعديل أو أضف سبب جديد.');
        const options = reasons.slice(0, 25).map(reason => ({
          label: reason.reason_name,
          description: reason.reason_description ? reason.reason_description.slice(0, 80) : 'بدون وصف',
          value: reason.reason_id
        }));
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`ticket_reason_select_${sessionId}`)
          .setPlaceholder('اختر سبب للتعديل')
          .setDisabled(options.length === 0)
          .addOptions(options.length ? options : [{ label: 'لا توجد أسباب', value: 'no_reasons' }]);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_reason_add_${sessionId}`)
            .setLabel('إضافة سبب')
            .setStyle(ButtonStyle.Success)
        );
        await updateSessionMessage(interaction, sessionId, reasonEmbed, [row, row2, buildBackRow(sessionId)]);
      } else {
        const embed = buildSettingsEmbed(settings, interaction.guild, adminRoles, reasons);
        await updateSessionMessage(interaction, sessionId, embed, buildMainComponents(sessionId));
      }
      return;
    }

    if (interaction.customId.startsWith('ticket_settings_')) {
      const sessionId = parseSessionId(interaction.customId);
      await handleSettingsInteraction(interaction, sessionId);
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('ticket_reason_select_')) {
      const sessionId = parseSessionId(interaction.customId);
      await handleReasonSelect(interaction, sessionId);
      return;
    }

    if (interaction.customId.startsWith('ticket_buttons_select_')) {
      const sessionId = parseSessionId(interaction.customId);
      const actionKey = interaction.values[0];
      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_button:${actionKey}:${sessionId}`)
        .setTitle('تخصيص زر');
      const labelInput = new TextInputBuilder()
        .setCustomId('button_label')
        .setLabel('اسم الزر')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const emojiInput = new TextInputBuilder()
        .setCustomId('button_emoji')
        .setLabel('الإيموجي (اختياري)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      const styleInput = new TextInputBuilder()
        .setCustomId('button_style')
        .setLabel('ستايل الزر (primary/secondary/success/danger)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const enabledInput = new TextInputBuilder()
        .setCustomId('button_enabled')
        .setLabel('تفعيل الزر؟ (نعم/لا)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const applyAllInput = new TextInputBuilder()
        .setCustomId('button_apply_all')
        .setLabel('تطبيق على كل الأزرار؟ (نعم/لا)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(labelInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(styleInput),
        new ActionRowBuilder().addComponents(enabledInput),
        new ActionRowBuilder().addComponents(applyAllInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'ticket_transfer_select') {
      const selected = interaction.values[0];
      const responsibilities = global.responsibilities || {};
      const responsibilityConfig = responsibilities[selected];
      if (!responsibilityConfig) {
        await interaction.reply({ content: '❌ المسؤولية غير موجودة.', flags: MessageFlags.Ephemeral });
        return;
      }

      await applyResponsibilityPermissions(interaction.channel, responsibilityConfig);
      const ticket = await ticketManager.getTicket(interaction.channel.id);
      if (ticket) {
        await ticketManager.updateTicket(ticket.ticket_id, { responsibility: selected });
      }
      await interaction.reply({
        content: `✅ تم تحويل التكت إلى مسؤولية: **${selected}**`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (await handleSettingsSelects(interaction, interaction.customId)) return;
  }

  if (interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
    if (await handleSettingsSelects(interaction, interaction.customId)) return;
  }
}

function registerHandlers() {
  interactionRouter.register('ticket_', async (interaction) => {
    await handleInteraction(interaction);
  });
}

async function execute(message, args, { BOT_OWNERS, ADMIN_ROLES, client }) {
  const member = await message.guild.members.fetch(message.author.id);
  const adminRoles = ADMIN_ROLES || [];
  if (!isAdminMember(member, adminRoles, BOT_OWNERS || [])) {
    await message.react('❌');
    return;
  }

  const rawToken = message.content.trim().split(/\s+/)[0];
  const commandToken = rawToken.replace(/^[-!.]/, '');
  const commandMap = new Set([
    'ticket',
    'embed',
    'tick',
    'tblcok',
    'tblock',
    'bord',
    'tadd',
    'tremove',
    'tchange',
    'tclose',
    'tlog',
    'tname',
    'remind',
    'admins',
    'treset',
    'point'
  ]);

  if (commandMap.has(commandToken) && commandToken !== 'ticket') {
    await handleLegacyCommand(message, commandToken, args, adminRoles, BOT_OWNERS);
    return;
  }

  const sessionId = `${message.author.id}-${Date.now()}`;
  ticketSessions.set(sessionId, {
    userId: message.author.id,
    channelId: message.channel.id,
    messageId: null
  });

  const settings = await getSettings();
  const adminRoleRows = await ticketManager.getAdminRoles();
  const reasons = await ticketManager.getAllReasons();

  const embed = buildSettingsEmbed(settings, message.guild, adminRoleRows, reasons);
  const components = buildMainComponents(sessionId);
  const sentMessage = await message.channel.send({ embeds: [embed], components });
  ticketSessions.get(sessionId).messageId = sentMessage.id;

  registerHandlers();
}

async function handleLegacyCommand(message, commandToken, args, adminRoles, BOT_OWNERS) {
  const settings = await getSettings();
  const isOwner = BOT_OWNERS?.includes(message.author.id) || message.guild.ownerId === message.author.id;
  const member = message.member || await message.guild.members.fetch(message.author.id);
  const isAdmin = isAdminMember(member, adminRoles, BOT_OWNERS || []);
  const ticket = await ticketManager.getTicket(message.channel.id);

  if (commandToken === 'embed') {
    const reasons = await ticketManager.getAllReasons();
    const result = await sendOrUpdatePanel(message.guild, settings, reasons);
    await message.reply(result.message);
    return;
  }

  if (commandToken === 'tblock' || commandToken === 'tblcok') {
    if (!isOwner) {
      await message.reply('❌ هذا الأمر للأونرز فقط.');
      return;
    }
    const sub = (args[0] || '').toLowerCase();
    const userId = parseUserId(args[1] || args[0]);
    if (sub === 'list') {
      const blocked = await ticketManager.getBlockedUsers();
      const list = blocked.length
        ? blocked.map(entry => `• <@${entry.user_id}>`).join('\n')
        : 'لا يوجد محظورين.';
      await message.reply(list);
      return;
    }
    if (!userId) {
      await message.reply('❌ يرجى تحديد العضو.');
      return;
    }
    if (sub === 'remove' || sub === 'unblock') {
      await ticketManager.unblockUser(userId);
      await message.reply(`✅ تم إزالة الحظر عن <@${userId}>`);
      return;
    }
    const reason = args.slice(sub ? 2 : 1).join(' ') || 'بدون سبب';
    await ticketManager.blockUser(userId, message.author.id, reason);
    await message.reply(`✅ تم حظر <@${userId}> من فتح التكتات.`);
    return;
  }

  if (commandToken === 'bord') {
    const points = await ticketManager.getPoints();
    const top = points.slice(0, 10);
    const list = top.length
      ? top.map((entry, index) => `${index + 1}. <@${entry.user_id}> → ${entry.total_points}`).join('\n')
      : 'لا يوجد نقاط مسجلة.';
    await message.reply(`🏆 **لوحة نقاط التكت**\n${list}`);
    return;
  }

  if (commandToken === 'tick') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    if (!isAdmin) {
      await message.reply('❌ هذا الأمر للإدارة فقط.');
      return;
    }
    await handleTicketAction({ ...message, channel: message.channel, guild: message.guild, user: message.author, reply: message.reply.bind(message) }, 'claim');
    return;
  }

  if (commandToken === 'tclose') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    if (!isAdmin && ticket.user_id !== message.author.id) {
      await message.reply('❌ هذا الأمر للإدارة أو صاحب التكت فقط.');
      return;
    }
    await handleTicketAction({ ...message, channel: message.channel, guild: message.guild, user: message.author, reply: message.reply.bind(message) }, 'close');
    return;
  }

  if (commandToken === 'tadd' || commandToken === 'tremove') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    const userId = parseUserId(args[0]);
    if (!userId) {
      await message.reply('❌ يرجى تحديد العضو.');
      return;
    }
    const allowKey = commandToken === 'tadd' ? 'allow_user_add' : 'allow_user_remove';
    if (!settings[allowKey] && !isAdmin && !isOwner) {
      await message.reply('❌ هذا الخيار غير مسموح حالياً.');
      return;
    }
    if (commandToken === 'tadd') {
      await message.channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
      await message.reply(`✅ تم إضافة <@${userId}>`);
    } else {
      await message.channel.permissionOverwrites.delete(userId).catch(() => {});
      await message.reply(`✅ تم حذف <@${userId}>`);
    }
    return;
  }

  if (commandToken === 'tname') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    if (!settings.allow_user_rename && !isAdmin && !isOwner) {
      await message.reply('❌ هذا الخيار غير مسموح حالياً.');
      return;
    }
    const newName = args.join('-');
    if (!newName) {
      await message.reply('❌ يرجى كتابة الاسم الجديد.');
      return;
    }
    await message.channel.setName(newName).catch(() => {});
    await message.reply(`✅ تم تغيير اسم التكت إلى ${newName}`);
    return;
  }

  if (commandToken === 'tchange') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    if (!isAdmin) {
      await message.reply('❌ هذا الأمر للإدارة فقط.');
      return;
    }
    const target = args.join(' ').trim();
    const responsibilities = global.responsibilities || {};
    if (!target || !responsibilities[target]) {
      await message.reply('❌ المسؤولية غير موجودة.');
      return;
    }
    await applyResponsibilityPermissions(message.channel, responsibilities[target]);
    await ticketManager.updateTicket(ticket.ticket_id, { responsibility: target });
    await message.reply(`✅ تم تحويل التكت إلى مسؤولية: ${target}`);
    return;
  }

  if (commandToken === 'remind') {
    if (!ticket) {
      await message.reply('❌ هذا الروم ليس تكت.');
      return;
    }
    if (!isAdmin) {
      await message.reply('❌ هذا الأمر للإدارة فقط.');
      return;
    }
    await message.channel.send(`🔔 <@${ticket.user_id}> تذكير بالتكت.`);
    await message.reply('✅ تم إرسال التذكير.');
    return;
  }

  if (commandToken === 'tlog') {
    await message.reply(`📌 روم اللوق: ${settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'غير محدد'}`);
    return;
  }

  if (commandToken === 'admins') {
    if (!isOwner) {
      await message.reply('❌ هذا الأمر للأونرز فقط.');
      return;
    }
    await message.reply('✅ افتح قائمة التكت للتحكم في رولات الإدارة.');
    return;
  }

  if (commandToken === 'treset') {
    if (!isOwner) {
      await message.reply('❌ هذا الأمر للأونرز فقط.');
      return;
    }
    await ticketManager.resetPoints();
    await ticketManager.resetManagerPoints();
    await message.reply('✅ تم تصفير النقاط.');
    return;
  }

  if (commandToken === 'point') {
    if (!isOwner) {
      await message.reply('❌ هذا الأمر للأونرز فقط.');
      return;
    }
    const userId = parseUserId(args[0]);
    const amount = parseInt(args[1], 10) || 1;
    if (!userId) {
      await message.reply('❌ يرجى تحديد العضو.');
      return;
    }
    await ticketManager.givePoints(userId, amount);
    await message.reply(`✅ تم إضافة ${amount} نقطة للعضو <@${userId}>`);
  }
}

module.exports = {
  name,
  execute,
  registerHandlers,
  aliases: [
    'embed',
    'tick',
    'tblcok',
    'tblock',
    'bord',
    'tadd',
    'tremove',
    'tchange',
    'tclose',
    'tlog',
    'tname',
    'remind',
    'admins',
    'treset',
    'point'
  ]
};
