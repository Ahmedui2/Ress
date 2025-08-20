
const { EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

const name = 'مسؤوليات';

async function execute(message, args, { responsibilities, client, BOT_OWNERS }) {
    // فحص البلوك أولاً
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    // تحميل admin roles من الملف مباشرة للتأكد من أحدث البيانات
    function loadAdminRoles() {
        try {
            const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
            if (fs.existsSync(adminRolesPath)) {
                const data = fs.readFileSync(adminRolesPath, 'utf8');
                const adminRoles = JSON.parse(data);
                return Array.isArray(adminRoles) ? adminRoles : [];
            }
            return [];
        } catch (error) {
            console.error('خطأ في قراءة adminRoles:', error);
            return [];
        }
    }
    
    const CURRENT_ADMIN_ROLES = loadAdminRoles();

    // التحقق من وجود منشن
    let targetUser = null;
    let userId = message.author.id;

    if (message.mentions.users.size > 0) {
        // التحقق من صلاحية رؤية مسؤوليات الآخرين - نفس نظام أمر مسؤول
        const member = await message.guild.members.fetch(message.author.id);
        const hasAdminRole = member.roles.cache.some(role => CURRENT_ADMIN_ROLES.includes(role.id));
        const hasAdministrator = member.permissions.has('Administrator');
        const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

        console.log(`التحقق من صلاحيات أمر مسؤولياتي للمستخدم ${message.author.id}:`);
        console.log(`- isOwner: ${isOwner}`);
        console.log(`- hasAdministrator: ${hasAdministrator}`);
        console.log(`- hasAdminRole: ${hasAdminRole}`);
        console.log(`- CURRENT_ADMIN_ROLES: ${JSON.stringify(CURRENT_ADMIN_ROLES)}`);
        console.log(`- User roles: ${member.roles.cache.map(r => r.id)}`);

        if (!hasAdminRole && !isOwner && !hasAdministrator) {
            console.log(`رفض الوصول لأمر مسؤولياتي للمستخدم ${message.author.id}`);
            await message.react('❌');
            return;
        }
        
        console.log(`تم منح الوصول لأمر مسؤولياتي للمستخدم ${message.author.id}`);

        targetUser = message.mentions.users.first();
        userId = targetUser.id;
    } else {
        targetUser = message.author;
        userId = message.author.id;
    }
    
    // تحميل المسؤوليات الحديثة من الملف مباشرة
    const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
    let currentResponsibilities = {};
    
    try {
        if (fs.existsSync(responsibilitiesPath)) {
            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
            currentResponsibilities = JSON.parse(data);
        }
    } catch (error) {
        console.error('خطأ في قراءة المسؤوليات:', error);
        currentResponsibilities = responsibilities || {};
    }
    
    // البحث عن مسؤوليات المستخدم المحدد
    const userResponsibilities = [];
    
    for (const [respName, respData] of Object.entries(currentResponsibilities)) {
        if (respData.responsibles && respData.responsibles.includes(userId)) {
            // حساب عدد المسؤولين الآخرين
            const otherResponsibles = respData.responsibles.filter(id => id !== userId);
            userResponsibilities.push({
                name: respName,
                description: respData.description || 'لا يوجد وصف',
                otherResponsiblesCount: otherResponsibles.length
            });
        }
    }
    
    // إنشاء الرد
    if (userResponsibilities.length === 0) {
        const displayName = targetUser.displayName || targetUser.username;
        const noRespEmbed = colorManager.createEmbed()
            .setTitle(`مسؤوليات ${displayName}`)
            .setDescription(targetUser.id === message.author.id ? 
                '**ليس لديك أي مسؤوليات معينة حتى الآن.**' : 
                `**${displayName} ليس لديه أي مسؤوليات معينة حتى الآن.**`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

        await message.channel.send({ embeds: [noRespEmbed] });
    } else {
        // إنشاء قائمة المسؤوليات مع التفاصيل
        let responsibilitiesList = '';
        userResponsibilities.forEach((resp, index) => {
            responsibilitiesList += `**${index + 1}.** ${resp.name}\n`;
            if (resp.description && resp.description !== 'لا يوجد وصف') {
                responsibilitiesList += `   ${resp.description}\n`;
            }
            if (resp.otherResponsiblesCount > 0) {
                responsibilitiesList += `   ${resp.otherResponsiblesCount} مسؤولون آخرون\n\n`;
            } else {
                responsibilitiesList += `   أنت المسؤول الوحيد\n\n`;
            }
        });
        
        const displayName = targetUser.displayName || targetUser.username;
        const respEmbed = colorManager.createEmbed()
            .setTitle(`مسؤوليات ${displayName}`)
            .setDescription(targetUser.id === message.author.id ? 
                `**مسؤولياتك الحالية:**\n\n${responsibilitiesList}` :
                `**مسؤوليات ${displayName}:**\n\n${responsibilitiesList}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields([
                { name: 'إجمالي المسؤوليات', value: `${userResponsibilities.length}`, inline: true },
                { name: 'المستخدم', value: `<@${userId}>`, inline: true }
            ])
            .setFooter({ text: 'نظام إدارة المسؤوليات • By Ahmed' })
            .setTimestamp();

        await message.channel.send({ embeds: [respEmbed] });
    }
}

module.exports = { name, execute };
