const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const name = 'rooms';
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');
const roomOwnersPath = path.join(__dirname, '..', 'data', 'roomOwners.json');
const rejectedRequestsPath = path.join(__dirname, '..', 'data', 'rejectedRequests.json');

// دالة لتحميل إعدادات الرومات
function loadRoomConfig() {
    try {
        if (fs.existsSync(roomConfigPath)) return JSON.parse(fs.readFileSync(roomConfigPath, 'utf8'));
        return {};
    } catch (error) { return {}; }
}

// دالة لحفظ إعدادات الرومات
function saveRoomConfig(config) {
    try {
        fs.writeFileSync(roomConfigPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) { return false; }
}

// دالة لتحميل الملاك
function loadRoomOwners() {
    try {
        if (fs.existsSync(roomOwnersPath)) return JSON.parse(fs.readFileSync(roomOwnersPath, 'utf8'));
        return {};
    } catch (error) { return {}; }
}

// دالة لحفظ الملاك
function saveRoomOwners(owners) {
    try {
        fs.writeFileSync(roomOwnersPath, JSON.stringify(owners, null, 2), 'utf8');
        return true;
    } catch (error) { return false; }
}

// دالة لتحميل الطلبات المرفوضة
function loadRejectedRequests() {
    try {
        if (fs.existsSync(rejectedRequestsPath)) return JSON.parse(fs.readFileSync(rejectedRequestsPath, 'utf8'));
        return {};
    } catch (error) { return {}; }
}

// دالة لحفظ الطلبات المرفوضة
function saveRejectedRequests(rejected) {
    try {
        fs.writeFileSync(rejectedRequestsPath, JSON.stringify(rejected, null, 2), 'utf8');
        return true;
    } catch (error) { return false; }
}

function formatTimeSince(timestamp) {
    if (!timestamp) return 'No Data';
    const now = Date.now();
    const diff = now - new Date(timestamp).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
    if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}s`);
    return parts.length > 0 ? parts.join(' ') + ' ago' : 'Now';
}

async function getUserActivity(userId) {
    try {
        const { getDatabase } = require('../utils/database');
        const dbManager = getDatabase();
        const stats = await dbManager.getUserStats(userId);
        const weeklyStats = await dbManager.getWeeklyStats(userId);
        const lastVoiceSession = await dbManager.get(`SELECT end_time, channel_name FROM voice_sessions WHERE user_id = ? ORDER BY end_time DESC LIMIT 1`, [userId]);
        const lastMessage = await dbManager.get(`SELECT last_message, channel_name FROM message_channels WHERE user_id = ? ORDER BY last_message DESC LIMIT 1`, [userId]);
        return {
            totalMessages: stats.totalMessages || 0,
            totalVoiceTime: stats.totalVoiceTime || 0,
            weeklyMessages: weeklyStats.weeklyMessages || 0,
            weeklyVoiceTime: weeklyStats.weeklyTime || 0,
            lastVoiceTime: lastVoiceSession ? lastVoiceSession.end_time : null,
            lastVoiceChannel: lastVoiceSession ? lastVoiceSession.channel_name : null,
            lastMessageTime: lastMessage ? lastMessage.last_message : null,
            lastMessageChannel: lastMessage ? lastMessage.channel_name : null
        };
    } catch (error) {
        return { totalMessages: 0, totalVoiceTime: 0, weeklyMessages: 0, weeklyVoiceTime: 0, lastVoiceTime: null, lastVoiceChannel: null, lastMessageTime: null, lastMessageChannel: null };
    }
}

// دالة لتوليد إيمبد قائمة الرومات
function generateRoomsListEmbed(guild, displayType) {
    const config = loadRoomConfig();
    const guildConfig = config[guild.id];
    const categoryId = guildConfig?.roomsCategoryId;
    if (!categoryId) return null;
    const category = guild.channels.cache.get(categoryId);
    if (!category) return null;

    const rooms = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
    const owners = loadRoomOwners();
    const guildOwners = owners[guild.id] || {};
    
    let description = `**قائمة الرومات في كاتوقري: ${category.name}**\n\n`;
    let index = 1;
    const availableRooms = [];

    rooms.forEach(room => {
        const ownerId = guildOwners[room.id];
        const ownerMention = ownerId ? `<@${ownerId}>` : '`لا يوجد مالك`';
        if (!ownerId) availableRooms.push({ label: room.name, value: room.id });
        
        if (displayType === 'names') {
            description += `**${index}- ${room.name}** | المالك: ${ownerMention}\n`;
        } else {
            description += `**${index}- <#${room.id}>** | المالك: ${ownerMention}\n`;
        }
        index++;
    });

    const embed = colorManager.createEmbed()
        .setTitle('**قائمة الرومات وأصحابها**')
        .setDescription(description)
        .setFooter({ text: `By Ahmed.`, iconURL: guild.iconURL({ dynamic: true }) });

    return { embed, availableRooms };
}

