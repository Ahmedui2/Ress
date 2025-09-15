const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
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
                    content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر. يجب أن تكون لديك أدوار إدارية.'
                });
                return;
            }

            // تحميل الإعدادات
            const settings = loadAdminApplicationSettings();
            
            // التحقق من إعداد النظام
            if (!settings.settings.applicationChannel) {
                await interaction.reply({
                    content: '❌ لم يتم إعداد نظام التقديم الإداري بعد. استخدم أمر `setadmin` أولاً.'
                });
                return;
            }

            // التحقق من وجود القناة
            const applicationChannel = interaction.guild.channels.cache.get(settings.settings.applicationChannel);
            if (!applicationChannel) {
                await interaction.reply({
                    content: '❌ قناة التقديم الإداري غير موجودة أو محذوفة. استخدم أمر `setadmin` لإعادة تحديدها.'
                });
                return;
            }

            // التحقق من حد الطلبات المعلقة للإداري
            const pendingCount = countPendingApplicationsByAdmin(interaction.user.id, settings);
            if (pendingCount >= settings.settings.maxPendingPerAdmin) {
                await interaction.reply({
                    content: `❌ لديك بالفعل ${pendingCount} طلبات معلقة. الحد الأقصى هو ${settings.settings.maxPendingPerAdmin} طلبات.`
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
                    content: '❌ يجب أن تكتب "إدارة" وتمنشن الشخص الذي تريد ترشيحه للإدارة.\nمثال: إدارة @المستخدم'
                });
                return;
            }

            candidateId = mentionMatch[1];
            candidate = await interaction.guild.members.fetch(candidateId).catch(() => null);
            
            if (!candidate) {
                await interaction.reply({
                    content: '❌ لم يتم العثور على المستخدم المرشح في السيرفر.'
                });
                return;
            }

            // التحقق من أن المرشح ليس بوت
            if (candidate.user.bot) {
                await interaction.reply({
                    content: '❌ لا يمكن ترشيح البوتات للحصول على صلاحيات إدارية.'
                });
                return;
            }

            // التحقق من وجود أدوار إدارية للمرشح
            if (candidateHasAdminRoles(candidate)) {
                await interaction.reply({
                    content: `❌ ${candidate.displayName} لديه بالفعل أدوار إدارية.`
                });
                return;
            }

            // التحقق من الكولداون
            const cooldownCheck = isInCooldown(candidateId, settings);
            if (cooldownCheck) {
                const timeLeft = formatTimeLeft(cooldownCheck.timeLeft);
                await interaction.reply({
                    content: `❌ ${candidate.displayName} تم رفضه مسبقاً وعليه كولداون.\n⏰ الوقت المتبقي: ${timeLeft}`
                });
                return;
            }

            // التحقق من وجود طلب معلق للمرشح
            if (hasPendingApplication(candidateId, settings)) {
                await interaction.reply({
                    content: `❌ ${candidate.displayName} لديه بالفعل طلب تقديم معلق.`
                });
                return;
            }

            // جمع إحصائيات المرشح
            await interaction.deferReply();
            
            const userStats = await collectUserStats(candidate);
            const statsEmbed = createUserStatsEmbed(userStats, colorManager);
            
            // إنشاء معرف فريد للطلب
            const applicationId = `app_${Date.now()}_${candidateId}`;
            
            // إضافة معلومات الترشيح
            statsEmbed.addFields([
                {
                    name: '👨‍💼 مرشح بواسطة',
                    value: `${interaction.member.displayName} (${interaction.user.username})`,
                    inline: true
                },
                {
                    name: '📅 تاريخ الترشيح',
                    value: new Date().toLocaleDateString('ar-EG'),
                    inline: true
                },
                {
                    name: '🆔 معرف الطلب',
                    value: `\`${applicationId}\``,
                    inline: true
                }
            ]);

            // إنشاء أزرار الموافقة والرفض
            const approveButton = new ButtonBuilder()
                .setCustomId(`admin_approve_${applicationId}`)
                .setLabel('✅ موافقة')
                .setStyle(ButtonStyle.Success);

            const rejectButton = new ButtonBuilder()
                .setCustomId(`admin_reject_${applicationId}`)
                .setLabel('❌ رفض')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(approveButton, rejectButton);

            // حفظ الطلب في البيانات
            settings.pendingApplications[applicationId] = {
                candidateId: candidateId,
                candidateName: candidate.displayName,
                requesterId: interaction.user.id,
                requesterName: interaction.member.displayName,
                createdAt: new Date().toISOString(),
                userStats: userStats
            };

            if (saveAdminApplicationSettings(settings)) {
                // إرسال الطلب إلى قناة التقديم
                try {
                    await applicationChannel.send({
                        embeds: [statsEmbed],
                        components: [row]
                    });

                    // إضافة ريأكشن ✅ للرسالة الأصلية
                    if (interaction.message) {
                        await interaction.message.react('✅');
                    }

                    await interaction.editReply({
                        content: `✅ تم إرسال طلب تقديم ${candidate.displayName} للإدارة إلى ${applicationChannel} بنجاح!`
                    });

                    console.log(`📋 تم إنشاء طلب تقديم إداري: ${candidateId} بواسطة ${interaction.user.id}`);

                } catch (channelError) {
                    console.error('خطأ في إرسال الطلب للقناة:', channelError);
                    
                    // حذف الطلب من البيانات إذا فشل الإرسال
                    delete settings.pendingApplications[applicationId];
                    saveAdminApplicationSettings(settings);
                    
                    await interaction.editReply({
                        content: '❌ فشل في إرسال الطلب إلى قناة التقديم. تحقق من صلاحيات البوت في القناة.'
                    });
                }
            } else {
                await interaction.editReply({
                    content: '❌ فشل في حفظ بيانات الطلب. حاول مرة أخرى.'
                });
            }

        } catch (error) {
            console.error('خطأ في أمر إدارة:', error);
            
            const errorMessage = '❌ حدث خطأ في معالجة الطلب. حاول مرة أخرى.';
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage });
            }
        }
    }
};