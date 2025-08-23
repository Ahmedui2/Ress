const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { quickLog } = require('../utils/logs_system.js');

const name = 'report';

// Helper function to get the main settings embed
function getSettingsEmbed(client, reportsConfig, responsibilities) {
    const status = reportsConfig.enabled ? '**مفعّل**' : '**معطّل**';
    const pointsStatus = reportsConfig.pointsOnReport ? '**مفعّلة** (بعد التقرير)' : '**معطّلة** (عند الإستلام)';
    let channelStatus = 'لم يحدد';
    if (reportsConfig.reportChannel) {
        channelStatus = reportsConfig.reportChannel === '0' ? 'خاص الأونرات' : `<#${reportsConfig.reportChannel}>`;
    }
    const requiredForCount = Array.isArray(reportsConfig.requiredFor) ? reportsConfig.requiredFor.length : 0;
    const responsibilitiesList = requiredForCount > 0
        ? reportsConfig.requiredFor.map(r => {
            const approvalNeeded = reportsConfig.approvalRequiredFor && reportsConfig.approvalRequiredFor.includes(r) ? ' (🔒 مطلوب موافقة)' : '';
            return `• ${r}${approvalNeeded}`;
          }).join('\n')
        : 'لا يوجد';

    return new EmbedBuilder()
        .setTitle('إعدادات نظام التقارير')
        .setDescription('التحكم بالإعدادات الخاصة بنظام التقارير.')
        .setColor(colorManager.getColor(client))
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
            { name: 'حالة النظام', value: status, inline: true },
            { name: 'حالة النقاط', value: pointsStatus, inline: true },
            { name: 'قناة التقارير', value: channelStatus, inline: true },
            { name: `مسؤوليات تتطلب تقرير (${requiredForCount})`, value: responsibilitiesList.substring(0, 1024), inline: false }
        )
        .setFooter({ text: 'By Ahmed.' });
}

async function sendReportSettings(target, reportsConfig, responsibilities) {
    const embed = getSettingsEmbed(target.client, reportsConfig, responsibilities);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('report_toggle_system').setLabel('تفعيل/تعطيل النظام').setStyle(reportsConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('report_manage_resps').setLabel('إدارة المسؤوليات').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('report_toggle_points').setLabel('تفعيل/تعطيل النقاط').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('report_manage_templates').setLabel('إدارة القوالب').setStyle(ButtonStyle.Primary)
    );
    const payload = { content: '', embeds: [embed], components: [row] };
    try {
        if (target.id && (target.type === 'Message' || typeof target.edit === 'function')) {
            await target.edit(payload);
        } else {
            await target.send(payload);
        }
    } catch (e) { console.error("Failed to send/edit report settings:", e); }
}

async function execute(message, args, context) {
    if (!context.BOT_OWNERS.includes(message.author.id)) {
        return message.react('❌');
    }
    const channel = message.channel;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
    const botMessage = messages.find(m => m.author.id === context.client.user.id && m.embeds[0]?.title === 'إعدادات نظام التقارير');
    await sendReportSettings(botMessage || channel, context.reportsConfig, context.responsibilities);
}