async function execute(message, args, { client, BOT_OWNERS, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const subCommand = args[0]?.toLowerCase();

    if (subCommand === 'sub' && args[1]?.toLowerCase() === 'ctg') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const categoryId = args[2]?.replace(/[<#>]/g, '');
        if (!categoryId) return message.reply('**الرجاء تحديد ID الكاتوقري أو منشن الكاتوقري**');
        const category = message.guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) return message.reply('**الرجاء التأكد من أن الـ ID يخص كاتوقري صحيح**');
        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].roomsCategoryId = categoryId;
        saveRoomConfig(config);
        return message.reply(`**✅ تم تحديد كاتوقري الرومات الخاصة بنجاح: \`${category.name}\`**`);
    }

    if (subCommand === 'sub' && args[1]?.toLowerCase() === 'req') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
        const channelId = args[2]?.replace(/[<#>]/g, '');
        if (!channelId) return message.reply('**الرجاء منشن القناة أو وضع الـ ID**');
        const channel = message.guild.channels.cache.get(channelId);
        if (!channel) return message.reply('**القناة غير موجودة**');
        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].requestChannelId = channelId;
        saveRoomConfig(config);
        return message.reply(`**✅ تم تحديد قناة طلبات الرومات بنجاح: <#${channelId}>**`);
    }

    if (subCommand === 'list') {
        const result = generateRoomsListEmbed(message.guild, 'names');
        if (!result) return message.reply('**الرجاء ضبط الكاتوقري أولاً.**');

        const embed = colorManager.createEmbed()
            .setTitle('**نظام الرومات الخاصة**')
            .setDescription('**اختر طريقة عرض الرومات:**')
            .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rooms_list_names').setLabel('عرض بالأسماء').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rooms_list_numbers').setLabel('عرض بالأرقام').setStyle(ButtonStyle.Secondary)
        );

        const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });
        const collector = sentMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 60000 });

        collector.on('collect', async i => {
            const displayType = i.customId === 'rooms_list_names' ? 'names' : 'numbers';
            const listResult = generateRoomsListEmbed(message.guild, displayType);
            
            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`request_room_btn_${displayType}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success)
            );

            await i.update({ embeds: [listResult.embed], components: [controlRow] });
        });
        return;
    }

    if (subCommand === 'control') {
        const owners = loadRoomOwners();
        const guildOwners = owners[message.guild.id] || {};
        let userRoomId = null;
        for (const [roomId, ownerId] of Object.entries(guildOwners)) {
            if (ownerId === message.author.id) { userRoomId = roomId; break; }
        }
        if (!userRoomId) return message.reply('**❌ أنت لا تملك أي روم خاص حالياً**');
        const room = message.guild.channels.cache.get(userRoomId);
        if (!room) return message.reply('**❌ الروم الخاص بك غير موجود**');

        const controlEmbed = colorManager.createEmbed()
            .setTitle('**🎮 لوحة تحكم الروم الخاص**')
            .setDescription(`**أهلاً بك في لوحة التحكم الخاصة برومك: <#${room.id}>**`)
            .addFields(
                { name: '🔒 القفل', value: 'لقفل أو فتح الروم', inline: true },
                { name: '👁️ الرؤية', value: 'إظهار أو إخفاء الروم', inline: true },
                { name: '👥 العدد', value: 'تحديد عدد الأشخاص', inline: true },
                { name: '📝 الاسم', value: 'تغيير اسم الروم', inline: true },
                { name: '🚫 المنع', value: 'منع عضو من الدخول', inline: true },
                { name: '👑 الملكية', value: 'نقل ملكية الروم', inline: true }
            );

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`room_lock_${room.id}`).setLabel('قفل/فتح').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
            new ButtonBuilder().setCustomId(`room_visibility_${room.id}`).setLabel('إظهار/إخفاء').setStyle(ButtonStyle.Secondary).setEmoji('👁️'),
            new ButtonBuilder().setCustomId(`room_limit_${room.id}`).setLabel('تحديد العدد').setStyle(ButtonStyle.Secondary).setEmoji('👥')
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`room_rename_${room.id}`).setLabel('تغيير الاسم').setStyle(ButtonStyle.Primary).setEmoji('📝'),
            new ButtonBuilder().setCustomId(`room_kick_${room.id}`).setLabel('سحب/طرد').setStyle(ButtonStyle.Danger).setEmoji('👢'),
            new ButtonBuilder().setCustomId(`room_transfer_${room.id}`).setLabel('نقل الملكية').setStyle(ButtonStyle.Success).setEmoji('👑')
        );

        return message.channel.send({ embeds: [controlEmbed], components: [row1, row2] });
    }

    const member = await message.guild.members.fetch(message.author.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) return message.react('❌');
    if (args[0] && args[0].toLowerCase() === 'admin') return await showAdminRolesActivity(message, client, ADMIN_ROLES);

    let targetRole = message.mentions.roles.first();
    let targetUser = message.mentions.users.first();
    if (!targetRole && !targetUser && args[0]) {
        const id = args[0];
        try { targetRole = await message.guild.roles.fetch(id); } catch (error) {}
        if (!targetRole) { try { const fetchedMember = await message.guild.members.fetch(id); targetUser = fetchedMember.user; } catch (error) {} }
    }

    if (!targetRole && !targetUser) {
        const embed = colorManager.createEmbed()
            .setTitle('**Rooms System**')
            .setDescription('**أوامر الرومات الخاصة:**\n`rooms sub ctg <ID>` - ضبط الكاتوقري\n`rooms sub req <#channel>` - ضبط قناة الطلبات\n`rooms list` - عرض قائمة الرومات\n`rooms control` - لوحة تحكم رومك')
            .setFooter({ text: `By Ahmed.` });
        await message.channel.send({ embeds: [embed] });
        return;
    }

    if (targetUser) await showUserActivity(message, targetUser, client);
    else await showRoleActivity(message, targetRole, client);
}

