const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getGuildConfig, getGuildRoles, getRoleEntry, findRoleByOwner, formatDuration, getRoleResetDate, isManager } = require('../utils/customRolesSystem.js');
const { getDatabase } = require('../utils/database.js');
const moment = require('moment-timezone');

const name = 'list';

const PAGE_SIZE = 10;

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
  const resetDate = getRoleResetDate(guildConfig, roleEntry.roleId);

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

  return message.channel.send({ embeds: [embed] });
}

function buildListEmbed(listEntries, page, client) {
  const totalPages = Math.max(1, Math.ceil(listEntries.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageEntries = listEntries.slice(start, start + PAGE_SIZE);

  const description = pageEntries.map((entry, index) => (
    `**${start + index + 1}. ${entry.name}** — <@&${entry.roleId}>\n` +
    `👥 ${entry.members} | 💬 ${entry.messages} | 🔊 ${formatDuration(entry.voice)}`
  )).join('\n\n');

  return new EmbedBuilder()
    .setTitle('📊 قائمة الرولات الخاصة')
    .setDescription(description || 'لا توجد رولات خاصة حالياً.')
    .setColor(colorManager.getColor ? colorManager.getColor() : '#2f3136')
    .setThumbnail(client.user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: `صفحة ${page}/${totalPages}` });
}

function buildListComponents(page, totalPages) {
  if (totalPages <= 1) return [];
  const prevButton = new ButtonBuilder()
    .setCustomId('customroles_list_prev')
    .setLabel('⬅️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 1);
  const nextButton = new ButtonBuilder()
    .setCustomId('customroles_list_next')
    .setLabel('➡️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages);
  return [new ActionRowBuilder().addComponents(prevButton, nextButton)];
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) return;

  const guildConfig = getGuildConfig(message.guild.id);
  const canManage = isManager(message.member, guildConfig, BOT_OWNERS);
  if (!canManage) {
    await message.react('❌').catch(() => {});
    return;
  }

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

  const listEntries = [];

  for (const roleEntry of guildRoles) {
    const role = message.guild.roles.cache.get(roleEntry.roleId);
    const members = role ? [...role.members.values()] : [];
    const roleResetDate = getRoleResetDate(guildConfig, roleEntry.roleId);
    const activity = await sumActivity(members.map(member => member.id), roleResetDate);
    listEntries.push({
      name: role ? role.name : roleEntry.name,
      roleId: roleEntry.roleId,
      members: members.length,
      voice: activity.voice,
      messages: activity.messages
    });
  }

  const totalPages = Math.max(1, Math.ceil(listEntries.length / PAGE_SIZE));
  let currentPage = 1;
  const listMessage = await message.reply({
    embeds: [buildListEmbed(listEntries, currentPage, message.client)],
    components: buildListComponents(currentPage, totalPages)
  });

  if (totalPages <= 1) return;

  const collector = listMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000
  });

  collector.on('collect', async interaction => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({ content: '❌ هذا التحكم ليس لك.', ephemeral: true });
      return;
    }

    if (interaction.customId === 'customroles_list_prev') {
      currentPage = Math.max(1, currentPage - 1);
    } else if (interaction.customId === 'customroles_list_next') {
      currentPage = Math.min(totalPages, currentPage + 1);
    }

    await interaction.deferUpdate();
    await listMessage.edit({
      embeds: [buildListEmbed(listEntries, currentPage, message.client)],
      components: buildListComponents(currentPage, totalPages)
    });
  });

  collector.on('end', async () => {
    await listMessage.edit({
      components: buildListComponents(currentPage, totalPages).map(row => {
        row.components.forEach(component => component.setDisabled(true));
        return row;
      })
    }).catch(() => {});
  });
}

module.exports = { name, execute, renderRoleDetails };
