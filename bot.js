const { Client, GatewayIntentBits, Partials, Collection, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, Events } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { logEvent } = require('./utils/logs_system.js');
const { startReminderSystem } = require('./commands/notifications.js');
// تعريف downManager في المستوى العلوي للوصول عبر جميع معالجات الأحداث
const downManager = require('./utils/downManager');
const { checkCooldown, startCooldown } = require('./commands/cooldown.js');
const colorManager = require('./utils/colorManager.js');
const vacationManager = require('./utils/vacationManager');
const promoteManager = require('./utils/promoteManager');
const { handleAdminApplicationInteraction } = require('./commands/admin-apply.js');


dotenv.config();

// مسارات ملفات البيانات
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const DATA_FILES = {
    points: path.join(dataDir, 'points.json'),
    responsibilities: path.join(dataDir, 'responsibilities.json'),
    logConfig: path.join(dataDir, 'logConfig.json'),
    adminRoles: path.join(dataDir, 'adminRoles.json'),
    botConfig: path.join(dataDir, 'botConfig.json'),
    cooldowns: path.join(dataDir, 'cooldowns.json'),
    notifications: path.join(dataDir, 'notifications.json'),
    reports: path.join(dataDir, 'reports.json'),
    adminApplications: path.join(dataDir, 'adminApplications.json')
};

// دالة لقراءة ملف JSON
function readJSONFile(filePath, defaultValue = {}) {
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
function writeJSONFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`خطأ في كتابة ${filePath}:`, error);
        return false;
    }
}

// تحميل البيانات مباشرة من الملفات
let points = readJSONFile(DATA_FILES.points, {});
let responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
let logConfig = readJSONFile(DATA_FILES.logConfig, {
    settings: {
        'RESPONSIBILITY_MANAGEMENT': { enabled: false, channelId: null },
        'RESPONSIBLE_MEMBERS': { enabled: false, channelId: null },
        'TASK_LOGS': { enabled: false, channelId: null },
        'POINT_SYSTEM': { enabled: false, channelId: null },
        'ADMIN_ACTIONS': { enabled: false, channelId: null },
        'NOTIFICATION_SYSTEM': { enabled: false, channelId: null },
        'COOLDOWN_SYSTEM': { enabled: false, channelId: null },
        'SETUP_ACTIONS': { enabled: false, channelId: null },
        'BOT_SETTINGS': { enabled: false, channelId: null },
        'ADMIN_CALLS': { enabled: false, channelId: null }
    }
});

// تحميل ADMIN_ROLES من JSON مباشرة
function loadAdminRoles() {
    try {
        const adminRolesData = readJSONFile(DATA_FILES.adminRoles, []);
        return Array.isArray(adminRolesData) ? adminRolesData : [];
    } catch (error) {
        console.error('خطأ في تحميل adminRoles:', error);
        return [];
    }
}

let botConfig = readJSONFile(DATA_FILES.botConfig, {
    owners: [],
    prefix: null,
    settings: {},
    activeTasks: {},
    pendingReports: {}
});

let reportsConfig = readJSONFile(DATA_FILES.reports, {
  enabled: false,
  pointsOnReport: false,
  reportChannel: null,
  requiredFor: [],
  approvalRequiredFor: [],
  templates: {}
});

// لا نحتاج لمتغيرات محلية لـ cooldowns و notifications
// سيتم قراءتها مباشرة من الملفات عند الحاجة

// لا نحتاج لمتغير محلي للبريفكس - سنقرأه مباشرة من JSON

// دوال نظام المهام النشطة والتقارير المعلقة
function initializeActiveTasks() {
  try {
    const masoulCommand = client.commands.get('مسؤول');
    if (masoulCommand && masoulCommand.loadActiveTasks) {
      masoulCommand.loadActiveTasks();
      // مزامنة المهام النشطة
      if (masoulCommand.activeTasks) {
        client.activeTasks = masoulCommand.activeTasks;
        console.log(`✅ تم ربط نظام المهام النشطة مع masoul.js - ${client.activeTasks.size} مهمة نشطة`);
      } else {
        console.log('⚠️ لا توجد مهام نشطة في masoul.js');
      }
    } else {
      console.log('⚠️ لم يتم العثور على أمر مسؤول أو دالة loadActiveTasks');
    }
  } catch (error) {
    console.error('❌ خطأ في تهيئة نظام المهام النشطة:', error);
  }
}

function saveActiveTasks() {
  try {
    const masoulCommand = client.commands.get('مسؤول');
    if (masoulCommand && masoulCommand.saveActiveTasks) {
      masoulCommand.saveActiveTasks();
      console.log(`💾 تم حفظ المهام النشطة باستخدام نظام masoul.js`);
    }
  } catch (error) {
    console.error('❌ خطأ في حفظ المهام النشطة:', error);
  }
}

