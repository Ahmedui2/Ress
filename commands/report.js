const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const fs = require('fs');
const path = require('path');

const name = 'report';
const reportsPath = path.join(__dirname, '..', 'data', 'reports.json');

// --- Data Handling Functions ---
function loadReportsConfig() {
    try {
        if (fs.existsSync(reportsPath)) {
            const data = fs.readFileSync(reportsPath, 'utf8');
            const config = JSON.parse(data);
            return {
                enabled: config.enabled || false,
                pointsOnReport: config.pointsOnReport || false,
                reportChannel: config.reportChannel || null,
                requiredFor: config.requiredFor || [],
                approvalRequiredFor: config.approvalRequiredFor || [],
                templates: config.templates || {}
            };
        }
        return { enabled: false, pointsOnReport: false, reportChannel: null, requiredFor: [], approvalRequiredFor: [], templates: {} };
    } catch (error) {
        console.error('Error reading reports.json:', error);
        return { enabled: false, pointsOnReport: false, reportChannel: null, requiredFor: [], approvalRequiredFor: [], templates: {} };
    }
}

function saveReportsConfig(config) {
    try {
        fs.writeFileSync(reportsPath, JSON.stringify(config, null, 2));
        logEvent(null, null, { type: 'BOT_SETTINGS', title: 'Report Settings Updated', description: 'Report settings have been saved.' });
        return true;
    } catch (error) {
        console.error('Error writing to reports.json:', error);
        return false;
    }
}

// --- Helper Functions ---
function createMainEmbed(client) {
    const config = loadReportsConfig();
    const status = config.enabled ? '**🟢 مفعل**' : '**🔴 معطل**';
    const pointsStatus = config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة';
    let channelStatus = 'لم يحدد';
    if (config.reportChannel) {
        channelStatus = config.reportChannel === '0' ? 'خاص الأونرات' : `<#${config.reportChannel}>`;
    }

    return colorManager.createEmbed()
        .setTitle('⚙️ إعدادات نظام التقارير')
        .setDescription('التحكم الكامل بإعدادات نظام التقارير والموافقة عليها.')
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&')
        .addFields(
            { name: 'حالة النظام', value: status, inline: true },
            { name: 'حالة النقاط', value: `*${pointsStatus}*`, inline: true },
            { name: 'قناة التقارير', value: channelStatus, inline: true }
        )
        .setFooter({ text: 'By Ahmed.' });
}

function createMainButtons() {
    const config = loadReportsConfig();
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('report_toggle_system').setLabel(config.enabled ? 'تعطيل النظام' : 'تفعيل النظام').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('report_manage_resps').setLabel('إدارة المسؤوليات').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('report_manage_templates').setLabel('إدارة القوالب').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('report_advanced_settings').setLabel('إعدادات متقدمة').setStyle(ButtonStyle.Secondary)
    );
}

// --- Command Execution ---
async function execute(message, args, { client, BOT_OWNERS }) {
    if (!BOT_OWNERS.includes(message.author.id)) {
        return message.react('❌');
    }

    const embed = createMainEmbed(client);
    const buttons = createMainButtons();

    await message.channel.send({ embeds: [embed], components: [buttons] });
}

