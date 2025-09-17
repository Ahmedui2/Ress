const fs = require('fs');
const path = require('path');

// مسارات ملفات البيانات
const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const downLogsPath = path.join(__dirname, '..', 'data', 'downLogs.json');
const activeDownsPath = path.join(__dirname, '..', 'data', 'activeDowns.json');
const userActivityPath = path.join(__dirname, '..', 'data', 'userActivity.json');

// دالة لقراءة ملف JSON مع معالجة الأخطاء
function readJsonFile(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return defaultValue;
    } catch (error) {
        console.error(`خطأ في قراءة ${filePath}:`, error);
        return defaultValue;
    }
}

// دالة لكتابة ملف JSON
function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`خطأ في كتابة ${filePath}:`, error);
        return false;
    }
}

// دالة لتنسيق الوقت بدقة أكبر
function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return '**لا يوجد**';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`**${days}** يوم`);
    if (hours > 0) parts.push(`**${hours}** ساعة`);
    if (minutes > 0) parts.push(`**${minutes}** دقيقة`);
    if (seconds > 0 && days === 0) parts.push(`**${seconds}** ثانية`);

    return parts.length > 0 ? parts.join(' و ') : '**أقل من ثانية**';
}

// دالة لحساب الوقت الصوتي لهذا الأسبوع فقط من قاعدة البيانات
async function calculateWeeklyVoiceTime(userId) {
    try {
        const dbManager = require('./database');
        if (!dbManager.isInitialized) {
            await dbManager.initialize();
        }
        
        const weeklyStats = await dbManager.getWeeklyStats(userId);
        return weeklyStats.weeklyTime || 0;
    } catch (error) {
        console.error('خطأ في حساب الوقت الصوتي الأسبوعي:', error);
        return 0;
    }
}

// دالة لتسجيل نشاط المستخدم باستخدام قاعدة البيانات
async function trackUserActivity(userId, activityType, data = {}) {
    try {
        const dbManager = require('./database');

        // التأكد من تهيئة قاعدة البيانات
        if (!dbManager.isInitialized) {
            await dbManager.initialize();
        }

        // تحديث آخر نشاط
        const today = new Date().toDateString();

        // معالجة نوع النشاط
        switch (activityType) {
            case 'message':
                await dbManager.updateUserTotals(userId, { messages: 1 });
                await dbManager.updateDailyActivity(today, userId, { messages: 1 });
                // تتبع الرسائل بصمت لتجنب إزعاج الكونسول
                break;

            case 'voice_join':
                await dbManager.updateUserTotals(userId, { voiceJoins: 1 });
                await dbManager.updateDailyActivity(today, userId, { voiceJoins: 1 });
                console.log(`🎤 تم تسجيل انضمام صوتي للمستخدم ${userId}`);
                break;

            case 'voice_time':
                const duration = data.duration || 0;
                const channelId = data.channelId || 'unknown';
                const channelName = data.channelName || 'قناة غير معروفة';
                const startTime = data.startTime || (Date.now() - duration);
                const endTime = data.endTime || Date.now();

                // حفظ الجلسة الصوتية المفصلة
                try {
                    const { saveVoiceSession } = require('./voiceTimeManager');
                    const sessionId = await saveVoiceSession(userId, channelId, channelName, duration, startTime, endTime);
                    if (sessionId) {
                        console.log(`⏱️ تم حفظ جلسة صوتية: ${Math.round(duration / 1000)} ثانية للمستخدم ${userId} في ${channelName}`);
                    }
                } catch (error) {
                    console.error('❌ خطأ في حفظ الجلسة الصوتية:', error);
                }
                break;

            case 'reaction':
                try {
                    // التأكد من وجود السجل أولاً
                    await dbManager.run(`
                        INSERT OR IGNORE INTO user_totals (user_id, total_reactions, total_messages, total_voice_time, total_voice_joins)
                        VALUES (?, 0, 0, 0, 0)
                    `, [userId]);
                    
                    // تحديث إجماليات المستخدم
                    await dbManager.updateUserTotals(userId, { reactions: 1 });
                    
                    // تحديث النشاط اليومي
                    await dbManager.updateDailyActivity(today, userId, { reactions: 1 });
                    
                    // تحديث آخر نشاط
                    await dbManager.run('UPDATE user_totals SET last_activity = datetime("now") WHERE user_id = ?', [userId]);
                    
                    // رسالة واحدة بدلاً من عدة رسائل
                    console.log(`👍 تم تسجيل تفاعل للمستخدم ${userId} - ${data.emoji || 'تفاعل'}`);
                    
                } catch (reactionError) {
                    console.error(`❌ خطأ في معالجة تفاعل المستخدم ${userId}:`, reactionError);
                    throw reactionError;
                }
                
                break;
        }

        // تم تبسيط رسائل الكونسول
        return true;

    } catch (error) {
        console.error('خطأ في تسجيل نشاط المستخدم:', error);
        return false;
    }
}