async function handleInteractions(interaction, { BOT_OWNERS }) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const owners = loadRoomOwners();
    const guildOwners = owners[interaction.guild.id] || {};
    const rejected = loadRejectedRequests();
    const guildRejected = rejected[interaction.guild.id] || {};

    // معالجة زر طلب روم
    if (interaction.isButton() && interaction.customId.startsWith('request_room_btn_')) {
        const displayType = interaction.customId.split('_')[3];
        const result = generateRoomsListEmbed(interaction.guild, displayType);
        if (result.availableRooms.length === 0) return interaction.reply({ content: '**❌ لا توجد رومات متاحة حالياً**', ephemeral: true });
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_room_to_request_${displayType}_${interaction.message.id}`)
            .setPlaceholder('اختر الروم الذي تريد طلبه')
            .addOptions(result.availableRooms.slice(0, 25));

        const menuRow = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.reply({ content: '**اختر الروم من القائمة أدناه:**', components: [menuRow], ephemeral: true });
        return;
    }

    // معالجة اختيار الروم من المنيو
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_room_to_request_')) {
        const parts = interaction.customId.split('_');
        const displayType = parts[4];
        const listMessageId = parts[5];
        const roomId = interaction.values[0];

        // التحقق من الرفض السابق
        if (guildRejected[interaction.user.id] && guildRejected[interaction.user.id].includes(roomId)) {
            return interaction.update({ content: '**❌ لقد تم رفض طلبك لهذا الروم مسبقاً، لا يمكنك التقديم عليه مرة أخرى.**', components: [], ephemeral: true });
        }

        const config = loadRoomConfig();
        const reqChannelId = config[interaction.guild.id]?.requestChannelId;
        if (!reqChannelId) return interaction.update({ content: '**❌ لم يتم تحديد قناة الطلبات بعد**', components: [], ephemeral: true });
        const reqChannel = interaction.guild.channels.cache.get(reqChannelId);
        if (!reqChannel) return interaction.update({ content: '**❌ قناة الطلبات غير موجودة**', components: [], ephemeral: true });

        const requestEmbed = colorManager.createEmbed()
            .setTitle('**🆕 طلب روم جديد**')
            .setDescription(`**المستخدم:** <@${interaction.user.id}>\n**الروم المطلوب:** <#${roomId}>\n\n**اضغط على الأزرار أدناه للقبول أو الرفض**`)
            .setFooter({ text: `Room ID: ${roomId} | User ID: ${interaction.user.id} | Msg: ${listMessageId} | Type: ${displayType}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_room_${interaction.user.id}_${roomId}_${listMessageId}_${displayType}`).setLabel('قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_room_${interaction.user.id}_${roomId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
        );

        await reqChannel.send({ embeds: [requestEmbed], components: [row] });
        return interaction.update({ content: '**✅ تم إرسال طلبك للإدارة بنجاح**', components: [], ephemeral: true });
    }

    // معالجة قبول/رفض الطلب
    if (interaction.isButton() && (interaction.customId.startsWith('approve_room_') || interaction.customId.startsWith('reject_room_'))) {
        if (!BOT_OWNERS.includes(interaction.user.id) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '**❌ هذا الزر مخصص للإدارة فقط**', ephemeral: true });
        }

        const parts = interaction.customId.split('_');
        const action = parts[0];
        const userId = parts[2];
        const roomId = parts[3];

        if (action === 'approve') {
            const listMessageId = parts[4];
            const displayType = parts[5];
            
            guildOwners[roomId] = userId;
            owners[interaction.guild.id] = guildOwners;
            saveRoomOwners(owners);

            const room = interaction.guild.channels.cache.get(roomId);
            if (room) {
                await room.permissionOverwrites.edit(userId, { ManageChannels: true, Connect: true, Speak: true, MuteMembers: true, DeafenMembers: true, MoveMembers: true });
            }

            await interaction.update({ content: `**✅ تم قبول طلب <@${userId}> للروم <#${roomId}>**`, embeds: [], components: [] });
            
            // تحديث رسالة القائمة تلقائياً
            try {
                const listChannel = interaction.channel; // نفترض أنها في نفس القناة أو نحتاج لتخزين الـ ID
                const listMsg = await listChannel.messages.fetch(listMessageId).catch(() => null);
                if (listMsg) {
                    const updatedResult = generateRoomsListEmbed(interaction.guild, displayType);
                    const updatedRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`request_room_btn_${displayType}`).setLabel('طلب روم متاح').setStyle(ButtonStyle.Success)
                    );
                    await listMsg.edit({ embeds: [updatedResult.embed], components: [updatedRow] });
                }
            } catch (e) {}

            try {
                const user = await interaction.client.users.fetch(userId);
                await user.send(`**🎉 مبروك! تم قبول طلبك للروم <#${roomId}>.**`);
            } catch (e) {}
        } else {
            // تسجيل الرفض
            if (!guildRejected[userId]) guildRejected[userId] = [];
            if (!guildRejected[userId].includes(roomId)) guildRejected[userId].push(roomId);
            rejected[interaction.guild.id] = guildRejected;
            saveRejectedRequests(rejected);

            await interaction.update({ content: `**❌ تم رفض طلب <@${userId}> للروم <#${roomId}> ولن يتمكن من التقديم عليه مجدداً.**`, embeds: [], components: [] });
        }
        return;
    }

    // معالجة أزرار لوحة التحكم
    if (interaction.isButton() && interaction.customId.startsWith('room_')) {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const roomId = parts[2];
        if (guildOwners[roomId] !== interaction.user.id) return interaction.reply({ content: '**❌ أنت لست صاحب هذا الروم**', ephemeral: true });
        const room = interaction.guild.channels.cache.get(roomId);
        if (!room) return interaction.reply({ content: '**❌ الروم غير موجود**', ephemeral: true });

        switch (action) {
            case 'lock':
                const isLocked = room.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect);
                await room.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: isLocked ? null : false });
                await interaction.reply({ content: `**✅ تم ${isLocked ? 'فتح' : 'قفل'} الروم بنجاح**`, ephemeral: true });
                break;
            case 'visibility':
                const isHidden = room.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel);
                await room.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: isHidden ? null : false });
                await interaction.reply({ content: `**✅ تم ${isHidden ? 'إظهار' : 'إخفاء'} الروم بنجاح**`, ephemeral: true });
                break;
            case 'limit':
                await interaction.reply({ content: '**يرجى كتابة العدد المطلوب (0-99) في الشات الآن:**', ephemeral: true });
                const filter = m => m.author.id === interaction.user.id && !isNaN(m.content) && m.content >= 0 && m.content <= 99;
                const collector = interaction.channel.createMessageCollector({ filter, time: 15000, max: 1 });
                collector.on('collect', async m => {
                    await room.setUserLimit(parseInt(m.content));
                    await m.reply(`**✅ تم تحديد عدد الأشخاص بـ ${m.content}**`);
                    await m.delete().catch(() => {});
                });
                break;
        }
    }
}

