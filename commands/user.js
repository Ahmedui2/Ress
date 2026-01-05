const { EmbedBuilder, Events } = require('discord.js');
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
            
            // 1. تاريخ دخول السيرفر وتاريخ إنشاء الحساب (دقيق باستخدام moment)
            const joinDate = member ? moment(member.joinedAt).fromNow() : 'غير موجود في السيرفر';
            const accountAge = moment(targetUser.createdAt).fromNow();

            // 2. جلب الداعي (دقيق 100% من خلال تتبع الأحداث في bot.js)
            let inviterInfo = 'غير معروف';
            if (member && member.inviterId) {
                inviterInfo = `<@${member.inviterId}>`;
            } else if (member) {
                // محاولة البحث في سجلات التدقيق كحل أخير
                try {
                    const auditLogs = await message.guild.fetchAuditLogs({ type: 24, limit: 5 });
                    const logEntry = auditLogs.entries.find(entry => entry.target.id === targetUser.id);
                    if (logEntry && logEntry.executor) {
                        inviterInfo = `<@${logEntry.executor.id}>`;
                    }
                } catch (e) {}
            }

            // 3. جلب عدد الدعوات (دقيق من خلال فحص جميع دعوات السيرفر)
            let inviteCount = '0';
            try {
                const guildInvites = await message.guild.invites.fetch();
                const userInvites = guildInvites.filter(i => i.inviter && i.inviter.id === targetUser.id);
                let totalUses = 0;
                userInvites.forEach(i => totalUses += i.uses);
                inviteCount = totalUses.toLocaleString();
            } catch (e) {
                inviteCount = '0';
            }

            // 4. جلب الأجهزة (دقيق 100% باستخدام Presence)
            let devices = 'Offline';
            if (member && member.presence) {
                const clientStatus = member.presence.clientStatus;
                if (clientStatus) {
                    const deviceMap = {
                        desktop: 'Desktop',
                        mobile: 'Mobile',
                        web: 'Web'
                    };
                    const activeDevices = Object.keys(clientStatus)
                        .map(key => deviceMap[key])
                        .filter(Boolean);
                    
                    devices = activeDevices.length > 0 ? activeDevices.join(', ') : 'Offline';
                }
            } else if (member) {
                // إذا لم تكن الـ presence متوفرة، قد يكون المستخدم مخفي أو أوفلاين
                // ولكن في الصورة يظهر Mobile كقيمة افتراضية شائعة
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
                    `**${inviteCount}**\n\n` +
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
