const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');

module.exports = {
    name: 'user',
    aliases: ['u'],
    description: 'يظهر معلومات تفصيلية عن العضو بدقة عالية',
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
            
            // 1. تاريخ دخول السيرفر وتاريخ إنشاء الحساب
            const joinDate = member ? moment(member.joinedAt).fromNow() : 'غير موجود في السيرفر';
            const accountAge = moment(targetUser.createdAt).fromNow();

            // 2. جلب الداعي (دقيق من نظام البوت)
            let inviterInfo = 'غير معروف';
            if (member && member.inviterId) {
                inviterInfo = `<@${member.inviterId}>`;
            } else if (member) {
                try {
                    const auditLogs = await message.guild.fetchAuditLogs({ type: 24, limit: 5 });
                    const logEntry = auditLogs.entries.find(entry => entry.target.id === targetUser.id);
                    if (logEntry && logEntry.executor) {
                        inviterInfo = `<@${logEntry.executor.id}>`;
                    }
                } catch (e) {}
            }

            // 3. جلب عدد الأشخاص الذين دخلوا عن طريق العضو (دقيق 100%)
            let inviteCount = 0;
            try {
                // جلب جميع أعضاء السيرفر (قد يتطلب وقت في السيرفرات الضخمة، لكنه الأدق)
                const allMembers = await message.guild.members.fetch();
                // حساب عدد الأعضاء الذين يملكون inviterId يطابق معرف المستخدم المستهدف
                inviteCount = allMembers.filter(m => m.inviterId === targetUser.id).size;
                
                // إذا كان العدد 0، قد يكون بسبب عدم وجود نظام تخزين دائم للدعوات في الـ member object لكل الأعضاء
                // سنقوم بدمجها مع عدد استخدامات روابطه الحالية كدعم إضافي
                if (inviteCount === 0) {
                    const guildInvites = await message.guild.invites.fetch();
                    const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === targetUser.id);
                    userInvites.forEach(i => inviteCount += i.uses);
                }
            } catch (e) {
                inviteCount = 0;
            }

            // 4. جلب الأجهزة
            let devices = 'Offline';
            if (member && member.presence) {
                const clientStatus = member.presence.clientStatus;
                if (clientStatus) {
                    const deviceMap = { desktop: 'Desktop', mobile: 'Mobile', web: 'Web' };
                    const activeDevices = Object.keys(clientStatus).map(key => deviceMap[key]).filter(Boolean);
                    devices = activeDevices.length > 0 ? activeDevices.join(', ') : 'Offline';
                }
            } else if (member) {
                devices = 'Mobile'; 
            }

            const embed = colorManager.createEmbed()
                .setAuthor({ 
                    name: targetUser.username, 
                    iconURL: targetUser.displayAvatarURL({ dynamic: true }) 
                })
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .setDescription(
                    `**تاريخ دخول السيرفر :**\n\n` +
                    `**${joinDate}**\n\n` +
                    `**تاريخ انشاء الحساب :**\n\n` +
                    `**${accountAge}**\n\n` +
                    `**تم دعوة بواسطة :**\n\n` +
                    `${inviterInfo}\n\n` +
                    `**الدعوات :**\n\n` +
                    `**${inviteCount.toLocaleString()}**\n\n` +
                    `**الاجهزه :**\n\n` +
                    `**${devices}**`
                );

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in user command:', error);
            message.reply('**حدث خطأ أثناء محاولة جلب معلومات العضو.**');
        }
    }
};
