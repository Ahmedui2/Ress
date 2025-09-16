const fs = require('fs');
const path = require('path');

// مسار ملف بيانات الوقت الصوتي
const voiceTimeDataPath = path.join(__dirname, '..', 'data', 'voiceTimeData.json');

// دالة لقراءة ملف JSON مع معالجة الأخطاء وإصلاح Sets
function readJsonFile(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsedData = JSON.parse(data);
            
            // إصلاح Sets في totalByChannel
            if (parsedData.totalByChannel) {
                Object.keys(parsedData.totalByChannel).forEach(channelId => {
                    if (parsedData.totalByChannel[channelId].uniqueUsers !== undefined) {
                        const users = parsedData.totalByChannel[channelId].uniqueUsers;
                        // إصلاح البيانات الفاسدة أو تحويل Array إلى Set
                        if (Array.isArray(users)) {
                            // تصفية وتنظيف البيانات - إبقاء الـ strings فقط
                            const cleanUsers = users.filter(user => typeof user === 'string');
                            parsedData.totalByChannel[channelId].uniqueUsers = new Set(cleanUsers);
                        } else if (typeof users === 'object' && users !== null && !users.add) {
                            // إصلاح البيانات الفاسدة (مثل {})
                            parsedData.totalByChannel[channelId].uniqueUsers = new Set();
                        } else if (!users || typeof users.add !== 'function') {
                            // إنشاء Set جديد للحالات الأخرى
                            parsedData.totalByChannel[channelId].uniqueUsers = new Set();
                        }
                    }
                });
            }
            
            // إصلاح Sets في dailyStats
            if (parsedData.dailyStats) {
                Object.keys(parsedData.dailyStats).forEach(date => {
                    if (parsedData.dailyStats[date].uniqueUsers !== undefined) {
                        const users = parsedData.dailyStats[date].uniqueUsers;
                        // إصلاح البيانات الفاسدة أو تحويل Array إلى Set
                        if (Array.isArray(users)) {
                            // تصفية وتنظيف البيانات - إبقاء الـ strings فقط
                            const cleanUsers = users.filter(user => typeof user === 'string');
                            parsedData.dailyStats[date].uniqueUsers = new Set(cleanUsers);
                        } else if (typeof users === 'object' && users !== null && !users.add) {
                            // إصلاح البيانات الفاسدة (مثل {})
                            parsedData.dailyStats[date].uniqueUsers = new Set();
                        } else if (!users || typeof users.add !== 'function') {
                            // إنشاء Set جديد للحالات الأخرى
                            parsedData.dailyStats[date].uniqueUsers = new Set();
                        }
                    }
                });
            }
            
            return parsedData;
        }
        return defaultValue;
    } catch (error) {
        console.error(`خطأ في قراءة ${filePath}:`, error);
        return defaultValue;
    }
}

// دالة لكتابة ملف JSON مع تحويل Sets إلى Arrays تلقائياً
function writeJsonFile(filePath, data) {
    try {
        // إنشاء مجلد البيانات إذا لم يكن موجوداً
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // استخدام replacer لتحويل Sets إلى Arrays تلقائياً
        const replacer = (key, value) => {
            if (value instanceof Set) {
                return Array.from(value);
            }
            return value;
        };
        
        fs.writeFileSync(filePath, JSON.stringify(data, replacer, 2));
        return true;
    } catch (error) {
        console.error(`خطأ في كتابة ${filePath}:`, error);
        return false;
    }
}

