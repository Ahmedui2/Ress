const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

const name = 'rooms';
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');
const roomOwnersPath = path.join(__dirname, '..', 'data', 'roomOwners.json');
const rejectedRequestsPath = path.join(__dirname, '..', 'data', 'rejectedRequests.json');

// --- دوال المساعدة والبيانات ---
function loadJSON(filePath) { try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); return {}; } catch (e) { return {}; } }
function saveJSON(filePath, data) { try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); return true; } catch (e) { return false; } }

function formatTimeSince(timestamp) {
    if (!timestamp) return 'No Data';
    const diff = Date.now() - new Date(timestamp).getTime();
    const days = Math.floor(diff / 86400000), hours = Math.floor((diff % 86400000) / 3600000), minutes = Math.floor((diff % 3600000) / 60000);
    return days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : `${minutes}m ago`;
}

async function getUserActivity(userId) {
    try {
        const { getDatabase } = require('../utils/database');
        const dbManager = getDatabase();
        const stats = await dbManager.getUserStats(userId);
        const weeklyStats = await dbManager.getWeeklyStats(userId);
        const lastVoice = await dbManager.get(`SELECT end_time, channel_name FROM voice_sessions WHERE user_id = ? ORDER BY end_time DESC LIMIT 1`, [userId]);
        const lastMsg = await dbManager.get(`SELECT last_message, channel_name FROM message_channels WHERE user_id = ? ORDER BY last_message DESC LIMIT 1`, [userId]);
        return {
            totalMessages: stats.totalMessages || 0,
            totalVoiceTime: stats.totalVoiceTime || 0,
            weeklyMessages: weeklyStats.weeklyMessages || 0,
            weeklyVoiceTime: weeklyStats.weeklyTime || 0,
            lastVoiceTime: lastVoice?.end_time,
            lastVoiceChannel: lastVoice?.channel_name,
            lastMessageTime: lastMsg?.last_message,
            lastMessageChannel: lastMsg?.channel_name
        };
    } catch (e) { return { totalMessages: 0, totalVoiceTime: 0, weeklyMessages: 0, weeklyVoiceTime: 0 }; }
}

function generateRoomsListEmbed(guild, displayType) {
    const config = loadJSON(roomConfigPath);
    const categoryId = config[guild.id]?.roomsCategoryId;
    const category = guild.channels.cache.get(categoryId);
    if (!category) return null;

    const rooms = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
    const owners = loadJSON(roomOwnersPath)[guild.id] || {};
    
    let description = `**قائمة الرومات في كاتوقري: ${category.name}**\n\n`;
    const availableRooms = [];

    rooms.forEach((room, index) => {
        const ownerId = owners[room.id];
        const ownerMention = ownerId ? `<@${ownerId}>` : '`لا يوجد مالك`';
        if (!ownerId) availableRooms.push({ label: room.name, value: room.id });
        
        description += `**${index + 1}- ${displayType === 'names' ? room.name : `<#${room.id}>`}** | المالك: ${ownerMention}\n`;
    });

    const embed = colorManager.createEmbed()
        .setTitle('**قائمة الرومات وأصحابها**')
        .setDescription(description)
        .setFooter({ text: `By Ahmed.`, iconURL: guild.iconURL({ dynamic: true }) });

    return { embed, availableRooms };
}