function loadPendingReports() {
  try {
    const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
    if (currentBotConfig.pendingReports) {
      const savedReports = currentBotConfig.pendingReports;
      for (const [key, value] of Object.entries(savedReports)) {
        client.pendingReports.set(key, value);
      }
      console.log(`✅ تم تحميل ${client.pendingReports.size} تقرير معلق من JSON`);
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل التقارير المعلقة:', error);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// استخدام نظام المهام النشطة من masoul.js
if (!client.activeTasks) {
  client.activeTasks = new Map();
}

// نظام تتبع الجلسات الصوتية
if (!client.voiceSessions) {
  client.voiceSessions = new Map();
}

// إعداد قائمة مالكي البوت من ملف botConfig أولاً، ثم متغير البيئة كبديل
let BOT_OWNERS = [];
if (botConfig.owners && Array.isArray(botConfig.owners) && botConfig.owners.length > 0) {
    BOT_OWNERS = [...botConfig.owners]; // استنساخ المصفوفة
    console.log('✅ تم تحميل المالكين من ملف botConfig.json:', BOT_OWNERS);
} else if (process.env.BOT_OWNERS) {
    BOT_OWNERS = process.env.BOT_OWNERS.split(',').filter(id => id.trim());
    botConfig.owners = BOT_OWNERS;
    writeJSONFile(DATA_FILES.botConfig, botConfig);
    console.log('✅ تم تحميل المالكين من متغير البيئة وحفظهم في botConfig.json:', BOT_OWNERS);
} else {
    console.log('⚠️ لم يتم العثور على مالكين محددين');
}

// دالة لإعادة تحميل BOT_OWNERS من الملف
function reloadBotOwners() {
    try {
        const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
        if (currentBotConfig.owners && Array.isArray(currentBotConfig.owners)) {
            BOT_OWNERS = [...currentBotConfig.owners];
            console.log('🔄 تم إعادة تحميل المالكين:', BOT_OWNERS);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ خطأ في إعادة تحميل المالكين:', error);
        return false;
    }
}

// دالة لتحديث BOT_OWNERS العالمي
function updateBotOwners(newOwners) {
    try {
        if (Array.isArray(newOwners)) {
            console.log('🔄 تحديث المالكين من:', BOT_OWNERS, 'إلى:', newOwners);

            // التحقق من صحة المعرفات
            const validOwners = newOwners.filter(id => typeof id === 'string' && /^\d{17,19}$/.test(id));

            if (validOwners.length !== newOwners.length) {
                console.warn('⚠️ تم تجاهل معرفات غير صحيحة:', newOwners.filter(id => !validOwners.includes(id)));
            }

            // تحديث المصفوفة
            BOT_OWNERS.length = 0; // مسح المصفوفة الحالية
            BOT_OWNERS.push(...validOwners); // إضافة المالكين الصحيحين

            console.log('✅ تم تحديث قائمة المالكين العالمية بنجاح:', BOT_OWNERS);
            return true;
        } else {
            console.error('❌ المدخل ليس مصفوفة:', typeof newOwners);
            return false;
        }
    } catch (error) {
        console.error('❌ خطأ في تحديث المالكين العالمي:', error);
        return false;
    }
}

// Make the functions available globally
global.reloadBotOwners = reloadBotOwners;
global.updateBotOwners = updateBotOwners;

client.commands = new Collection();
client.pendingReports = new Map();
client.logConfig = logConfig;



// Load commands from the "commands" folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = require(path.join(commandsPath, file));
    if ('name' in command && 'execute' in command) {
      client.commands.set(command.name, command);
      console.log(`Loaded command: ${command.name}`);
    }
  } catch (error) {
    console.error(`Error loading command ${file}:`, error);
  }
}

let isDataDirty = false;
let saveTimeout = null;

// Cache للبيانات المستخدمة بكثرة
const dataCache = {
    prefix: null,
    adminRoles: [],
    lastUpdate: 0,
    cacheDuration: 30000 // 30 ثانية
};

const topCommand = require('./commands/top_leaderboard.js');

// دالة لوضع علامة للحفظ مع تأخير ذكي
function scheduleSave() {
    isDataDirty = true;

    // إلغاء المؤقت السابق إذا كان موجوداً
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // تأخير الحفظ لتجميع التغييرات
    saveTimeout = setTimeout(() => {
        saveData();
        saveTimeout = null;
    }, 2000); // حفظ بعد ثانيتين من آخر تغيير

    if (topCommand.invalidateTopCache) {
        topCommand.invalidateTopCache();
    }
}

// دالة حفظ محسنة - أسرع وأقل استهلاك
function saveData(force = false) {
    if (!isDataDirty && !force) {
        return false;
    }

    try {
        // حفظ التقارير المعلقة إذا كان العميل متاحاً
        if (client && client.pendingReports) {
            try {
                const pendingReportsObj = {};
                for (const [key, value] of client.pendingReports.entries()) {
                    pendingReportsObj[key] = value;
                }
                botConfig.pendingReports = pendingReportsObj;
            } catch (error) {
                console.error('❌ خطأ في تجهيز التقارير المعلقة للحفظ:', error);
            }
        }
        // حفظ مباشر بدون قراءة ودمج معقد
        writeJSONFile(DATA_FILES.points, points);
        writeJSONFile(DATA_FILES.responsibilities, responsibilities);
        writeJSONFile(DATA_FILES.logConfig, client.logConfig || logConfig);
        writeJSONFile(DATA_FILES.botConfig, botConfig);
        writeJSONFile(DATA_FILES.reports, reportsConfig);

        isDataDirty = false;
        return true;
    } catch (error) {
        console.error('❌ خطأ في حفظ البيانات:', error);
        return false;
    }
}

// دالة للحصول على البريفكس من الكاش
function getCachedPrefix() {
    const now = Date.now();
    if (dataCache.prefix !== null && (now - dataCache.lastUpdate) < dataCache.cacheDuration) {
        return dataCache.prefix;
    }

    // تحديث الكاش
    const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
    let prefix = currentBotConfig.prefix;

    if (prefix && typeof prefix === 'string' && prefix.startsWith('"') && prefix.endsWith('"')) {
        prefix = prefix.slice(1, -1);
    }

    dataCache.prefix = prefix;
    dataCache.lastUpdate = now;
    return prefix;
}

// دالة للحصول على رولات المشرفين من الكاش
function getCachedAdminRoles() {
    // قراءة مباشرة من الملف دائماً لضمان أحدث البيانات
    const adminRoles = loadAdminRoles();

    console.log(`🔄 تحميل رولات المشرفين: ${adminRoles.length} رول`);
    if (adminRoles.length > 0) {
        console.log(`📋 الرولات المحملة: ${JSON.stringify(adminRoles)}`);
    }

    return adminRoles;
}

// Function to update prefix - محسن مع الكاش
function updatePrefix(newPrefix) {
  const oldPrefix = botConfig.prefix;

  // تحديث البيانات المحلية
  botConfig.prefix = newPrefix;

  // تحديث الكاش فوراً
  dataCache.prefix = newPrefix;
  dataCache.lastUpdate = Date.now();

  // حفظ فوري
  const success = writeJSONFile(DATA_FILES.botConfig, botConfig);

  if (success) {
    console.log(`✅ تم تغيير وحفظ البريفكس من "${oldPrefix === null ? 'null' : oldPrefix}" إلى "${newPrefix === null ? 'null' : newPrefix}" بنجاح`);
  } else {
    console.log(`⚠️ تم تغيير البريفكس ولكن قد تكون هناك مشكلة في الحفظ`);
  }

  // Update VIP command prefix as well
  const vipCommand = client.commands.get('vip');
  if (vipCommand && vipCommand.setCurrentPrefix) {
    vipCommand.setCurrentPrefix(newPrefix);
  }
}

// دالة لإعادة تحميل البيانات من الملفات
function reloadData() {
    try {
        points = readJSONFile(DATA_FILES.points, {});
        responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
        logConfig = readJSONFile(DATA_FILES.logConfig, logConfig);
        client.logConfig = logConfig;

        botConfig = readJSONFile(DATA_FILES.botConfig, botConfig);
        // ADMIN_ROLES, cooldowns, notifications يتم تحميلها ديناميكياً من الملفات عند الحاجة

        console.log('🔄 تم إعادة تحميل جميع البيانات من الملفات');
        return true;
    } catch (error) {
        console.error('❌ خطأ في إعادة تحميل البيانات:', error);
        return false;
    }
}

// دالة تنظيف المعرفات غير الصحيحة
function cleanInvalidUserIds() {
    try {
        let needsSave = false;

        // تنظيف responsibilities
        for (const [respName, respData] of Object.entries(responsibilities)) {
            if (respData.responsibles && Array.isArray(respData.responsibles)) {
                const validIds = respData.responsibles.filter(id => {
                    if (typeof id === 'string' && /^\d{17,19}$/.test(id)) {
                        return true;
                    } else {
                        console.log(`تم حذف معرف غير صحيح من مسؤولية ${respName}: ${id}`);
                        needsSave = true;
                        return false;
                    }
                });
                responsibilities[respName].responsibles = validIds;
            }
        }

        // تنظيف points
        for (const [respName, respData] of Object.entries(points)) {
            if (respData && typeof respData === 'object') {
                for (const userId of Object.keys(respData)) {
                    if (!/^\d{17,19}$/.test(userId)) {
                        console.log(`تم حذف نقاط لمعرف غير صحيح: ${userId}`);
                        delete points[respName][userId];
                        needsSave = true;
                    }
                }
            }
        }

        if (needsSave) {
            saveData();
            console.log('✅ تم تنظيف البيانات من المعرفات غير الصحيحة');
        }
    } catch (error) {
        console.error('❌ خطأ في تنظيف البيانات:', error);
    }
}

// Setup global setup collector function
function setupGlobalSetupCollector(client) {
  try {
    console.log('🔧 إعداد معالج السيتب العام...');

    // Override the collector creation for setup - simplified approach
    client.createMessageComponentCollector = function(options) {
      console.log('🔧 محاولة إنشاء collector للسيتب...');

      // This function will be used by setup.js to create collectors
      // We'll let the setup.js handle the channel selection
      return {
        on: () => {},
        stop: () => {},
        removeAllListeners: () => {}
      };
    };

  } catch (error) {
    console.error('❌ خطأ في إعداد معالج السيتب العام:', error);
  }
}

// دالة لتنظيف الكاش وإجبار التحديث
function invalidateCache() {
    dataCache.prefix = null;
    dataCache.adminRoles = [];
    dataCache.lastUpdate = 0;
}

// دالة لتحديث كاش الرولات فقط
function updateAdminRolesCache() {
    dataCache.adminRoles = [];
    dataCache.lastUpdate = 0;
    // إعادة تحميل من الملف
    getCachedAdminRoles();
}

// Make functions available globally
global.updatePrefix = updatePrefix;
global.scheduleSave = scheduleSave;
global.reloadData = reloadData;
global.cleanInvalidUserIds = cleanInvalidUserIds;
global.setupGlobalSetupCollector = setupGlobalSetupCollector;
global.invalidateCache = invalidateCache;
global.updateAdminRolesCache = updateAdminRolesCache;

client.once(Events.ClientReady, async () => {
  console.log(`✅ تم تسجيل الدخول بنجاح باسم: ${client.user.tag}!`);

    // تهيئة قاعدة البيانات أولاً قبل أي شيء آخر
    try {
        const { initializeDatabase } = require('./utils/database');
        await initializeDatabase();
        console.log('✅ تم تهيئة قاعدة البيانات الرئيسية بنجاح');
    } catch (error) {
        console.error('❌ خطأ في تهيئة قاعدة البيانات:', error);
        // في حالة فشل تهيئة قاعدة البيانات، نتوقف عن العمل
        console.error('❌ توقف البوت بسبب فشل تهيئة قاعدة البيانات');
        return;
    }

    // تهيئة نظام تتبع الجلسات الصوتية (إذا لم يكن موجود)
    if (!client.voiceSessions) {
        client.voiceSessions = new Map();
    }

    // تتبع المستخدمين الموجودين حالياً في القنوات الصوتية
    setTimeout(() => {
        try {
            const guilds = client.guilds.cache;
            let totalActiveUsers = 0;

            guilds.forEach(guild => {
                guild.channels.cache.forEach(channel => {
                    if (channel.type === 2) { // Voice channel
                        const members = channel.members;
                        if (members && members.size > 0) {
                            members.forEach(member => {
                                if (!member.user.bot) {
                                    const userId = member.id;
                                    const now = Date.now();

                                    // إضافة جلسة للمستخدمين الموجودين
                                    if (!client.voiceSessions.has(userId)) {
                                        client.voiceSessions.set(userId, {
                                            startTime: now,
                                            channelId: channel.id,
                                            channelName: channel.name
                                        });
                                        totalActiveUsers++;
                                        console.log(`🎤 تم العثور على ${member.displayName} في ${channel.name} - بدء تتبع الجلسة`);
                                    }
                                }
                            });
                        }
                    }
                });
            });

            if (totalActiveUsers > 0) {
                console.log(`✅ تم تسجيل ${totalActiveUsers} مستخدم نشط في القنوات الصوتية`);
            } else {
                console.log(`📭 لا يوجد مستخدمين في القنوات الصوتية حالياً`);
            }
        } catch (error) {
            console.error('❌ خطأ في تتبع المستخدمين النشطين:', error);
        }
    }, 3000); // انتظار 3 ثواني لضمان تحميل البيانات

    // تهيئة نظام تتبع النشاط للمستخدمين
    try {
        const { initializeActivityTracking } = require('./utils/userStatsCollector');
        await initializeActivityTracking(client);
        console.log('✅ تم تهيئة نظام تتبع النشاط بنجاح');
        console.log('✅ نظام تتبع التفاعلات (reactions) مفعل ومهيأ');
    } catch (error) {
        console.error('❌ خطأ في تهيئة نظام تتبع النشاط:', error);
    }

    // بدء نظام فحص الإجازات المنتهية كل 30 ثانية
    const vacationManager = require('./utils/vacationManager');
    setInterval(async () => {
        try {
            await vacationManager.checkVacations(client);
        } catch (error) {
            console.error('خطأ في فحص الإجازات المنتهية:', error);
        }
    }, 30000); // فحص كل 30 ثانية

    // فحص فوري عند بدء التشغيل
    setTimeout(async () => {
        try {
            await vacationManager.checkVacations(client);
            console.log('✅ تم فحص الإجازات المنتهية عند بدء التشغيل');
        } catch (error) {
            console.error('خطأ في الفحص الأولي للإجازات:', error);
        }
    }, 5000);

    // Initialize down manager with client (expiration checking is handled internally)
    downManager.init(client);
    console.log('✅ تم فحص الداونات المنتهية عند بدء التشغيل');

    // Initialize promote manager with client (after database initialization)
    try {
        const databaseModule = require('./utils/database');
        const database = databaseModule.getDatabase();
        promoteManager.init(client, database);
        console.log('✅ تم تهيئة نظام الترقيات بنجاح مع قاعدة البيانات');
    } catch (error) {
        console.error('❌ خطأ في تهيئة نظام الترقيات:', error);
        // Initialize without database as fallback
        promoteManager.init(client);
        console.log('⚠️ تم تهيئة نظام الترقيات بدون قاعدة البيانات');
    }

    // تتبع النشاط الصوتي باستخدام client.voiceSessions المحسّن
    client.on('voiceStateUpdate', (oldState, newState) => {
        // تجاهل البوتات
        if (!newState.member || newState.member.user.bot) return;

        const userId = newState.member.id;
        const displayName = newState.member.displayName;
        const now = Date.now();

        // معلومات القنوات
        const oldChannelId = oldState.channel?.id;
        const newChannelId = newState.channel?.id;
        const oldChannelName = oldState.channel?.name || 'لا يوجد';
        const newChannelName = newState.channel?.name || 'لا يوجد';

        // تحميل دالة تتبع النشاط
        const { trackUserActivity } = require('./utils/userStatsCollector');

        // التحقق من وجود جلسة نشطة
        const existingSession = client.voiceSessions.get(userId);

        console.log(`🔄 تغيير في الحالة الصوتية للمستخدم ${displayName}:`);
        console.log(`   - القناة القديمة: ${oldChannelName} (${oldChannelId || 'لا يوجد'})`);
        console.log(`   - القناة الجديدة: ${newChannelName} (${newChannelId || 'لا يوجد'})`);

        // 1. المستخدم انضم لقناة صوتية لأول مرة (لم يكن في أي قناة)
        if (!oldChannelId && newChannelId) {
            const joinResult = trackUserActivity(userId, 'voice_join');
            client.voiceSessions.set(userId, { startTime: now, channelId: newChannelId, channelName: newChannelName });
            console.log(`🎤 ${displayName} انضم للقناة الصوتية ${newChannelName} - تم الحفظ: ${joinResult}`);
        }

        // 2. المستخدم غادر القناة الصوتية كلياً (من قناة إلى لا شيء)
        else if (oldChannelId && !newChannelId) {
            if (existingSession) {
                const sessionDuration = now - existingSession.startTime;
                let timeResult = false;
                if (sessionDuration > 0 && existingSession.startTime && existingSession.channelId) {
                    timeResult = trackUserActivity(userId, 'voice_time', {
                        duration: sessionDuration,
                        channelId: existingSession.channelId,
                        channelName: existingSession.channelName,
                        startTime: existingSession.startTime,
                        endTime: now
                    });
                }
                client.voiceSessions.delete(userId);
                console.log(`🎤 ${displayName} غادر القناة الصوتية ${existingSession.channelName} - المدة: ${Math.round(sessionDuration / 1000)} ثانية - تم الحفظ: ${timeResult}`);
            } else {
                console.log(`⚠️ ${displayName} غادر القناة ولكن لا توجد جلسة مسجلة`);
            }
        }

        // 3. المستخدم انتقل بين القنوات (من قناة إلى قناة أخرى)
        else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
            // حفظ الوقت في القناة السابقة
            if (existingSession) {
                const sessionDuration = now - existingSession.startTime;
                let timeResult = false;
                if (sessionDuration > 0 && existingSession.startTime && existingSession.channelId) {
                    timeResult = trackUserActivity(userId, 'voice_time', {
                        duration: sessionDuration,
                        channelId: existingSession.channelId,
                        channelName: existingSession.channelName,
                        startTime: existingSession.startTime,
                        endTime: now
                    });
                }
                console.log(`⏱️ تم حفظ ${Math.round(sessionDuration / 1000)} ثانية من القناة ${existingSession.channelName} - حفظ: ${timeResult}`);
            }

            // تسجيل انضمام للقناة الجديدة وبدء جلسة جديدة
            const joinResult = trackUserActivity(userId, 'voice_join');
            client.voiceSessions.set(userId, { startTime: now, channelId: newChannelId, channelName: newChannelName });
            console.log(`🔄 ${displayName} انتقل من ${oldChannelName} إلى ${newChannelName} - بدء جلسة جديدة: ${joinResult}`);
        }

        // 4. أي تغيير آخر ضمن نفس القناة (mute/unmute, deafen/undeafen, etc.)
        else if (oldChannelId && newChannelId && oldChannelId === newChannelId) {
            // لا نحتاج لفعل شيء هنا - المستخدم لا يزال في نفس القناة
            // قد نضيف تتبع للـ mute/unmute في المستقبل
            console.log(`🔄 ${displayName} تغيير في الحالة ضمن نفس القناة ${newChannelName} - لا يؤثر على تتبع الوقت`);
            return; // لا نحتاج لعرض الإحصائيات
        }

        // عرض الإحصائيات المحدثة بعد ثانية واحدة
        setTimeout(async () => {
            try {
                const { getRealUserStats } = require('./utils/userStatsCollector');
                const stats = await getRealUserStats(userId);
                console.log(`📊 إحصائيات ${displayName}: انضمامات=${stats.joinedChannels}, وقت صوتي=${Math.round(stats.voiceTime / 1000)}ث`);
            } catch (error) {
                console.error(`❌ خطأ في عرض إحصائيات ${displayName}:`, error);
            }
        }, 1000);
    });




  // تنظيف البيانات من المعرفات غير الصحيحة
  cleanInvalidUserIds();

  // تم نقل تتبع الرسائل للمعالج الرئيسي لتجنب التكرار


  // تهيئة نظام المهام النشطة الجديد - بعد تحميل الأوامر
  setTimeout(() => {
    try {
      initializeActiveTasks();
      loadPendingReports();
    } catch (error) {
      console.error('خطأ في تهيئة الأنظمة:', error);
    }
  }, 2000);

  // تهيئة نظام الألوان
  colorManager.initialize(client);
  await colorManager.forceUpdateColor();

  // مراقب لحالة البوت - كل 30 ثانية
  setInterval(() => {
    if (client.ws.status !== 0) { // 0 = READY
      console.log(`⚠️ حالة البوت: ${client.ws.status} - محاولة إعادة الاتصال...`);
    }
  }, 30000);

  // Check for expired reports every 5 minutes
  setInterval(() => {
    checkExpiredReports();
  }, 5 * 60 * 1000);

  // حفظ البيانات فقط عند الحاجة - كل 5 دقائق أو عند وجود تغييرات
  setInterval(() => {
    if (isDataDirty) {
      saveData();
    }
  }, 300 * 1000); // كل 5 دقائق

  setInterval(() => {
    if (client.modalData) {
      const now = Date.now();
      for (const [key, data] of client.modalData.entries()) {
        if (now - data.timestamp > 15 * 60 * 1000) { // 15 دقيقة
          client.modalData.delete(key);
        }
      }
    }
  }, 300 * 1000); // كل 5 دقائق


  // إنشاء backup تلقائي كل ساعة (معطل حالياً لعدم وجود ملف security.js)
  /*
  setInterval(() => {
    try {
      const securityManager = require('./security');
      securityManager.createBackup();
    } catch (error) {
      console.error('فشل في إنشاء backup:', error);
    }
  }, 60 * 60 * 1000); // كل ساعة
  */

  // قراءة البريفكس من الملف مباشرة
  const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
  let currentPrefix = currentBotConfig.prefix;

  // إزالة علامات التنصيص إذا كانت موجودة
  if (currentPrefix && typeof currentPrefix === 'string' && currentPrefix.startsWith('"') && currentPrefix.endsWith('"')) {
    currentPrefix = currentPrefix.slice(1, -1);
  }

  console.log(`البريفكس الحالي: "${currentPrefix === null ? 'null' : currentPrefix}"`);

  // التحقق من نظام الكولداون
  const cooldownData = readJSONFile(DATA_FILES.cooldowns, {});
  console.log(`✅ نظام الكولداون جاهز - الافتراضي: ${(cooldownData.default || 60000) / 1000} ثانية`);

  startReminderSystem(client);

        // تحديث صلاحيات اللوق عند بدء البوت
        setTimeout(async () => {
            try {
                const guild = client.guilds.cache.first();
                if (guild && client.logConfig && client.logConfig.logRoles && client.logConfig.logRoles.length > 0) {
                    const { updateLogPermissions } = require('./commands/logs.js');
                    await updateLogPermissions(guild, client.logConfig.logRoles);
                    console.log('✅ تم تحديث صلاحيات اللوق عند بدء البوت');
                }
            } catch (error) {
                console.error('خطأ في تحديث صلاحيات اللوق عند البدء:', error);
            }
        }, 5000);

  // Set initial prefix for VIP command
  const vipCommand = client.commands.get('vip');
  if (vipCommand && vipCommand.setCurrentPrefix) {
    vipCommand.setCurrentPrefix(currentPrefix);
  }

  // استعادة حالة البوت المحفوظة
  if (vipCommand && vipCommand.restoreBotStatus) {
    setTimeout(() => {
      vipCommand.restoreBotStatus(client);
    }, 2000); // انتظار ثانيتين للتأكد من جاهزية البوت
  }

  // إعداد نظام collectors عام للسيتب
  client.setupCollectors = new Map();

  // إعداد collector عام للسيتب يعمل بعد إعادة التشغيل
  setTimeout(() => {
    setupGlobalSetupCollector(client);
  }, 3000);

  // Check for expired vacations every 2 minutes
  // This is a duplicate of the setInterval above, keeping the one added by the change.
  /*
  setInterval(() => {
    vacationManager.checkVacations(client);
  }, 120000); // 2 minutes
  */

}); // إغلاق client.once('ready')

// تتبع التفاعلات - معالج محسن ومحدث
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    // تجاهل البوتات
    if (user.bot) {
      return;
    }

    // التأكد من وجود الـ guild
    if (!reaction.message.guild) {
      console.log('❌ تم تجاهل تفاعل - لا يوجد guild');
      return;
    }

    console.log(`🎯 تفاعل جديد من ${user.username} (${user.id}) - الإيموجي: ${reaction.emoji.name || reaction.emoji.id || 'custom'}`);

    // التأكد من أن التفاعل مُحمل بالكامل
    if (reaction.partial) {
      try {
        await reaction.fetch();
        console.log(`🔄 تم جلب التفاعل الجزئي بنجاح: ${user.username}`);
      } catch (error) {
        console.error('❌ فشل في جلب التفاعل:', error);
        return;
      }
    }

    // التأكد من أن الرسالة محملة أيضاً
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
        console.log(`📨 تم جلب الرسالة الجزئية بنجاح`);
      } catch (error) {
        console.error('❌ فشل في جلب الرسالة:', error);
        return;
      }
    }

    // التحقق من قاعدة البيانات أولاً
    try {
      const { getDatabase } = require('./utils/database');
      const dbManager = getDatabase();
      
      if (!dbManager || !dbManager.isInitialized) {
        console.log('⚠️ قاعدة البيانات غير مهيأة - تم تجاهل تتبع التفاعل');
        return;
      }

      // تحميل دالة تتبع النشاط
      const { trackUserActivity } = require('./utils/userStatsCollector');

      // تتبع النشاط مع معلومات مفصلة
      console.log(`📊 محاولة تتبع تفاعل المستخدم ${user.username} (${user.id})`);
      
      const success = await trackUserActivity(user.id, 'reaction', {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        emoji: reaction.emoji.name || reaction.emoji.id || 'custom_emoji',
        timestamp: Date.now(),
        guildId: reaction.message.guild.id,
        messageAuthorId: reaction.message.author?.id
      });

      if (success) {
        console.log(`✅ تم تسجيل تفاعل المستخدم ${user.username} بنجاح`);
      } else {
        console.log(`⚠️ فشل في تسجيل تفاعل المستخدم ${user.username}`);
      }
    } catch (trackError) {
      console.error(`❌ خطأ في تتبع التفاعل من ${user.username}:`, trackError);
    }
  } catch (error) {
    // تجاهل الأخطاء المعروفة بصمت
    if (error.code === 10008 || error.code === 50001) {
      return;
    }
    console.error(`❌ خطأ عام في تتبع التفاعل من ${user?.username || 'مستخدم غير معروف'}:`, error);
  }
});

