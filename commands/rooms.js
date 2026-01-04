const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

const name = 'rooms';
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');
const roomOwnersPath = path.join(__dirname, '..', 'data', 'roomOwners.json');
const rejectedRequestsPath = path.join(__dirname, '..', 'data', 'rejectedRequests.json');

function loadRoomConfig() { try { if (fs.existsSync(roomConfigPath)) return JSON.parse(fs.readFileSync(roomConfigPath, 'utf8')); return {}; } catch (e) { return {}; } }
function saveRoomConfig(config) { try { fs.writeFileSync(roomConfigPath, JSON.stringify(config, null, 2), 'utf8'); return true; } catch (e) { return false; } }
function loadRoomOwners() { try { if (fs.existsSync(roomOwnersPath)) return JSON.parse(fs.readFileSync(roomOwnersPath, 'utf8')); return {}; } catch (e) { return {}; } }
function saveRoomOwners(owners) { try { fs.writeFileSync(roomOwnersPath, JSON.stringify(owners, null, 2), 'utf8'); return true; } catch (e) { return false; } }
function loadRejectedRequests() { try { if (fs.existsSync(rejectedRequestsPath)) return JSON.parse(fs.readFileSync(rejectedRequestsPath, 'utf8')); return {}; } catch (e) { return {}; } }
function saveRejectedRequests(rejected) { try { fs.writeFileSync(rejectedRequestsPath, JSON.stringify(rejected, null, 2), 'utf8'); return true; } catch (e) { return false; } }

async function getUserActivity(userId) {
    try {
        const { getDatabase } = require('../utils/database');
        const dbManager = getDatabase();
        const stats = await dbManager.getUserStats(userId);
        const lastVoice = await dbManager.get(`SELECT end_time, channel_name FROM voice_sessions WHERE user_id = ? ORDER BY end_time DESC LIMIT 1`, [userId]);
        const lastMsg = await dbManager.get(`SELECT last_message, channel_name FROM message_channels WHERE user_id = ? ORDER BY last_message DESC LIMIT 1`, [userId]);
        return { totalMessages: stats.totalMessages || 0, totalVoiceTime: stats.totalVoiceTime || 0, lastVoiceTime: lastVoice?.end_time, lastVoiceChannel: lastVoice?.channel_name, lastMessageTime: lastMsg?.last_message, lastMessageChannel: lastMsg?.channel_name };
    } catch (e) { return { totalMessages: 0, totalVoiceTime: 0 }; }
}

function generateRoomsListEmbed(guild, displayType) {
    const config = loadRoomConfig();
    const categoryId = config[guild.id]?.roomsCategoryId;
    const category = guild.channels.cache.get(categoryId);
    if (!category) return null;
    const rooms = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
    const owners = loadRoomOwners()[guild.id] || {};
    let description = `**قائمة الرومات في كاتوقري: ${category.name}**\n\n`;
    const availableRooms = [];
    rooms.forEach((room, index) => {
        const ownerId = owners[room.id];
        const ownerMention = ownerId ? `<@${ownerId}>` : '`لا يوجد مالك`';
        if (!ownerId) availableRooms.push({ label: room.name, value: room.id });
        description += `**${index + 1}- ${displayType === 'names' ? room.name : `<#${room.id}>`}** | المالك: ${ownerMention}\n`;
    });
    return { embed: colorManager.createEmbed().setTitle('**قائمة الرومات وأصحابها**').setDescription(description).setFooter({ text: `By Ahmed.`, iconURL: guild.iconURL({ dynamic: true }) }), availableRooms };
}