// --- الوظيفة الرئيسية ---
async function execute(message, args, { client, BOT_OWNERS, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) return;
    const sub = args[0]?.toLowerCase();

    // 1. إعدادات الكاتوقري
    if (sub === 'sub' && args[1]?.toLowerCase() === 'ctg') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const id = args[2]?.replace(/[<#>]/g, '');
        const cat = message.guild.channels.cache.get(id);
        if (!cat || cat.type !== ChannelType.GuildCategory) return message.reply('**الرجاء تحديد ID كاتوقري صحيح**');
        const config = loadJSON(roomConfigPath);
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].roomsCategoryId = id;
        saveJSON(roomConfigPath, config);
        return message.reply(`**✅ تم تحديد كاتوقري الرومات: \`${cat.name}\`**`);
    }

    // 2. إعدادات قناة الطلبات
    if (sub === 'sub' && args[1]?.toLowerCase() === 'req') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const id = args[2]?.replace(/[<#>]/g, '');
        if (!message.guild.channels.cache.has(id)) return message.reply('**القناة غير موجودة**');
        const config = loadJSON(roomConfigPath);
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].requestChannelId = id;
        saveJSON(roomConfigPath, config);
        return message.reply(`**✅ تم تحديد قناة الطلبات: <#${id}>**`);
    }

    // 3. عرض قائمة الرومات
    if (sub === 'list') {
        const res = generateRoomsListEmbed(message.guild, 'names');
        if (!res) return message.reply('**الرجاء ضبط الكاتوقري أولاً باستخدام `rooms sub ctg <ID>`**');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rooms_list_names').setLabel('عرض بالأسماء').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rooms_list_numbers').setLabel('عرض بالأرقام').setStyle(ButtonStyle.Secondary)
        );

        const msg = await message.channel.send({ 
            embeds: [colorManager.createEmbed().setTitle('**نظام الرومات الخاصة**').setDescription('**اختر طريقة عرض الرومات:**')], 
            components: [row] 
        });

        const coll = msg.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });
        coll.on('collect', async i => {
            const type = i.customId === 'rooms_list_names' ? 'names' : 'numbers';
            const list = generateRoomsListEmbed(message.guild, type);
            const btnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`request_room_btn_${type}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success)
            );
            await i.update({ embeds: [list.embed], components: [btnRow] });
        });
        return;
    }

    // 4. لوحة التحكم
    if (sub === 'control') {
        const owners = loadJSON(roomOwnersPath)[message.guild.id] || {};
        const roomId = Object.keys(owners).find(id => owners[id] === message.author.id);
        if (!roomId) return message.reply('**❌ أنت لا تملك روماً خاصاً حالياً**');
        const room = message.guild.channels.cache.get(roomId);
        if (!room) return message.reply('**❌ الروم الخاص بك غير موجود**');

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

    // --- الوظائف الأصلية (عرض النشاط) ---
    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.react('❌');
        return;
    }

    if (args[0]?.toLowerCase() === 'admin') {
        await showAdminRolesActivity(message, client, ADMIN_ROLES);
        return;
    }

    let targetRole = message.mentions.roles.first();
    let targetUser = message.mentions.users.first();

    if (!targetRole && !targetUser && args[0]) {
        const id = args[0];
        try { targetRole = await message.guild.roles.fetch(id); } catch (e) {}
        if (!targetRole) { try { targetUser = (await message.guild.members.fetch(id)).user; } catch (e) {} }
    }

    if (!targetRole && !targetUser) {
        const embed = colorManager.createEmbed()
            .setTitle('**Rooms System**')
            .setDescription('**أوامر الرومات الخاصة:**\n`rooms sub ctg <ID>` - ضبط الكاتوقري\n`rooms sub req <#channel>` - ضبط قناة الطلبات\n`rooms list` - عرض قائمة الرومات\n`rooms control` - لوحة تحكم رومك\n\n**أوامر النشاط:**\n`rooms @User` - نشاط عضو\n`rooms @Role` - نشاط رتبة\n`rooms admin` - نشاط الإدارة')
            .setFooter({ text: `By Ahmed.` });
        await message.channel.send({ embeds: [embed] });
        return;
    }

    if (targetUser) await showUserActivity(message, targetUser, client);
    else await showRoleActivity(message, targetRole, client);
}

