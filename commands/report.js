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

    // --- Report Submission Flow ---
    if (customId.startsWith('report_write_')) {
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

            client.pendingReports.set(reportId, reportData);
            scheduleSave(true);

            const approvalButtons = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`report_approve_${reportId}`).setLabel('موافقة').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`report_reject_${reportId}`).setLabel('رفض').setStyle(ButtonStyle.Danger));
            const approvalMessageContent = { embeds: [reportEmbed], components: [approvalButtons], fetchReply: true };
            reportData.approvalMessageIds = {};
            if (config.reportChannel === '0') { for (const ownerId of BOT_OWNERS) { try { const owner = await client.users.fetch(ownerId); const msg = await owner.send(approvalMessageContent); reportData.approvalMessageIds[owner.dmChannel.id] = msg.id; } catch(e) { console.error(e); } }
            } else { try { const channel = await client.channels.fetch(config.reportChannel); const msg = await channel.send(approvalMessageContent); reportData.approvalMessageIds[channel.id] = msg.id; } catch(e) { console.error(e); } }

            const pendingEmbed = colorManager.createEmbed().setTitle('تم تقديم التقرير').setDescription('**تم إرسال تقريرك للمراجعة. سيتم إعلامك بالنتيجة.**');
            await interaction.editReply({ embeds: [pendingEmbed], components: [] });

            // Since editing is removed, there's no need to store confirmation message IDs.
            // The report data is already saved with its status.
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

    else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
        await interaction.deferUpdate();
        const isApproval = customId.startsWith('report_approve_');
        const reportId = customId.replace(isApproval ? 'report_approve_' : 'report_reject_', '');
        const reportData = client.pendingReports.get(reportId);
        if (!reportData || reportData.status !== 'pending_approval') {
            return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم التعامل معه بالفعل.', embeds: [], components: [] });
        }
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
            const detailedEmbed = colorManager.createEmbed()
                .setTitle(`تم ${statusText} تقريرك`)
                .addFields(
                    { name: 'المسؤولية', value: responsibilityName, inline: true },
                    { name: `تم ${statusText} بواسطة`, value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'السبب الأصلي للطلب', value: reportData.reason || 'غير محدد' },
                    { name: 'التقرير الذي قدمته', value: reportData.reportText }
                )
                .setTimestamp();
            await user.send({ embeds: [detailedEmbed] });
        } catch(e) { console.error("Could not send DM to user about report status:", e); }
        client.pendingReports.delete(reportId);
        scheduleSave(true); // Immediate save on final action
    }
}

module.exports = {
    name,
    execute,
    handleInteraction,
    loadReportsConfig,
    saveReportsConfig
};