async function handleInteraction(interaction, context) {
    const { client, reportsConfig, responsibilities, scheduleSave, BOT_OWNERS, points } = context;

    // Permission check for settings management
    if (interaction.customId.startsWith('report_') && !interaction.customId.startsWith('report_write_') && !interaction.customId.startsWith('report_submit_') && !interaction.customId.startsWith('report_edit_')) {
        if (!BOT_OWNERS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ **أنت لا تملك صلاحية استخدام هذا الأمر!**', ephemeral: true });
        }
    }

    // Defer non-modal interactions
    if (!interaction.isModalSubmit() && !interaction.customId.startsWith('report_write_') && !interaction.customId.startsWith('report_edit_')) {
         await interaction.deferUpdate();
    }

    const { customId } = interaction;

    // Main Settings
    if (customId === 'report_toggle_system') {
        reportsConfig.enabled = !reportsConfig.enabled;
        scheduleSave();
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
        if (reportsConfig.enabled && !reportsConfig.reportChannel) {
            await interaction.followUp({ content: 'تم تفعيل النظام. يرجى تحديد قناة التقارير الآن. منشن القناة أو اكتب ID الخاص بها. لإرسال التقارير لخاص الأونرات، اكتب `0`.', ephemeral: true });
            const filter = m => m.author.id === interaction.user.id;
            const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            collector.on('collect', async msg => {
                let channelId = msg.content.trim();
                await msg.delete().catch(() => {});
                if (channelId === '0') {
                    reportsConfig.reportChannel = '0';
                    scheduleSave();
                    await sendReportSettings(interaction.message, reportsConfig, responsibilities);
                    await interaction.followUp({ content: '✅ تم تحديد وجهة التقارير إلى خاص الأونرات.', ephemeral: true });
                    return;
                }
                const channelMention = msg.mentions.channels.first();
                if (channelMention) channelId = channelMention.id;
                else if (!/^\d{17,19}$/.test(channelId)) return interaction.followUp({ content: 'لم يتم التعرف على القناة. يرجى منشن القناة أو كتابة الـ ID بشكل صحيح.', ephemeral: true });
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel || channel.type !== ChannelType.GuildText) return interaction.followUp({ content: 'القناة غير موجودة أو ليست قناة نصية.', ephemeral: true });
                reportsConfig.reportChannel = channel.id;
                scheduleSave();
                await sendReportSettings(interaction.message, reportsConfig, responsibilities);
                await interaction.followUp({ content: `✅ تم تحديد قناة التقارير إلى ${channel}.`, ephemeral: true });
            });
        }
    } else if (customId === 'report_toggle_points') {
        reportsConfig.pointsOnReport = !reportsConfig.pointsOnReport;
        scheduleSave();
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_back_to_main') {
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);

    // Responsibility Management
    } else if (customId === 'report_manage_resps') {
        const manageButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_manage_report_req').setLabel('إدارة طلب التقرير').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('report_manage_approval_req').setLabel('إدارة طلب الموافقة').setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر الإجراء الذي تريد القيام به:', embeds: [], components: [manageButtons, backButton] });
    } else if (customId === 'report_manage_report_req' || customId === 'report_manage_approval_req') {
        const isForApproval = customId === 'report_manage_approval_req';
        const targetArray = isForApproval ? (reportsConfig.approvalRequiredFor || []) : (reportsConfig.requiredFor || []);
        const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name, default: targetArray.includes(name) }));
        if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات معرفة حالياً.', ephemeral: true });
        const selectMenu = new StringSelectMenuBuilder().setCustomId(isForApproval ? 'report_select_approval_req' : 'report_select_report_req').setPlaceholder(isForApproval ? 'اختر المسؤوليات التي تتطلب موافقة' : 'اختر المسؤوليات التي تتطلب تقريراً').setMinValues(0).setMaxValues(respOptions.length).addOptions(respOptions);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'حدد المسؤوليات من القائمة أدناه.', embeds: [], components: [row, backButton] });
    } else if (customId === 'report_select_report_req') {
        reportsConfig.requiredFor = interaction.values;
        scheduleSave();
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_select_approval_req') {
        reportsConfig.approvalRequiredFor = interaction.values;
        scheduleSave();
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);

    // Template Management
    } else if (customId === 'report_manage_templates') {
        const templateButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_template_add_single').setLabel('إضافة/تعديل (مسؤولية واحدة)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('report_template_add_multi').setLabel('إضافة/تعديل (عدة مسؤوليات)').setStyle(ButtonStyle.Success),
        );
        const removeButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_template_remove_multi').setLabel('إزالة (عدة مسؤوليات)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('report_template_remove_all').setLabel('إزالة جميع القوالب').setStyle(ButtonStyle.Danger)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر إجراءً لإدارة قوالب التقارير:', embeds: [], components: [templateButtons, removeButtons, backButton] });
    } else if (customId === 'report_template_add_single') {
        const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name }));
        if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات متاحة.', ephemeral: true });
        const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_select_single').setPlaceholder('اختر مسؤولية لإضافة/تعديل قالبها').addOptions(respOptions);
        await interaction.editReply({ content: 'اختر مسؤولية:', components: [new ActionRowBuilder().addComponents(selectMenu)] });
    } else if (customId === 'report_template_select_single') {
        const respName = interaction.values[0];
        const currentTemplate = reportsConfig.templates[respName] || '';
        const modal = new ModalBuilder().setCustomId(`report_template_save_${respName}`).setTitle(`قالب لـ: ${respName}`);
        const templateInput = new TextInputBuilder().setCustomId('template_text').setLabel('نص القالب').setStyle(TextInputStyle.Paragraph).setValue(currentTemplate).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
        await interaction.showModal(modal);
    } else if (customId.startsWith('report_template_save_')) {
        const respName = customId.replace('report_template_save_', '');
        const templateText = interaction.fields.getTextInputValue('template_text');
        if (templateText) { reportsConfig.templates[respName] = templateText; }
        else { delete reportsConfig.templates[respName]; }
        scheduleSave();
        await interaction.followUp({ content: `✅ تم حفظ القالب للمسؤولية: ${respName}`, ephemeral: true });
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_template_add_multi') {
        const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name }));
        if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات متاحة.', ephemeral: true });
        const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_select_multi_add').setPlaceholder('اختر المسؤوليات').setMinValues(1).setMaxValues(respOptions.length).addOptions(respOptions);
        await interaction.editReply({ content: 'اختر المسؤوليات لتطبيق القالب عليها:', components: [new ActionRowBuilder().addComponents(selectMenu)] });
    } else if (customId === 'report_template_select_multi_add') {
        if (!client.tempSelection) client.tempSelection = new Map();
        client.tempSelection.set(interaction.user.id, interaction.values);
        const modal = new ModalBuilder().setCustomId(`report_template_save_multi`).setTitle(`قالب لـ ${interaction.values.length} مسؤولية`);
        const templateInput = new TextInputBuilder().setCustomId('template_text').setLabel('نص القالب').setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
        await interaction.showModal(modal);
    } else if (customId === 'report_template_save_multi') {
        const respNames = client.tempSelection?.get(interaction.user.id);
        if (!respNames || respNames.length === 0) return interaction.followUp({ content: 'حدث خطأ: لم يتم العثور على المسؤوليات المحددة. يرجى المحاولة مرة أخرى.', ephemeral: true });
        const templateText = interaction.fields.getTextInputValue('template_text');
        respNames.forEach(name => { reportsConfig.templates[name] = templateText; });
        scheduleSave();
        client.tempSelection.delete(interaction.user.id);
        await interaction.followUp({ content: `✅ تم تطبيق القالب على ${respNames.length} مسؤولية.`, ephemeral: true });
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_template_remove_multi') {
        const respOptions = Object.keys(reportsConfig.templates || {}).map(name => ({ label: name.substring(0, 100), value: name }));
        if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد قوالب معرفة حالياً.', ephemeral: true });
        const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_select_multi_remove').setPlaceholder('اختر القوالب للإزالة').setMinValues(1).setMaxValues(respOptions.length).addOptions(respOptions);
        await interaction.editReply({ content: 'اختر المسؤوليات لإزالة قوالبها:', components: [new ActionRowBuilder().addComponents(selectMenu)] });
    } else if (customId === 'report_template_select_multi_remove') {
        interaction.values.forEach(name => { delete reportsConfig.templates[name]; });
        scheduleSave();
        await interaction.followUp({ content: `✅ تم إزالة القوالب من ${interaction.values.length} مسؤولية.`, ephemeral: true });
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_template_remove_all') {
        reportsConfig.templates = {};
        scheduleSave();
        await interaction.followUp({ content: '✅ تم إزالة جميع القوالب بنجاح.', ephemeral: true });
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);

    // Report Writing and Submission Flow
    } else if (customId.startsWith('report_write_')) {
        const reportId = customId.replace('report_write_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.update({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] });
        const modal = new ModalBuilder().setCustomId(`report_submit_${reportId}`).setTitle('كتابة تقرير المهمة');
        const template = reportsConfig.templates[reportData.responsibilityName] || '';
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء كتابة تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(template).setRequired(true);
        const roleInput = new TextInputBuilder().setCustomId('given_role_id').setLabel('ID الرول الذي تم منحه (اختياري)').setPlaceholder('اتركه فارغاً إن لم يتم إعطاء رول').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput), new ActionRowBuilder().addComponents(roleInput));
        await interaction.showModal(modal);
    } else if (customId.startsWith('report_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_submit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم تقديمه بالفعل.', embeds: [], components: [] });
        const reportText = interaction.fields.getTextInputValue('report_text');
        const givenRoleId = interaction.fields.getTextInputValue('given_role_id');
        const { responsibilityName, claimerId, timestamp, requesterId } = reportData;
        const { displayName } = reportData;
        const reportEmbed = new EmbedBuilder().setTitle(`تقرير مهمة: ${responsibilityName}`).setColor(colorManager.getColor(client)).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true },{ name: 'التقرير', value: reportText.substring(0, 4000) }).setTimestamp().setFooter({ text: 'By Ahmed.' });
        if (givenRoleId) { let roleText = givenRoleId; try { const role = await interaction.guild.roles.fetch(givenRoleId).catch(() => null) || interaction.guild.roles.cache.find(r => r.name === givenRoleId); if (role) roleText = `<@&${role.id}>`; } catch (e) { console.error("Could not resolve role for report:", e); } reportEmbed.addFields({ name: 'الرول المعطى', value: roleText, inline: false }); }
        const needsApproval = reportsConfig.approvalRequiredFor && reportsConfig.approvalRequiredFor.includes(responsibilityName);
        if (needsApproval) {
            reportData.submittedAt = Date.now(); reportData.reportText = reportText; reportData.givenRoleId = givenRoleId;
            reportEmbed.addFields({ name: 'الحالة', value: 'بانتظار موافقة الأونر' });
            const approvalButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`report_approve_${reportId}`).setLabel('موافقة').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`report_reject_${reportId}`).setLabel('رفض').setStyle(ButtonStyle.Danger));
            const approvalMessageContent = { embeds: [reportEmbed], components: [approvalButtons], fetchReply: true };
            reportData.approvalMessageIds = {};
            if (reportsConfig.reportChannel === '0') { for (const ownerId of BOT_OWNERS) { try { const owner = await client.users.fetch(ownerId); const msg = await owner.send(approvalMessageContent); reportData.approvalMessageIds[owner.dmChannel.id] = msg.id; } catch(e) { console.error(e); } }
            } else { try { const channel = await client.channels.fetch(reportsConfig.reportChannel); const msg = await channel.send(approvalMessageContent); reportData.approvalMessageIds[channel.id] = msg.id; } catch(e) { console.error(e); } }
            const pendingEmbed = new EmbedBuilder().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك للمراجعة من قبل الإدارة. سيتم إعلامك بالنتيجة.**').setColor(colorManager.getColor(client));
            const editButton = new ButtonBuilder().setCustomId(`report_edit_${reportId}`).setLabel('تعديل التقرير').setStyle(ButtonStyle.Secondary);
            const confirmationRow = new ActionRowBuilder().addComponents(editButton);
            const confirmationMessage = await interaction.editReply({ embeds: [pendingEmbed], components: [confirmationRow], fetchReply: true });
            reportData.confirmationMessageId = confirmationMessage.id; reportData.confirmationChannelId = confirmationMessage.channel.id;
            client.pendingReports.set(reportId, reportData); scheduleSave();
            setTimeout(async () => { try { const currentMessage = await confirmationMessage.channel.messages.fetch(confirmationMessage.id); if (currentMessage.components.length > 0) { const finalEmbed = new EmbedBuilder().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك للمراجعة. انتهت فترة التعديل.**').setColor(colorManager.getColor(client)); await confirmationMessage.edit({ embeds: [finalEmbed], components: [] }); } } catch(e) {} }, 5 * 60 * 1000);
        } else {
            if (reportsConfig.pointsOnReport) { if (!points[responsibilityName]) points[responsibilityName] = {}; if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {}; if (typeof points[responsibilityName][claimerId] === 'number') { const oldPoints = points[responsibilityName][claimerId]; points[responsibilityName][claimerId] = { [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints }; } if (!points[responsibilityName][claimerId][timestamp]) { points[responsibilityName][claimerId][timestamp] = 0; } points[responsibilityName][claimerId][timestamp] += 1; scheduleSave(); }
            if (reportsConfig.reportChannel === '0') { for (const ownerId of BOT_OWNERS) { try { await client.users.send(ownerId, { embeds: [reportEmbed] }); } catch (e) { console.error(e); } }
            } else { try { const channel = await client.channels.fetch(reportsConfig.reportChannel); await channel.send({ embeds: [reportEmbed] }); } catch(e) { console.error(e); } }
            quickLog.reportSubmitted(client, interaction.guild, interaction.user, requesterId, responsibilityName);
            const finalEmbed = new EmbedBuilder().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك بنجاح ✅**').setColor(colorManager.getColor(client));
            const editButton = new ButtonBuilder().setCustomId(`report_edit_${reportId}`).setLabel('تعديل التقرير').setStyle(ButtonStyle.Secondary);
            const confirmationRow = new ActionRowBuilder().addComponents(editButton);
            const confirmationMessage = await interaction.editReply({ embeds: [finalEmbed], components: [confirmationRow], fetchReply: true });
            setTimeout(() => { client.pendingReports.delete(reportId); scheduleSave(); }, 5 * 60 * 1000 + 2000);
            setTimeout(async () => { try { const currentMessage = await confirmationMessage.channel.messages.fetch(confirmationMessage.id); if (currentMessage.components.length > 0) { const expiredEmbed = new EmbedBuilder().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك بنجاح. انتهت فترة التعديل.**').setColor(colorManager.getColor(client)); await confirmationMessage.edit({ embeds: [expiredEmbed], components: [] }); } } catch(e) {} }, 5 * 60 * 1000);
        }
    } else if (customId.startsWith('report_edit_')) {
        const reportId = customId.replace('report_edit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.update({ content: 'لم يعد هذا التقرير صالحاً للتعديل.', embeds: [], components: [] });
        const modal = new ModalBuilder().setCustomId(`report_edit_submit_${reportId}`).setTitle('تعديل تقرير المهمة');
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء تعديل تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(reportData.reportText || '').setRequired(true);
        const roleInput = new TextInputBuilder().setCustomId('given_role_id').setLabel('ID الرول الذي تم منحه (اختياري)').setPlaceholder('اتركه فارغاً إن لم يتم إعطاء رول').setValue(reportData.givenRoleId || '').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput), new ActionRowBuilder().addComponents(roleInput));
        await interaction.showModal(modal);
    } else if (customId.startsWith('report_edit_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_edit_submit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.followUp({ content: 'لم يعد هذا التقرير صالحاً للتعديل.', ephemeral: true });
        const newReportText = interaction.fields.getTextInputValue('report_text');
        const newGivenRoleId = interaction.fields.getTextInputValue('given_role_id');
        reportData.reportText = newReportText; reportData.givenRoleId = newGivenRoleId;
        client.pendingReports.set(reportId, reportData); scheduleSave();
        if (reportData.approvalMessageIds) {
            const { displayName, responsibilityName, claimerId, requesterId } = reportData;
            const newReportEmbed = new EmbedBuilder().setTitle(`تقرير مهمة: ${responsibilityName}`).setColor(colorManager.getColor(client)).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true },{ name: 'التقرير', value: newReportText.substring(0, 4000) },{ name: 'الحالة', value: 'بانتظار موافقة الأونر' }).setTimestamp().setFooter({ text: 'By Ahmed. (تم التعديل)' });
            if (newGivenRoleId) { let roleText = newGivenRoleId; try { const role = await interaction.guild.roles.fetch(newGivenRoleId).catch(() => null) || interaction.guild.roles.cache.find(r => r.name === newGivenRoleId); if (role) roleText = `<@&${role.id}>`; } catch (e) {} newReportEmbed.addFields({ name: 'الرول المعطى', value: roleText, inline: false }); }
            for (const [channelId, messageId] of Object.entries(reportData.approvalMessageIds)) { try { const channel = await client.channels.fetch(channelId); const message = await channel.messages.fetch(messageId); await message.edit({ embeds: [newReportEmbed] }); } catch (e) { console.error(`Could not edit report message ${messageId} after edit:`, e); } }
        }
        await interaction.followUp({ content: '✅ تم تعديل تقريرك بنجاح.', ephemeral: true });
    } else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
        await interaction.deferUpdate();
        const isApproval = customId.startsWith('report_approve_');
        const reportId = customId.replace(isApproval ? 'report_approve_' : 'report_reject_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم التعامل معه بالفعل.', embeds: [], components: [] });
        const { claimerId, responsibilityName, timestamp } = reportData;
        if (isApproval) {
            if (!points[responsibilityName]) points[responsibilityName] = {}; if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {}; if (typeof points[responsibilityName][claimerId] === 'number') { const oldPoints = points[responsibilityName][claimerId]; points[responsibilityName][claimerId] = { [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints }; } if (!points[responsibilityName][claimerId][timestamp]) { points[responsibilityName][claimerId][timestamp] = 0; } points[responsibilityName][claimerId][timestamp] += 1; scheduleSave();
        }
        const originalEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed).setFields(...originalEmbed.fields.filter(f => f.name !== 'الحالة'),{ name: 'الحالة', value: isApproval ? `✅ تم القبول بواسطة <@${interaction.user.id}>` : `❌ تم الرفض بواسطة <@${interaction.user.id}>` });
        if (isApproval) { newEmbed.addFields({ name: 'النقطة', value: `تمت إضافة نقطة إلى <@${claimerId}>` }); }
        await interaction.editReply({ embeds: [newEmbed], components: [] });
        try { const channel = await client.channels.fetch(reportData.confirmationChannelId); const message = await channel.messages.fetch(reportData.confirmationMessageId); const statusText = isApproval ? 'الموافقة على' : 'رفض'; const finalEmbed = new EmbedBuilder().setTitle(`تم ${statusText} تقريرك`).setDescription(`لقد تم **${statusText}** تقريرك لمسؤولية **${responsibilityName}** من قبل الإدارة.`).setColor(isApproval ? '#00ff00' : '#ff0000'); await message.edit({ embeds: [finalEmbed], components: [] });
        } catch(e) { console.error("Could not edit user's confirmation message:", e); }
        const otherOwners = BOT_OWNERS.filter(id => id !== interaction.user.id);
        for (const ownerId of otherOwners) { try { const owner = await client.users.fetch(ownerId); await owner.send(`قام <@${interaction.user.id}> بالتعامل مع تقرير مقدم من <@${claimerId}> للمسؤولية **${responsibilityName}**.`); } catch(e) { console.error(e); } }
        client.pendingReports.delete(reportId); scheduleSave();
    }
}

module.exports = { name, execute, handleInteraction };
