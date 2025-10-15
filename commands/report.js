const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const fs = require('fs');
const path = require('path');

const name = 'report';
const reportsPath = path.join(__dirname, '..', 'data', 'reports.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

const defaultGuildConfig = { enabled: false, pointsOnReport: false, reportChannel: null, requiredFor: [], approvalRequiredFor: [], templates: {}, approverType: 'owners', approverTargets: [] };

function loadReportsConfig(guildId) {
    try {
        if (fs.existsSync(reportsPath)) {
            const allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8'));
            return { ...defaultGuildConfig, ...(allConfigs[guildId] || {}) };
        }
    } catch (error) { 
        console.error('Error reading reports.json:', error); 
    }
    return { ...defaultGuildConfig };
}

function saveReportsConfig(guildId, guildConfig) {
    console.log(`[DEBUG] Attempting to save config for guild ${guildId}`);
    let allConfigs = {};
    try {
        if (fs.existsSync(reportsPath)) { 
            const fileContent = fs.readFileSync(reportsPath, 'utf8');
            const parsed = JSON.parse(fileContent);

            // حماية: التحقق من أن الملف بالصيغة الصحيحة (متعدد السيرفرات)
            // إذا كان الملف يحتوي على مفاتيح من الصيغة القديمة، نتجاهله ونبدأ من جديد
            if (parsed && typeof parsed === 'object') {
                if (parsed.enabled !== undefined && parsed.reportChannel !== undefined) {
                    // هذه صيغة قديمة! نتجاهلها ونبدأ من جديد
                    console.warn('[WARN] Detected old reports.json format, resetting to guild-based format');
                    allConfigs = {};
                } else {
                    allConfigs = parsed;
                }
            }
        }
    } catch (error) { 
        console.error('Error reading reports.json during save:', error); 
    }

    allConfigs[guildId] = guildConfig;

    try {
        // Ensure data directory exists
        const dataDir = path.dirname(reportsPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(reportsPath, JSON.stringify(allConfigs, null, 2));
        console.log(`[DEBUG] Successfully saved config for guild ${guildId} in correct format`);
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
    if (config.reportChannel) { 
        channelStatus = config.reportChannel === '0' ? 'خاص الأونرات' : `<#${config.reportChannel}>`; 
    }

    let approverStatus = 'الأونرات فقط';
    if (config.approverType === 'roles' && config.approverTargets && config.approverTargets.length > 0) {
        approverStatus = config.approverTargets.map(id => `<@&${id}>`).join(', ');
    } else if (config.approverType === 'responsibility' && config.approverTargets && config.approverTargets.length > 0) {
        approverStatus = `أعضاء: ${config.approverTargets.join(', ')}`;
    }

    return new EmbedBuilder()
        .setTitle('Report System')
        .setDescription('التحكم الكامل بإعدادات نظام التقارير والموافقة عليها.')
        .setColor(colorManager.getColor(client))
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&')
        .addFields(
            { name: 'حالة النظام', value: status, inline: true },
            { name: 'حالة النقاط', value: `*${pointsStatus}*`, inline: true },
            { name: 'قناة التقارير', value: channelStatus, inline: true },
            { name: 'المعتمدون', value: approverStatus, inline: false }
        );
}

function createMainButtons(guildId) {
    const config = loadReportsConfig(guildId);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('report_toggle_system')
            .setLabel(config.enabled ? 'تعطيل النظام' : 'تفعيل النظام')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('report_manage_resps')
            .setLabel('إدارة المسؤوليات')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('report_manage_templates')
            .setLabel('إدارة القوالب')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('report_advanced_settings')
            .setLabel('إعدادات متقدمة')
            .setStyle(ButtonStyle.Secondary)
    );
}

function createResponsibilitySelectMenu(responsibilities, customId, placeholder, currentPage = 0) {
    // التأكد من أن responsibilities كائن صحيح
    if (!responsibilities || typeof responsibilities !== 'object') {
        responsibilities = {};
    }

    const { createPaginatedResponsibilityMenu } = require('../utils/responsibilityPagination.js');
    return createPaginatedResponsibilityMenu(responsibilities, currentPage, customId, placeholder);
}ة ${respName}`
    }));

    if (options.length === 0) {
        options.push({
            label: 'لا توجد مسؤوليات',
            value: 'none',
            description: 'يجب إنشاء مسؤوليات أولاً'
        });
    }

    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(options.slice(0, 25)); // Discord limit
}

function createTemplateManagementEmbed(client, responsibilities, config) {
    const embed = new EmbedBuilder()
        .setTitle(' إدارة قوالب التقارير')
        .setDescription('إدارة القوالب المخصصة لكل مسؤولية')
        .setColor(colorManager.getColor(client))
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&');

    const templateCount = Object.keys(config.templates || {}).length;
    const totalResps = Object.keys(responsibilities).length;

    embed.addFields(
        { name: 'إجمالي المسؤوليات', value: totalResps.toString(), inline: true },
        { name: 'القوالب المحددة', value: templateCount.toString(), inline: true },
        { name: 'القوالب المفقودة', value: (totalResps - templateCount).toString(), inline: true }
    );

    return embed;
}

async function execute(message, args, { client, BOT_OWNERS }) {
        if (!BOT_OWNERS.includes(message.author.id)) return message.react('❌');

    try {
        await message.channel.send({ 
            embeds: [createMainEmbed(client, message.guild.id)], 
            components: [createMainButtons(message.guild.id)] 
        });
    } catch (error) {
        console.error('Error executing report command:', error);
        return message.reply('❌ حدث خطأ في تنفيذ الأمر.');
    }
}

async function handleInteraction(interaction, context) {
    const { client, scheduleSave, BOT_OWNERS, points } = context;
    const { customId, guildId } = interaction;

    console.log(`[Report] معالجة تفاعل: ${customId} من المستخدم: ${interaction.user.id}`);

    try {
        // إعادة تحميل المسؤوليات من الملف مباشرة
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
        let responsibilities = {};
        try {
            if (fs.existsSync(responsibilitiesPath)) {
                const data = fs.readFileSync(responsibilitiesPath, 'utf8');
                responsibilities = JSON.parse(data);
                console.log(`[Report] تم تحميل ${Object.keys(responsibilities).length} مسؤولية:`, Object.keys(responsibilities));
            } else {
                console.log('[Report] ⚠️ ملف المسؤوليات غير موجود');
            }
        } catch (error) {
            console.error('❌ خطأ في قراءة المسؤوليات:', error);
        }

        // Check if interaction is from submission or approval/reject buttons
        const isSubmission = customId.startsWith('report_write_') || 
                           customId.startsWith('report_submit_') || 
                           customId.startsWith('report_edit_');

        const isApprovalAction = customId.startsWith('report_approve_') || 
                                customId.startsWith('report_reject_');

        // تحميل BOT_OWNERS من السياق أو من الملف مباشرة
        const botOwnersToCheck = BOT_OWNERS || context.BOT_OWNERS || [];

        // التحقق من صلاحيات الأزرار العادية (غير الموافقة/الرفض)
        // يجب أن يكون المستخدم هو نفسه الذي استخدم الأمر الأساسي
        if (!isSubmission && !isApprovalAction) {
            // التحقق من أن المستخدم هو صاحب الرسالة الأصلية
            if (interaction.message && interaction.message.interaction) {
                const originalUserId = interaction.message.interaction.user.id;
                if (interaction.user.id !== originalUserId) {
                    console.log(`❌ المستخدم ${interaction.user.id} ليس صاحب الأمر الأصلي`);
                    if (!interaction.replied && !interaction.deferred) {
                        return await interaction.reply({ 
                            content: '❌ فقط الشخص الذي استخدم الأمر يمكنه التحكم به!', 
                            ephemeral: true 
                        });
                    }
                    return;
                }
            }
        }

        console.log(`✅ تم التحقق من صلاحيات المستخدم ${interaction.user.id}`);

        let config = loadReportsConfig(guildId);

        // Handle modal submissions
        if (interaction.isModalSubmit()) {
            if (customId.startsWith('report_template_save_modal_')) {
                await interaction.deferReply({ ephemeral: true });
                const respName = customId.replace('report_template_save_modal_', '');
                const templateText = interaction.fields.getTextInputValue('template_text');

                if (templateText.trim()) { 
                    config.templates[respName] = templateText.trim(); 
                } else { 
                    delete config.templates[respName]; 
                }

                if (saveReportsConfig(guildId, config)) {
                    await interaction.editReply({ 
                        content: `✅ تم حفظ القالب للمسؤولية: ${respName}` 
                    });
                } else {
                    await interaction.editReply({ 
                        content: '❌ فشل في حفظ القالب.' 
                    });
                }
                return;
            }

            if (customId === 'report_template_apply_all_modal') {
                await interaction.deferReply({ ephemeral: true });
                const templateText = interaction.fields.getTextInputValue('template_text_all');

                for (const respName in responsibilities) { 
                    config.templates[respName] = templateText.trim(); 
                }

                if (saveReportsConfig(guildId, config)) {
                    await interaction.editReply({ 
                        content: `✅ تم تطبيق القالب بنجاح على جميع المسؤوليات.` 
                    });
                } else {
                    await interaction.editReply({ 
                        content: '❌ فشل في تطبيق القالب.' 
                    });
                }
                return;
            }

            // Handle report writing modal
            if (customId.startsWith('report_submit_')) {
                await interaction.deferReply({ ephemeral: true });
                const reportId = customId.replace('report_submit_', '');
                const reportData = client.pendingReports?.get(reportId);

                if (!reportData) {
                    return await interaction.editReply({ 
                        content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.' 
                    });
                }

                // التحقق من أن التقرير لم يتم إرساله من قبل
                if (reportData.submitted) {
                    return await interaction.editReply({ 
                        content: '❌ تم إرسال هذا التقرير مسبقاً!' 
                    });
                }

                const reportText = interaction.fields.getTextInputValue('report_text');

                // Update pending report with the text (but don't mark as submitted yet)
                reportData.reportText = reportText;
                reportData.submittedAt = Date.now();
                client.pendingReports.set(reportId, reportData);

                // الحصول على الإعدادات الصحيحة بناءً على معرف السيرفر
                const reportGuildId = reportData.guildId || interaction.guildId;
                const guildConfig = loadReportsConfig(reportGuildId);

                // Create report embed with link to original message
                const reportEmbed = new EmbedBuilder()
                    .setTitle('New report')
                    .setDescription(`**المسؤولية :** ${reportData.responsibilityName}\n**من قِبل :** <@${reportData.claimerId}> (${reportData.displayName})\n**السبب:** ${reportData.reason}`)
                    .addFields([
                        { name: ' التقرير', value: reportText, inline: false }
                    ])
                    .setColor(colorManager.getColor(client))
                    .setTimestamp()
                    .setFooter({ text: `Report ID : ${reportId}` });

                // إضافة رابط الرسالة الأصلية إذا كان متوفراً
                if (reportData.originalMessageId && reportData.originalChannelId && reportData.originalMessageId !== 'unknown' && reportGuildId) {
                    const messageUrl = `https://discord.com/channels/${reportGuildId}/${reportData.originalChannelId}/${reportData.originalMessageId}`;
                    reportEmbed.addFields([
                        { name: '🔗 الرسالة الأصلية', value: `[اضغط هنا](${messageUrl})`, inline: true }
                    ]);
                }

                // Check if approval is required
                const isApprovalRequired = guildConfig.approvalRequiredFor && 
                                          Array.isArray(guildConfig.approvalRequiredFor) && 
                                          guildConfig.approvalRequiredFor.includes(reportData.responsibilityName);

                // Create approval buttons if needed
                let components = [];
                if (isApprovalRequired) {
                    const approveButton = new ButtonBuilder()
                        .setCustomId(`report_approve_${reportId}`)
                        .setLabel('موافقة')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅');

                    const rejectButton = new ButtonBuilder()
                        .setCustomId(`report_reject_${reportId}`)
                        .setLabel('رفض')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌');

                    components = [new ActionRowBuilder().addComponents(approveButton, rejectButton)];
                }

                // Send report to channel or DMs
                try {
                    if (guildConfig.reportChannel === '0') {
                        // Send to bot owners via DM
                        for (const ownerId of BOT_OWNERS) {
                            try {
                                const owner = await client.users.fetch(ownerId);
                                await owner.send({ 
                                    embeds: [reportEmbed], 
                                    components: components 
                                });
                            } catch (err) {
                                console.error(`Failed to send report to owner ${ownerId}:`, err);
                            }
                        }

                        // Mark as submitted only after successful send
                        reportData.submitted = true;
                        client.pendingReports.set(reportId, reportData);

                        await interaction.editReply({ 
                            content: '✅ تم إرسال التقرير للأونرات بنجاح!' 
                        });
                    } else if (guildConfig.reportChannel) {
                        // Send to specific channel
                        const reportChannel = await client.channels.fetch(guildConfig.reportChannel);
                        await reportChannel.send({ 
                            embeds: [reportEmbed], 
                            components: components 
                        });

                        // Mark as submitted only after successful send
                        reportData.submitted = true;
                        client.pendingReports.set(reportId, reportData);

                        await interaction.editReply({ 
                            content: '✅ تم إرسال التقرير بنجاح!' 
                        });
                    } else {
                        await interaction.editReply({ 
                            content: '❌ لم يتم تحديد قناة التقارير!' 
                        });
                        return;
                    }

                    // If no approval required
                    if (!isApprovalRequired) {
                        // Award points if pointsOnReport is true
                        if (config.pointsOnReport) {
                            const { claimerId, responsibilityName, timestamp } = reportData;
                            if (!points[responsibilityName]) points[responsibilityName] = {};
                            if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {};
                            if (typeof points[responsibilityName][claimerId] === 'number') {
                                const oldPoints = points[responsibilityName][claimerId];
                                points[responsibilityName][claimerId] = {
                                    [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints
                                };
                            }
                            if (!points[responsibilityName][claimerId][timestamp]) {
                                points[responsibilityName][claimerId][timestamp] = 0;
                            }
                            points[responsibilityName][claimerId][timestamp] += 1;
                            scheduleSave();
                        }

                        // Always remove from pending reports when no approval is required
                        client.pendingReports.delete(reportId);
                        scheduleSave();
                    }

                } catch (error) {
                    console.error('Error sending report:', error);
                    // Don't mark as submitted if sending failed, so user can retry
                    await interaction.editReply({ 
                        content: '❌ حدث خطأ في إرسال التقرير! يرجى المحاولة مرة أخرى.' 
                    });
                }
                return;
            }
        }

        // Handle report writing button (special case - shows modal)
        if (customId.startsWith('report_write_')) {
            const reportId = customId.replace('report_write_', '');
            const reportData = client.pendingReports?.get(reportId);

            if (!reportData) {
                return await interaction.reply({ 
                    content: 'لم يتم العثور على هذا التقرير أو انتهت صلاحيته.', 
                    ephemeral: true 
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`report_submit_${reportId}`)
                .setTitle('Report');

            // الحصول على الإعدادات الصحيحة بناءً على معرف السيرفر
            const reportGuildId = reportData.guildId || interaction.guildId;
            const guildConfig = loadReportsConfig(reportGuildId);

            const template = guildConfig.templates?.[reportData.responsibilityName] || '';
            const reportInput = new TextInputBuilder()
                .setCustomId('report_text')
                .setLabel('الرجاء كتابة تقريرك هنا')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(template)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(reportInput));

            try {
                await interaction.showModal(modal);
            } catch (error) {
                console.error('Error showing modal:', error);
                await interaction.reply({ 
                    content: '❌ حدث خطأ في عرض نموذج التقرير.', 
                    ephemeral: true 
                });
            }
            return;
        }

        // Handle all other interactions
        try {
            // تأخير التفاعل فقط للأزرار والقوائم التي لا تحتاج لفتح Modal
            const needsModal = customId === 'report_template_apply_all_btn' || customId === 'report_template_edit_select';

            if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) && 
                !interaction.replied && !interaction.deferred && !needsModal) {
                await interaction.deferUpdate();
            }
        } catch (error) {
            console.error('❌ خطأ في تأجيل التفاعل:', error);

            // تجاهل الأخطاء المعروفة
            const ignoredErrorCodes = [10008, 40060, 10062];
            if (error.code && ignoredErrorCodes.includes(error.code)) {
                console.log(`تم تجاهل خطأ Discord معروف: ${error.code}`);
                return;
            }

            if (!interaction.replied && !interaction.deferred) {
                return await interaction.reply({ 
                    content: '❌ حدث خطأ في معالجة هذا التفاعل', 
                    ephemeral: true 
                }).catch(() => {});
            }
            return;
        }

        if (interaction.isButton()) {
            let shouldShowMain = false;
            let shouldSave = false;
            let responseContent = '';
            let newComponents = null;

            switch (customId) {
                case 'report_toggle_system':
                    config.enabled = !config.enabled;
                    shouldShowMain = true;
                    shouldSave = true;
                    responseContent = config.enabled ? '✅ تم تفعيل نظام التقارير.' : '✅ تم تعطيل نظام التقارير.';
                    break;

                case 'report_back_to_main':
                    shouldShowMain = true;
                    break;

                case 'report_set_dms_button':
                    config.reportChannel = '0';
                    shouldShowMain = true;
                    shouldSave = true;
                    responseContent = '✅ سيتم الآن إرسال التقارير إلى خاص الأونرات.';
                    break;

                case 'report_toggle_points':
                    config.pointsOnReport = !config.pointsOnReport;
                    shouldShowMain = true;
                    shouldSave = true;
                    responseContent = `✅ تم تغيير نظام النقاط إلى: ${config.pointsOnReport ? 'بعد موافقة التقرير' : 'عند استلام المهمة'}.`;
                    break;

                case 'report_template_delete_all':
                    config.templates = {};
                    shouldSave = true;
                    responseContent = '✅ تم حذف جميع القوالب بنجاح.';
                    break;

                case 'report_template_apply_default':
                    const defaultTemplate = `**- ملخص الإنجاز:**\n\n\n**- هل تمت مواجهة مشاكل؟:**\n\n\n**- ملاحظات إضافية:**`;
                    for (const respName in responsibilities) { 
                        config.templates[respName] = defaultTemplate; 
                    }
                    shouldSave = true;
                    responseContent = '✅ تم تطبيق القالب الافتراضي بنجاح.';
                    break;

                case 'report_manage_resps':
                    // إنشاء embed منظم يعرض حالة المسؤوليات
                    const respsEmbed = colorManager.createEmbed()
                        .setTitle('Res settings')
                        .setDescription('** Res status:**')
                        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&')
                        .setTimestamp();

                    const requiredReport = config.requiredFor || [];
                    const requiredApproval = config.approvalRequiredFor || [];
                    
                    // تصنيف المسؤوليات
                    const both = [];
                    const reportOnly = [];
                    const approvalOnly = [];
                    const neither = [];

                    for (const respName of Object.keys(responsibilities)) {
                        const hasReport = requiredReport.includes(respName);
                        const hasApproval = requiredApproval.includes(respName);

                        if (hasReport && hasApproval) {
                            both.push(respName);
                        } else if (hasReport) {
                            reportOnly.push(respName);
                        } else if (hasApproval) {
                            approvalOnly.push(respName);
                        } else {
                            neither.push(respName);
                        }
                    }

                    // إضافة الحقول
                    if (both.length > 0) {
                        respsEmbed.addFields([
                            { 
                                name: '✅ **إلزامية التقرير والموافقة**', 
                                value: both.map(r => `• ${r}`).join('\n'), 
                                inline: false 
                            }
                        ]);
                    }

                    if (reportOnly.length > 0) {
                        respsEmbed.addFields([
                            { 
                                name: ' **إلزامية التقرير فقط**', 
                                value: reportOnly.map(r => `• ${r}`).join('\n'), 
                                inline: false 
                            }
                        ]);
                    }

                    if (approvalOnly.length > 0) {
                        respsEmbed.addFields([
                            { 
                                name: '✔️ **إلزامية الموافقة فقط**', 
                                value: approvalOnly.map(r => `• ${r}`).join('\n'), 
                                inline: false 
                            }
                        ]);
                    }

                    if (neither.length > 0) {
                        respsEmbed.addFields([
                            { 
                                name: ' **بدون إلزامية**', 
                                value: neither.map(r => `• ${r}`).join('\n'), 
                                inline: false 
                            }
                        ]);
                    }

                    if (Object.keys(responsibilities).length === 0) {
                        respsEmbed.addFields([
                            { name: '⚠️ لا توجد مسؤوليات', value: 'يجب إنشاء مسؤوليات أولاً', inline: false }
                        ]);
                    }

                    await interaction.update({
                        content: '',
                        embeds: [respsEmbed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('report_select_req_report')
                                    .setLabel('تحديد إلزامية التقرير')
                                    .setStyle(ButtonStyle.Primary),
                                new ButtonBuilder()
                                    .setCustomId('report_select_req_approval')
                                    .setLabel('تحديد إلزامية الموافقة')
                                    .setStyle(ButtonStyle.Primary)
                            ),
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('report_back_to_main')
                                    .setLabel('➡️ العودة')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    return;

                case 'report_select_req_report':
                    // إعادة تحميل المسؤوليات للتأكد من أحدث البيانات
                    let reqReportResps = {};
                    try {
                        if (fs.existsSync(responsibilitiesPath)) {
                            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
                            reqReportResps = JSON.parse(data);
                        }
                    } catch (error) {
                        console.error('[Report] ❌ خطأ في قراءة المسؤوليات:', error);
                    }

                    const reportOptions = Object.keys(reqReportResps).slice(0, 25).map(respName => ({
                        label: respName,
                        value: respName,
                        description: config.requiredFor?.includes(respName) ? '✅ مفعل حالياً' : 'غير مفعل',
                        default: config.requiredFor?.includes(respName) || false
                    }));

                    if (reportOptions.length === 0) {
                        reportOptions.push({
                            label: 'لا توجد مسؤوليات',
                            value: 'none',
                            description: 'يجب إنشاء مسؤوليات أولاً'
                        });
                    }

                    const reportSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId('report_confirm_req_report')
                        .setPlaceholder('اختر المسؤوليات المطلوب تقرير لها...')
                        .setMinValues(0)
                        .setMaxValues(Math.min(reportOptions.length, 25))
                        .addOptions(reportOptions);

                    responseContent = ' **اختر المسؤوليات التي تتطلب تقرير:**';
                    newComponents = [
                        new ActionRowBuilder().addComponents(reportSelectMenu),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_manage_resps')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_select_req_approval':
                    // إعادة تحميل المسؤوليات للتأكد من أحدث البيانات
                    let reqApprovalResps = {};
                    try {
                        if (fs.existsSync(responsibilitiesPath)) {
                            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
                            reqApprovalResps = JSON.parse(data);
                        }
                    } catch (error) {
                        console.error('[Report] ❌ خطأ في قراءة المسؤوليات:', error);
                    }

                    const approvalOptions = Object.keys(reqApprovalResps).slice(0, 25).map(respName => ({
                        label: respName,
                        value: respName,
                        description: config.approvalRequiredFor?.includes(respName) ? '✅ مفعل حالياً' : 'غير مفعل',
                        default: config.approvalRequiredFor?.includes(respName) || false
                    }));

                    if (approvalOptions.length === 0) {
                        approvalOptions.push({
                            label: 'لا توجد مسؤوليات',
                            value: 'none',
                            description: 'يجب إنشاء مسؤوليات أولاً'
                        });
                    }

                    const approvalSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId('report_confirm_req_approval')
                        .setPlaceholder('اختر المسؤوليات المطلوب موافقة تقريرها...')
                        .setMinValues(0)
                        .setMaxValues(Math.min(approvalOptions.length, 25))
                        .addOptions(approvalOptions);

                    responseContent = '✔️ **اختر المسؤوليات التي تتطلب موافقة على التقرير من مسؤول المسؤوليات :**\n';
                    newComponents = [
                        new ActionRowBuilder().addComponents(approvalSelectMenu),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_manage_resps')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_manage_templates':
                    responseContent = 'إدارة قوالب التقارير:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_template_select_resp')
                                .setLabel('تعديل قالب مسؤولية')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('report_template_apply_all_btn')
                                .setLabel('تطبيق قالب على الكل')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('report_template_apply_default')
                                .setLabel('القالب الافتراضي')
                                .setStyle(ButtonStyle.Success)
                        ),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_view_templates')
                                .setLabel('رؤية القوالب الحالية')
                                .setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder()
                                .setCustomId('report_template_delete_all')
                                .setLabel('حذف جميع القوالب')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('report_back_to_main')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_view_templates':
                    // عرض القوالب الحالية
                    const templatesEmbed = colorManager.createEmbed()
                        .setTitle('Templates')
                        .setDescription('قوالب التقارير المحددة لكل مسؤولية')
                        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400661744682139690/download__1_-removebg-preview.png?ex=688d7366&is=688c21e6&hm=5635fe92ec3d4896d9ca065b9bb8ee11a5923b9e5d75fe94b753046e7e8b24eb&')
                        .setTimestamp();

                    if (Object.keys(config.templates || {}).length === 0) {
                        templatesEmbed.addFields([
                            { name: '⚠️ لا توجد قوالب', value: 'لم يتم تحديد أي قوالب بعد.', inline: false }
                        ]);
                    } else {
                        for (const [respName, template] of Object.entries(config.templates)) {
                            const truncatedTemplate = template.length > 150 ? template.substring(0, 150) + '...' : template;
                            templatesEmbed.addFields([
                                { name: `📌 ${respName}`, value: truncatedTemplate || 'قالب فارغ', inline: false }
                            ]);
                        }
                    }

                    await interaction.update({
                        content: '',
                        embeds: [templatesEmbed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('report_manage_templates')
                                    .setLabel('➡️ العودة')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    return;

                case 'report_template_select_resp':
                    // إعادة تحميل المسؤوليات من الملف للتأكد من أحدث البيانات
                    let latestResponsibilities = {};
                    try {
                        if (fs.existsSync(responsibilitiesPath)) {
                            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
                            latestResponsibilities = JSON.parse(data);
                        }
                    } catch (error) {
                        console.error('[Report] ❌ خطأ في قراءة المسؤوليات:', error);
                    }

                    responseContent = 'اختر المسؤولية لتعديل قالبها:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            createResponsibilitySelectMenu(
                                latestResponsibilities, 
                                'report_template_edit_select', 
                                'اختر المسؤولية لتعديل قالبها'
                            )
                        ),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_manage_templates')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_template_apply_all_btn':
                    const applyAllModal = new ModalBuilder()
                        .setCustomId('report_template_apply_all_modal')
                        .setTitle('تطبيق قالب على جميع المسؤوليات');

                    const allTemplateInput = new TextInputBuilder()
                        .setCustomId('template_text_all')
                        .setLabel('القالب الجديد')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('اكتب القالب الذي تريد تطبيقه على جميع المسؤوليات...')
                        .setRequired(true);

                    applyAllModal.addComponents(new ActionRowBuilder().addComponents(allTemplateInput));

                    try {
                        await interaction.showModal(applyAllModal);
                    } catch (error) {
                        console.error('Error showing apply all modal:', error);
                        await interaction.reply({ 
                            content: '❌ حدث خطأ في عرض نموذج القالب.', 
                            ephemeral: true 
                        }).catch(() => {});
                    }
                    return;

                case 'report_advanced_settings':
                    responseContent = 'اختر من الإعدادات المتقدمة:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_set_channel_button')
                                .setLabel('تحديد قناة التقارير')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('report_set_dms_button')
                                .setLabel('تحديد خاص الأونر')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('report_toggle_points')
                                .setLabel('تغيير نظام النقاط')
                                .setStyle(ButtonStyle.Success)
                        ),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_set_approvers')
                                .setLabel('تحديد المعتمدين')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('report_back_to_main')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_set_approvers':
                    await interaction.editReply({
                        content: 'اختر نوع المعتمدين للموافقة على التقارير:',
                        components: [
                            new ActionRowBuilder().addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId('report_select_approver_type')
                                    .setPlaceholder('اختر نوع المعتمدين')
                                    .addOptions([
                                        {
                                            label: 'الأونرات فقط',
                                            description: 'فقط أصحاب البوت يمكنهم الموافقة',
                                            value: 'owners'
                                        },
                                        {
                                            label: 'رولات محددة',
                                            description: 'أعضاء برولات معينة يمكنهم الموافقة',
                                            value: 'roles'
                                        },
                                        {
                                            label: 'مسؤوليات محددة',
                                            description: 'أعضاء مسؤوليات معينة يمكنهم الموافقة',
                                            value: 'responsibility'
                                        }
                                    ])
                            ),
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('report_advanced_settings')
                                    .setLabel('➡️ العودة')
                                    .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    return;

                case 'report_set_channel_button':
                    const channelMenu = new ChannelSelectMenuBuilder()
                        .setCustomId('report_channel_select')
                        .setPlaceholder('اختر قناة لإرسال التقارير إليها')
                        .addChannelTypes(ChannelType.GuildText);

                    responseContent = 'اختر القناة من القائمة:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(channelMenu),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_advanced_settings')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;
            }

            // Handle approve/reject buttons (special handling)
            if (customId.startsWith('report_approve_') || customId.startsWith('report_reject_')) {
                const reportId = customId.replace('report_approve_', '').replace('report_reject_', '');
                const reportData = client.pendingReports?.get(reportId);
                const isApprove = customId.startsWith('report_approve_');

                if (!reportData) {
                    return await interaction.editReply({ 
                        content: '❌ لم يتم العثور على هذا التقرير أو تمت معالجته مسبقاً.', 
                        components: [] 
                    });
                }

                // التحقق من أن التقرير لم تتم معالجته من قبل
                if (reportData.processed) {
                    return await interaction.editReply({ 
                        content: '❌ تمت معالجة هذا التقرير مسبقاً.', 
                        components: [] 
                    });
                }

                // وضع علامة أن التقرير قيد المعالجة
                reportData.processed = true;
                reportData.processedBy = interaction.user.id;
                reportData.processedAt = Date.now();
                client.pendingReports.set(reportId, reportData);

                // Check permissions based on approverType
                let hasPermission = false;

                if (config.approverType === 'owners') {
                    hasPermission = BOT_OWNERS.includes(interaction.user.id);
                } else if (config.approverType === 'roles' && config.approverTargets && config.approverTargets.length > 0) {
                    hasPermission = interaction.member.roles.cache.some(role => config.approverTargets.includes(role.id));
                } else if (config.approverType === 'responsibility' && config.approverTargets && config.approverTargets.length > 0) {
                    // Check if user is in any of the specified responsibilities
                    for (const respName of config.approverTargets) {
                        if (responsibilities[respName] && responsibilities[respName].responsibles) {
                            if (responsibilities[respName].responsibles.includes(interaction.user.id)) {
                                hasPermission = true;
                                break;
                            }
                        }
                    }
                } else {
                    // Default to owners if not configured
                    hasPermission = BOT_OWNERS.includes(interaction.user.id);
                }

                if (!hasPermission) {
                    // إلغاء علامة المعالجة في حالة عدم وجود صلاحية
                    reportData.processed = false;
                    delete reportData.processedBy;
                    delete reportData.processedAt;
                    client.pendingReports.set(reportId, reportData);

                    return await interaction.editReply({ 
                        content: '❌ ليس لديك صلاحية للموافقة أو رفض التقارير!', 
                        components: [] 
                    });
                }

                // Update the original message
                const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(isApprove ? '#00ff00' : '#ff0000')
                    .addFields([
                        { 
                            name: '✅ الحالة', 
                            value: isApprove ? `تمت الموافقة بواسطة <@${interaction.user.id}>` : `تم الرفض بواسطة <@${interaction.user.id}>`, 
                            inline: false 
                        }
                    ]);

                await interaction.editReply({ embeds: [originalEmbed], components: [] });

                // Award points if approved and pointsOnReport is true
                if (isApprove && config.pointsOnReport) {
                    const { claimerId, responsibilityName, timestamp } = reportData;
                    if (!points[responsibilityName]) points[responsibilityName] = {};
                    if (!points[responsibilityName][claimerId]) points[responsibilityName][claimerId] = {};
                    if (typeof points[responsibilityName][claimerId] === 'number') {
                        const oldPoints = points[responsibilityName][claimerId];
                        points[responsibilityName][claimerId] = {
                            [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints
                        };
                    }
                    if (!points[responsibilityName][claimerId][timestamp]) {
                        points[responsibilityName][claimerId][timestamp] = 0;
                    }
                    points[responsibilityName][claimerId][timestamp] += 1;
                    scheduleSave();
                }

                // Send notification to the user
                try {
                    const user = await client.users.fetch(reportData.claimerId);
                    const notificationEmbed = colorManager.createEmbed()
                        .setTitle(isApprove ? '✅ تمت الموافقة على تقريرك' : '❌ تم رفض تقريرك')
                        .setDescription(`**المسؤولية :** ${reportData.responsibilityName}\n**السبب :** ${reportData.reason}\n**التقرير :** ${reportData.reportText || 'غير متوفر'}`)
                        .setColor(isApprove ? '#00ff00' : '#ff0000')
                        .setFooter({ text: `${isApprove ? 'تمت الموافقة' : 'تم الرفض'} بواسطة ${interaction.user.tag}` })
                        .setTimestamp();

                    if (isApprove && config.pointsOnReport) {
                        notificationEmbed.addFields([
                            { name: ' النقاط', value: '✅️', inline: false }
                        ]);
                    }

                    await user.send({ embeds: [notificationEmbed] });
                } catch (err) {
                    console.error('Failed to send notification to user:', err);
                }

                // Remove from pending reports
                client.pendingReports.delete(reportId);
                scheduleSave();

                return;
            }

            // Handle saving if needed
            if (shouldSave) {
                if (saveReportsConfig(guildId, config)) {
                    if (responseContent) {
                        await interaction.followUp({ content: responseContent, ephemeral: true });
                    }
                } else {
                    await interaction.followUp({ content: '❌ فشل في حفظ الإعدادات.', ephemeral: true });
                }
            }

            // Update the message
            try {
                if (shouldShowMain) {
                    await interaction.editReply({ 
                        content: '', 
                        embeds: [createMainEmbed(client, guildId)], 
                        components: [createMainButtons(guildId)] 
                    });
                } else if (newComponents) {
                    await interaction.editReply({ 
                        content: responseContent, 
                        embeds: [], 
                        components: newComponents 
                    });
                }
            } catch (editError) {
                console.error('خطأ في تحديث الرسالة:', editError);

                // محاولة إرسال رد جديد إذا فشل التحديث
                if (!interaction.replied) {
                    await interaction.reply({
                        content: responseContent || '✅ تم تنفيذ الإجراء بنجاح',
                        ephemeral: true
                    }).catch(() => {});
                }
            }

        } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
            let shouldSave = false;
            let responseContent = '';

            // Handle other select menus
            if (interaction.isStringSelectMenu()) {
                switch (customId) {
                    case 'report_template_edit_select':
                        // فتح Modal لتعديل قالب المسؤولية المحددة
                        const selectedResp = interaction.values[0];
                        
                        if (selectedResp === 'none') {
                            await interaction.reply({
                                content: '❌ لا توجد مسؤوليات! يجب إنشاء مسؤوليات أولاً.',
                                ephemeral: true
                            });
                            return;
                        }

                        const currentTemplate = config.templates[selectedResp] || '';
                        
                        const editModal = new ModalBuilder()
                            .setCustomId(`report_template_save_modal_${selectedResp}`)
                            .setTitle(`تعديل قالب: ${selectedResp}`);

                        const templateInput = new TextInputBuilder()
                            .setCustomId('template_text')
                            .setLabel('القالب الجديد')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('اكتب القالب الجديد للمسؤولية...')
                            .setValue(currentTemplate)
                            .setRequired(true);

                        editModal.addComponents(new ActionRowBuilder().addComponents(templateInput));

                        try {
                            await interaction.showModal(editModal);
                        } catch (error) {
                            console.error('Error showing edit modal:', error);
                            await interaction.reply({ 
                                content: '❌ حدث خطأ في عرض نموذج التعديل.', 
                                ephemeral: true 
                            }).catch(() => {});
                        }
                        return;

                    case 'report_select_approver_type':
                        const approverType = interaction.values[0];
                        config.approverType = approverType;

                        if (approverType === 'owners') {
                            config.approverTargets = [];
                            config.approverType = 'owners'; // التأكد من حفظ النوع
                            if (saveReportsConfig(guildId, config)) {
                                // إعادة تحميل الإعدادات المحدثة
                                const updatedConfig = loadReportsConfig(guildId);
                                await interaction.editReply({
                                    content: '✅ تم تعيين المعتمدين: الأونرات فقط',
                                    embeds: [createMainEmbed(client, guildId)],
                                    components: [createMainButtons(guildId)]
                                });
                            } else {
                                await interaction.editReply({
                                    content: '❌ فشل في حفظ الإعدادات',
                                    embeds: [],
                                    components: []
                                });
                            }
                            return;
                        } else if (approverType === 'roles') {
                            await interaction.editReply({
                                content: 'اختر الرولات المعتمدة للموافقة على التقارير:',
                                embeds: [],
                                components: [
                                    new ActionRowBuilder().addComponents(
                                        new RoleSelectMenuBuilder()
                                            .setCustomId('report_select_approver_roles')
                                            .setPlaceholder('اختر الرولات المعتمدة...')
                                            .setMaxValues(10)
                                    ),
                                    new ActionRowBuilder().addComponents(
                                        new ButtonBuilder()
                                            .setCustomId('report_set_approvers')
                                            .setLabel('➡️ العودة')
                                            .setStyle(ButtonStyle.Secondary)
                                    )
                                ]
                            });
                            return;
                        } else if (approverType === 'responsibility') {
                            const respOptions = Object.keys(responsibilities).slice(0, 25).map(name => ({
                                label: name,
                                value: name,
                                description: `السماح لمسؤولي ${name} بالموافقة`
                            }));

                            if (respOptions.length === 0) {
                                await interaction.editReply({
                                    content: '❌ لا توجد مسؤوليات معرفة! يرجى إنشاء مسؤوليات أولاً.',
                                    components: []
                                });
                                return;
                            }

                            await interaction.editReply({
                                content: 'اختر المسؤوليات المعتمدة للموافقة على التقارير:',
                                embeds: [],
                                components: [
                                    new ActionRowBuilder().addComponents(
                                        new StringSelectMenuBuilder()
                                            .setCustomId('report_select_approver_responsibilities')
                                            .setPlaceholder('اختر المسؤوليات المعتمدة...')
                                            .setMaxValues(Math.min(respOptions.length, 10))
                                            .addOptions(respOptions)
                                    ),
                                    new ActionRowBuilder().addComponents(
                                        new ButtonBuilder()
                                            .setCustomId('report_set_approvers')
                                            .setLabel('➡️ العودة')
                                            .setStyle(ButtonStyle.Secondary)
                                    )
                                ]
                            });
                            return;
                        }
                        break;

                    case 'report_select_approver_responsibilities':
                        config.approverTargets = interaction.values;
                        config.approverType = 'responsibility'; // التأكد من حفظ النوع
                        if (saveReportsConfig(guildId, config)) {
                            // إعادة تحميل الإعدادات المحدثة
                            const updatedConfig = loadReportsConfig(guildId);
                            await interaction.editReply({
                                content: `✅ تم تعيين المعتمدين: ${interaction.values.join(', ')}`,
                                embeds: [createMainEmbed(client, guildId)],
                                components: [createMainButtons(guildId)]
                            });
                        } else {
                            await interaction.editReply({
                                content: '❌ فشل في حفظ الإعدادات',
                                embeds: [],
                                components: []
                            });
                        }
                        return;

                    case 'report_confirm_req_report':
                        config.requiredFor = interaction.values;
                        shouldSave = true;
                        responseContent = '✅ تم تحديث المسؤوليات المطلوب تقرير لها بنجاح.';
                        break;

                    case 'report_confirm_req_approval':
                        config.approvalRequiredFor = interaction.values;
                        shouldSave = true;
                        responseContent = '✅ تم تحديث المسؤوليات المطلوب موافقة تقريرها بنجاح.';
                        break;
                }
            }

            // Handle role selection for approvers
            if (interaction.isRoleSelectMenu() && customId === 'report_select_approver_roles') {
                // Defer the update first
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferUpdate();
                }
                
                config.approverTargets = interaction.values;
                config.approverType = 'roles'; // التأكد من حفظ النوع
                if (saveReportsConfig(guildId, config)) {
                    const rolesMentions = interaction.values.map(id => `<@&${id}>`).join(', ');
                    // إعادة تحميل الإعدادات المحدثة
                    const updatedConfig = loadReportsConfig(guildId);
                    await interaction.editReply({
                        content: `✅ تم تعيين المعتمدين: ${rolesMentions}`,
                        embeds: [createMainEmbed(client, guildId)],
                        components: [createMainButtons(guildId)]
                    });
                } else {
                    await interaction.editReply({
                        content: '❌ فشل في حفظ الإعدادات',
                        embeds: [],
                        components: []
                    });
                }
                return;
            }

            // Handle channel selection
            if (interaction.isChannelSelectMenu() && customId === 'report_channel_select') {
                const channelId = interaction.values[0];
                config.reportChannel = channelId;
                shouldSave = true;
                responseContent = `✅ تم تحديد قناة التقارير: <#${channelId}>`;
            }

            // Handle saving and response
            if (shouldSave) {
                if (saveReportsConfig(guildId, config)) {
                    if (responseContent) {
                        await interaction.followUp({ content: responseContent, ephemeral: true });
                    }
                } else {
                    await interaction.followUp({ content: '❌ فشل في حفظ الإعدادات.', ephemeral: true });
                }
            }

            // Return to main menu if needed
            if (responseContent && !responseContent.startsWith('✅')) {
                // If it's not a success message, show the main menu
                await interaction.editReply({ 
                    content: responseContent, 
                    embeds: [createMainEmbed(client, guildId)], 
                    components: [createMainButtons(guildId)] 
                });
            } else if (responseContent) {
                // If it's a success message, just show the confirmation
                 await interaction.editReply({ 
                    content: responseContent, 
                    embeds: [], 
                    components: [] 
                });
            }


        }

    } catch (error) {
        console.error('Error in report interaction handler:', error);

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ 
                    content: '❌ حدث خطأ في معالجة التفاعل.', 
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ 
                    content: '❌ حدث خطأ في معالجة التفاعل.', 
                    ephemeral: true 
                });
            }
        } catch (followUpError) {
            console.error('Error sending error message:', followUpError);
        }
    }
}

