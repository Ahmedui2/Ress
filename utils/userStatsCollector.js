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

// دالة لحساب الوقت الصوتي لهذا الأسبوع فقط
function calculateWeeklyVoiceTime(userId) {
    try {
        const activity = readJsonFile(userActivityPath, {});
        const userStats = activity[userId];
        
        if (!userStats || !userStats.voiceTimeByDate) {
            return 0;
        }
        
        // حساب بداية الأسبوع الحالي (الأحد)
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay()); // الأحد
        weekStart.setHours(0, 0, 0, 0);
        
        let weeklyVoiceTime = 0;
        
        // المرور عبر كل تاريخ في voiceTimeByDate
        for (const [dateString, voiceTime] of Object.entries(userStats.voiceTimeByDate)) {
            const date = new Date(dateString);
            
            // التحقق من أن التاريخ ضمن الأسبوع الحالي
            if (date >= weekStart && date <= today) {
                weeklyVoiceTime += voiceTime;
            }
        }
        
        return weeklyVoiceTime;
    } catch (error) {
        console.error('خطأ في حساب الوقت الصوتي الأسبوعي:', error);
        return 0;
    }
}

// دالة لتسجيل نشاط المستخدم
function trackUserActivity(userId, activityType, data = {}) {
    try {
        // قراءة البيانات الحالية
        const activity = readJsonFile(userActivityPath, {});

        // إنشاء بيانات المستخدم إذا لم تكن موجودة
        if (!activity[userId]) {
            activity[userId] = {
                messages: 0,
                voiceTime: 0,
                lastActivity: Date.now(),
                joinedChannels: 0,
                reactionsGiven: 0,
                firstSeen: Date.now(),
                activeDays: []
            };
        }

        // إضافة اليوم الحالي لأيام النشاط
        const today = new Date().toDateString();
        if (!activity[userId].activeDays) {
            activity[userId].activeDays = [];
        }

        // التأكد من أن activeDays هو array
        if (!Array.isArray(activity[userId].activeDays)) {
            activity[userId].activeDays = [];
        }

        // إضافة اليوم إذا لم يكن موجوداً
        if (!activity[userId].activeDays.includes(today)) {
            activity[userId].activeDays.push(today);
        }

        // تحديث آخر نشاط
        activity[userId].lastActivity = Date.now();

        // معالجة نوع النشاط
        switch (activityType) {
            case 'message':
                activity[userId].messages = (activity[userId].messages || 0) + 1;
                console.log(`📝 تم تسجيل رسالة للمستخدم ${userId}: ${activity[userId].messages}`);
                break;
            case 'voice_join':
                activity[userId].joinedChannels = (activity[userId].joinedChannels || 0) + 1;
                console.log(`🎤 تم تسجيل انضمام صوتي للمستخدم ${userId}: ${activity[userId].joinedChannels}`);
                break;
            case 'voice_time':
                const duration = data.duration || 0;
                const channelId = data.channelId || 'unknown';
                const channelName = data.channelName || 'قناة غير معروفة';
                const startTime = data.startTime || (Date.now() - duration);
                const endTime = data.endTime || Date.now();
                
                // تحديث النظام القديم للتوافق
                activity[userId].voiceTime = (activity[userId].voiceTime || 0) + duration;
                
                // إضافة تتبع الوقت الصوتي بالتواريخ
                if (!activity[userId].voiceTimeByDate) {
                    activity[userId].voiceTimeByDate = {};
                }
                
                const dateKey = new Date(startTime).toDateString(); // مفتاح التاريخ
                activity[userId].voiceTimeByDate[dateKey] = (activity[userId].voiceTimeByDate[dateKey] || 0) + duration;
                
                // استخدام النظام الجديد للحفظ المفصل
                try {
                    const { saveVoiceSession } = require('./voiceTimeManager');
                    const sessionId = saveVoiceSession(userId, channelId, channelName, duration, startTime, endTime);
                    if (sessionId) {
                        console.log(`⏱️ تم حفظ جلسة صوتية مفصلة: ${Math.round(duration / 1000)} ثانية للمستخدم ${userId} في ${channelName} (ID: ${sessionId})`);
                    }
                } catch (error) {
                    console.error('❌ خطأ في حفظ الجلسة الصوتية المفصلة:', error);
                }
                
                console.log(`⏱️ تم إضافة ${Math.round(duration / 1000)} ثانية للمستخدم ${userId}. الإجمالي: ${Math.round(activity[userId].voiceTime / 1000)} ثانية`);
                break;
            case 'reaction':
                activity[userId].reactionsGiven = (activity[userId].reactionsGiven || 0) + 1;
                console.log(`👍 تم تسجيل تفاعل للمستخدم ${userId}: ${activity[userId].reactionsGiven}`);
                break;
        }

        // حفظ البيانات
        const saveResult = writeJsonFile(userActivityPath, activity);
        
        if (saveResult) {
            console.log(`✅ تم حفظ نشاط المستخدم ${userId} بنجاح - النوع: ${activityType}`);
        } else {
            console.error(`❌ فشل في حفظ نشاط المستخدم ${userId} - النوع: ${activityType}`);
        }

        return saveResult;
    } catch (error) {
        console.error('خطأ في تسجيل نشاط المستخدم:', error);
        return false;
    }
}

