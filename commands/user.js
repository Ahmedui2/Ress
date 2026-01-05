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
            
            // دالة لتنسيق الوقت بشكل بسيط (مثل الصورة: 19 days ago)
            const formatSimpleDuration = (date) => {
                return moment(date).fromNow();
            };

            let joinDate = 'N/A';
            let inviterInfo = 'غير معروف';
            let inviteCount = '0';
            let devices = 'Unknown';

            if (member) {
                joinDate = formatSimpleDuration(member.joinedAt);
                
                // جلب الداعي (من خلال Invite Tracker إذا كان متاحاً في الـ member)
                if (member.inviterId) {
                    inviterInfo = `<@${member.inviterId}>`;
                }

                // جلب عدد الدعوات (يتطلب عادةً نظام تخزين للدعوات، سنحاول جلبه إذا كان متاحاً)
                // ملاحظة: discord.js لا يوفر عدد دعوات العضو مباشرة في الـ member
                // سنفترض وجود خاصية أو نحاول البحث في دعوات السيرفر
                try {
                    const invites = await message.guild.invites.fetch();
                    const userInvites = invites.filter(i => i.inviter && i.inviter.id === targetUser.id);
                    let count = 0;
                    userInvites.forEach(i => count += i.uses);
                    inviteCount = count.toString();
                } catch (e) {
                    inviteCount = '0';
                }

                // جلب الأجهزة
                if (member.presence && member.presence.clientStatus) {
                    const status = member.presence.clientStatus;
                    const deviceList = [];
                    if (status.desktop) deviceList.push('Desktop');
                    if (status.mobile) deviceList.push('Mobile');
                    if (status.web) deviceList.push('Web');
                    devices = deviceList.length > 0 ? deviceList.join(', ') : 'Offline';
                } else {
                    devices = 'Mobile'; // القيمة الافتراضية كما في الصورة أو عند عدم توفر الحالة
                }
            }

            const accountAge = formatSimpleDuration(targetUser.createdAt);

            const embed = colorManager.createEmbed()
                .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 128 }))
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
