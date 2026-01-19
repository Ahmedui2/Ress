const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getGuildConfig, updateGuildConfig, isManager, getRoleEntry, addRoleEntry, deleteRoleEntry, restoreRoleEntry, getGuildRoles, getDeletedRoles, formatDuration, getRoleResetDate } = require('../utils/customRolesSystem.js');
const { getDatabase } = require('../utils/database.js');
const fs = require('fs');
const path = require('path');
const myRoleCommand = require('./myrole.js');
const sroleCommand = require('./srole.js');
const listCommand = require('./list.js');

const activeTopSchedules = new Map();
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

function scheduleDelete(message, delay = 180000) {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delay);
}

function buildSettingsMenu(userId, client) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`customroles_settings_menu_${userId}`)
    .setPlaceholder('اختر إعداداً...')
    .addOptions([
      { label: 'إضافة/إزالة مسؤولين بالرولات', value: 'manager_roles', emoji: '🛡️' },
      { label: 'إضافة/إزالة مسؤولين بالأعضاء', value: 'manager_users', emoji: '👤' },
      { label: 'تحديد روم السجلات', value: 'log_channel', emoji: '📝' },
      { label: 'روم لوحة الطلبات', value: 'requests_channel', emoji: '📥' },
      { label: 'روم استقبال الطلبات', value: 'requests_inbox_channel', emoji: '📨' },
      { label: 'روم تحكم المسؤولين', value: 'admin_control_channel', emoji: '🧰' },
      { label: 'روم تحكم الأعضاء', value: 'member_control_channel', emoji: '🎛️' },
      { label: 'قائمة المسؤولين', value: 'managers_list', emoji: '👥' },
      { label: 'قائمة الشاتات', value: 'channels_list', emoji: '📋' },
      { label: 'إضافة شات مسموح', value: 'allow_channel_add', emoji: '✅' },
      { label: 'إزالة شات مسموح', value: 'allow_channel_remove', emoji: '➖' },
      { label: 'إضافة شات محظور', value: 'block_channel_add', emoji: '⛔' },
      { label: 'إزالة شات محظور', value: 'block_channel_remove', emoji: '🧹' },
      { label: 'ملخص حالة النظام', value: 'system_summary', emoji: '🧾' },
      { label: 'إرسال لوحة الأعضاء', value: 'send_member_panel', emoji: '🎛️' },
      { label: 'إرسال لوحة الإدارة', value: 'send_admin_panel', emoji: '🧰' },
      { label: 'إرسال لوحة الطلبات', value: 'send_request_panel', emoji: '📝' },
      { label: 'تحديد صور اللوحات', value: 'set_images', emoji: '🖼️' },
      { label: 'تصفير التفاعل', value: 'reset_activity', emoji: '♻️' },
      { label: 'تفعيل توب الرولات', value: 'top_roles', emoji: '🏆' }
    ]);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ إعدادات الرولات الخاصة')
    .setDescription('اختر العملية المطلوبة من القائمة.')
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(client.user.displayAvatarURL({ size: 128 }));

  return { embed, row: new ActionRowBuilder().addComponents(menu) };
}

function buildPanelEmbed(type, guild) {
  const color = colorManager.getColor ? colorManager.getColor() : '#2f3136';
  const thumbnail = guild?.client?.user?.displayAvatarURL({ size: 128 });
  switch (type) {
    case 'member':
      return new EmbedBuilder()
        .setTitle('🎛️ لوحة رولي')
        .setDescription('اختر العملية المناسبة لإدارة رولك بسرعة وسهولة.')
        .setColor(color)
        .setThumbnail(thumbnail);
    case 'admin':
      return new EmbedBuilder()
        .setTitle('🧰 لوحة الإدارة')
        .setDescription('تحكم سريع بالرولات الخاصة (إدارة، حذف، استرجاع، تصفير).')
        .setColor(color)
        .setThumbnail(thumbnail);
    case 'request':
      return new EmbedBuilder()
        .setTitle('📝 طلب رول خاص')
        .setDescription('قدّم طلبك وسيتم مراجعته من الإدارة.')
        .setColor(color)
        .setThumbnail(thumbnail);
    default:
      return new EmbedBuilder()
        .setTitle('🏆 توب الرولات الخاصة')
        .setDescription('أعلى الرولات بحسب التفاعل.')
        .setColor(color)
        .setThumbnail(thumbnail);
  }
}

function getPanelImageUrl(type, guildConfig) {
  if (type === 'member') return guildConfig.memberImage;
  if (type === 'admin') return guildConfig.adminImage;
  if (type === 'request') return guildConfig.requestImage;
  if (type === 'top') return guildConfig.topImage;
  return null;
}

function buildAdminSummaryEmbed(title, fields = []) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setTimestamp();
  if (fields.length) embed.addFields(fields);
  return embed;
}

function buildAdminRoleMenu(action, userId) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`customroles_admin_panel_select_${action}_${userId}`)
    .setPlaceholder('اختر رولاً...')
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder().addComponents(menu);
}

