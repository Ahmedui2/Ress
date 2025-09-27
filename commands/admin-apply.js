const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { collectUserStats, createUserStatsEmbed } = require('../utils/userStatsCollector');
const colorManager = require('../utils/colorManager');

const adminApplicationsPath = path.join(__dirname, '..', 'data', 'adminApplications.json');

// دالة لقراءة إعدادات التقديم الإداري
function loadAdminApplicationSettings() {
    try {
        if (fs.existsSync(adminApplicationsPath)) {
            const data = fs.readFileSync(adminApplicationsPath, 'utf8');
            return JSON.parse(data);
        }
        return {
            settings: {
                applicationChannel: null,
                approvers: { type: "roles", list: [] },
                maxPendingPerAdmin: 3,
                rejectCooldownHours: 24
            },
            pendingApplications: {},
            rejectedCooldowns: {}
        };
    } catch (error) {
        console.error('خطأ في قراءة إعدادات التقديم الإداري:', error);
        return {
            settings: {
                applicationChannel: null,
                approvers: { type: "roles", list: [] },
                maxPendingPerAdmin: 3,
                rejectCooldownHours: 24
            },
            pendingApplications: {},
            rejectedCooldowns: {}
        };
    }
}

// دالة لحفظ إعدادات التقديم الإداري
function saveAdminApplicationSettings(data) {
    try {
        fs.writeFileSync(adminApplicationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات التقديم الإداري:', error);
        return false;
    }
}

// دالة لتحميل أدوار المشرفين
function loadAdminRoles() {
    try {
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        if (fs.existsSync(adminRolesPath)) {
            const data = fs.readFileSync(adminRolesPath, 'utf8');
            const adminRoles = JSON.parse(data);
            return Array.isArray(adminRoles) ? adminRoles : [];
        }
        return [];
    } catch (error) {
        console.error('خطأ في تحميل أدوار المشرفين:', error);
        return [];
    }
}

// التحقق من صلاحية استخدام الأمر
function canUseCommand(member) {
    const adminRoles = loadAdminRoles();
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id));

    // فحص إذا كان مالك السيرفر
    const isGuildOwner = member.guild.ownerId === member.id;

    // فحص إذا كان من مالكي البوت
    const BOT_OWNERS = global.BOT_OWNERS || [];
    const isBotOwner = BOT_OWNERS.includes(member.id);

    return hasAdminRole || isGuildOwner || isBotOwner;
}

// التحقق من وجود أدوار إدارية للمرشح
function candidateHasAdminRoles(member) {
    const adminRoles = loadAdminRoles();
    return member.roles.cache.some(role => adminRoles.includes(role.id));
}

// التحقق من الكولداون
function isInCooldown(userId, settings) {
    const cooldown = settings.rejectedCooldowns[userId];
    if (!cooldown) return false;

    const cooldownEnd = new Date(cooldown.rejectedAt).getTime() + (settings.settings.rejectCooldownHours * 60 * 60 * 1000);
    const now = Date.now();

    if (now >= cooldownEnd) {
        // انتهى الكولداون، احذفه
        delete settings.rejectedCooldowns[userId];
        saveAdminApplicationSettings(settings);
        return false;
    }

    return {
        inCooldown: true,
        endsAt: new Date(cooldownEnd),
        timeLeft: cooldownEnd - now
    };
}

// التحقق من الطلبات المعلقة للمرشح
function hasPendingApplication(userId, settings) {
    return Object.values(settings.pendingApplications).some(app => app.candidateId === userId);
}

// عد الطلبات المعلقة للإداري
function countPendingApplicationsByAdmin(adminId, settings) {
    return Object.values(settings.pendingApplications).filter(app => app.requesterId === adminId).length;
}

// تنسيق الوقت المتبقي
function formatTimeLeft(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
        return `${hours} ساعة و ${minutes} دقيقة`;
    } else {
        return `${minutes} دقيقة`;
    }
}