async function showUserActivity(message, user, client) {
    try {
        const activity = await getUserActivity(user.id);
        let lastVoiceInfo = '**No Data**';
        if (activity.lastVoiceChannel) {
            const voiceChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastVoiceChannel);
            lastVoiceInfo = `${voiceChannel ? `<#${voiceChannel.id}>` : `**${activity.lastVoiceChannel}**`} - \`${formatTimeSince(activity.lastVoiceTime)}\``;
        }
        let lastMessageInfo = '**No Data**';
        if (activity.lastMessageChannel) {
            const textChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastMessageChannel);
            lastMessageInfo = `${textChannel ? `<#${textChannel.id}>` : `**${activity.lastMessageChannel}**`} - \`${formatTimeSince(activity.lastMessageTime)}\``;
        }
        const embed = colorManager.createEmbed().setTitle(`**User Activity**`).setThumbnail(user.displayAvatarURL({ dynamic: true })).setDescription(`** User :** ${user}`).addFields([{ name: '**<:emoji_7:1429246526949036212> Last voice room **', value: lastVoiceInfo, inline: false }, { name: '**<:emoji_8:1429246555726020699> Last Text Room**', value: lastMessageInfo, inline: false }]).setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) }).setTimestamp();
        await message.channel.send({ embeds: [embed] });
    } catch (error) { await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' }); }
}