// دالة للحصول على إحصائيات المستخدم الفعلية من قاعدة البيانات
async function getRealUserStats(userId) {
    try {
        const dbManager = require('./database');

        // التأكد من تهيئة قاعدة البيانات
        if (!dbManager.isInitialized) {
            await dbManager.initialize();
        }

        const stats = await dbManager.getUserStats(userId);

        if (!stats) {
            console.log(`⚠️ لم يتم العثور على بيانات المستخدم ${userId} في قاعدة البيانات`);
            return {
                messages: 0,
                voiceTime: 0,
                lastActivity: 'غير معروف',
                joinedChannels: 0,
                reactionsGiven: 0,
                activeDays: 0,
                accountAge: 0
            };
        }

        console.log(`✅ تم جلب بيانات المستخدم ${userId} من قاعدة البيانات:`, {
            messages: stats.totalMessages,
            voiceTime: stats.totalVoiceTime,
            sessions: stats.totalSessions,
            voiceJoins: stats.totalVoiceJoins,
            reactions: stats.totalReactions
        });

        return {
            messages: stats.totalMessages || 0,
            voiceTime: stats.totalVoiceTime || 0,
            lastActivity: stats.lastActivity ? new Date(stats.lastActivity).toLocaleDateString('ar-EG') : 'غير معروف',
            joinedChannels: stats.totalVoiceJoins || 0,
            reactionsGiven: stats.totalReactions || 0,
            activeDays: stats.activeDays || 0, // أيام النشاط الفعلية من قاعدة البيانات
            weeklyActiveDays: stats.weeklyActiveDays || 0, // أيام النشاط الأسبوعية
            accountAge: stats.firstSeen ? Date.now() - stats.firstSeen : 0
        };
    } catch (error) {
        console.error('❌ خطأ في الحصول على إحصائيات المستخدم:', error);
        return {
            messages: 0,
            voiceTime: 0,
            lastActivity: 'خطأ',
            joinedChannels: 0,
            reactionsGiven: 0,
            activeDays: 0,
            accountAge: 0
        };
    }
}

// دالة للتحقق من حالة الإجازة
function getVacationStatus(userId) {
    try {
        const vacations = readJsonFile(vacationsPath, { active: {} });
        const activeVacation = vacations.active?.[userId];

        if (activeVacation) {
            const endDate = new Date(activeVacation.endDate);
            return {
                hasVacation: true,
                endDate: endDate,
                reason: activeVacation.reason || 'غير محدد',
                startDate: new Date(activeVacation.startDate),
                approvedBy: activeVacation.approvedBy
            };
        }

        return { hasVacation: false };
    } catch (error) {
        console.error('خطأ في فحص حالة الإجازة:', error);
        return { hasVacation: false };
    }
}