// تتبع إزالة التفاعلات (اختياري)
client.on('messageReactionRemove', async (reaction, user) => {
  try {
    if (user.bot || !reaction.message.guild) return;

    console.log(`👎 تم إزالة تفاعل: ${user.username} (${user.id}) - الإيموجي: ${reaction.emoji.name || reaction.emoji.id || 'custom'}`);
    
    // يمكن إضافة منطق لتتبع إزالة التفاعلات هنا إذا أردت
    // const { trackUserActivity } = require('./utils/userStatsCollector');
    // await trackUserActivity(user.id, 'reaction_remove', { ... });
    
  } catch (error) {
    if (error.code === 10008 || error.code === 50001) {
      return;
    }
    console.error('خطأ في تتبع إزالة التفاعل:', error);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // تتبع النشاط للمستخدمين العاديين (معالج واحد فقط)
  if (message.guild) {
    try {
      const { getDatabase } = require('./utils/database');
      const dbManager = getDatabase();
      
      // التحقق من أن قاعدة البيانات مهيأة
      if (dbManager && dbManager.isInitialized) {
        const { trackUserActivity } = require('./utils/userStatsCollector');
        await trackUserActivity(message.author.id, 'message', {
          channelId: message.channel.id,
          messageId: message.id,
          timestamp: Date.now()
        });
      }
      // تم إزالة رسالة الكونسول لتجنب الإزعاج
    } catch (error) {
      console.error('❌ خطأ في تتبع الرسالة:', error);
    }
  }

  // فحص البلوك قبل معالجة أي أمر
  const { isUserBlocked } = require('./commands/block.js');
  if (isUserBlocked(message.author.id)) {
    return; // تجاهل المستخدمين المحظورين بصمت لتوفير الأداء
  }

  try {
    // التحقق من منشن البوت فقط (ليس الرولات) وليس ريبلاي
    if (message.mentions.users.has(client.user.id) && !message.mentions.everyone && !message.reference) {
      const PREFIX = getCachedPrefix(); // استخدام الكاش

      const prefixEmbed = colorManager.createEmbed()
        .setTitle('Details')
        .setDescription(`**البريفكس الحالي:** ${PREFIX === null ? '**لا يوجد بريفكس **' : `\`${PREFIX}\``}`)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields([
          { name: 'To Help', value: `${PREFIX === null ? '' : PREFIX}help`, inline: true },
        ])
        .setFooter({ text: 'Res Bot By Ahmed.' });

      await message.channel.send({ embeds: [prefixEmbed] });
      return;
    }

    // استخدام الكاش للبريفكس بدلاً من القراءة في كل مرة
    const PREFIX = getCachedPrefix();

    // معالج خاص لأمر "إدارة" (نظام التقديم الإداري)
    if (message.content.trim().startsWith('إدارة') || message.content.trim().startsWith('ادارة')) {
      try {
        const adminApplyCommand = client.commands.get('admin-apply');
        if (adminApplyCommand) {
          // إنشاء pseudo interaction للتوافق مع الكود الحالي
          const pseudoInteraction = {
            user: message.author,
            member: message.member,
            guild: message.guild,
            channel: message.channel,
            message: message,
            reply: async (options) => {
              if (options.ephemeral) {
                // للرسائل الخاصة، أرسلها للمستخدم مباشرة
                try {
                  await message.author.send(options.content || { embeds: options.embeds });
                } catch {
                  await message.channel.send(`${message.author}, ${options.content || 'رسالة خاصة'}`);
                }
              } else {
                await message.channel.send(options.content || { embeds: options.embeds });
              }
            },
            editReply: async (options) => {
              await message.channel.send(options.content || { embeds: options.embeds });
            },
            deferReply: async () => {
              // لا نحتاج لفعل شيء للرسائل العادية
            },
            deferred: false
          };

          await adminApplyCommand.execute(pseudoInteraction);
          return;
        }
      } catch (error) {
        console.error('خطأ في معالج أمر إدارة:', error);
        await message.reply('❌ حدث خطأ في معالجة طلب التقديم الإداري.');
        return;
      }
    }

  let args, commandName;

    // Handle prefix logic - محسن للأداء
    if (PREFIX && PREFIX !== null && PREFIX.trim() !== '') {
      if (!message.content.startsWith(PREFIX)) return;
      args = message.content.slice(PREFIX.length).trim().split(/ +/);
      commandName = args.shift().toLowerCase();
    } else {
      args = message.content.trim().split(/ +/);
      commandName = args.shift().toLowerCase();
    }

    const command = client.commands.get(commandName);
    if (!command) return;

    // Check permissions - محسن مع الكاش
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    const member = message.member || await message.guild.members.fetch(message.author.id);
    const hasAdministrator = member.permissions.has('Administrator');

    // تحميل أحدث رولات المشرفين بشكل فوري لضمان الدقة
    const CURRENT_ADMIN_ROLES = getCachedAdminRoles();
    const hasAdminRole = CURRENT_ADMIN_ROLES.length > 0 && member.roles.cache.some(role => CURRENT_ADMIN_ROLES.includes(role.id));

    // Commands for everyone (help, top, مسؤولياتي)
    if (commandName === 'help' || commandName === 'top' || commandName === 'مسؤولياتي') {
      if (commandName === 'مسؤولياتي') {
        await showUserResponsibilities(message, message.author, responsibilities, client);
      } else {
        await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
      }
    }
    // Commands for everyone (اجازتي)
    else if (commandName === 'اجازتي') {
      await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
    }
    // Commands for admins and owners (مسؤول, اجازه)
    else if (commandName === 'مسؤول' || commandName === 'اجازه') {
      if (commandName === 'مسؤول') {
        console.log(`🔍 التحقق من صلاحيات المستخدم ${message.author.id} لأمر مسؤول:`);
        console.log(`- isOwner: ${isOwner}`);
        console.log(`- hasAdministrator: ${hasAdministrator}`);
        console.log(`- hasAdminRole: ${hasAdminRole}`);
        console.log(`- CURRENT_ADMIN_ROLES count: ${CURRENT_ADMIN_ROLES.length}`);
        console.log(`- CURRENT_ADMIN_ROLES: ${JSON.stringify(CURRENT_ADMIN_ROLES)}`);
        console.log(`- User roles: ${member.roles.cache.map(r => r.id).join(', ')}`);
        console.log(`- User roles names: ${member.roles.cache.map(r => r.name).join(', ')}`);
      }

      if (hasAdminRole || isOwner || hasAdministrator) {
        if (commandName === 'مسؤول') {
          console.log(`✅ تم منح الصلاحية للمستخدم ${message.author.id}`);
        }
        await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
      } else {
        if (commandName === 'مسؤول') {
          console.log(`❌ المستخدم ${message.author.id} لا يملك الصلاحيات المطلوبة لأمر مسؤول`);
        }
        await message.react('❌');
        return;
      }
    }
    // Commands for owners only (call, stats, setup, report, set-vacation)
    else if (commandName === 'call' || commandName === 'stats' || commandName === 'setup' || commandName === 'report' || commandName === 'set-vacation') {
      if (isOwner) {
        await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
      } else {
        await message.react('❌');
        return;
      }
    }
    // Commands for owners only (all other commands)
    else {
      if (isOwner) {
        await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
      } else {
        await message.react('❌');
        return;
      }
    }
  } catch (error) {
    console.error('خطأ في معالج الرسائل:', error);
  }
});

// نظام الحماية ضد إعادة الرولات المسحوبة (للداون والإجازات)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        const userId = newMember.id;
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));

        // 1. حماية نظام الداون
        const activeDowns = downManager.getActiveDowns();
        const userActiveDowns = Object.values(activeDowns).filter(down => down.userId === userId);

        // التحقق من الرولات المضافة حديثاً للداون
        for (const [roleId, role] of addedRoles) {
            const activeDown = userActiveDowns.find(down => down.roleId === roleId);
            if (activeDown) {
                // فحص إذا كان البوت في عملية استعادة الرول (استعادة شرعية)
                if (downManager.isBotRestoring(newMember.guild.id, userId, roleId)) {
                    console.log(`✅ تجاهل إعادة الرول ${role.name} للعضو ${newMember.displayName} - استعادة شرعية بواسطة البوت`);
                    continue;
                }
                // رول تم إضافته بينما هناك داون نشط - يجب إزالته
                console.log(`🚨 محاولة إعادة رول مسحوب (داون): ${role.name} للعضو ${newMember.displayName}`);

                try {
                    // إزالة الرول مرة أخرى
                    await newMember.roles.remove(role, 'منع إعادة رول مسحوب - حماية نظام الداون');

                    // فحص ثاني بعد 10 ثوانٍ للتأكد من الإزالة
                    setTimeout(async () => {
                        try {
                            const updatedMember = await newMember.guild.members.fetch(userId);
                            if (updatedMember.roles.cache.has(roleId)) {
                                await updatedMember.roles.remove(role, 'فحص ثانوي - منع إعادة رول مسحوب');
                                console.log(`🔒 تم إزالة الرول مرة أخرى في الفحص الثانوي: ${role.name}`);
                            }
                        } catch (secondCheckError) {
                            console.error('خطأ في الفحص الثانوي للرول:', secondCheckError);
                        }
                    }, 10000); // 10 ثوانٍ

                    // استخدام نظام السجلات الموحد للحفاظ على التصنيف والتتبع
                    logEvent(client, newMember.guild, {
                        type: 'SECURITY_ACTIONS',
                        title: 'محاولة تجاوز نظام الداون',
                        description: 'تم اكتشاف وإحباط محاولة إعادة رول مسحوب',
                        details: 'نظام الحماية التلقائي تدخل لمنع تجاوز الداون - تم التحقق من نظام تتبع الاستعادة',
                        user: newMember.user,
                        fields: [
                            { name: '👤 العضو المستهدف', value: `<@${userId}>`, inline: true },
                            { name: '🏷️ الرول المُعاد', value: `<@&${roleId}> (${role.name})`, inline: true },
                            { name: '📝 الإجراء المتخذ', value: 'إزالة تلقائية + فحص ثانوي', inline: true },
                            { name: '🚫 السبب الأصلي', value: activeDown.reason || 'غير محدد', inline: false },
                            { name: '📅 ينتهي الداون', value: activeDown.endTime ? `<t:${Math.floor(activeDown.endTime / 1000)}:R>` : 'نهائي', inline: true },
                            { name: '⚡ طُبق بواسطة', value: `<@${activeDown.byUserId}>`, inline: true }
                        ]
                    });

                } catch (removeError) {
                    console.error(`خطأ في إزالة الرول المُعاد إضافته:`, removeError);
                }
            }
        }

        // 2. حماية نظام الإجازات
        const vacations = vacationManager.readJson(path.join(__dirname, 'data', 'vacations.json'));
        const activeVacation = vacations.active?.[userId];

        if (activeVacation && activeVacation.removedRoles) {
            console.log(`🔍 فحص حماية الإجازة للمستخدم ${newMember.displayName}`);

            // التحقق من الرولات المضافة حديثاً
            for (const [roleId, role] of addedRoles) {
                if (activeVacation.removedRoles.includes(roleId)) {
                    // فحص إذا كان البوت في عملية استعادة الرول (استعادة شرعية)
                    if (vacationManager.roleProtection.isBotRestoration(newMember.guild.id, userId, roleId)) {
                        console.log(`✅ تجاهل إعادة الرول ${role.name} للعضو ${newMember.displayName} - استعادة شرعية بواسطة البوت (إجازة)`);
                        continue;
                    }

                    // رول إداري تم إضافته أثناء الإجازة - يجب إزالته
                    console.log(`🚨 محاولة إعادة رول إداري أثناء الإجازة: ${role.name} للعضو ${newMember.displayName}`);

                    try {
                        // إزالة الرول مرة أخرى
                        await newMember.roles.remove(role, 'منع إعادة رول إداري أثناء الإجازة - حماية نظام الإجازات');

                        // فحص ثاني بعد 10 ثوانٍ للتأكد من الإزالة
                        setTimeout(async () => {
                            try {
                                const updatedMember = await newMember.guild.members.fetch(userId);
                                if (updatedMember.roles.cache.has(roleId)) {
                                    await updatedMember.roles.remove(role, 'فحص ثانوي - منع إعادة رول أثناء الإجازة');
                                    console.log(`🔒 تم إزالة الرول مرة أخرى في الفحص الثانوي (إجازة): ${role.name}`);
                                }
                            } catch (secondCheckError) {
                                console.error('خطأ في الفحص الثانوي للرول (إجازة):', secondCheckError);
                            }
                        }, 10000); // 10 ثوانٍ

                        // استخدام نظام السجلات الموحد
                        logEvent(client, newMember.guild, {
                            type: 'SECURITY_ACTIONS',
                            title: 'محاولة تجاوز نظام الإجازات',
                            description: 'تم اكتشاف وإحباط محاولة إعادة رول إداري أثناء الإجازة',
                            details: 'نظام الحماية التلقائي تدخل لمنع تجاوز الإجازة - تم التحقق من نظام تتبع الاستعادة',
                            user: newMember.user,
                            fields: [
                                { name: '👤 العضو في الإجازة', value: `<@${userId}>`, inline: true },
                                { name: '🏷️ الرول المُعاد', value: `<@&${roleId}> (${role.name})`, inline: true },
                                { name: '📝 الإجراء المتخذ', value: 'إزالة تلقائية + فحص ثانوي', inline: true },
                                { name: '🚫 سبب الإجازة', value: activeVacation.reason || 'غير محدد', inline: false },
                                { name: '📅 تنتهي الإجازة', value: `<t:${Math.floor(new Date(activeVacation.endDate).getTime() / 1000)}:R>`, inline: true },
                                { name: '⚡ موافق من', value: `<@${activeVacation.approvedBy}>`, inline: true }
                            ]
                        });

                        // إرسال رسالة تحذيرية للمستخدم
                        try {
                            const user = await client.users.fetch(userId);
                            const warningEmbed = new EmbedBuilder()
                                .setTitle('🚫 تحذير: محاولة استعادة رول أثناء الإجازة')
                                .setColor('#FF0000')
                                .setDescription(`تم اكتشاف محاولة لاستعادة رول إداري أثناء إجازتك النشطة`)
                                .addFields(
                                    { name: '🏷️ الرول المُزال', value: `${role.name}`, inline: true },
                                    { name: '📅 تنتهي إجازتك', value: `<t:${Math.floor(new Date(activeVacation.endDate).getTime() / 1000)}:R>`, inline: true },
                                    { name: '⚠️ تنبيه', value: 'لا يمكن استعادة الأدوار الإدارية أثناء الإجازة. ستتم استعادتها تلقائياً عند انتهاء الإجازة.', inline: false }
                                )
                                .setTimestamp();

                            await user.send({ embeds: [warningEmbed] });
                            console.log(`📧 تم إرسال تحذير للمستخدم ${user.tag} حول محاولة استعادة الرول أثناء الإجازة`);
                        } catch (dmError) {
                            console.error(`❌ فشل في إرسال تحذير للمستخدم ${userId}:`, dmError.message);
                        }

                    } catch (removeError) {
                        console.error(`خطأ في إزالة الرول المُعاد إضافته أثناء الإجازة:`, removeError);
                    }
                }
            }
        }

    } catch (error) {
        console.error('خطأ في نظام الحماية:', error);
    }
});

// نظام حماية عند الانسحاب - حفظ بيانات الداون
client.on('guildMemberRemove', async (member) => {
    try {
        console.log(`📤 عضو غادر السيرفر: ${member.displayName} (${member.id})`);
        
        // Handle down system member leave
        const downManager = require('./utils/downManager');
        await downManager.handleMemberLeave(member);
        
        // Handle promotion system member leave
        await promoteManager.handleMemberLeave(member);
        
        // Handle vacation system member leave
        await vacationManager.handleMemberLeave(member);
        
    } catch (error) {
        console.error('خطأ في معالج الانسحاب:', error);
    }
});

// نظام حماية عند العودة - إعادة تطبيق الداون والترقيات
client.on('guildMemberAdd', async (member) => {
    try {
        console.log(`📥 عضو انضم للسيرفر: ${member.displayName} (${member.id})`);
        
        // Handle down system member join
        const downManager = require('./utils/downManager');
        await downManager.handleMemberJoin(member);
        
        // Handle promotion system member join
        await promoteManager.handleMemberJoin(member);
        
        // Handle vacation system member join
        await vacationManager.handleMemberJoin(member);
        
    } catch (error) {
        console.error('خطأ في معالج العودة:', error);
    }
});

async function handleDownDMInteraction(interaction, context) {
    const { client, BOT_OWNERS } = context;
    const downManager = require('./utils/downManager');

    // Check permissions
    const hasPermission = await downManager.hasPermission(interaction, BOT_OWNERS);
    if (!hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
    }

    const customId = interaction.customId;

    try {
        // Handle DM user selection for role removal
        if (interaction.isUserSelectMenu() && customId === 'dm_down_selected_user') {
            const selectedUserId = interaction.values[0];

            // Get original guild from the first guild the bot is in that has both the user and the admin
            let targetGuild = null;
            for (const guild of client.guilds.cache.values()) {
                try {
                    const member = await guild.members.fetch(selectedUserId);
                    const adminMember = await guild.members.fetch(interaction.user.id);
                    if (member && adminMember) {
                        targetGuild = guild;
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!targetGuild) {
                return interaction.reply({ content: '❌ لم يتم العثور على سيرفر مشترك!', ephemeral: true });
            }

            const selectedUser = await targetGuild.members.fetch(selectedUserId);
            const adminRoles = downManager.getAdminRoles();
            const userAdminRoles = selectedUser.roles.cache.filter(role => adminRoles.includes(role.id));

            if (userAdminRoles.size === 0) {
                const noRolesEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **هذا العضو لا يملك أي رولات إدارية!**');

                return interaction.reply({ embeds: [noRolesEmbed] });
            }

            const roleOptions = userAdminRoles.map(role => ({
                label: role.name,
                value: `${selectedUserId}_${role.id}_${targetGuild.id}`,
                description: `سحب رول ${role.name} من ${selectedUser.displayName}`
            }));

            const roleSelect = new StringSelectMenuBuilder()
                .setCustomId('dm_down_role_selection')
                .setPlaceholder('اختر الرول المراد سحبه...')
                .addOptions(roleOptions);

            const selectRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.reply({
                content: `🔻 **اختر الرول المراد سحبه من ${selectedUser.displayName}:**`,
                components: [selectRow]
            });
            return;
        }

        // Handle DM role selection
        if (interaction.isStringSelectMenu() && customId === 'dm_down_role_selection') {
            const [userId, roleId, guildId] = interaction.values[0].split('_');

            const modal = new ModalBuilder()
                .setCustomId(`dm_down_modal_${userId}_${roleId}_${guildId}`)
                .setTitle('تفاصيل الداون');

            const durationInput = new TextInputBuilder()
                .setCustomId('down_duration')
                .setLabel('المدة (مثل: 7d أو 12h أو permanent)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('7d, 12h, 30m, permanent');

            const reasonInput = new TextInputBuilder()
                .setCustomId('down_reason')
                .setLabel('السبب')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder('اذكر سبب سحب الرول...');

            modal.addComponents(
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(reasonInput)
            );

            await interaction.showModal(modal);
            return;
        }

        // Handle DM modal submission
        if (interaction.isModalSubmit() && customId.startsWith('dm_down_modal_')) {
            const [_, __, ___, userId, roleId, guildId] = customId.split('_');
            const duration = interaction.fields.getTextInputValue('down_duration').trim();
            const reason = interaction.fields.getTextInputValue('down_reason').trim();

            if (duration !== 'permanent' && !ms(duration)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **صيغة المدة غير صحيحة!**\nاستخدم: 7d للأيام، 12h للساعات، 30m للدقائق، أو permanent للدائم');

                return interaction.reply({ embeds: [errorEmbed] });
            }

            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                return interaction.reply({ content: '❌ السيرفر غير موجود!', ephemeral: true });
            }

            const result = await downManager.createDown(
                guild,
                client,
                userId,
                roleId,
                duration,
                reason,
                interaction.user.id
            );

            if (result.success) {
                const member = await guild.members.fetch(userId);
                const role = await guild.roles.fetch(roleId);

                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ تم تطبيق الداون بنجاح')
                    .addFields([
                        { name: 'العضو', value: `${member}`, inline: true },
                        { name: 'الرول', value: `${role}`, inline: true },
                        { name: 'المدة', value: duration === 'permanent' ? 'نهائي' : duration, inline: true },
                        { name: 'السبب', value: reason, inline: false },
                        { name: 'السيرفر', value: guild.name, inline: true }
                    ])
                    .setTimestamp();

                await interaction.reply({ embeds: [successEmbed] });
            } else {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription(`❌ **فشل في تطبيق الداون:** ${result.error}`);

                await interaction.reply({ embeds: [errorEmbed] });
            }
            return;
        }

        // Handle other DM down interactions similarly...
        // Add more DM handlers as needed for user records, modify duration, etc.

    } catch (error) {
        console.error('Error in DM down interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة التفاعل!', ephemeral: true });
        }
    }
}

function savePendingReports() {
  try {
    const pendingReportsObj = {};
    for (const [key, value] of client.pendingReports.entries()) {
      pendingReportsObj[key] = value;
    }
    botConfig.pendingReports = pendingReportsObj;
  } catch (error) {
    console.error('❌ خطأ في تجهيز التقارير المعلقة للحفظ:', error);
  }
}

async function checkExpiredReports() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    let changed = false;

    for (const [reportId, reportData] of client.pendingReports.entries()) {
        if (reportData.submittedAt && (now - reportData.submittedAt > twentyFourHours)) {
            console.log(`Report ${reportId} has expired. Automatically rejecting.`);

            if (reportData.approvalMessageIds) {
                for (const [channelId, messageId] of Object.entries(reportData.approvalMessageIds)) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        const message = await channel.messages.fetch(messageId);

                        const originalEmbed = message.embeds[0];
                        if (originalEmbed) {
                            const newEmbed = new EmbedBuilder.from(originalEmbed)
                                .setFields(
                                    ...originalEmbed.fields.filter(f => f.name !== 'الحالة'),
                                    { name: 'الحالة', value: '❌ تم الرفض تلقائياً لمرور 24 ساعة' }
                                );
                            await message.edit({ embeds: [newEmbed], components: [] });
                        }
                    } catch(e) {
                        console.error(`Could not edit expired report message ${messageId} in channel ${channelId}:`, e);
                    }
                }
            }

            client.pendingReports.delete(reportId);
            changed = true;
        }
    }
    if (changed) {
        scheduleSave();
    }
}

// معالج التفاعلات المحسن للأداء
client.on('interactionCreate', async (interaction) => {
  try {
    // فحص سريع للتفاعلات غير الصحيحة
    if (!interaction?.isRepliable()) {
      console.log('تفاعل غير قابل للرد');
      return;
    }

    // فحص عمر التفاعل بشكل أسرع (12 دقيقة بدلاً من 14)
    const interactionAge = Date.now() - interaction.createdTimestamp;
    if (interactionAge > 720000) { // 12 دقيقة
      console.log('تفاعل منتهي الصلاحية');
      return;
    }

    // فحص حالة التفاعل
    if (interaction.replied || interaction.deferred) {
      console.log('تفاعل تم الرد عليه مسبقاً');
      return;
    }

    // فحص البلوك بشكل مبكر
    const { isUserBlocked } = require('./commands/block.js');
    if (isUserBlocked(interaction.user.id)) {
      return; // تجاهل بصمت لتوفير الأداء
    }


    // Handle log system interactions
    if (interaction.customId && (interaction.customId.startsWith('log_') ||
        interaction.customId === 'auto_set_logs' ||
        interaction.customId === 'disable_all_logs' ||
        interaction.customId === 'manage_log_roles' ||
        interaction.customId === 'add_log_roles' ||
        interaction.customId === 'remove_log_roles' ||
        interaction.customId === 'select_roles_to_add_log' ||
        interaction.customId === 'select_roles_to_remove_log' ||
        interaction.customId === 'back_to_main_logs' ||
        interaction.customId === 'back_to_log_roles_menu' ||
        interaction.customId === 'add_all_admin_roles_log' ||
        interaction.customId === 'remove_all_log_roles')) {
        console.log(`معالجة تفاعل السجلات: ${interaction.customId}`);

        // تعريف arabicEventTypes للاستخدام في جميع المعالجات
        const arabicEventTypes = {
            'RESPONSIBILITY_MANAGEMENT': 'إدارة المسؤوليات',
            'RESPONSIBLE_MEMBERS': 'مساعدة الاعضاء',
            'TASK_LOGS': 'المهام',
            'POINT_SYSTEM': 'نظام النقاط',
            'ADMIN_ACTIONS': 'إجراءات الإدارة',
            'NOTIFICATION_SYSTEM': 'نظام التنبيهات',
            'COOLDOWN_SYSTEM': 'نظام الكولداون',
            'SETUP_ACTIONS': 'إجراءات السيتب',
            'BOT_SETTINGS': 'إعدادات البوت',
            'ADMIN_CALLS': 'استدعاء الإداريين'
        };

        const logCommand = client.commands.get('log');
        if (logCommand && logCommand.handleInteraction) {
            await logCommand.handleInteraction(interaction, client, saveData);
        }
        return;
    }

    // --- Points, Rating and Activity Modification System ---
    if (interaction.customId && (
        interaction.customId.startsWith('points_edit_') ||
        interaction.customId.startsWith('activity_edit_') ||
        interaction.customId.startsWith('rating_edit_') ||
        interaction.customId.startsWith('edit_points_') ||
        interaction.customId.startsWith('modify_activity_') ||
        interaction.customId === 'edit_points_start' ||
        interaction.customId === 'select_resp_for_edit'
    )) {
        console.log(`معالجة تفاعل تعديل النقاط/النشاط: ${interaction.customId}`);

        try {
            // Handle points editing interactions
            if (interaction.customId.startsWith('points_edit_') ||
                interaction.customId.startsWith('edit_points_') ||
                interaction.customId === 'edit_points_start') {

                const resetCommand = client.commands.get('reset');
                if (resetCommand && resetCommand.handleMainInteraction) {
                    await resetCommand.handleMainInteraction(interaction);
                } else {
                    console.log('⚠️ لم يتم العثور على معالج تعديل النقاط في أمر reset');
                    await interaction.reply({
                        content: '❌ معالج تعديل النقاط غير متوفر حالياً',
                        ephemeral: true
                    });
                }
                return;
            }

            // Handle activity editing interactions
            if (interaction.customId.startsWith('activity_edit_') ||
                interaction.customId.startsWith('modify_activity_')) {

                const statsCommand = client.commands.get('stats');
                if (statsCommand && statsCommand.handleActivityEdit) {
                    await statsCommand.handleActivityEdit(interaction, {
                        points: points,
                        responsibilities: responsibilities,
                        saveData: scheduleSave,
                        client: client
                    });
                } else {
                    console.log('⚠️ لم يتم العثور على معالج تعديل النشاط');
                    await interaction.reply({
                        content: '❌ معالج تعديل النشاط غير متوفر حالياً',
                        ephemeral: true
                    });
                }
                return;
            }

            // Handle rating editing interactions
            if (interaction.customId.startsWith('rating_edit_')) {

                const setadminCommand = client.commands.get('setadmin');
                if (setadminCommand && setadminCommand.handleInteraction) {
                    await setadminCommand.handleInteraction(interaction);
                } else {
                    console.log('⚠️ لم يتم العثور على معالج تعديل التقييم');
                    await interaction.reply({
                        content: '❌ معالج تعديل التقييم غير متوفر حالياً',
                        ephemeral: true
                    });
                }
                return;
            }

            // Handle responsibility selection for editing
            if (interaction.customId === 'select_resp_for_edit') {
                const resetCommand = client.commands.get('reset');
                if (resetCommand && resetCommand.handleMainInteraction) {
                    await resetCommand.handleMainInteraction(interaction);
                } else {
                    console.log('⚠️ لم يتم العثور على معالج اختيار المسؤولية للتعديل');
                    await interaction.reply({
                        content: '❌ معالج اختيار المسؤولية للتعديل غير متوفر حالياً',
                        ephemeral: true
                    });
                }
                return;
            }

            // Fallback for any unhandled edit interactions
            console.log(`⚠️ تفاعل تعديل غير مُعرَّف: ${interaction.customId}`);
            await interaction.reply({
                content: '❌ هذه الميزة قيد التطوير - يرجى المحاولة لاحقاً',
                ephemeral: true
            });

        } catch (error) {
            console.error('خطأ في معالجة تفاعلات تعديل النقاط/النشاط:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ أثناء معالجة طلب التعديل',
                    ephemeral: true
                });
            }
        }
        return;
    }

    // --- SetAdmin System Interaction Router ---
    if (interaction.customId && (
        interaction.customId === 'setadmin_menu' ||
        interaction.customId === 'select_application_channel' ||
        interaction.customId === 'select_approver_type' ||
        interaction.customId === 'select_approver_roles' ||
        interaction.customId === 'select_approver_responsibility' ||
        interaction.customId === 'set_pending_limit_modal' ||
        interaction.customId === 'set_cooldown_modal' ||
        interaction.customId === 'select_evaluation_setting' ||
        interaction.customId === 'messages_criteria_modal' ||
        interaction.customId === 'voice_time_criteria_modal' ||
        interaction.customId === 'activity_criteria_modal' ||
        interaction.customId === 'server_time_criteria_modal'
    )) {
        console.log(`معالجة تفاعل setadmin: ${interaction.customId}`);

        try {
            const setAdminCommand = client.commands.get('setadmin');
            if (setAdminCommand && setAdminCommand.handleInteraction) {
                await setAdminCommand.handleInteraction(interaction);
            }
        } catch (error) {
            console.error('خطأ في معالجة تفاعل setadmin:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'حدث خطأ في معالجة إعدادات التقديم الإداري.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('خطأ في الرد على خطأ setadmin:', replyError);
            }
        }
        return;
    }

    // --- Admin Application System Interaction Router ---
    if (interaction.customId && (
        interaction.customId.startsWith('admin_approve_') ||
        interaction.customId.startsWith('admin_reject_') ||
        interaction.customId.startsWith('admin_select_roles_') ||
        interaction.customId.startsWith('admin_details_')
    )) {
        console.log(`معالجة تفاعل التقديم الإداري: ${interaction.customId}`);

        try {
            const handled = await handleAdminApplicationInteraction(interaction);
            if (!handled) {
                console.log('لم يتم معالجة التفاعل في نظام التقديم الإداري');
            }
        } catch (error) {
            console.error('خطأ في معالجة التقديم الإداري:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ حدث خطأ في معالجة طلب التقديم الإداري.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('خطأ في الرد على خطأ التقديم الإداري:', replyError);
            }
        }
        return;
    }

    // --- Promotion System Interaction Router ---
    if (interaction.customId && interaction.customId.startsWith('promote_')) {
        console.log(`معالجة تفاعل نظام الترقيات: ${interaction.customId}`);

        try {
            const promoteContext = { client, BOT_OWNERS };
            const promoteCommand = client.commands.get('promote');
            
            if (promoteCommand && promoteCommand.handleInteraction) {
                await promoteCommand.handleInteraction(interaction, promoteContext);
            } else {
                // إذا لم يتم العثور على أمر promote، استخدم promoteManager مباشرة
                await promoteManager.handleInteraction(interaction, promoteContext);
            }
        } catch (error) {
            console.error('خطأ في معالجة نظام الترقيات:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ حدث خطأ في معالجة نظام الترقيات.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('خطأ في الرد على خطأ نظام الترقيات:', replyError);
            }
        }
        return;
    }

    // --- Vacation System Interaction Router ---
    if (interaction.customId && interaction.customId.startsWith('vac_')) {
        const vacationContext = { client, BOT_OWNERS };

        // Route to set-vacation command - تحسين معالجة التفاعلات
        if (interaction.customId.includes('_set_') ||
            interaction.customId.includes('_choice_') ||
            interaction.customId.includes('_select') ||
            interaction.customId.includes('_back_') ||
            interaction.customId === 'vac_set_approver' ||
            interaction.customId === 'vac_set_notification' ||
            interaction.customId === 'vac_back_main' ||
            interaction.customId.startsWith('vac_choice_') ||
            interaction.customId === 'vac_role_select' ||
            interaction.customId === 'vac_channel_select' ||
            interaction.customId === 'vac_resp_select') {
             const setVacationCommand = client.commands.get('set-vacation');
             if (setVacationCommand && setVacationCommand.handleInteraction) {
                 await setVacationCommand.handleInteraction(interaction, vacationContext);
             }
             return;
        }

        // Route to vacation (ajaza) command
        if (interaction.customId.startsWith('vac_request_')) {
            const vacationCommand = client.commands.get('اجازه');
            if (vacationCommand && vacationCommand.handleInteraction) {
                await vacationCommand.handleInteraction(interaction, vacationContext);
            }
            return;
        }

        // Route to my-vacation (ajazati) command for all vacation ending interactions
        if (interaction.customId.startsWith('vac_end_request_') ||
            interaction.customId.startsWith('vac_end_confirm_') ||
            interaction.customId === 'vac_end_cancel') {
            const myVacationCommand = client.commands.get('اجازتي');
            if (myVacationCommand && myVacationCommand.handleInteraction) {
                await myVacationCommand.handleInteraction(interaction, vacationContext);
            }
            return;
        }

        // Handle vacation termination requests first
        if (interaction.customId.startsWith('vac_approve_termination_') || interaction.customId.startsWith('vac_reject_termination_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // approve or reject
            const userId = parts[3];

            // فحص الصلاحيات قبل السماح بالموافقة/الرفض على الإنهاء
            const vacationSettings = vacationManager.getSettings();
            const isAuthorizedApprover = await vacationManager.isUserAuthorizedApprover(
                interaction.user.id,
                interaction.guild,
                vacationSettings,
                BOT_OWNERS
            );

            if (!isAuthorizedApprover) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setDescription('❌ **ليس لديك صلاحية للموافقة أو رفض طلبات إنهاء الإجازات.**');
                return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

            const vacations = require('./utils/vacationManager').readJson(path.join(__dirname, 'data', 'vacations.json'));
            const pendingTermination = vacations.pendingTermination?.[userId];

            if (!pendingTermination) {
                return interaction.reply({ content: 'لا يوجد طلب إنهاء إجازة معلق لهذا المستخدم.', ephemeral: true });
            }

            if (action === 'approve') {
                // الموافقة على إنهاء الإجازة
                const result = await require('./utils/vacationManager').endVacation(
                    interaction.guild,
                    client,
                    userId,
                    'تم إنهاء الإجازة مبكراً بناءً على طلب المستخدم'
                );

                if (result.success) {
                    const successEmbed = new EmbedBuilder()
                        .setColor(colorManager.getColor() || '#00FF00')
                        .setDescription(`✅ **تم إنهاء إجازة <@${userId}>**`);

                    await interaction.update({ embeds: [successEmbed], components: [] });

                    // إرسال إشعار للمستخدم
                    try {
                        const user = await client.users.fetch(userId);
                        const notificationEmbed = new EmbedBuilder()
                            .setTitle('تم الموافقة على إنهاء الإجازة')
                            .setColor(colorManager.getColor() || '#00FF00')
                            .setDescription('تم الموافقة على طلبك لإنهاء الإجازة مبكراً')
                            .addFields(
                                { name: 'موافق من قبل', value: `<@${interaction.user.id}>`, inline: true },
                                { name: 'وقت الموافقة', value: new Date().toLocaleString('en-US', {
                                    timeZone: 'Asia/Riyadh',
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                }), inline: true }
                            )
                            .setTimestamp();

                        await user.send({ embeds: [notificationEmbed] });
                    } catch (error) {
                        console.error(`فشل في إرسال إشعار للمستخدم ${userId}:`, error);
                    }
                } else {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(`❌ **فشل في إنهاء الإجازة:** ${result.message}`);

                    await interaction.update({ embeds: [errorEmbed], components: [] });
                }
                return;
            } else if (action === 'reject') {
                // رفض طلب إنهاء الإجازة
                const vacations = require('./utils/vacationManager').readJson(path.join(__dirname, 'data', 'vacations.json'));

                if (vacations.pendingTermination && vacations.pendingTermination[userId]) {
                    delete vacations.pendingTermination[userId];
                    require('./utils/vacationManager').saveVacations(vacations);
                }

                const rejectionEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setDescription(`❌ **تم رفض طلب إنهاء إجازة <@${userId}>**`);

                await interaction.update({ embeds: [rejectionEmbed], components: [] });

                // إرسال إشعار للمستخدم بالرفض
                try {
                    const user = await client.users.fetch(userId);
                    const notificationEmbed = new EmbedBuilder()
                        .setTitle('تم رفض طلب إنهاء الإجازة')
                        .setColor('#FF0000')
                        .setDescription('تم رفض طلبك لإنهاء الإجازة مبكراً')
                        .addFields(
                            { name: 'مرفوض من قبل', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'وقت الرفض', value: new Date().toLocaleString('ar-SA'), inline: true }
                        )
                        .setTimestamp();

                    await user.send({ embeds: [notificationEmbed] });
                } catch (error) {
                    console.error(`فشل في إرسال إشعار للمستخدم ${userId}:`, error);
                }
            }
            return;
        }

        // Handle regular vacation approvals and rejections
        if (interaction.customId.startsWith('vac_approve_') || interaction.customId.startsWith('vac_reject_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // approve or reject
            const userId = parts[2];

            // فحص الصلاحيات قبل السماح بالموافقة/الرفض
            const vacationSettings = vacationManager.getSettings();
            const isAuthorizedApprover = await vacationManager.isUserAuthorizedApprover(
                interaction.user.id,
                interaction.guild,
                vacationSettings,
                BOT_OWNERS
            );

            if (!isAuthorizedApprover) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setDescription('❌ **ليس لديك صلاحية للموافقة أو رفض طلبات الإجازات.**');
                return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

            if (action === 'approve') {
                const result = await vacationManager.approveVacation(interaction, userId, interaction.user.id);
                if (result.success) {
                    const removedRolesText = result.vacation.removedRoles && result.vacation.removedRoles.length > 0
                        ? result.vacation.removedRoles.map(id => `<@&${id}>`).join(', ')
                        : 'لا توجد أدوار إدارية تم سحبها';

                    const updatedEmbed = new EmbedBuilder()
                        .setColor(colorManager.getColor('approved') || '#2ECC71')
                        .setTitle('✅ تم قبول طلب الإجازة')
                        .setDescription(`**تم قبول إجازة <@${userId}>**`)
                        .addFields(
                            { name: '📋 الأدوار التي تم سحبها فعلياً', value: removedRolesText, inline: false },
                            { name: '📊 عدد الأدوار المسحوبة', value: `${result.vacation.removedRoles?.length || 0} دور`, inline: true },
                            { name: '⏰ مدة الإجازة', value: `من <t:${Math.floor(new Date(result.vacation.startDate).getTime() / 1000)}:f> إلى <t:${Math.floor(new Date(result.vacation.endDate).getTime() / 1000)}:f>`, inline: false }
                        )
                        .setTimestamp();

                    await interaction.update({ embeds: [updatedEmbed], components: [] });

                    const user = await client.users.fetch(userId).catch(() => null);
                    if (user) {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('تم قبول طلب الإجازة')
                            .setColor(colorManager.getColor('approved') || '#2ECC71')
                            .setDescription('تم الموافقة على طلب إجازتك. تم سحب أدوارك الإدارية مؤقتاً وستعود عند انتهاء الإجازة.')
                            .setFooter({ text: 'استمتع بإجازتك!' });
                        await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`فشل في إرسال رسالة للمستخدم ${userId}: ${err}`));
                    }
                } else {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(`❌ **فشل في الموافقة:** ${result.message}`);
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
                return;
            }

            if (action === 'reject') {
                const vacations = vacationManager.readJson(path.join(__dirname, 'data', 'vacations.json'));
                if (vacations.pending) {
                    delete vacations.pending[userId];
                }
                vacationManager.saveVacations(vacations);

                const rejectEmbed = new EmbedBuilder()
                    .setColor(colorManager.getColor('rejected') || '#E74C3C')
                    .setDescription(`❌ **تم رفض إجازة <@${userId}>**`);

                await interaction.update({ embeds: [rejectEmbed], components: [] });

                const user = await client.users.fetch(userId).catch(() => null);
                if (user) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('تم رفض طلب الإجازة')
                        .setColor(colorManager.getColor('rejected') || '#E74C3C')
                        .setDescription('تم رفض طلب إجازتك.')
                        .addFields(
                            { name: 'مرفوض من', value: `<@${interaction.user.id}>` }
                        )
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`فشل في إرسال رسالة للمستخدم ${userId}: ${err}`));
                }
                return;
            }
        }

        // The old handler for early termination has been moved to my-vacation.js
    }

    // Handle adminroles interactions
    if (interaction.customId && (interaction.customId.startsWith('adminroles_') ||
        interaction.customId === 'adminroles_select_role')) {
        console.log(`معالجة تفاعل رولات المشرفين: ${interaction.customId}`);
        // These are handled within the adminroles command itself
        return;
    }

    // Handle DM down interactions separately
    if (interaction.customId && interaction.customId.startsWith('dm_down_')) {
        console.log(`معالجة تفاعل DM down: ${interaction.customId}`);
        const downCommand = client.commands.get('down');
        if (downCommand && downCommand.handleInteraction) {
            await downCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // --- Create a unified context object for all interaction handlers ---
    const context = {
        client,
        responsibilities,
        points,
        scheduleSave,
        BOT_OWNERS,
        reportsConfig,
        logConfig: client.logConfig,
        colorManager
    };

    // Handle cooldown system interactions
    if (interaction.customId && interaction.customId.startsWith('cooldown_')) {
        const cooldownCommand = client.commands.get('cooldown');
        if (cooldownCommand && cooldownCommand.handleInteraction) {
            await cooldownCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // --- Down System Interaction Router ---
    if (interaction.customId && (interaction.customId.startsWith('down_') || interaction.customId.startsWith('dm_down_'))) {
        console.log(`معالجة تفاعل down: ${interaction.customId}`);

        // Load fresh admin roles for down system
        const ADMIN_ROLES = getCachedAdminRoles();
        context.ADMIN_ROLES = ADMIN_ROLES;

        const downCommand = client.commands.get('down');
        if (downCommand && downCommand.handleInteraction) {
            try {
                await downCommand.handleInteraction(interaction, context);
            } catch (error) {
                console.error('خطأ في معالجة تفاعل down:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ حدث خطأ أثناء معالجة التفاعل. يرجى المحاولة مرة أخرى.',
                        ephemeral: true
                    }).catch(() => {});
                }
            }
        }
        return;
    }

    // Handle notifications system interactions
    if (interaction.customId && (interaction.customId.startsWith('notification_') ||
        interaction.customId === 'select_responsibility_time')) {
        const notificationsCommand = client.commands.get('notifications');
        if (notificationsCommand && notificationsCommand.handleInteraction) {
            await notificationsCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // Handle notifications modal submissions
    if (interaction.isModalSubmit() && (interaction.customId.startsWith('change_global_time_modal') ||
        interaction.customId.startsWith('responsibility_time_modal_'))) {
        const notificationsCommand = client.commands.get('notifications');
        if (notificationsCommand && notificationsCommand.handleModalSubmit) {
            await notificationsCommand.handleModalSubmit(interaction, client, responsibilities);
        }
        return;
    }

    // Handle VIP system interactions
    if (interaction.customId && (interaction.customId.startsWith('vip_') ||
        interaction.customId === 'vip_status_select')) {
        const vipCommand = client.commands.get('vip');
        if (vipCommand && vipCommand.handleInteraction) {
            await vipCommand.handleInteraction(interaction, client, { guild: interaction.guild, author: interaction.user });
        }
        return;
    }

    // Handle VIP modal submissions
    if (interaction.isModalSubmit() && (interaction.customId === 'vip_prefix_modal' ||
        interaction.customId === 'vip_name_modal' ||
        interaction.customId === 'vip_avatar_modal' ||
        interaction.customId === 'vip_banner_modal' ||
        interaction.customId.startsWith('activity_modal_'))) {
        const vipCommand = client.commands.get('vip');
        if (vipCommand && vipCommand.handleModalSubmit) {
            await vipCommand.handleModalSubmit(interaction, client);
        }
        return;
    }

    if (interaction.customId.startsWith('report_')) {
        const reportCommand = client.commands.get('report');
        if (reportCommand && reportCommand.handleInteraction) {
            await reportCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // Handle adminroles interactions
    if (interaction.customId && interaction.customId.startsWith('adminroles_')) {
        console.log(`معالجة تفاعل adminroles: ${interaction.customId}`);
        const adminRolesCommand = client.commands.get('adminroles');
        if (adminRolesCommand && adminRolesCommand.handleInteraction) {
            await adminRolesCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // Handle claim buttons - استخدام المعالج الجديد من masoul.js
    if (interaction.isButton() && interaction.customId.startsWith('claim_task_')) {
        const masoulCommand = client.commands.get('مسؤول');
        if (masoulCommand && masoulCommand.handleInteraction) {
            await masoulCommand.handleInteraction(interaction, context);
        }
        return;
    }

    // Handle modal submissions for call مع معالجة محسنة
    if (interaction.isModalSubmit() && interaction.customId.startsWith('call_reason_modal_')) {
      // التحقق الشامل من صلاحية التفاعل
      if (!interaction || !interaction.isModalSubmit()) {
        console.log('تفاعل مودال غير صالح');
        return;
      }

      // التحقق من عمر التفاعل
      const now = Date.now();
      const interactionTime = interaction.createdTimestamp;
      const timeDiff = now - interactionTime;

      if (timeDiff > 13 * 60 * 1000) {
        console.log('تم تجاهل مودال منتهي الصلاحية');
        return;
      }

      // منع التفاعلات المتكررة
      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في نموذج الاستدعاء');
        return;
      }

      const customIdParts = interaction.customId.replace('call_reason_modal_', '').split('_');
      const responsibilityName = customIdParts[0];
      const target = customIdParts[1];
      const reason = interaction.fields.getTextInputValue('reason').trim() || 'لا يوجد سبب محدد';

      if (!responsibilities[responsibilityName]) {
        return interaction.reply({ content: '**المسؤولية غير موجودة!**', ephemeral: true });
      }

      const responsibility = responsibilities[responsibilityName];
      const responsibles = responsibility.responsibles || [];

      if (responsibles.length === 0) {
        return interaction.reply({ content: '**لا يوجد مسؤولين معينين لهذه المسؤولية.**', ephemeral: true });
      }

      // Get original message for navigation
      const originalChannelId = interaction.channelId;
      const originalMessageId = interaction.message?.id;

      const embed = colorManager.createEmbed()
        .setTitle(`Call from owner.`)
        .setDescription(`**المسؤولية:** ${responsibilityName}\n**السبب:** ${reason}\n**المستدعي:** <@${interaction.user.id}>`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
        .setFooter({ text: 'يُرجى الضغط على زر للوصول للاستدعاء  '});

      const goButton = new ButtonBuilder()
        .setCustomId(`go_to_call_${originalChannelId}_${originalMessageId}_${interaction.user.id}`)
        .setLabel('🔗 الذهاب للرسالة')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${interaction.guildId || '@me'}/${originalChannelId}/${originalMessageId}`);

      const buttonRow = new ActionRowBuilder().addComponents(goButton);

      if (target === 'all') {
        let sentCount = 0;
        for (const userId of responsibles) {
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [embed], components: [buttonRow] });
            sentCount++;
          } catch (error) {
            console.error(`Failed to send DM to user ${userId}:`, error);
          }
        }

        await interaction.reply({ content: `** تم إرسال الاستدعاء  لـ ${sentCount} من المسؤولين.**`, ephemeral: true });
      } else {
        try {
          const user = await client.users.fetch(target);
          await user.send({ embeds: [embed], components: [buttonRow] });

          await interaction.reply({ content: `** تم إرسال الاستدعاء  إلى <@${target}>.**`, ephemeral: true });
        } catch (error) {
          await interaction.reply({ content: '**فشل في إرسال الرسالة الخاصة.**', ephemeral: true });
        }
      }

      logEvent(client, interaction.guild, {
          type: 'ADMIN_CALLS',
          title: 'Admin Call Requested',
          description: `Admin called responsibility: **${responsibilityName}**`,
          user: interaction.user,
          fields: [
              { name: 'Reason', value: reason, inline: false },
              { name: 'Target', value: target === 'all' ? 'All' : `<@${target}>`, inline: true }
          ]
      });
      return;
    }

    // Handle go to call button
    if (interaction.isButton() && interaction.customId.startsWith('go_to_call_')) {
      try {
        if (interaction.replied || interaction.deferred) {
          console.log('تم تجاهل تفاعل متكرر في زر الذهاب');
          return;
        }

        const parts = interaction.customId.replace('go_to_call_', '').split('_');
        const channelId = parts[0];
        const messageId = parts[1];
        const adminId = parts[2];

        // تعطيل الزر فوراً بعد الضغط عليه
        const disabledButton = new ButtonBuilder()
          .setCustomId(`go_to_call_${channelId}_${messageId}_${adminId}_disabled`)
          .setLabel('تم الاستجابة')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);

        const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          return interaction.reply({ content: '**لم يتم العثور على القناة!**', ephemeral: true });
        }

        const jumpLink = `https://discord.com/channels/${interaction.guild?.id || '@me'}/${channelId}/${messageId}`;

        const responseEmbed = colorManager.createEmbed()
          .setDescription(`**✅ تم استلام الاستدعاء من <@${adminId}>**\n\n**[اضغط هنا للذهاب للرسالة](${jumpLink})**`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&');

        // تحديث الرسالة لتعطيل الزر
        await interaction.update({
          embeds: [interaction.message.embeds[0]],
          components: [disabledRow]
        });

        // إرسال رد منفصل
        await interaction.followUp({ embeds: [responseEmbed], ephemeral: true });

        // Send notification to admin
        try {
          const admin = await client.users.fetch(adminId);
          const notificationEmbed = colorManager.createEmbed()
            .setDescription(`**تم الرد على استدعائك من قبل <@${interaction.user.id}>**`)
            .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&');

          await admin.send({ embeds: [notificationEmbed] });

          // Log the response to admin call
          logEvent(client, interaction.guild, {
              type: 'ADMIN_CALLS',
              title: 'Admin Call Response',
              description: `Response to admin call received`,
              user: interaction.user,
              fields: [
                  { name: 'Admin', value: `<@${adminId}>`, inline: true },
                  { name: 'Channel', value: `<#${channelId}>`, inline: true }
              ]
          });
        } catch (error) {
          console.log(`لا يمكن إرسال إشعار للمشرف ${adminId}: ${error.message}`);
        }

      } catch (error) {
        console.error('خطأ في معالجة زر الذهاب:', error);
        await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
      }
      return;
    }

    // Handle modal submissions for setup
    if (interaction.isModalSubmit() && interaction.customId.startsWith('setup_reason_modal_')) {
      // منع التفاعلات المتكررة
      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في نموذج السيتب');
        return;
      }

      const customIdParts = interaction.customId.replace('setup_reason_modal_', '').split('_');
      const responsibilityName = customIdParts[0];
      const target = customIdParts[1]; // This is the target user ID from the button click
      let reason = interaction.fields.getTextInputValue('reason').trim();

      // التعامل مع المنشن في النص
      if (reason.includes('<@')) {
        // استخراج المنشن وإزالة العلامات
        reason = reason.replace(/<@!?(\d+)>/g, (match, userId) => {
          try {
            return `<@${userId}>`;
          } catch (error) {
            return match;
          }
        });
      }

      // التعامل مع معرفات المستخدمين في النص
      const userIdPattern = /\b\d{17,19}\b/g;
      const foundIds = reason.match(userIdPattern);
      if (foundIds) {
        for (const id of foundIds) {
          try {
            await client.users.fetch(id);
            reason = reason.replace(new RegExp(`\\b${id}\\b`, 'g'), `<@${id}>`);
          } catch (error) {
            // ID غير صحيح، نتركه كما هو
          }
        }
      }

      if (!reason || reason.trim() === '') {
        reason = 'لا يوجد سبب محدد';
      }

      if (!responsibilities[responsibilityName]) {
        return interaction.reply({ content: '**المسؤولية غير موجودة!**', flags: 64 });
      }

      const responsibility = responsibilities[responsibilityName];
      const responsibles = responsibility.responsibles || [];

      if (responsibles.length === 0) {
        return interaction.reply({ content: '**لا يوجد مسؤولين معينين لهذه المسؤولية.**', flags: 64 });
      }

      // Check cooldown
      const cooldownTime = checkCooldown(interaction.user.id, responsibilityName);
      if (cooldownTime > 0) {
        return interaction.reply({
          content: `**لقد استخدمت هذا الأمر مؤخرًا. يرجى الانتظار ${Math.ceil(cooldownTime / 1000)} ثانية أخرى.**`,
          flags: 64
        });
      }

      // Start cooldown for user
      startCooldown(interaction.user.id, responsibilityName);

      // Get stored image URL for this user
      const storedImageUrl = client.setupImageData?.get(interaction.user.id);

      const embed = colorManager.createEmbed()
        .setTitle(`**طلب مساعدة في المسؤولية: ${responsibilityName}**`)
        .setDescription(`**السبب:** ${reason}\n**من:** ${interaction.user}`);

      // Add image if available
      if (storedImageUrl) {
        embed.setImage(storedImageUrl);
      }

      const claimButton = new ButtonBuilder()
        .setCustomId(`claim_task_${responsibilityName}_${Date.now()}_${interaction.user.id}`)
        .setLabel('claim')
        .setStyle(ButtonStyle.Success);

      const buttonRow = new ActionRowBuilder().addComponents(claimButton);

      if (target === 'all') {
        // Send to all responsibles
        let sentCount = 0;
        for (const userId of responsibles) {
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [embed], components: [buttonRow] });
            sentCount++;
          } catch (error) {
            console.error(`Failed to send DM to user ${userId}:`, error);
          }
        }

        // Start tracking this task for reminders
        const taskId = `${responsibilityName}_${Date.now()}`;
        const notificationsCommand = client.commands.get('notifications');
        if (notificationsCommand && notificationsCommand.trackTask) {
          notificationsCommand.trackTask(taskId, responsibilityName, responsibles, client);
        }

        await interaction.reply({ content: `**تم إرسال الطلب لـ ${sentCount} من المسؤولين.**`, flags: 64 });
      } else {
        // Send to specific user
        try {
          // التحقق من صحة معرف المستخدم المستهدف
          if (!/^\d{17,19}$/.test(target)) {
            return interaction.reply({ content: '**معرف المستخدم المستهدف غير صحيح.**', flags: 64 });
          }

          const user = await client.users.fetch(target);
          await user.send({ embeds: [embed], components: [buttonRow] });

          // Start tracking this task for reminders
          const taskId = `${responsibilityName}_${Date.now()}`;
          const notificationsCommand = client.commands.get('notifications');
          if (notificationsCommand && notificationsCommand.trackTask) {
            notificationsCommand.trackTask(taskId, responsibilityName, [target], client);
          }

          await interaction.reply({ content: `**تم إرسال الطلب إلى ${user.username}.**`, flags: 64 });
        } catch (error) {
          await interaction.reply({ content: '**فشل في إرسال الرسالة الخاصة أو المستخدم غير موجود.**', flags: 64 });
        }
      }

      // Log the task requested event
        logEvent(client, interaction.guild, {
            type: 'TASK_LOGS',
            title: 'Task Requested',
            description: `Responsibility: **${responsibilityName}**`,
            user: interaction.user,
            fields: [
                { name: 'Reason', value: reason, inline: false },
                { name: 'Target', value: target === 'all' ? 'All' : `<@${target}>`, inline: true }
            ]
        });
      return;
    }

    // Handle setup select menu interactions - معالج عام للسيتب يعمل مع جميع الرسائل
    if (interaction.isStringSelectMenu() && interaction.customId === 'setup_select_responsibility') {
      console.log(`🔄 معالجة اختيار المسؤولية من السيتب: ${interaction.values[0]} - Message ID: ${interaction.message.id}`);

      // التأكد من أن التفاعل لم يتم الرد عليه مسبقاً
      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في منيو السيتب');
        return;
      }

      try {
        const selected = interaction.values[0];
        console.log(`✅ تم اختيار المسؤولية: ${selected}`);

        if (selected === 'no_responsibilities') {
          return interaction.reply({
            content: '**لا توجد مسؤوليات معرفة حتى الآن. يرجى إضافة مسؤوليات أولاً.**',
            flags: 64
          });
        }

        // التأكد من أن الرسالة التي تم الرد عليها هي رسالة الإعدادات
        if (!interaction.message.content.includes('Select a responsibility')) {
          return interaction.reply({ content: '**هذا ليس تفاعل إعدادات صالح.**', flags: 64 });
        }

        // التحقق من أن المستخدم الذي تفاعل هو نفس المستخدم الذي استدعى أمر setup
        const setupCommand = client.commands.get('setup');
        if (setupCommand && setupCommand.setupInitiatorId !== interaction.user.id) {
          return interaction.reply({ content: '**ليس لديك الإذن لاستخدام هذا التفاعل.**', flags: 64 });
        }

        // قراءة المسؤوليات مباشرة من الملف
        const fs = require('fs');
        const path = require('path');
        const responsibilitiesPath = path.join(__dirname, 'data', 'responsibilities.json');

        let currentResponsibilities = {};
        try {
          const data = fs.readFileSync(responsibilitiesPath, 'utf8');
          currentResponsibilities = JSON.parse(data);
        } catch (error) {
          console.error('Failed to load responsibilities:', error);
          return interaction.reply({ content: '**خطأ في تحميل المسؤوليات!**', flags: 64 });
        }

        const responsibility = currentResponsibilities[selected];
        if (!responsibility) {
          return interaction.reply({ content: '**المسؤولية غير موجودة!**', flags: 64 });
        }

        const desc = responsibility.description && responsibility.description.toLowerCase() !== 'لا'
          ? responsibility.description
          : '**No desc**';

        // بناء أزرار المسؤولين
        const buttons = [];
        const responsiblesList = [];

        if (responsibility.responsibles && responsibility.responsibles.length > 0) {
          for (let i = 0; i < responsibility.responsibles.length; i++) {
            const userId = responsibility.responsibles[i];
            try {
              const guild = interaction.guild;
              const member = await guild.members.fetch(userId);
              const displayName = member.displayName || member.user.username;
              responsiblesList.push(`${i + 1}. ${displayName}`);
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`setup_contact_${selected}_${userId}`)
                  .setLabel(`${i + 1}`)
                  .setStyle(ButtonStyle.Primary)
              );
            } catch (error) {
              console.error(`Failed to fetch member ${userId}:`, error);
              responsiblesList.push(`${i + 1}. User ${userId}`);
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`setup_contact_${selected}_${userId}`)
                  .setLabel(`${i + 1}`)
                  .setStyle(ButtonStyle.Primary)
              );
            }
          }
        }

        if (buttons.length > 0) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`setup_contact_${selected}_all`)
              .setLabel('الكل')
              .setStyle(ButtonStyle.Success)
          );
        }

        if (buttons.length === 0) {
          return interaction.reply({
            content: `**المسؤولية:** __${selected}__\n**الشرح:** *${desc}*\n**لا يوجد مسؤولين معينين لهذه المسؤولية!**`,
            flags: 64
          });
        }

        // إنشاء الإيمبد والأزرار
        const responseEmbed = colorManager.createEmbed()
          .setTitle(`استدعاء مسؤولي: ${selected}`)
          .setDescription(`**الشرح:** *${desc}*\n\n**المسؤولين المتاحين:**\n*${responsiblesList.join('\n')}*\n\n**اختر من تريد استدعائه:**`)
          .setThumbnail('https://cdn.discordapp.com/emojis/1303973825591115846.png?v=1');

        const actionRows = [];
        for (let i = 0; i < buttons.length; i += 5) {
          actionRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        await interaction.reply({
          embeds: [responseEmbed],
          components: actionRows,
          flags: 64
        });

        // إنشاء collector للأزرار - persistent
        const buttonCollector = interaction.channel.createMessageComponentCollector({
          filter: i => i.customId.startsWith('setup_contact_') && i.user.id === interaction.user.id
        });

        buttonCollector.on('collect', async buttonInteraction => {
          try {
            if (buttonInteraction.replied || buttonInteraction.deferred) {
              return;
            }

            const parts = buttonInteraction.customId.split('_');
            if (parts.length < 4) {
              return;
            }

            const responsibilityName = parts[2];
            const userId = parts[3]; // Store the target user ID

            // التحقق من الكولداون
            const { checkCooldown } = require('./commands/cooldown.js');
            const cooldownTime = checkCooldown(buttonInteraction.user.id, responsibilityName);
            if (cooldownTime > 0) {
              return buttonInteraction.reply({
                content: `**لقد استخدمت هذا الأمر مؤخرًا. يرجى الانتظار ${Math.ceil(cooldownTime / 1000)} ثانية أخرى.**`,
                flags: 64
              });
            }

            // إظهار نموذج السبب
            const modal = new ModalBuilder()
              .setCustomId(`setup_reason_modal_${responsibilityName}_${userId}_${Date.now()}`) // Include target user ID in customId
              .setTitle('call reason');

            const reasonInput = new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Reason')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setPlaceholder('اكتب سبب الحاجة للمسؤول...')
              .setMaxLength(1000);

            const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(reasonRow);

            await buttonInteraction.showModal(modal);

          } catch (error) {
            console.error('Error in setup button collector:', error);
          }
        });

        // Set a timeout to delete the message after 10 minutes if no action is taken
        const deleteTimeout = setTimeout(async () => {
          try {
            await interaction.deleteReply().catch(() => {});
            console.log('تم حذف رسالة الاستدعاء بعد انتهاء الوقت المحدد من المعالج العام');

            // Try to update all setup menus
            try {
              const setupCommand = client.commands.get('setup');
              if (setupCommand && setupCommand.updateAllSetupMenus) {
                setupCommand.updateAllSetupMenus(client);
                console.log('تم تحديث جميع منيو السيتب من المعالج العام');
              }
            } catch (error) {
              console.error('خطأ في تحديث منيو السيتب من المعالج العام:', error);
            }
          } catch (error) {
            console.error('خطأ في حذف رسالة الاستدعاء من المعالج العام:', error);
          }
        }, 10 * 60 * 1000); // 10 دقائق

        buttonCollector.on('collect', async (buttonInteraction) => {
          // Clear the delete timeout when any button is clicked
          clearTimeout(deleteTimeout);
        });

        buttonCollector.on('end', async (collected, reason) => {
          try {
            console.log(`Button collector ended in global handler: ${reason}`);

            // Clear the timeout
            clearTimeout(deleteTimeout);

            // Only delete message if collector ended due to timeout or manual stop
            if (reason === 'time' || reason === 'manual') {
              try {
                await interaction.deleteReply().catch(() => {});
                console.log('تم حذف رسالة الاستدعاء من المعالج العام');
              } catch (error) {
                console.error('خطأ في حذف رسالة الاستدعاء من المعالج العام:', error);
              }

              // Try to update all setup menus
              try {
                const setupCommand = client.commands.get('setup');
                if (setupCommand && setupCommand.updateAllSetupMenus) {
                  setupCommand.updateAllSetupMenus(client);
                  console.log('تم تحديث جميع منيو السيتب من المعالج العام');
                }
              } catch (error) {
                console.error('خطأ في تحديث منيو السيتب من المعالج العام:', error);
              }
            }
          } catch (error) {
            console.error('خطأ في إنهاء button collector في المعالج العام:', error);
          }
        });

      } catch (error) {
        console.error('Error in setup select menu:', error);
        try {
          await interaction.reply({
            content: '**حدث خطأ أثناء معالجة الطلب.**',
            flags: 64
          });
        } catch (replyError) {
          console.error('Failed to send error reply:', replyError);
        }
      }
      return;
    }

    // Handle button clicks for setup contacts - الآن يعمل مع جميع الرسائل
    if (interaction.isButton() && interaction.customId.startsWith('setup_contact_')) {
      console.log(`🔘 معالجة زر الاتصال: ${interaction.customId}`);

      // التأكد من أن التفاعل لم يتم الرد عليه مسبقاً
      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في أزرار السيتب');
        return;
      }

      // هذا الزر تم معالجته بالفعل في معالج select menu أعلاه
      // لا نحتاج معالجة إضافية هنا
      return;
    }

    // Handle modal submissions for setup
    if (interaction.isModalSubmit() && interaction.customId.startsWith('setup_reason_modal_')) {
      // منع التفاعلات المتكررة
      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في نموذج السيتب');
        return;
      }

      const customIdParts = interaction.customId.replace('setup_reason_modal_', '').split('_');
      const responsibilityName = customIdParts[0];
      const target = customIdParts[1]; // This is the target user ID from the button click
      let reason = interaction.fields.getTextInputValue('reason').trim();

      // التعامل مع المنشن في النص
      if (reason.includes('<@')) {
        // استخراج المنشن وإزالة العلامات
        reason = reason.replace(/<@!?(\d+)>/g, (match, userId) => {
          try {
            return `<@${userId}>`;
          } catch (error) {
            return match;
          }
        });
      }

      // التعامل مع معرفات المستخدمين في النص
      const userIdPattern = /\b\d{17,19}\b/g;
      const foundIds = reason.match(userIdPattern);
      if (foundIds) {
        for (const id of foundIds) {
          try {
            await client.users.fetch(id);
            reason = reason.replace(new RegExp(`\\b${id}\\b`, 'g'), `<@${id}>`);
          } catch (error) {
            // ID غير صحيح، نتركه كما هو
          }
        }
      }

      if (!reason || reason.trim() === '') {
        reason = 'لا يوجد سبب محدد';
      }

      if (!responsibilities[responsibilityName]) {
        return interaction.reply({ content: '**المسؤولية غير موجودة!**', flags: 64 });
      }

      const responsibility = responsibilities[responsibilityName];
      const responsibles = responsibility.responsibles || [];

      if (responsibles.length === 0) {
        return interaction.reply({ content: '**لا يوجد مسؤولين معينين لهذه المسؤولية.**', flags: 64 });
      }

      // Check cooldown
      const cooldownTime = checkCooldown(interaction.user.id, responsibilityName);
      if (cooldownTime > 0) {
        return interaction.reply({
          content: `**لقد استخدمت هذا الأمر مؤخرًا. يرجى الانتظار ${Math.ceil(cooldownTime / 1000)} ثانية أخرى.**`,
          flags: 64
        });
      }

      // Start cooldown for user
      startCooldown(interaction.user.id, responsibilityName);

      // Get stored image URL for this user
      const storedImageUrl = client.setupImageData?.get(interaction.user.id);

      const embed = colorManager.createEmbed()
        .setTitle(`**طلب مساعدة في المسؤولية: ${responsibilityName}**`)
        .setDescription(`**السبب:** ${reason}\n**من:** ${interaction.user}`);

      // Add image if available
      if (storedImageUrl) {
        embed.setImage(storedImageUrl);
      }

      const claimButton = new ButtonBuilder()
        .setCustomId(`claim_task_${responsibilityName}_${Date.now()}_${interaction.user.id}`)
        .setLabel('claim')
        .setStyle(ButtonStyle.Success);

      const buttonRow = new ActionRowBuilder().addComponents(claimButton);

      if (target === 'all') {
        // Send to all responsibles
        let sentCount = 0;
        for (const userId of responsibles) {
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [embed], components: [buttonRow] });
            sentCount++;
          } catch (error) {
            console.error(`Failed to send DM to user ${userId}:`, error);
          }
        }

        // Start tracking this task for reminders
        const taskId = `${responsibilityName}_${Date.now()}`;
        const notificationsCommand = client.commands.get('notifications');
        if (notificationsCommand && notificationsCommand.trackTask) {
          notificationsCommand.trackTask(taskId, responsibilityName, responsibles, client);
        }

        await interaction.reply({ content: `**تم إرسال الطلب لـ ${sentCount} من المسؤولين.**`, flags: 64 });
      } else {
        // Send to specific user
        try {
          // التحقق من صحة معرف المستخدم المستهدف
          if (!/^\d{17,19}$/.test(target)) {
            return interaction.reply({ content: '**معرف المستخدم المستهدف غير صحيح.**', flags: 64 });
          }

          const user = await client.users.fetch(target);
          await user.send({ embeds: [embed], components: [buttonRow] });

          // Start tracking this task for reminders
          const taskId = `${responsibilityName}_${Date.now()}`;
          const notificationsCommand = client.commands.get('notifications');
          if (notificationsCommand && notificationsCommand.trackTask) {
            notificationsCommand.trackTask(taskId, responsibilityName, [target], client);
          }

          await interaction.reply({ content: `**تم إرسال الطلب إلى ${user.username}.**`, flags: 64 });
        } catch (error) {
          await interaction.reply({ content: '**فشل في إرسال الرسالة الخاصة أو المستخدم غير موجود.**', flags: 64 });
        }
      }

      // Log the task requested event
        logEvent(client, interaction.guild, {
            type: 'TASK_LOGS',
            title: 'Task Requested',
            description: `Responsibility: **${responsibilityName}**`,
            user: interaction.user,
            fields: [
                { name: 'Reason', value: reason, inline: false },
                { name: 'Target', value: target === 'all' ? 'All' : `<@${target}>`, inline: true }
            ]
        });
      return;
    }

  } catch (error) {
    // قائمة الأخطاء المتجاهلة الموسعة
    const ignoredErrorCodes = [
      10008, // Unknown Message
      40060, // Interaction has already been acknowledged
      10062, // Unknown interaction
      10003, // Unknown channel
      50013, // Missing permissions
      50001, // Missing access
      50027, // Invalid webhook token
      10015, // Unknown webhook
      50035, // Invalid form body
      10014, // Unknown emoji
      10020, // Unknown user
      40061, // Interaction already replied
      50021, // Cannot edit a message that was not sent by the bot
      50025, // Invalid OAuth state
      30001, // Maximum number of guilds reached
      30003, // Maximum number of friends reached
      30005, // Maximum number of reactions reached
      30010, // Maximum number of channels reached
      50034  // You can only bulk delete messages that are under 14 days old
    ];

    // تجاهل أخطاء Discord المعروفة
    if (error.code && ignoredErrorCodes.includes(error.code)) {
      console.log(`تم تجاهل خطأ Discord معروف: ${error.code}`);
      return;
    }

    // تجاهل أخطاء التفاعلات المنتهية الصلاحية أو المعروفة
    if (error.message && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('already been acknowledged') ||
      error.message.includes('Unknown user') ||
      error.message.includes('already replied') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('Unknown Message') ||
      error.message.includes('Invalid Form Body') ||
      error.message.includes('Cannot read properties of undefined') ||
      error.message.includes('Missing Access') ||
      error.message.includes('Missing Permissions')
    )) {
      console.log(`تم تجاهل خطأ معروف: ${error.message.substring(0, 50)}...`);
      return;
    }

    // تجاهل التفاعلات القديمة
    if (interaction && interaction.createdTimestamp) {
      const interactionAge = Date.now() - interaction.createdTimestamp;
      if (interactionAge > 12 * 60 * 1000) { // 12 دقيقة
        console.log('تم تجاهل تفاعل قديم');
        return;
      }
    }

    // تسجيل الأخطاء المهمة فقط مع تفاصيل أقل
    if (error.code && !ignoredErrorCodes.includes(error.code)) {
      console.error(`خطأ مهم في التفاعل - كود: ${error.code}, رسالة: ${error.message?.substring(0, 100)}`);
    }
  }
});

