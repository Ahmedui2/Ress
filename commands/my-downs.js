const { EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager');
const downManager = require('../utils/downManager');

module.exports = {
    name: 'داوني',
    description: 'عرض معلومات عن الداونات النشطة الخاصة بك',
    async execute(message, args, context) {
        const { ADMIN_ROLES, BOT_OWNERS, client } = context;
        const member = await message.guild.members.fetch(message.author.id);
        const isOwner = BOT_OWNERS.includes(message.author.id);

        let targetUserId = message.author.id;
        let isTargetingOther = false;

        // التحقق إذا كان الأونر يحاول رؤية داونات شخص آخر
        if (isOwner && args[0]) {
            const mentionedUser = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
            if (mentionedUser) {
                targetUserId = mentionedUser.id;
                isTargetingOther = true;
            }
        }

        const activeDowns = downManager.getUserDowns(targetUserId);

        // إذا لم يكن الشخص أونر، نتحقق إذا كان لديه داون بالفعل
        if (!isOwner && activeDowns.length === 0) {
            try {
                await message.react('❌');
            } catch (error) {
                console.error('Failed to add reaction:', error);
            }
            return;
        }

        if (activeDowns.length === 0) {
            const noDownEmbed = colorManager.createEmbed()
                .setTitle('🔍 حالة الداون')
                .setDescription(isTargetingOther ? `**العضو <@${targetUserId}> ليس لديه أي داونات نشطة حالياً.**` : '**ليس لديك أي داونات نشطة حالياً.**')
                
            return message.reply({ embeds: [noDownEmbed] });
        }

        const embed = colorManager.createEmbed()
            .setTitle(isTargetingOther ? `الداونات النشطة للعضو <@${targetUserId}>` : ' الداونات النشطة الخاصة بك')
            .setDescription(isTargetingOther ? `يوجد **${activeDowns.length}** داون نشط حالياً للاداري :` : `لديك **${activeDowns.length}** داون نشط حالياً :`)
            .setTimestamp();

        for (const down of activeDowns) {
            const roleMention = down.roleId ? `<@&${down.roleId}>` : '**رول غير موجود**';
            const moderatorMention = `<@${down.byUserId}>`;
            const startTime = `<t:${Math.floor(down.startTime / 1000)}:f>`;
            const timeAgo = `<t:${Math.floor(down.startTime / 1000)}:R>`;
            
            let timeLeft = '**نهائي ♾️**';
            if (down.endTime) {
                timeLeft = `<t:${Math.floor(down.endTime / 1000)}:R> (في <t:${Math.floor(down.endTime / 1000)}:f>)`;
            }

            embed.addFields({
                name: `**رقم الداون :** \`${down.id.split('_').pop()}\``,
                value: `\u200b\n**الرولات المسحوبة :** ${roleMention}\n\n` +
                       `**المسؤول :** ${moderatorMention}\n\n` +
                       `**تاريخ البدء :** ${startTime} (${timeAgo})\n\n` +
                       `**الوقت المتبقي :** ${timeLeft}\n\n` +
                       `**سبب الداون :** \`${down.reason || 'لا يوجد سبب محدد'}\`\n\n\u200b`,
                inline: false
            });
        }

        return message.reply({ 
            embeds: [embed],
            allowedMentions: { parse: ['roles', 'users'], roles: activeDowns.filter(d => d.roleId).map(d => d.roleId) }
        });
    }
};
