const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const fs = require('fs');
const path = require('path');

const name = 'report';
const reportsPath = path.join(__dirname, '..', 'data', 'reports.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

// --- Data Handling ---
const defaultGuildConfig = {
    enabled: false,
    pointsOnReport: false,
    reportChannel: null,
    requiredFor: [],
    approvalRequiredFor: [],
    templates: {}
};

function loadReportsConfig(guildId) {
    try {
        if (fs.existsSync(reportsPath)) {
            const allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
            return allConfigs[guildId] ?? { ...defaultGuildConfig };
        }
    } catch (error) { console.error('Error reading reports.json:', error); }
    return { ...defaultGuildConfig };
}

function saveReportsConfig(guildId, guildConfig) {
    let allConfigs = {};
    try {
        if (fs.existsSync(reportsPath)) {
            allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
        }
    } catch (error) { console.error('Error reading reports.json during save:', error); }

    allConfigs[guildId] = guildConfig;

    try {
        fs.writeFileSync(reportsPath, JSON.stringify(allConfigs, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing to reports.json:', error);
        return false;
    }
}

// --- Embeds and Buttons ---
function createMainEmbed(client, guildId) {
    const config = loadReportsConfig(guildId);
    const status = config.enabled ? '**🟢 مفعل**' : '**🔴 معطل**';
    const pointsStatus = config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة';
    let channelStatus = 'لم يحدد';
    if (config.reportChannel) {
        channelStatus = config.reportChannel === '0' ? 'خاص الأونرات' : `<#${config.reportChannel}>`;
    }
    return new EmbedBuilder()
        .setTitle('⚙️ إعدادات نظام التقارير')
        .setDescription('التحكم الكامل بإعدادات نظام التقارير والموافقة عليها.')
        .setColor(colorManager.getColor(client))
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&')
        .addFields(
            { name: 'حالة النظام', value: status, inline: true },
            { name: 'حالة النقاط', value: `*${pointsStatus}*`, inline: true },
            { name: 'قناة التقارير', value: channelStatus, inline: true }
        );
}

function createMainButtons(guildId) {
    const config = loadReportsConfig(guildId);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('report_toggle_system').setLabel(config.enabled ? 'تعطيل النظام' : 'تفعيل النظام').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('report_manage_resps').setLabel('إدارة المسؤوليات').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('report_manage_templates').setLabel('إدارة القوالب').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('report_advanced_settings').setLabel('إعدادات متقدمة').setStyle(ButtonStyle.Secondary)
    );
}

// --- Command Execution ---
async function execute(message, args, { client, BOT_OWNERS }) {
    if (!BOT_OWNERS.includes(message.author.id)) return message.react('❌');
    const guildId = message.guild.id;
    const embed = createMainEmbed(client, guildId);
    const buttons = createMainButtons(guildId);
    await message.channel.send({ embeds: [embed], components: [buttons] });
}

// --- Interaction Handling ---
async function handleInteraction(interaction, context) {
    const { client, responsibilities, scheduleSave, BOT_OWNERS, points } = context;
    // Non-owner users can only submit reports, not change settings
    if (!BOT_OWNERS.includes(interaction.user.id) && !interaction.customId.startsWith('report_write_') && !interaction.customId.startsWith('report_submit_')) {
         return interaction.reply({ content: '❌ أنت لا تملك صلاحية استخدام هذا الأمر!', ephemeral: true });
    }

    const { customId, guildId } = interaction;
    let config = loadReportsConfig(guildId); // Load config for the current guild

    // Defer update for all interactions to prevent timeout
    if(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        await interaction.deferUpdate();
    }

    // --- Settings Interactions ---
    if (interaction.isButton()) {
        if (customId === 'report_toggle_system') {
            config.enabled = !config.enabled;
            saveReportsConfig(guildId, config);
            await interaction.editReply({ embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        } else if (customId === 'report_back_to_main') {
            await interaction.editReply({ content: '', embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        } else if (customId === 'report_manage_resps' || customId === 'report_manage_templates' || customId === 'report_advanced_settings' || customId === 'report_template_bulk') {
            let content, components;
            if (customId === 'report_manage_resps') {
                content = 'اختر الإجراء المطلوب للمسؤوليات:';
                components = [
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))
                ];
            } else if (customId === 'report_manage_templates') {
                 content = 'اختر إجراءً لإدارة قوالب التقارير:';
                 components = [
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_template_add').setLabel('إضافة/تعديل (فردي)').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_template_remove').setLabel('إزالة (فردي)').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('report_template_bulk').setLabel('تعديل جماعي').setStyle(ButtonStyle.Primary)),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))
                 ];
            } else if (customId === 'report_advanced_settings') {
                content = 'اختر من الإعدادات المتقدمة:';
                components = [
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_set_channel_button').setLabel('تحديد قناة التقارير').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_set_dms_button').setLabel('تحديد خاص الأونر').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_toggle_points').setLabel('تغيير نظام النقاط').setStyle(ButtonStyle.Success)),
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))
                ];
            } else if (customId === 'report_template_bulk'){
                content = 'اختر إجراءً جماعيًا للقوالب:';
                components = [
                    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_template_apply_all').setLabel('تطبيق قالب مخصص للكل').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_template_apply_default').setLabel('تطبيق قالب افتراضي').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('report_template_delete_all').setLabel('حذف جميع القوالب').setStyle(ButtonStyle.Danger)),
                     new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))
                ];
            }
            await interaction.editReply({ content, embeds: [], components });
        } else if (customId === 'report_select_req_report' || customId === 'report_select_req_approval' || customId === 'report_template_add' || customId === 'report_template_remove' || customId === 'report_set_channel_button' || customId === 'report_template_apply_all') {
            let content, components;
            if (customId === 'report_select_req_report' || customId === 'report_select_req_approval') {
                const isApproval = customId === 'report_select_req_approval';
                const targetArray = isApproval ? config.approvalRequiredFor : config.requiredFor;
                const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name, default: targetArray.includes(name) }));
                if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات معرفة حالياً.', ephemeral: true });
                const selectMenu = new StringSelectMenuBuilder().setCustomId(isApproval ? 'report_confirm_req_approval' : 'report_confirm_req_report').setPlaceholder(isApproval ? 'اختر المسؤوليات التي تتطلب موافقة' : 'اختر المسؤوليات التي تتطلب تقريراً').setMinValues(0).setMaxValues(respOptions.length).addOptions(respOptions);
                content = 'حدد المسؤوليات من القائمة أدناه.';
                components = [new ActionRowBuilder().addComponents(selectMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_resps').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            } else if (customId === 'report_template_add') {
                 const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name }));
                 if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات متاحة.', ephemeral: true });
                 const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_select_resp_for_add').setPlaceholder('اختر مسؤولية لإضافة/تعديل قالبها').addOptions(respOptions);
                 content = 'اختر مسؤولية:';
                 components = [new ActionRowBuilder().addComponents(selectMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            } else if (customId === 'report_template_remove') {
                const templateOptions = Object.keys(config.templates).map(name => ({ label: name.substring(0, 100), value: name }));
                if (templateOptions.length === 0) return interaction.followUp({ content: 'لا توجد قوالب معرفة حالياً.', ephemeral: true });
                const selectMenu = new StringSelectMenuBuilder().setCustomId('report_template_confirm_remove').setPlaceholder('اختر القوالب للإزالة').setMinValues(1).setMaxValues(templateOptions.length).addOptions(templateOptions);
                content = 'اختر المسؤوليات لإزالة قوالبها:';
                components = [new ActionRowBuilder().addComponents(selectMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_templates').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            } else if (customId === 'report_set_channel_button') {
                const menu = new ChannelSelectMenuBuilder().setCustomId('report_channel_select').setPlaceholder('اختر قناة لإرسال التقارير إليها').addChannelTypes(ChannelType.GuildText);
                content = 'اختر القناة من القائمة:';
                components = [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_advanced_settings').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            } else if (customId === 'report_template_apply_all') {
                const modal = new ModalBuilder().setCustomId('report_template_apply_all_modal').setTitle('تطبيق قالب على كل المسؤوليات');
                const templateInput = new TextInputBuilder().setCustomId('template_text_all').setLabel('نص القالب').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('اكتب هنا القالب الذي سيتم تطبيقه على الجميع...');
                modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
                return interaction.showModal(modal);
            }
            await interaction.editReply({ content, components });
        } else if (customId === 'report_set_dms_button' || customId === 'report_toggle_points' || customId === 'report_template_apply_default' || customId === 'report_template_delete_all') {
            let content;
            if(customId === 'report_set_dms_button'){
                config.reportChannel = '0';
                content = '✅ سيتم الآن إرسال التقارير إلى خاص الأونرات.';
            } else if (customId === 'report_toggle_points'){
                config.pointsOnReport = !config.pointsOnReport;
                content = `✅ تم تغيير نظام النقاط. النقاط الآن تُمنح: **${config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة'}**`;
            } else if (customId === 'report_template_apply_default'){
                const defaultConfig = `**- ملخص الإنجاز:**\n\n\n**- هل تمت مواجهة مشاكل؟:**\n\n\n**- ملاحظات إضافية:**`;
                for (const respName in responsibilities) { config.templates[respName] = defaultConfig; }
                content = '✅ تم تطبيق القالب الافتراضي بنجاح على جميع المسؤوليات.';
            } else if(customId === 'report_template_delete_all'){
                config.templates = {};
                content = '✅ تم حذف جميع القوالب بنجاح.';
            }
            saveReportsConfig(guildId, config);
            await interaction.followUp({ content, ephemeral: true });
            await interaction.editReply({ embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        }
    } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        if (customId === 'report_confirm_req_report') {
            config.requiredFor = interaction.values;
        } else if (customId === 'report_confirm_req_approval') {
            config.approvalRequiredFor = interaction.values;
        } else if (customId === 'report_template_select_resp_for_add') {
            const respName = interaction.values[0];
            const currentTemplate = config.templates[respName] || '';
            const modal = new ModalBuilder().setCustomId(`report_template_save_modal_${respName}`).setTitle(`قالب لـ: ${respName}`);
            const templateInput = new TextInputBuilder().setCustomId('template_text').setLabel('نص القالب (اتركه فارغاً للحذف)').setStyle(TextInputStyle.Paragraph).setValue(currentTemplate).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(templateInput));
            return interaction.showModal(modal);
        } else if (customId === 'report_template_confirm_remove') {
            interaction.values.forEach(name => { delete config.templates[name]; });
        } else if (customId === 'report_channel_select') {
            config.reportChannel = interaction.values[0];
        }
        saveReportsConfig(guildId, config);
        await interaction.followUp({ content: '✅ تم حفظ الإعدادات بنجاح.', ephemeral: true });
        await interaction.editReply({ embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
    } else if (interaction.isModalSubmit()) {
        // ... settings modal handlers ...
    }

    // --- Report Submission Flow ---
    if (customId.startsWith('report_write_')) {
        const reportId = customId.replace('report_write_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) {
            return interaction.editReply({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] }).catch(()=>{});
        }
        const modal = new ModalBuilder().setCustomId(`report_submit_${reportId}`).setTitle('كتابة تقرير المهمة');
        const template = config.templates[reportData.responsibilityName] || '';
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء كتابة تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(template).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
        await interaction.showModal(modal);
    } else if (customId.startsWith('report_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_submit_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً.', embeds: [], components: [] });
        const reportText = interaction.fields.getTextInputValue('report_text');
        const { responsibilityName, claimerId, timestamp, requesterId, displayName, reason } = reportData;
        const reportEmbed = new EmbedBuilder().setTitle(`تقرير مهمة: ${responsibilityName}`).setColor(colorManager.getColor(client)).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true }, { name: 'السبب الأصلي للطلب', value: reason || 'غير محدد' },{ name: 'التقرير', value: reportText.substring(0, 4000) }).setTimestamp().setFooter({ text: 'By Ahmed.' });
        const needsApproval = config.approvalRequiredFor && config.approvalRequiredFor.includes(responsibilityName);
        if (needsApproval) {
            // ... (approval logic)
        } else {
            // ... (no approval logic)
        }
    } else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
        await interaction.deferUpdate();
        // ... (approval/rejection logic)
    }
}

module.exports = {
    name,
    execute,
    handleInteraction,
    loadReportsConfig,
    saveReportsConfig
};