// دالة لعرض مسؤوليات المستخدم
async function showUserResponsibilities(message, targetUser, responsibilities, client) {
    // البحث عن مسؤوليات المستخدم
    const userResponsibilities = [];

    for (const [respName, respData] of Object.entries(responsibilities)) {
        if (respData.responsibles && respData.responsibles.includes(targetUser.id)) {
            // حساب عدد المسؤولين الآخرين (غير المستخدم الحالي)
            const otherResponsibles = respData.responsibles.filter(id => id !== targetUser.id);
            userResponsibilities.push({
                name: respName,
                otherResponsiblesCount: otherResponsibles.length
            });
        }
    }

    // إنشاء الرد
    if (userResponsibilities.length === 0) {
        const noRespEmbed = colorManager.createEmbed()
            .setDescription(`**${targetUser.username} ليس لديك أي مسؤوليات**`)
            .setColor('#000000')
            .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400390144795738175/download__2_-removebg-preview.png?ex=688d1f34&is=688bcdb4&hm=40da8d91a92062c95eb9d48f307697ec0010860aca64dd3f8c3c045f3c2aa13a&');

        await message.channel.send({ embeds: [noRespEmbed] });
    } else {
        // إنشاء قائمة المسؤوليات
        let responsibilitiesList = '';
        userResponsibilities.forEach((resp, index) => {
            responsibilitiesList += `**${index + 1}.** ${resp.name}\n${resp.otherResponsiblesCount} مسؤولون غيرك\n\n`;
        });

        const respEmbed = colorManager.createEmbed()
            .setTitle(`مسؤولياتك`)
            .setDescription(`**مسؤولياتك هي:**\n\n${responsibilitiesList}`)
            .setColor('#00ff00')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields([
                { name: 'Total Res', value: `${userResponsibilities.length}`, inline: true },
                { name: 'User', value: `<@${targetUser.id}>`, inline: true }
            ])
            .setFooter({ text: 'By Ahmed.' })
            .setTimestamp();

        await message.channel.send({ embeds: [respEmbed] });
    }
}