async function logRoleAction(guild, guildConfig, description, fields = []) {
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

function buildInteractionMessage(interaction) {
  return {
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    client: interaction.client
  };
}

function formatChannelList(channels = []) {
  if (!channels || channels.length === 0) return 'لا يوجد';
  return channels.map(id => `<#${id}>`).join('\n');
}

function normalizeUniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function loadAdminRoles() {
  try {
    if (!fs.existsSync(adminRolesPath)) return [];
    const data = fs.readFileSync(adminRolesPath, 'utf8');
    const roles = JSON.parse(data);
    return Array.isArray(roles) ? roles : [];
  } catch (error) {
    console.error('خطأ في قراءة adminRoles:', error);
    return [];
  }
}

async function buildPanelPayload(type, guild, guildConfig) {
  const imageUrl = getPanelImageUrl(type, guildConfig);
  const payload = {};

  if (type === 'top') {
    const embed = await buildTopRolesEmbed(guild, guildConfig);
    if (!imageUrl) payload.embeds = [embed];
    if (imageUrl) payload.files = [imageUrl];
    return payload;
  }

  if (!imageUrl) payload.embeds = [buildPanelEmbed(type, guild)];
  if (type === 'member') {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_member_action_manage').setLabel('إضافة/إزالة').setEmoji('➕').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('customroles_member_action_color').setLabel('تغيير اللون').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('customroles_member_action_icon').setLabel('تغيير الأيقونة').setEmoji('✨').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_member_action_members').setLabel('الأعضاء').setEmoji('👥').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('customroles_member_action_transfer').setLabel('نقل الملكية').setEmoji('🔁').setStyle(ButtonStyle.Danger)
      )
    ];
  }
  if (type === 'admin') {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_admin_panel_create').setLabel('إنشاء رول').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('customroles_admin_panel_add').setLabel('إضافة رول').setEmoji('🧷').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('customroles_admin_panel_delete').setLabel('حذف رول').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_admin_panel_info').setLabel('معلومات رول').setEmoji('ℹ️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('customroles_admin_panel_reset_role').setLabel('تصفير رول').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('customroles_admin_panel_reset_all').setLabel('تصفير الكل').setEmoji('🧹').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_admin_manage').setLabel('إدارة رول').setEmoji('🧰').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('customroles_admin_restore').setLabel('استرجاع رول').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      )
    ];
  }
  if (type === 'request') {
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('customroles_request_button').setLabel('طلب رول خاص').setEmoji('📨').setStyle(ButtonStyle.Success)
      )
    ];
  }

  if (imageUrl) {
    payload.files = [imageUrl];
  }

  return payload;
}

async function refreshPanelMessage(guild, guildConfig, type) {
  const channelIdMap = {
    member: guildConfig.memberControlChannelId,
    admin: guildConfig.adminControlChannelId,
    request: guildConfig.requestsChannelId,
    top: guildConfig.topChannelId
  };
  const messageIdMap = {
    member: guildConfig.memberPanelMessageId,
    admin: guildConfig.adminPanelMessageId,
    request: guildConfig.requestPanelMessageId,
    top: guildConfig.topMessageId
  };

  const channelId = channelIdMap[type];
  const messageId = messageIdMap[type];
  if (!channelId || !messageId) return false;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;

  const payload = await buildPanelPayload(type, guild, guildConfig);
  await message.edit({ ...payload, attachments: [] }).catch(() => {});
  return true;
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

function isDangerousRole(role) {
  if (!role) return true;
  const dangerousPerms = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers'];
  return role.permissions.toArray().some(perm => dangerousPerms.includes(perm));
}

async function sumActivity(userIds, resetDate) {
  if (!userIds || userIds.length === 0) return { voice: 0, messages: 0 };
  const dbManager = getDatabase();
  if (!dbManager || !dbManager.isInitialized) return { voice: 0, messages: 0 };

  const chunkSize = 800;
  let totalVoice = 0;
  let totalMessages = 0;

  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const params = [...chunk];
    let query = `SELECT SUM(voice_time) as voiceTime, SUM(messages) as messages FROM daily_activity WHERE user_id IN (${placeholders})`;
    if (resetDate) {
      query += ' AND date >= ?';
      params.push(resetDate);
    }
    const result = await dbManager.all(query, params);
    totalVoice += result[0]?.voiceTime || 0;
    totalMessages += result[0]?.messages || 0;
  }

  return { voice: totalVoice, messages: totalMessages };
}

async function sendMemberPanel(guild, channel, guildConfig) {
  const payload = await buildPanelPayload('member', guild, guildConfig);
  const message = await channel.send(payload);
  updateGuildConfig(guild.id, { memberControlChannelId: channel.id, memberPanelMessageId: message.id });
  return message;
}

async function sendAdminPanel(guild, channel, guildConfig) {
  const payload = await buildPanelPayload('admin', guild, guildConfig);
  const message = await channel.send(payload);
  updateGuildConfig(guild.id, { adminControlChannelId: channel.id, adminPanelMessageId: message.id });
  return message;
}

async function sendRequestPanel(guild, channel, guildConfig) {
  const payload = await buildPanelPayload('request', guild, guildConfig);
  const message = await channel.send(payload);
  updateGuildConfig(guild.id, { requestsChannelId: channel.id, requestPanelMessageId: message.id });
  return message;
}

async function sendTopRolesPanel(guild, channel, guildConfig) {
  const payload = await buildPanelPayload('top', guild, guildConfig);
  const message = await channel.send(payload);

  updateGuildConfig(guild.id, { topChannelId: channel.id, topMessageId: message.id, topEnabled: true });

  startTopSchedule(guild, channel, message.id);
}

async function buildTopRolesEmbed(guild, guildConfig) {
  const roles = getGuildRoles(guild.id);
  const thumbnail = guild?.client?.user?.displayAvatarURL({ size: 128 });

  const ranked = [];
  for (const roleEntry of roles) {
    const role = guild.roles.cache.get(roleEntry.roleId);
    if (!role) continue;
    const members = [...role.members.values()];
    const roleResetDate = getRoleResetDate(guildConfig, roleEntry.roleId);
    const activity = await sumActivity(members.map(member => member.id), roleResetDate);
    ranked.push({
      roleId: roleEntry.roleId,
      name: role.name,
      ownerId: roleEntry.ownerId,
      total: activity.voice + activity.messages,
      voice: activity.voice,
      messages: activity.messages
    });
  }

  ranked.sort((a, b) => b.total - a.total);

  const embed = new EmbedBuilder()
    .setTitle('🏆 توب الرولات الخاصة')
    .setDescription(ranked.slice(0, 10).map((role, index) => (
      `**${index + 1}. ${role.name}**\n` +
      `🔹 <@&${role.roleId}> | 👤 <@${role.ownerId}> | 💬 ${role.messages} رسالة | 🔊 ${formatDuration(role.voice)}`
    )).join('\n\n') || 'لا توجد بيانات بعد.')
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setTimestamp()
    .setThumbnail(thumbnail);

  return embed;
}