// دالة للتحقق من حالة الداون
function getDownStatus(userId) {
    try {
        const activeDowns = readJsonFile(activeDownsPath, {});

        for (const [downId, downData] of Object.entries(activeDowns)) {
            if (downData.userId === userId) {
                return {
                    hasDown: true,
                    reason: downData.reason || 'غير محدد',
                    endTime: downData.endTime ? new Date(downData.endTime) : null,
                    roleId: downData.roleId,
                    startTime: downData.startTime ? new Date(downData.startTime) : null,
                    byUserId: downData.byUserId
                };
            }
        }

        return { hasDown: false };
    } catch (error) {
        console.error('خطأ في فحص حالة الداون:', error);
        return { hasDown: false };
    }
}

// دالة لجمع آخر نشاط بدقة أكبر
function getLastActivity(member) {
    try {
        const realStats = getRealUserStats(member.id);

        if (realStats.lastActivity && realStats.lastActivity !== 'غير معروف') {
            return `آخر نشاط: ${realStats.lastActivity}`;
        }

        // التحقق من الحالة الحالية للمستخدم
        if (member.presence) {
            const status = member.presence.status;
            if (status === 'online') {
                return 'متصل الآن';
            } else if (status === 'idle') {
                return 'خامل';
            } else if (status === 'dnd') {
                return 'مشغول';
            } else {
                return 'غير متصل';
            }
        } else {
            return 'غير متصل';
        }
    } catch (error) {
        console.error('خطأ في جمع آخر نشاط:', error);
        return 'غير معروف';
    }
}

// الدالة الرئيسية لجمع جميع الإحصائيات
async function collectUserStats(member) {
    try {
        const userId = member.id;
        const user = member.user;

        // معلومات أساسية
        const joinedAt = member.joinedTimestamp;
        const createdAt = user.createdTimestamp;
        const now = Date.now();

        // حساب الأوقات
        const timeInServer = now - joinedAt;
        const accountAge = now - createdAt;

        // جمع الإحصائيات الفعلية
        const realStats = await getRealUserStats(userId);
        const lastActivity = getLastActivity(member);

        // فحص الحالات الخاصة
        const vacationStatus = getVacationStatus(userId);
        const downStatus = getDownStatus(userId);

        // تحديد حالة الحساب
        let accountStatus = 'عادي';
        let statusDetails = '';

        if (vacationStatus.hasVacation) {
            accountStatus = 'في إجازة';
            statusDetails = `إجازة تنتهي: ${vacationStatus.endDate.toLocaleDateString('ar-EG')}`;
        } else if (downStatus.hasDown) {
            accountStatus = 'عليه داون';
            const guild = member.guild;
            const role = guild.roles.cache.get(downStatus.roleId);
            statusDetails = `داون على دور: ${role ? role.name : 'دور محذوف'}`;
        }

        // جلب البيانات الأسبوعية
        const dbManager = require('./database');
        const weeklyStats = await dbManager.getWeeklyStats(userId);

        return {
            // معلومات أساسية
            userId: userId,
            username: user.username,
            displayName: member.displayName,
            avatar: user.displayAvatarURL({ dynamic: true }),

            // إحصائيات التفاعل الفعلية
            realMessages: realStats.messages || 0,
            realVoiceTime: realStats.voiceTime || 0,
            formattedVoiceTime: formatDuration(realStats.voiceTime || 0),
            joinedChannels: realStats.joinedChannels || 0,
            reactionsGiven: realStats.reactionsGiven || 0,
            activeDays: realStats.activeDays || 0,

            // البيانات الأسبوعية
            weeklyMessages: weeklyStats.weeklyMessages || 0,
            weeklyVoiceTime: weeklyStats.weeklyTime || 0,
            formattedWeeklyVoiceTime: formatDuration(weeklyStats.weeklyTime || 0),
            weeklyReactions: weeklyStats.weeklyReactions || 0,
            weeklyVoiceJoins: weeklyStats.weeklyVoiceJoins || 0,

            // تواريخ مهمة مع تنسيق محسن
            joinedServer: joinedAt,
            joinedServerFormatted: new Date(joinedAt).toLocaleDateString('en-US', {
                timeZone: 'Asia/Riyadh',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            }),
            accountCreated: createdAt,
            accountCreatedFormatted: new Date(createdAt).toLocaleDateString('en-US', {
                timeZone: 'Asia/Riyadh',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            }),

            // مدد زمنية
            timeInServerMs: timeInServer,
            timeInServerFormatted: formatDuration(timeInServer),
            accountAgeMs: accountAge,
            accountAgeFormatted: formatDuration(accountAge),

            // نشاط ووضع
            lastActivity: lastActivity,
            accountStatus: accountStatus,
            statusDetails: statusDetails,

            // أدوار حالية
            roleCount: member.roles.cache.size - 1, // عدا @everyone
            roles: member.roles.cache
                .filter(role => role.id !== member.guild.id) // عدا @everyone
                .map(role => ({ id: role.id, name: role.name })),

            // معلومات إضافية
            isBot: user.bot,
            hasAdminRoles: await checkIfHasAdminRoles(member),

            // timestamps للحسابات
            collectedAt: now
        };

    } catch (error) {
        console.error('خطأ في جمع إحصائيات المستخدم:', error);
        throw error;
    }
}

