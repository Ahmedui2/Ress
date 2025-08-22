const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { quickLog } = require('../utils/logs_system.js');

const name = 'report';

async function execute(message, args, { client, reportsConfig, responsibilities, BOT_OWNERS }) {
    if (!BOT_OWNERS.includes(message.author.id)) {
        return message.react('❌');
    }
    // Find if a message already exists to edit it, otherwise send a new one.
    const channel = message.channel;
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
    const botMessage = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === 'إعدادات نظام التقارير');

    await sendReportSettings(botMessage || channel, reportsConfig, responsibilities);
}

async function sendReportSettings(target, reportsConfig, responsibilities) {
    const client = target.client;
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

    const embed = new EmbedBuilder()
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

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('report_toggle_system')
            .setLabel('تفعيل/تعطيل النظام')
            .setStyle(reportsConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('report_manage_resps')
            .setLabel('إدارة المسؤوليات')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('report_toggle_points')
            .setLabel('تفعيل/تعطيل النقاط')
            .setStyle(ButtonStyle.Secondary)
    );

    const payload = { content: '', embeds: [embed], components: [row] };

    if (target.id && (target.type === 'Message' || typeof target.edit === 'function')) {
         try {
            await target.edit(payload);
        } catch (e) {
            // If editing fails (e.g. message deleted), send a new one
            await target.channel.send(payload);
        }
    } else {
        await target.send(payload);
    }
}