function startTopSchedule(guild, channel, messageId) {
  if (activeTopSchedules.has(guild.id)) {
    clearInterval(activeTopSchedules.get(guild.id));
  }

  const interval = setInterval(async () => {
    const guildConfig = getGuildConfig(guild.id);
    if (!guildConfig.topEnabled) return;
    const payload = await buildPanelPayload('top', guild, guildConfig);

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;
    await message.edit({ ...payload, attachments: [] }).catch(() => {});
  }, 180000);

  activeTopSchedules.set(guild.id, interval);
}

async function handleAdminRoleControl(message, targetRoleEntry) {
  const role = message.guild.roles.cache.get(targetRoleEntry.roleId);
  if (!role) {
    await message.reply('**❌ الرول غير موجود.**');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🧰 إدارة رول خاص')
    .setDescription(`الرول: <@&${role.id}>\nالمالك: <@${targetRoleEntry.ownerId}>`)
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`customroles_admin_delete_${role.id}_${message.author.id}`).setLabel('حذف الرول').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`customroles_admin_transfer_${role.id}_${message.author.id}`).setLabel('نقل الملكية').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`customroles_admin_remove_${role.id}_${message.author.id}`).setLabel('إزالة من القاعدة').setStyle(ButtonStyle.Secondary)
  );

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`customroles_admin_action_manage_${role.id}_${message.author.id}`).setLabel('إضافة/إزالة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`customroles_admin_action_color_${role.id}_${message.author.id}`).setLabel('تغيير اللون').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`customroles_admin_action_icon_${role.id}_${message.author.id}`).setLabel('تغيير الأيقونة').setStyle(ButtonStyle.Secondary)
  );

  const controlRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`customroles_admin_action_members_${role.id}_${message.author.id}`).setLabel('الأعضاء').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`customroles_admin_action_transfer_${role.id}_${message.author.id}`).setLabel('نقل الملكية').setStyle(ButtonStyle.Danger)
  );

  const sent = await message.channel.send({ embeds: [embed], components: [row, controlRow, controlRow2] });
  scheduleDelete(sent);
}

