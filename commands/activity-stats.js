const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');
const { getDatabase } = require('../utils/database.js');
const { getVacationStatus, getDownStatus } = require('../utils/userStatsCollector');

const name = 'تفاعلي';
const aliases = ['تواجدي', 'me'];

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return '0';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.length > 0 ? parts.join(' and ') : 'أقل من دقيقة';
}

function isUserActivitySuspended(userId) {
    const vacationStatus = getVacationStatus(userId);
    if (vacationStatus.hasVacation) {
        return true;
    }
    const downStatus = getDownStatus(userId);
    return downStatus.hasDown;
}

async function execute(message, args, { client }) {
    if (isChannelBlocked(message.channel.id)) {
        return;
    }

    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    // التحقق من المنشن
    let targetUser = message.author;
    let targetMember = message.member;

    // لو كتب منشن
    if (message.mentions.users.size > 0) {
        targetUser = message.mentions.users.first();
        targetMember = await message.guild.members.fetch(targetUser.id);
    // لو كتب ID
    } else if (args[0]) {
        try {
            targetMember = await message.guild.members.fetch(args[0]);
            targetUser = targetMember.user;
        } catch (err) {
            return message.reply("❌ الآيدي غير صحيح أو العضو غير موجود");
        }
    }
    // إظهار الإحصائيات الشهرية بشكل افتراضي
    await showActivityStats(message, targetUser, targetMember, 'daily', client);
}

