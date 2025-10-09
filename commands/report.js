const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder } = require('discord.js');
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
            allConfigs = JSON.parse(fs.readFileSync(reportsPath, 'utf8')); 
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
        .setTitle('⚙️ إعدادات نظام التقارير')
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

function createResponsibilitySelectMenu(responsibilities, customId, placeholder) {
    // التأكد من أن responsibilities كائن صحيح
    if (!responsibilities || typeof responsibilities !== 'object') {
        responsibilities = {};
    }

    const options = Object.keys(responsibilities).map(respName => ({
        label: respName,
        value: respName,
        description: `إدارة ${respName}`
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
        .setTitle('📝 إدارة قوالب التقارير')
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

                const reportText = interaction.fields.getTextInputValue('report_text');
                
                // Update pending report with the text
                reportData.reportText = reportText;
                reportData.submittedAt = Date.now();
                client.pendingReports.set(reportId, reportData);
                
                // Create report embed
                const reportEmbed = new EmbedBuilder()
                    .setTitle('📋 تقرير مهمة جديد')
                    .setDescription(`**المسؤولية:** ${reportData.responsibilityName}\n**من قِبل:** <@${reportData.claimerId}> (${reportData.displayName})\n**السبب:** ${reportData.reason}`)
                    .addFields([
                        { name: '📝 التقرير', value: reportText, inline: false }
                    ])
                    .setColor(colorManager.getColor(client))
                    .setTimestamp()
                    .setFooter({ text: `Report ID: ${reportId}` });
                
                // Check if approval is required
                const isApprovalRequired = config.approvalRequiredFor && 
                                          Array.isArray(config.approvalRequiredFor) && 
                                          config.approvalRequiredFor.includes(reportData.responsibilityName);
                
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
                    if (config.reportChannel === '0') {
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
                        await interaction.editReply({ 
                            content: '✅ تم إرسال التقرير للأونرات بنجاح!' 
                        });
                    } else if (config.reportChannel) {
                        // Send to specific channel
                        const reportChannel = await client.channels.fetch(config.reportChannel);
                        await reportChannel.send({ 
                            embeds: [reportEmbed], 
                            components: components 
                        });
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
                    await interaction.editReply({ 
                        content: '❌ حدث خطأ في إرسال التقرير!' 
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
                .setTitle('كتابة تقرير المهمة');

            const template = config.templates[reportData.responsibilityName] || '';
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
                    responseContent = 'اختر الإجراء المطلوب للمسؤوليات:';
                    newComponents = [
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
                    ];
                    break;

                case 'report_select_req_report':
                    responseContent = 'اختر المسؤوليات التي تتطلب تقرير:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            createResponsibilitySelectMenu(
                                responsibilities, 
                                'report_confirm_req_report', 
                                'اختر المسؤوليات المطلوب تقرير لها'
                            )
                        ),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('report_manage_resps')
                                .setLabel('➡️ العودة')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                    break;

                case 'report_select_req_approval':
                    responseContent = 'اختر المسؤوليات التي تتطلب موافقة على التقرير:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            createResponsibilitySelectMenu(
                                responsibilities, 
                                'report_confirm_req_approval', 
                                'اختر المسؤوليات المطلوب موافقة تقريرها'
                            )
                        ),
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

                case 'report_template_select_resp':
                    responseContent = 'اختر المسؤولية لتعديل قالبها:';
                    newComponents = [
                        new ActionRowBuilder().addComponents(
                            createResponsibilitySelectMenu(
                                responsibilities, 
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
                    responseContent = 'اختر نوع المعتمدين للموافقة على التقارير:';
                    newComponents = [
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
                    ];
                    break;

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
                    return await interaction.followUp({ 
                        content: '❌ لم يتم العثور على هذا التقرير أو تمت معالجته مسبقاً.', 
                        ephemeral: true 
                    });
                }
                
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
                    return await interaction.followUp({ 
                        content: '❌ ليس لديك صلاحية للموافقة أو رفض التقارير!', 
                        ephemeral: true 
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
                
                await interaction.update({ embeds: [originalEmbed], components: [] });
                
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
                        .setDescription(`**المسؤولية:** ${reportData.responsibilityName}\n**السبب:** ${reportData.reason}\n**التقرير:** ${reportData.reportText || 'غير متوفر'}`)
                        .setColor(isApprove ? '#00ff00' : '#ff0000')
                        .setFooter({ text: `${isApprove ? 'تمت الموافقة' : 'تم الرفض'} بواسطة ${interaction.user.tag}` })
                        .setTimestamp();
                    
                    if (isApprove && config.pointsOnReport) {
                        notificationEmbed.addFields([
                            { name: '🎁 النقاط', value: 'تم منحك نقطة للمهمة', inline: false }
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

        } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
            let responseContent = '';
            let shouldSave = false;

            switch (customId) {
                case 'report_confirm_req_report':
                    config.requiredFor = interaction.values;
                    shouldSave = true;
                    responseContent = '✅ تم تحديد المسؤوليات المطلوب تقرير لها.';
                    break;

                case 'report_confirm_req_approval':
                    config.approvalRequiredFor = interaction.values;
                    shouldSave = true;
                    responseContent = '✅ تم تحديد المسؤوليات المطلوب موافقة تقريرها.';
                    break;

                case 'report_channel_select':
                    config.reportChannel = interaction.values[0];
                    shouldSave = true;
                    responseContent = '✅ تم تحديد قناة التقارير.';
                    break;

                case 'report_select_approver_type':
                    const approverType = interaction.values[0];
                    config.approverType = approverType;
                    
                    if (approverType === 'owners') {
                        config.approverTargets = [];
                        shouldSave = true;
                        responseContent = '✅ تم تحديد الأونرات كمعتمدين.';
                    } else if (approverType === 'roles') {
                        // Show role selection menu
                        const guild = interaction.guild;
                        const roles = guild.roles.cache
                            .filter(r => r.name !== '@everyone')
                            .sort((a, b) => b.position - a.position)
                            .first(25);
                        
                        const roleOptions = roles.map(role => ({
                            label: role.name,
                            value: role.id,
                            description: `موقع: ${role.position}`
                        }));
                        
                        const roleSelectMenu = new StringSelectMenuBuilder()
                            .setCustomId('report_select_approver_roles')
                            .setPlaceholder('اختر الرولات المعتمدة')
                            .setMinValues(1)
                            .setMaxValues(roleOptions.length)
                            .addOptions(roleOptions);
                        
                        await interaction.deferUpdate();
                        await interaction.editReply({ 
                            content: 'اختر الرولات التي يمكنها الموافقة على التقارير:', 
                            components: [
                                new ActionRowBuilder().addComponents(roleSelectMenu),
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
                        // Show responsibility selection menu
                        const respMenu = createResponsibilitySelectMenu(
                            responsibilities, 
                            'report_select_approver_responsibilities', 
                            'اختر المسؤوليات المعتمدة'
                        );
                        respMenu.setMinValues(1);
                        respMenu.setMaxValues(Math.min(Object.keys(responsibilities).length, 25));
                        
                        await interaction.deferUpdate();
                        await interaction.editReply({ 
                            content: 'اختر المسؤوليات التي يمكن لأعضائها الموافقة على التقارير:', 
                            components: [
                                new ActionRowBuilder().addComponents(respMenu),
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
                
                case 'report_select_approver_roles':
                    config.approverTargets = interaction.values;
                    shouldSave = true;
                    responseContent = '✅ تم تحديد الرولات المعتمدة.';
                    break;
                
                case 'report_select_approver_responsibilities':
                    config.approverTargets = interaction.values;
                    shouldSave = true;
                    responseContent = '✅ تم تحديد المسؤوليات المعتمدة.';
                    break;
                
                case 'report_template_edit_select':
                    const selectedResp = interaction.values[0];
                    if (selectedResp === 'none') {
                        return await interaction.reply({ 
                            content: '❌ لا توجد مسؤوليات متاحة.', 
                            ephemeral: true 
                        }).catch(() => {});
                    }

                    // التحقق من وجود المسؤولية
                    if (!responsibilities[selectedResp]) {
                        return await interaction.reply({ 
                            content: `❌ المسؤولية "${selectedResp}" غير موجودة. يرجى تحديث قائمة المسؤوليات.`, 
                            ephemeral: true 
                        }).catch(() => {});
                    }

                    const editModal = new ModalBuilder()
                        .setCustomId(`report_template_save_modal_${selectedResp}`)
                        .setTitle(`تعديل قالب: ${selectedResp}`);

                    const currentTemplate = config.templates[selectedResp] || '';
                    const templateInput = new TextInputBuilder()
                        .setCustomId('template_text')
                        .setLabel('قالب التقرير')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(currentTemplate)
                        .setPlaceholder('اكتب قالب التقرير هنا...')
                        .setRequired(false);

                    editModal.addComponents(new ActionRowBuilder().addComponents(templateInput));
                    
                    try {
                        await interaction.showModal(editModal);
                    } catch (error) {
                        console.error('Error showing template edit modal:', error);
                        await interaction.reply({ 
                            content: '❌ حدث خطأ في عرض نموذج التعديل.', 
                            ephemeral: true 
                        }).catch(() => {});
                    }
                    return;
            }

            // Handle saving and response
            if (shouldSave) {
                if (saveReportsConfig(guildId, config)) {
                    await interaction.followUp({ content: responseContent, ephemeral: true });
                } else {
                    await interaction.followUp({ content: '❌ فشل في حفظ الإعدادات.', ephemeral: true });
                }
            }

            // Return to main menu
            try {
                await interaction.editReply({ 
                    content: '', 
                    embeds: [createMainEmbed(client, guildId)], 
                    components: [createMainButtons(guildId)] 
                });
            } catch (editError) {
                console.error('خطأ في العودة للقائمة الرئيسية:', editError);
                
                // محاولة إرسال رسالة جديدة
                if (!interaction.replied) {
                    await interaction.reply({
                        embeds: [createMainEmbed(client, guildId)],
                        components: [createMainButtons(guildId)],
                        ephemeral: true
                    }).catch(() => {});
                }
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