async function executeRolesSettings(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const guildConfig = getGuildConfig(message.guild.id);
  const hasPermission = isManager(message.member, guildConfig, BOT_OWNERS);
  if (!hasPermission) {
    await message.react('❌').catch(() => {});
    return;
  }

  const roleMention = message.mentions.roles.first();
  const userMention = message.mentions.users.first();
  const idArg = args.find(arg => /^\d{17,19}$/.test(arg));

  if (roleMention || userMention || idArg) {
    const roleId = roleMention?.id || (idArg && message.guild.roles.cache.has(idArg) ? idArg : null);
    const targetOwnerId = userMention?.id || (!roleId && idArg ? idArg : null);

    let roleEntry = roleId ? getRoleEntry(roleId) : null;
    if (!roleEntry && targetOwnerId) {
      roleEntry = getGuildRoles(message.guild.id).find(entry => entry.ownerId === targetOwnerId) || null;
    }

    if (!roleEntry && roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (!role || isDangerousRole(role)) {
        await message.reply('**❌ لا يمكن إضافة هذا الرول ضمن الرولات الخاصة.**');
        return;
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`customroles_add_${roleId}_${message.author.id}`).setLabel('إضافة للقاعدة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`customroles_add_cancel_${roleId}_${message.author.id}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
      );

      await message.channel.send({ content: '**هذا الرول غير موجود في القاعدة، هل تريد إضافته؟**', components: [confirmRow] });
      return;
    }

    if (!roleEntry) {
      await message.reply('**❌ لم يتم العثور على رول خاص مطابق.**');
      return;
    }

    await handleAdminRoleControl(message, roleEntry);
    return;
  }

  const { embed, row } = buildSettingsMenu(message.author.id, message.client);
  const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = sentMessage.createMessageComponentCollector({
    filter: interaction => interaction.user.id === message.author.id,
    time: 120000
  });

  collector.on('collect', async interaction => {
    if (interaction.isRoleSelectMenu() && interaction.customId === `customroles_manager_roles_${message.author.id}`) {
      updateGuildConfig(message.guild.id, { managerRoleIds: interaction.values });
      await interaction.update({ content: '✅ تم تحديث رولات المسؤولين.', embeds: [embed], components: [row] });
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === `customroles_manager_users_${message.author.id}`) {
      updateGuildConfig(message.guild.id, { managerUserIds: interaction.values });
      await interaction.update({ content: '✅ تم تحديث المسؤولين بالأعضاء.', embeds: [embed], components: [row] });
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('customroles_config_channel_')) {
      const payload = interaction.customId.replace('customroles_config_channel_', '');
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

      await interaction.update({ content: '✅ تم حفظ الروم بنجاح.', embeds: [embed], components: [row] });
      return;
    }

    if (!interaction.isStringSelectMenu()) return;

    const selection = interaction.values[0];
    if (selection === 'manager_roles') {
      const roleMenu = new RoleSelectMenuBuilder()
        .setCustomId(`customroles_manager_roles_${message.author.id}`)
        .setPlaceholder('اختر رولات المسؤولين...')
        .setMinValues(1)
        .setMaxValues(10);

      await interaction.update({
        content: 'اختر رولات المسؤولين:',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(roleMenu)]
      });
      return;
    }

    if (selection === 'manager_users') {
      const userMenu = new UserSelectMenuBuilder()
        .setCustomId(`customroles_manager_users_${message.author.id}`)
        .setPlaceholder('اختر المسؤولين بالأعضاء...')
        .setMinValues(1)
        .setMaxValues(10);

      await interaction.update({
        content: 'اختر المسؤولين بالأعضاء:',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(userMenu)]
      });
      return;
    }

    if (selection === 'log_channel' || selection === 'requests_channel' || selection === 'requests_inbox_channel' || selection === 'admin_control_channel' || selection === 'member_control_channel') {
      const channelMenu = new ChannelSelectMenuBuilder()
        .setCustomId(`customroles_config_channel_${selection}_${message.author.id}`)
        .setPlaceholder('اختر الروم...')
        .addChannelTypes(ChannelType.GuildText);

      await interaction.update({
        content: 'اختر الروم المطلوب:',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(channelMenu)]
      });
      return;
    }

    if (selection === 'send_member_panel' || selection === 'send_admin_panel' || selection === 'send_request_panel' || selection === 'top_roles') {
      const channelMenu = new ChannelSelectMenuBuilder()
        .setCustomId(`customroles_channel_${selection}_${message.author.id}`)
        .setPlaceholder('اختر الروم...')
        .addChannelTypes(ChannelType.GuildText);

      await interaction.update({
        content: 'اختر الروم المطلوب:',
        embeds: [],
        components: [new ActionRowBuilder().addComponents(channelMenu)]
      });
      return;
    }

    if (selection === 'set_images') {
      await interaction.deferUpdate();
      const choiceMessage = await message.channel.send('اكتب نوع الصورة: member / admin / request / top ثم الرابط أو أرفق صورة.');
      scheduleDelete(choiceMessage);
      const response = await message.channel.awaitMessages({
        filter: msg => msg.author.id === message.author.id,
        max: 1,
        time: 60000
      });
      const msg = response.first();
      if (!msg) return;
      const [type, url] = msg.content.split(/\s+/);
      const imageUrl = msg.attachments.first()?.url || url;
      if (!imageUrl) {
        const errorMessage = await message.channel.send('❌ لم يتم العثور على رابط صورة.');
        scheduleDelete(errorMessage);
        return;
      }

      let targetType = null;
      if (type === 'member') {
        updateGuildConfig(message.guild.id, { memberImage: imageUrl });
        targetType = 'member';
      }
      if (type === 'admin') {
        updateGuildConfig(message.guild.id, { adminImage: imageUrl });
        targetType = 'admin';
      }
      if (type === 'request') {
        updateGuildConfig(message.guild.id, { requestImage: imageUrl });
        targetType = 'request';
      }
      if (type === 'top') {
        updateGuildConfig(message.guild.id, { topImage: imageUrl });
        targetType = 'top';
      }

      if (!targetType) {
        const errorMessage = await message.channel.send('❌ نوع الصورة غير معروف.');
        scheduleDelete(errorMessage);
        return;
      }

      await refreshPanelMessage(message.guild, getGuildConfig(message.guild.id), targetType);
      const successMessage = await message.channel.send('✅ تم حفظ الصورة وتحديث اللوحة بنجاح.');
      scheduleDelete(successMessage);
      await sentMessage.edit({ embeds: [embed], components: [row] }).catch(() => {});
      return;
    }

    if (selection === 'reset_activity') {
      updateGuildConfig(message.guild.id, { activityResetAt: Date.now() });
      await interaction.update({ content: '✅ تم تصفير تفاعل الرولات الخاصة.', embeds: [embed], components: [row] });
      return;
    }

    if (selection === 'managers_list') {
      const managerRoles = guildConfig.managerRoleIds || [];
      const managerUsers = guildConfig.managerUserIds || [];
      const managersEmbed = new EmbedBuilder()
        .setTitle('👥 قائمة المسؤولين')
        .setDescription('ملخص المسؤولين عبر الرولات والأعضاء.')
        .addFields(
          { name: 'الرولات', value: managerRoles.length ? managerRoles.map(id => `<@&${id}>`).join('\n') : 'لا يوجد', inline: false },
          { name: 'الأعضاء', value: managerUsers.length ? managerUsers.map(id => `<@${id}>`).join('\n') : 'لا يوجد', inline: false }
        )
        .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
        .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));
      await interaction.update({ embeds: [managersEmbed], components: [row] });
      return;
    }

    if (selection === 'channels_list') {
      const channelsEmbed = new EmbedBuilder()
        .setTitle('📋 قائمة الشاتات')
        .setDescription('ملخص رومات النظام والإعدادات الحالية.')
        .addFields(
          { name: 'روم السجلات', value: guildConfig.logChannelId ? `<#${guildConfig.logChannelId}>` : 'غير محدد', inline: true },
          { name: 'لوحة الطلبات', value: guildConfig.requestsChannelId ? `<#${guildConfig.requestsChannelId}>` : 'غير محدد', inline: true },
          { name: 'استقبال الطلبات', value: guildConfig.requestInboxChannelId ? `<#${guildConfig.requestInboxChannelId}>` : 'غير محدد', inline: true },
          { name: 'لوحة الإدارة', value: guildConfig.adminControlChannelId ? `<#${guildConfig.adminControlChannelId}>` : 'غير محدد', inline: true },
          { name: 'لوحة الأعضاء', value: guildConfig.memberControlChannelId ? `<#${guildConfig.memberControlChannelId}>` : 'غير محدد', inline: true },
          { name: 'روم التوب', value: guildConfig.topChannelId ? `<#${guildConfig.topChannelId}>` : 'غير محدد', inline: true },
          { name: 'شاتات مسموح بها', value: formatChannelList(guildConfig.allowedChannels), inline: false },
          { name: 'شاتات محظورة', value: formatChannelList(guildConfig.blockedChannels), inline: false }
        )
        .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
        .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));
      await interaction.update({ embeds: [channelsEmbed], components: [row] });
      return;
    }

    if (selection === 'system_summary') {
      const rolesCount = getGuildRoles(message.guild.id).length;
      const summaryEmbed = new EmbedBuilder()
        .setTitle('🧾 ملخص حالة النظام')
        .setDescription('ملخص سريع لحالة الرولات الخاصة والإعدادات.')
        .addFields(
          { name: 'عدد الرولات الخاصة', value: `${rolesCount}`, inline: true },
          { name: 'عدد المسؤولين', value: `${(guildConfig.managerRoleIds || []).length + (guildConfig.managerUserIds || []).length}`, inline: true },
          { name: 'التوب', value: guildConfig.topEnabled ? 'مفعل' : 'غير مفعل', inline: true },
          { name: 'لوحة الطلبات', value: guildConfig.requestsChannelId ? `<#${guildConfig.requestsChannelId}>` : 'غير محدد', inline: true },
          { name: 'لوحة الإدارة', value: guildConfig.adminControlChannelId ? `<#${guildConfig.adminControlChannelId}>` : 'غير محدد', inline: true },
          { name: 'لوحة الأعضاء', value: guildConfig.memberControlChannelId ? `<#${guildConfig.memberControlChannelId}>` : 'غير محدد', inline: true }
        )
        .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
        .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));
      await interaction.update({ embeds: [summaryEmbed], components: [row] });
      return;
    }

    if (['allow_channel_add', 'allow_channel_remove', 'block_channel_add', 'block_channel_remove'].includes(selection)) {
      const isAllowList = selection.includes('allow_channel');
      const isRemove = selection.includes('remove');
      const menu = new ChannelSelectMenuBuilder()
        .setCustomId(`customroles_channel_manage_${selection}_${interaction.user.id}`)
        .setPlaceholder(isAllowList ? 'اختر الشات...' : 'اختر الشات...')
        .setMinValues(1)
        .setMaxValues(25)
        .addChannelTypes(ChannelType.GuildText);
      const notice = isAllowList
        ? (isRemove ? 'اختر الشاتات لإزالتها من المسموح.' : 'اختر الشاتات لإضافتها كمسموح.')
        : (isRemove ? 'اختر الشاتات لإزالتها من المحظور.' : 'اختر الشاتات لإضافتها كمحظور.');
      await interaction.update({ content: notice, embeds: [], components: [new ActionRowBuilder().addComponents(menu), row] });
      return;
    }
  });
}