async function showActivityStats(message, user, member, period = 'weekly', client) {
    try {
        const dbManager = getDatabase();
        if (!dbManager || !dbManager.isInitialized) {
            await message.channel.send('❌ قاعدة البيانات غير متاحة');
            return;
        }

        let stats, periodLabel, activeDays;
        if (period === 'daily') {
            stats = await dbManager.getDailyStats(user.id);
            periodLabel = 'Daily Active';
            activeDays = stats.activeDays;
            // إضافة الوقت الحي لليومي
            if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                const session = global.client.voiceSessions.get(user.id);
                const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
            }
        } else if (period === 'weekly') {
            stats = await dbManager.getWeeklyStats(user.id);
            const weeklyActiveDays = await dbManager.getWeeklyActiveDays(user.id);
            periodLabel = 'Weekly Active';
            activeDays = weeklyActiveDays;
            // إعادة تسمية المتغيرات للتناسق
            stats.voiceTime = stats.weeklyTime;
            stats.messages = stats.weeklyMessages;
            stats.reactions = stats.weeklyReactions;
            stats.voiceJoins = stats.weeklyVoiceJoins;
            // إضافة الوقت الحي للأسبوعي
            if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                const session = global.client.voiceSessions.get(user.id);
                const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
            }
        } else if (period === 'monthly') {
            stats = await dbManager.getMonthlyStats(user.id);
            periodLabel = 'Monthly Active';
            activeDays = stats.activeDays;
            // إضافة تعويض للبيانات الشهرية
            stats.voiceTime = stats.voiceTime || 0;
            stats.messages = stats.messages || 0;
            stats.reactions = stats.reactions || 0;
            stats.voiceJoins = stats.voiceJoins || 0;
            // إضافة الوقت الحي للشهري
            if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                const session = global.client.voiceSessions.get(user.id);
                const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
            }
        } else if (period === 'total') {
            // إحصائيات كليّة (غير قابلة للتصفير تلقائياً)
            const totals = await dbManager.getUserStats(user.id);
            stats = {
                voiceTime: totals.totalVoiceTime || 0,
                messages: totals.totalMessages || 0,
                reactions: totals.totalReactions || 0,
                voiceJoins: totals.totalVoiceJoins || 0
            };
            periodLabel = 'Total Active';
            // عدد أيام النشاط خلال السنة الماضية على الأقل
            activeDays = (await dbManager.getActiveDaysCount(user.id, 365)) || 0;
            // إضافة الوقت الحي للكلي
            if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                const session = global.client.voiceSessions.get(user.id);
                const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
            }
        }

        // جلب أكثر قناة صوتية مع قيمة افتراضية
        const topVoiceChannel = await dbManager.getMostActiveVoiceChannel(user.id, period) || { channel_id: null, channel_name: 'No Data', total_time: 0, session_count: 0 };
        // جلب أكثر قناة رسائل مع قيمة افتراضية
        const topMessageChannel = await dbManager.getMostActiveMessageChannel(user.id) || { channel_id: null, channel_name: 'No Data', message_count: 0 };
        // حساب XP (10 رسائل = 1 XP)
        const xp = Math.floor((stats.messages || 0) / 10);
        // تحضير منشن القنوات
        const voiceChannelMention = topVoiceChannel?.channel_id ? `<#${topVoiceChannel.channel_id}>` : 'No Data';
        const messageChannelMention = topMessageChannel?.channel_id ? `<#${topMessageChannel.channel_id}>` : 'No Data';
        // إنشاء Embed مصغر
        const embed = colorManager.createEmbed()
            .setTitle(`${periodLabel}`)
            .setDescription(`**تفاعل ${member.displayName}**`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '# <:emoji_85:1442986413510627530> **Voice**', value: '** **', inline: false },
                { name: '**الوقت**', value: `**${formatDuration(stats.voiceTime || 0)}**`, inline: true },
                { name: '**جوينات**', value: `**${stats.voiceJoins || 0}**`, inline: true },
                { name: '**أكثر روم**', value: `${voiceChannelMention}`, inline: true },
                { name: '# <:emoji_85:1442986444712054954> **Chat**', value: '** **', inline: false },
                { name: '**رسائل**', value: `**${stats.messages || 0}**`, inline: true },
                { name: '**XP**', value: `**${xp}xp**`, inline: true },
                { name: '**رياكتات**', value: `**${stats.reactions || 0}**`, inline: true },
                { name: '**أكثر روم شات**', value: `${messageChannelMention}`, inline: false },
                { name: '**أيام التفاعل**', value: `**${activeDays || 0}${period === 'weekly' ? ' من 7' : ''}**`, inline: false }
            )
            .setFooter({ text: `${message.author.username}`, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();
        // إنشاء الأزرار مع زر "All"
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`activity_daily_${user.id}`)
                    .setLabel('Day')
                    .setEmoji('<:emoji_50:1430788365069848596>')
                    .setStyle(period === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_weekly_${user.id}`)
                    .setLabel('Week')
                    .setEmoji('<:emoji_49:1430788330416640000>')
                    .setStyle(period === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_monthly_${user.id}`)
                    .setLabel('Month')
                    .setEmoji('<:emoji_48:1430788303317368924>')
                    .setStyle(period === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_total_${user.id}`)
                    .setLabel('All')
                  .setEmoji('<:emoji_22:1463536623730954376>')
                    .setStyle(period === 'total' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );
        const response = await message.channel.send({ embeds: [embed], components: [row] });
        // جمع التفاعلات على الأزرار
        const collector = response.createMessageComponentCollector({
            filter: i => i.customId.startsWith('activity_') && i.user.id === message.author.id,
            time: 300000 // 5 دقائق
        });
        collector.on('collect', async interaction => {
            const [, newPeriod, userId] = interaction.customId.split('_');
            if (userId !== user.id) return;
            try {
                // جلب الإحصائيات الجديدة
                let stats, periodLabel, activeDays;
                if (newPeriod === 'daily') {
                    stats = await dbManager.getDailyStats(user.id);
                    periodLabel = 'Daily Active';
                    activeDays = stats.activeDays;
                    // إضافة الوقت الحي
                    if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                        const session = global.client.voiceSessions.get(user.id);
                        const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                        stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
                    }
                } else if (newPeriod === 'weekly') {
                    stats = await dbManager.getWeeklyStats(user.id);
                    const weeklyActiveDays = await dbManager.getWeeklyActiveDays(user.id);
                    periodLabel = 'Weekly Active';
                    activeDays = weeklyActiveDays;
                    stats.voiceTime = stats.weeklyTime;
                    stats.messages = stats.weeklyMessages;
                    stats.reactions = stats.weeklyReactions;
                    stats.voiceJoins = stats.weeklyVoiceJoins;
                    // إضافة الوقت الحي
                    if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                        const session = global.client.voiceSessions.get(user.id);
                        const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                        stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
                    }
                } else if (newPeriod === 'monthly') {
                    stats = await dbManager.getMonthlyStats(user.id);
                    periodLabel = 'Monthly Active';
                    activeDays = stats.activeDays;
                    stats.voiceTime = stats.voiceTime || 0;
                    stats.messages = stats.messages || 0;
                    stats.reactions = stats.reactions || 0;
                    stats.voiceJoins = stats.voiceJoins || 0;
                    // إضافة الوقت الحي
                    if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                        const session = global.client.voiceSessions.get(user.id);
                        const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                        stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
                    }
                } else if (newPeriod === 'total') {
                    const totals = await dbManager.getUserStats(user.id);
                    stats = {
                        voiceTime: totals.totalVoiceTime || 0,
                        messages: totals.totalMessages || 0,
                        reactions: totals.totalReactions || 0,
                        voiceJoins: totals.totalVoiceJoins || 0
                    };
                    periodLabel = 'Total Active';
                    activeDays = (await dbManager.getActiveDaysCount(user.id, 365)) || 0;
                    if (!isUserActivitySuspended(user.id) && global.client && global.client.voiceSessions && global.client.voiceSessions.has(user.id)) {
                        const session = global.client.voiceSessions.get(user.id);
                        const liveDuration = Date.now() - (session.startTime || session.sessionStartTime);
                        stats.voiceTime = (stats.voiceTime || 0) + liveDuration;
                    }
                }
                const topVoiceChannel = await dbManager.getMostActiveVoiceChannel(user.id, newPeriod) || { channel_id: null, channel_name: 'No Active Or Leave Channel', total_time: 0, session_count: 0 };
                const topMessageChannel = await dbManager.getMostActiveMessageChannel(user.id) || { channel_id: null, channel_name: 'No Active In Chat', message_count: 0 };
                const xp = Math.floor((stats.messages || 0) / 10);
                const voiceChannelMention = topVoiceChannel?.channel_id ? `<#${topVoiceChannel.channel_id}>` : 'No Active Or Leave Channel';
                const messageChannelMention = topMessageChannel?.channel_id ? `<#${topMessageChannel.channel_id}>` : 'No Active In Chat';
                // إنشاء الإمبد المحدث
                const updatedEmbed = colorManager.createEmbed()
                    .setTitle(`${periodLabel}`)
                    .setDescription(`**تفاعل ${member.displayName}**`)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: '# <:emoji_85:1442986413510627530> **Voice**', value: '** **', inline: false },
                        { name: '**الوقت**', value: `**${formatDuration(stats.voiceTime || 0)}**`, inline: true },
                        { name: '**جوينات**', value: `**${stats.voiceJoins || 0}**`, inline: true },
                        { name: '**أكثر روم**', value: `${voiceChannelMention}`, inline: true },
                        { name: '# <:emoji_85:1442986444712054954> **Chat**', value: '** **', inline: false },
                        { name: '**رسائل**', value: `**${stats.messages || 0}**`, inline: true },
                        { name: '**XP**', value: `**${xp}xp**`, inline: true },
                        { name: '**رياكتات**', value: `**${stats.reactions || 0}**`, inline: true },
                        { name: '**أكثر روم شات**', value: `${messageChannelMention}`, inline: false },
                        { name: '**أيام التفاعل**', value: `**${activeDays || 0}${newPeriod === 'weekly' ? ' من 7' : ''}**`, inline: false }
                    )
                    .setFooter({ text: `${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();
                // تحديث الأزرار مع زر "All"
                const updatedRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`activity_daily_${user.id}`)
                        .setLabel('Day')
                        .setEmoji('<:emoji_50:1430788365069848596>')
                        .setStyle(newPeriod === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`activity_weekly_${user.id}`)
                        .setLabel('Week')
                        .setEmoji('<:emoji_49:1430788330416640000>')
                        .setStyle(newPeriod === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`activity_monthly_${user.id}`)
                        .setLabel('Month')
                        .setEmoji('<:emoji_48:1430788303317368924>')
                        .setStyle(newPeriod === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`activity_total_${user.id}`)
                        .setLabel('All')
                    .setEmoji('<:emoji_22:1463536623730954376>')
                        .setStyle(newPeriod === 'total' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                );
                // تحديث الرسالة
                await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
            } catch (error) {
                console.error('خطأ في تحديث الإحصائيات:', error);
            }
        });
        collector.on('end', () => {
            response.edit({ components: [] }).catch(() => {});
        });
    } catch (error) {
        console.error('❌ خطأ في عرض إحصائيات التفاعل:', error);
        await message.channel.send('❌ حدث خطأ أثناء جلب الإحصائيات');
    }
}

module.exports = {
    name,
    aliases,
    execute
};
