/**
 * Enhanced User Records Display - Simplified Integration
 * Replaces basic record display with rich, detailed embeds
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Helper function to read JSON
function readJson(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) {
            return defaultValue;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data) || defaultValue;
    } catch (error) {
        console.error('Error reading JSON:', error);
        return defaultValue;
    }
}

/**
 * Enhanced display for user promotion records
 */
async function displayEnhancedUserRecords(interaction, userId, page = 0) {
    const promoteLogsPath = path.join(__dirname, 'data', 'promoteLogs.json');
    const allLogs = readJson(promoteLogsPath, []);
    
    // Get user's records
    const userRecords = allLogs.filter(log => {
        if (!log.data) return false;
        const targetUserId = log.data.targetUserId || log.data.userId;
        return targetUserId === userId;
    }).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    if (userRecords.length === 0) {
        return interaction.reply({
            content: `**العضو** <@${userId}> **ليس لديه أي سجلات ترقيات.**`,
            ephemeral: true
        });
    }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const memberName = member?.displayName || `العضو ${userId}`;

    // Calculate statistics
    const stats = calculateUserStats(userRecords);
    
    // Create enhanced embed
    const embed = createEnhancedUserEmbed(member, userRecords, stats, page);

    // Create navigation
    const components = createNavigationComponents(page, userRecords.length, userId);

    await interaction.reply({
        embeds: [embed],
        components: components,
        ephemeral: true
    });
}

/**
 * Calculate detailed statistics for user
 */
function calculateUserStats(records) {
    const stats = {
        total: records.length,
        active: 0,
        expired: 0,
        roles: {},
        moderators: new Set(),
        firstPromotion: null,
        lastPromotion: null,
        totalDuration: 0
    };

    records.forEach(record => {
        const data = record.data || {};
        
        // Track promotion status
        if (record.type === 'PROMOTION_APPLIED' || record.type === 'BULK_PROMOTION') {
            if (data.duration && data.duration !== 'دائم') {
                const durationMs = parseDuration(data.duration);
                const endTime = new Date(record.timestamp).getTime() + durationMs;
                if (Date.now() > endTime) {
                    stats.expired++;
                } else {
                    stats.active++;
                }
            } else {
                stats.active++;
            }
        }

        // Track roles
        const roleName = record.roleName || data.role?.name || data.targetRoleName || 'غير محدد';
        stats.roles[roleName] = (stats.roles[roleName] || 0) + 1;

        // Track moderators
        if (data.byUserId || data.moderatorId) {
            stats.moderators.add(data.byUserId || data.moderatorId);
        }

        // Track dates
        if (!stats.firstPromotion || new Date(record.timestamp) < new Date(stats.firstPromotion)) {
            stats.firstPromotion = record.timestamp;
        }
        if (!stats.lastPromotion || new Date(record.timestamp) > new Date(stats.lastPromotion)) {
            stats.lastPromotion = record.timestamp;
        }
    });

    return stats;
}

/**
 * Create enhanced embed with rich details
 */
function createEnhancedUserEmbed(member, records, stats, page) {
    const startIndex = page * 5;
    const pageRecords = records.slice(startIndex, startIndex + 5);
    const totalPages = Math.ceil(records.length / 5);
    
    const embed = new EmbedBuilder()
        .setTitle(`📊 سجل ترقيات ${member?.displayName || 'العضو'}`)
        .setColor(0x0099ff)
        .setThumbnail(member?.displayAvatarURL({ dynamic: true }) || member?.user?.displayAvatarURL({ dynamic: true }) || null)
        .setFooter({ text: `الصفحة ${page + 1} من ${totalPages} | إجمالي ${records.length} سجل` })
        .setTimestamp();

    // Add statistics
    const topRole = Object.entries(stats.roles)
        .sort(([,a], [,b]) => b - a)[0]?.[0] || 'غير محدد';
    
    embed.addFields(
        {
            name: '📈 الإحصائيات العامة',
            value: `• **الإجمالي:** ${stats.total}\n• **النشطة:** ${stats.active}\n• **المنتهية:** ${stats.expired}\n• **أكثر دور:** ${topRole}`,
            inline: true
        },
        {
            name: '⏰ المدة',
            value: `• **الأولى:** ${stats.firstPromotion ? `<t:${Math.floor(new Date(stats.firstPromotion).getTime()/1000)}:D>` : 'غير محدد'}\n• **الأخيرة:** ${stats.lastPromotion ? `<t:${Math.floor(new Date(stats.lastPromotion).getTime()/1000)}:D>` : 'غير محدد'}`,
            inline: true
        },
        {
            name: '👥 المشرفون',
            value: Array.from(stats.moderators).slice(0, 3)
                .map(id => `• <@${id}>`).join('\n') + 
                (stats.moderators.size > 3 ? `\n• و${stats.moderators.size - 3} آخرين` : ''),
            inline: true
        }
    );

    // Add detailed records
    pageRecords.forEach((record, index) => {
        const actualIndex = startIndex + index + 1;
        const recordInfo = formatRecordDetail(record, actualIndex);
        
        embed.addFields({
            name: `${recordInfo.icon} ${recordInfo.title}`,
            value: recordInfo.description,
            inline: false
        });
    });

    return embed;
}

