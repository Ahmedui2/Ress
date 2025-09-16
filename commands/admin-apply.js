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
                    content: 'ليس لديك صلاحية لاستخدام هذا الأمر. يجب أن تكون لديك أدوار إدارية.'
                });
                return;
            }

            // تحميل الإعدادات
            const settings = loadAdminApplicationSettings();

            // التحقق من إعداد النظام
            if (!settings.settings.applicationChannel) {
                await interaction.reply({
                    content: 'لم يتم إعداد نظام التقديم الإداري بعد. استخدم أمر `setadmin` أولاً.'
                });
                return;
            }

            // التحقق من وجود القناة
            const applicationChannel = interaction.guild.channels.cache.get(settings.settings.applicationChannel);
            if (!applicationChannel) {
                await interaction.reply({
                    content: 'قناة التقديم الإداري غير موجودة أو محذوفة. استخدم أمر `setadmin` لإعادة تحديدها.'
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
                    content: 'يجب أن تكتب "إدارة" وتمنشن الشخص الذي تريد ترشيحه للإدارة.\nمثال: إدارة @المستخدم'
                });
                return;
            }

            candidateId = mentionMatch[1];
            candidate = await interaction.guild.members.fetch(candidateId).catch(() => null);

            if (!candidate) {
                await interaction.reply({
                    content: 'لم يتم العثور على المستخدم المرشح في السيرفر.'
                });
                return;
            }

            // التحقق من أن المرشح ليس بوت
            if (candidate.user.bot) {
                await interaction.reply({
                    content: 'لا يمكن ترشيح البوتات للحصول على صلاحيات إدارية.'
                });
                return;
            }

            // التحقق من وجود أدوار إدارية للمرشح
            if (candidateHasAdminRoles(candidate)) {
                await interaction.reply({
                    content: `${candidate.displayName} لديه بالفعل أدوار إدارية.`
                });
                return;
            }

            // التحقق من الكولداون
            const cooldownCheck = isInCooldown(candidateId, settings);
            if (cooldownCheck) {
                const timeLeft = formatTimeLeft(cooldownCheck.timeLeft);
                await interaction.reply({
                    content: `${candidate.displayName} تم رفضه مسبقاً وعليه كولداون.\nالوقت المتبقي: ${timeLeft}`
                });
                return;
            }

            // التحقق من وجود طلب معلق للمرشح
            if (hasPendingApplication(candidateId, settings)) {
                await interaction.reply({
                    content: `${candidate.displayName} لديه بالفعل طلب تقديم معلق.`
                });
                return;
            }

            // جمع إحصائيات المرشح
            await interaction.deferReply();

            const userStats = await collectUserStats(candidate);
            const statsEmbed = createUserStatsEmbed(userStats, colorManager);

            // إنشاء معرف فريد أبسط للطلب
            const applicationId = `${Date.now()}_${candidateId}`;

            // إنشاء embed مبسط للعرض الأولي
            const simpleEmbed = colorManager.createEmbed()
                .setTitle(`🌟 **طلب تقديم إداري** 🌟`)
                .setThumbnail(userStats.avatar)

                .addFields([
                    {
                        name: '🔸 **معلومات المرشح**',
                        value: `\n 🔸 **الاسم:** ${userStats.displayName}\n🔸 **الاي دي :** \`${userStats.userId}\`\n 🔸 **حالة الحساب:** ${userStats.accountStatus}\n`,
                        inline: false
                    },
                    {
                        name: ' **النشاط الأساسي**',
                        value: `🔸 ** الرسائل :** \`${userStats.realMessages.toLocaleString()}\`\n🔸 ** الفويس (الإجمالي):** ${userStats.formattedVoiceTime}\n🔸 ** انضمام فويس :** \`${userStats.joinedChannels}\`\n🔸 ** التفاعلات :** \`${userStats.reactionsGiven}\``,
                        inline: true
                    },
                    {
                        name: ' **الأدوار**',
                        value: `🔸 ** عدد الأدوار :** \`${userStats.roleCount}\`\n🔸 ** إداري حالياً :** ${userStats.hasAdminRoles ? '✅ **نعم**' : '❌ **لا**'}`,
                        inline: true
                    },
                    {
                        name: '🎯 **مُرشح بواسطة**',
                        value: `🔸 **${interaction.member.displayName}**`,
                        inline: true
                    }
                ])
                .setFooter({
                    text: `طلب تقديم إداري • استخدم القائمة للمزيد من التفاصيل`,
                    iconURL: userStats.avatar
                })
                .setTimestamp();

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
                .setPlaceholder('عرض تفاصيل إضافية (للمعتمدين فقط)')
                .addOptions([
                    {
                        label: '📅 التواريخ والأوقات',
                        description: 'عرض تواريخ الانضمام وإنشاء الحساب',
                        value: 'dates',
                        emoji: '📅'
                    },
                    {
                        label: '📊 التقييم الشامل',
                        description: 'عرض تقييم قوة المرشح والمعايير',
                        value: 'evaluation',
                        emoji: '📊'
                    },
                    {
                        label: '🏷️ تفاصيل الأدوار',
                        description: 'عرض جميع أدوار المرشح',
                        value: 'roles',
                        emoji: '🏷️'
                    },
                    {
                        label: '📈 إحصائيات متقدمة',
                        description: 'عرض تفاصيل النشاط المتقدمة',
                        value: 'advanced_stats',
                        emoji: '📈'
                    },
                    {
                        label: '🔄 العودة للعرض البسيط',
                        description: 'العودة للعرض الأساسي',
                        value: 'simple_view',
                        emoji: '🔄'
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

                    await interaction.editReply({
                        content: `✅ تم إرسال طلب تقديم **${candidate.displayName}** للإدارة إلى ${applicationChannel} بنجاح!`
                    });

                    console.log(`📋 تم إنشاء طلب تقديم إداري: ${candidateId} بواسطة ${interaction.user.id}`);
                } else {
                    await interaction.editReply({
                        content: '⚠️ تم إرسال الطلب ولكن فشل في حفظ البيانات. قد تحدث مشاكل لاحقاً.'
                    });
                }

            } catch (channelError) {
                console.error('خطأ في إرسال الطلب للقناة:', channelError);

                await interaction.editReply({
                    content: '❌ فشل في إرسال الطلب إلى قناة التقديم. تحقق من صلاحيات البوت في القناة.'
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

        console.log('✅ معالجة تفاعل التقديم الإداري:', customId);

        // معالجة منيو التفاصيل الإضافية
        if (customId.startsWith('admin_details_')) {
            const applicationId = customId.replace('admin_details_', '');
            const selectedDetail = interaction.values[0];

            const settings = loadAdminApplicationSettings();
            const application = settings.pendingApplications[applicationId];

            if (!application) {
                await interaction.reply({
                    content: '❌ لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.',
                    ephemeral: true
                });
                return true;
            }

            // التحقق من صلاحية المعتمد لعرض التفاصيل
            if (!canApproveApplication(interaction.member, settings)) {
                await interaction.reply({
                    content: '❌ ليس لديك صلاحية لعرض التفاصيل الإضافية.',
                    ephemeral: true
                });
                return true;
            }

            const userStats = application.userStats;
            let detailEmbed;

            switch (selectedDetail) {
                case 'dates':
                    detailEmbed = colorManager.createEmbed()
                        .setTitle(`📅 **التواريخ والأوقات - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '📅 **انضمام السيرفر**', value: `**${userStats.joinedServerFormatted}**`, inline: false },
                            { name: '🎂 **إنشاء الحساب**', value: `**${userStats.accountCreatedFormatted}**`, inline: false },
                            { name: '⏱️ **المدة في السيرفر**', value: `**${userStats.timeInServerFormatted}**`, inline: true },
                            { name: '🎯 **عمر الحساب**', value: `**${userStats.accountAgeFormatted}**`, inline: true },
                            { name: '📊 **آخر نشاط**', value: `**${userStats.lastActivity}**`, inline: true }
                        ])
;
                    break;

                case 'evaluation':
                    // تحميل إعدادات التقييم
                    const { loadEvaluationSettings, getEvaluationType } = require('../utils/userStatsCollector');
                    const evaluationSettings = loadEvaluationSettings();
                    const timeInServerDays = Math.floor(userStats.timeInServerMs / (24 * 60 * 60 * 1000));
                    
                    // تحديد التقييم العام
                    const evaluation = getEvaluationType(
                        userStats.realMessages, 
                        userStats.realVoiceTime, 
                        userStats.activeDays, 
                        timeInServerDays
                    );

                    detailEmbed = colorManager.createEmbed()
                        .setTitle(`📊 **التقييم الشامل - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '🏆 **التقييم العام**', value: `${evaluation.emoji} **${evaluation.type}**`, inline: false },
                            { name: '💬 **مستوى الرسائل**', value: userStats.realMessages >= evaluationSettings.minMessages.excellent ? '🟢 **ممتاز**' : userStats.realMessages >= evaluationSettings.minMessages.good ? '🟡 **جيد**' : '🔴 **ضعيف**', inline: true },
                            { name: '🎤 **مستوى الفويس**', value: userStats.realVoiceTime >= evaluationSettings.minVoiceTime.excellent ? '🟢 **ممتاز**' : userStats.realVoiceTime >= evaluationSettings.minVoiceTime.good ? '🟡 **جيد**' : '🔴 **ضعيف**', inline: true },
                            { name: '📈 **النشاط**', value: userStats.activeDays >= evaluationSettings.activeDaysPerWeek.minimum ? '🟢 **نشط**' : '🔴 **غير نشط**', inline: true },
                            { name: '⏳ **الخبرة**', value: timeInServerDays >= evaluationSettings.timeInServerDays.excellent ? '🟢 **خبرة ممتازة**' : timeInServerDays >= evaluationSettings.timeInServerDays.minimum ? '🟡 **خبرة جيدة**' : '🔴 **جديد**', inline: true }
                        ])
                        .setColor(evaluation.color);
                    break;

                case 'roles':
                    const rolesText = userStats.roles.length > 0 
                        ? userStats.roles.map((role, index) => `**${index + 1}.** <@&${role.id}> (${role.name})`).join('\n')
                        : '**لا توجد أدوار إضافية**';
                    
                    detailEmbed = colorManager.createEmbed()
                        .setTitle(`🏷️ **تفاصيل الأدوار - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '📊 **إجمالي الأدوار**', value: `**${userStats.roleCount}** رول`, inline: true },
                            { name: '👑 **حالة الإدارة**', value: userStats.hasAdminRoles ? '✅ **لديه أدوار إدارية**' : '❌ **لا يملك أدوار إدارية**', inline: true },
                            { name: '🏷️ **قائمة الأدوار**', value: rolesText, inline: false }
                        ])
                        .setColor('#9b59b6');
                    break;

                case 'advanced_stats':
                    detailEmbed = colorManager.createEmbed()
                        .setTitle(`📈 **إحصائيات متقدمة - ${userStats.displayName}**`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '💬 **الرسائل**', value: `**${userStats.realMessages.toLocaleString()}** رسالة`, inline: true },
                            { name: '🎤 **الوقت الصوتي**', value: `**${userStats.formattedVoiceTime}**`, inline: true },
                            { name: '🔗 **انضمامات الفويس**', value: `**${userStats.joinedChannels}** مرة`, inline: true },
                            { name: '👍 **التفاعلات**', value: `**${userStats.reactionsGiven}** تفاعل`, inline: true },
                            { name: '📅 **أيام النشاط**', value: `**${userStats.activeDays}** يوم`, inline: true },
                            { name: '🤖 **نوع الحساب**', value: userStats.isBot ? '🤖 **بوت**' : '👤 **مستخدم**', inline: true }
                        ])
                        .setColor('#e67e22');
                    break;

                case 'simple_view':
                default:
                    // العودة للعرض البسيط
                    const simpleEmbed = colorManager.createEmbed()
                        .setTitle(`🌟 **طلب تقديم إداري** 🌟`)
                        .setThumbnail(userStats.avatar)
        
                        .addFields([
                            {
                                name: '🔸 **معلومات المرشح**',
                                value: `\n 🔸 **الاسم:** ${userStats.displayName}\n🔸 **الاي دي :** \`${userStats.userId}\`\n 🔸 **حالة الحساب:** ${userStats.accountStatus}\n`,
                                inline: false
                            },
                            {
                                name: ' **النشاط الأساسي**',
                                value: `🔸 ** الرسائل :** \`${userStats.realMessages.toLocaleString()}\`\n🔸 ** الفويس (الإجمالي):** ${userStats.formattedVoiceTime}\n🔸 ** انضمام فويس :** \`${userStats.joinedChannels}\`\n🔸 ** التفاعلات :** \`${userStats.reactionsGiven}\``,
                                inline: true
                            },
                            {
                                name: ' **الأدوار**',
                                value: `🔸 ** عدد الأدوار :** \`${userStats.roleCount}\`\n🔸 ** إداري حالياً :** ${userStats.hasAdminRoles ? '✅ **نعم**' : '❌ **لا**'}`,
                                inline: true
                            },
                            {
                                name: '🎯 **مُرشح بواسطة**',
                                value: `🔸 **${application.requesterName}**`,
                                inline: true
                            }
                        ])
                        .setFooter({
                            text: `طلب تقديم إداري • استخدم القائمة للمزيد من التفاصيل`,
                            iconURL: userStats.avatar
                        })
                        .setTimestamp();
                    
                    detailEmbed = simpleEmbed;
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
                .setPlaceholder('عرض تفاصيل إضافية (للمعتمدين فقط)')
                .addOptions([
                    {
                        label: '📅 التواريخ والأوقات',
                        description: 'عرض تواريخ الانضمام وإنشاء الحساب',
                        value: 'dates',
                        emoji: '📅'
                    },
                    {
                        label: '📊 التقييم الشامل',
                        description: 'عرض تقييم قوة المرشح والمعايير',
                        value: 'evaluation',
                        emoji: '📊'
                    },
                    {
                        label: '🏷️ تفاصيل الأدوار',
                        description: 'عرض جميع أدوار المرشح',
                        value: 'roles',
                        emoji: '🏷️'
                    },
                    {
                        label: '📈 إحصائيات متقدمة',
                        description: 'عرض تفاصيل النشاط المتقدمة',
                        value: 'advanced_stats',
                        emoji: '📈'
                    },
                    {
                        label: '🔄 العودة للعرض البسيط',
                        description: 'العودة للعرض الأساسي',
                        value: 'simple_view',
                        emoji: '🔄'
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
                    content: '❌ معرف طلب التقديم غير صحيح.',
                    ephemeral: true
                });
                return true;
            }

            const selectedRoles = interaction.values;
            if (!selectedRoles || selectedRoles.length === 0) {
                await interaction.reply({
                    content: '❌ يجب اختيار دور واحد على الأقل.',
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
                    content: '❌ لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.',
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
                    content: '❌ لم يتم العثور على المرشح في السيرفر. ربما غادر المرشح السيرفر.',
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
                await interaction.deferUpdate(); // تأجيل الرد لإعطاء وقت أكثر

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
                await interaction.followUp({
                    content: '❌ حدث خطأ في إضافة الأدوار الإدارية. تحقق من صلاحيات البوت وترتيب الأدوار.',
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
                .setTitle('✅ تمت الموافقة')
                .setDescription(`**قبلك مسؤول الإدارة:** ${interaction.member.displayName}\n**رولك الذي عُطي:** ${addedRoles.length > 0 ? addedRoles.map(r => r.name).join(', ') : 'لا يوجد'}\n**تاريخ الموافقة:** ${new Date().toLocaleDateString('ar-EG')}\n**قوانين يجب أن تتبعها:**\n• استخدم صلاحياتك بحكمة\n• اتبع قوانين السيرفر\n• كن مثالاً يُحتذى به`)
                .setTimestamp();

            if (failedRoles.length > 0) {
                approvedEmbed.addFields([
                    { name: '⚠️ ملاحظات', value: `فشل في إضافة: ${failedRoles.join(', ')}`, inline: false }
                ]);
            }

            await interaction.editReply({
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
                    .setTitle('🎉 تم قبول طلبك للإدارة')
                    .setDescription(`**قبلك مسؤول الإدارة:** ${interaction.member.displayName}\n**رولك الذي عُطي:** ${addedRoles.length > 0 ? addedRoles.map(r => r.name).join(', ') : 'لا يوجد'}\n**تاريخ الموافقة:** ${new Date().toLocaleDateString('ar-EG')}\n**قوانين يجب أن تتبعها:**\n• استخدم صلاحياتك بحكمة\n• اتبع قوانين السيرفر\n• كن مثالاً يُحتذى به`)
                    .setTimestamp();

                if (addedRoles.length > 0) {
                    notificationEmbed.addFields([
                        { name: '🏷️ **الأدوار الإدارية الجديدة**', value: `🔸 **${addedRoles.map(r => `\`${r.name}\``).join(' • ')}**`, inline: false }
                    ]);
                }

                notificationEmbed.addFields([
                    { name: '📋 **تذكير مهم**', value: '🔸 استخدم صلاحياتك بحكمة ومسؤولية\n🔸 اتبع قوانين وأنظمة السيرفر\n🔸 كن مثالاً يُحتذى به للأعضاء', inline: false }
                ]);

                await candidate.user.send({ embeds: [notificationEmbed] });
                console.log(`📧 تم إرسال إشعار مفصل للمرشح ${candidate.displayName}`);
            } catch (dmError) {
                console.log(`⚠️ تعذر إرسال إشعار خاص للمرشح ${candidate.displayName}:`, dmError.message);
                
                // محاولة إرسال في القناة العامة كبديل
                try {
                    const publicNotification = `🎉 **تهانينا ${candidate}!** تم قبول طلبك للحصول على صلاحيات إدارية! (تم الإرسال هنا لأن رسائلك الخاصة مغلقة)`;
                    await interaction.followUp({
                        content: publicNotification,
                        ephemeral: false
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
            await interaction.reply({
                content: 'لم يتم العثور على طلب التقديم أو تم معالجته مسبقاً.',
                ephemeral: true
            });
            return true;
        }

        console.log('تم العثور على الطلب للمرشح:', application.candidateId);

        // التحقق من صلاحية المعتمد
        if (!canApproveApplication(interaction.member, settings)) {
            await interaction.reply({
                content: 'ليس لديك صلاحية للموافقة على طلبات التقديم الإداري.',
                ephemeral: true
            });
            return true;
        }

        const isApproval = customId.startsWith('admin_approve_');
        const candidate = await interaction.guild.members.fetch(application.candidateId).catch(() => null);

        if (!candidate) {
            await interaction.reply({
                content: 'لم يتم العثور على المرشح في السيرفر.',
                ephemeral: true
            });
            return true;
        }

        if (isApproval) {
            // معالجة الموافقة
            const adminRoles = loadAdminRoles();

            if (adminRoles.length === 0) {
                await interaction.reply({
                    content: 'لا توجد أدوار إدارية محددة في النظام. استخدم أمر adminroles لتحديدها.',
                    ephemeral: true
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
                await interaction.reply({
                    content: 'لا توجد أدوار متاحة يمكنك منحها للمرشح (بناءً على رتبتك في السيرفر).',
                    ephemeral: true
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
                .setPlaceholder('اختر الأدوار التي تريد منحها للمرشح')
                .setMinValues(1)
                .setMaxValues(Math.min(roleOptions.length, 25))
                .addOptions(roleOptions);

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            // تحديث الرسالة بقائمة الأدوار (لا نحذف الطلب هنا)
            const selectEmbed = colorManager.createEmbed()
                .setTitle('🎯 **اختيار الأدوار الإدارية**')
                .setDescription(`**اختر الأدوار التي تريد منحها للمرشح** **${candidate.displayName}**`)
                .addFields([
                    { name: '👤 **المرشح**', value: candidate.toString(), inline: true },
                    { name: '✅ **معتمد من**', value: `**${interaction.member.displayName}**`, inline: true },
                    { name: '🏷️ **الأدوار المتاحة**', value: `**${availableRoles.length}** رول`, inline: true }
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
                .setTitle('❌ تم رفض التقديم للإدارة')
                .setDescription(`**المسؤول:** ${interaction.member.displayName}\n**عليك كولداون تقديم إدارة لمدة:** ${settings.settings.rejectCooldownHours} ساعة\n**ينتهي في:** ${cooldownEnd.toLocaleString('ar-EG')}`)
                .setTimestamp();

            await interaction.update({
                embeds: [rejectedEmbed],
                components: []
            });

            // إرسال إشعار للمرشح مع تفاصيل الكولداون
            try {
                const cooldownEnd = new Date(Date.now() + (settings.settings.rejectCooldownHours * 60 * 60 * 1000));
                const rejectNotificationEmbed = colorManager.createEmbed()
                    .setTitle('❌ تم رفض تقديمك للإدارة')
                    .setDescription(`**المسؤول:** ${interaction.member.displayName}\n**عليك كولداون تقديم إدارة لمدة:** ${settings.settings.rejectCooldownHours} ساعة`)
                    .setTimestamp();

                await candidate.user.send({ embeds: [rejectNotificationEmbed] });
                console.log(`📧 تم إرسال إشعار الرفض للمرشح ${candidate.displayName}`);
            } catch (dmError) {
                console.log(`⚠️ تعذر إرسال إشعار الرفض للمرشح ${candidate.displayName}:`, dmError.message);
            }

            console.log(`❌ تم رفض طلب إداري: ${application.candidateId} (${candidate.displayName}) بواسطة ${interaction.user.id} - كولداون: ${settings.settings.rejectCooldownHours} ساعة - حفظ: ${saveResult ? 'نجح' : 'فشل'}`);
        }

        // لا نحذف الطلب هنا - يتم حذفه فقط في حالات محددة
        // (الموافقة مع اختيار الأدوار، أو الرفض)
        
        return true;

    } catch (error) {
        console.error('خطأ في معالجة تفاعل التقديم الإداري:', error);

        try {
            const errorMessage = 'حدث خطأ في معالجة طلب التقديم. حاول مرة أخرى.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على التفاعل:', replyError);
        }

        return true;
    }
}

module.exports.handleAdminApplicationInteraction = handleAdminApplicationInteraction;