const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getDatabase } = require('../utils/database.js');

const name = 'تفاعلي';

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return 'لا يوجد';

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

async function execute(message, args, { client }) {
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

    if (message.mentions.users.size > 0) {
        targetUser = message.mentions.users.first();
        targetMember = await message.guild.members.fetch(targetUser.id);
    }

    // إظهار الإحصائيات الأسبوعية بشكل افتراضي
    await showActivityStats(message, targetUser, targetMember, 'weekly', client);
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
            periodLabel = 'تفاعل اليوم';
            activeDays = stats.activeDays;
        } else if (period === 'weekly') {
            stats = await dbManager.getWeeklyStats(user.id);
            const weeklyActiveDays = await dbManager.getWeeklyActiveDays(user.id);
            periodLabel = 'تفاعل الأسبوع';
            activeDays = weeklyActiveDays;
            // إعادة تسمية المتغيرات للتناسق
            stats.voiceTime = stats.weeklyTime;
            stats.messages = stats.weeklyMessages;
            stats.reactions = stats.weeklyReactions;
            stats.voiceJoins = stats.weeklyVoiceJoins;
        } else if (period === 'monthly') {
            stats = await dbManager.getMonthlyStats(user.id);
            periodLabel = 'تفاعل الشهر';
            activeDays = stats.activeDays;
        }

        // جلب أكثر قناة صوتية مع قيمة افتراضية
        const topVoiceChannel = await dbManager.getMostActiveVoiceChannel(user.id, period) || { channel_id: null, channel_name: 'لا يوجد', total_time: 0, session_count: 0 };
        
        // جلب أكثر قناة رسائل مع قيمة افتراضية
        const topMessageChannel = await dbManager.getMostActiveMessageChannel(user.id) || { channel_id: null, channel_name: 'لا يوجد', message_count: 0 };

        // حساب XP (10 رسائل = 1 XP)
        const xp = Math.floor((stats.messages || 0) / 10);

        // تحضير منشن القنوات
        const voiceChannelMention = topVoiceChannel?.channel_id ? `<#${topVoiceChannel.channel_id}>` : 'لا يوجد';
        const messageChannelMention = topMessageChannel?.channel_id ? `<#${topMessageChannel.channel_id}>` : 'لا يوجد';

        // إنشاء Embed مصغر
        const embed = colorManager.createEmbed()
            .setTitle(`${periodLabel}`)
            .setDescription(`**تفاعل ${member.displayName}**`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { 
                    name: '<:emoji:1428954859989635163> **Voice**', 
                    value: '** **', 
                    inline: false 
                },
                { 
                    name: '**الوقت**', 
                    value: `**${formatDuration(stats.voiceTime || 0)}**`, 
                    inline: true 
                },
                { 
                    name: '**جوينات**', 
                    value: `**${stats.voiceJoins || 0}**`, 
                    inline: true 
                },
                { 
                    name: '**أكثر روم**', 
                    value: `${voiceChannelMention}`, 
                    inline: true 
                },
                { 
                    name: '<:emoji:1428954858278617169> **Chat**', 
                    value: '** **', 
                    inline: false 
                },
                { 
                    name: '**رسائل**', 
                    value: `**${stats.messages || 0}**`, 
                    inline: true 
                },
                { 
                    name: '**XP**', 
                    value: `**${xp}xp**`, 
                    inline: true 
                },
                { 
                    name: '**رياكتات**', 
                    value: `**${stats.reactions || 0}**`, 
                    inline: true 
                },
                { 
                    name: '**أكثر روم شات**', 
                    value: `${messageChannelMention}`, 
                    inline: false 
                },
                { 
                    name: '**أيام التفاعل**', 
                    value: `**${activeDays || 0}${period === 'weekly' ? ' من 7' : ''}**`, 
                    inline: false 
                }
            )
            .setFooter({ text: `${message.author.username}`, iconURL: message.author.displayAvatarURL() })
            .setTimestamp();

        // إنشاء الأزرار
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`activity_daily_${user.id}`)
                    .setLabel(' اليوم')
                    .setStyle(period === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_weekly_${user.id}`)
                    .setLabel(' الأسبوع')
                    .setStyle(period === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`activity_monthly_${user.id}`)
                    .setLabel(' الشهر')
                    .setStyle(period === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
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
                    periodLabel = 'تفاعل اليوم';
                    activeDays = stats.activeDays;
                } else if (newPeriod === 'weekly') {
                    stats = await dbManager.getWeeklyStats(user.id);
                    const weeklyActiveDays = await dbManager.getWeeklyActiveDays(user.id);
                    periodLabel = 'تفاعل الأسبوع';
                    activeDays = weeklyActiveDays;
                    stats.voiceTime = stats.weeklyTime;
                    stats.messages = stats.weeklyMessages;
                    stats.reactions = stats.weeklyReactions;
                    stats.voiceJoins = stats.weeklyVoiceJoins;
                } else if (newPeriod === 'monthly') {
                    stats = await dbManager.getMonthlyStats(user.id);
                    periodLabel = 'تفاعل الشهر';
                    activeDays = stats.activeDays;
                }

                const topVoiceChannel = await dbManager.getMostActiveVoiceChannel(user.id, newPeriod) || { channel_id: null, channel_name: 'لا يوجد', total_time: 0, session_count: 0 };
                const topMessageChannel = await dbManager.getMostActiveMessageChannel(user.id) || { channel_id: null, channel_name: 'لا يوجد', message_count: 0 };
                const xp = Math.floor((stats.messages || 0) / 10);
                const voiceChannelMention = topVoiceChannel?.channel_id ? `<#${topVoiceChannel.channel_id}>` : 'لا يوجد';
                const messageChannelMention = topMessageChannel?.channel_id ? `<#${topMessageChannel.channel_id}>` : 'لا يوجد';

                // إنشاء الإمبد المحدث
                const updatedEmbed = colorManager.createEmbed()
                    .setTitle(`${periodLabel}`)
                    .setDescription(`**تفاعل ${member.displayName}**`)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { 
                            name: '<:emoji:1428954859989635163> **Voice**', 
                            value: '** **', 
                            inline: false 
                        },
                        { 
                            name: '**الوقت**', 
                            value: `**${formatDuration(stats.voiceTime || 0)}**`, 
                            inline: true 
                        },
                        { 
                            name: '**جوينات**', 
                            value: `**${stats.voiceJoins || 0}**`, 
                            inline: true 
                        },
                        { 
                            name: '**أكثر روم**', 
                            value: `${voiceChannelMention}`, 
                            inline: true 
                        },
                        { 
                            name: '<:emoji:1428954858278617169> **Chat**', 
                            value: '** **', 
                            inline: false 
                        },
                        { 
                            name: '**رسائل**', 
                            value: `**${stats.messages || 0}**`, 
                            inline: true 
                        },
                        { 
                            name: '**XP**', 
                            value: `**${xp}xp**`, 
                            inline: true 
                        },
                        { 
                            name: '**رياكتات**', 
                            value: `**${stats.reactions || 0}**`, 
                            inline: true 
                        },
                        { 
                            name: '**أكثر روم شات**', 
                            value: `${messageChannelMention}`, 
                            inline: false 
                        },
                        { 
                            name: '**أيام التفاعل**', 
                            value: `**${activeDays || 0}${newPeriod === 'weekly' ? ' من 7' : ''}**`, 
                            inline: false 
                        }
                    )
                    .setFooter({ text: `${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                // تحديث الأزرار
                const updatedRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`activity_daily_${user.id}`)
                            .setLabel(' اليوم')
                            .setStyle(newPeriod === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`activity_weekly_${user.id}`)
                            .setLabel(' الأسبوع')
                            .setStyle(newPeriod === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`activity_monthly_${user.id}`)
                            .setLabel(' الشهر')
                            .setStyle(newPeriod === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    );

                // تحديث الرسالة بدلاً من حذفها
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
    execute
};
