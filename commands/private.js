const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');
const dns = require('dns');
const net = require('net');
const fs = require('fs');
const path = require('path');
const interactionRouter = require('../utils/interactionRouter.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');

const name = 'private';
const DATA_PATH = path.join(__dirname, '..', 'data', 'privateSystem.json');
const requestLocks = new Set();
let pendingWriteTimer = null;
let pendingWritePayload = null;
let isWritingData = false;

function drawRoundedRect(ctx, x, y, width, height, radius = 12) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      const def = { guilds: {} };
      fs.writeFileSync(DATA_PATH, JSON.stringify(def, null, 2));
      return def;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (!parsed.guilds) parsed.guilds = {};
    return parsed;
  } catch (e) {
    console.error('private loadData error:', e);
    return { guilds: {} };
  }
}

function flushDataWrite() {
  if (isWritingData || !pendingWritePayload) {
    return;
  }

  isWritingData = true;
  const payload = pendingWritePayload;
  pendingWritePayload = null;

  fs.promises.writeFile(DATA_PATH, payload)
    .catch((error) => {
      console.error('private saveData error:', error);
    })
    .finally(() => {
      isWritingData = false;
      if (pendingWritePayload && !pendingWriteTimer) {
        pendingWriteTimer = setTimeout(() => {
          pendingWriteTimer = null;
          flushDataWrite();
        }, 100);
      }
    });
}

function saveData(data) {
  try {
    pendingWritePayload = JSON.stringify(data, null, 2);
    if (pendingWriteTimer) return;

    pendingWriteTimer = setTimeout(() => {
      pendingWriteTimer = null;
      flushDataWrite();
    }, 200);
  } catch (error) {
    console.error('private saveData queue error:', error);
  }
}

function getGuildState(guildId) {
  const data = loadData();
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      managerRoleIds: [],
      categoryId: null,
      requestsChannelId: null,
      panelChannelId: null,
      panelMessageId: null,
      panelBackgroundUrl: null,
      pendingRequests: {},
      rooms: {}
    };
    saveData(data);
  }
  return { data, state: data.guilds[guildId] };
}

function hasManagerAccess(member, botOwners = []) {
  if (!member) return false;
  if (member.guild.ownerId === member.id) return true;
  if (botOwners.includes(member.id)) return true;
  const { state } = getGuildState(member.guild.id);
  return (state.managerRoleIds || []).some((rid) => member.roles.cache.has(rid));
}

function ownerOrManager(member, room, botOwners = []) {
  if (!member || !room) return false;
  if (member.id === room.ownerId) return true;
  return hasManagerAccess(member, botOwners);
}

function setupEmbed(guild, state) {
  return colorManager.createEmbed()
    .setTitle('Private system setup')
    .setDescription('اضبط النظام من الأزرار بالأسفل.')
    .addFields(
      { name: 'المسؤولين', value: state.managerRoleIds.length ? state.managerRoleIds.map((id) => `<@&${id}>`).join(' ، ') : 'غير محدد', inline: false },
      { name: 'الكاتوقري الصوتي', value: state.categoryId ? `<#${state.categoryId}>` : 'غير محدد', inline: true },
      { name: 'روم الطلبات', value: state.requestsChannelId ? `<#${state.requestsChannelId}>` : 'غير محدد', inline: true },
      { name: 'روم الأزرار', value: state.panelChannelId ? `<#${state.panelChannelId}>` : 'غير محدد', inline: true },
      { name: 'صورة اللوحة', value: state.panelBackgroundUrl || 'افتراضي', inline: false }
    )
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setTimestamp();
}

function setupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('private_setup_managers').setLabel('تعيين مسؤولين').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('private_setup_category').setLabel('تعيين الكاتوقري').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('private_setup_requests').setLabel('تعيين روم الطلبات').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('private_setup_panel').setLabel('تعيين روم الأزرار').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('private_publish_panel').setLabel('نشر لوحة الطلبات').setStyle(ButtonStyle.Success)
    )
  ];
}

function panelEmbed(guild) {
  return colorManager.createEmbed()
    .setTitle('نظام الرومات الخاصة')
    .setDescription('اختَر روم موجود من القائمة لطلب امتلاكه (الروم اللي له مالك ما يطلع بالطلبات).')
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setTimestamp();
}

