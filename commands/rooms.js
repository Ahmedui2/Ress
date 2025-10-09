const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const moment = require('moment-timezone');

const name = 'rooms';

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

    const member = await message.guild.members.fetch(message.author.id);
    const hasAdministrator = member.permissions.has('Administrator');
    const isOwner = message.guild.ownerId === message.author.id;
    const isBotOwner = BOT_OWNERS && BOT_OWNERS.includes(message.author.id);

    if (!hasAdministrator && !isOwner && !isBotOwner) {
        await message.react('❌');
        return;
    }

    const mentionedRole = message.mentions.roles.first();
    const mentionedUser = message.mentions.users.first();

    if (!mentionedRole && !mentionedUser) {
        const embed = colorManager.createEmbed()
            .setTitle('**Rooms System**')
            .setDescription('**الرجاء منشن رول أو عضو**\n\n**مثال:**\n`rooms @Role`\n`rooms @User`')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        
        await message.channel.send({ embeds: [embed] });
        return;
    }

    if (mentionedUser) {
        await showUserActivity(message, mentionedUser, client);
    } else {
        await showRoleActivity(message, mentionedRole, client);
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
                { name: '**🔊 Last voice room **', value: lastVoiceInfo, inline: false },
                { name: '**💬 Last Text Room**', value: lastMessageInfo, inline: false }
            ])
            .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('خطأ في عرض نشاط المستخدم:', error);
        await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' });
    }
}

async function showRoleActivity(message, role, client) {
    try {
        const members = role.members;
        
        if (members.size === 0) {
            const embed = colorManager.createEmbed()
                .setDescription('**⚠️ لا يوجد أعضاء في هذا الرول**')
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
            await message.channel.send({ embeds: [embed] });
            return;
        }

        const memberActivities = [];

        for (const [userId, member] of members) {
            if (member.user.bot) continue;
            
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
                .setTitle(`**Rooms : ${role.name}**`)
                .setDescription(`**إجمالي الأعضاء:** ${memberActivities.length}\n━━━━━━━━━━━━━━━━━━━━━━━━`)
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
                    value: `> **🔊 Last Voice:** ${lastVoiceInfo}\n` +
                           `> **💬 Last Text:** ${lastMessageInfo}`,
                    inline: false
                }]);
            });

            return embed;
        };

        const generateButtons = (page) => {
            const row1 = new ActionRowBuilder();
            
            const leftButton = new ButtonBuilder()
                .setCustomId('rooms_previous')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0);

            const rightButton = new ButtonBuilder()
                .setCustomId('rooms_next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === totalPages - 1);

            row1.addComponents(leftButton, rightButton);

            const row2 = new ActionRowBuilder();

            const mentionButton = new ButtonBuilder()
                .setCustomId('rooms_mention')
                .setLabel('منشن')
                .setStyle(ButtonStyle.Success);

            const notifyButton = new ButtonBuilder()
                .setCustomId('rooms_notify')
                .setLabel('تنبيه')
                .setStyle(ButtonStyle.Danger);

            row2.addComponents(mentionButton, notifyButton);

            return [row1, row2];
        };

        const sentMessage = await message.channel.send({
            embeds: [generateEmbed(currentPage)],
            components: generateButtons(currentPage)
        });

        const filter = i => i.user.id === message.author.id;
        const collector = sentMessage.createMessageComponentCollector({ filter, time: 300000 });

        collector.on('collect', async interaction => {
            try {
                if (interaction.replied || interaction.deferred) return;

                if (interaction.customId === 'rooms_previous') {
                    currentPage = Math.max(0, currentPage - 1);
                    await interaction.update({
                        embeds: [generateEmbed(currentPage)],
                        components: generateButtons(currentPage)
                    });
                } else if (interaction.customId === 'rooms_next') {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    await interaction.update({
                        embeds: [generateEmbed(currentPage)],
                        components: generateButtons(currentPage)
                    });
                } else if (interaction.customId === 'rooms_mention') {
                    const mentions = memberActivities.map(data => `<@${data.member.id}>`).join(' ');
                    
                    const mentionEmbed = colorManager.createEmbed()
                        .setTitle(`**تم منشن ${role.name}**`)
                        .setDescription(`**تم منشن جميع أعضاء الرول بنجاح**`)
                        .setFooter({ text: 'By Ahmed.' })
                        .setTimestamp();
                    
                    await interaction.update({
                        content: mentions,
                        embeds: [mentionEmbed],
                        components: generateButtons(currentPage)
                    });
                } else if (interaction.customId === 'rooms_notify') {
                    await interaction.deferUpdate();
                    
                    let successCount = 0;
                    let failCount = 0;

                    for (const data of memberActivities) {
                        try {
                            const dmEmbed = colorManager.createEmbed()
                                .setTitle('**تنبيه من إدارة السيرفر**')
                                .setDescription(`**🔔 الرجاء التفاعل في الرومات**\n\n**السيرفر:** ${message.guild.name}\n**الرول:** ${role.name}`)
                                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                                .setFooter({ text: 'By Ahmed.' })
                                .setTimestamp();

                            await data.member.send({ embeds: [dmEmbed] });
                            successCount++;
                        } catch (error) {
                            failCount++;
                            console.error(`فشل إرسال رسالة لـ ${data.member.displayName}:`, error.message);
                        }
                    }

                    const resultEmbed = colorManager.createEmbed()
                        .setTitle('**نتيجة التنبيه**')
                        .setDescription(`**✅ تم الإرسال:** ${successCount}\n**❌ فشل الإرسال:** ${failCount}`)
                        .setFooter({ text: 'By Ahmed.' })
                        .setTimestamp();

                    await interaction.followUp({ embeds: [resultEmbed], ephemeral: true });
                }
            } catch (error) {
                console.error('خطأ في معالج الأزرار:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '**حدث خطأ أثناء معالجة الطلب**', ephemeral: true });
                }
            }
        });

        collector.on('end', () => {
            sentMessage.edit({ components: [] }).catch(console.error);
        });

    } catch (error) {
        console.error('خطأ في عرض نشاط الرول:', error);
        await message.channel.send({ content: '**حدث خطأ أثناء جلب البيانات**' });
    }
}

module.exports = {
    name,
    execute
};