// --- معالج التفاعلات ---
async function handleInteractions(interaction, { BOT_OWNERS }) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    const owners = loadJSON(roomOwnersPath), guildOwners = owners[interaction.guild.id] || {};
    const rejected = loadJSON(rejectedRequestsPath), guildRejected = rejected[interaction.guild.id] || {};

    // 1. طلب روم
    if (interaction.isButton() && interaction.customId.startsWith('request_room_btn_')) {
        const type = interaction.customId.split('_')[3], res = generateRoomsListEmbed(interaction.guild, type);
        if (res.availableRooms.length === 0) return interaction.reply({ content: '**❌ لا توجد رومات متاحة حالياً**', ephemeral: true });
        const menu = new StringSelectMenuBuilder().setCustomId(`sel_req_${type}_${interaction.message.id}`).setPlaceholder('اختر الروم الذي تريد طلبه').addOptions(res.availableRooms.slice(0, 25));
        await interaction.reply({ content: '**اختر الروم من القائمة:**', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    // 2. اختيار الروم
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sel_req_')) {
        const parts = interaction.customId.split('_'), type = parts[2], msgId = parts[3], roomId = interaction.values[0];
        if (guildRejected[interaction.user.id]?.includes(roomId)) return interaction.update({ content: '**❌ تم رفض طلبك لهذا الروم مسبقاً**', components: [], ephemeral: true });
        const reqId = loadJSON(roomConfigPath)[interaction.guild.id]?.requestChannelId, reqChan = interaction.guild.channels.cache.get(reqId);
        if (!reqChan) return interaction.update({ content: '**❌ قناة الطلبات غير مضبوطة**', components: [], ephemeral: true });
        
        const emb = colorManager.createEmbed().setTitle('**🆕 طلب روم جديد**').setDescription(`**المستخدم:** <@${interaction.user.id}>\n**الروم:** <#${roomId}>`).setFooter({ text: `ID: ${roomId}|U:${interaction.user.id}|M:${msgId}|T:${type}` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`app_r_${interaction.user.id}_${roomId}_${msgId}_${type}`).setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rej_r_${interaction.user.id}_${roomId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
        );
        await reqChan.send({ embeds: [emb], components: [row] });
        await interaction.update({ content: '**✅ تم إرسال طلبك للإدارة**', components: [], ephemeral: true });
    }

    // 3. قبول/رفض
    if (interaction.isButton() && (interaction.customId.startsWith('app_r_') || interaction.customId.startsWith('rej_r_'))) {
        if (!BOT_OWNERS.includes(interaction.user.id) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '**للإدارة فقط**', ephemeral: true });
        const p = interaction.customId.split('_'), act = p[0], uId = p[2], rId = p[3];
        if (act === 'app') {
            guildOwners[rId] = uId; owners[interaction.guild.id] = guildOwners; saveJSON(roomOwnersPath, owners);
            const room = interaction.guild.channels.cache.get(rId);
            if (room) await room.permissionOverwrites.edit(uId, { ManageChannels: true, Connect: true, Speak: true, MuteMembers: true, DeafenMembers: true, MoveMembers: true });
            await interaction.update({ content: `**✅ تم قبول <@${uId}> للروم <#${rId}>**`, embeds: [], components: [] });
            
            const listMsg = await interaction.channel.messages.fetch(p[4]).catch(() => null);
            if (listMsg) {
                const up = generateRoomsListEmbed(interaction.guild, p[5]);
                await listMsg.edit({ embeds: [up.embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`request_room_btn_${p[5]}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success))] });
            }
        } else {
            if (!guildRejected[uId]) guildRejected[uId] = []; guildRejected[uId].push(rId);
            rejected[interaction.guild.id] = guildRejected; saveJSON(rejectedRequestsPath, rejected);
            await interaction.update({ content: `**❌ تم رفض طلب <@${uId}>**`, embeds: [], components: [] });
        }
    }

    // 4. أزرار لوحة التحكم
    if (interaction.isButton() && interaction.customId.startsWith('rc_')) {
        const p = interaction.customId.split('_'), act = p[1], rId = p[2];
        if (guildOwners[rId] !== interaction.user.id) return interaction.reply({ content: '**❌ لست صاحب هذا الروم**', ephemeral: true });
        const room = interaction.guild.channels.cache.get(rId);
        if (!room) return interaction.reply({ content: '**❌ الروم غير موجود**', ephemeral: true });

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
                await interaction.reply({ content: '**✅ تم تصفير الروم**', ephemeral: true });
                break;
            case 'ban':
                await interaction.reply({ content: '**منشن العضو لمنعه:**', ephemeral: true });
                const bColl = interaction.channel.createMessageCollector({ filter: m => m.author.id === interaction.user.id && m.mentions.users.first(), time: 15000, max: 1 });
                bColl.on('collect', async m => {
                    const target = m.mentions.users.first();
                    await room.permissionOverwrites.edit(target, { Connect: false, ViewChannel: false });
                    if (room.members.has(target.id)) await interaction.guild.members.cache.get(target.id).voice.disconnect();
                    await m.reply(`**✅ تم منع <@${target.id}>**`); await m.delete().catch(() => {});
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
                    guildOwners[rId] = target.id; owners[interaction.guild.id] = guildOwners; saveJSON(roomOwnersPath, owners);
                    await room.permissionOverwrites.edit(target, { ManageChannels: true, Connect: true, Speak: true });
                    await room.permissionOverwrites.delete(interaction.user.id);
                    await m.reply(`**✅ تم نقل الملكية لـ <@${target.id}>**`); await m.delete().catch(() => {});
                });
                break;
        }
    }

    // معالجة القوائم (طرد، كتم، إلغاء كتم)
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('kick_sel_') || interaction.customId.startsWith('mute_sel_') || interaction.customId.startsWith('unmute_sel_'))) {
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

// --- وظائف عرض النشاط الأصلية ---
async function showUserActivity(message, user, client) {
    try {
        const activity = await getUserActivity(user.id);
        const embed = colorManager.createEmbed()
            .setTitle(`**User Activity**`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`**User:** ${user}`)
            .addFields([
                { name: 'Last Voice', value: activity.lastVoiceChannel ? `${activity.lastVoiceChannel} - ${formatTimeSince(activity.lastVoiceTime)}` : 'No Data' },
                { name: 'Last Text', value: activity.lastMessageChannel ? `${activity.lastMessageChannel} - ${formatTimeSince(activity.lastMessageTime)}` : 'No Data' }
            ]);
        await message.channel.send({ embeds: [embed] });
    } catch (e) { await message.channel.send('**حدث خطأ أثناء جلب البيانات**'); }
}

async function showAdminRolesActivity(message, client, ADMIN_ROLES) {
    try {
        const admins = new Map();
        for (const id of ADMIN_ROLES) {
            const role = await message.guild.roles.fetch(id);
            if (role) role.members.forEach(m => { if (!m.user.bot) admins.set(m.id, m); });
        }
        const acts = [];
        for (const [id, m] of admins) {
            const a = await getUserActivity(id);
            acts.push({ m, a, total: a.totalMessages + (a.totalVoiceTime / 60000) });
        }
        acts.sort((a, b) => b.total - a.total);
        const embed = colorManager.createEmbed().setTitle('**Admin Activity**').setDescription(acts.slice(0, 10).map((d, i) => `**#${i + 1} - ${d.m.displayName}**`).join('\n'));
        await message.channel.send({ embeds: [embed] });
    } catch (e) { await message.channel.send('**حدث خطأ**'); }
}

async function showRoleActivity(message, role, client) {
    try {
        const acts = [];
        for (const [id, m] of role.members) {
            if (!m.user.bot) {
                const a = await getUserActivity(id);
                acts.push({ m, a, total: a.totalMessages + (a.totalVoiceTime / 60000) });
            }
        }
        acts.sort((a, b) => b.total - a.total);
        const embed = colorManager.createEmbed().setTitle(`**Role: ${role.name}**`).setDescription(acts.slice(0, 10).map((d, i) => `**#${i + 1} - ${d.m.displayName}**`).join('\n'));
        await message.channel.send({ embeds: [embed] });
    } catch (e) { await message.channel.send('**حدث خطأ**'); }
}

module.exports = { name, execute, handleInteractions };
