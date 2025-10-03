// إضافة هذه الدوال في نهاية ملف commands/promote.js (قبل module.exports)

// ==================== معالجات سجلات الترقيات ====================

async function handlePromotionRecords(interaction, context) {
    const { client } = context;
    
    // Show user selector
    const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('promote_records_select_user')
        .setPlaceholder('🔍 اختر العضو لعرض سجل ترقياته...')
        .setMaxValues(1);
    
    const userRow = new ActionRowBuilder().addComponents(userSelect);
    
    const instructionEmbed = colorManager.createEmbed()
        .setTitle('📋 سجلات الترقيات')
        .setDescription('**اختر عضواً لعرض سجل ترقياته الكامل**\n\n' +
                       'سيتم عرض:\n' +
                       '• جميع الترقيات السابقة\n' +
                       '• الرولات المضافة والمسحوبة\n' +
                       '• عدد مرات الترقية\n' +
                       '• آخر ترقية\n' +
                       '• الترقيات النشطة حالياً')
        .setColor('#3498db');
    
    await interaction.update({
        embeds: [instructionEmbed],
        components: [userRow]
    });
}

// ==================== معالجات الحظر من الترقيات ====================

async function handleBanFromPromotion(interaction, context) {
    const { client } = context;
    const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
    
    // Show user selector
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('promote_ban_select_user')
        .setPlaceholder('🚫 اختر العضو لحظره من الترقيات...')
        .setMaxValues(1);
    
    const userRow = new ActionRowBuilder().addComponents(userSelect);
    
    const instructionEmbed = colorManager.createEmbed()
        .setTitle('🚫 حظر من الترقيات')
        .setDescription('**اختر العضو الذي تريد حظره من الحصول على ترقيات**\n\n' +
                       'سيتم منع العضو من:\n' +
                       '• الحصول على أي ترقيات جديدة\n' +
                       '• المشاركة في الترقيات الجماعية\n' +
                       '• التقديم على الترقيات')
        .setColor('#e74c3c');
    
    await interaction.update({
        embeds: [instructionEmbed],
        components: [userRow]
    });
}

async function handleUnbanFromPromotion(interaction, context) {
    const { client } = context;
    const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
    
    // Get all banned users
    const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
    const promoteBans = readJson(promoteBansPath, {});
    
    // Filter active bans for this guild
    const activeBans = Object.entries(promoteBans)
        .filter(([key, ban]) => {
            const [userId, guildId] = key.split('_');
            return guildId === interaction.guild.id && 
                   (!ban.endTime || ban.endTime > Date.now());
        })
        .map(([key]) => key.split('_')[0]);
    
    if (activeBans.length === 0) {
        const noBansEmbed = colorManager.createEmbed()
            .setTitle('ℹ️ لا توجد حظورات نشطة')
            .setDescription('لا يوجد أعضاء محظورون من الترقيات حالياً.')
            .setColor('#3498db');
        
        return interaction.update({ embeds: [noBansEmbed], components: [] });
    }
    
    // Create user select menu
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('promote_unban_select_user')
        .setPlaceholder('✅ اختر العضو لإلغاء حظره...')
        .setMaxValues(1);
    
    const userRow = new ActionRowBuilder().addComponents(userSelect);
    
    let bannedList = '';
    for (const userId of activeBans.slice(0, 10)) {
        const banKey = `${userId}_${interaction.guild.id}`;
        const banData = promoteBans[banKey];
        const endTime = banData.endTime ? 
            `<t:${Math.floor(banData.endTime / 1000)}:R>` : 
            'نهائي';
        bannedList += `• <@${userId}> - ينتهي: ${endTime}\n`;
    }
    
    const instructionEmbed = colorManager.createEmbed()
        .setTitle('✅ إلغاء حظر من الترقيات')
        .setDescription('**اختر العضو الذي تريد إلغاء حظره**\n\n' +
                       '**الأعضاء المحظورون حالياً:**\n' +
                       bannedList)
        .setColor('#2ecc71')
        .setFooter({ text: `إجمالي المحظورين: ${activeBans.length}` });
    
    await interaction.update({
        embeds: [instructionEmbed],
        components: [userRow]
    });
}

