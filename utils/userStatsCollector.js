const fs = require('fs');
const path = require('path');

// مسارات ملفات البيانات
const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const downLogsPath = path.join(__dirname, '..', 'data', 'downLogs.json');
const activeDownsPath = path.join(__dirname, '..', 'data', 'activeDowns.json');

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

// دالة لتنسيق الوقت
function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return 'لا يوجد';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    const parts = [];
    if (days > 0) parts.push(`${days} يوم`);
    if (hours % 24 > 0) parts.push(`${hours % 24} ساعة`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60} دقيقة`);
    
    return parts.length > 0 ? parts.join(' و ') : 'أقل من دقيقة';
}

// دالة لحساب عدد الرسائل التقريبي
function estimateMessageCount(member) {
    // هذه دالة تقريبية لأن Discord لا يوفر API مباشر لعدد الرسائل
    // يمكن تحسينها عبر تتبع الرسائل في المستقبل
    
    const joinedDaysAgo = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
    const accountDaysOld = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    
    // تقدير بناء على نشاط العضو (هذا تقدير تقريبي)
    let estimatedDaily = 5; // متوسط 5 رسائل في اليوم للمستخدم العادي
    
    // إذا كان العضو لديه دور، قد يكون أكثر نشاطاً
    if (member.roles.cache.size > 1) { // أكثر من دور @everyone
        estimatedDaily = 10;
    }
    
    // إذا كان العضو قديم في السيرفر، قد يكون أكثر نشاطاً
    if (joinedDaysAgo > 30) {
        estimatedDaily *= 1.5;
    }
    
    const estimatedTotal = Math.floor(joinedDaysAgo * estimatedDaily);
    return Math.max(0, estimatedTotal);
}

// دالة لحساب الوقت الصوتي التقريبي
function estimateVoiceTime(member) {
    // هذه أيضاً تقديرية، يمكن تحسينها بتتبع فعلي
    const joinedDaysAgo = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
    
    // تقدير متوسط 30 دقيقة يومياً للمستخدم النشط صوتياً
    let estimatedDailyMinutes = 0;
    
    // إذا كان العضو في رومات صوتية حالياً، فهو نشط صوتياً
    if (member.voice.channelId) {
        estimatedDailyMinutes = 45; // نشط أكثر
    } else if (member.roles.cache.size > 2) { // له أدوار متعددة
        estimatedDailyMinutes = 20; // متوسط
    } else {
        estimatedDailyMinutes = 5; // قليل النشاط الصوتي
    }
    
    const totalMinutes = Math.floor(joinedDaysAgo * estimatedDailyMinutes);
    return totalMinutes * 60 * 1000; // تحويل إلى ميللي ثانية
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
                reason: activeVacation.reason || 'غير محدد'
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
                    roleId: downData.roleId
                };
            }
        }
        
        return { hasDown: false };
    } catch (error) {
        console.error('خطأ في فحص حالة الداون:', error);
        return { hasDown: false };
    }
}

// دالة لجمع آخر نشاط
function getLastActivity(member) {
    // استخدام آخر رسالة إذا كانت متاحة
    let lastActivity = 'غير معروف';
    
    try {
        if (member.user.presence) {
            const status = member.user.presence.status;
            if (status === 'online') {
                lastActivity = 'متصل الآن';
            } else if (status === 'idle') {
                lastActivity = 'خامل';
            } else if (status === 'dnd') {
                lastActivity = 'مشغول';
            } else {
                lastActivity = 'غير متصل';
            }
        } else {
            lastActivity = 'غير متصل';
        }
    } catch (error) {
        lastActivity = 'غير معروف';
    }
    
    return lastActivity;
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
        
        // جمع الإحصائيات
        const messageCount = estimateMessageCount(member);
        const voiceTime = estimateVoiceTime(member);
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
            
            // إحصائيات التفاعل
            estimatedMessages: messageCount,
            estimatedVoiceTime: voiceTime,
            formattedVoiceTime: formatDuration(voiceTime),
            
            // تواريخ مهمة
            joinedServer: joinedAt,
            joinedServerFormatted: new Date(joinedAt).toLocaleDateString('ar-EG'),
            accountCreated: createdAt,
            accountCreatedFormatted: new Date(createdAt).toLocaleDateString('ar-EG'),
            
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

// دالة لإنشاء embed المعلومات
function createUserStatsEmbed(stats, colorManager) {
    const { EmbedBuilder } = require('discord.js');
    
    const embed = new EmbedBuilder()
        .setTitle(`📊 معلومات المرشح للإدارة`)
        .setThumbnail(stats.avatar)
        .setColor(colorManager.getColor() || '#3498db')
        .addFields([
            {
                name: '👤 معلومات أساسية',
                value: `**الاسم:** ${stats.displayName}\n**المعرف:** ${stats.username}\n**حالة الحساب:** ${stats.accountStatus}`,
                inline: false
            },
            {
                name: '📈 إحصائيات النشاط',
                value: `**الرسائل المقدرة:** ${stats.estimatedMessages.toLocaleString()}\n**الوقت الصوتي:** ${stats.formattedVoiceTime}\n**آخر نشاط:** ${stats.lastActivity}`,
                inline: true
            },
            {
                name: '📅 التواريخ',
                value: `**دخل السيرفر:** ${stats.joinedServerFormatted}\n**إنشاء الحساب:** ${stats.accountCreatedFormatted}`,
                inline: true
            },
            {
                name: '⏱️ المدد الزمنية',
                value: `**في السيرفر:** ${stats.timeInServerFormatted}\n**عمر الحساب:** ${stats.accountAgeFormatted}`,
                inline: true
            },
            {
                name: '🏷️ الأدوار الحالية',
                value: `**عدد الأدوار:** ${stats.roleCount}\n**له أدوار إدارية:** ${stats.hasAdminRoles ? 'نعم' : 'لا'}`,
                inline: true
            }
        ])
        .setFooter({ 
            text: `ID: ${stats.userId}`, 
            iconURL: stats.avatar 
        })
        .setTimestamp();

    // إضافة تفاصيل الحالة إذا كانت موجودة
    if (stats.statusDetails) {
        embed.addFields([{
            name: '⚠️ تفاصيل الحالة',
            value: stats.statusDetails,
            inline: false
        }]);
    }

    return embed;
}

module.exports = {
    collectUserStats,
    createUserStatsEmbed,
    formatDuration,
    checkIfHasAdminRoles,
    getVacationStatus,
    getDownStatus
};