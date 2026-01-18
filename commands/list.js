const { EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getGuildConfig, getGuildRoles, getRoleEntry, findRoleByOwner, formatDuration, getResetDate } = require('../utils/customRolesSystem.js');
const { getDatabase } = require('../utils/database.js');
const moment = require('moment-timezone');

const name = 'list';

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

async function renderRoleDetails(message, roleEntry) {
  const role = message.guild.roles.cache.get(roleEntry.roleId);
  const members = role ? [...role.members.values()] : [];
  const guildConfig = getGuildConfig(message.guild.id);
  const resetDate = getResetDate(guildConfig.activityResetAt);

  const activity = await sumActivity(members.map(member => member.id), resetDate);

  const embed = new EmbedBuilder()
    .setTitle('📌 تفاصيل رول خاص') 
    .setDescription(
      `الرول: ${role ? `<@&${role.id}>` : roleEntry.name}\n` +
      `المالك: <@${roleEntry.ownerId}>\n` +
      `الأعضاء: ${members.length}\n` +
      `تفاعل الشات: ${activity.messages} رسالة\n` +
      `تفاعل الفويس: ${formatDuration(activity.voice)}\n` +
      `الإنشاء: ${moment(roleEntry.createdAt).tz('Asia/Riyadh').format('YYYY-MM-DD HH:mm')}`
    )
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));

  await message.channel.send({ embeds: [embed] });
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const roleMention = message.mentions.roles.first();
  const userMention = message.mentions.users.first();
  const idArg = args.find(arg => /^\d{17,19}$/.test(arg));

  if (roleMention || (idArg && message.guild.roles.cache.has(idArg))) {
    const roleId = roleMention?.id || idArg;
    const roleEntry = getRoleEntry(roleId);
    if (!roleEntry) {
      await message.reply('**❌ هذا الرول ليس ضمن الرولات الخاصة.**');
      return;
    }
    await renderRoleDetails(message, roleEntry);
    return;
  }

  if (userMention || idArg) {
    const userId = userMention?.id || idArg;
    const roleEntry = findRoleByOwner(message.guild.id, userId);
    if (!roleEntry) {
      await message.reply('**❌ هذا العضو لا يملك رول خاص.**');
      return;
    }
    await renderRoleDetails(message, roleEntry);
    return;
  }

  const guildRoles = getGuildRoles(message.guild.id);
  if (guildRoles.length === 0) {
    await message.reply('**لا توجد رولات خاصة حالياً.**');
    return;
  }

  const guildConfig = getGuildConfig(message.guild.id);
  const resetDate = getResetDate(guildConfig.activityResetAt);

  const listEntries = [];

  for (const roleEntry of guildRoles) {
    const role = message.guild.roles.cache.get(roleEntry.roleId);
    const members = role ? [...role.members.values()] : [];
    const activity = await sumActivity(members.map(member => member.id), resetDate);
    listEntries.push({
      name: role ? role.name : roleEntry.name,
      roleId: roleEntry.roleId,
      members: members.length,
      voice: activity.voice,
      messages: activity.messages
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 قائمة الرولات الخاصة')
    .setDescription(listEntries.map((entry, index) => (
      `**${index + 1}. ${entry.name}** — <@&${entry.roleId}>\n` +
      `👥 ${entry.members} | 💬 ${entry.messages} | 🔊 ${formatDuration(entry.voice)}`
    )).join('\n\n'))
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(message.client.user.displayAvatarURL({ size: 128 }));

  await message.channel.send({ embeds: [embed] });
}

module.exports = { name, execute };