// --- Interaction Handling ---
async function handleInteraction(interaction, context) {
    const { client, responsibilities, scheduleSave, BOT_OWNERS, points } = context;

    if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.reply({ content: '❌ أنت لا تملك صلاحية استخدام هذا الأمر!', ephemeral: true });
    }

    const { customId } = interaction;

    // Main menu navigation
    if (customId === 'report_toggle_system') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        config.enabled = !config.enabled;
        saveReportsConfig(config);
        const newEmbed = createMainEmbed(client);
        const newButtons = createMainButtons();
        await interaction.editReply({ embeds: [newEmbed], components: [newButtons] });
    } else if (customId === 'report_back_to_main') {
        await interaction.deferUpdate();
        const embed = createMainEmbed(client);
        const buttons = createMainButtons();
        await interaction.editReply({ content: '', embeds: [embed], components: [buttons] });
    }

    // --- Responsibility Management ---
    else if (customId === 'report_manage_resps') {
        await interaction.deferUpdate();
        const respButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر الإجراء المطلوب للمسؤوليات:', embeds: [], components: [respButtons, backButton] });
    }

    else if (customId === 'report_select_req_report' || customId === 'report_select_req_approval') {
        await interaction.deferUpdate();
        const isApproval = customId === 'report_select_req_approval';
        const config = loadReportsConfig();
        const targetArray = isApproval ? config.approvalRequiredFor : config.requiredFor;
        const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name, default: targetArray.includes(name) }));
        if (respOptions.length === 0) {
            return interaction.followUp({ content: 'لا توجد مسؤوليات معرفة حالياً.', ephemeral: true });
        }
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(isApproval ? 'report_confirm_req_approval' : 'report_confirm_req_report')
            .setPlaceholder(isApproval ? 'اختر المسؤوليات التي تتطلب موافقة' : 'اختر المسؤوليات التي تتطلب تقريراً')
            .setMinValues(0).setMaxValues(respOptions.length).addOptions(respOptions);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_resps').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'حدد المسؤوليات من القائمة أدناه.', embeds: [], components: [row, backButton] });
    }

    else if (customId === 'report_confirm_req_report') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        config.requiredFor = interaction.values;
        saveReportsConfig(config);
        const respButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: '✅ تم حفظ التغييرات. اختر الإجراء المطلوب للمسؤوليات:', embeds: [], components: [respButtons, backButton] });
    }

    else if (customId === 'report_confirm_req_approval') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        config.approvalRequiredFor = interaction.values;
        saveReportsConfig(config);
        const respButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: '✅ تم حفظ التغييرات. اختر الإجراء المطلوب للمسؤوليات:', embeds: [], components: [respButtons, backButton] });
    }

    // --- Advanced Settings ---
    else if (customId === 'report_advanced_settings') {
        await interaction.deferUpdate();
        const advancedButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_set_channel').setLabel('تحديد قناة التقارير').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('report_toggle_points').setLabel('تغيير نظام النقاط').setStyle(ButtonStyle.Success)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر من الإعدادات المتقدمة:', embeds: [], components: [advancedButtons, backButton] });
    }

    else if (customId === 'report_set_channel') {
        await interaction.reply({ content: 'يرجى منشن القناة أو كتابة ID الخاص بها. لإرسال التقارير لخاص الأونرات، اكتب `0`.', ephemeral: true });
        const filter = m => m.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
        collector.on('collect', async msg => {
            await msg.delete().catch(() => {});
            let channelId = msg.content.trim();
            const config = loadReportsConfig();
            if (channelId === '0') {
                config.reportChannel = '0';
                saveReportsConfig(config);
                await interaction.followUp({ content: '✅ تم تحديد وجهة التقارير إلى خاص الأونرات.', ephemeral: true });
            } else {
                const channelMention = msg.mentions.channels.first();
                if (channelMention) channelId = channelMention.id;
                if (!/^\d{17,19}$/.test(channelId)) return interaction.followUp({ content: 'لم يتم التعرف على القناة.', ephemeral: true });
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel || channel.type !== ChannelType.GuildText) return interaction.followUp({ content: 'القناة غير موجودة أو ليست قناة نصية.', ephemeral: true });
                config.reportChannel = channel.id;
                saveReportsConfig(config);
                await interaction.followUp({ content: `✅ تم تحديد قناة التقارير إلى ${channel}.`, ephemeral: true });
            }
            const newEmbed = createMainEmbed(client);
            const newButtons = createMainButtons();
            await interaction.message.edit({ embeds: [newEmbed], components: [newButtons] });
        });
    }

    else if (customId === 'report_toggle_points') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        config.pointsOnReport = !config.pointsOnReport;
        saveReportsConfig(config);
        const newEmbed = createMainEmbed(client);
        const newButtons = createMainButtons();
        await interaction.message.edit({ embeds: [newEmbed], components: [newButtons] });
        await interaction.followUp({ content: `✅ تم تغيير نظام النقاط. النقاط الآن تُمنح: **${config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة'}**`, ephemeral: true });
    }

    // --- Template Management ---
    else if (customId === 'report_manage_templates') {
        await interaction.deferUpdate();
        const templateButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_template_add').setLabel('إضافة/تعديل (فردي)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('report_template_remove').setLabel('إزالة (فردي)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('report_template_bulk').setLabel('تعديل جماعي').setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر إجراءً لإدارة قوالب التقارير:', embeds: [], components: [templateButtons, backButton] });
    }

    else if (customId === 'report_template_add') {
        await interaction.deferUpdate();
        const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name }));
        if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات متاحة.', ephemeral: true });
        const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_select_resp_for_add').setPlaceholder('اختر مسؤولية لإضافة/تعديل قالبها').addOptions(respOptions);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر مسؤولية:', components: [new ActionRowBuilder().addComponents(selectMenu), backButton] });
    }

    else if (customId === 'report_template_select_resp_for_add') {
        const respName = interaction.values[0];
        const config = loadReportsConfig();
        const currentTemplate = config.templates[respName] || '';
        const modal = new ModalBuilder().setCustomId(`report_template_save_modal_${respName}`).setTitle(`قالب لـ: ${respName}`);
        const templateInput = new TextInputBuilder().setCustomId('template_text').setLabel('نص القالب (اتركه فارغاً للحذف)').setStyle(TextInputStyle.Paragraph).setValue(currentTemplate).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
        await interaction.showModal(modal);
    }

    else if (customId.startsWith('report_template_save_modal_')) {
        await interaction.deferUpdate();
        const respName = customId.replace('report_template_save_modal_', '');
        const templateText = interaction.fields.getTextInputValue('template_text');
        const config = loadReportsConfig();
        if (templateText) { config.templates[respName] = templateText; }
        else { delete config.templates[respName]; }
        saveReportsConfig(config);
        await interaction.followUp({ content: `✅ تم حفظ القالب للمسؤولية: ${respName}`, ephemeral: true });
        const embed = createMainEmbed(client);
        const buttons = createMainButtons();
        await interaction.message.edit({ content: '', embeds: [embed], components: [buttons] });
    }

    else if (customId === 'report_template_remove') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        const templateOptions = Object.keys(config.templates).map(name => ({ label: name.substring(0, 100), value: name }));
        if (templateOptions.length === 0) { return interaction.followUp({ content: 'لا توجد قوالب معرفة حالياً.', ephemeral: true }); }
        const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_confirm_remove').setPlaceholder('اختر القوالب للإزالة').setMinValues(1).setMaxValues(templateOptions.length).addOptions(templateOptions);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر المسؤوليات لإزالة قوالبها:', components: [row, backButton] });
    }

    else if (customId === 'report_template_confirm_remove') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        interaction.values.forEach(name => { delete config.templates[name]; });
        saveReportsConfig(config);
        await interaction.followUp({ content: `✅ تم إزالة القوالب المحددة بنجاح.`, ephemeral: true });
        const templateButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_template_add').setLabel('إضافة/تعديل قالب').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('report_template_remove').setLabel('إزالة قالب').setStyle(ButtonStyle.Danger)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.message.edit({ content: 'اختر إجراءً لإدارة قوالب التقارير:', embeds: [], components: [templateButtons, backButton] });
    }

    // --- Bulk Template Management ---
    else if (customId === 'report_template_bulk') {
        await interaction.deferUpdate();
        const bulkButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_template_apply_all').setLabel('تطبيق قالب مخصص للكل').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('report_template_apply_default').setLabel('تطبيق قالب افتراضي').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('report_template_delete_all').setLabel('حذف جميع القوالب').setStyle(ButtonStyle.Danger)
        );
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ content: 'اختر إجراءً جماعيًا للقوالب:', embeds: [], components: [bulkButtons, backButton] });
    }

    else if (customId === 'report_template_apply_all') {
        const modal = new ModalBuilder().setCustomId('report_template_apply_all_modal').setTitle('تطبيق قالب على كل المسؤوليات');
        const templateInput = new TextInputBuilder().setCustomId('template_text_all').setLabel('نص القالب').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('اكتب هنا القالب الذي سيتم تطبيقه على الجميع...');
        modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
        await interaction.showModal(modal);
    }

    else if (customId === 'report_template_apply_all_modal') {
        await interaction.deferUpdate();
        const templateText = interaction.fields.getTextInputValue('template_text_all');
        const config = loadReportsConfig();
        for (const respName in responsibilities) { config.templates[respName] = templateText; }
        saveReportsConfig(config);
        await interaction.followUp({ content: `✅ تم تطبيق القالب بنجاح على جميع المسؤوليات.`, ephemeral: true });
        const embed = createMainEmbed(client);
        const buttons = createMainButtons();
        await interaction.message.edit({ content: '', embeds: [embed], components: [buttons] });
    }

    else if (customId === 'report_template_delete_all') {
        await interaction.deferUpdate();
        const config = loadReportsConfig();
        config.templates = {};
        saveReportsConfig(config);
        await interaction.followUp({ content: '✅ تم حذف جميع القوالب بنجاح.', ephemeral: true });
        const embed = createMainEmbed(client);
        const buttons = createMainButtons();
        await interaction.message.edit({ content: '', embeds: [embed], components: [buttons] });
    }

    else if (customId === 'report_template_apply_default') {
        await interaction.deferUpdate();
        const defaultConfig = `**- ملخص الإنجاز:**\n\n\n**- هل تمت مواجهة مشاكل؟:**\n\n\n**- ملاحظات إضافية:**`;
        const config = loadReportsConfig();
        for (const respName in responsibilities) { config.templates[respName] = defaultConfig; }
        saveReportsConfig(config);
        await interaction.followUp({ content: `✅ تم تطبيق القالب الافتراضي بنجاح على جميع المسؤوليات.`, ephemeral: true });
        const embed = createMainEmbed(client);
        const buttons = createMainButtons();
        await interaction.message.edit({ content: '', embeds: [embed], components: [buttons] });
    }

    // --- Report Submission Flow ---
    else if (customId.startsWith('report_write_')) {
        const reportId = customId.replace('report_write_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) {
            await interaction.deferUpdate();
            return interaction.editReply({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] });
        }
        const config = loadReportsConfig();
        const modal = new ModalBuilder().setCustomId(`report_submit_${reportId}`).setTitle('كتابة تقرير المهمة');
        const template = config.templates[reportData.responsibilityName] || '';
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء كتابة تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(template).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
        await interaction.showModal(modal);
    }

    else if (customId.startsWith('report_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_submit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً.', embeds: [], components: [] });
        const reportText = interaction.fields.getTextInputValue('report_text');
        const { responsibilityName, claimerId, timestamp, requesterId, displayName, reason } = reportData;
        const config = loadReportsConfig();
        const reportEmbed = colorManager.createEmbed().setTitle(`تقرير مهمة: ${responsibilityName}`).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true }, { name: 'السبب الأصلي للطلب', value: reason || 'غير محدد' },{ name: 'التقرير', value: reportText.substring(0, 4000) }).setTimestamp().setFooter({ text: 'By Ahmed.' });
        const needsApproval = config.approvalRequiredFor && config.approvalRequiredFor.includes(responsibilityName);
        if (needsApproval) {
            reportData.submittedAt = Date.now();
            reportData.reportText = reportText;
            reportData.status = 'pending_approval';
            reportEmbed.addFields({ name: 'الحالة', value: '⏳ بانتظار موافقة الأونر' });

            // Save the report with its status before showing the edit button to prevent race conditions
            client.pendingReports.set(reportId, reportData);
            scheduleSave(true); // Force immediate save

            const approvalButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`report_approve_${reportId}`).setLabel('موافقة').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`report_reject_${reportId}`).setLabel('رفض').setStyle(ButtonStyle.Danger));
            const approvalMessageContent = { embeds: [reportEmbed], components: [approvalButtons], fetchReply: true };
            reportData.approvalMessageIds = {};
            if (config.reportChannel === '0') { for (const ownerId of BOT_OWNERS) { try { const owner = await client.users.fetch(ownerId); const msg = await owner.send(approvalMessageContent); reportData.approvalMessageIds[owner.dmChannel.id] = msg.id; } catch(e) { console.error(e); } }
            } else { try { const channel = await client.channels.fetch(config.reportChannel); const msg = await channel.send(approvalMessageContent); reportData.approvalMessageIds[channel.id] = msg.id; } catch(e) { console.error(e); } }
            const pendingEmbed = colorManager.createEmbed().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك للمراجعة. سيتم إعلامك بالنتيجة.**');
            const editButton = new ButtonBuilder().setCustomId(`report_edit_${reportId}`).setLabel('تعديل التقرير').setStyle(ButtonStyle.Secondary);
            const confirmationRow = new ActionRowBuilder().addComponents(editButton);
            const confirmationMessage = await interaction.editReply({ embeds: [pendingEmbed], components: [confirmationRow], fetchReply: true });

            // Now update the report data with the confirmation message IDs and save again
            const freshReportData = client.pendingReports.get(reportId) || reportData;
            freshReportData.confirmationMessageId = confirmationMessage.id;
            freshReportData.confirmationChannelId = confirmationMessage.channel.id;
            client.pendingReports.set(reportId, freshReportData);
            scheduleSave(true); // Force immediate save for message IDs as well
            setTimeout(async () => { try { const currentMessage = await confirmationMessage.channel.messages.fetch(confirmationMessage.id); if (currentMessage.components.length > 0) { const finalEmbed = colorManager.createEmbed().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك للمراجعة. انتهت فترة التعديل.**'); await confirmationMessage.edit({ embeds: [finalEmbed], components: [] }); } } catch(e) {} }, 5 * 60 * 1000);
        } else {
            if (config.pointsOnReport) { if (!points[responsibilityName]) points[responsibilityName] = {}; if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = { [timestamp]: 1 }; else { points[responsibilityName][claimerId][timestamp] = (points[responsibilityName][claimerId][timestamp] || 0) + 1; } scheduleSave(); }
            if (config.reportChannel === '0') { for (const ownerId of BOT_OWNERS) { try { await client.users.send(ownerId, { embeds: [reportEmbed] }); } catch (e) { console.error(e); } }
            } else { try { const channel = await client.channels.fetch(config.reportChannel); await channel.send({ embeds: [reportEmbed] }); } catch(e) { console.error(e); } }
            const finalEmbed = colorManager.createEmbed().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك بنجاح ✅**');
            await interaction.editReply({ embeds: [finalEmbed], components: [] });
            client.pendingReports.delete(reportId);
            scheduleSave();
        }
    }

    else if (customId.startsWith('report_edit_')) {
        const reportId = customId.replace('report_edit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData || reportData.status !== 'pending_approval') { await interaction.deferUpdate(); return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً للتعديل.', embeds: [], components: [] }); }
        const modal = new ModalBuilder().setCustomId(`report_edit_submit_${reportId}`).setTitle('تعديل تقرير المهمة');
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء تعديل تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(reportData.reportText || '').setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
        await interaction.showModal(modal);
    }

    else if (customId.startsWith('report_edit_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_edit_submit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData || reportData.status !== 'pending_approval') return interaction.followUp({ content: 'لم يعد هذا التقرير صالحاً للتعديل.', ephemeral: true });
        const newReportText = interaction.fields.getTextInputValue('report_text');
        reportData.reportText = newReportText;
        client.pendingReports.set(reportId, reportData);
        scheduleSave();
        if (reportData.approvalMessageIds) {
            const { displayName, responsibilityName, claimerId, requesterId } = reportData;
            const newReportEmbed = colorManager.createEmbed().setTitle(`تقرير مهمة: ${responsibilityName}`).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true },{ name: 'التقرير', value: newReportText.substring(0, 4000) },{ name: 'الحالة', value: '⏳ بانتظار موافقة الأونر' }).setTimestamp().setFooter({ text: 'By Ahmed. (تم التعديل)' });
            for (const [channelId, messageId] of Object.entries(reportData.approvalMessageIds)) { try { const channel = await client.channels.fetch(channelId); const message = await channel.messages.fetch(messageId); await message.edit({ embeds: [newReportEmbed] }); } catch (e) { console.error(`Could not edit report message ${messageId} after edit:`, e); } }
        }
        await interaction.followUp({ content: '✅ تم تعديل تقريرك بنجاح.', ephemeral: true });
    }

    else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
        await interaction.deferUpdate();
        const isApproval = customId.startsWith('report_approve_');
        const reportId = customId.replace(isApproval ? 'report_approve_' : 'report_reject_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData || reportData.status !== 'pending_approval') return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم التعامل معه بالفعل.', embeds: [], components: [] });
        const { claimerId, responsibilityName, timestamp } = reportData;
        const config = loadReportsConfig();
        if (isApproval && config.pointsOnReport) { if (!points[responsibilityName]) points[responsibilityName] = {}; if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = { [timestamp]: 1 }; else { points[responsibilityName][claimerId][timestamp] = (points[responsibilityName][claimerId][timestamp] || 0) + 1; } scheduleSave(); }
        const originalEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed).setFields(...originalEmbed.fields.filter(f => f.name !== 'الحالة'),{ name: 'الحالة', value: isApproval ? `✅ تم القبول بواسطة <@${interaction.user.id}>` : `❌ تم الرفض بواسطة <@${interaction.user.id}>` });
        if (isApproval) { newEmbed.addFields({ name: 'النقطة', value: `تمت إضافة نقطة إلى <@${claimerId}>` }); }
        await interaction.editReply({ embeds: [newEmbed], components: [] });
        try {
            const user = await client.users.fetch(claimerId);
            const statusText = isApproval ? 'الموافقة على' : 'رفض';
            const color = isApproval ? '#00ff00' : '#ff0000';
            const detailedEmbed = new EmbedBuilder()
                .setTitle(`تم ${statusText} تقريرك`)
                .setColor(color)
                .addFields(
                    { name: 'المسؤولية', value: responsibilityName, inline: true },
                    { name: `تم ${statusText} بواسطة`, value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'السبب الأصلي للطلب', value: reportData.reason || 'غير محدد' },
                    { name: 'التقرير الذي قدمته', value: reportData.reportText }
                )
                .setTimestamp();
            await user.send({ embeds: [detailedEmbed] });
        } catch(e) { console.error("Could not send DM to user about report status:", e); }

        try {
            const channel = await client.channels.fetch(reportData.confirmationChannelId);
            const message = await channel.messages.fetch(reportData.confirmationMessageId);
            const statusText = isApproval ? 'الموافقة على' : 'رفض';
            const finalEmbed = new EmbedBuilder().setTitle(`تم ${statusText} تقريرك`).setDescription(`لقد تم **${statusText}** تقريرك لمسؤولية **${responsibilityName}** من قبل الإدارة.`).setColor(isApproval ? '#00ff00' : '#ff0000'); await message.edit({ embeds: [finalEmbed], components: [] });
        } catch(e) { console.error("Could not edit user's confirmation message:", e); }
        client.pendingReports.delete(reportId);
        scheduleSave();
    }
}

module.exports = {
    name,
    execute,
    handleInteraction,
    loadReportsConfig,
    saveReportsConfig
};
