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
    let allConfigs = {};
    try {
        if (fs.existsSync(reportsPath)) { allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8')); }
    } catch (error) { console.error('Error reading reports.json during save:', error); }
    allConfigs[guildId] = guildConfig;
    try {
        fs.writeFileSync(reportsPath, JSON.stringify(allConfigs, null, 2));
        return true;
    } catch (error) { console.error('Error writing to reports.json:', error); return false; }
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

    // --- Settings Interactions ---
    if (!isSubmission) {
        await interaction.deferUpdate();

        if (interaction.isButton()) {
            let content, components;
            let showMain = false;

            if (customId === 'report_toggle_system') {
                config.enabled = !config.enabled;
                showMain = true;
            } else if (customId === 'report_back_to_main') {
                showMain = true;
            } else if (customId === 'report_manage_resps') {
                content = 'اختر الإجراء المطلوب للمسؤوليات:';
                components = [ new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_select_req_report').setLabel('تحديد إلزامية التقرير').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('report_select_req_approval').setLabel('تحديد إلزامية الموافقة').setStyle(ButtonStyle.Primary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary)) ];
            } else if (customId === 'report_advanced_settings') {
                content = 'اختر من الإعدادات المتقدمة:';
                components = [ new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_set_channel_button').setLabel('تحديد قناة التقارير').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_set_dms_button').setLabel('تحديد خاص الأونر').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('report_toggle_points').setLabel('تغيير نظام النقاط').setStyle(ButtonStyle.Success)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_back_to_main').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary)) ];
            } else if (customId === 'report_set_dms_button') {
                config.reportChannel = '0';
                content = '✅ سيتم الآن إرسال التقارير إلى خاص الأونرات.';
                showMain = true;
            } else if (customId === 'report_toggle_points') {
                config.pointsOnReport = !config.pointsOnReport;
                content = `✅ تم تغيير نظام النقاط. النقاط الآن تُمنح: **${config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة'}**`;
                showMain = true;
            } else if (customId === 'report_select_req_report' || customId === 'report_select_req_approval') {
                const isApproval = customId === 'report_select_req_approval';
                const targetArray = isApproval ? config.approvalRequiredFor : config.requiredFor;
                const respOptions = Object.keys(responsibilities).map(name => ({ label: name.substring(0, 100), value: name, default: targetArray.includes(name) }));
                if (respOptions.length === 0) return interaction.followUp({ content: 'لا توجد مسؤوليات معرفة حالياً.', ephemeral: true });
                const selectMenu = new StringSelectMenuBuilder().setCustomId(isApproval ? 'report_confirm_req_approval' : 'report_confirm_req_report').setPlaceholder(isApproval ? 'اختر المسؤوليات التي تتطلب موافقة' : 'اختر المسؤوليات التي تتطلب تقريراً').setMinValues(0).setMaxValues(respOptions.length).addOptions(respOptions);
                content = 'حدد المسؤوليات من القائمة أدناه.';
                components = [new ActionRowBuilder().addComponents(selectMenu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_manage_resps').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            } else if (customId === 'report_set_channel_button') {
                const menu = new ChannelSelectMenuBuilder().setCustomId('report_channel_select').setPlaceholder('اختر قناة لإرسال التقارير إليها').addChannelTypes(ChannelType.GuildText);
                content = 'اختر القناة من القائمة:';
                components = [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('report_advanced_settings').setLabel('➡️ العودة').setStyle(ButtonStyle.Secondary))];
            }

            if (saveReportsConfig(guildId, config) && content) {
                await interaction.followUp({ content: content, ephemeral: true });
            }

            if (showMain) {
                await interaction.editReply({ content: '', embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
            } else if (components) {
                await interaction.editReply({ content, embeds: [], components });
            }

        } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
            if (customId === 'report_confirm_req_report') config.requiredFor = interaction.values;
            else if (customId === 'report_confirm_req_approval') config.approvalRequiredFor = interaction.values;
            else if (customId === 'report_channel_select') config.reportChannel = interaction.values[0];

            if (saveReportsConfig(guildId, config)) {
                 await interaction.followUp({ content: '✅ تم حفظ الإعدادات بنجاح.', ephemeral: true });
            }
            await interaction.editReply({ embeds: [createMainEmbed(client, guildId)], components: [createMainButtons(guildId)] });
        }
        return;
    }

    // --- Report Submission & Approval Flow ---
    if (interaction.isButton()) {
        if (customId.startsWith('report_write_')) {
            const reportId = customId.replace('report_write_', '');
            const reportData = client.pendingReports.get(reportId);
            if (!reportData) {
                await interaction.deferUpdate().catch(()=>{});
                return interaction.editReply({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] }).catch(()=>{});
            }
            const modal = new ModalBuilder().setCustomId(`report_submit_${reportId}`).setTitle('كتابة تقرير المهمة');
            const template = config.templates[reportData.responsibilityName] || '';
            const reportInput = new TextInputBuilder().setCustomId('report_text').setLabel('الرجاء كتابة تقريرك هنا').setStyle(TextInputStyle.Paragraph).setValue(template).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reportInput));
            await interaction.showModal(modal);
        } else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
            await interaction.deferUpdate();
            const isApproval = customId.startsWith('report_approve_');
            const reportId = customId.replace(isApproval ? 'report_approve_' : 'report_reject_', '');
            const reportData = client.pendingReports.get(reportId);
            if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم التعامل معه بالفعل.', embeds: [], components: [] });
            const { claimerId, responsibilityName, timestamp } = reportData;
            if (isApproval && config.pointsOnReport) {
                if (!points[responsibilityName]) points[responsibilityName] = {};
                if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {};
                points[responsibilityName][claimerId][timestamp] = 1;
                scheduleSave();
            }
            const originalEmbed = interaction.message.embeds[0];
            const newEmbed = EmbedBuilder.from(originalEmbed).setFields(...originalEmbed.fields.filter(f => f.name !== 'الحالة'),{ name: 'الحالة', value: isApproval ? `✅ تم القبول بواسطة <@${interaction.user.id}>` : `❌ تم الرفض بواسطة <@${interaction.user.id}>` });
            if (isApproval) newEmbed.addFields({ name: 'النقطة', value: `تمت إضافة نقطة إلى <@${claimerId}>` });
            await interaction.editReply({ embeds: [newEmbed], components: [] });
            // ... (DM logic and confirmation message edit logic remains the same)
            client.pendingReports.delete(reportId);
            scheduleSave();
        }
    } else if (interaction.isModalSubmit()) {
        if (customId.startsWith('report_submit_')) {
            await interaction.deferUpdate();
            const reportId = customId.replace('report_submit_', '');
            const reportData = client.pendingReports.get(reportId);
            if (!reportData) return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً.', embeds: [], components: [] });
            const reportText = interaction.fields.getTextInputValue('report_text');
            const { responsibilityName, claimerId, timestamp, requesterId, displayName, reason } = reportData;
            const reportEmbed = new EmbedBuilder().setTitle(`تقرير مهمة: ${responsibilityName}`).setColor(colorManager.getColor(client)).setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(client.user.displayAvatarURL()).addFields({ name: 'المسؤول', value: `<@${claimerId}>`, inline: true },{ name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true }, { name: 'السبب الأصلي للطلب', value: reason || 'غير محدد' },{ name: 'التقرير', value: reportText.substring(0, 4000) }).setTimestamp();
            const needsApproval = config.approvalRequiredFor && config.approvalRequiredFor.includes(responsibilityName);
            if (needsApproval) {
                // ... (Approval logic remains the same)
            } else {
                // ... (No approval logic remains the same)
            }
        }
    }
}

module.exports = {
    name,
    execute,
    handleInteraction
};