function controlsCatalog() {
  return [
    { id: 'private_ctrl_rename', label: 'تغيير الاسم', emoji: '🏳️', style: ButtonStyle.Secondary, help: 'تغيير اسم الروم الحالي.' },
    { id: 'private_ctrl_limit', label: 'حدد الأعضاء', emoji: '👥', style: ButtonStyle.Secondary, help: 'تحديد الحد الأقصى للأعضاء.' },
    { id: 'private_ctrl_kick', label: 'طرد عضو', emoji: '📌', style: ButtonStyle.Danger, help: 'طرد عضو من الروم.' },
    { id: 'private_ctrl_transfer', label: 'تغيير المالك', emoji: '👑', style: ButtonStyle.Primary, help: 'نقل ملكية الروم لعضو آخر.' },
    { id: 'private_ctrl_delete', label: 'حذف الروم', emoji: '🗑️', style: ButtonStyle.Danger, help: 'حذف الروم نهائيًا.' },

    { id: 'private_ctrl_lock', label: 'قفل الروم', emoji: '🔐', style: ButtonStyle.Danger, help: 'منع الكل من الدخول.' },
    { id: 'private_ctrl_unlock', label: 'فتح الروم', emoji: '🔊', style: ButtonStyle.Success, help: 'السماح بالدخول حسب الرؤية.' },
    { id: 'private_ctrl_hide', label: 'اخفاء الروم', emoji: '🚫', style: ButtonStyle.Secondary, help: 'إخفاء الروم عن الجميع.' },
    { id: 'private_ctrl_show', label: 'اظهار الروم', emoji: '👁️', style: ButtonStyle.Secondary, help: 'إظهار الروم للجميع.' },
    { id: 'private_ctrl_bitrate', label: 'تغيير الجودة', emoji: '🌐', style: ButtonStyle.Secondary, help: 'تغيير جودة/بتريت الروم.' },

    { id: 'private_ctrl_mute', label: 'ميوت عضو', emoji: '🎙️', style: ButtonStyle.Danger, help: 'سيرفر ميوت لعضو داخل الروم.' },
    { id: 'private_ctrl_unmute', label: 'فك الميوت', emoji: '🎤', style: ButtonStyle.Success, help: 'فك السيرفر ميوت.' },
    { id: 'private_ctrl_deny', label: 'منع لعضو', emoji: '🙍', style: ButtonStyle.Danger, help: 'سحب صلاحية الدخول وطرده.' },
    { id: 'private_ctrl_allow', label: 'سماح لعضو', emoji: '🟢', style: ButtonStyle.Success, help: 'إعطاء صلاحية الدخول للروم.' },
    { id: 'private_ctrl_invite', label: 'دعوة عضو', emoji: '🧲', style: ButtonStyle.Primary, help: 'إرسال رابط دعوة للروم لعضو.' }
  ];
}

function panelRows() {
  const controls = controlsCatalog();
  const menu = new StringSelectMenuBuilder()
    .setCustomId('private_request_menu')
    .setPlaceholder('اختر طلبك...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([{ label: 'طلب روم موجود', value: 'request_room', description: 'طلب امتلاك روم موجود بدون مالك' }]);

  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(...controls.slice(0, 5).map((c) => new ButtonBuilder().setCustomId(c.id).setLabel(c.label).setEmoji(c.emoji).setStyle(c.style))),
    new ActionRowBuilder().addComponents(...controls.slice(5, 10).map((c) => new ButtonBuilder().setCustomId(c.id).setLabel(c.label).setEmoji(c.emoji).setStyle(c.style))),
    new ActionRowBuilder().addComponents(...controls.slice(10, 15).map((c) => new ButtonBuilder().setCustomId(c.id).setLabel(c.label).setEmoji(c.emoji).setStyle(c.style)))
  ];
}

function getRoomByOwner(state, ownerId) {
  return Object.values(state.rooms).find((r) => r.ownerId === ownerId) || null;
}

function getRoomByChannel(state, channelId) {
  return state.rooms[channelId] || null;
}

function listRequestableRooms(guild, state) {
  const category = guild.channels.cache.get(state.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) return [];
  const voices = category.children?.cache?.filter((ch) => ch.type === ChannelType.GuildVoice) || new Map();

  return [...voices.values()]
    .filter((ch) => {
      const room = state.rooms[ch.id];
      return !room || !room.ownerId;
    })
    .slice(0, 25)
    .map((ch) => ({ label: ch.name.slice(0, 100), value: ch.id, description: `ID: ${ch.id}` }));
}



function isPrivateIpAddress(address) {
  if (!address) return true;
  if (net.isIP(address) === 4) {
    return (
      address === '127.0.0.1' ||
      address.startsWith('10.') ||
      address.startsWith('192.168.') ||
      address.startsWith('169.254.') ||
      address.startsWith('172.16.') ||
      address.startsWith('172.17.') ||
      address.startsWith('172.18.') ||
      address.startsWith('172.19.') ||
      address.startsWith('172.20.') ||
      address.startsWith('172.21.') ||
      address.startsWith('172.22.') ||
      address.startsWith('172.23.') ||
      address.startsWith('172.24.') ||
      address.startsWith('172.25.') ||
      address.startsWith('172.26.') ||
      address.startsWith('172.27.') ||
      address.startsWith('172.28.') ||
      address.startsWith('172.29.') ||
      address.startsWith('172.30.') ||
      address.startsWith('172.31.')
    );
  }

  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return true;
}

