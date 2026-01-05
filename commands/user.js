const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');

module.exports = {
    name: 'user',
    aliases: ['u'],
    description: 'يظهر معلومات تفصيلية عن العضو (نسخة محسنة وخفيفة)',
    async execute(message, args, { client }) {
        try {
            if (isChannelBlocked(message.channel.id)) return;
            if (isUserBlocked(message.author.id)) return;

            const targetUser = message.mentions.users.first() || 
                             (args[0] ? await client.users.fetch(args[0]).catch(() => null) : message.author);

            if (!targetUser) {
                return message.reply({ embeds: [colorManager.createEmbed().setDescription('**❌ لم يتم العثور على هذا العضو**')] });
            }

            // جلب العضو من الكاش أولاً لتقليل الطلبات
            const member = message.guild.members.cache.get(targetUser.id) || 
                          await message.guild.members.fetch(targetUser.id).catch(() => null);
            
            const joinDate = member ? moment(member.joinedAt).fromNow() : 'غير موجود في السيرفر';
            const accountAge = moment(targetUser.createdAt).fromNow();

            // 1. جلب الداعي (من الكاش أو سجلات التدقيق المحدودة)
            let inviterInfo = 'غير معروف';
            if (member && member.inviterId) {
                inviterInfo = `<@${member.inviterId}>`;
            }

            // 2. حساب الدعوات بطريقة خفيفة جداً (CPU Friendly)
            // بدلاً من fetch() لكل الأعضاء، نستخدم fetch() للدعوات فقط (سريع جداً)
            let inviteCount = 0;
            try {
                const guildInvites = await message.guild.invites.fetch();
                // نفلتر الدعوات الخاصة بالمستخدم فقط ونجمع استخداماتها
                // هذه العملية سريعة جداً ولا تستهلك CPU لأنها تتعامل مع قائمة صغيرة (الدعوات) وليس الأعضاء
                const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === targetUser.id);
                userInvites.forEach(i => inviteCount += i.uses);
            } catch (e) {
                inviteCount = 0;
            }

            // 3. جلب الأجهزة (من الكاش مباشرة)
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