module.exports = {
    name: 'admin-apply',
    aliases: ['إدارة', 'ادارة'],
    description: 'تقديم شخص للحصول على صلاحيات إدارية',

    async execute(interaction) {
        try {
            // التحقق من صلاحية استخدام الأمر
            if (!canUseCommand(interaction.member)) {
                await interaction.reply({
                    content: '**ليس لديك صلاحية لاستخدام هذا الأمر.**'
                });
                return;
            }

            // تحميل الإعدادات
            const settings = loadAdminApplicationSettings();

            // التحقق من إعداد النظام
            if (!settings.settings.applicationChannel) {
                await interaction.reply({
                    content: '**لم يتم إعداد نظام التقديم الإداري بعد. استخدم أمر `setadmin` أولاً.**'
                });
                return;
            }

            // التحقق من وجود القناة
            const applicationChannel = interaction.guild.channels.cache.get(settings.settings.applicationChannel);
            if (!applicationChannel) {
                await interaction.reply({
                    content: '**روم التقديم الإداري غير موجودة أو محذوفة. استخدم أمر `setadmin` لإعادة تحديدها.**'
                });
                return;
            }

            // التحقق من حد الطلبات المعلقة للإداري
            const pendingCount = countPendingApplicationsByAdmin(interaction.user.id, settings);
            if (pendingCount >= settings.settings.maxPendingPerAdmin) {
                await interaction.reply({
                    content: `لديك بالفعل ${pendingCount} طلبات معلقة. الحد الأقصى هو ${settings.settings.maxPendingPerAdmin} طلبات.`
                });
                return;
            }

            // استخراج المستخدم المرشح من الخيارات
            let candidate = null;
            let candidateId = null;

            // message command - استخراج المرشح من محتوى الرسالة
            const messageContent = interaction.message?.content || '';
            const mentionMatch = messageContent.match(/<@!?(\d+)>/);

            if (!mentionMatch) {
                await interaction.reply({
                    content: '** الامر يتم استخدام : ادارة @العضو **'
                });
                return;
            }

            candidateId = mentionMatch[1];
            candidate = await interaction.guild.members.fetch(candidateId).catch(() => null);

            if (!candidate) {
                await interaction.reply({
                    content: '**لم يتم العثور على المستخدم المرشح في السيرفر.**'
                });
                return;
            }

            // التحقق من أن المرشح ليس بوت
            if (candidate.user.bot) {
                await interaction.reply({
                    content: '**لا يمكن ترشيح البوتات  للحصول على ادارة.**'
                });
                return;
            }

            // التحقق من وجود أدوار إدارية للمرشح
            if (candidateHasAdminRoles(candidate)) {
                await interaction.reply({
                    content: `**${candidate.displayName} لديه بالفعل رولات إدارية.**`
                });
                return;
            }

            // التحقق من الكولداون
            const cooldownCheck = isInCooldown(candidateId, settings);
            if (cooldownCheck) {
                const timeLeft = formatTimeLeft(cooldownCheck.timeLeft);
                await interaction.reply({
                    content: `**${candidate.displayName} تم رفضه مسبقاً وعليه كولداون.\nالوقت المتبقي: ${timeLeft}**`
                });
                return;
            }

            // التحقق من وجود طلب معلق للمرشح
            if (hasPendingApplication(candidateId, settings)) {
                await interaction.reply({
                    content: `**${candidate.displayName} لديه بالفعل طلب تقديم معلق.**`
                });
                return;
            }

            // جمع إحصائيات المرشح
            await interaction.deferReply();

            const userStats = await collectUserStats(candidate);
            const statsEmbed = await createUserStatsEmbed(userStats, colorManager);

            // إنشاء معرف فريد أبسط للطلب مع معلومات إضافية
            const applicationId = `${Date.now()}_${candidateId}_${interaction.user.id}`;

            // إنشاء embed مبسط للعرض الأولي مع النصوص الديناميكية
            const simpleEmbed = await createUserStatsEmbed(userStats, colorManager, true, interaction.member.displayName);

            // إنشاء أزرار الموافقة والرفض
            const approveButton = new ButtonBuilder()
                .setCustomId(`admin_approve_${applicationId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success);

            const rejectButton = new ButtonBuilder()
                .setCustomId(`admin_reject_${applicationId}`)
                .setLabel('Reject')
                .setStyle(ButtonStyle.Danger);

            // إنشاء منيو للتفاصيل الإضافية (للمعتمدين فقط)
            const detailsMenu = new StringSelectMenuBuilder()
                .setCustomId(`admin_details_${applicationId}`)
                .setPlaceholder('تفاصيل عن العضو')
                .addOptions([
                    {
                        label: 'Dates',
                        description: 'عرض تواريخ الانضمام وإنشاء الحساب',
                        value: 'dates',
                        
                    },
                    {
                        label: 'Evaluation',
                        description: 'عرض تقييم العضو والمعايير',
                        value: 'evaluation',
                        
                    },
                    {
                        label: 'Roles',
                        description: 'عرض جميع الرولات للعضو',
                        value: 'roles',
                       
                    },
                    {
                        label: 'Stats',
                        description: 'عرض تفاصيل النشاط',
                        value: 'advanced_stats',
                       
                    },
                    {
                        label: 'first ep',
                        description: 'العودة للعرض الأساسي',
                        value: 'simple_view',
                        
                    }
                ]);

            const row1 = new ActionRowBuilder()
                .addComponents(approveButton, rejectButton);

            const row2 = new ActionRowBuilder()
                .addComponents(detailsMenu);

            // إرسال الطلب إلى قناة التقديم أولاً
            try {
                await applicationChannel.send({
                    embeds: [simpleEmbed],
                    components: [row1, row2]
                });

                // حفظ الطلب في البيانات فقط بعد نجاح الإرسال
                settings.pendingApplications[applicationId] = {
                    candidateId: candidateId,
                    candidateName: candidate.displayName,
                    requesterId: interaction.user.id,
                    requesterName: interaction.member.displayName,
                    createdAt: new Date().toISOString(),
                    userStats: userStats
                };

                if (saveAdminApplicationSettings(settings)) {
                    // إضافة ريأكشن للرسالة الأصلية
                    if (interaction.message) {
                        await interaction.message.react('✅');
                    }

                   
            
                    console.log(`📋 تم إنشاء طلب تقديم إداري: ${candidateId} بواسطة ${interaction.user.id}`);
                } else {
                    await interaction.editReply({
                        content: '**⚠️ تم إرسال الطلب ولكن فشل في حفظ البيانات. قد تحدث مشاكل لاحقاً.**'
                    });
                }

            } catch (channelError) {
                console.error('خطأ في إرسال الطلب للقناة:', channelError);

                await interaction.editReply({
                    content: '**❌ فشل في إرسال الطلب إلى رزظ التقديم. تحقق من صلاحيات البوت في لروم.**'
                });
            }

        } catch (error) {
            console.error('خطأ في أمر إدارة:', error);

            const errorMessage = 'حدث خطأ في معالجة الطلب. حاول مرة أخرى.';

            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage });
            }
        }
    }
};

// دالة للتحقق من صلاحيات المعتمدين
function canApproveApplication(member, settings) {
    const approvers = settings.settings.approvers;

    // فحص إذا كان من مالكي البوت
    const BOT_OWNERS = global.BOT_OWNERS || [];
    const isBotOwner = BOT_OWNERS.includes(member.id);

    // فحص إذا كان مالك السيرفر
    const isGuildOwner = member.guild.ownerId === member.id;

    if (isBotOwner || isGuildOwner) {
        return true;
    }

    if (approvers.type === 'owners') {
        return isBotOwner;
    } else if (approvers.type === 'roles') {
        return member.roles.cache.some(role => approvers.list.includes(role.id));
    } else if (approvers.type === 'responsibility') {
        // فحص المسؤوليات
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
        try {
            if (fs.existsSync(responsibilitiesPath)) {
                const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
                const targetResp = approvers.list[0];

                if (responsibilitiesData[targetResp] && responsibilitiesData[targetResp].responsibles) {
                    return responsibilitiesData[targetResp].responsibles.includes(member.id);
                }
            }
        } catch (error) {
            console.error('خطأ في فحص المسؤوليات:', error);
        }
        return false;
    }

    return false;
}

// معالج تفاعلات نظام التقديم الإداري مع تحسينات الأمان والدقة
async function handleAdminApplicationInteraction(interaction) {
    try {
        const customId = interaction.customId;

        // فحص أولي للتفاعل
        if (!customId || typeof customId !== 'string') {
            console.log('❌ معرف تفاعل غير صحيح');
            return false;
        }

        // التحقق من أن التفاعل متعلق بالتقديم الإداري
        if (!customId.startsWith('admin_approve_') && !customId.startsWith('admin_reject_') && !customId.startsWith('admin_select_roles_') && !customId.startsWith('admin_details_')) {
            console.log('⚠️ التفاعل ليس متعلق بنظام التقديم الإداري:', customId);
            return false;
        }

        // فحص صحة التفاعل
        if (interaction.replied || interaction.deferred) {
            console.log('⚠️ تم تجاهل تفاعل تم الرد عليه مسبقاً');
            return true;
        }

        // فحص عمر التفاعل
        const interactionAge = Date.now() - interaction.createdTimestamp;
        if (interactionAge > 10 * 60 * 1000) { // 10 دقائق
            console.log('⚠️ تم تجاهل تفاعل قديم');
            return true;
        }

        // فحص إضافي للتأكد من صحة معرف التفاعل
        if (!customId || typeof customId !== 'string' || customId.length < 10) {
            console.log('⚠️ معرف تفاعل غير صحيح أو قصير جداً');
            return true;
        }

        console.log('✅ معالجة تفاعل التقديم الإداري:', customId);

        // معالجة منيو التفاصيل الإضافية
        if (customId.startsWith('admin_details_')) {
            const applicationId = customId.replace('admin_details_', '');
            const selectedDetail = interaction.values[0];

            const settings = loadAdminApplicationSettings();
            const application = settings.pendingApplications[applicationId];

            if (!application) {
                await interaction.reply({
                    content: '**❌ لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.**',
                    flags: 64
                });
                return true;
            }

            // التحقق من صلاحية المعتمد لعرض التفاصيل
            if (!canApproveApplication(interaction.member, settings)) {
                await interaction.reply({
                    content: '❌ ** لا تسوي خوي **.',
                    flags: 64
                });
                return true;
            }

            const userStats = application.userStats;
            let detailEmbed;

            switch (selectedDetail) {
                case 'dates':
                    detailEmbed = colorManager.createEmbed()
                        .setTitle(` ** Dates - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '**انضمام السيرفر**', value: `**${userStats.joinedServerFormatted}**`, inline: false },
                            { name: '**إنشاء الحساب**', value: `**${userStats.accountCreatedFormatted}**`, inline: false },
                            { name: '**المدة في السيرفر**', value: `**${userStats.timeInServerFormatted}`, inline: true },
                            { name: '**عمر الحساب**', value: `${userStats.accountAgeFormatted}`, inline: true },
                            { name: ' **آخر نشاط**', value: `**${userStats.lastActivity}**`, inline: true }
                        ])
;
                    break;

                case 'evaluation':
                    // تحميل إعدادات التقييم
                    const { loadEvaluationSettings, getEvaluationType } = require('../utils/userStatsCollector');
                    const evaluationSettings = loadEvaluationSettings();
                    const timeInServerDays = Math.floor(userStats.timeInServerMs / (24 * 60 * 60 * 1000));

                    // تحديد القيم المناسبة بناءً على الإعدادات
                    const messageCount = evaluationSettings.minMessages.resetWeekly ? userStats.weeklyMessages || 0 : userStats.realMessages;
                    const voiceTime = evaluationSettings.minVoiceTime.resetWeekly ? userStats.weeklyVoiceTime || 0 : userStats.realVoiceTime;
                    const reactionCount = evaluationSettings.minReactions.resetWeekly ? userStats.weeklyReactions || 0 : userStats.reactionsGiven || 0;

                    // تحديد النصوص المناسبة
                    const messageLabel = evaluationSettings.minMessages.resetWeekly ? "الرسائل : (أسبوعي)" : "الرسائل : (الإجمالي)";
                    const voiceLabel = evaluationSettings.minVoiceTime.resetWeekly ? "الفويس : (أسبوعي)" : "الفويس : (الإجمالي)";
                    const reactionLabel = evaluationSettings.minReactions.resetWeekly ? "الرياكتات : (أسبوعي)" : "الرياكتات : (الإجمالي)";

                    // تحديد التقييم العام
                    const evaluation = getEvaluationType(
                        userStats.realMessages, // إجمالي الرسائل
                        userStats.weeklyMessages || 0, // الرسائل الأسبوعية
                        userStats.realVoiceTime, // إجمالي الوقت الصوتي
                        userStats.weeklyVoiceTime || 0, // الوقت الصوتي الأسبوعي
                        userStats.reactionsGiven || 0, // إجمالي التفاعلات
                        userStats.weeklyReactions || 0, // التفاعلات الأسبوعية
                        userStats.activeDays, // أيام النشاط
                        timeInServerDays // أيام في السيرفر
                    );

                    detailEmbed = colorManager.createEmbed()
                        .setTitle(` **Evaluation**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: ` **${messageLabel}**`, value: `**${messageCount.toLocaleString()}**`, inline: true },
                            { name: ` **${voiceLabel}**`, value: `**${evaluationSettings.minVoiceTime.resetWeekly ? userStats.formattedWeeklyVoiceTime || 'لا يوجد' : userStats.formattedVoiceTime || 'لا يوجد'}**`, inline: true },
                            { name: ` **${reactionLabel}**`, value: `**${reactionCount.toLocaleString()}**`, inline: true },
                            { name: ' **النشاط**', value: userStats.activeDays >= evaluationSettings.activeDaysPerWeek.minimum ? '🟢 **نشط**' : '🔴 **غير نشط**', inline: true },
                            { name: '  **الخبرة**', value: timeInServerDays >= evaluationSettings.timeInServerDays.excellent ? '🟢 **خبرة ممتازة**' : timeInServerDays >= evaluationSettings.timeInServerDays.minimum ? '🟡 **خبرة جيدة**' : '🔴 **جديد**', inline: true }
                        ])
                        
                    break;

                case 'roles':
                    const rolesText = userStats.roles.length > 0
                        ? userStats.roles.map((role, index) => `**${index + 1}.** <@&${role.id}> (${role.name})`).join('\n')
                        : '**لا توجد رولات إضافية**';

                    detailEmbed = colorManager.createEmbed()
                        .setTitle(` ** Roles - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '**إجمالي الرولات**', value: `**${userStats.roleCount}** رول`, inline: true },
                            { name: ' **حالة الإدارة**', value: userStats.hasAdminRoles ? '✅ **لديه رولات إدارية**' : '❌ **لا يملك رولات إدارية**', inline: true },
                            { name: '**قائمة لرولات**', value: rolesText, inline: false }
                        ])
                        
                    break;

                case 'advanced_stats':
                    detailEmbed = colorManager.createEmbed()
                        .setTitle(` ** Stats - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: ' **الرسائل**', value: `**${userStats.realMessages.toLocaleString()}** رسالة`, inline: true },
                            { name: ' **الوقت الصوتي**', value: `${userStats.formattedVoiceTime}`, inline: true },
                            { name: ' **انضمامات الفويس**', value: `**${userStats.joinedChannels}** مرة`, inline: true },
                            { name: ' **التفاعلات**', value: `**${userStats.reactionsGiven}** تفاعل`, inline: true },
                            { name: ' **أيام النشاط**', value: `**${userStats.activeDays}** يوم`, inline: true },
                            { name: ' **نوع الحساب**', value: userStats.isBot ? ' **بوت**' : ' **حقيقي**', inline: true }
                        ])
                        
                    break;

                case 'simple_view':
                default:
                    // العودة للعرض البسيط مع النصوص الديناميكية
                    detailEmbed = await createUserStatsEmbed(userStats, colorManager, true, application.requesterName);
                    break;
            }

            // إنشاء الأزرار والمنيو مرة أخرى
            const approveButton = new ButtonBuilder()
                .setCustomId(`admin_approve_${applicationId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success);

            const rejectButton = new ButtonBuilder()
                .setCustomId(`admin_reject_${applicationId}`)
                .setLabel('Reject')
                .setStyle(ButtonStyle.Danger);

            const detailsMenu = new StringSelectMenuBuilder()
                .setCustomId(`admin_details_${applicationId}`)
                .setPlaceholder('تفاصيل العضو')
                .addOptions([
                    {
                        label: 'Dates',
                        description: 'عرض تواريخ الانضمام وإنشاء الحساب',
                        value: 'dates',
                        
                    },
                    {
                        label: 'evaluation',
                        description: 'عرض تقييم العضو والمعايير',
                        value: 'evaluation',
                        
                    },
                    {
                        label: 'Roles',
                        description: 'عرض جميع رولات العضو',
                        value: 'roles',
                        
                    },
                    {
                        label: 'Stats',
                        description: 'عرض تفاصيل النشاط للعضو',
                        value: 'advanced_stats',
                        
                    },
                    {
                        label: 'First emp',
                        description: 'العودة للعرض الأساسي',
                        value: 'simple_view',
                        
                    }
                ]);

            const row1 = new ActionRowBuilder()
                .addComponents(approveButton, rejectButton);

            const row2 = new ActionRowBuilder()
                .addComponents(detailsMenu);

            await interaction.update({
                embeds: [detailEmbed],
                components: [row1, row2]
            });

            return true;
        }

        // معالجة اختيار الأدوار مع تحسينات
        if (customId.startsWith('admin_select_roles_')) {
            const applicationId = customId.replace('admin_select_roles_', '');

            // التحقق من صحة معرف الطلب
            if (!applicationId || applicationId.length < 5) {
                await interaction.reply({
                    content: '**❌ معرف طلب التقديم غير صحيح.**',
                    ephemeral: true
                });
                return true;
            }

            const selectedRoles = interaction.values;
            if (!selectedRoles || selectedRoles.length === 0) {
                await interaction.reply({
                    content: '**❌ يجب اختيار رول واحد على الأقل.**',
                    ephemeral: true
                });
                return true;
            }

            const settings = loadAdminApplicationSettings();
            const application = settings.pendingApplications[applicationId];

            if (!application) {
                console.log(`❌ لم يتم العثور على الطلب: ${applicationId}`);
                console.log('📋 الطلبات المتاحة:', Object.keys(settings.pendingApplications));
                await interaction.reply({
                    content: '**❌ لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.**',
                    ephemeral: true
                });
                return true;
            }

            console.log(`✅ تم العثور على طلب التقديم: ${applicationId} للمرشح: ${application.candidateId}`);

            // محاولة جلب المرشح مع تحسين معالجة الأخطاء
            let candidate;
            try {
                candidate = await interaction.guild.members.fetch(application.candidateId);
                if (!candidate) {
                    throw new Error('المرشح غير موجود');
                }
            } catch (fetchError) {
                console.error('❌ خطأ في جلب المرشح:', fetchError);
                await interaction.reply({
                    content: '**❌ لم يتم العثور على المرشح في السيرفر. ربما غادر المرشح السيرفر.**',
                    ephemeral: true
                });

                // حذف الطلب لأن المرشح لم يعد موجود
                delete settings.pendingApplications[applicationId];
                saveAdminApplicationSettings(settings);
                return true;
            }

            // التحقق من صحة الأدوار المختارة
            const validRoles = [];
            const invalidRoles = [];

            for (const roleId of selectedRoles) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    if (!candidate.roles.cache.has(roleId)) {
                        validRoles.push(roleId);
                    } else {
                        console.log(`⚠️ المرشح ${candidate.displayName} لديه بالفعل الدور: ${role.name}`);
                    }
                } else {
                    invalidRoles.push(roleId);
                }
            }

            if (invalidRoles.length > 0) {
                console.warn('⚠️ أدوار غير صحيحة:', invalidRoles);
            }

            if (validRoles.length === 0) {
                await interaction.reply({
                    content: '⚠️ جميع الأدوار المختارة غير صحيحة أو موجودة لدى المرشح بالفعل.',
                    ephemeral: true
                });
                return true;
            }

            // إضافة الأدوار مع معالجة محسنة للأخطاء
            let addedRoles = [];
            let failedRoles = [];

            try {
                // الرد تم تأجيله بالفعل في بداية الدالة
                for (const roleId of validRoles) {
                    try {
                        const role = interaction.guild.roles.cache.get(roleId);
                        await candidate.roles.add(roleId, `موافقة على طلب التقديم الإداري - بواسطة ${interaction.user.tag}`);
                        addedRoles.push({ id: roleId, name: role.name });
                        console.log(`✅ تم إضافة الدور ${role.name} للمرشح ${candidate.displayName}`);

                        // تأخير بسيط بين إضافة الأدوار لتجنب rate limiting
                        if (validRoles.length > 1) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    } catch (roleError) {
                        console.error(`❌ فشل في إضافة الدور ${roleId}:`, roleError);
                        const role = interaction.guild.roles.cache.get(roleId);
                        failedRoles.push(role ? role.name : `دور ${roleId}`);
                    }
                }

            } catch (roleError) {
                console.error('❌ خطأ عام في إضافة الأدوار:', roleError);
                await interaction.reply({
                    content: '**❌ حدث خطأ في إضافة لرولات الإدارية. تحقق من صلاحيات البوت وترتيب الرولات.**',
                    ephemeral: true
                });
                return true;
            }

            // إنشاء تقرير النتائج
            let resultMessage = '';
            if (addedRoles.length > 0) {
                resultMessage += `✅ تم إضافة: ${addedRoles.map(r => r.name).join(', ')}`;
            }
            if (failedRoles.length > 0) {
                resultMessage += `\n❌ فشل في إضافة: ${failedRoles.join(', ')}`;
            }

            // تحديث الرسالة بالنتيجة النهائية
            const approvedEmbed = colorManager.createEmbed()
                .setTitle('✅ Accepted')
                .setDescription(`**قبلة مسؤول الإدارة :** ${interaction.member.displayName}\n\n ** الاداري الجديد ** :  ${candidate.displayName}\n\n**الرول الذي عُطي :** ${addedRoles.length > 0 ? addedRoles.map(r => r.name).join('** , **') : 'لا يوجد'}\n\n**تاريخ الموافقة :** ${new Date().toLocaleDateString('en-US')}**`)
                .setTimestamp();

            if (failedRoles.length > 0) {
                approvedEmbed.addFields([
                    { name: ' ملاحظات', value: `فشل في إضافة: ${failedRoles.join(', ')}`, inline: false }
                ]);
            }

            await interaction.update({
                embeds: [approvedEmbed],
                components: []
            });

            // إرسال إشعار مفصل للمرشح
            try {
                const approvalDate = new Date().toLocaleString('en-US', {
                    timeZone: 'Asia/Riyadh',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });

                const notificationEmbed = colorManager.createEmbed()
                    .setTitle('تم قبول طلبك للإدارة')
                    .setDescription(`**قبلك مسؤول الإدارة :** ${interaction.member.displayName}\n\n**رولك الذي عُطي :** ${addedRoles.length > 0 ? addedRoles.map(r => r.name).join(', ') : 'لا يوجد'}\n\n**تاريخ الموافقة:** ${new Date().toLocaleDateString('en-US')}`)
                    .setTimestamp();

                if (addedRoles.length > 0) {
                    notificationEmbed.addFields([
                        { name: '**اارولات الإدارية الجديدة**', value: `**${addedRoles.map(r => `\`${r.name}\``).join(' • ')}**`, inline: false }
                    ]);
                }

                notificationEmbed.addFields([
                    { name: '**تذكير مهم**', value: ' راجع روم القوانين وكل المعلومات التي تحتاجها كإداري', inline: false }
                ]);

                await candidate.user.send({ embeds: [notificationEmbed] });
                console.log(`📧 تم إرسال إشعار مفصل للمرشح ${candidate.displayName}`);
            } catch (dmError) {
                console.log(`⚠️ تعذر إرسال إشعار خاص للمرشح ${candidate.displayName}:`, dmError.message);

                // محاولة إرسال في القناة العامة كبديل
                try {
                    const publicNotification = `**تهانينا ${candidate}!** تم قبول طلبك للحصول على إدارة! (تم الإرسال هنا لأن رسائلك الخاصة مغلقة)`;
                    await interaction.followUp({
                        content: publicNotification,
                        flags: 64
                    });
                } catch (publicError) {
                    console.log(`⚠️ فشل أيضاً في الإرسال في القناة العامة:`, publicError.message);
                }
            }

            // حذف الطلب من الطلبات المعلقة بعد نجاح العملية
            delete settings.pendingApplications[applicationId];
            const saveResult = saveAdminApplicationSettings(settings);

            if (!saveResult) {
                console.error('❌ فشل في حفظ إعدادات التقديم بعد الموافقة');
            } else {
                console.log('✅ تم حفظ إعدادات التقديم بنجاح');
            }

            console.log(`✅ تمت الموافقة على طلب إداري: ${application.candidateId} (${candidate.displayName}) بواسطة ${interaction.user.id} - أدوار مضافة: ${addedRoles.length}`);

            return true;
        }

        // استخراج معرف الطلب
        let applicationId;
        if (customId.startsWith('admin_approve_')) {
            applicationId = customId.replace('admin_approve_', '');
        } else if (customId.startsWith('admin_reject_')) {
            applicationId = customId.replace('admin_reject_', '');
        } else if (customId.startsWith('admin_select_roles_')) {
            applicationId = customId.replace('admin_select_roles_', '');
        }

        console.log('معرف الطلب المستخرج:', applicationId);

        const settings = loadAdminApplicationSettings();
        console.log('الطلبات المعلقة الحالية:', Object.keys(settings.pendingApplications));

        const application = settings.pendingApplications[applicationId];

        if (!application) {
            console.log('لم يتم العثور على الطلب:', applicationId);
            await interaction.editReply({
                content: '**لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.**'
            });
            return true;
        }

        console.log('تم العثور على الطلب للمرشح:', application.candidateId);

        // التحقق من صلاحية المعتمد
        if (!canApproveApplication(interaction.member, settings)) {
            await interaction.editReply({
                content: '**ليس لديك صلاحية للموافقة على طلبات التقديم الإداري.**'
            });
            return true;
        }

        const isApproval = customId.startsWith('admin_approve_');
        const candidate = await interaction.guild.members.fetch(application.candidateId).catch(() => null);

        if (!candidate) {
            await interaction.editReply({
                content: '**لم يتم العثور على العضو في السيرفر.**'
            });
            return true;
        }

        if (isApproval) {
            // معالجة الموافقة
            const adminRoles = loadAdminRoles();

            if (adminRoles.length === 0) {
                await interaction.editReply({
                    content: '**لا توجد رولات إدارية محددة في النظام. استخدم أمر adminroles لتحديدها.**'
                });
                return true;
            }

            // فلترة الأدوار حسب hierarchy - الأدوار الأقل من رتبة المعتمد
            const approverHighestRole = interaction.member.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .first();

            const availableRoles = adminRoles.filter(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role || candidate.roles.cache.has(roleId)) return false;

                // إذا كان المعتمد مالك السيرفر أو مالك البوت، يمكنه إعطاء أي رول
                const BOT_OWNERS = global.BOT_OWNERS || [];
                const isOwner = BOT_OWNERS.includes(interaction.user.id) || interaction.guild.ownerId === interaction.user.id;
                if (isOwner) return true;

                // التحقق من hierarchy الأدوار
                return !approverHighestRole || role.position < approverHighestRole.position;
            });

            if (availableRoles.length === 0) {
                await interaction.editReply({
                    content: '**لا توجد رولات متاحة يمكنك منحها للعضو (بناءً على رتبتك في السيرفر).**'
                });
                return true;
            }

            // إنشاء قائمة اختيار الأدوار
            const roleOptions = availableRoles.slice(0, 25).map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return {
                    label: role.name,
                    description: `أعضاء: ${role.members.size}`,
                    value: roleId
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`admin_select_roles_${applicationId}`)
                .setPlaceholder('اختر الرولات التي تريد منحها العضو')
                .setMinValues(1)
                .setMaxValues(Math.min(roleOptions.length, 25))
                .addOptions(roleOptions);

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            // تحديث الرسالة بقائمة الأدوار (لا نحذف الطلب هنا)
            const selectEmbed = colorManager.createEmbed()
                .setTitle('** Choose admin roles**')
                .setDescription(`**اختر الرولات التي تريد منحها للعضو** **${candidate.displayName}**`)
                .addFields([
                    { name: '**العضو **', value: candidate.toString(), inline: true },
                    { name: '**معتمد من**', value: `**${interaction.member.displayName}**`, inline: true },
                    { name: '**الرولات المتاحة**', value: `**${availableRoles.length}** رول`, inline: true }
                ])
                .setTimestamp();

            await interaction.update({
                embeds: [selectEmbed],
                components: [selectRow]
            });

            console.log(`عرض قائمة الأدوار للطلب: ${application.candidateId} بواسطة ${interaction.user.id}`);
            // الطلب يبقى محفوظاً حتى يتم اكتمال عملية اختيار الأدوار
            return true;

        } else {
            // معالجة الرفض
            // إضافة المرشح لقائمة الكولداون مع حفظ فوري
            settings.rejectedCooldowns[application.candidateId] = {
                rejectedAt: new Date().toISOString(),
                rejectedBy: interaction.user.id,
                rejectorName: interaction.member.displayName
            };

            // حذف الطلب من الطلبات المعلقة بعد الرفض
            delete settings.pendingApplications[applicationId];

            // حفظ البيانات أولاً قبل تحديث الرسالة
            const saveResult = saveAdminApplicationSettings(settings);

            // تحديث الرسالة
            const rejectionDate = new Date().toLocaleDateString('en-US', {
                timeZone: 'Asia/Riyadh',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });

            const cooldownEnd = new Date(Date.now() + (settings.settings.rejectCooldownHours * 60 * 60 * 1000));
            const rejectedEmbed = colorManager.createEmbed()
                .setTitle('rejected')
                .setDescription(`**المسؤول :** ${interaction.member.displayName}\n\n ** المرفوض ** : ${candidate.displayName}\n\n**اخذ كولداون تقديم إدارة لمدة :** ${settings.settings.rejectCooldownHours} ساعة\n**ينتهي في :** ${cooldownEnd.toLocaleString('en-US')}`)
                .setTimestamp();

            await interaction.update({
                embeds: [rejectedEmbed],
                components: []
            });

            // إرسال إشعار للمرشح مع تفاصيل الكولداون
            try {
                const cooldownEnd = new Date(Date.now() + (settings.settings.rejectCooldownHours * 60 * 60 * 1000));
                const rejectNotificationEmbed = colorManager.createEmbed()
                    .setTitle(' تم رفض تقديمك للإدارة')
                    .setDescription(`**المسؤول :** ${interaction.member.displayName}\n\n**عليك كولداون تقديم إدارة لمدة :** ${settings.settings.rejectCooldownHours} ساعة`)
                    .setTimestamp();

                await candidate.user.send({ embeds: [rejectNotificationEmbed] });
                console.log(`📧 تم إرسال إشعار الرفض للمرشح ${candidate.displayName}`);
            } catch (dmError) {
                console.log(`⚠️ تعذر إرسال إشعار الرفض للمرشح ${candidate.displayName}:`, dmError.message);
            }

            console.log(`❌ تم رفض طلب إداري: ${application.candidateId} (${candidate.displayName}) بواسطة ${interaction.user.id} - كولداون: ${settings.settings.rejectCooldownHours} ساعة - حفظ: ${saveResult ? 'نجح' : 'فشل'}`);
        }

        return true;

    } catch (error) {
        console.error('خطأ في معالجة تفاعل التقديم الإداري:', error);

        try {
            const errorMessage = 'حدث خطأ في معالجة طلب التقديم. حاول مرة أخرى.';
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على التفاعل:', replyError);
        }

        return true;
    }
}

module.exports.handleAdminApplicationInteraction = handleAdminApplicationInteraction;