// تسجيل معالج التفاعلات المستقل
function registerInteractionHandler(client) {
    console.log('🔧 تسجيل معالج تفاعلات التقارير...');

    client.on('interactionCreate', async (interaction) => {
        // التحقق من أن التفاعل يخص نظام التقارير
        if (!interaction.customId || !interaction.customId.startsWith('report_')) {
            return;
        }

        console.log(`[Report] معالجة تفاعل: ${interaction.customId} من ${interaction.user.tag}`);

        try {
            // إعادة تحميل البيانات من الملفات
            const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
            const pointsPath = path.join(__dirname, '..', 'data', 'points.json');
            const botConfigPath = path.join(__dirname, '..', 'data', 'botConfig.json');

            let responsibilities = {};
            let points = {};
            let BOT_OWNERS = [];

            try {
                if (fs.existsSync(responsibilitiesPath)) {
                    responsibilities = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
                }
                if (fs.existsSync(pointsPath)) {
                    points = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
                }
                if (fs.existsSync(botConfigPath)) {
                    const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
                    BOT_OWNERS = botConfig.owners || [];
                }
            } catch (error) {
                console.error('❌ خطأ في قراءة البيانات:', error);
            }

            // دالة للحفظ
            const scheduleSave = () => {
                try {
                    fs.writeFileSync(pointsPath, JSON.stringify(points, null, 2));
                    const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
                    const pendingReportsObj = {};
                    for (const [key, value] of client.pendingReports.entries()) {
                        pendingReportsObj[key] = value;
                    }
                    botConfig.pendingReports = pendingReportsObj;
                    fs.writeFileSync(botConfigPath, JSON.stringify(botConfig, null, 2));
                } catch (error) {
                    console.error('❌ خطأ في حفظ البيانات:', error);
                }
            };

            // إنشاء كائن السياق
            const context = {
                client,
                responsibilities,
                points,
                scheduleSave,
                BOT_OWNERS,
                reportsConfig: {},
                logConfig: client.logConfig,
                colorManager
            };

            // استدعاء المعالج
            await handleInteraction(interaction, context);

        } catch (error) {
            console.error('خطأ في معالج تفاعلات التقارير:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ في معالجة التفاعل.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    });

    console.log('✅ تم تسجيل معالج تفاعلات التقارير بنجاح');
}

module.exports = { name, execute, handleInteraction, registerInteractionHandler };