// دالة لتنسيق الوقت
function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return 'لا يوجد';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} يوم`);
    if (hours > 0) parts.push(`${hours} ساعة`);
    if (minutes > 0) parts.push(`${minutes} دقيقة`);
    if (seconds > 0 && days === 0) parts.push(`${seconds} ثانية`);

    return parts.length > 0 ? parts.join(' و ') : 'أقل من ثانية';
}

// دالة لحفظ جلسة صوتية
function saveVoiceSession(userId, channelId, channelName, duration, startTime, endTime) {
    try {
        const voiceData = readJsonFile(voiceTimeDataPath, {
            sessions: [],
            totalByUser: {},
            totalByChannel: {},
            dailyStats: {}
        });

        // إنشاء معرف فريد للجلسة
        const sessionId = `${userId}_${startTime}_${Math.random().toString(36).substr(2, 9)}`;
        
        // تاريخ اليوم
        const today = new Date(startTime).toDateString();
        
        // إضافة الجلسة الجديدة
        const session = {
            sessionId,
            userId,
            channelId,
            channelName,
            duration,
            startTime,
            endTime,
            date: today,
            formattedDuration: formatDuration(duration)
        };
        
        voiceData.sessions.push(session);
        
        // تحديث الإجماليات
        if (!voiceData.totalByUser[userId]) {
            voiceData.totalByUser[userId] = {
                totalTime: 0,
                sessionsCount: 0,
                channels: {},
                firstSession: startTime,
                lastSession: endTime
            };
        }
        
        voiceData.totalByUser[userId].totalTime += duration;
        voiceData.totalByUser[userId].sessionsCount += 1;
        voiceData.totalByUser[userId].lastSession = endTime;
        
        // تحديث إحصائيات القناة للمستخدم
        if (!voiceData.totalByUser[userId].channels[channelId]) {
            voiceData.totalByUser[userId].channels[channelId] = {
                channelName,
                totalTime: 0,
                sessionsCount: 0
            };
        }
        
        voiceData.totalByUser[userId].channels[channelId].totalTime += duration;
        voiceData.totalByUser[userId].channels[channelId].sessionsCount += 1;
        
        // تحديث إحصائيات القناة العامة
        if (!voiceData.totalByChannel[channelId]) {
            voiceData.totalByChannel[channelId] = {
                channelName,
                totalTime: 0,
                uniqueUsers: new Set(),
                sessionsCount: 0
            };
        }
        
        voiceData.totalByChannel[channelId].totalTime += duration;
        voiceData.totalByChannel[channelId].sessionsCount += 1;
        
        // التأكد من أن uniqueUsers هو Set
        if (!voiceData.totalByChannel[channelId].uniqueUsers || typeof voiceData.totalByChannel[channelId].uniqueUsers.add !== 'function') {
            voiceData.totalByChannel[channelId].uniqueUsers = new Set(voiceData.totalByChannel[channelId].uniqueUsers || []);
        }
        voiceData.totalByChannel[channelId].uniqueUsers.add(userId);
        
        // تحديث الإحصائيات اليومية
        if (!voiceData.dailyStats[today]) {
            voiceData.dailyStats[today] = {
                totalTime: 0,
                uniqueUsers: new Set(),
                sessionsCount: 0,
                channels: {}
            };
        }
        
        voiceData.dailyStats[today].totalTime += duration;
        voiceData.dailyStats[today].sessionsCount += 1;
        
        // التأكد من أن uniqueUsers هو Set
        if (!voiceData.dailyStats[today].uniqueUsers || typeof voiceData.dailyStats[today].uniqueUsers.add !== 'function') {
            voiceData.dailyStats[today].uniqueUsers = new Set(voiceData.dailyStats[today].uniqueUsers || []);
        }
        voiceData.dailyStats[today].uniqueUsers.add(userId);
        
        if (!voiceData.dailyStats[today].channels[channelId]) {
            voiceData.dailyStats[today].channels[channelId] = {
                channelName,
                totalTime: 0,
                sessionsCount: 0
            };
        }
        
        voiceData.dailyStats[today].channels[channelId].totalTime += duration;
        voiceData.dailyStats[today].channels[channelId].sessionsCount += 1;
        
        // ملاحظة: تحويل Sets إلى Arrays يتم تلقائياً في writeJsonFile
        
        // حفظ البيانات
        const saveResult = writeJsonFile(voiceTimeDataPath, voiceData);
        
        if (saveResult) {
            console.log(`💾 تم حفظ جلسة صوتية: ${formatDuration(duration)} للمستخدم ${userId} في قناة ${channelName}`);
            return sessionId;
        } else {
            console.error(`❌ فشل في حفظ الجلسة الصوتية للمستخدم ${userId}`);
            return null;
        }
        
    } catch (error) {
        console.error('خطأ في حفظ الجلسة الصوتية:', error);
        return null;
    }
}

// دالة للحصول على إحصائيات المستخدم الصوتية
function getUserVoiceStats(userId) {
    try {
        const voiceData = readJsonFile(voiceTimeDataPath, {
            sessions: [],
            totalByUser: {},
            totalByChannel: {},
            dailyStats: {}
        });
        
        const userStats = voiceData.totalByUser[userId];
        if (!userStats) {
            return {
                totalTime: 0,
                formattedTotalTime: 'لا يوجد',
                sessionsCount: 0,
                channels: {},
                averageSessionTime: 0,
                firstSession: null,
                lastSession: null
            };
        }
        
        const averageSessionTime = userStats.sessionsCount > 0 ? 
            userStats.totalTime / userStats.sessionsCount : 0;
        
        return {
            totalTime: userStats.totalTime,
            formattedTotalTime: formatDuration(userStats.totalTime),
            sessionsCount: userStats.sessionsCount,
            channels: userStats.channels || {},
            averageSessionTime,
            formattedAverageSessionTime: formatDuration(averageSessionTime),
            firstSession: userStats.firstSession,
            lastSession: userStats.lastSession
        };
        
    } catch (error) {
        console.error('خطأ في الحصول على إحصائيات المستخدم الصوتية:', error);
        return {
            totalTime: 0,
            formattedTotalTime: 'خطأ',
            sessionsCount: 0,
            channels: {},
            averageSessionTime: 0,
            firstSession: null,
            lastSession: null
        };
    }
}

// دالة للحصول على إحصائيات هذا الأسبوع
function getWeeklyVoiceStats(userId) {
    try {
        const voiceData = readJsonFile(voiceTimeDataPath, { sessions: [] });
        
        // حساب بداية الأسبوع (الأحد)
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        weekStart.setHours(0, 0, 0, 0);
        
        let weeklyTime = 0;
        let weeklySessions = 0;
        const weeklyChannels = {};
        
        voiceData.sessions.forEach(session => {
            if (session.userId === userId) {
                const sessionDate = new Date(session.startTime);
                if (sessionDate >= weekStart) {
                    weeklyTime += session.duration;
                    weeklySessions += 1;
                    
                    if (!weeklyChannels[session.channelId]) {
                        weeklyChannels[session.channelId] = {
                            channelName: session.channelName,
                            totalTime: 0,
                            sessionsCount: 0
                        };
                    }
                    
                    weeklyChannels[session.channelId].totalTime += session.duration;
                    weeklyChannels[session.channelId].sessionsCount += 1;
                }
            }
        });
        
        return {
            weeklyTime,
            formattedWeeklyTime: formatDuration(weeklyTime),
            weeklySessions,
            weeklyChannels,
            weekStart: weekStart.toLocaleDateString('ar-EG')
        };
        
    } catch (error) {
        console.error('خطأ في حساب الإحصائيات الأسبوعية:', error);
        return {
            weeklyTime: 0,
            formattedWeeklyTime: 'خطأ',
            weeklySessions: 0,
            weeklyChannels: {},
            weekStart: 'غير معروف'
        };
    }
}

// دالة لتنظيف البيانات القديمة (الأقدم من شهرين)
function cleanupOldVoiceData() {
    try {
        const voiceData = readJsonFile(voiceTimeDataPath, { sessions: [] });
        const twoMonthsAgo = Date.now() - (60 * 24 * 60 * 60 * 1000); // 60 يوماً
        
        const originalSessionsCount = voiceData.sessions.length;
        voiceData.sessions = voiceData.sessions.filter(session => session.startTime > twoMonthsAgo);
        const cleanedSessionsCount = originalSessionsCount - voiceData.sessions.length;
        
        if (cleanedSessionsCount > 0) {
            writeJsonFile(voiceTimeDataPath, voiceData);
            console.log(`🧹 تم تنظيف ${cleanedSessionsCount} جلسة صوتية قديمة`);
        }
        
        return cleanedSessionsCount;
        
    } catch (error) {
        console.error('خطأ في تنظيف البيانات القديمة:', error);
        return 0;
    }
}

module.exports = {
    saveVoiceSession,
    getUserVoiceStats,
    getWeeklyVoiceStats,
    cleanupOldVoiceData,
    formatDuration
};