// دالة للتحقق من وجود أدوار إدارية
async function checkIfHasAdminRoles(member) {
    try {
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        const adminRoles = readJsonFile(adminRolesPath, []);

        if (!Array.isArray(adminRoles) || adminRoles.length === 0) {
            return false;
        }

        return member.roles.cache.some(role => adminRoles.includes(role.id));
    } catch (error) {
        console.error('خطأ في فحص الأدوار الإدارية:', error);
        return false;
    }
}

// دالة تحديد نوع التقييم مع دعم الإعدادات المخصصة والتفاعل الصوتي
function getEvaluationType(totalMessages, weeklyMessages, totalVoiceTime, weeklyVoiceTime, totalReactions, weeklyReactions, activeDays, daysInServer) {
    // تحميل الإعدادات المخصصة
    const customSettings = loadEvaluationSettings();

    // اختيار القيم المناسبة بناءً على إعدادات resetWeekly
    const messageCount = customSettings.minMessages.resetWeekly ? weeklyMessages : totalMessages;
    const voiceTime = customSettings.minVoiceTime.resetWeekly ? weeklyVoiceTime : totalVoiceTime;
    const reactionCount = customSettings.minReactions.resetWeekly ? weeklyReactions : totalReactions;

    // معايير التقييم من الإعدادات أو القيم الافتراضية
    const EXCELLENT_THRESHOLD = {
        messages: customSettings.minMessages.excellent,
        voiceTime: customSettings.minVoiceTime.excellent,
        reactions: customSettings.minReactions.excellent,
        activeDays: Math.ceil(customSettings.activeDaysPerWeek.minimum * 2), // ضعف الحد الأدنى للنشاط الأسبوعي
        daysInServer: customSettings.timeInServerDays.excellent
    };

    const GOOD_THRESHOLD = {
        messages: customSettings.minMessages.good,
        voiceTime: customSettings.minVoiceTime.good,
        reactions: customSettings.minReactions.good,
        activeDays: customSettings.activeDaysPerWeek.minimum,
        daysInServer: customSettings.timeInServerDays.minimum
    };

    const WEAK_THRESHOLD = {
        messages: customSettings.minMessages.weak,
        voiceTime: customSettings.minVoiceTime.weak,
        reactions: customSettings.minReactions.weak
    };

    // حساب التقييم بناءً على المعايير المخصصة (يجب تحقيق جميع الشروط)
    if (messageCount >= EXCELLENT_THRESHOLD.messages &&
        voiceTime >= EXCELLENT_THRESHOLD.voiceTime &&
        reactionCount >= EXCELLENT_THRESHOLD.reactions &&
        activeDays >= EXCELLENT_THRESHOLD.activeDays &&
        daysInServer >= EXCELLENT_THRESHOLD.daysInServer) {
        return { type: 'ممتاز', emoji: '🌟', color: '#00ff00' };
    } else if (messageCount >= GOOD_THRESHOLD.messages &&
               voiceTime >= GOOD_THRESHOLD.voiceTime &&
               reactionCount >= GOOD_THRESHOLD.reactions &&
               activeDays >= GOOD_THRESHOLD.activeDays &&
               daysInServer >= GOOD_THRESHOLD.daysInServer) {
        return { type: 'جيد', emoji: '✅', color: '#ffaa00' };
    } else {
        return { type: 'ضعيف', emoji: '⚠️', color: '#ff6600' };
    }
}