/**
 * Format individual record details
 */
function formatRecordDetail(record, index) {
    const data = record.data || {};
    const date = new Date(record.timestamp || Date.now());
    const timestamp = Math.floor(date.getTime() / 1000);
    
    let icon = '📝';
    let title = `سجل #${index}`;
    let description = '';

    switch (record.type) {
        case 'PROMOTION_APPLIED':
            icon = data.duration && data.duration !== 'دائم' ? '⏱️' : '⬆️';
            title = `ترقية فردية - ${record.roleName || data.role?.name || 'دور جديد'}`;
            description = 
                `**العضو:** <@${data.targetUserId || data.userId}>\n` +
                `**الدور:** ${data.previousRole?.name || 'بدون دور'} → **${record.roleName || data.role?.name || 'دور جديد'}**\n` +
                `**المدة:** ${data.duration || 'دائمة'}\n` +
                `**السبب:** ${data.reason || 'غير محدد'}\n` +
                `**بواسطة:** <@${data.byUserId || data.moderatorId}>\n` +
                `**التاريخ:** <t:${timestamp}:f> (<t:${timestamp}:R>)`;
            break;

        case 'BULK_PROMOTION':
            icon = '🔄';
            title = `ترقية جماعية - ${data.targetRoleName || data.targetRole?.name || 'دور جديد'}`;
            description = 
                `**من:** ${data.sourceRoleName || data.sourceRole?.name || 'غير محدد'}\n` +
                `**إلى:** ${data.targetRoleName || data.targetRole?.name || 'دور جديد'}\n` +
                `**الأعضاء:** ${data.successCount || data.successfulMembers?.length || 0} عضو\n` +
                `**السبب:** ${data.reason || 'غير محدد'}\n` +
                `**بواسطة:** <@${data.byUserId || data.moderatorId}>\n` +
                `**التاريخ:** <t:${timestamp}:f>`;
            break;

        case 'PROMOTION_ENDED':
            icon = '⏰';
            title = `انتهاء ترقية - ${record.roleName || data.role?.name || 'دور محذوف'}`;
            description = 
                `**الدور:** ${record.roleName || data.role?.name || 'دور محذوف'}\n` +
                `**العضو:** <@${data.targetUserId || data.userId}>\n` +
                `**مدة الترقية:** ${data.duration || 'غير محددة'}\n` +
                `**تاريخ الانتهاء:** <t:${timestamp}:f>\n` +
                `**بواسطة:** <@${data.byUserId || data.moderatorId}>`;
            break;

        default:
            icon = '❓';
            title = `إجراء غير معروف`;
            description = `نوع الإجراء: ${record.type}`;
    }

    return { icon, title, description };
}

/**
 * Create navigation components
 */
function createNavigationComponents(page, totalRecords, userId) {
    const totalPages = Math.ceil(totalRecords / 5);
    
    const navigationRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`enhanced_user_prev_${userId}_${page}`)
                .setLabel('السابق')
                .setStyle(1)
                .setEmoji('⬅️')
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`enhanced_user_page_${userId}`)
                .setLabel(`${page + 1}/${totalPages}`)
                .setStyle(2)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`enhanced_user_next_${userId}_${page}`)
                .setLabel('التالي')
                .setStyle(1)
                .setEmoji('➡️')
                .setDisabled(page >= totalPages - 1)
        );

    const actionRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`enhanced_user_export_${userId}`)
                .setLabel('تصدير كملف')
                .setStyle(3)
                .setEmoji('📤'),
            new ButtonBuilder()
                .setCustomId(`enhanced_user_delete_${userId}`)
                .setLabel('حذف الكل')
                .setStyle(4)
                .setEmoji('🗑️')
        );

    return [navigationRow, actionRow];
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(durationStr) {
    if (!durationStr || durationStr === 'دائم') return 0;
    
    const match = durationStr.match(/(\d+)\s*([smhdw]/);
    if (!match) return 0;
    
    const [, amount, unit] = match;
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    return parseInt(amount) * (multipliers[unit] || 0);
}

module.exports = {
    displayEnhancedUserRecords,
    createEnhancedUserEmbed
};