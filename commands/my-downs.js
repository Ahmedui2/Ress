const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager');
const downManager = require('../utils/downManager');

module.exports = {
    name: 'داوني',
    description: 'عرض معلومات عن الداونات النشطة الخاصة بك',
    async execute(message, args, context) {
        try {
            const { BOT_OWNERS, client } = context;
            const isOwner = BOT_OWNERS.includes(message.author.id);
            const sendResponse = async (payload) => {
                try {
                    return await message.reply(payload);
                } catch (error) {
                    console.warn('Failed to reply, falling back to channel.send:', error.message);
                    return message.channel.send(payload);
                }
            };

            let targetUserId = message.author.id;
            let isTargetingOther = false;

            // 1. تحسين جلب المستخدم المستهدف (البحث في الكاش أولاً ثم الـ API)
            if (isOwner && args[0]) {
                const targetId = args[0].replace(/[<@!>]/g, '');
                const user = message.mentions.users.first() || 
                             client.users.cache.get(targetId) || 
                             await client.users.fetch(targetId).catch(() => null);
                
                if (user) {
                    targetUserId = user.id;
                    isTargetingOther = true;
                }
            }

            const user = await client.users.fetch(targetUserId).catch(() => null);
            const activeDowns = downManager.getUserDowns(targetUserId);

            // 2. التعامل مع حالة عدم وجود داونات
            if (activeDowns.length === 0) {
                if (!isOwner) {
                    return await message.react('❌').catch(() => null);
                }
                
                const noDownEmbed = colorManager.createEmbed()
                    .setTitle('🔍 حالة الداون')
                    .setDescription(isTargetingOther ? `**العضو <@${targetUserId}> ليس لديه أي داونات نشطة حالياً.**` : '**ليس لديك أي داونات نشطة حالياً.**');
                
                return await sendResponse({ embeds: [noDownEmbed] }).catch(() => null);
            }

            // 3. بناء الـ Embed الأساسي مع الصور والتنسيق المحسن
            const embed = this.createDownsEmbed(user, activeDowns, isTargetingOther);

            // 4. استخراج الرولات الفريدة لمنع خطأ Invalid Form Body
            const uniqueRoleIds = [...new Set(activeDowns.filter(d => d.roleId).map(d => d.roleId))];

            return await sendResponse({ 
                embeds: [embed],
                allowedMentions: { 
                    parse: ['users'],
                    roles: uniqueRoleIds
                }
            }).catch(err => console.error('Failed to send reply:', err));

        } catch (error) {
            console.error('Error in my-downs command:', error);
            return sendResponse({ content: '⚠️ حدث خطأ غير متوقع أثناء معالجة الطلب.' }).catch(() => null);
        }
    },

    // دالة مساعدة لبناء الـ Embed لضمان توحيد الشكل في الأمر وزر التحديث
    createDownsEmbed(user, activeDowns, isTargetingOther) {
        const embed = colorManager.createEmbed()
            .setAuthor({ name: user ? user.tag : 'مستخدم غير معروف', iconURL: user ? user.displayAvatarURL({ dynamic: true }) : null })
            .setThumbnail(user ? user.displayAvatarURL({ dynamic: true }) : null)
            .setTitle(isTargetingOther ? `الداونات النشطة للعضو` : 'الداونات النشطة الخاصة بك')
            .setDescription(isTargetingOther ? `يوجد **${activeDowns.length}** داون نشط حالياً للعضو <@${user?.id}> :` : `لديك **${activeDowns.length}** داون نشط حالياً :`)
            .setTimestamp();

        activeDowns.slice(0, 25).forEach(down => {
            const roleMention = down.roleId ? `<@&${down.roleId}>` : '**رول غير موجود**';
            const startTime = Math.floor(down.startTime / 1000);
            const endTime = down.endTime ? Math.floor(down.endTime / 1000) : null;
            
            const timeLeft = endTime ? `<t:${endTime}:R> (ينتهي في <t:${endTime}:f>)` : '**نهائي ♾️**';

            embed.addFields({
                name: `📌 رقم الداون : \`${down.id?.split('_').pop() || 'N/A'}\``,
                value: `**الرولات المسحوبة :** ${roleMention}\n` +
                       `**المسؤول :** <@${down.byUserId}>\n` +
                       `**تاريخ البدء :** <t:${startTime}:f> (<t:${startTime}:R>)\n` +
                       `**الوقت المتبقي :** ${timeLeft}\n` +
                       `**سبب الداون :** \`${down.reason || 'لا يوجد سبب محدد'}\`\n\u200b`,
                inline: false
            });
        });

        return embed;
    }
};