// دالة تحميل إعدادات التقييم المخصصة
function loadEvaluationSettings() {
    try {
        const adminApplicationsPath = path.join(__dirname, '..', 'data', 'adminApplications.json');
        if (fs.existsSync(adminApplicationsPath)) {
            const data = JSON.parse(fs.readFileSync(adminApplicationsPath, 'utf8'));
            const evaluation = data.settings?.evaluation;

            if (evaluation) {
                return {
                    minMessages: evaluation.minMessages || { weak: 20, good: 50, excellent: 100, resetWeekly: false },
                    minVoiceTime: evaluation.minVoiceTime || {
                        weak: 2 * 60 * 60 * 1000,
                        good: 5 * 60 * 60 * 1000,
                        excellent: 10 * 60 * 60 * 1000,
                        resetWeekly: false
                    },
                    minReactions: evaluation.minReactions || { weak: 10, good: 25, excellent: 50, resetWeekly: false },
                    activeDaysPerWeek: evaluation.activeDaysPerWeek || { minimum: 3, resetWeekly: true },
                    timeInServerDays: evaluation.timeInServerDays || { minimum: 7, excellent: 30 }
                };
            }
        }
    } catch (error) {
        console.error('خطأ في تحميل إعدادات التقييم:', error);
    }

    // القيم الافتراضية
    return {
        minMessages: { weak: 20, good: 50, excellent: 100, resetWeekly: false },
        minVoiceTime: {
            weak: 2 * 60 * 60 * 1000,
            good: 5 * 60 * 60 * 1000,
            excellent: 10 * 60 * 60 * 1000,
            resetWeekly: false
        },
        minReactions: { weak: 10, good: 25, excellent: 50, resetWeekly: false },
        activeDaysPerWeek: { minimum: 3, resetWeekly: true },
        timeInServerDays: { minimum: 7, excellent: 30 }
    };
}

// دالة لحساب أيام النشاط مع دعم الإعدادات المخصصة واستخدام قاعدة البيانات
async function calculateWeeklyActivity(stats, evaluationSettings) {
    try {
        const dbManager = require('./database');
        
        // التأكد من تهيئة قاعدة البيانات
        if (!dbManager.isInitialized) {
            await dbManager.initialize();
        }

        const customSettings = loadEvaluationSettings();
        const activitySettings = customSettings.activeDaysPerWeek;

        let activeDays = 0;

        if (activitySettings.resetWeekly) {
            // استخدام أيام النشاط الأسبوعية من قاعدة البيانات
            activeDays = stats.weeklyActiveDays || await dbManager.getWeeklyActiveDays(stats.userId);
        } else {
            // استخدام أيام النشاط الشهرية من قاعدة البيانات
            activeDays = stats.activeDays || await dbManager.getActiveDaysCount(stats.userId, 30);
        }

        console.log(`📊 تم حساب أيام النشاط للمستخدم ${stats.userId}: ${activeDays} أيام (${activitySettings.resetWeekly ? 'أسبوعي' : 'شهري'})`);
        return activeDays;

    } catch (error) {
        console.error('❌ خطأ في حساب أيام النشاط:', error);
        // العودة للحساب التقديري في حالة الخطأ
        return Math.min(
            Math.floor((stats.realMessages || 0) / 10) + Math.floor((stats.joinedChannels || 0) / 2),
            7
        );
    }
}