async function handleCustomRolesInteraction(interaction, client, BOT_OWNERS) {
  if (interaction.replied || interaction.deferred) return;

  const guildConfig = interaction.guild ? getGuildConfig(interaction.guild.id) : null;
  const isAdminUser = guildConfig ? isManager(interaction.member, guildConfig, BOT_OWNERS) : false;

  if (interaction.customId.startsWith('customroles_member_action_')) {
    const action = interaction.customId.replace('customroles_member_action_', '');
    await myRoleCommand.handleMemberAction(interaction, action, client);
    return;
  }

  if (interaction.customId.startsWith('customroles_admin_panel_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    const action = interaction.customId.replace('customroles_admin_panel_', '');

    if (action === 'create') {
      const fakeMessage = {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        client: interaction.client
      };
      await sroleCommand.startCreateFlow({ message: fakeMessage, args: [], client, BOT_OWNERS, ownerIdOverride: interaction.user.id });
      await interaction.reply({ content: '✅ تم فتح إنشاء الرول في هذه القناة.', ephemeral: true });
      return;
    }

    if (action === 'reset_all') {
      updateGuildConfig(interaction.guild.id, { activityResetAt: Date.now() });
      await interaction.reply({
        embeds: [buildAdminSummaryEmbed('✅ تم تصفير التفاعل بالكامل.', [
          { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
        ])],
        ephemeral: true
      });
      await logRoleAction(interaction.guild, guildConfig, 'تم تصفير تفاعل جميع الرولات الخاصة.', [
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ]);
      return;
    }

    await interaction.reply({
      content: 'اختر الرول المطلوب:',
      components: [buildAdminRoleMenu(action, interaction.user.id)],
      ephemeral: true
    });
    return;
  }

  if (interaction.customId.startsWith('customroles_owner_left_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const parts = interaction.customId.split('_');
    const action = parts[3];
    const roleId = parts[4];
    const ownerId = parts[5];
    const roleEntry = getRoleEntry(roleId);
    if (!roleEntry) {
      await interaction.message.edit({
        embeds: [buildAdminSummaryEmbed('❌ لم يتم العثور على الرول.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true }
        ])],
        components: []
      }).catch(() => {});
      return;
    }

    if (action === 'keep') {
      await interaction.message.edit({
        embeds: [buildAdminSummaryEmbed('✅ تم إلغاء الإجراء.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${ownerId}>`, inline: true }
        ])],
        components: []
      }).catch(() => {});
      return;
    }

    if (action === 'delete') {
      const role = interaction.guild.roles.cache.get(roleId);
      if (role && !role.editable) {
        await interaction.message.edit({
          embeds: [buildAdminSummaryEmbed('❌ لا يمكن حذف الرول بسبب صلاحيات البوت.', [
            { name: 'الرول', value: `<@&${roleId}>`, inline: true }
          ])],
          components: []
        }).catch(() => {});
        return;
      }
      if (role) {
        await role.delete(`حذف رول خاص بعد مغادرة المالك ${ownerId}`).catch(() => {});
      }
      deleteRoleEntry(roleId, interaction.user.id);
      await interaction.client.users.fetch(ownerId)
        .then(user => user.send('🗑️ تم حذف رولك الخاص بعد مغادرتك السيرفر.').catch(() => {}))
        .catch(() => {});
      await interaction.message.edit({
        embeds: [buildAdminSummaryEmbed('✅ تم حذف الرول.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${ownerId}>`, inline: true },
          { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
        ])],
        components: []
      }).catch(() => {});
      await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم حذف رول خاص بعد مغادرة المالك.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'المالك', value: `<@${ownerId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ]);
      return;
    }
  }

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('customroles_channel_manage_')) {
    const payload = interaction.customId.replace('customroles_channel_manage_', '');
    const parts = payload.split('_');
    const action = parts.slice(0, -1).join('_');
    const requesterId = parts[parts.length - 1];
    if (requesterId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا الاختيار ليس لك.', ephemeral: true });
      return;
    }
    const guildConfig = getGuildConfig(interaction.guild.id);
    const channelIds = interaction.values;
    const allowList = normalizeUniqueIds(guildConfig.allowedChannels || []);
    const blockList = normalizeUniqueIds(guildConfig.blockedChannels || []);

    if (action === 'allow_channel_add') {
      updateGuildConfig(interaction.guild.id, {
        allowedChannels: normalizeUniqueIds([...allowList, ...channelIds])
      });
      await interaction.update({ content: '✅ تم إضافة الشاتات للمسموح.', components: [] });
      return;
    }

    if (action === 'allow_channel_remove') {
      updateGuildConfig(interaction.guild.id, {
        allowedChannels: allowList.filter(id => !channelIds.includes(id))
      });
      await interaction.update({ content: '✅ تم إزالة الشاتات من المسموح.', components: [] });
      return;
    }

    if (action === 'block_channel_add') {
      updateGuildConfig(interaction.guild.id, {
        blockedChannels: normalizeUniqueIds([...blockList, ...channelIds])
      });
      await interaction.update({ content: '✅ تم إضافة الشاتات للمحظور.', components: [] });
      return;
    }

    if (action === 'block_channel_remove') {
      updateGuildConfig(interaction.guild.id, {
        blockedChannels: blockList.filter(id => !channelIds.includes(id))
      });
      await interaction.update({ content: '✅ تم إزالة الشاتات من المحظور.', components: [] });
      return;
    }
  }

  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('customroles_admin_panel_select_')) {
    const payload = interaction.customId.replace('customroles_admin_panel_select_', '');
    const lastUnderscore = payload.lastIndexOf('_');
    const action = payload.slice(0, lastUnderscore);
    const requesterId = payload.slice(lastUnderscore + 1);
    if (requesterId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا الاختيار ليس لك.', ephemeral: true });
      return;
    }
    const roleId = interaction.values[0];
    await interaction.deferReply({ ephemeral: true });

    if (action === 'add') {
      const roleEntry = getRoleEntry(roleId);
      if (roleEntry) {
        await handleAdminRoleControl(buildInteractionMessage(interaction), roleEntry);
        await interaction.editReply({
          embeds: [buildAdminSummaryEmbed('✅ تم عرض لوحة التحكم.', [
            { name: 'الرول', value: `<@&${roleId}>`, inline: true },
            { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true }
          ])]
        });
        return;
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role || isDangerousRole(role)) {
        await interaction.editReply({ content: '❌ لا يمكن إضافة هذا الرول ضمن الرولات الخاصة.' });
        return;
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`customroles_add_${roleId}_${interaction.user.id}`).setLabel('إضافة للقاعدة').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`customroles_add_cancel_${roleId}_${interaction.user.id}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
      );
      await interaction.editReply({ content: 'هذا الرول غير موجود في القاعدة، هل تريد إضافته؟', components: [confirmRow] });
      return;
    }

    if (action === 'delete') {
      const roleEntry = getRoleEntry(roleId);
      if (!roleEntry) {
        await interaction.editReply({ content: '❌ هذا الرول غير مسجل كرول خاص.' });
        return;
      }
      await handleAdminRoleControl(buildInteractionMessage(interaction), roleEntry);
      await interaction.editReply({
        embeds: [buildAdminSummaryEmbed('✅ تم عرض لوحة التحكم.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true }
        ])]
      });
      return;
    }

    if (action === 'info') {
      const roleEntry = getRoleEntry(roleId);
      if (!roleEntry) {
        await interaction.editReply({ content: '❌ هذا الرول غير مسجل كرول خاص.' });
        return;
      }
      const infoMessage = await listCommand.renderRoleDetails({ guild: interaction.guild, channel: interaction.channel, client: interaction.client }, roleEntry);
      scheduleDelete(infoMessage);
      await interaction.editReply({
        embeds: [buildAdminSummaryEmbed('✅ تم إرسال المعلومات.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true }
        ])]
      });
      await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم طلب معلومات رول خاص.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ]);
      return;
    }

    if (action === 'reset_role') {
      const roleEntry = getRoleEntry(roleId);
      if (!roleEntry) {
        await interaction.editReply({ content: '❌ هذا الرول غير مسجل كرول خاص.' });
        return;
      }
      const guildConfig = getGuildConfig(interaction.guild.id);
      guildConfig.roleActivityResetAt = guildConfig.roleActivityResetAt || {};
      guildConfig.roleActivityResetAt[roleId] = Date.now();
      updateGuildConfig(interaction.guild.id, { roleActivityResetAt: guildConfig.roleActivityResetAt });
      await interaction.editReply({
        embeds: [buildAdminSummaryEmbed('✅ تم تصفير تفاعل الرول.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
        ])]
      });
      await logRoleAction(interaction.guild, guildConfig, 'تم تصفير تفاعل رول خاص.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ]);
      return;
    }

    if (action === 'manage') {
      const roleEntry = getRoleEntry(roleId);
      if (!roleEntry) {
        await interaction.editReply({ content: '❌ هذا الرول غير مسجل كرول خاص.' });
        return;
      }
      await handleAdminRoleControl(buildInteractionMessage(interaction), roleEntry);
      await interaction.editReply({
        embeds: [buildAdminSummaryEmbed('✅ تم إرسال لوحة التحكم.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${roleEntry.ownerId}>`, inline: true }
        ])]
      });
      return;
    }

    await interaction.editReply({ content: '❌ خيار غير معروف.' });
    return;
  }

  if (interaction.customId.startsWith('customroles_admin_action_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    const parts = interaction.customId.split('_');
    const action = parts[3];
    const roleId = parts[4];
    const requesterId = parts[5];
    if (requesterId && requesterId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا الزر ليس لك.', ephemeral: true });
      return;
    }
    const roleEntry = getRoleEntry(roleId);
    if (!roleEntry) {
      await interaction.reply({ content: '❌ هذا الرول غير مسجل كرول خاص.', ephemeral: true });
      return;
    }
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.reply({ content: '❌ لم يتم العثور على الرول في السيرفر.', ephemeral: true });
      return;
    }
    await myRoleCommand.runRoleAction({ interaction, action, roleEntry, role, panelMessage: interaction.message });
    return;
  }

  if (interaction.customId === 'customroles_admin_manage') {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.reply({
      content: 'اختر الرول المطلوب لإدارته:',
      components: [buildAdminRoleMenu('manage', interaction.user.id)],
      ephemeral: true
    });
    return;
  }

  if (interaction.customId === 'customroles_admin_restore') {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const deleted = getDeletedRoles(interaction.guild.id);
    if (deleted.length === 0) {
      await interaction.editReply({ content: '❌ لا توجد رولات محذوفة.' });
      return;
    }
    const options = deleted.slice(0, 25).map(entry => ({
      label: entry.name || entry.roleId,
      value: entry.roleId,
      description: `مالك: ${entry.ownerId}`
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`customroles_restore_select_${interaction.user.id}`)
      .setPlaceholder('اختر رولاً للاسترجاع...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);
    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.editReply({ content: 'اختر الرول المطلوب لاسترجاعه:', components: [row] });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('customroles_restore_select_')) {
    const targetUserId = interaction.customId.split('_').pop();
    if (targetUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا الاختيار ليس لك.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const roleId = interaction.values[0];
    const restored = restoreRoleEntry(roleId);
    if (restored) {
      await interaction.editReply({
        embeds: [buildAdminSummaryEmbed('✅ تم استرجاع الرول.', [
          { name: 'الرول', value: `<@&${roleId}>`, inline: true },
          { name: 'المالك', value: `<@${restored.ownerId}>`, inline: true }
        ])],
        components: []
      });
      await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم استرجاع رول خاص من المحذوفات.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ]);
    } else {
      await interaction.editReply({ content: '❌ تعذر استرجاع الرول.', components: [] });
    }
    return;
  }

  if (interaction.customId === 'customroles_request_button') {
    const adminRoles = loadAdminRoles();
    if (!adminRoles.length) {
      await interaction.reply({ content: '❌ لم يتم تحديد رولات الإدارة بعد.', ephemeral: true });
      return;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const hasAdminRole = member ? member.roles.cache.some(role => adminRoles.includes(role.id)) : false;
    if (!hasAdminRole) {
      await interaction.reply({ content: '❌ هذا الزر مخصص لرولات الإدارة فقط.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId('customroles_request_modal')
      .setTitle('طلب رول خاص');

    const nameInput = new TextInputBuilder()
      .setCustomId('role_name')
      .setLabel('اسم الرول المطلوب')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const reasonInput = new TextInputBuilder()
      .setCustomId('role_reason')
      .setLabel('سبب الطلب (اختياري)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'customroles_request_modal') {
    await interaction.deferReply({ ephemeral: true });
    const guildConfig = getGuildConfig(interaction.guild.id);
    if (!guildConfig.requestInboxChannelId) {
      await interaction.editReply({ content: '❌ لم يتم تحديد روم استقبال الطلبات.' });
      return;
    }

    const roleName = interaction.fields.getTextInputValue('role_name');
    const reason = interaction.fields.getTextInputValue('role_reason');
    const requestChannel = await interaction.guild.channels.fetch(guildConfig.requestInboxChannelId).catch(() => null);
    if (!requestChannel) {
      await interaction.editReply({ content: '❌ روم استقبال الطلبات غير موجود.' });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📥 طلب رول خاص')
      .setDescription(`العضو: <@${interaction.user.id}>`)
      .addFields(
        { name: 'الرول المطلوب', value: roleName },
        { name: 'السبب', value: reason || 'بدون سبب' }
      )
      .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 128 }));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`customroles_request_approve_${interaction.user.id}`).setLabel('موافقة').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`customroles_request_reject_${interaction.user.id}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
    );

    await requestChannel.send({ embeds: [embed], components: [row] });
    await interaction.editReply({ content: '✅ تم إرسال طلبك للمراجعة.' });
    return;
  }

  if (interaction.customId.startsWith('customroles_request_approve_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const userId = interaction.customId.split('_')[3];
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const roleNameField = interaction.message.embeds[0]?.fields?.find(field => field.name === 'الرول المطلوب');
    const roleName = roleNameField?.value || `رول-${member.user.username}`;

    const role = await interaction.guild.roles.create({
      name: roleName,
      reason: `موافقة على طلب رول خاص ${member.user.tag}`
    }).catch(() => null);

    if (!role) {
      await interaction.message.edit({ content: '❌ فشل إنشاء الرول. تحقق من الصلاحيات.', components: [] });
      return;
    }

    const roleAddResult = await member.roles.add(role, 'منح رول خاص عبر الطلب').catch(() => null);
    if (!roleAddResult) {
      await interaction.message.edit({ content: '⚠️ تم إنشاء الرول لكن تعذر منحه للعضو.', components: [] });
    }

    addRoleEntry(role.id, {
      roleId: role.id,
      guildId: interaction.guild.id,
      ownerId: member.id,
      createdAt: Date.now(),
      createdBy: interaction.user.id,
      name: role.name,
      color: role.hexColor,
      icon: role.iconURL(),
      maxMembers: null
    });

    await member.send(`✅ تمت الموافقة على طلبك وتم إنشاء الرول الخاص بك: **${role.name}**`).catch(() => {});
    await interaction.message.edit({ content: '✅ تمت الموافقة على الطلب.', components: [] });
    return;
  }

  if (interaction.customId.startsWith('customroles_request_reject_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`customroles_reject_modal_${interaction.customId.split('_')[3]}`)
      .setTitle('سبب الرفض');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reject_reason')
      .setLabel('اذكر سبب الرفض')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith('customroles_reject_modal_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.customId.split('_')[3];
    const reason = interaction.fields.getTextInputValue('reject_reason');
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.send(`❌ تم رفض طلب الرول الخاص. السبب: ${reason}`).catch(() => {});
    }
    await interaction.editReply({ content: '✅ تم إرسال سبب الرفض.' });
    return;
  }

  if (interaction.customId.startsWith('customroles_add_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const parts = interaction.customId.split('_');
    const roleId = parts[2];
    const guildConfig = getGuildConfig(interaction.guild.id);
    const hasPermission = isManager(interaction.member, guildConfig, BOT_OWNERS);
    if (!hasPermission) return;

    const response = await promptForMessage(interaction.channel, interaction.user.id, '**منشن مالك الرول الجديد أو اكتب ID:**');
    if (!response) return;
    const ownerId = response.mentions.users.first()?.id || response.content.match(/\d{17,19}/)?.[0];
    if (!ownerId) return;

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await interaction.followUp({ content: '**❌ الرول غير موجود في السيرفر.**', ephemeral: true });
      return;
    }

    addRoleEntry(role.id, {
      roleId: role.id,
      guildId: interaction.guild.id,
      ownerId,
      createdAt: Date.now(),
      createdBy: interaction.user.id,
      name: role.name,
      color: role.hexColor,
      icon: role.iconURL(),
      maxMembers: null
    });

    await interaction.followUp({
      embeds: [buildAdminSummaryEmbed('✅ تم إضافة الرول للقاعدة.', [
        { name: 'الرول', value: `<@&${role.id}>`, inline: true },
        { name: 'المالك', value: `<@${ownerId}>`, inline: true }
      ])],
      ephemeral: true
    });
    await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم إضافة رول خاص للقاعدة.', [
      { name: 'الرول', value: `<@&${role.id}>`, inline: true },
      { name: 'المالك', value: `<@${ownerId}>`, inline: true },
      { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    return;
  }

  if (interaction.customId.startsWith('customroles_add_cancel_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.edit({ content: 'تم إلغاء الإضافة.', components: [] }).catch(() => {});
    return;
  }

  if (interaction.customId.startsWith('customroles_admin_delete_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const roleId = interaction.customId.split('_')[3];
    const roleEntry = getRoleEntry(roleId);
    const role = interaction.guild.roles.cache.get(roleId);
    if (role) {
      if (!role.editable) {
        await interaction.message.edit({ content: '❌ لا يمكن حذف هذا الرول بسبب صلاحيات البوت.', components: [] });
        return;
      }
      await role.delete(`حذف رول خاص بواسطة ${interaction.user.tag}`).catch(() => {});
    }
    deleteRoleEntry(roleId, interaction.user.id);
    if (roleEntry?.ownerId) {
      await interaction.client.users.fetch(roleEntry.ownerId)
        .then(user => user.send('🗑️ تم حذف رولك الخاص بواسطة الإدارة.').catch(() => {}))
        .catch(() => {});
    }
    await interaction.message.edit({
      embeds: [buildAdminSummaryEmbed('✅ تم حذف الرول.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ])],
      components: []
    });
    await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم حذف رول خاص.', [
      { name: 'الرول', value: `<@&${roleId}>`, inline: true },
      { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    return;
  }

  if (interaction.customId.startsWith('customroles_admin_transfer_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const roleId = interaction.customId.split('_')[3];
    const response = await promptForMessage(interaction.channel, interaction.user.id, '**منشن المالك الجديد أو اكتب ID:**');
    if (!response) return;
    const ownerId = response.mentions.users.first()?.id || response.content.match(/\d{17,19}/)?.[0];
    if (!ownerId) return;

    const roleEntry = getRoleEntry(roleId);
    if (!roleEntry) {
      await interaction.followUp({ content: '❌ هذا الرول غير مسجل في القاعدة.', ephemeral: true });
      return;
    }
    roleEntry.ownerId = ownerId;
    addRoleEntry(roleId, roleEntry);

    const member = await interaction.guild.members.fetch(ownerId).catch(() => null);
    if (member) {
      await member.roles.add(roleId, 'نقل ملكية رول خاص').catch(() => {});
    }
    await interaction.followUp({
      embeds: [buildAdminSummaryEmbed('✅ تم نقل الملكية بنجاح.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'المالك الجديد', value: `<@${ownerId}>`, inline: true }
      ])],
      ephemeral: true
    });
    await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تم نقل ملكية رول خاص.', [
      { name: 'الرول', value: `<@&${roleId}>`, inline: true },
      { name: 'المالك الجديد', value: `<@${ownerId}>`, inline: true },
      { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    return;
  }

  if (interaction.customId.startsWith('customroles_admin_remove_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    await interaction.deferUpdate();
    const roleId = interaction.customId.split('_')[3];
    deleteRoleEntry(roleId, interaction.user.id);
    await interaction.followUp({
      embeds: [buildAdminSummaryEmbed('✅ تم إزالة الرول من قاعدة البيانات.', [
        { name: 'الرول', value: `<@&${roleId}>`, inline: true },
        { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
      ])],
      ephemeral: true
    });
    await logRoleAction(interaction.guild, getGuildConfig(interaction.guild.id), 'تمت إزالة رول خاص من القاعدة.', [
      { name: 'الرول', value: `<@&${roleId}>`, inline: true },
      { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    return;
  }

  if (interaction.customId.startsWith('customroles_channel_')) {
    if (!isAdminUser) {
      await interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });
      return;
    }
    const payload = interaction.customId.replace('customroles_channel_', '');
    const parts = payload.split('_');
    const targetUserId = parts.pop();
    if (targetUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا الخيار ليس لك.', ephemeral: true });
      return;
    }
    const selection = parts.join('_');
    await interaction.deferUpdate();
    const channelId = interaction.values[0];
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const guildConfig = getGuildConfig(interaction.guild.id);
    if (selection === 'send_member_panel') {
      await sendMemberPanel(interaction.guild, channel, guildConfig);
    }
    if (selection === 'send_admin_panel') {
      await sendAdminPanel(interaction.guild, channel, guildConfig);
    }
    if (selection === 'send_request_panel') {
      await sendRequestPanel(interaction.guild, channel, guildConfig);
    }
    if (selection === 'top_roles') {
      await sendTopRolesPanel(interaction.guild, channel, guildConfig);
    }

    const { embed, row } = buildSettingsMenu(interaction.user.id, interaction.client);

    await interaction.message.edit({ embeds: [embed], components: [row] }).catch(() => {});
    await interaction.followUp({
      embeds: [buildAdminSummaryEmbed('✅ تم إرسال اللوحة بنجاح.', [
        { name: 'اللوحة', value: selection, inline: true },
        { name: 'الروم', value: `<#${channelId}>`, inline: true }
      ])],
      ephemeral: true
    });
    await logRoleAction(interaction.guild, guildConfig, 'تم إرسال لوحة رولات خاصة.', [
      { name: 'اللوحة', value: selection, inline: true },
      { name: 'الروم', value: `<#${channelId}>`, inline: true },
      { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    return;
  }
}

function restoreTopSchedules(client) {
  const configData = require('../utils/customRolesSystem.js').getConfigData();
  for (const [guildId, config] of Object.entries(configData)) {
    if (!config.topEnabled || !config.topChannelId || !config.topMessageId) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(config.topChannelId);
    if (!channel) continue;
    startTopSchedule(guild, channel, config.topMessageId);
  }
}

module.exports = {
  executeRolesSettings,
  handleCustomRolesInteraction,
  restoreTopSchedules
};
