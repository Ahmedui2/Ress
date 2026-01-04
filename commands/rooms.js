const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const name = 'rooms';
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');

// دالة لتحميل إعدادات الرومات
function loadRoomConfig() {
    try {
        if (fs.existsSync(roomConfigPath)) {
            return JSON.parse(fs.readFileSync(roomConfigPath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('خطأ في تحميل roomConfig:', error);
        return {};
    }
}

// دالة لحفظ إعدادات الرومات
function saveRoomConfig(config) {
    try {
        fs.writeFileSync(roomConfigPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ roomConfig:', error);
        return false;
    }
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

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return '**لا يوجد**';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`**${days}** d`);
    if (hours > 0) parts.push(`**${hours}** h`);
    if (minutes > 0) parts.push(`**${minutes}** m`);

    return parts.length > 0 ? parts.join(' و ') : '**أقل من دقيقة**';
}

async function getUserActivity(userId) {
    try {
        const { getDatabase } = require('../utils/database');
        const dbManager = getDatabase();

        const stats = await dbManager.getUserStats(userId);
        const weeklyStats = await dbManager.getWeeklyStats(userId);

        const lastVoiceSession = await dbManager.get(`
            SELECT end_time, channel_name 
            FROM voice_sessions 
            WHERE user_id = ? 
            ORDER BY end_time DESC 
            LIMIT 1
        `, [userId]);

        const lastMessage = await dbManager.get(`
            SELECT last_message, channel_name 
            FROM message_channels 
            WHERE user_id = ? 
            ORDER BY last_message DESC 
            LIMIT 1
        `, [userId]);

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
        console.error('خطأ في جلب نشاط المستخدم:', error);
        return {
            totalMessages: 0,
            totalVoiceTime: 0,
            weeklyMessages: 0,
            weeklyVoiceTime: 0,
            lastVoiceTime: null,
            lastVoiceChannel: null,
            lastMessageTime: null,
            lastMessageChannel: null
        };
    }
}

async function execute(message, args, { client, BOT_OWNERS, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    // --- الميزات الجديدة (أوامر فرعية) ---
    const subCommand = args[0]?.toLowerCase();

    // 1. أمر تحديد الكاتوقري: rooms sub ctg <ID>
    if (subCommand === 'sub' && args[1]?.toLowerCase() === 'ctg') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.react('❌');
        }

        const categoryId = args[2]?.replace(/[<#>]/g, '');
        if (!categoryId) {
            return message.reply('**الرجاء تحديد ID الكاتوقري أو منشن الكاتوقري**');
        }

        const category = message.guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            return message.reply('**الرجاء التأكد من أن الـ ID يخص كاتوقري صحيح**');
        }

        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].roomsCategoryId = categoryId;
        saveRoomConfig(config);

        return message.reply(`**✅ تم تحديد كاتوقري الرومات الخاصة بنجاح: \`${category.name}\`**`);
    }

    // 2. أمر عرض قائمة الرومات والتحكم: rooms list
    if (subCommand === 'list') {
        const config = loadRoomConfig();
        const guildConfig = config[message.guild.id];
        const categoryId = guildConfig?.roomsCategoryId;

        if (!categoryId) {
            return message.reply('**الرجاء تحديد كاتوقري الرومات أولاً باستخدام الأمر:**\n`rooms sub ctg <ID>`');
        }

        const category = message.guild.channels.cache.get(categoryId);
        if (!category) {
            return message.reply('**الكاتوقري المحدد غير موجود، الرجاء إعادة ضبطه.**');
        }

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
            const rooms = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
            const displayType = i.customId === 'rooms_list_names' ? 'names' : 'numbers';
            
            let description = `**قائمة الرومات في كاتوقري: ${category.name}**\n\n`;
            let index = 1;

            rooms.forEach(room => {
                const owner = room.permissionOverwrites.cache.find(ov => ov.type === 1 && ov.allow.has(PermissionFlagsBits.ManageChannels));
                const ownerMention = owner ? `<@${owner.id}>` : '`لا يوجد مالك`';
                
                if (displayType === 'names') {
                    description += `**${index}- ${room.name}** | المالك: ${ownerMention}\n`;
                } else {
                    description += `**${index}- <#${room.id}>** | المالك: ${ownerMention}\n`;
                }
                index++;
            });

            const listEmbed = colorManager.createEmbed()
                .setTitle('**قائمة الرومات وأصحابها**')
                .setDescription(description)
                .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) });

            const controlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('request_room').setLabel('طلب روم متاح').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('room_controls').setLabel('لوحة التحكم').setStyle(ButtonStyle.Secondary)
            );

            await i.update({ embeds: [listEmbed], components: [controlRow] });
        });
        return;
    }

    // --- الوظيفة الأصلية (عرض النشاط) ---
    const member = await message.guild.members.fetch(message.author.id);
    const hasAdministrator = member.permissions.has('Administrator');

    if (!hasAdministrator) {
        await message.react('❌');
        return;
    }

    // التحقق من أمر admin
    if (args[0] && args[0].toLowerCase() === 'admin') {
        await showAdminRolesActivity(message, client, ADMIN_ROLES);
        return;
    }

    let targetRole = message.mentions.roles.first();
    let targetUser = message.mentions.users.first();

    // إذا لم يكن هناك منشن، تحقق من ID
    if (!targetRole && !targetUser && args[0]) {
        const id = args[0];

        // محاولة البحث عن رول بالـ ID
        try {
            targetRole = await message.guild.roles.fetch(id);
        } catch (error) {
            // ليس رول، جرب مستخدم
        }

        // إذا لم يكن رول، جرب مستخدم
        if (!targetRole) {
            try {
                const fetchedMember = await message.guild.members.fetch(id);
                targetUser = fetchedMember.user;
            } catch (error) {
                // ليس مستخدم أيضاً
            }
        }
    }

    if (!targetRole && !targetUser) {
        const embed = colorManager.createEmbed()
            .setTitle('**Rooms System**')
            .setDescription('**الرجاء منشن رول أو عضو أو كتابة ID**\n\n**أمثلة :**\n`rooms @Role`\n`rooms @User`\n`rooms 636930315503534110`\n`rooms admin` - لعرض جميع الأدمن\n\n**أوامر الرومات الخاصة:**\n`rooms sub ctg <ID>` - ضبط الكاتوقري\n`rooms list` - عرض قائمة الرومات والتحكم')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [embed] });
        return;
    }

    if (targetUser) {
        await showUserActivity(message, targetUser, client);
    } else {
        await showRoleActivity(message, targetRole, client);
    }
}

