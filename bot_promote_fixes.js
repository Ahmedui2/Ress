// إضافة هذا الكود في bot.js بعد السطر 1819 (بعد معالج سجلات الترقيات)

// Handle promotion ban/unban interactions
if (interaction.customId && (
    interaction.customId.startsWith('promote_ban_') ||
    interaction.customId.startsWith('promote_unban_') ||
    interaction.customId === 'ban_from_promotion' ||
    interaction.customId === 'unban_promotion' ||
    interaction.customId === 'promote_ban_select_user' ||
    interaction.customId === 'promote_unban_select_user' ||
    interaction.customId.startsWith('promote_ban_duration_') ||
    interaction.customId.startsWith('promote_ban_reason_') ||
    interaction.customId.startsWith('promote_unban_confirm_') ||
    interaction.customId === 'promote_unban_cancel'
)) {
    console.log(`معالجة تفاعل حظر/إلغاء حظر الترقيات: ${interaction.customId}`);
    
    try {
        const promoteContext = { client, BOT_OWNERS };
        const promoteCommand = client.commands.get('promote');
        
        if (promoteCommand && promoteCommand.handleInteraction) {
            await promoteCommand.handleInteraction(interaction, promoteContext);
        } else {
            await promoteManager.handleInteraction(interaction, promoteContext);
        }
    } catch (error) {
        console.error('خطأ في معالجة حظر/إلغاء حظر الترقيات:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ في معالجة طلب الحظر/إلغاء الحظر.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على خطأ الحظر:', replyError);
        }
    }
    return;
}

// Handle check admin activity interactions
if (interaction.customId && (
    interaction.customId === 'check_admin_activity' ||
    interaction.customId.startsWith('admin_activity_') ||
    interaction.customId === 'promote_check_activity_user' ||
    interaction.customId.startsWith('promote_from_activity_') ||
    interaction.customId === 'promote_check_another' ||
    interaction.customId === 'promote_main_menu_back' ||
    interaction.customId.startsWith('promote_select_role_for_')
)) {
    console.log(`معالجة تفاعل فحص نشاط الإدارة: ${interaction.customId}`);
    
    try {
        const promoteContext = { client, BOT_OWNERS };
        const promoteCommand = client.commands.get('promote');
        
        if (promoteCommand && promoteCommand.handleInteraction) {
            await promoteCommand.handleInteraction(interaction, promoteContext);
        } else {
            await promoteManager.handleInteraction(interaction, promoteContext);
        }
    } catch (error) {
        console.error('خطأ في معالجة فحص نشاط الإدارة:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ في معالجة طلب فحص النشاط.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على خطأ فحص النشاط:', replyError);
        }
    }
    return;
}

// Handle promotion records user selection
if (interaction.customId === 'promote_records_select_user') {
    console.log(`معالجة تفاعل اختيار مستخدم لسجلات الترقيات`);
    
    try {
        const promoteContext = { client, BOT_OWNERS };
        const promoteCommand = client.commands.get('promote');
        
        if (promoteCommand && promoteCommand.handleInteraction) {
            await promoteCommand.handleInteraction(interaction, promoteContext);
        } else {
            await promoteManager.handleInteraction(interaction, promoteContext);
        }
    } catch (error) {
        console.error('خطأ في معالجة سجلات الترقيات:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ في معالجة سجلات الترقيات.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على خطأ سجلات الترقيات:', replyError);
        }
    }
    return;
}