async function validatePanelBackgroundUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error('INVALID_URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('ONLY_HTTPS_ALLOWED');
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  const lookups = await dns.promises.lookup(hostname, { all: true });
  if (!Array.isArray(lookups) || lookups.length === 0) {
    throw new Error('DNS_LOOKUP_FAILED');
  }

  for (const entry of lookups) {
    if (isPrivateIpAddress(entry.address)) {
      throw new Error('PRIVATE_IP_NOT_ALLOWED');
    }
  }

  return parsed.toString();
}

async function fetchImageBuffer(url) {
  const safeUrl = await validatePanelBackgroundUrl(url);
  const response = await axios.get(safeUrl, {
    responseType: 'arraybuffer',
    timeout: 12000,
    maxContentLength: 10 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300
  });
  return Buffer.from(response.data);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function renderPanelGuideImage(guildId, backgroundUrl) {
  const width = 1920;
  const height = 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (backgroundUrl) {
    try {
      const buf = await fetchImageBuffer(backgroundUrl);
      const img = await loadImage(buf);
      ctx.drawImage(img, 0, 0, width, height);
    } catch (_) {
      ctx.fillStyle = '#1f2330';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    ctx.fillStyle = '#1f2330';
    ctx.fillRect(0, 0, width, height);
  }

  const overlay = ctx.createLinearGradient(0, 0, width, height);
  overlay.addColorStop(0, 'rgba(8, 12, 25, 0.70)');
  overlay.addColorStop(1, 'rgba(9, 15, 34, 0.82)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px Sans';
  ctx.fillText('PRIVATE VOICE CONTROLS', 60, 90);

  const controls = controlsCatalog();
  const startX = 60;
  const startY = 150;
  const boxW = 350;
  const boxH = 84;
  const gapX = 22;
  const gapY = 20;

  controls.forEach((c, i) => {
    const row = Math.floor(i / 5);
    const col = i % 5;
    const x = startX + col * (boxW + gapX);
    const y = startY + row * (boxH + gapY);

    ctx.fillStyle = 'rgba(35, 39, 56, 0.94)';
    drawRoundedRect(ctx, x, y, boxW, boxH, 16);
    ctx.fill();

    ctx.fillStyle = '#f0f0f0';
    ctx.font = 'bold 28px Sans';
    ctx.fillText(`${c.emoji} ${c.label}`, x + 18, y + 50);
  });

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Sans';
  ctx.fillText('شرح الأزرار', 60, 500);

  ctx.font = '23px Sans';
  controls.forEach((c, i) => {
    const col = Math.floor(i / 8);
    const row = i % 8;
    const x = 60 + col * 920;
    const y = 550 + row * 63;
    ctx.fillStyle = '#d9e0ff';
    const lines = wrapText(ctx, `• ${c.emoji} ${c.label}: ${c.help}`, 850);
    lines.slice(0, 2).forEach((line, idx) => {
      ctx.fillText(line, x, y + (idx * 28));
    });
  });

  const outPath = path.join(__dirname, '..', 'data', `private_panel_${guildId}.png`);
  await fs.promises.writeFile(outPath, canvas.toBuffer('image/png', { compressionLevel: 6 }));
  return outPath;
}

async function releaseRoomOwnership(guild, state, ownerId) {
  const ownedRooms = Object.values(state.rooms).filter((r) => r.ownerId === ownerId);
  let released = 0;

  for (const room of ownedRooms) {
    const channel = guild.channels.cache.get(room.channelId) || await guild.channels.fetch(room.channelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildVoice) {
      const idsToClear = [room.ownerId, ...(room.allowedUserIds || [])].filter(Boolean);
      for (const uid of idsToClear) {
        await channel.permissionOverwrites.delete(uid).catch(() => {});
      }
      await channel.permissionOverwrites.edit(guild.id, { ViewChannel: true, Connect: false }).catch(() => {});
    }

    room.ownerId = null;
    room.allowedUserIds = [];
    room.hidden = false;
    room.locked = false;
    released += 1;
  }

  return released;
}

async function publishPanel(guild, state) {
  if (!state.panelChannelId) return { ok: false, message: 'حدد روم الأزرار أولاً.' };
  const ch = guild.channels.cache.get(state.panelChannelId) || await guild.channels.fetch(state.panelChannelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return { ok: false, message: 'روم الأزرار غير صالح.' };

  let imagePath;
  try {
    imagePath = await renderPanelGuideImage(guild.id, state.panelBackgroundUrl || null);
  } catch (error) {
    console.error('private renderPanelGuideImage error:', error);
    return { ok: false, message: 'تعذر تجهيز صورة اللوحة. تأكد أن الرابط مباشر لصورة صالحة.' };
  }
  const attachment = new AttachmentBuilder(imagePath, { name: 'private-panel.png' });
  const sent = await ch.send({ embeds: [panelEmbed(guild).setImage('attachment://private-panel.png')], components: panelRows(), files: [attachment] });
  state.panelMessageId = sent.id;
  return { ok: true };
}

async function submitRequest(interaction, state, targetChannelId) {
  const userId = interaction.user.id;
  if (!state.categoryId || !state.requestsChannelId) {
    await interaction.reply({ content: '❌ النظام غير مكتمل: عيّن الكاتوقري وروم الطلبات أولاً.', ephemeral: true });
    return;
  }

  if (!targetChannelId) {
    await interaction.reply({ content: '❌ لازم تختار روم موجود من القائمة.', ephemeral: true });
    return;
  }

  if (getRoomByOwner(state, userId)) {
    await interaction.reply({ content: '❌ لديك روم خاص بالفعل.', ephemeral: true });
    return;
  }

  if (state.pendingRequests[userId]) {
    await interaction.reply({ content: '⚠️ لديك طلب قيد المراجعة بالفعل.', ephemeral: true });
    return;
  }

  const targetChannel = interaction.guild.channels.cache.get(targetChannelId) || await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
  if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({ content: '❌ الروم المحدد غير صالح.', ephemeral: true });
    return;
  }

  const roomEntry = state.rooms[targetChannelId];
  if (roomEntry && roomEntry.ownerId) {
    await interaction.reply({ content: '❌ هذا الروم له مالك بالفعل ولا يمكن طلبه.', ephemeral: true });
    return;
  }

  const reqId = `${Date.now()}_${userId}`;
  state.pendingRequests[userId] = { requestId: reqId, userId, targetChannelId, createdAt: Date.now(), status: 'pending', messageId: null };

  const reqChannel = interaction.guild.channels.cache.get(state.requestsChannelId) || await interaction.guild.channels.fetch(state.requestsChannelId).catch(() => null);
  if (!reqChannel || !reqChannel.isTextBased()) {
    delete state.pendingRequests[userId];
    await interaction.reply({ content: '❌ روم الطلبات غير صالح.', ephemeral: true });
    return;
  }

  const embed = colorManager.createEmbed()
    .setTitle('طلب روم خاص')
    .setDescription(`**العضو:** <@${userId}>\n**الروم المطلوب:** <#${targetChannelId}>\n**الحالة:** قيد المراجعة`)
    .setFooter({ text: `req:${reqId}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`private_approve_${reqId}`).setLabel('قبول').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`private_reject_${reqId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
  );

  const msg = await reqChannel.send({ embeds: [embed], components: [row] });
  state.pendingRequests[userId].messageId = msg.id;
  await interaction.reply({ content: `✅ تم إرسال طلب امتلاك الروم <#${targetChannelId}> للمراجعة.`, ephemeral: true });
}

async function assignExistingRoomOwnership(guild, state, userId, channelId) {
  const category = guild.channels.cache.get(state.categoryId) || await guild.channels.fetch(state.categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return { ok: false, message: 'الكاتوقري المحدد غير صالح.' };

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) return { ok: false, message: 'الروم المطلوب غير صالح.' };
  if (channel.parentId !== category.id) return { ok: false, message: 'الروم ليس ضمن الكاتوقري المحدد.' };

  const existingOwnerRoom = getRoomByOwner(state, userId);
  if (existingOwnerRoom) return { ok: false, message: 'لدى العضو روم بالفعل.' };

  const room = state.rooms[channel.id] || { channelId: channel.id, ownerId: null, allowedUserIds: [], hidden: false, locked: false, createdAt: Date.now() };
  if (room.ownerId) return { ok: false, message: 'هذا الروم له مالك بالفعل.' };

  room.ownerId = userId;
  room.allowedUserIds = [];
  room.hidden = false;
  room.locked = true;

  await channel.permissionOverwrites.edit(guild.id, { ViewChannel: true, Connect: false }).catch(() => {});
  await channel.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true, Speak: true, Stream: true, UseVAD: true }).catch(() => {});

  state.rooms[channel.id] = room;
  return { ok: true, channel };
}

async function processApproval(interaction, state, reqId, approve, reason = null, botOwners = []) {
  if (!hasManagerAccess(interaction.member, botOwners)) {
    await interaction.reply({ content: '❌ هذا الإجراء للمسؤولين فقط.', ephemeral: true });
    return;
  }

  const req = Object.values(state.pendingRequests).find((r) => r.requestId === reqId);
  if (!req || req.status !== 'pending') {
    await interaction.reply({ content: '⚠️ الطلب غير موجود أو تم التعامل معه.', ephemeral: true });
    return;
  }

  if (requestLocks.has(reqId)) {
    await interaction.reply({ content: '⚠️ هذا الطلب قيد المعالجة بالفعل.', ephemeral: true });
    return;
  }

  requestLocks.add(reqId);

  try {
  req.status = approve ? 'approved' : 'rejected';
  req.reviewedBy = interaction.user.id;
  req.reviewedAt = Date.now();
  req.reason = reason || null;

  const embed = colorManager.createEmbed()
    .setTitle('طلب روم خاص')
    .setDescription(`**العضو:** <@${req.userId}>\n**الروم المطلوب:** <#${req.targetChannelId || '0'}>\n**الحالة:** ${approve ? '✅ مقبول' : '❌ مرفوض'}${reason ? `\n**السبب:** ${reason}` : ''}\n**المسؤول:** <@${interaction.user.id}>`)
    .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });

    let dmText = approve ? '✅ تم قبول طلب الروم الخاص.' : `❌ تم رفض طلب الروم الخاص.${reason ? `\nالسبب: ${reason}` : ''}`;

    if (approve) {
      const assigned = await assignExistingRoomOwnership(interaction.guild, state, req.userId, req.targetChannelId);
      if (!assigned.ok) {
        dmText = `❌ تعذر إسناد الروم بعد القبول.\n${assigned.message}`;
      } else {
        dmText += `\nالروم: ${assigned.channel.toString()}`;
      }
    }

    try {
      const target = await interaction.client.users.fetch(req.userId);
      await target.send(dmText);
    } catch (_) {}

    delete state.pendingRequests[req.userId];
  } finally {
    requestLocks.delete(reqId);
  }
}

async function withOwnerRoom(interaction, state, botOwners, fn) {
  const member = interaction.member;
  const channel = member?.voice?.channel;
  if (!channel) {
    await interaction.reply({ content: '❌ لازم تكون داخل روم صوتي خاص.', ephemeral: true });
    return;
  }

  const room = getRoomByChannel(state, channel.id);
  if (!room) {
    await interaction.reply({ content: '❌ هذا الروم غير تابع لنظام private.', ephemeral: true });
    return;
  }

  if (!ownerOrManager(member, room, botOwners)) {
    await interaction.reply({ content: '❌ فقط المالك أو المسؤول يقدر يستخدم هذا الزر.', ephemeral: true });
    return;
  }

  await fn(channel, room);
}

async function openUserPicker(interaction, action, content = 'اختر العضو:') {
  const picker = new UserSelectMenuBuilder()
    .setCustomId(`private_pick_${action}`)
    .setPlaceholder('اختر العضو')
    .setMinValues(1)
    .setMaxValues(1);
  await interaction.reply({ content, ephemeral: true, components: [new ActionRowBuilder().addComponents(picker)] });
}

async function handleInteraction(interaction, context = {}) {
  const { BOT_OWNERS = [] } = context;
  if (!interaction.customId || !interaction.customId.startsWith('private_')) return false;
  if (!interaction.guild) return true;

  const { data, state } = getGuildState(interaction.guild.id);

  try {
    const setupAction = interaction.customId.startsWith('private_setup_') ||
      interaction.customId.startsWith('private_select_') ||
      interaction.customId === 'private_publish_panel' ||
      interaction.customId === 'private_publish_panel_modal' ||
      interaction.customId.startsWith('private_approve_') ||
      interaction.customId.startsWith('private_reject_') ||
      interaction.customId.startsWith('private_reject_modal_');

    if (setupAction && !hasManagerAccess(interaction.member, BOT_OWNERS)) {
      await interaction.reply({ content: '❌ هذا الإجراء للمسؤولين المحددين فقط.', ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_setup_managers') {
      const menu = new RoleSelectMenuBuilder().setCustomId('private_select_managers').setPlaceholder('اختر رولات المسؤولين').setMinValues(1).setMaxValues(5);
      await interaction.reply({ content: 'حدد رولات المسؤولين:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_setup_category') {
      const menu = new ChannelSelectMenuBuilder().setCustomId('private_select_category').setPlaceholder('اختر كاتوقري').setChannelTypes(ChannelType.GuildCategory).setMinValues(1).setMaxValues(1);
      await interaction.reply({ content: 'حدد الكاتوقري:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_setup_requests') {
      const menu = new ChannelSelectMenuBuilder().setCustomId('private_select_requests').setPlaceholder('اختر روم الطلبات').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
      await interaction.reply({ content: 'حدد روم الطلبات:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_setup_panel') {
      const menu = new ChannelSelectMenuBuilder().setCustomId('private_select_panel').setPlaceholder('اختر روم الأزرار').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1);
      await interaction.reply({ content: 'حدد روم الأزرار:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_publish_panel') {
      const modal = new ModalBuilder().setCustomId('private_publish_panel_modal').setTitle('صورة لوحة private');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('image_url')
          .setLabel('رابط الصورة (اختياري)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://...')
      ));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.showModal(modal);
      }
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'private_publish_panel_modal') {
      const rawUrl = interaction.fields.getTextInputValue('image_url').trim();
      if (rawUrl) {
        try {
          state.panelBackgroundUrl = await validatePanelBackgroundUrl(rawUrl);
        } catch (_) {
          await interaction.reply({ content: '❌ الرابط غير آمن أو غير صالح. استخدم رابط HTTPS عام لصورة يمكن الوصول لها.', ephemeral: true });
          return true;
        }
      } else {
        state.panelBackgroundUrl = null;
      }

      const result = await publishPanel(interaction.guild, state);
      saveData(data);
      await interaction.reply({ content: result.ok ? '✅ تم نشر لوحة private بالصورة والتعليمات.' : `❌ ${result.message}`, ephemeral: true });
      return true;
    }

    if (interaction.customId === 'private_select_managers') {
      state.managerRoleIds = interaction.values;
      saveData(data);
      await interaction.update({ content: '✅ تم تحديث المسؤولين.', components: [] });
      return true;
    }

    if (interaction.customId === 'private_select_category') {
      const categoryId = interaction.values[0] || null;
      const category = interaction.guild.channels.cache.get(categoryId) || await interaction.guild.channels.fetch(categoryId).catch(() => null);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.update({ content: '❌ الكاتوقري غير صالح.', components: [] });
        return true;
      }
      const hasVoiceChildren = category.children?.cache?.some((ch) => ch.type === ChannelType.GuildVoice) || false;
      if (!hasVoiceChildren) {
        await interaction.update({ content: '❌ لازم تختار كاتوقري فيها رومات صوتية.', components: [] });
        return true;
      }
      state.categoryId = categoryId;
      saveData(data);
      await interaction.update({ content: '✅ تم تحديث الكاتوقري.', components: [] });
      return true;
    }

    if (interaction.customId === 'private_select_requests') {
      state.requestsChannelId = interaction.values[0] || null;
      saveData(data);
      await interaction.update({ content: '✅ تم تحديث روم الطلبات.', components: [] });
      return true;
    }

    if (interaction.customId === 'private_select_panel') {
      state.panelChannelId = interaction.values[0] || null;
      saveData(data);
      await interaction.update({ content: '✅ تم تحديث روم الأزرار.', components: [] });
      return true;
    }

    if (interaction.customId === 'private_request_menu') {
      if (interaction.values[0] === 'request_room') {
        const options = listRequestableRooms(interaction.guild, state);
        if (options.length === 0) {
          await interaction.reply({ content: '⚠️ لا توجد رومات متاحة للطلب حالياً (كلها لها مالك).', ephemeral: true });
          return true;
        }
        const menu = new StringSelectMenuBuilder()
          .setCustomId('private_request_pick_room')
          .setPlaceholder('اختر الروم الموجود الذي تريد طلبه')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(options);
        await interaction.reply({ content: 'اختر الروم المطلوب:', ephemeral: true, components: [new ActionRowBuilder().addComponents(menu)] });
      }
      return true;
    }

    if (interaction.customId === 'private_request_pick_room') {
      const selectedChannelId = interaction.values[0];
      await submitRequest(interaction, state, selectedChannelId);
      saveData(data);
      return true;
    }

    if (interaction.customId.startsWith('private_approve_')) {
      const reqId = interaction.customId.replace('private_approve_', '');
      await processApproval(interaction, state, reqId, true, null, BOT_OWNERS);
      saveData(data);
      return true;
    }

    if (interaction.customId.startsWith('private_reject_')) {
      const reqId = interaction.customId.replace('private_reject_', '');
      const modal = new ModalBuilder().setCustomId(`private_reject_modal_${reqId}`).setTitle('سبب الرفض');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('سبب الرفض').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300)
      ));
      if (!interaction.replied && !interaction.deferred) {
        await interaction.showModal(modal);
      }
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('private_reject_modal_')) {
      const reqId = interaction.customId.replace('private_reject_modal_', '');
      const reason = interaction.fields.getTextInputValue('reason');
      const req = Object.values(state.pendingRequests).find((r) => r.requestId === reqId);
      if (!req) {
        await interaction.reply({ content: '⚠️ الطلب غير موجود.', ephemeral: true });
        return true;
      }

      const ch = interaction.guild.channels.cache.get(state.requestsChannelId) || await interaction.guild.channels.fetch(state.requestsChannelId).catch(() => null);
      const reqMsg = ch && req.messageId ? await ch.messages.fetch(req.messageId).catch(() => null) : null;
      if (!reqMsg) {
        await interaction.reply({ content: '⚠️ تعذر إيجاد رسالة الطلب.', ephemeral: true });
        return true;
      }

      const fakeInteraction = { ...interaction, member: interaction.member, message: reqMsg, update: (...args) => reqMsg.edit(...args) };
      await processApproval(fakeInteraction, state, reqId, false, reason, BOT_OWNERS);
      await interaction.reply({ content: '✅ تم رفض الطلب مع السبب.', ephemeral: true });
      saveData(data);
      return true;
    }

    if (interaction.customId === 'private_ctrl_rename') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        const modal = new ModalBuilder().setCustomId('private_modal_rename').setTitle('تغيير اسم الروم');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
        ));
        if (!interaction.replied && !interaction.deferred) await interaction.showModal(modal);
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_limit') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        const modal = new ModalBuilder().setCustomId('private_modal_limit').setTitle('تحديد عدد الأعضاء');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('limit').setLabel('عدد من 0 إلى 99').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        if (!interaction.replied && !interaction.deferred) await interaction.showModal(modal);
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_bitrate') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        const modal = new ModalBuilder().setCustomId('private_modal_bitrate').setTitle('تغيير جودة الروم');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('bitrate').setLabel('bitrate من 8 إلى 384 kbps').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        if (!interaction.replied && !interaction.deferred) await interaction.showModal(modal);
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'private_modal_rename') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel) => {
        const newName = interaction.fields.getTextInputValue('name').trim();
        await channel.setName(newName).catch(() => {});
        await interaction.reply({ content: '✅ تم تغيير اسم الروم.', ephemeral: true });
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'private_modal_limit') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel) => {
        const limit = Number(interaction.fields.getTextInputValue('limit').trim());
        if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
          await interaction.reply({ content: '❌ قيمة غير صحيحة.', ephemeral: true });
          return;
        }
        await channel.setUserLimit(limit).catch(() => {});
        await interaction.reply({ content: '✅ تم تحديث العدد.', ephemeral: true });
      });
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'private_modal_bitrate') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel) => {
        const kbps = Number(interaction.fields.getTextInputValue('bitrate').trim());
        if (!Number.isInteger(kbps) || kbps < 8 || kbps > 384) {
          await interaction.reply({ content: '❌ قيمة غير صحيحة (8-384).', ephemeral: true });
          return;
        }
        await channel.setBitrate(kbps * 1000).catch(() => {});
        await interaction.reply({ content: '✅ تم تحديث جودة الروم.', ephemeral: true });
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_lock' || interaction.customId === 'private_ctrl_unlock') {
      const lock = interaction.customId === 'private_ctrl_lock';
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel, room) => {
        await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: lock ? false : true }).catch(() => {});
        room.locked = lock;
        saveData(data);
        await interaction.reply({ content: lock ? '✅ تم قفل الروم.' : '✅ تم فتح الروم.', ephemeral: true });
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_hide' || interaction.customId === 'private_ctrl_show') {
      const hide = interaction.customId === 'private_ctrl_hide';
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel, room) => {
        await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: hide ? false : true }).catch(() => {});
        room.hidden = hide;
        saveData(data);
        await interaction.reply({ content: hide ? '✅ تم اخفاء الروم.' : '✅ تم اظهار الروم.', ephemeral: true });
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_kick') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'kick', 'اختر عضو لطرده من الروم:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_mute') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'mute', 'اختر عضو لعمل ميوت:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_unmute') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'unmute', 'اختر عضو لفك الميوت:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_allow') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'allow', 'اختر عضو للسماح له:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_deny') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'deny', 'اختر عضو لمنعه:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_transfer') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'transfer', 'اختر العضو الذي سيتم نقل الملكية له:');
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_invite') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async () => {
        await openUserPicker(interaction, 'invite', 'اختر عضو لإرسال دعوة له:');
      });
      return true;
    }

    if (interaction.customId.startsWith('private_pick_')) {
      const action = interaction.customId.replace('private_pick_', '');
      const targetId = interaction.values[0];
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel, room) => {
        const target = interaction.guild.members.cache.get(targetId) || await interaction.guild.members.fetch(targetId).catch(() => null);
        if (!target || target.user.bot) {
          await interaction.update({ content: '❌ العضو غير صالح.', components: [] });
          return;
        }

        if (action === 'allow') {
          if (!room.allowedUserIds.includes(targetId)) room.allowedUserIds.push(targetId);
          await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, Speak: true }).catch(() => {});
          await interaction.update({ content: `✅ تم السماح لـ <@${targetId}>.`, components: [] });
        } else if (action === 'deny') {
          room.allowedUserIds = room.allowedUserIds.filter((id) => id !== targetId);
          await channel.permissionOverwrites.delete(targetId).catch(() => {});
          if (target.voice.channelId === channel.id) {
            await target.voice.disconnect().catch(() => {});
          }
          await interaction.update({ content: `✅ تم منع <@${targetId}> وطرده إن كان داخل الروم.`, components: [] });
        } else if (action === 'transfer') {
          await channel.permissionOverwrites.delete(room.ownerId).catch(() => {});
          room.ownerId = targetId;
          room.allowedUserIds = room.allowedUserIds.filter((id) => id !== targetId);
          await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, Speak: true, Stream: true, UseVAD: true }).catch(() => {});
          await interaction.update({ content: `✅ تم نقل ملكية الروم إلى <@${targetId}>.`, components: [] });
        } else if (action === 'kick') {
          if (target.voice.channelId === channel.id) {
            await target.voice.disconnect().catch(() => {});
            await interaction.update({ content: `✅ تم طرد <@${targetId}> من الروم.`, components: [] });
          } else {
            await interaction.update({ content: '⚠️ العضو ليس داخل نفس الروم.', components: [] });
          }
        } else if (action === 'mute') {
          if (target.voice.channelId === channel.id) {
            await target.voice.setMute(true, 'Private room owner action').catch(() => {});
            await interaction.update({ content: `✅ تم عمل ميوت لـ <@${targetId}>.`, components: [] });
          } else {
            await interaction.update({ content: '⚠️ العضو ليس داخل نفس الروم.', components: [] });
          }
        } else if (action === 'unmute') {
          await target.voice.setMute(false, 'Private room owner action').catch(() => {});
          await interaction.update({ content: `✅ تم فك الميوت عن <@${targetId}>.`, components: [] });
        } else if (action === 'invite') {
          const invite = await channel.createInvite({ maxAge: 3600, maxUses: 1, unique: true }).catch(() => null);
          if (!invite) {
            await interaction.update({ content: '❌ تعذر إنشاء الدعوة.', components: [] });
          } else {
            let dmSent = false;
            try {
              await target.send(`📨 تمت دعوتك إلى روم خاص: ${invite.url}`);
              dmSent = true;
            } catch (_) {}
            await interaction.update({ content: dmSent ? `✅ تم إرسال الدعوة لـ <@${targetId}>.` : `⚠️ تم إنشاء الدعوة لكن تعذر إرسالها بالخاص: ${invite.url}`, components: [] });
          }
        }

        saveData(data);
      });
      return true;
    }

    if (interaction.customId === 'private_ctrl_delete') {
      await withOwnerRoom(interaction, state, BOT_OWNERS, async (channel) => {
        delete state.rooms[channel.id];
        saveData(data);
        await interaction.reply({ content: '✅ سيتم حذف الروم.', ephemeral: true });
        await channel.delete('Private room deleted by owner/manager').catch(() => {});
      });
      return true;
    }

    return false;
  } catch (e) {
    console.error('private handleInteraction error:', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء تنفيذ العملية.', ephemeral: true }).catch(() => {});
    } else {
      await interaction.followUp({ content: '❌ حدث خطأ أثناء تنفيذ العملية.', ephemeral: true }).catch(() => {});
    }
    return true;
  }
}