async function execute(message, args, { client, BOT_OWNERS, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) return;
    const sub = args[0]?.toLowerCase();

    if (sub === 'sub' && args[1]?.toLowerCase() === 'ctg') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const id = args[2]?.replace(/[<#>]/g, '');
        const cat = message.guild.channels.cache.get(id);
        if (!cat || cat.type !== ChannelType.GuildCategory) return message.reply('**ID كاتوقري غير صحيح**');
        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].roomsCategoryId = id;
        saveRoomConfig(config);
        return message.reply(`**✅ تم تحديد كاتوقري الرومات: \`${cat.name}\`**`);
    }

    if (sub === 'sub' && args[1]?.toLowerCase() === 'req') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const id = args[2]?.replace(/[<#>]/g, '');
        if (!message.guild.channels.cache.has(id)) return message.reply('**قناة غير موجودة**');
        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].requestChannelId = id;
        saveRoomConfig(config);
        return message.reply(`**✅ تم تحديد قناة الطلبات: <#${id}>**`);
    }

    if (sub === 'list') {
        const res = generateRoomsListEmbed(message.guild, 'names');
        if (!res) return message.reply('**الرجاء ضبط الكاتوقري أولاً.**');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rooms_list_names').setLabel('عرض بالأسماء').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rooms_list_numbers').setLabel('عرض بالأرقام').setStyle(ButtonStyle.Secondary)
        );
        const msg = await message.channel.send({ embeds: [colorManager.createEmbed().setTitle('**نظام الرومات الخاصة**').setDescription('**اختر طريقة العرض:**')], components: [row] });
        const coll = msg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
        coll.on('collect', async i => {
            const type = i.customId === 'rooms_list_names' ? 'names' : 'numbers';
            const list = generateRoomsListEmbed(message.guild, type);
            const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`request_room_btn_${type}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success));
            await i.update({ embeds: [list.embed], components: [btnRow] });
        });
        return;
    }

    if (sub === 'control') {
        const owners = loadRoomOwners()[message.guild.id] || {};
        const roomId = Object.keys(owners).find(id => owners[id] === message.author.id);
        if (!roomId) return message.reply('**❌ لا تملك روماً خاصاً**');
        const room = message.guild.channels.cache.get(roomId);
        if (!room) return message.reply('**❌ الروم غير موجود**');

        const embed = colorManager.createEmbed()
            .setTitle('**🎮 لوحة التحكم الشاملة**')
            .setDescription(`**الروم:** <#${room.id}>\n**المالك:** <@${message.author.id}>\n\nاستخدم الأزرار أدناه للسيطرة الكاملة:`)
            .addFields(
                { name: '🔒 الخصوصية', value: '`قفل/فتح` | `إظهار/إخفاء`', inline: true },
                { name: '⚙️ الإعدادات', value: '`الاسم` | `العدد` | `تصفير`', inline: true },
                { name: '🚫 الإدارة', value: '`منع` | `طرد` | `سحب`', inline: true },
                { name: '🎙️ الصوت', value: '`كتم` | `إلغاء كتم` | `تحدث`', inline: true },
                { name: '👑 الملكية', value: '`نقل الملكية`', inline: true }
            );

        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rc_lock_${room.id}`).setLabel('قفل/فتح').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
            new ButtonBuilder().setCustomId(`rc_vis_${room.id}`).setLabel('إظهار/إخفاء').setStyle(ButtonStyle.Secondary).setEmoji('👁️'),
            new ButtonBuilder().setCustomId(`rc_name_${room.id}`).setLabel('الاسم').setStyle(ButtonStyle.Primary).setEmoji('📝'),
            new ButtonBuilder().setCustomId(`rc_limit_${room.id}`).setLabel('العدد').setStyle(ButtonStyle.Primary).setEmoji('👥'),
            new ButtonBuilder().setCustomId(`rc_clear_${room.id}`).setLabel('تصفير').setStyle(ButtonStyle.Danger).setEmoji('🧹')
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rc_ban_${room.id}`).setLabel('منع').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
            new ButtonBuilder().setCustomId(`rc_kick_${room.id}`).setLabel('طرد').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId(`rc_pull_${room.id}`).setLabel('سحب').setStyle(ButtonStyle.Success).setEmoji('🎣'),
            new ButtonBuilder().setCustomId(`rc_mute_${room.id}`).setLabel('كتم').setStyle(ButtonStyle.Secondary).setEmoji('🔇'),
            new ButtonBuilder().setCustomId(`rc_unmute_${room.id}`).setLabel('إلغاء كتم').setStyle(ButtonStyle.Secondary).setEmoji('🔊')
        );
        const r3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rc_speak_${room.id}`).setLabel('صلاحية التحدث').setStyle(ButtonStyle.Primary).setEmoji('🎙️'),
            new ButtonBuilder().setCustomId(`rc_own_${room.id}`).setLabel('نقل ملكية').setStyle(ButtonStyle.Success).setEmoji('👑')
        );

        return message.channel.send({ embeds: [embed], components: [r1, r2, r3] });
    }

    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
    if (args[0]?.toLowerCase() === 'admin') return await showAdminRolesActivity(message, client, ADMIN_ROLES);
    let targetRole = message.mentions.roles.first(), targetUser = message.mentions.users.first();
    if (!targetRole && !targetUser && args[0]) {
        try { targetRole = await message.guild.roles.fetch(args[0]); } catch (e) {}
        if (!targetRole) { try { targetUser = (await message.guild.members.fetch(args[0])).user; } catch (e) {} }
    }
    if (!targetRole && !targetUser) return message.reply('**أوامر الرومات:** `sub ctg`, `sub req`, `list`, `control`');
    if (targetUser) await showUserActivity(message, targetUser, client); else await showRoleActivity(message, targetRole, client);
}

async function handleInteractions(interaction, { BOT_OWNERS }) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    const owners = loadRoomOwners(), guildOwners = owners[interaction.guild.id] || {};
    const rejected = loadRejectedRequests(), guildRejected = rejected[interaction.guild.id] || {};

    if (interaction.isButton() && interaction.customId.startsWith('request_room_btn_')) {
        const type = interaction.customId.split('_')[3], res = generateRoomsListEmbed(interaction.guild, type);
        if (res.availableRooms.length === 0) return interaction.reply({ content: '**❌ لا توجد رومات متاحة**', ephemeral: true });
        const menu = new StringSelectMenuBuilder().setCustomId(`sel_req_${type}_${interaction.message.id}`).setPlaceholder('اختر الروم').addOptions(res.availableRooms.slice(0, 25));
        await interaction.reply({ content: '**اختر الروم:**', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sel_req_')) {
        const parts = interaction.customId.split('_'), type = parts[2], msgId = parts[3], roomId = interaction.values[0];
        if (guildRejected[interaction.user.id]?.includes(roomId)) return interaction.update({ content: '**❌ تم رفض طلبك لهذا الروم مسبقاً**', components: [], ephemeral: true });
        const reqId = loadRoomConfig()[interaction.guild.id]?.requestChannelId, reqChan = interaction.guild.channels.cache.get(reqId);
        if (!reqChan) return interaction.update({ content: '**❌ قناة الطلبات غير مضبوطة**', components: [], ephemeral: true });
        const emb = colorManager.createEmbed().setTitle('**🆕 طلب روم**').setDescription(`**المستخدم:** <@${interaction.user.id}>\n**الروم:** <#${roomId}>`).setFooter({ text: `ID: ${roomId}|U:${interaction.user.id}|M:${msgId}|T:${type}` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_r_${interaction.user.id}_${roomId}_${msgId}_${type}`).setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rej_r_${interaction.user.id}_${roomId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
        );
        await reqChan.send({ embeds: [emb], components: [row] });
        await interaction.update({ content: '**✅ تم إرسال طلبك**', components: [], ephemeral: true });
    }

    if (interaction.isButton() && (interaction.customId.startsWith('app_r_') || interaction.customId.startsWith('rej_r_'))) {
        if (!BOT_OWNERS.includes(interaction.user.id) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '**للإدارة فقط**', ephemeral: true });
        const p = interaction.customId.split('_'), act = p[0], uId = p[2], rId = p[3];
        if (act === 'app') {
            guildOwners[rId] = uId; owners[interaction.guild.id] = guildOwners; saveRoomOwners(owners);
            const room = interaction.guild.channels.cache.get(rId);
            if (room) await room.permissionOverwrites.edit(uId, { ManageChannels: true, Connect: true, Speak: true, MuteMembers: true, DeafenMembers: true, MoveMembers: true });
            await interaction.update({ content: `**✅ تم القبول لـ <@${uId}>**`, embeds: [], components: [] });
            const listMsg = await interaction.channel.messages.fetch(p[4]).catch(() => null);
            if (listMsg) {
                const up = generateRoomsListEmbed(interaction.guild, p[5]);
                await listMsg.edit({ embeds: [up.embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`request_room_btn_${p[5]}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success))] });
            }
        } else {
            if (!guildRejected[uId]) guildRejected[uId] = []; guildRejected[uId].push(rId);
            rejected[interaction.guild.id] = guildRejected; saveRejectedRequests(rejected);
            await interaction.update({ content: `**❌ تم الرفض لـ <@${uId}>**`, embeds: [], components: [] });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('rc_')) {
        const p = interaction.customId.split('_'), act = p[1], rId = p[2];
        if (guildOwners[rId] !== interaction.user.id) return interaction.reply({ content: '**لست صاحب الروم**', ephemeral: true });
        const room = interaction.guild.channels.cache.get(rId);
        if (!room) return interaction.reply({ content: '**الروم غير موجود**', ephemeral: true });

        switch (act) {
            case 'lock':
                const lock = room.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect);
                await room.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: lock ? null : false });
                await interaction.reply({ content: `**✅ تم ${lock ? 'فتح' : 'قفل'} الروم**`, ephemeral: true });
                break;
            case 'vis':
                const vis = room.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel);
                await room.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: vis ? null : false });
                await interaction.reply({ content: `**✅ تم ${vis ? 'إظهار' : 'إخفاء'} الروم**`, ephemeral: true });
                break;
            case 'name':
                await interaction.reply({ content: '**أرسل الاسم الجديد الآن:**', ephemeral: true });
                const nColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id, time: 15000, max: 1 });
                nColl.on('collect', async m => { await room.setName(m.content); await m.reply('**✅ تم تغيير الاسم**'); await m.delete().catch(() => {}); });
                break;
            case 'limit':
                await interaction.reply({ content: '**أرسل العدد (0-99):**', ephemeral: true });
                const lColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id && !isNaN(m.content), time: 15000, max: 1 });
                lColl.on('collect', async m => { await room.setUserLimit(parseInt(m.content)); await m.reply('**✅ تم تحديد العدد**'); await m.delete().catch(() => {}); });
                break;
            case 'clear':
                await room.setUserLimit(0);
                await room.setName(`Room ${interaction.user.username}`);
                await room.permissionOverwrites.set([{ id: interaction.guild.id, deny: [PermissionFlagsBits.Connect] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }]);
                await interaction.reply({ content: '**✅ تم تصفير إعدادات الروم بالكامل**', ephemeral: true });
                break;
            case 'ban':
                await interaction.reply({ content: '**منشن العضو لمنعه:**', ephemeral: true });
                const bColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id && m.mentions.users.first(), time: 15000, max: 1 });
                bColl.on('collect', async m => {
                    const target = m.mentions.users.first();
                    await room.permissionOverwrites.edit(target, { Connect: false, ViewChannel: false });
                    if (room.members.has(target.id)) await interaction.guild.members.cache.get(target.id).voice.disconnect();
                    await m.reply(`**✅ تم منع <@${target.id}> نهائياً**`); await m.delete().catch(() => {});
                });
                break;
            case 'kick':
                if (room.members.size === 0) return interaction.reply({ content: '**الروم فارغ**', ephemeral: true });
                const kMenu = new StringSelectMenuBuilder().setCustomId(`kick_sel_${rId}`).setPlaceholder('اختر العضو لطرده').addOptions(room.members.map(m => ({ label: m.displayName, value: m.id })));
                await interaction.reply({ content: '**اختر العضو:**', components: [new ActionRowBuilder().addComponents(kMenu)], ephemeral: true });
                break;
            case 'pull':
                await interaction.reply({ content: '**منشن العضو لسحبه:**', ephemeral: true });
                const pColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id && m.mentions.users.first(), time: 15000, max: 1 });
                pColl.on('collect', async m => {
                    const target = m.mentions.members.first();
                    if (!target?.voice.channel) return m.reply('**العضو ليس في روم صوتي**');
                    await target.voice.setChannel(room); await m.reply(`**✅ تم سحب <@${target.id}>**`); await m.delete().catch(() => {});
                });
                break;
            case 'mute':
                if (room.members.size === 0) return interaction.reply({ content: '**الروم فارغ**', ephemeral: true });
                const mMenu = new StringSelectMenuBuilder().setCustomId(`mute_sel_${rId}`).setPlaceholder('اختر العضو لكتمه').addOptions(room.members.map(m => ({ label: m.displayName, value: m.id })));
                await interaction.reply({ content: '**اختر العضو:**', components: [new ActionRowBuilder().addComponents(mMenu)], ephemeral: true });
                break;
            case 'unmute':
                if (room.members.size === 0) return interaction.reply({ content: '**الروم فارغ**', ephemeral: true });
                const uMenu = new StringSelectMenuBuilder().setCustomId(`unmute_sel_${rId}`).setPlaceholder('اختر العضو لإلغاء كتمه').addOptions(room.members.map(m => ({ label: m.displayName, value: m.id })));
                await interaction.reply({ content: '**اختر العضو:**', components: [new ActionRowBuilder().addComponents(uMenu)], ephemeral: true });
                break;
            case 'speak':
                const sLock = room.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Speak);
                await room.permissionOverwrites.edit(interaction.guild.roles.everyone, { Speak: sLock ? null : false });
                await interaction.reply({ content: `**✅ تم ${sLock ? 'السماح' : 'منع'} الجميع من التحدث**`, ephemeral: true });
                break;
            case 'own':
                await interaction.reply({ content: '**منشن المالك الجديد:**', ephemeral: true });
                const oColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id && m.mentions.users.first(), time: 15000, max: 1 });
                oColl.on('collect', async m => {
                    const target = m.mentions.users.first();
                    guildOwners[rId] = target.id; owners[interaction.guild.id] = guildOwners; saveRoomOwners(owners);
                    await room.permissionOverwrites.edit(target, { ManageChannels: true, Connect: true, Speak: true });
                    await room.permissionOverwrites.delete(interaction.user.id);
                    await m.reply(`**✅ تم نقل الملكية لـ <@${target.id}>**`); await m.delete().catch(() => {});
                });
                break;
        }
    }

    // معالجة القوائم المنسدلة (طرد، كتم، إلغاء كتم)
    if (interaction.isStringSelectMenu()) {
        const [act, sub, rId] = interaction.customId.split('_'), targetId = interaction.values[0], room = interaction.guild.channels.cache.get(rId);
        if (!room) return;
        const member = interaction.guild.members.cache.get(targetId);
        if (!member) return;

        if (act === 'kick') {
            await member.voice.disconnect();
            await interaction.update({ content: `**✅ تم طرد <@${targetId}>**`, components: [], ephemeral: true });
        } else if (act === 'mute') {
            await member.voice.setMute(true);
            await interaction.update({ content: `**✅ تم كتم <@${targetId}>**`, components: [], ephemeral: true });
        } else if (act === 'unmute') {
            await member.voice.setMute(false);
            await interaction.update({ content: `**✅ تم إلغاء كتم <@${targetId}>**`, components: [], ephemeral: true });
        }
    }
}

async function showUserActivity(m, u, c) {
    const a = await getUserActivity(u.id);
    const emb = colorManager.createEmbed().setTitle('**User Activity**').setThumbnail(u.displayAvatarURL({ dynamic: true })).setDescription(`**User:** ${u}`).addFields([{ name: 'Last Voice', value: a.lastVoiceChannel ? `${a.lastVoiceChannel} - ${formatTimeSince(a.lastVoiceTime)}` : 'No Data' }, { name: 'Last Text', value: a.lastMessageChannel ? `${a.lastMessageChannel} - ${formatTimeSince(a.lastMessageTime)}` : 'No Data' }]);
    await m.channel.send({ embeds: [emb] });
}

async function showAdminRolesActivity(m, c, r) {
    const admins = new Map();
    for (const id of r) { const role = await m.guild.roles.fetch(id); if (role) role.members.forEach(mem => { if (!mem.user.bot) admins.set(mem.id, mem); }); }
    const acts = []; for (const [id, mem] of admins) { const a = await getUserActivity(id); acts.push({ mem, a, total: a.totalMessages + (a.totalVoiceTime / 60000) }); }
    acts.sort((a, b) => b.total - a.total);
    const emb = colorManager.createEmbed().setTitle('**Admin Activity**').setDescription(acts.slice(0, 10).map((d, i) => `**#${i + 1} - ${d.mem.displayName}**`).join('\n'));
    await m.channel.send({ embeds: [emb] });
}

async function showRoleActivity(m, r, c) {
    const acts = []; for (const [id, mem] of r.members) { if (!mem.user.bot) { const a = await getUserActivity(id); acts.push({ mem, a, total: a.totalMessages + (a.totalVoiceTime / 60000) }); } }
    acts.sort((a, b) => b.total - a.total);
    const emb = colorManager.createEmbed().setTitle(`**Role: ${r.name}**`).setDescription(acts.slice(0, 10).map((d, i) => `**#${i + 1} - ${d.mem.displayName}**`).join('\n'));
    await m.channel.send({ embeds: [emb] });
}

module.exports = { name, execute, handleInteractions };