// ==================== معالج فحص نشاط الإدارة ====================

async function handleCheckAdminActivity(interaction, context) {
    const { client } = context;
    const { UserSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
    
    // Show user selector
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('promote_check_activity_user')
        .setPlaceholder('👤 اختر الإداري لفحص نشاطه...')
        .setMaxValues(1);
    
    const userRow = new ActionRowBuilder().addComponents(userSelect);
    
    const instructionEmbed = colorManager.createEmbed()
        .setTitle('📊 فحص نشاط الإدارة')
        .setDescription('**اختر الإداري الذي تريد فحص نشاطه قبل الترقية**\n\n' +
                       'سيتم عرض:\n' +
                       '• إحصائيات التفاعل الكاملة\n' +
                       '• الوقت الصوتي والرسائل\n' +
                       '• الأيام النشطة\n' +
                       '• سجل الترقيات السابقة\n' +
                       '• توصية بناءً على النشاط')
        .setColor('#3498db');
    
    await interaction.update({
        embeds: [instructionEmbed],
        components: [userRow]
    });
}

// ==================== إضافة المعالجات في handleMainMenu ====================
// أضف هذه الحالات في دالة handleMainMenu الموجودة:

/*
في دالة handleMainMenu، أضف هذه الحالات في switch statement:

case 'promotion_records':
    await handlePromotionRecords(interaction, context);
    break;

case 'ban_from_promotion':
    await handleBanFromPromotion(interaction, context);
    break;

case 'unban_promotion':
    await handleUnbanFromPromotion(interaction, context);
    break;

case 'check_admin_activity':
    await handleCheckAdminActivity(interaction, context);
    break;
*/

// ==================== إضافة المعالجات في handlePromoteInteractions ====================
// أضف هذه المعالجات في دالة handlePromoteInteractions:

/*
في دالة handlePromoteInteractions، أضف هذه الشروط:

// Handle user selection for records
if (interaction.customId === 'promote_records_select_user') {
    const selectedUserId = interaction.values[0];
    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    
    if (!member) {
        return interaction.reply({
            content: '❌ لم يتم العثور على العضو المحدد.',
            ephemeral: true
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    // Get user's promotion history
    const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
    const logs = readJson(promoteLogsPath, []);
    
    // Filter logs for this user
    const userLogs = logs.filter(log => 
        log.data && log.data.targetUserId === selectedUserId
    ).sort((a, b) => b.timestamp - a.timestamp);
    
    if (userLogs.length === 0) {
        const noRecordsEmbed = colorManager.createEmbed()
            .setTitle('📋 سجل الترقيات')
            .setDescription(`**لا توجد سجلات ترقيات للعضو** ${member.displayName}`)
            .setThumbnail(member.displayAvatarURL({ dynamic: true }))
            .setColor('#e74c3c');
        
        return interaction.editReply({ embeds: [noRecordsEmbed] });
    }
    
    // Count promotions
    const promotionCount = userLogs.filter(log => log.type === 'PROMOTION_APPLIED').length;
    const endedCount = userLogs.filter(log => log.type === 'PROMOTION_ENDED').length;
    
    // Get active promotions
    const activePromotesPath = path.join(__dirname, '..', 'data', 'activePromotes.json');
    const activePromotes = readJson(activePromotesPath, {});
    const userActivePromotes = Object.values(activePromotes).filter(p => p.userId === selectedUserId);
    
    // Get last promotion
    const lastPromotion = userLogs.find(log => log.type === 'PROMOTION_APPLIED');
    
    // Build detailed history
    let historyText = '';
    const recentLogs = userLogs.slice(0, 10);
    
    for (const log of recentLogs) {
        const timestamp = `<t:${Math.floor(log.timestamp / 1000)}:R>`;
        const role = await interaction.guild.roles.fetch(log.data.roleId).catch(() => null);
        const roleName = role ? role.name : `Role ID: ${log.data.roleId}`;
        
        if (log.type === 'PROMOTION_APPLIED') {
            const duration = log.data.duration || 'نهائي';
            const byUser = log.data.byUserId ? `<@${log.data.byUserId}>` : 'غير معروف';
            
            historyText += `✅ **ترقية إلى ${roleName}**\n`;
            historyText += `├─ المدة: ${duration}\n`;
            historyText += `├─ بواسطة: ${byUser}\n`;
            historyText += `├─ السبب: ${log.data.reason || 'لا يوجد'}\n`;
            historyText += `└─ ${timestamp}\n\n`;
            
        } else if (log.type === 'PROMOTION_ENDED') {
            historyText += `❌ **انتهت ترقية ${roleName}**\n`;
            historyText += `├─ السبب: ${log.data.reason || 'انتهاء المدة'}\n`;
            historyText += `└─ ${timestamp}\n\n`;
        }
    }
    
    // Build active promotions text
    let activeText = '';
    if (userActivePromotes.length > 0) {
        for (const promote of userActivePromotes) {
            const role = await interaction.guild.roles.fetch(promote.roleId).catch(() => null);
            const roleName = role ? role.name : `Role ID: ${promote.roleId}`;
            const endTime = promote.endTime ? 
                `<t:${Math.floor(promote.endTime / 1000)}:R>` : 
                'نهائي';
            
            activeText += `• **${roleName}** - ينتهي: ${endTime}\n`;
        }
    } else {
        activeText = 'لا توجد ترقيات نشطة حالياً';
    }
    
    // Create detailed embed
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    const recordsEmbed = colorManager.createEmbed()
        .setTitle('📋 سجل الترقيات الكامل')
        .setDescription(`**العضو:** ${member.displayName} ${member.user}\n` +
                       `**معرف المستخدم:** \`${selectedUserId}\``)
        .addFields([
            {
                name: '📊 الإحصائيات',
                value: `**إجمالي الترقيات:** ${promotionCount}\n` +
                       `**الترقيات المنتهية:** ${endedCount}\n` +
                       `**الترقيات النشطة:** ${userActivePromotes.length}`,
                inline: true
            },
            {
                name: '⏰ آخر ترقية',
                value: lastPromotion ? 
                    `<t:${Math.floor(lastPromotion.timestamp / 1000)}:R>` : 
                    'لا توجد',
                inline: true
            },
            {
                name: '🎯 الترقيات النشطة حالياً',
                value: activeText,
                inline: false
            },
            {
                name: '📜 السجل الأخير (آخر 10 أحداث)',
                value: historyText || 'لا توجد أحداث',
                inline: false
            }
        ])
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `إجمالي الأحداث: ${userLogs.length}` })
        .setTimestamp();
    
    const backButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('promote_records_back')
            .setLabel('🔙 رجوع للقائمة الرئيسية')
            .setStyle(ButtonStyle.Primary)
    );
    
    await interaction.editReply({
        embeds: [recordsEmbed],
        components: [backButton]
    });
    return;
}

// Handle user selection for ban
if (interaction.customId === 'promote_ban_select_user') {
    const selectedUserId = interaction.values[0];
    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    
    if (!member) {
        return interaction.reply({
            content: '❌ لم يتم العثور على العضو المحدد.',
            ephemeral: true
        });
    }
    
    // Check if already banned
    const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
    const promoteBans = readJson(promoteBansPath, {});
    const banKey = `${selectedUserId}_${interaction.guild.id}`;
    
    if (promoteBans[banKey]) {
        const banData = promoteBans[banKey];
        if (!banData.endTime || banData.endTime > Date.now()) {
            return interaction.reply({
                content: `⚠️ **العضو ${member.displayName} محظور بالفعل من الترقيات!**`,
                ephemeral: true
            });
        }
    }
    
    // Show duration selection
    const { StringSelectMenuBuilder } = require('discord.js');
    const durationSelect = new StringSelectMenuBuilder()
        .setCustomId(`promote_ban_duration_${selectedUserId}`)
        .setPlaceholder('⏱️ اختر مدة الحظر...')
        .addOptions([
            { label: '1 ساعة', value: '1h', description: 'حظر لمدة ساعة واحدة', emoji: '⏰' },
            { label: '6 ساعات', value: '6h', description: 'حظر لمدة 6 ساعات', emoji: '⏰' },
            { label: '12 ساعة', value: '12h', description: 'حظر لمدة 12 ساعة', emoji: '⏰' },
            { label: '1 يوم', value: '1d', description: 'حظر لمدة يوم واحد', emoji: '📅' },
            { label: '3 أيام', value: '3d', description: 'حظر لمدة 3 أيام', emoji: '📅' },
            { label: '1 أسبوع', value: '1w', description: 'حظر لمدة أسبوع', emoji: '📅' },
            { label: '1 شهر', value: '1mo', description: 'حظر لمدة شهر', emoji: '📅' },
            { label: 'نهائي', value: 'permanent', description: 'حظر دائم', emoji: '🔒' }
        ]);
    
    const durationRow = new ActionRowBuilder().addComponents(durationSelect);
    
    const durationEmbed = colorManager.createEmbed()
        .setTitle('⏱️ تحديد مدة الحظر')
        .setDescription(`**العضو المحدد:** ${member.displayName}\n\n` +
                       'اختر مدة حظر العضو من الترقيات:')
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .setColor('#e74c3c');
    
    await interaction.update({
        embeds: [durationEmbed],
        components: [durationRow]
    });
    return;
}

// Handle ban duration selection
if (interaction.customId && interaction.customId.startsWith('promote_ban_duration_')) {
    const userId = interaction.customId.split('_')[3];
    const duration = interaction.values[0];
    
    // Show reason modal
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const reasonModal = new ModalBuilder()
        .setCustomId(`promote_ban_reason_${userId}_${duration}`)
        .setTitle('سبب الحظر');
    
    const reasonInput = new TextInputBuilder()
        .setCustomId('ban_reason')
        .setLabel('ما هو سبب حظر هذا العضو؟')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('اكتب سبباً واضحاً للحظر...')
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(500);
    
    const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
    reasonModal.addComponents(reasonRow);
    
    await interaction.showModal(reasonModal);
    return;
}

// Handle ban reason modal submission
if (interaction.customId && interaction.customId.startsWith('promote_ban_reason_')) {
    const parts = interaction.customId.split('_');
    const userId = parts[3];
    const duration = parts[4];
    const reason = interaction.fields.getTextInputValue('ban_reason');
    
    await interaction.deferReply({ ephemeral: true });
    
    // Apply the ban
    const result = await promoteManager.addPromotionBan(
        interaction.guild,
        context.client,
        userId,
        duration === 'permanent' ? null : duration,
        reason,
        interaction.user.id
    );
    
    if (result.success) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const memberName = member ? member.displayName : `<@${userId}>`;
        const durationText = duration === 'permanent' ? 'نهائي' : duration;
        const endTimeText = result.endTime ? 
            `\n**ينتهي الحظر:** <t:${Math.floor(result.endTime / 1000)}:F>` : 
            '';
        
        const successEmbed = colorManager.createEmbed()
            .setTitle('✅ تم حظر العضو من الترقيات')
            .setDescription(`**تم حظر ${memberName} من الحصول على ترقيات**\n\n` +
                           `**المدة:** ${durationText}\n` +
                           `**السبب:** ${reason}\n` +
                           `**بواسطة:** ${interaction.user}${endTimeText}`)
            .setColor('#2ecc71')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
    } else {
        const errorEmbed = colorManager.createEmbed()
            .setTitle('❌ فشل في حظر العضو')
            .setDescription(`**حدث خطأ:** ${result.error}`)
            .setColor('#e74c3c');
        
        await interaction.editReply({ embeds: [errorEmbed] });
    }
    return;
}

// Handle user selection for unban
if (interaction.customId === 'promote_unban_select_user') {
    const selectedUserId = interaction.values[0];
    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    
    if (!member) {
        return interaction.reply({
            content: '❌ لم يتم العثور على العضو المحدد.',
            ephemeral: true
        });
    }
    
    // Check if actually banned
    const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
    const promoteBans = readJson(promoteBansPath, {});
    const banKey = `${selectedUserId}_${interaction.guild.id}`;
    
    if (!promoteBans[banKey]) {
        return interaction.reply({
            content: `⚠️ **العضو ${member.displayName} غير محظور من الترقيات!**`,
            ephemeral: true
        });
    }
    
    // Show confirmation
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    const confirmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`promote_unban_confirm_${selectedUserId}`)
            .setLabel('✅ تأكيد إلغاء الحظر')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('promote_unban_cancel')
            .setLabel('❌ إلغاء')
            .setStyle(ButtonStyle.Danger)
    );
    
    const banData = promoteBans[banKey];
    const banDuration = banData.duration || 'نهائي';
    const banReason = banData.reason || 'لا يوجد سبب';
    const bannedBy = banData.byUserId ? `<@${banData.byUserId}>` : 'غير معروف';
    const banDate = `<t:${Math.floor(banData.startTime / 1000)}:F>`;
    
    const confirmEmbed = colorManager.createEmbed()
        .setTitle('⚠️ تأكيد إلغاء الحظر')
        .setDescription(`**هل أنت متأكد من إلغاء حظر ${member.displayName}؟**\n\n` +
                       '**معلومات الحظر الحالي:**')
        .addFields([
            { name: 'المدة', value: banDuration, inline: true },
            { name: 'السبب', value: banReason, inline: false },
            { name: 'تم الحظر بواسطة', value: bannedBy, inline: true },
            { name: 'تاريخ الحظر', value: banDate, inline: true }
        ])
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .setColor('#f39c12');
    
    await interaction.update({
        embeds: [confirmEmbed],
        components: [confirmButtons]
    });
    return;
}

// Handle unban confirmation
if (interaction.customId && interaction.customId.startsWith('promote_unban_confirm_')) {
    const userId = interaction.customId.split('_')[3];
    
    await interaction.deferUpdate();
    
    // Remove the ban
    const result = await promoteManager.removePromotionBan(
        interaction.guild,
        context.client,
        userId,
        'تم إلغاء الحظر بواسطة مسؤول',
        interaction.user.id
    );
    
    if (result.success) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const memberName = member ? member.displayName : `<@${userId}>`;
        
        const successEmbed = colorManager.createEmbed()
            .setTitle('✅ تم إلغاء الحظر')
            .setDescription(`**تم إلغاء حظر ${memberName} من الترقيات بنجاح**\n\n` +
                           `**بواسطة:** ${interaction.user}\n` +
                           `**التاريخ:** <t:${Math.floor(Date.now() / 1000)}:F>`)
            .setColor('#2ecc71')
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed], components: [] });
    } else {
        const errorEmbed = colorManager.createEmbed()
            .setTitle('❌ فشل في إلغاء الحظر')
            .setDescription(`**حدث خطأ:** ${result.error}`)
            .setColor('#e74c3c');
        
        await interaction.editReply({ embeds: [errorEmbed], components: [] });
    }
    return;
}

// Handle unban cancel
if (interaction.customId === 'promote_unban_cancel') {
    const cancelEmbed = colorManager.createEmbed()
        .setTitle('❌ تم الإلغاء')
        .setDescription('تم إلغاء عملية إلغاء الحظر.')
        .setColor('#95a5a6');
    
    await interaction.update({ embeds: [cancelEmbed], components: [] });
    return;
}

// Handle user selection for activity check
if (interaction.customId === 'promote_check_activity_user') {
    const selectedUserId = interaction.values[0];
    const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
    
    if (!member) {
        return interaction.reply({
            content: '❌ لم يتم العثور على العضو المحدد.',
            ephemeral: true
        });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    // Get user stats from database
    const { getRealUserStats } = require('../utils/userStatsCollector');
    const stats = await getRealUserStats(selectedUserId);
    
    // Get promotion history
    const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
    const logs = readJson(promoteLogsPath, []);
    const userPromotions = logs.filter(log => 
        log.type === 'PROMOTION_APPLIED' && 
        log.data.targetUserId === selectedUserId
    );
    
    // Get active promotions
    const activePromotesPath = path.join(__dirname, '..', 'data', 'activePromotes.json');
    const activePromotes = readJson(activePromotesPath, {});
    const userActivePromotes = Object.values(activePromotes).filter(p => p.userId === selectedUserId);
    
    // Format voice time
    const voiceHours = Math.floor(stats.voiceTime / 3600000);
    const voiceMinutes = Math.floor((stats.voiceTime % 3600000) / 60000);
    const voiceTimeText = `${voiceHours} ساعة و ${voiceMinutes} دقيقة`;
    
    // Get member join date
    const joinDate = member.joinedTimestamp ? 
        `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 
        'غير معروف';
    
    // Calculate days since join
    const daysSinceJoin = member.joinedTimestamp ? 
        Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24)) : 
        0;
    
    // Build active promotions text
    let activePromotionsText = '';
    if (userActivePromotes.length > 0) {
        for (const promote of userActivePromotes) {
            const role = await interaction.guild.roles.fetch(promote.roleId).catch(() => null);
            const roleName = role ? role.name : `Role ID: ${promote.roleId}`;
            const endTime = promote.endTime ? 
                `<t:${Math.floor(promote.endTime / 1000)}:R>` : 
                'نهائي';
            activePromotionsText += `• **${roleName}** - ينتهي: ${endTime}\n`;
        }
    } else {
        activePromotionsText = 'لا توجد ترقيات نشطة';
    }
    
    // Create detailed activity embed
    const activityEmbed = colorManager.createEmbed()
        .setTitle('📊 تقرير نشاط الإداري')
        .setDescription(`**الإداري:** ${member.displayName} ${member.user}\n` +
                       `**معرف المستخدم:** \`${selectedUserId}\``)
        .addFields([
            {
                name: '👤 معلومات العضوية',
                value: `**تاريخ الانضمام:** ${joinDate}\n` +
                       `**مدة العضوية:** ${daysSinceJoin} يوم\n` +
                       `**الأيام النشطة:** ${stats.activeDays} يوم`,
                inline: false
            },
            {
                name: '📈 إحصائيات التفاعل',
                value: `**💬 الرسائل:** ${stats.messages.toLocaleString()}\n` +
                       `**🎤 الوقت الصوتي:** ${voiceTimeText}\n` +
                       `**🔗 الانضمامات الصوتية:** ${stats.voiceJoins.toLocaleString()}\n` +
                       `**❤️ التفاعلات:** ${stats.reactions.toLocaleString()}`,
                inline: false
            },
            {
                name: '📊 معدلات النشاط',
                value: `**متوسط الرسائل/اليوم:** ${Math.round(stats.messages / Math.max(stats.activeDays, 1))}\n` +
                       `**متوسط الوقت الصوتي/اليوم:** ${Math.round(stats.voiceTime / Math.max(stats.activeDays, 1) / 60000)} دقيقة`,
                inline: false
            },
            {
                name: '🎯 سجل الترقيات',
                value: `**إجمالي الترقيات:** ${userPromotions.length}\n` +
                       `**الترقيات النشطة:** ${userActivePromotes.length}`,
                inline: true
            },
            {
                name: '⏰ آخر ترقية',
                value: userPromotions.length > 0 ? 
                    `<t:${Math.floor(userPromotions[0].timestamp / 1000)}:R>` : 
                    'لا توجد',
                inline: true
            },
            {
                name: '🎯 الترقيات النشطة حالياً',
                value: activePromotionsText,
                inline: false
            }
        ])
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .setColor('#3498db')
        .setFooter({ text: 'تقرير شامل لنشاط الإداري' })
        .setTimestamp();
    
    // Add recommendation
    let recommendation = '';
    const avgMessagesPerDay = Math.round(stats.messages / Math.max(stats.activeDays, 1));
    const avgVoiceMinutesPerDay = Math.round(stats.voiceTime / Math.max(stats.activeDays, 1) / 60000);
    
    if (avgMessagesPerDay >= 50 && avgVoiceMinutesPerDay >= 60) {
        recommendation = '✅ **نشاط ممتاز** - مؤهل بشكل كبير للترقية';
    } else if (avgMessagesPerDay >= 30 && avgVoiceMinutesPerDay >= 30) {
        recommendation = '✅ **نشاط جيد** - مؤهل للترقية';
    } else if (avgMessagesPerDay >= 15 || avgVoiceMinutesPerDay >= 15) {
        recommendation = '⚠️ **نشاط متوسط** - يحتاج لمزيد من التفاعل';
    } else {
        recommendation = '❌ **نشاط ضعيف** - غير مؤهل للترقية حالياً';
    }
    
    activityEmbed.addFields([
        {
            name: '💡 التوصية',
            value: recommendation,
            inline: false
        }
    ]);
    
    // Add action buttons
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    const actionButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`promote_from_activity_${selectedUserId}`)
            .setLabel('⬆️ ترقية هذا العضو')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('promote_check_another')
            .setLabel('🔍 فحص عضو آخر')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('promote_main_menu_back')
            .setLabel('🔙 رجوع')
            .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.editReply({
        embeds: [activityEmbed],
        components: [actionButtons]
    });
    return;
}

// Handle promote from activity check
if (interaction.customId && interaction.customId.startsWith('promote_from_activity_')) {
    const userId = interaction.customId.split('_')[3];
    
    // Show role selection
    const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
    const adminRoles = readJson(adminRolesPath, []);
    
    if (adminRoles.length === 0) {
        return interaction.update({
            content: '⚠️ **لا توجد رولات إدارية محددة! يرجى إضافة رولات إدارية أولاً.**',
            components: []
        });
    }
    
    const { StringSelectMenuBuilder } = require('discord.js');
    const roleOptions = adminRoles.map(roleId => {
        const role = interaction.guild.roles.cache.get(roleId);
        return role ? {
            label: role.name,
            value: roleId,
            description: `ترقية إلى ${role.name}`,
            emoji: '🎯'
        } : null;
    }).filter(Boolean).slice(0, 25);
    
    const roleSelect = new StringSelectMenuBuilder()
        .setCustomId(`promote_select_role_for_${userId}`)
        .setPlaceholder('🎯 اختر الرول الإداري...')
        .addOptions(roleOptions);
    
    const roleRow = new ActionRowBuilder().addComponents(roleSelect);
    
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const memberName = member ? member.displayName : `<@${userId}>`;
    
    const roleEmbed = colorManager.createEmbed()
        .setTitle('🎯 اختيار الرول للترقية')
        .setDescription(`**العضو المحدد:** ${memberName}\n\n` +
                       'اختر الرول الإداري الذي تريد منحه للعضو:')
        .setColor('#3498db');
    
    await interaction.update({
        embeds: [roleEmbed],
        components: [roleRow]
    });
    return;
}

// Handle check another admin
if (interaction.customId === 'promote_check_another') {
    await handleCheckAdminActivity(interaction, context);
    return;
}

// Handle back to main menu
if (interaction.customId === 'promote_main_menu_back' || interaction.customId === 'promote_records_back') {
    // Recreate main menu
    const settings = promoteManager.getSettings();
    
    const adminEmbed = colorManager.createEmbed()
        .setTitle('Promote System Management')
        .setDescription('النظام مُعد ويعمل! يمكنك إدارته من هنا أو استخدام المنيو التفاعلي.')
        .addFields([
            {
                name: 'المنيو التفاعلي',
                value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد',
                inline: true
            },
            {
                name: 'روم السجلات',
                value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد',
                inline: true
            }
        ])
        .setThumbnail(context.client?.user?.displayAvatarURL())
        .setTimestamp();
    
    const { StringSelectMenuBuilder } = require('discord.js');
    const quickActionsSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_quick_actions')
        .setPlaceholder('إجراءات سريعة...')
        .addOptions([
            {
                label: 'إعادة إرسال المنيو التفاعلي',
                value: 'resend_menu',
                description: 'إرسال المنيو التفاعلي مرة أخرى للقناة المحددة'
            },
            {
                label: 'تعديل الإعدادات',
                value: 'edit_settings',
                description: 'تعديل إعدادات النظام (المعتمدين، القنوات)'
            },
            {
                label: 'إحصائيات النظام',
                value: 'system_stats',
                description: 'عرض إحصائيات الترقيات والاستخدام'
            }
        ]);
    
    const actionRow = new ActionRowBuilder().addComponents(quickActionsSelect);
    
    await interaction.update({ embeds: [adminEmbed], components: [actionRow] });
    return;
}
*/

// ==================== تصدير الدوال ====================
// أضف هذه الدوال في module.exports في نهاية الملف:
/*
module.exports = {
    name,
    execute,
    handleInteraction,
    handlePromotionRecords,
    handleBanFromPromotion,
    handleUnbanFromPromotion,
    handleCheckAdminActivity
};
*/