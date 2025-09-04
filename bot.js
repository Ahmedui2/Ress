const { Client, GatewayIntentBits, Partials, Collection, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { logEvent } = require('./utils/logs_system.js');
const { startReminderSystem } = require('./commands/notifications.js');
const { checkCooldown, startCooldown } = require('./commands/cooldown.js');
const colorManager = require('./utils/colorManager.js');
const vacationManager = require('./utils/vacationManager.js');


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
    reports: path.join(dataDir, 'reports.json')
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

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
        savePendingReports();
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

client.once('ready', async () => {
  console.log('**بوت المسؤوليات جاهز للعمل!**');

  // تنظيف البيانات من المعرفات غير الصحيحة
  cleanInvalidUserIds();

  // تهيئة نظام المهام النشطة الجديد
  setTimeout(() => {
    initializeActiveTasks();
    loadPendingReports();
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
  setInterval(checkExpiredReports, 5 * 60 * 1000);

  // حفظ البيانات فقط عند الحاجة - كل 5 دقائق أو عند وجود تغييرات
  setInterval(() => {
    if (isDataDirty) {
      saveData();
    }
  }, 300 * 1000); // كل 5 دقائق
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
  

  // إعداد نظام collectors عام للسيتب
  client.setupCollectors = new Map();

  // إعداد collector عام للسيتب يعمل بعد إعادة التشغيل
  setTimeout(() => {
    setupGlobalSetupCollector(client);
  }, 3000);

  // Check for expired vacations every hour
  setInterval(() => {
    vacationManager.checkVacations(client);
  }, 3600000); // 1 hour
};

client.on('messageCreate', async message => {
  if (message.author.bot) return;

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
    // Commands for admins and owners (مسؤول)
    else if (commandName === 'مسؤول') {
      console.log(`🔍 التحقق من صلاحيات المستخدم ${message.author.id} لأمر مسؤول:`);
      console.log(`- isOwner: ${isOwner}`);
      console.log(`- hasAdministrator: ${hasAdministrator}`);
      console.log(`- hasAdminRole: ${hasAdminRole}`);
      console.log(`- CURRENT_ADMIN_ROLES count: ${CURRENT_ADMIN_ROLES.length}`);
      console.log(`- CURRENT_ADMIN_ROLES: ${JSON.stringify(CURRENT_ADMIN_ROLES)}`);
      console.log(`- User roles: ${member.roles.cache.map(r => r.id).join(', ')}`);
      console.log(`- User roles names: ${member.roles.cache.map(r => r.name).join(', ')}`);
      
      if (hasAdminRole || isOwner || hasAdministrator) {
        console.log(`✅ تم منح الصلاحية للمستخدم ${message.author.id}`);
        await command.execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES: CURRENT_ADMIN_ROLES, client, colorManager, reportsConfig });
      } else {
        console.log(`❌ المستخدم ${message.author.id} لا يملك الصلاحيات المطلوبة لأمر مسؤول`);
        await message.react('❌');
        return;
      }
    }
    // Commands for owners only (call, stats, setup, report)
    else if (commandName === 'call' || commandName === 'stats' || commandName === 'setup' || commandName === 'report') {
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

// استخدام نظام المهام النشطة من masoul.js
if (!client.activeTasks) {
  client.activeTasks = new Map();
}

// ربط نظام المهام النشطة مع masoul.js
function initializeActiveTasks() {
  try {
    const masoulCommand = client.commands.get('مسؤول');
    if (masoulCommand && masoulCommand.loadActiveTasks) {
      masoulCommand.loadActiveTasks();
      // مزامنة المهام النشطة
      client.activeTasks = masoulCommand.activeTasks;
      console.log(`✅ تم ربط نظام المهام النشطة مع masoul.js - ${client.activeTasks.size} مهمة نشطة`);
    }
  } catch (error) {
    console.error('❌ خطأ في تهيئة نظام المهام النشطة:', error);
  }
}

// حفظ المهام النشطة في JSON - باستخدام النظام الجديد
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

    // --- Vacation System Interaction Router ---
    if (interaction.customId && interaction.customId.startsWith('vac_')) {
        const vacationContext = { client, BOT_OWNERS };

        // Route to set-vacation command
        if (interaction.customId.includes('_set_') || interaction.customId.includes('_choice_') || interaction.customId.includes('_select') || interaction.customId.includes('_back_')) {
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

        // Route to my-vacation (ajazati) command
        if (interaction.customId.startsWith('vac_end_request_')) {
            const myVacationCommand = client.commands.get('اجازتي');
            if (myVacationCommand && myVacationCommand.handleInteraction) {
                await myVacationCommand.handleInteraction(interaction, vacationContext);
            }
            return;
        }

        // Handle direct approvals / rejections
        const [action, decision, userId] = interaction.customId.split('_');

        if (decision === 'approve') {
            const result = await vacationManager.approveVacation(interaction, userId, interaction.user.id);
            if (result.success) {
                const updatedEmbed = new EmbedBuilder().setColor(colorManager.getColor('approved') || '#2ECC71').setDescription(`✅ **Vacation for <@${userId}> has been approved.**`);
                await interaction.update({ embeds: [updatedEmbed], components: [] });

                const user = await client.users.fetch(userId).catch(() => null);
                if (user) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Vacation Request Approved')
                        .setColor(colorManager.getColor('approved') || '#2ECC71')
                        .setDescription('Your vacation request has been approved. Your administrative roles have been temporarily removed and will be restored when your vacation ends.')
                        .setFooter({ text: 'Enjoy your time off!' });
                    await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM user ${userId}: ${err}`));
                }
            } else {
                const errorEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ **Failed to approve:** ${result.message}`);
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            return;
        }

        if (decision === 'reject') {
            const vacations = vacationManager.readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
            delete vacations.pending[userId];
            vacationManager.saveVacations(vacations);

            const rejectEmbed = new EmbedBuilder().setColor(colorManager.getColor('rejected') || '#E74C3C').setDescription(`❌ **Vacation for <@${userId}> has been rejected.**`);
            await interaction.update({ embeds: [rejectEmbed], components: [] });

            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('Vacation Request Rejected')
                    .setColor(colorManager.getColor('rejected') || '#E74C3C')
                    .setDescription('Unfortunately, your vacation request has been rejected.');
                await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM user ${userId}: ${err}`));
            }
            return;
        }

        // --- Early Termination Flow ---
        if (interaction.customId.startsWith('vac_end_confirm_')) {
            const userId = interaction.customId.split('_').pop();
            if (interaction.user.id !== userId) return interaction.reply({ content: 'This is not for you.', ephemeral: true });

            const confirmEmbed = new EmbedBuilder().setColor(colorManager.getColor()).setDescription('Your request to end your vacation has been sent for approval.');
            await interaction.update({ embeds: [confirmEmbed], components: [] });

            const vacations = vacationManager.readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
            const vacation = vacations.active[userId];
            if (!vacation) return;

            const settings = vacationManager.getSettings();
            const approvers = await vacationManager.getApprovers(interaction.guild, settings, BOT_OWNERS);
            const originalApprover = await client.users.fetch(vacation.approvedBy).catch(() => ({ tag: 'Unknown' }));

            const terminationEmbed = new EmbedBuilder()
                .setTitle('Early Vacation Termination Request')
                .setColor(colorManager.getColor('pending') || '#E67E22')
                .setDescription(`**<@${userId}> has requested to end their vacation early.**`)
                .addFields(
                    { name: '___User___', value: `<@${userId}>`, inline: true },
                    { name: '___Original Approver___', value: `**${originalApprover.tag}**`, inline: true},
                    { name: '___Removed Roles___', value: vacation.removedRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: false }
                )
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vac_terminate_approve_${userId}`).setLabel("Approve Termination").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`vac_terminate_reject_${userId}`).setLabel("Reject Termination").setStyle(ButtonStyle.Danger)
            );

            if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
                const channel = await client.channels.fetch(settings.notificationChannel).catch(() => null);
                if (channel) await channel.send({ embeds: [terminationEmbed], components: [buttons] });
            } else {
                for (const approver of approvers) {
                    await approver.send({ embeds: [terminationEmbed], components: [buttons] }).catch(e => console.error(`Could not DM user ${approver.id}`));
                }
            }
            return;
        }

        if (interaction.customId === 'vac_end_cancel') {
            const cancelEmbed = new EmbedBuilder().setColor(colorManager.getColor()).setDescription('Action cancelled. Your vacation remains active.');
            await interaction.update({ embeds: [cancelEmbed], components: [] });
            return;
        }

        if (interaction.customId.startsWith('vac_terminate_approve_')) {
            const userId = interaction.customId.split('_').pop();
            const result = await vacationManager.endVacation(interaction.guild, client, userId, `Ended early by approval from ${interaction.user.tag}.`);

            if (result.success) {
                const approvedEmbed = new EmbedBuilder().setColor(colorManager.getColor('approved')).setDescription(`✅ Early termination for <@${userId}> has been **approved**.`);
                await interaction.update({ embeds: [approvedEmbed], components: [],
                });
                const user = await client.users.fetch(userId).catch(() => null);
                if (user) await user.send({ embeds: [new EmbedBuilder().setColor(colorManager.getColor('approved')).setDescription('Your request to end your vacation early was **approved**. Welcome back!')] });
            } else {
                 const errorEmbed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ **Failed to approve termination:** ${result.message}`);
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            return;
        }

        if (interaction.customId.startsWith('vac_terminate_reject_')) {
            const userId = interaction.customId.split('_').pop();
            const rejectedEmbed = new EmbedBuilder().setColor(colorManager.getColor('rejected')).setDescription(`❌ Early termination for <@${userId}> has been **rejected**.`);
            await interaction.update({ embeds: [rejectedEmbed], components: [] });
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) await user.send({ embeds: [new EmbedBuilder().setColor(colorManager.getColor('rejected')).setDescription('Your request to end your vacation early was **rejected**.')] });
            return;
        }
    }

    // Handle adminroles interactions
    if (interaction.customId && (interaction.customId.startsWith('adminroles_') ||
        interaction.customId === 'adminroles_select_role')) {
        console.log(`معالجة تفاعل رولات المشرفين: ${interaction.customId}`);
        // These are handled within the adminroles command itself
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

    // Handle modal submissions for masoul - استخدام المعالج الجديد من masoul.js
    if (interaction.isModalSubmit() && interaction.customId.startsWith('masoul_modal_')) {
        const masoulCommand = client.commands.get('مسؤول');
        if (masoulCommand && masoulCommand.handleInteraction) {
            await masoulCommand.handleInteraction(interaction, context);
        }
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
    const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001, 50027, 10015, 50035, 10014, 10020, 40061, 50021];
    if (error.code && ignoredCodes.includes(error.code)) {
      return false;
    }
    
    // تجاهل رسائل الأخطاء المعروفة
    if (error.message && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('already been acknowledged') ||
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

client.login(process.env.DISCORD_TOKEN);