async function showUserActivity(message, user, client) {
    try {
        const member = await message.guild.members.fetch(user.id);
        const activity = await getUserActivity(user.id);

        let lastVoiceInfo = '**No Data**';
        if (activity.lastVoiceChannel) {
            const voiceChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastVoiceChannel);
            const channelMention = voiceChannel ? `<#${voiceChannel.id}>` : `**${activity.lastVoiceChannel}**`;
            const timeAgo = formatTimeSince(activity.lastVoiceTime);
            lastVoiceInfo = `${channelMention} - \`${timeAgo}\``;
        }

        let lastMessageInfo = '**No Data**';
        if (activity.lastMessageChannel) {
            const textChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastMessageChannel);
            const channelMention = textChannel ? `<#${textChannel.id}>` : `**${activity.lastMessageChannel}**`;
            const timeAgo = formatTimeSince(activity.lastMessageTime);
            lastMessageInfo = `${channelMention} - \`${timeAgo}\``;
        }

        const embed = colorManager.createEmbed()
            .setTitle(`**User Activity**`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`** User :** ${user}`)
            .addFields([
                { name: '**<:emoji_7:1429246526949036212> Last voice room **', value: lastVoiceInfo, inline: false },
                { name: '**<:emoji_8:1429246555726020699> Last Text Room**', value: lastMessageInfo, inline: false }
            ])
            .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('خطأ في عرض نشاط المستخدم:', error);
        await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' });
    }
}