// دالة للتحقق من حالة الإجازة المخصصة
function getCustomVacationStatus(userId) {
    try {
        const vacations = readJsonFile(vacationsPath, { active: {} });
        const activeVacation = vacations.active?.[userId];

        if (activeVacation) {
            const endDate = new Date(activeVacation.endDate);
            return {
                hasVacation: true,
                endDate: endDate,
                reason: activeVacation.reason || 'غير محدد',
                startDate: new Date(activeVacation.startDate),
                approvedBy: activeVacation.approvedBy
            };
        }

        return { hasVacation: false };
    } catch (error) {
        console.error('خطأ في فحص حالة الإجازة المخصصة:', error);
        return { hasVacation: false };
    }
}

// دالة للتحقق من حالة الداون المخصصة
function getCustomDownStatus(userId) {
    try {
        const activeDowns = readJsonFile(activeDownsPath, {});

        for (const [downId, downData] of Object.entries(activeDowns)) {
            if (downData.userId === userId) {
                return {
                    hasDown: true,
                    reason: downData.reason || 'غير محدد',
                    endTime: downData.endTime ? new Date(downData.endTime) : null,
                    roleId: downData.roleId,
                    startTime: downData.startTime ? new Date(downData.startTime) : null,
                    byUserId: downData.byUserId
                };
            }
        }

        return { hasDown: false };
    } catch (error) {
        console.error('خطأ في فحص حالة الداون المخصصة:', error);
        return { hasDown: false };
    }
}