async function showAdminRolesActivity(message, client, ADMIN_ROLES) {
    try {
        const allAdminMembers = new Map();
        for (const roleId of ADMIN_ROLES) {
            try {
                const role = await message.guild.roles.fetch(roleId);
                if (role && role.members) { for (const [memberId, member] of role.members) { if (!member.user.bot) allAdminMembers.set(memberId, member); } }
            } catch (error) {}
        }
        if (allAdminMembers.size === 0) {
            const embed = colorManager.createEmbed().setDescription('**No Admins يادلخ**').setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
            await message.channel.send({ embeds: [embed] });
            return;
        }
        const memberActivities = [];
        for (const [userId, member] of allAdminMembers) {
            const activity = await getUserActivity(userId);
            const totalActivity = activity.totalMessages + (activity.totalVoiceTime / 60000);
            memberActivities.push({ member, activity, totalActivity, xp: Math.floor(activity.totalMessages / 10) });
        }
        memberActivities.sort((a, b) => b.totalActivity - a.totalActivity);
        let currentPage = 0;
        const itemsPerPage = 10;
        const totalPages = Math.ceil(memberActivities.length / itemsPerPage);
        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const end = Math.min(start + itemsPerPage, memberActivities.length);
            const pageMembers = memberActivities.slice(start, end);
            const embed = colorManager.createEmbed().setTitle(`**Rooms : Admin Roles**`).setDescription(`** All members :** ${memberActivities.length}`).setFooter({ text: `By Ahmed. | صفحة ${page + 1} من ${totalPages}`, iconURL: message.guild.iconURL({ dynamic: true }) }).setTimestamp();
            pageMembers.forEach((data, index) => {
                const globalRank = start + index + 1;
                const member = data.member;
                const activity = data.activity;
                let lastVoiceInfo = '**No Data**';
                if (activity.lastVoiceChannel) {
                    const voiceChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastVoiceChannel);
                    lastVoiceInfo = `${voiceChannel ? `<#${voiceChannel.id}>` : `**${activity.lastVoiceChannel}**`} - \`${formatTimeSince(activity.lastVoiceTime)}\``;
                }
                let lastMessageInfo = '**No Data**';
                if (activity.lastMessageChannel) {
                    const textChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastMessageChannel);
                    lastMessageInfo = `${textChannel ? `<#${textChannel.id}>` : `**${activity.lastMessageChannel}**`} - \`${formatTimeSince(activity.lastMessageTime)}\``;
                }
                embed.addFields([{ name: `**#${globalRank} - ${member.displayName}**`, value: `> **<:emoji_7:1429246526949036212> Last Voice :** ${lastVoiceInfo}\n` + `> **<:emoji_8:1429246555726020699> Last Text :** ${lastMessageInfo}`, inline: false }]);
            });
            return embed;
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(true), new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1), new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger));
        const sentMessage = await message.channel.send({ embeds: [generateEmbed(0)], components: [row] });
        const collector = sentMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });
        collector.on('collect', async interaction => {
            if (interaction.customId === 'prev') currentPage--;
            else if (interaction.customId === 'next') currentPage++;
            if (interaction.customId === 'prev' || interaction.customId === 'next') {
                const newRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0), new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1), new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger));
                await interaction.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
            }
        });
    } catch (error) { await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' }); }
}