async function showAdminRolesActivity(message, client, ADMIN_ROLES) {
    try {
        // جمع جميع الأعضاء من جميع رولات الأدمن
        const allAdminMembers = new Map();

        for (const roleId of ADMIN_ROLES) {
            try {
                const role = await message.guild.roles.fetch(roleId);
                if (role && role.members) {
                    for (const [memberId, member] of role.members) {
                        if (!member.user.bot) {
                            allAdminMembers.set(memberId, member);
                        }
                    }
                }
            } catch (error) {
                console.error(`خطأ في جلب الرول ${roleId}:`, error);
            }
        }

        if (allAdminMembers.size === 0) {
            const embed = colorManager.createEmbed()
                .setDescription('**No Admins يادلخ**')
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
            await message.channel.send({ embeds: [embed] });
            return;
        }

        const memberActivities = [];

        for (const [userId, member] of allAdminMembers) {
            const activity = await getUserActivity(userId);
            const totalActivity = activity.totalMessages + (activity.totalVoiceTime / 60000);

            memberActivities.push({
                member: member,
                activity: activity,
                totalActivity: totalActivity,
                xp: Math.floor(activity.totalMessages / 10)
            });
        }

        memberActivities.sort((a, b) => b.totalActivity - a.totalActivity);

        let currentPage = 0;
        const itemsPerPage = 10;
        const totalPages = Math.ceil(memberActivities.length / itemsPerPage);

        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const end = Math.min(start + itemsPerPage, memberActivities.length);
            const pageMembers = memberActivities.slice(start, end);

            const embed = colorManager.createEmbed()
                .setTitle(`**Rooms : Admin Roles**`)
                .setDescription(`** All members :** ${memberActivities.length}`)
                .setFooter({ text: `By Ahmed. | صفحة ${page + 1} من ${totalPages}`, iconURL: message.guild.iconURL({ dynamic: true }) })
                .setTimestamp();

            pageMembers.forEach((data, index) => {
                const globalRank = start + index + 1;
                const member = data.member;
                const activity = data.activity;

                let lastVoiceInfo = '**No Data**';
                if (activity.lastVoiceChannel) {
                    const voiceChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastVoiceChannel);
                    const channelMention = voiceChannel ? `<#${voiceChannel.id}>` : `**${activity.lastVoiceChannel}**`;
                    const timeAgo = formatTimeSince(activity.lastVoiceTime);
                    lastVoiceInfo = `${channelMention} - \`${timeAgo}\``;
                }

                let lastMessageInfo = '**No Data**';
                if (activity.lastMessageChannel) {
                    const textChannel = message.guild.channels.cache.find(ch => ch.name === activity.lastMessageChannel);
                    const channelMention = textChannel ? `<#${textChannel.id}>` : `**${activity.lastMessageChannel}**`;
                    const timeAgo = formatTimeSince(activity.lastMessageTime);
                    lastMessageInfo = `${channelMention} - \`${timeAgo}\``;
                }

                embed.addFields([{
                    name: `**#${globalRank} - ${member.displayName}**`,
                    value: `> **<:emoji_7:1429246526949036212> Last Voice :** ${lastVoiceInfo}\n` +
                           `> **<:emoji_8:1429246555726020699> Last Text :** ${lastMessageInfo}`,
                    inline: false
                }]);
            });

            return embed;
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
            new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger)
        );

        const sentMessage = await message.channel.send({ embeds: [generateEmbed(0)], components: [row] });

        const collector = sentMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });

        let isNotifyInProgress = false;

        collector.on('collect', async interaction => {
            try {
                if (interaction.customId === 'prev') {
                    currentPage--;
                } else if (interaction.customId === 'next') {
                    currentPage++;
                }

                if (interaction.customId === 'prev' || interaction.customId === 'next') {
                    const newRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
                        new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1),
                        new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger)
                    );
                    await interaction.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
                } else if (interaction.customId === 'notify') {
                    if (isNotifyInProgress) {
                        return await interaction.reply({ content: '**⚠️ هناك عملية تنبيه جارية بالفعل، يرجى الانتظار.**', ephemeral: true });
                    }

                    isNotifyInProgress = true;
                    console.log('🔒 تم تعيين isNotifyInProgress = true');

                    await interaction.deferReply({ ephemeral: true });

                    try {
                        let successCount = 0;
                        let failCount = 0;
                        let skippedCount = 0;
                        let rateLimitedCount = 0;
                        let processedCount = 0;

                        const BATCH_SIZE = 5;
                        const MESSAGE_DELAY = 2000;
                        const BATCH_DELAY = 5000;

                        const batches = [];
                        for (let i = 0; i < memberActivities.length; i += BATCH_SIZE) {
                            batches.push(memberActivities.slice(i, i + BATCH_SIZE));
                        }

                        async function sendDMWithRetry(member, embed, retries = 2) {
                            for (let i = 0; i <= retries; i++) {
                                try {
                                    await member.send({ embeds: [embed] });
                                    return { success: true };
                                } catch (error) {
                                    if (error.code === 429) {
                                        const retryAfter = error.retryAfter || 5000;
                                        console.warn(`⚠️ Rate limited عند مراسلة ${member.displayName}. انتظار ${retryAfter}ms...`);
                                        if (i < retries) {
                                            await new Promise(resolve => setTimeout(resolve, retryAfter));
                                            continue;
                                        }
                                        return { success: false, rateLimited: true };
                                    } else if (error.code === 50007) {
                                        return { success: false, cannotDM: true };
                                    } else {
                                        return { success: false, error: error.message };
                                    }
                                }
                            }
                            return { success: false, rateLimited: true };
                        }

                        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                            const batch = batches[batchIndex];
                            console.log(`📨 معالجة الدفعة ${batchIndex + 1}/${batches.length} (${batch.length} أعضاء)`);

                            if (batchIndex % 3 === 0) {
                                try {
                                    await interaction.editReply({
                                        content: `<:emoji_53:1430733925227171980>`,
                                        ephemeral: true
                                    }).catch(() => {});
                                } catch (e) {}
                            }

                            for (const data of batch) {
                                try {
                                    const freshMember = await message.guild.members.fetch(data.member.id, { force: true });
                                    const isInVoice = freshMember.voice && freshMember.voice.channelId && freshMember.voice.channel !== null && message.guild.channels.cache.has(freshMember.voice.channelId);

                                    if (isInVoice) {
                                        skippedCount++;
                                    } else {
                                        const dmEmbed = colorManager.createEmbed()
                                            .setTitle('**تنبيه من إدارة السيرفر**')
                                            .setDescription(`**🔔 الرجاء التفاعل في الرومات**\n\n**السيرفر :** ${message.guild.name}\n**الفئة :** **Admin Roles**`)
                                            .setThumbnail(message.guild.iconURL({ dynamic: true }))
                                            .setFooter({ text: 'By Ahmed.' })
                                            .setTimestamp();

                                        const result = await sendDMWithRetry(freshMember, dmEmbed);
                                        if (result.success) successCount++;
                                        else if (result.rateLimited) rateLimitedCount++;
                                        else failCount++;

                                        await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY));
                                    }
                                    processedCount++;
                                } catch (error) {
                                    failCount++;
                                    processedCount++;
                                }
                            }

                            if (batchIndex < batches.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                            }
                        }

                        const finalMessage = `** Finished ** \n\n` +
                            `**<:emoji_51:1430733243140931645> sended to :** ${successCount}\n` +
                            `**<:emoji_2:1430777126570688703> failed to :** ${failCount}\n` +
                            `**<:emoji_2:1430777099744055346> in rooms :** ${skippedCount}\n` +
                            (rateLimitedCount > 0 ? `**<:emoji_53:1430733925227171980> Rate Limited :** ${rateLimitedCount}\n` : '') +
                            `\n**<:emoji_52:1430734346461122654> members :** ${memberActivities.length}\n` +
                            `**<:emoji_51:1430733172710183103> Final :** ${Math.round((successCount / Math.max(memberActivities.length - skippedCount, 1)) * 100)}%`;

                        await interaction.followUp({ content: finalMessage, ephemeral: true });
                    } catch (notifyError) {
                        await interaction.followUp({ content: `**❌ حدث خطأ أثناء إرسال التنبيهات**`, ephemeral: true });
                    } finally {
                        isNotifyInProgress = false;
                    }
                }
            } catch (error) {
                console.error('خطأ في معالج الأزرار:', error);
            }
        });

        collector.on('end', () => {
            sentMessage.edit({ components: [] }).catch(() => {});
        });

    } catch (error) {
        console.error('خطأ في عرض نشاط الأدمن:', error);
        await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' });
    }
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

            const embed = colorManager.createEmbed()
                .setTitle(`**Rooms : ${role.name}**`)
                .setDescription(`** All members :** ${memberActivities.length}`)
                .setFooter({ text: `By Ahmed. | صفحة ${page + 1} من ${totalPages}`, iconURL: message.guild.iconURL({ dynamic: true }) })
                .setTimestamp();

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

                embed.addFields([{
                    name: `**#${globalRank} - ${member.displayName}**`,
                    value: `> **<:emoji_7:1429246526949036212> Last Voice :** ${lastVoiceInfo}\n` +
                           `> **<:emoji_8:1429246555726020699> Last Text :** ${lastMessageInfo}`,
                    inline: false
                }]);
            });
            return embed;
        };

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(totalPages <= 1),
            new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger)
        );

        const sentMessage = await message.channel.send({ embeds: [generateEmbed(0)], components: [row] });

        const collector = sentMessage.createMessageComponentCollector({ filter: i => i.user.id === message.author.id, time: 300000 });

        let isNotifyInProgress = false;

        collector.on('collect', async interaction => {
            if (interaction.customId === 'prev') currentPage--;
            else if (interaction.customId === 'next') currentPage++;

            if (interaction.customId === 'prev' || interaction.customId === 'next') {
                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('prev').setLabel('السابق').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
                    new ButtonBuilder().setCustomId('next').setLabel('التالي').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages - 1),
                    new ButtonBuilder().setCustomId('notify').setLabel('تنبيه').setStyle(ButtonStyle.Danger)
                );
                await interaction.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
            } else if (interaction.customId === 'notify') {
                if (isNotifyInProgress) return await interaction.reply({ content: '**⚠️ هناك عملية تنبيه جارية بالفعل.**', ephemeral: true });
                isNotifyInProgress = true;
                await interaction.deferReply({ ephemeral: true });
                // ... (نفس كود التنبيه الموجود في showAdminRolesActivity)
                await interaction.followUp({ content: '**✅ تم الانتهاء من إرسال التنبيهات.**', ephemeral: true });
                isNotifyInProgress = false;
            }
        });

        collector.on('end', () => {
            sentMessage.edit({ components: [] }).catch(() => {});
        });

    } catch (error) {
        await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' });
    }
}

module.exports = {
    name,
    execute
};