// دالة لإنشاء embed المعلومات المحسن
async function createUserStatsEmbed(stats, colorManager, isSimpleView = false, requesterName = null) {
    const { EmbedBuilder } = require('discord.js');

    // تحميل إعدادات التقييم
    const evaluationSettings = loadEvaluationSettings();
    
    // تحديد النصوص والقيم بناءً على الإعدادات
    const messagesLabel = evaluationSettings.minMessages.resetWeekly ? "الرسائل (أسبوعي)" : "الرسائل (الإجمالي)";
    const voiceLabel = evaluationSettings.minVoiceTime.resetWeekly ? "الفويس (أسبوعي)" : "الفويس (الإجمالي)";
    const reactionsLabel = evaluationSettings.minReactions.resetWeekly ? "التفاعلات (أسبوعي)" : "التفاعلات (الإجمالي)";
    
    const messageValue = evaluationSettings.minMessages.resetWeekly ? (stats.weeklyMessages || 0) : (stats.realMessages || 0);
    const voiceValue = evaluationSettings.minVoiceTime.resetWeekly ? (stats.formattedWeeklyVoiceTime || 'لا يوجد') : (stats.formattedVoiceTime || 'لا يوجد');
    const reactionValue = evaluationSettings.minReactions.resetWeekly ? (stats.weeklyReactions || 0) : (stats.reactionsGiven || 0);

    if (isSimpleView) {
        // العرض المبسط للتقديم الإداري
        const embed = colorManager.createEmbed()
            .setTitle(`🌟 **طلب تقديم إداري** 🌟`)
            .setThumbnail(stats.avatar)
            .addFields([
                {
                    name: '🔸 **معلومات المرشح**',
                    value: `\n 🔸 **الاسم:** ${stats.displayName}\n🔸 **الاي دي :** \`${stats.userId}\`\n 🔸 **حالة الحساب:** ${stats.accountStatus}\n`,
                    inline: false
                },
                {
                    name: ' **النشاط الأساسي**',
                    value: `🔸 **${messagesLabel}:** \`${messageValue.toLocaleString()}\`\n🔸 **${voiceLabel}:** ${voiceValue}\n🔸 ** انضمام فويس :** \`${stats.joinedChannels || 0}\`\n🔸 **${reactionsLabel}:** \`${reactionValue.toLocaleString()}\``,
                    inline: true
                },
                {
                    name: ' **الأدوار**',
                    value: `🔸 ** عدد الأدوار :** \`${stats.roleCount || 0}\`\n🔸 ** إداري حالياً :** ${stats.hasAdminRoles ? '✅ **نعم**' : '❌ **لا**'}`,
                    inline: true
                }
            ]);

        if (requesterName) {
            embed.addFields([
                {
                    name: '🎯 **مُرشح بواسطة**',
                    value: `🔸 **${requesterName}**`,
                    inline: true
                }
            ]);
        }

        return embed;
    }

    // العرض الكامل والمفصل
    const weeklyActivity = await calculateWeeklyActivity(stats, evaluationSettings);
    const timeInServerDays = Math.floor(stats.timeInServerMs / (24 * 60 * 60 * 1000));

    // تحديد مستوى الرسائل
    const messagesUsed = evaluationSettings.minMessages.resetWeekly ? (stats.weeklyMessages || 0) : stats.realMessages;
    let messageLevel = 'ضعيف';
    if (messagesUsed >= evaluationSettings.minMessages.excellent) {
        messageLevel = 'ممتاز';
    } else if (messagesUsed >= evaluationSettings.minMessages.good) {
        messageLevel = 'جيد';
    }

    // تحديد مستوى النشاط الأسبوعي
    const isActiveWeekly = weeklyActivity >= evaluationSettings.activeDaysPerWeek.minimum;
    let activityStatus = '';
    if (evaluationSettings.activeDaysPerWeek.resetWeekly) {
        activityStatus = `${weeklyActivity}/${evaluationSettings.activeDaysPerWeek.minimum} أيام هذا الأسبوع`;
    } else {
        activityStatus = `${stats.activeDays} أيام إجمالي`;
    }

    // تحديد مستوى الخبرة في السيرفر
    let timeLevel = 'جديد';
    if (timeInServerDays >= evaluationSettings.timeInServerDays.excellent) {
        timeLevel = 'خبرة ممتازة';
    } else if (timeInServerDays >= evaluationSettings.timeInServerDays.minimum) {
        timeLevel = 'خبرة جيدة';
    }

    // تحديد مستوى التفاعل الصوتي
    const voiceTimeUsed = evaluationSettings.minVoiceTime.resetWeekly ? (stats.weeklyVoiceTime || 0) : stats.realVoiceTime;
    let voiceLevel = 'ضعيف';
    if (voiceTimeUsed >= evaluationSettings.minVoiceTime.excellent) {
        voiceLevel = 'ممتاز';
    } else if (voiceTimeUsed >= evaluationSettings.minVoiceTime.good) {
        voiceLevel = 'جيد';
    }

    // تحديد التقييم العام
    let evaluation = '';
    if (messagesUsed >= evaluationSettings.minMessages.excellent &&
        voiceTimeUsed >= evaluationSettings.minVoiceTime.excellent &&
        isActiveWeekly &&
        timeInServerDays >= evaluationSettings.timeInServerDays.excellent) {
        evaluation = '🟢 **مرشح ممتاز** - يحقق جميع المعايير المطلوبة';
    } else if (messagesUsed >= evaluationSettings.minMessages.good &&
               voiceTimeUsed >= evaluationSettings.minVoiceTime.good &&
               isActiveWeekly &&
               timeInServerDays >= evaluationSettings.timeInServerDays.minimum) {
        evaluation = '🟡 **مرشح جيد** - يحقق المعايير الأساسية';
    } else {
        evaluation = '🔴 **مرشح ضعيف** - لا يحقق المعايير المطلوبة';
    }

    const embed = new EmbedBuilder()
        .setTitle(`🌟 **تحليل شامل للمرشح** 🌟`)
        .setThumbnail(stats.avatar)
        .setColor(colorManager.getColor() || '#3498db')
        .addFields([
            {
                name: '🔸 **information**',
                value: `\n 🔸 **الاسم:** ${stats.displayName}\n🔸 **الاي دي :** \`${stats.userId}\`\n 🔸 **حالة الحساب:** ${stats.accountStatus}\n`,
                inline: false
            },
            {
                name: ' **Actives**',
                value: `🔸 **${messagesLabel}:** \`${messageValue.toLocaleString()}\`\n🔸 **${voiceLabel}:** ${voiceValue}\n🔸 ** انضمام فويس :** \`${stats.joinedChannels || 0}\`\n🔸 **${reactionsLabel}:** \`${reactionValue.toLocaleString()}\``,
                inline: true
            },
            {
                name: ' **times **',
                value: `🔸 ** inter sevrver :** \`___${stats.joinedServerFormatted}___\`\n🔸 ** create account :** \`___${stats.accountCreatedFormatted}___\`\n🔸 ** in server :** ___${stats.timeInServerFormatted}___`,
                inline: true
            },
            {
                name: ' **Status**',
                value: `🔸 **active :** ${activityStatus}\n🔸 ${stats.lastActivity}`,
                inline: true
            },
            {
                name: ' **الأدوار**',
                value: `🔸 ** عدد الأدوار :** \`${stats.roleCount || 0}\`\n🔸 ** إداري حالياً :** ${stats.hasAdminRoles ? '✅ **نعم**' : '❌ **لا**'}`,
                inline: true
            }
        ])
        .setFooter({
            text: `By Ahmed `,
            iconURL: stats.avatar
        })
        .setTimestamp();

    // إضافة تفاصيل الحالة إذا كانت موجودة
    if (stats.statusDetails) {
        embed.addFields([{ name: '⚠️ تفاصيل الحالة الخاصة', value: stats.statusDetails, inline: false }]);
    }

    // إضافة تفاصيل التقييم
    embed.addFields([
        {
            name: 'Rate',
            value: `**${messagesLabel}:** ${messageLevel} (${messageValue.toLocaleString()})\n**${voiceLabel}:** ${voiceLevel} (${voiceValue})\n**النشاط:** ${isActiveWeekly ? '✅' : '❌'} ${activityStatus}\n**الخبرة:** ${timeLevel} (${timeInServerDays} يوم)`,
            inline: true
        },
        {
            name: 'Rating',
            value: evaluation,
            inline: false
        }
    ]);

    return embed;
}

// دالة لتهيئة نظام تتبع النشاط
function initializeActivityTracking(client) {
    console.log('🔄 تهيئة نظام تتبع النشاط...');

    // ملاحظة: تتبع الرسائل يتم في bot.js المعالج الرئيسي لتجنب التكرار
    // ملاحظة: تتبع التفاعلات يتم في bot.js المعالج الرئيسي لتجنب التكرار
    // ملاحظة: تتبع الصوت يتم في bot.js للتحكم المحسن والمنطق المتقدم

    console.log('✅ تم تهيئة نظام تتبع النشاط بنجاح (بدون معالجات مكررة)');
}

module.exports = {
    collectUserStats,
    createUserStatsEmbed,
    formatDuration,
    checkIfHasAdminRoles,
    getVacationStatus: getCustomVacationStatus, // إعادة تسمية لتجنب التعارض
    getDownStatus: getCustomDownStatus,       // إعادة تسمية لتجنب التعارض
    trackUserActivity,
    getRealUserStats,
    initializeActivityTracking,
    loadEvaluationSettings,
    getEvaluationType,
    calculateWeeklyActivity,
    calculateWeeklyVoiceTime
};