const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');

module.exports = {
    name: 'user',
    aliases: ['u'],
    description: 'يظهر معلومات تفصيلية عن العضو',
    async execute(message, args, { client }) {
        try {
            if (isChannelBlocked(message.channel.id)) return;
            if (isUserBlocked(message.author.id)) return;

            const targetUser = message.mentions.users.first() || 
                             (args[0] ? await client.users.fetch(args[0]).catch(() => null) : message.author);

            if (!targetUser) {
                return message.reply({ embeds: [colorManager.createEmbed().setDescription('**❌ لم يتم العثور على هذا العضو**')] });
            }

            const member = await message.guild.members.fetch(targetUser.id).catch(() => null);
            
            // دالة لتنسيق الوقت بدقة (إخفاء الأصفار)
            const formatPreciseDuration = (duration) => {
                const parts = [];
                if (duration.years() > 0) parts.push(`*${duration.years()} y*`);
                if (duration.months() > 0) parts.push(`*${duration.months()}mon*`);
                if (duration.days() > 0) parts.push(`*${duration.days()} d*`);
                if (duration.hours() > 0) parts.push(`*${duration.hours()} h*`);
                if (duration.minutes() > 0) parts.push(`*${duration.minutes()} m*`);
                return parts.length > 0 ? parts.join(', ') : '**أقل من دقيقة**';
            };

            // حساب عمر الحساب
            const createdAt = moment(targetUser.createdAt);
            const accountAge = moment.duration(moment().diff(createdAt));
            const accountAgeStr = formatPreciseDuration(accountAge);

            let joinInfo = '**غير موجود في السيرفر**';
            let durationStr = '**N/A**';
            let inviterInfo = '**غير معروف**';

            if (member) {
                // حساب مدة التواجد في السيرفر
                const joinedAt = moment(member.joinedAt);
                const joinDuration = moment.duration(moment().diff(joinedAt));
                durationStr = formatPreciseDuration(joinDuration);
                joinInfo = `**<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)**`;

                // محاولة معرفة من دعا العضو
                try {
                    // أولاً: التحقق من التاج (Invite Tracker)
                    if (member.inviterId) {
                        inviterInfo = `<@${member.inviterId}>`;
                    } else {
                        // ثانياً: البحث في سجلات التدقيق (Audit Logs) كاحتياط
                        const auditLogs = await message.guild.fetchAuditLogs({
                            type: 24, // MEMBER_JOIN
                            limit: 10
                        });
                        
                        const logEntry = auditLogs.entries.find(entry => entry.target.id === targetUser.id);
                        
                        if (logEntry && logEntry.executor) {
                            inviterInfo = `<@${logEntry.executor.id}>`;
                        } else {
                            // ثالثاً: إذا لم يوجد شيء، فهو منشن الشيب
                            inviterInfo = `<@${message.guild.ownerId}>`;
                        }
                    }
                } catch (e) {
                    inviterInfo = '**صلاحيات غير كافية لفحص الدعوات**';
                }
            }

            const embed = colorManager.createEmbed()
                .setAuthor({ name: targetUser.tag, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 128 }))
                .setTitle('معلومات العضو')
                .addFields([
                    { name: 'إنشاء الحساب', value: `**<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>\n(${accountAgeStr})**`, inline: false },
                    { name: 'دخل السيرفر في', value: joinInfo, inline: false },
                    { name: 'مدة التواجد', value: durationStr, inline: false },
                    { name: 'دخل عن طريق ', value: inviterInfo, inline: false }
                ])
                .setFooter({ text: `By Ahmed.`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in user command:', error);
            message.reply('**حدث خطأ أثناء محاولة جلب معلومات العضو.**');
        }
    }
};