// دالة للحصول على إحصائيات المستخدم الفعلية
function getRealUserStats(userId) {
    try {
        const activity = readJsonFile(userActivityPath, {});
        const userStats = activity[userId];

        if (!userStats) {
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

        return {
            messages: userStats.messages || 0,
            voiceTime: userStats.voiceTime || 0,
            lastActivity: userStats.lastActivity ? new Date(userStats.lastActivity).toLocaleDateString('ar-EG') : 'غير معروف',
            joinedChannels: userStats.joinedChannels || 0,
            reactionsGiven: userStats.reactionsGiven || 0,
            activeDays: userStats.activeDays ? userStats.activeDays.length : 0,
            accountAge: userStats.firstSeen ? Date.now() - userStats.firstSeen : 0
        };
    } catch (error) {
        console.error('خطأ في الحصول على إحصائيات المستخدم:', error);
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
        const realStats = getRealUserStats(userId);
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

        return {
            // معلومات أساسية
            userId: userId,
            username: user.username,
            displayName: member.displayName,
            avatar: user.displayAvatarURL({ dynamic: true }),

            // إحصائيات التفاعل الفعلية
            realMessages: realStats.messages,
            realVoiceTime: realStats.voiceTime,
            formattedVoiceTime: formatDuration(realStats.voiceTime),
            joinedChannels: realStats.joinedChannels,
            reactionsGiven: realStats.reactionsGiven,
            activeDays: realStats.activeDays,

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
function getEvaluationType(messageCount, voiceTime, activeDays, daysInServer) {
    // تحميل الإعدادات المخصصة
    const customSettings = loadEvaluationSettings();

    // معايير التقييم من الإعدادات أو القيم الافتراضية
    const EXCELLENT_THRESHOLD = {
        messages: customSettings.minMessages.excellent,
        voiceTime: customSettings.minVoiceTime.excellent,
        activeDays: Math.ceil(customSettings.activeDaysPerWeek.minimum * 2), // ضعف الحد الأدنى للنشاط الأسبوعي
        daysInServer: customSettings.timeInServerDays.excellent
    };

    const GOOD_THRESHOLD = {
        messages: customSettings.minMessages.good,
        voiceTime: customSettings.minVoiceTime.good,
        activeDays: customSettings.activeDaysPerWeek.minimum,
        daysInServer: customSettings.timeInServerDays.minimum
    };

    const WEAK_THRESHOLD = {
        messages: customSettings.minMessages.weak,
        voiceTime: customSettings.minVoiceTime.weak
    };

    // حساب التقييم بناءً على المعايير المخصصة (يجب تحقيق جميع الشروط)
    if (messageCount >= EXCELLENT_THRESHOLD.messages &&
        voiceTime >= EXCELLENT_THRESHOLD.voiceTime &&
        activeDays >= EXCELLENT_THRESHOLD.activeDays &&
        daysInServer >= EXCELLENT_THRESHOLD.daysInServer) {
        return { type: 'ممتاز', emoji: '🌟', color: '#00ff00' };
    } else if (messageCount >= GOOD_THRESHOLD.messages &&
               voiceTime >= GOOD_THRESHOLD.voiceTime &&
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
                    minMessages: evaluation.minMessages || { weak: 20, good: 50, excellent: 100 },
                    minVoiceTime: evaluation.minVoiceTime || { 
                        weak: 2 * 60 * 60 * 1000, 
                        good: 5 * 60 * 60 * 1000, 
                        excellent: 10 * 60 * 60 * 1000 
                    },
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
        minMessages: { weak: 20, good: 50, excellent: 100 },
        minVoiceTime: { 
            weak: 2 * 60 * 60 * 1000, 
            good: 5 * 60 * 60 * 1000, 
            excellent: 10 * 60 * 60 * 1000 
        },
        activeDaysPerWeek: { minimum: 3, resetWeekly: true },
        timeInServerDays: { minimum: 7, excellent: 30 }
    };
}

// دالة لحساب أيام النشاط مع دعم الإعدادات المخصصة
function calculateWeeklyActivity(stats, evaluationSettings) {
    const { activeDaysPerWeek } = evaluationSettings;

    // تحميل إعدادات النشاط المخصصة
    const customSettings = loadEvaluationSettings();
    const activitySettings = customSettings.activeDaysPerWeek;

    // حساب أيام النشاط بناءً على الإعدادات
    let activeDays = 0;
    const now = Date.now();

    if (activitySettings.resetWeekly) {
        // حساب النشاط خلال الأسبوع الحالي فقط
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // بداية الأسبوع (الأحد)
        weekStart.setHours(0, 0, 0, 0);

        const daysSinceWeekStart = Math.floor((now - weekStart.getTime()) / (24 * 60 * 60 * 1000));

        // تقدير أيام النشاط خلال الأسبوع الحالي
        const weeklyMessageAvg = stats.realMessages / Math.max(stats.timeInServerMs / (24 * 60 * 60 * 1000) / 7, 1);
        const weeklyVoiceAvg = stats.realVoiceTime / (stats.timeInServerMs / (24 * 60 * 60 * 1000)) / 7;

        activeDays = Math.min(
            Math.floor(weeklyMessageAvg / 3) + Math.floor(weeklyVoiceAvg / 1),
            daysSinceWeekStart + 1,
            7
        );
    } else {
        // حساب النشاط التراكمي
        const uniqueActiveDays = new Set();

        // فحص النشاط خلال آخر شهر
        if (stats.lastActivity && stats.lastActivity !== 'غير معروف') {
            const daysSinceLastActive = Math.floor((now - new Date(stats.lastActivity).getTime()) / (24 * 60 * 60 * 1000));
            if (daysSinceLastActive <= 30) {
                uniqueActiveDays.add(Math.floor(new Date(stats.lastActivity).getTime() / (24 * 60 * 60 * 1000)));
            }
        }

        // تقدير أيام النشاط بناءً على النشاط العام
        const estimatedActiveDays = Math.min(
            Math.floor(stats.realMessages / 3) + Math.floor(stats.joinedChannels / 1),
            Math.min(stats.timeInServerMs / (24 * 60 * 60 * 1000), 30)
        );

        for (let i = 0; i < estimatedActiveDays && i < 30; i++) {
            const dayTimestamp = Math.floor((now - (i * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));
            uniqueActiveDays.add(dayTimestamp);
        }

        activeDays = uniqueActiveDays.size;
    }
    return activeDays;
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
function createUserStatsEmbed(stats, colorManager) {
    const { EmbedBuilder } = require('discord.js');

    // تحميل إعدادات التقييم
    const evaluationSettings = loadEvaluationSettings();
    const weeklyActivity = calculateWeeklyActivity(stats, evaluationSettings);
    const timeInServerDays = Math.floor(stats.timeInServerMs / (24 * 60 * 60 * 1000));
    
    // حساب الوقت الصوتي لهذا الأسبوع
    const weeklyVoiceTime = calculateWeeklyVoiceTime(stats.userId);

    // تحديد مستوى الرسائل
    let messageLevel = 'ضعيف';
    if (stats.realMessages >= evaluationSettings.minMessages.excellent) {
        messageLevel = 'ممتاز';
    } else if (stats.realMessages >= evaluationSettings.minMessages.good) {
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
    let voiceLevel = 'ضعيف';
    if (stats.realVoiceTime >= evaluationSettings.minVoiceTime.excellent) {
        voiceLevel = 'ممتاز';
    } else if (stats.realVoiceTime >= evaluationSettings.minVoiceTime.good) {
        voiceLevel = 'جيد';
    }

    // تحديد التقييم العام
    let evaluation = '';
    if (stats.realMessages >= evaluationSettings.minMessages.excellent &&
        stats.realVoiceTime >= evaluationSettings.minVoiceTime.excellent &&
        isActiveWeekly &&
        timeInServerDays >= evaluationSettings.timeInServerDays.excellent) {
        evaluation = '🟢 **مرشح ممتاز** - يحقق جميع المعايير المطلوبة';
    } else if (stats.realMessages >= evaluationSettings.minMessages.good &&
               stats.realVoiceTime >= evaluationSettings.minVoiceTime.good &&
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
                value: `🔸 ** messages :** \`${stats.realMessages.toLocaleString()}\`\n🔸 ** voice (الإجمالي):** ${stats.formattedVoiceTime}\n🔸 ** voice  (هذا الأسبوع):** ${formatDuration(weeklyVoiceTime)}\n🔸 ** join voice :** \`${stats.joinedChannels}\`\n🔸 ** reacts :** \`${stats.reactionsGiven}\``,
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
                name: ' **Roles**',
                value: `🔸 ** role count :** \`${stats.roleCount}\`\n🔸 ** Admin ? :** ${stats.hasAdminRoles ? '✅ **نعم**' : '❌ **لا**'}`,
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
            value: `**الرسائل:** ${messageLevel} (${stats.realMessages.toLocaleString()})\n**التفاعل الصوتي:** ${voiceLevel} (${stats.formattedVoiceTime})\n**النشاط:** ${isActiveWeekly ? '✅' : '❌'} ${activityStatus}\n**الخبرة:** ${timeLevel} (${timeInServerDays} يوم)`,
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

    // تتبع الرسائل
    client.on('messageCreate', (message) => {
        if (!message.author.bot && message.guild) {
            trackUserActivity(message.author.id, 'message');
        }
    });

    // تتبع التفاعلات
    client.on('messageReactionAdd', (reaction, user) => {
        if (!user.bot && reaction.message.guild) {
            trackUserActivity(user.id, 'reaction');
        }
    });

    // ملاحظة: تتبع الصوت تم نقله إلى bot.js للتحكم المحسن والمنطق المتقدم
    // تم حذف listener المكرر لتجنب التداخل

    console.log('✅ تم تهيئة نظام تتبع النشاط بنجاح');
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