function registerPrivateListeners(client) {
  if (client._privateListenersRegistered) return;

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const { data, state } = getGuildState(guild.id);

      const targetChannel = newState.channel;
      if (!targetChannel) return;
      const room = state.rooms[targetChannel.id];
      if (!room) return;

      // If room has no owner, skip auto-kick rule as requested.
      if (!room.ownerId) return;

      const member = newState.member;
      if (!member || member.user.bot) return;
      const isAllowed = member.id === room.ownerId || room.allowedUserIds.includes(member.id) || hasManagerAccess(member, client._privateOwners || []);
      if (!isAllowed) {
        await member.voice.disconnect().catch(() => {});
      }
      saveData(data);
    } catch (e) {
      console.error('private voiceStateUpdate error:', e);
    }
  });

  client.on('channelDelete', (channel) => {
    try {
      if (!channel.guild) return;
      const { data, state } = getGuildState(channel.guild.id);
      if (state.rooms[channel.id]) {
        delete state.rooms[channel.id];
        saveData(data);
      }
    } catch (_) {}
  });

  client._privateListenersRegistered = true;
}

async function execute(message, args, { client, BOT_OWNERS = [] }) {
  if (isChannelBlocked(message.channel.id)) return;
  if (isUserBlocked(message.author.id)) return;

  if (!hasManagerAccess(message.member, BOT_OWNERS)) {
    await message.reply('❌ الأمر للمسؤولين فقط.');
    return;
  }

  const { data, state } = getGuildState(message.guild.id);
  client._privateOwners = BOT_OWNERS;

  const sub = (args?.[0] || '').toLowerCase();
  if (sub === 'remove') {
    const ownerId = message.mentions.users.first()?.id || args.find((a) => /^\d{17,20}$/.test(a));
    if (!ownerId) {
      await message.reply('❌ الاستخدام: private remove @owner');
      return;
    }

    const released = await releaseRoomOwnership(message.guild, state, ownerId);
    saveData(data);
    await message.reply(released > 0
      ? `✅ تم إزالة ملكية ${released} روم من <@${ownerId}> وأصبحت قابلة للطلب.`
      : '⚠️ لا توجد رومات مملوكة لهذا العضو داخل النظام.');
    return;
  }

  if (!client._privateRouterRegistered) {
    interactionRouter.register('private_', async (interaction, ctx = {}) => {
      const owners = ctx.BOT_OWNERS || BOT_OWNERS;
      return handleInteraction(interaction, { BOT_OWNERS: owners });
    });
    client._privateRouterRegistered = true;
  }

  registerPrivateListeners(client);

  await message.channel.send({ embeds: [setupEmbed(message.guild, state)], components: setupRows() });
  saveData(data);
}

module.exports = { name, execute };