async function showRoleActivity(message, role, client) {
    try {
        const members = role.members;
        if (members.size === 0) {
            const embed = colorManager.createEmbed().setDescription('**No one in the role**').setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
            await message.channel.send({ embeds: [embed] });
            return;
        }
        const memberActivities = [];
        for (const [userId, member] of members) {
            if (member.user.bot) continue;
            const activity = await getUserActivity(userId);
            const totalActivity = activity.totalMessages + (activity.totalVoiceTime / 60000);
            memberActivities.push({ member, activity, totalActivity, xp: Math.floor(activity.totalMessages / 10) });
        }
        memberActivities.sort((a, b) => b.totalActivity - a.totalActivity);
        let currentPage = 0;
        const itemsPerPage = 10;
        const totalPages = Math.ceil(memberActivities.length / itemsPerPage);
        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const end = Math.min(start + itemsPerPage, memberActivities.length);
            const pageMembers = memberActivities.slice(start, end);
            const embed = colorManager.createEmbed().setTitle(`**Rooms : ${role.name}**`).setDescription(`** All members :** ${memberActivities.length}`).setFooter({ text: `By Ahmed. | صفحة ${page + 1} من ${totalPages}`, iconURL: message.guild.iconURL({ dynamic: true }) }).setTimestamp();
            pageMembers.forEach((data, index) => {
                const globalRank = start + index + 1;
                const member = data.member;
                const activity = data.activity;
                let lastVoiceInfo = '**No Data**';
                if (activity.lastVoiceChannel) {
                    const voiceChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastVoiceChannel);
                    lastVoiceInfo = `${voiceChannel ? `<#${voiceChannel.id}>` : `**${activity.lastVoiceChannel}**`} - \`${formatTimeSince(activity.lastVoiceTime)}\``;
                }
                let lastMessageInfo = '**No Data**';
                if (activity.lastMessageChannel) {
                    const textChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastMessageChannel);
                    lastMessageInfo = `${textChannel ? `<#${textChannel.id}>` : `**${activity.lastMessageChannel}**`} - \`${formatTimeSince(activity.lastMessageTime)}\``;
                }
                embed.addFields([{ name: `**#${globalRank} - ${member.displayName}**`, value: `> **<:emoji_7:1429246526949036212> Last Voice :** ${lastVoiceInfo}\n` + `> **<:emoji_8:1429246555726020699> Last Text :** ${lastMessageInfo}`, inline: false }]);
            });
            return embed;
        };
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(true), new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1), new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger));
        const sentMessage = await message.channel.send({ embeds: [generateEmbed(0)], components: [row] });
        const collector = sentMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });
        collector.on('collect', async interaction => {
            if (interaction.customId === 'prev') currentPage--;
            else if (interaction.customId === 'next') currentPage++;
            if (interaction.customId === 'prev' || interaction.customId === 'next') {
                const newRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0), new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1), new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger));
                await interaction.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
            }
        });
    } catch (error) { await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' }); }
}

module.exports = { name, execute, handleInteractions };