async function handleInteraction(interaction, context) {
    const { client, reportsConfig, responsibilities, scheduleSave, BOT_OWNERS } = context;

    if (!BOT_OWNERS.includes(interaction.user.id)) {
        return interaction.reply({ content: '❌ **أنت لا تملك صلاحية استخدام هذا الأمر!**', ephemeral: true });
    }

    await interaction.deferUpdate();

    const { customId } = interaction;

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
                if (channelMention) {
                    channelId = channelMention.id;
                } else if (!/^\d{17,19}$/.test(channelId)) {
                    await interaction.followUp({ content: 'لم يتم التعرف على القناة. يرجى منشن القناة أو كتابة الـ ID بشكل صحيح.', ephemeral: true });
                    return;
                }

                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel || channel.type !== ChannelType.GuildText) {
                    await interaction.followUp({ content: 'القناة غير موجودة أو ليست قناة نصية.', ephemeral: true });
                    return;
                }

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
    } else if (customId === 'report_manage_resps') {
        const manageButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('report_manage_report_req')
                .setLabel('إدارة طلب التقرير')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('report_manage_approval_req')
                .setLabel('إدارة طلب الموافقة')
                .setStyle(ButtonStyle.Primary)
        );
        const backButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('report_back_to_main').setLabel('العودة').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ content: 'اختر الإجراء الذي تريد القيام به:', embeds: [], components: [manageButtons, backButton] });

    } else if (customId === 'report_manage_report_req' || customId === 'report_manage_approval_req') {
        const isForApproval = customId === 'report_manage_approval_req';
        const targetArray = isForApproval ? reportsConfig.approvalRequiredFor : reportsConfig.requiredFor;

        const respOptions = Object.keys(responsibilities).map(name => ({
            label: name.substring(0, 100),
            value: name,
            default: targetArray.includes(name)
        }));

        if (respOptions.length === 0) {
            return interaction.followUp({ content: 'لا توجد مسؤوليات معرفة حالياً.', ephemeral: true });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('report_select_resps')
            .setPlaceholder('اختر المسؤوليات التي تتطلب تقريراً')
            .setMinValues(0)
            .setMaxValues(respOptions.length)
            .addOptions(respOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('report_back_to_main')
                .setLabel('العودة')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
            content: 'حدد المسؤوليات من القائمة أدناه. يمكنك اختيار عدة مسؤوليات.',
            embeds: [],
            components: [row, backButton]
        });

    } else if (customId === 'report_select_resps') {
        reportsConfig.requiredFor = interaction.values;
        scheduleSave();
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId === 'report_back_to_main') {
        await sendReportSettings(interaction.message, reportsConfig, responsibilities);
    } else if (customId.startsWith('report_write_')) {
        const reportId = customId.replace('report_write_', '');
        const reportData = client.pendingReports.get(reportId);

        if (!reportData) {
            return interaction.update({ content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', embeds:[], components: [] });
        }

        // Acknowledge the button click immediately before showing the modal
        // No deferUpdate() needed here as showModal() acknowledges the interaction.

        const modal = new ModalBuilder()
            .setCustomId(`report_submit_${reportId}`)
            .setTitle('كتابة تقرير المهمة');

        const reportInput = new TextInputBuilder()
            .setCustomId('report_text')
            .setLabel('الرجاء كتابة تقريرك هنا')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const roleInput = new TextInputBuilder()
            .setCustomId('given_role_id')
            .setLabel('ID الرول الذي تم منحه (اختياري)')
            .setPlaceholder('اتركه فارغاً إن لم يتم إعطاء رول')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(reportInput), new ActionRowBuilder().addComponents(roleInput));
        await interaction.showModal(modal);
    } else if (customId.startsWith('report_submit_')) {
        await interaction.deferUpdate();
        const reportId = customId.replace('report_submit_', '');
        const reportData = client.pendingReports.get(reportId);

        if (!reportData) {
            return interaction.editReply({ content: 'لم يعد هذا التقرير صالحاً أو قد تم تقديمه بالفعل.', embeds: [], components: [] });
        }

        const reportText = interaction.fields.getTextInputValue('report_text');
        const givenRoleId = interaction.fields.getTextInputValue('given_role_id');

        const { responsibilityName, claimerId, timestamp, requesterId } = reportData;

        // Prepare report embed
        const { displayName } = reportData;
        const reportEmbed = new EmbedBuilder()
            .setTitle(`تقرير مهمة: ${responsibilityName}`)
            .setColor(colorManager.getColor(client))
            .setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() })
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: 'المسؤول', value: `<@${claimerId}>`, inline: true },
                { name: 'صاحب الطلب', value: `<@${requesterId}>`, inline: true },
                { name: 'التقرير', value: reportText.substring(0, 4000) }
            )
            .setTimestamp()
            .setFooter({ text: 'By Ahmed.' });

        if (givenRoleId) {
            let roleText = givenRoleId;
            try {
                const role = await interaction.guild.roles.fetch(givenRoleId).catch(() => null) || interaction.guild.roles.cache.find(r => r.name === givenRoleId);
                if (role) {
                    roleText = `<@&${role.id}>`;
                }
            } catch (e) {
                console.error("Could not resolve role for report:", e);
            }
            reportEmbed.addFields({ name: 'الرول المعطى', value: roleText, inline: false });
        }

        const needsApproval = reportsConfig.approvalRequiredFor && reportsConfig.approvalRequiredFor.includes(responsibilityName);

        if (needsApproval) {
            reportData.submittedAt = Date.now();
            reportData.reportText = reportText;
            reportData.givenRoleId = givenRoleId;
            client.pendingReports.set(reportId, reportData); // Update with new data
            scheduleSave();

            reportEmbed.addFields({ name: 'الحالة', value: 'بانتظار موافقة الأونر' });
            const approvalButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`report_approve_${reportId}`).setLabel('موافقة').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`report_reject_${reportId}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
            );

            // Send report for approval
            const approvalMessageContent = { embeds: [reportEmbed], components: [approvalButtons], fetchReply: true };
             if (reportsConfig.reportChannel === '0') {
                for (const ownerId of BOT_OWNERS) {
                    try {
                        const owner = await client.users.fetch(ownerId);
                        const msg = await owner.send(approvalMessageContent);
                        reportData.approvalMessageIds = reportData.approvalMessageIds || {};
                        reportData.approvalMessageIds[ownerId] = msg.id;
                    } catch(e) { console.error(e); }
                }
            } else {
                try {
                    const channel = await client.channels.fetch(reportsConfig.reportChannel);
                    const msg = await channel.send(approvalMessageContent);
                    reportData.approvalMessageIds = { [channel.id]: msg.id };
                } catch(e) { console.error(e); }
            }
            client.pendingReports.set(reportId, reportData); // Re-set the data with message IDs

            // Confirm to user
            const pendingEmbed = new EmbedBuilder()
                .setTitle('تم تقديم التقرير')
                .setDescription('**تم إرسال تقريرك للمراجعة من قبل الإدارة. سيتم إعلامك بالنتيجة.**')
                .setColor(colorManager.getColor(client));
            await interaction.editReply({ embeds: [pendingEmbed], components: [] });

        } else {
            // --- NO APPROVAL NEEDED ---
            // Award point if configured to do so
            if (reportsConfig.pointsOnReport) {
                if (!points[responsibilityName]) points[responsibilityName] = {};
                if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {};
                if (typeof points[responsibilityName][claimerId] === 'number') {
                    const oldPoints = points[responsibilityName][claimerId];
                    points[responsibilityName][claimerId] = { [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints };
                }
                if (!points[responsibilityName][claimerId][timestamp]) {
                    points[responsibilityName][claimerId][timestamp] = 0;
                }
                points[responsibilityName][claimerId][timestamp] += 1;
                scheduleSave();
            }

            // Send final report
            if (reportsConfig.reportChannel === '0') {
                for (const ownerId of BOT_OWNERS) {
                    try { await client.users.send(ownerId, { embeds: [reportEmbed] }); } catch (e) { console.error(e); }
                }
            } else {
                try {
                    const channel = await client.channels.fetch(reportsConfig.reportChannel);
                    await channel.send({ embeds: [reportEmbed] });
                } catch(e) { console.error(e); }
            }

            // Log the event
            quickLog.reportSubmitted(client, interaction.guild, interaction.user, requesterId, responsibilityName);

            // Clean up
            client.pendingReports.delete(reportId);
            scheduleSave();

            // Confirm to user by editing original message
            const finalEmbed = new EmbedBuilder()
                .setTitle('تم استلام المهمة')
                .setDescription('**تم إرسال تقريرك بنجاح ✅**')
                .setColor(colorManager.getColor(client));
            await interaction.editReply({ embeds: [finalEmbed], components: [] });
    } else if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
        const isApproval = customId.startsWith('report_approve_');
        const reportId = customId.replace(isApproval ? 'report_approve_' : 'report_reject_', '');
        const reportData = client.pendingReports.get(reportId);

        if (!reportData) {
            return interaction.update({ content: 'لم يعد هذا التقرير صالحاً أو قد تم التعامل معه بالفعل.', embeds: [], components: [] });
        }

        const { claimerId, responsibilityName, timestamp, requesterId, displayName } = reportData;

        if (isApproval) {
            // Award point
            if (!points[responsibilityName]) points[responsibilityName] = {};
            if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {};
            if (typeof points[responsibilityName][claimerId] === 'number') {
                const oldPoints = points[responsibilityName][claimerId];
                points[responsibilityName][claimerId] = { [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints };
            }
            if (!points[responsibilityName][claimerId][timestamp]) {
                points[responsibilityName][claimerId][timestamp] = 0;
            }
            points[responsibilityName][claimerId][timestamp] += 1;
            scheduleSave();
        }

        // Edit original report message
        const originalEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed)
            .setFields(
                ...originalEmbed.fields.filter(f => f.name !== 'الحالة'), // Remove previous status
                { name: 'الحالة', value: isApproval ? `✅ تم القبول بواسطة <@${interaction.user.id}>` : `❌ تم الرفض بواسطة <@${interaction.user.id}>` }
            );
        if (isApproval) {
            newEmbed.addFields({ name: 'النقطة', value: `تمت إضافة نقطة إلى <@${claimerId}>` });
        }

        await interaction.update({ embeds: [newEmbed], components: [] });

        // Notify user
        try {
            const claimer = await client.users.fetch(claimerId);
            const statusText = isApproval ? 'قبول' : 'رفض';
            await claimer.send(`تم **${statusText}** تقريرك لمسؤولية **${responsibilityName}** من قبل الإدارة.`);
        } catch(e) { console.error(e); }

        // Notify other owners
        const otherOwners = BOT_OWNERS.filter(id => id !== interaction.user.id);
        for (const ownerId of otherOwners) {
            try {
                const owner = await client.users.fetch(ownerId);
                await owner.send(`قام <@${interaction.user.id}> بالتعامل مع تقرير مقدم من <@${claimerId}> للمسؤولية **${responsibilityName}**.`);
            } catch(e) { console.error(e); }
        }

        // Clean up
        client.pendingReports.delete(reportId);
        scheduleSave();
        }
    }
}

module.exports = {
    name,
    execute,
    handleInteraction
};