// Helper function for safe replies مع معالجة محسنة
async function safeReply(interaction, content, options = {}) {
  try {
    // Basic validation
    if (!interaction || !interaction.isRepliable()) {
      return false;
    }

    // Check interaction age with more strict timing
    const now = Date.now();
    const interactionAge = now - interaction.createdTimestamp;
    if (interactionAge > 600000) { // 10 دقائق فقط
      return false;
    }

    // Check if already replied or deferred
    if (interaction.replied || interaction.deferred) {
      return false;
    }

    const replyOptions = {
      content: content || 'حدث خطأ',
      ephemeral: true,
      ...options
    };

    // محاولة الرد مع timeout
    const replyPromise = interaction.reply(replyOptions);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Reply timeout')), 5000)
    );

    await Promise.race([replyPromise, timeoutPromise]);
    return true;
  } catch (error) {
    // تجاهل أخطاء Discord المعروفة بصمت تام
    const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001, 50027, 10015, 50035, 10014, 10020, 40061];
    if (error.code && ignoredCodes.includes(error.code)) {
      return false;
    }

    // تجاهل رسائل الأخطاء المعروفة
    if (error.message && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Already replied') ||
      error.message.includes('Reply timeout') ||
      error.message.includes('Invalid Form Body')
    )) {
      return false;
    }

    return false;
  }
}

