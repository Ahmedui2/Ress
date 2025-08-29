const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const fs = require('fs');
const path = require('path');

const name = 'report';
const reportsPath = path.join(__dirname, '..', 'data', 'reports.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

const defaultGuildConfig = { enabled: false, pointsOnReport: false, reportChannel: null, requiredFor: [], approvalRequiredFor: [], templates: {} };

function loadReportsConfig(guildId) {
    try {
        if (fs.existsSync(reportsPath)) {
            const allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
            return { ...defaultGuildConfig, ...(allConfigs[guildId] || {}) };
        }
    } catch (error) { console.error('Error reading reports.json:', error); }
    return { ...defaultGuildConfig };
}

function saveReportsConfig(guildId, guildConfig) {
    console.log(`[DEBUG] Attempting to save config for guild ${guildId}`);
    let allConfigs = {};
    try {
        if (fs.existsSync(reportsPath)) { allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8')); }
    } catch (error) { console.error('Error reading reports.json during save:', error); }

    allConfigs[guildId] = guildConfig;

    try {
        fs.writeFileSync(reportsPath, JSON.stringify(allConfigs, null, 2));
        console.log(`[DEBUG] Successfully saved config for guild ${guildId}`);
        return true;
    } catch (error) {
        console.error(`[DEBUG] FAILED to save config for guild ${guildId}:`, error);
        return false;
    }
}

function createMainEmbed(client, guildId) {
    const config = loadReportsConfig(guildId);
    const status = config.enabled ? '**🟢 مفعل**' : '**🔴 معطل**';
    const pointsStatus = config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة';
    let channelStatus = 'لم يحدد';
    if (config.reportChannel) { channelStatus = config.reportChannel === '0' ? 'خاص الأونرات' : `<#${config.reportChannel}>`; }
    return new EmbedBuilder().setTitle('⚙️ إعدادات نظام التقارير').setDescription('التحكم الكامل بإعدادات نظام التقارير والموافقة عليها.').setColor(colorManager.getColor(client)).setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&').addFields({ name: 'حالة النظام', value: status, inline: true },{ name: 'حالة النقاط', value: `*${pointsStatus}*`, inline: true },{ name: 'قناة التقارير', value: channelStatus, inline: true });
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

async function execute(message, args, { client, BOT_OWNERS }) {
    if (!BOT_OWNERS.includes(message.author.id)) return message.react('❌');
    await message.channel.send({ embeds: [createMainEmbed(client, message.guild.id)], components: [createMainButtons(message.guild.id)] });
}

async function handleInteraction(interaction, context) {
    const { client, responsibilities, scheduleSave, BOT_OWNERS, points } = context;
    const { customId, guildId } = interaction;

    const isSubmission = customId.startsWith('report_write_') || customId.startsWith('report_submit_') || customId.startsWith('report_edit_') || customId.startsWith('report_approve_') || customId.startsWith('report_reject_');
    if (!isSubmission && !BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.reply({ content: '❌ أنت لا تملك صلاحية استخدام هذا الأمر!', ephemeral: true });
    }

    let config = loadReportsConfig(guildId);

    if (interaction.isModalSubmit() && customId.startsWith('report_template_save_modal_')) {
        await interaction.deferUpdate();
        const respName = customId.replace('report_template_save_modal_', '');
        const templateText = interaction.fields.getTextInputValue('template_text');
        if (templateText) { config.templates[respName] = templateText; }
        else { delete config.templates[respName]; }
        if(saveReportsConfig(guildId, config)) await interaction.followUp({ content: `✅ تم حفظ القالب للمسؤولية: ${respName}`, ephemeral: true });
        await interaction.editReply({ content: '', embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        return;
    }

    if (interaction.isModalSubmit() && customId === 'report_template_apply_all_modal') {
        await interaction.deferUpdate();
        const templateText = interaction.fields.getTextInputValue('template_text_all');
        for (const respName in responsibilities) { config.templates[respName] = templateText; }
        if(saveReportsConfig(guildId, config)) await interaction.followUp({ content: `✅ تم تطبيق القالب بنجاح على جميع المسؤوليات.`, ephemeral: true });
        await interaction.editReply({ content: '', embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        return;
    }

    if (customId.startsWith('report_write_')) {
        await interaction.deferUpdate().catch(()=>{});
        const reportId = customId.replace('report_write_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData) return interaction.editReply({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] }).catch(()=>{});
        const modal = new ModalBuilder().setCustomId(`report_submit_${reportId}`).setTitle('كتابة تقرير المهمة');
        const template = config.templates[reportData.responsibilityName] || '';
        const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء كتابة تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(template).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
        await interaction.showModal(modal);
        return;
    }

    // --- All other interactions ---
    await interaction.deferUpdate();

    if (interaction.isButton()) {
        let content, components;
        let showMain = false;
        let saveAndFollowUp = false;

        if (customId === 'report_toggle_system') { config.enabled = !config.enabled; showMain = true; saveAndFollowUp = true; }
        else if (customId === 'report_back_to_main') { showMain = true; }
        else if (customId === 'report_set_dms_button') { config.reportChannel = '0'; content = '✅ سيتم الآن إرسال التقارير إلى خاص الأونرات.'; showMain = true; saveAndFollowUp = true; }
        else if (customId === 'report_toggle_points') { config.pointsOnReport = !config.pointsOnReport; content = `✅ تم تغيير نظام النقاط.`; showMain = true; saveAndFollowUp = true; }
        else if (customId === 'report_template_delete_all') { config.templates = {}; content = '✅ تم حذف جميع القوالب بنجاح.'; saveAndFollowUp = true; }
        else if (customId === 'report_template_apply_default') { const defaultConfig = `**- ملخص الإنجاز:**\n\n\n**- هل تمت مواجهة مشاكل؟:**\n\n\n**- ملاحظات إضافية:**`; for (const respName in responsibilities) { config.templates[respName] = defaultConfig; } content = '✅ تم تطبيق القالب الافتراضي بنجاح.'; saveAndFollowUp = true; }
        // ... (Navigation buttons below)
        else if (customId === 'report_manage_resps') { content = 'اختر الإجراء المطلوب للمسؤوليات:'; components = [ new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary)) ]; }
        else if (customId === 'report_advanced_settings') { content = 'اختر من الإعدادات المتقدمة:'; components = [ new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_set_channel_button').setLabel('تحديد قناة التقارير').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_set_dms_button').setLabel('تحديد خاص الأونر').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_toggle_points').setLabel('تغيير نظام النقاط').setStyle(ButtonStyle.Success)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary)) ]; }
        else if (customId === 'report_set_channel_button') { const menu = new ChannelSelectMenuBuilder().setCustomId('report_channel_select').setPlaceholder('اختر قناة لإرسال التقارير إليها').addChannelTypes(ChannelType.GuildText); content = 'اختر القناة من القائمة:'; components = [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_advanced_settings').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))]; }

        if (saveAndFollowUp) {
            if (saveReportsConfig(guildId, config)) await interaction.followUp({ content: content || '✅ تم حفظ الإعدادات.', ephemeral: true });
            else await interaction.followUp({ content: '❌ فشل في حفظ الإعدادات.', ephemeral: true });
        }
        if (showMain) await interaction.editReply({ content: '', embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        else if (components) await interaction.editReply({ content, embeds: [], components });

    } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        if (customId === 'report_confirm_req_report') config.requiredFor = interaction.values;
        else if (customId === 'report_confirm_req_approval') config.approvalRequiredFor = interaction.values;
        else if (customId === 'report_channel_select') config.reportChannel = interaction.values[0];

        if (saveReportsConfig(guildId, config)) await interaction.followUp({ content: '✅ تم حفظ الإعدادات بنجاح.', ephemeral: true });
        else await interaction.followUp({ content: '❌ فشل في حفظ الإعدادات.', ephemeral: true });
        await interaction.editReply({ embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
    }
}

module.exports = { name, execute, handleInteraction };