// معالج الإغلاق الآمن
async function gracefulShutdown(signal) {
console.log(`\n🔄 جاري إيقاف البوت بأمان... (${signal})`);

  try {
    // حفظ جميع البيانات بشكل إجباري
    saveData(true);
    console.log('💾 تم حفظ جميع البيانات');

    // إغلاق البوت
    client.destroy();

    console.log('✅ تم إيقاف البوت بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ أثناء الإغلاق:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// معالج الأخطاء غير المعالجة
process.on('uncaughtException', (error) => {
  // تجاهل أخطاء Discord المعروفة
  const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001, 50027, 10015, 50035, 10014, 10020, 40061];
  if (error.code && ignoredCodes.includes(error.code)) {
    console.log(`تم تجاهل خطأ Discord معروف: ${error.code} - ${error.message}`);
    return;
  }

  // تجاهل رسائل الأخطاء المعروفة
  const ignoredMessages = [
    'Unknown interaction',
    'Unknown user',
    'already been acknowledged',
    'already replied',
    'Interaction has already been acknowledged',
    'Unknown Message',
    'Unknown channel'
  ];

  if (error.message && ignoredMessages.some(msg => error.message.includes(msg))) {
    console.log(`تم تجاهل خطأ معروف: ${error.message}`);
    return;
  }

  console.error('❌ خطأ غير معالج:', error);

  // حفظ البيانات بدون إيقاف البوت
  try {
    saveData();
    console.log('💾 تم حفظ البيانات بعد الخطأ');
  } catch (saveError) {
    console.error('❌ فشل في حفظ البيانات:', saveError);
  }

  // عدم إيقاف البوت للأخطاء البسيطة
  console.log('🔄 استمرار عمل البوت رغم الخطأ');
});

process.on('unhandledRejection', (reason, promise) => {
  // تجاهل أخطاء Discord المعروفة
  if (reason && reason.code) {
    const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001, 50027, 10015, 50035, 10014, 10020, 40061];
    if (ignoredCodes.includes(reason.code)) {
      console.log(`تم تجاهل رفض Discord معروف: ${reason.code} - ${reason.message}`);
      return;
    }
  }

  // تجاهل رسائل الرفض المعروفة
  if (reason && reason.message) {
    const ignoredMessages = [
      'Unknown interaction',
      'Unknown user',
      'already been acknowledged',
      'already replied',
      'Interaction has already been acknowledged',
      'Unknown Message',
      'Unknown channel'
    ];

    if (ignoredMessages.some(msg => reason.message.includes(msg))) {
      console.log(`تم تجاهل رفض معروف: ${reason.message}`);
      return;
    }
  }

  console.error('❌ رفض غير معالج:', reason);

  // حفظ البيانات
  try {
    saveData();
  } catch (saveError) {
    console.error('❌ فشل في حفظ البيانات:', saveError);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
