
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { Coordinates, CalculationMethod, PrayerTimes, Prayer, Qibla } = require('adhan');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');

const name = 'pr';

// مسار ملف إعدادات التذكير
const PRAYER_CONFIG_PATH = path.join(__dirname, '..', 'data', 'prayerConfig.json');

// مواقيت الصلوات بالعربي
const PRAYER_NAMES = {
    'fajr': 'الفجر',
    'sunrise': 'الشروق',
    'dhuhr': 'الظهر',
    'asr': 'العصر',
    'maghrib': 'المغرب',
    'isha': 'العشاء'
};

// الصلوات المطلوب التذكير بها فقط
const REMINDER_PRAYERS = ['dhuhr', 'asr', 'maghrib', 'isha', 'fajr'];

// قراءة إعدادات التذكير
function readPrayerConfig() {
    try {
        if (fs.existsSync(PRAYER_CONFIG_PATH)) {
            const data = fs.readFileSync(PRAYER_CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
        return { guilds: {} };
    } catch (error) {
        console.error('خطأ في قراءة إعدادات الصلاة:', error);
        return { guilds: {} };
    }
}

// حفظ إعدادات التذكير
function savePrayerConfig(config) {
    try {
        const dataDir = path.dirname(PRAYER_CONFIG_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(PRAYER_CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات الصلاة:', error);
        return false;
    }
}

// حساب مواقيت الصلاة لمكة المكرمة
function getPrayerTimes() {
    // إحداثيات مكة المكرمة
    const coordinates = new Coordinates(21.3891, 39.8579);
    
    // استخدام طريقة الحساب السعودية (أم القرى)
    const params = CalculationMethod.UmmAlQura();
    
    // الحصول على التاريخ الحالي في توقيت مكة المكرمة (نفس توقيت الرياض)
    const today = moment().tz('Asia/Riyadh').toDate();
    
    // حساب مواقيت الصلاة
    const prayerTimes = new PrayerTimes(coordinates, today, params);
    
    return {
        fajr: moment(prayerTimes.fajr).tz('Asia/Riyadh'), // توقيت مكة المكرمة
        sunrise: moment(prayerTimes.sunrise).tz('Asia/Riyadh'),
        dhuhr: moment(prayerTimes.dhuhr).tz('Asia/Riyadh'),
        asr: moment(prayerTimes.asr).tz('Asia/Riyadh'),
        maghrib: moment(prayerTimes.maghrib).tz('Asia/Riyadh'),
        isha: moment(prayerTimes.isha).tz('Asia/Riyadh')
    };
}

// إرسال تذكير الصلاة
async function sendPrayerReminder(client, channelId, prayerName) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const prayerTimes = getPrayerTimes();
        const currentTime = moment().tz('Asia/Riyadh');
        
        const embed = colorManager.createEmbed()
            .setTitle(`حان وقت صلاة ${PRAYER_NAMES[prayerName]}`)
            .setDescription(`**حان الآن وقت صلاة ${PRAYER_NAMES[prayerName]}**\n\n**الوقت الحالي:** ${currentTime.format('HH:mm')}\n**حسب توقيت مكة المكرمة**`)
            .setColor('#00ff00')
            .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
            .addFields([
                { name: 'التاريخ', value: currentTime.format('DD/MM/YYYY'), inline: true },
                { name: 'الوقت', value: currentTime.format('HH:mm'), inline: true },
                { name: 'المدينة', value: 'مكة المكرمة', inline: true }
            ])
            .setFooter({ text: 'تذكير الصلاة - حافظوا على الصلوات' })
            .setTimestamp();

        await channel.send({ content: '@everyone', embeds: [embed] });
        console.log(`✅ تم إرسال تذكير صلاة ${PRAYER_NAMES[prayerName]} في القناة ${channelId}`);
        
    } catch (error) {
        console.error(`خطأ في إرسال تذكير صلاة ${prayerName}:`, error);
    }
}

// فحص مواقيت الصلاة وإرسال التذكيرات
function checkPrayerTimes(client) {
    const config = readPrayerConfig();
    const currentTime = moment().tz('Asia/Riyadh');
    const prayerTimes = getPrayerTimes();
    
    // فحص كل صلاة من الصلوات المطلوبة
    for (const prayerName of REMINDER_PRAYERS) {
        const prayerTime = prayerTimes[prayerName];
        
        // التحقق من أن الوقت الحالي قريب من وقت الصلاة (في نفس الدقيقة)
        if (Math.abs(currentTime.diff(prayerTime, 'minutes')) <= 0) {
            console.log(`⏰ حان وقت صلاة ${PRAYER_NAMES[prayerName]} - ${prayerTime.format('HH:mm')}`);
            
            // إرسال التذكير لجميع الخوادم المفعلة
            for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
                if (guildConfig.enabled && guildConfig.channelId) {
                    sendPrayerReminder(client, guildConfig.channelId, prayerName);
                }
            }
        }
    }
}

// بدء نظام فحص مواقيت الصلاة
function startPrayerReminderSystem(client) {
    console.log('🕌 بدء نظام تذكير الصلاة...');
    
    // فحص كل دقيقة
    setInterval(() => {
        try {
            checkPrayerTimes(client);
        } catch (error) {
            console.error('خطأ في فحص مواقيت الصلاة:', error);
        }
    }, 60000); // كل دقيقة
    
    console.log('✅ تم تشغيل نظام تذكير الصلاة بنجاح');
}

// عرض مواقيت الصلاة الحالية
function showTodayPrayerTimes() {
    const prayerTimes = getPrayerTimes();
    const currentTime = moment().tz('Asia/Riyadh');
    
    const embed = colorManager.createEmbed()
        .setTitle('مواقيت الصلاة اليوم - مكة المكرمة')
        .setDescription(`**التاريخ:** ${currentTime.format('DD/MM/YYYY')}\n**الوقت الحالي:** ${currentTime.format('HH:mm')}`)
        .addFields([
            { name: 'الفجر', value: prayerTimes.fajr.format('HH:mm'), inline: true },
            { name: 'الشروق', value: prayerTimes.sunrise.format('HH:mm'), inline: true },
            { name: 'الظهر', value: prayerTimes.dhuhr.format('HH:mm'), inline: true },
            { name: 'العصر', value: prayerTimes.asr.format('HH:mm'), inline: true },
            { name: 'المغرب', value: prayerTimes.maghrib.format('HH:mm'), inline: true },
            { name: 'العشاء', value: prayerTimes.isha.format('HH:mm'), inline: true }
        ])
        .setColor('#00ff00')
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
        .setFooter({ text: 'مواقيت الصلاة حسب توقيت مكة المكرمة' })
        .setTimestamp();
    
    return embed;
}

async function execute(message, args, { client, BOT_OWNERS }) {
    // فحص البلوك
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    // التحقق من الصلاحيات
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    if (!isOwner) {
        await message.react('❌');
        return;
    }

    const subCommand = args[0]?.toLowerCase();

    if (subCommand === 'setup' || !subCommand) {
        // إعداد التذكير - طلب منشن القناة
        await message.channel.send('**🕌 منشن الروم الذي تريد إرسال تذكيرات الصلاة فيه:**');
        
        // انتظار منشن القناة
        const channelCollector = message.channel.createMessageCollector({
            filter: m => m.author.id === message.author.id && m.mentions.channels.size > 0,
            time: 60000,
            max: 1
        });
        
        channelCollector.on('collect', async (msg) => {
            const targetChannel = msg.mentions.channels.first();
            
            if (targetChannel.guild.id !== message.guild.id) {
                return msg.channel.send('❌ **يجب اختيار قناة من نفس السيرفر!**');
            }
            
            // حفظ الإعدادات
            const config = readPrayerConfig();
            if (!config.guilds) config.guilds = {};
            
            config.guilds[message.guild.id] = {
                enabled: true,
                channelId: targetChannel.id,
                channelName: targetChannel.name,
                setupBy: message.author.id,
                setupAt: new Date().toISOString()
            };
            
            if (savePrayerConfig(config)) {
                const successEmbed = colorManager.createEmbed()
                    .setTitle('✅ تم إعداد تذكير الصلاة بنجاح')
                    .setDescription(`**القناة:** ${targetChannel}\n**المواقيت:** حسب توقيت مكة المكرمة\n**الصلوات:** الفجر، الظهر، العصر، المغرب، العشاء`)
                    .addFields([
                        { name: '📋 ملاحظة', value: 'سيتم إرسال التذكيرات تلقائياً في مواعيد الصلاة', inline: false }
                    ])
                    .setColor('#00ff00');
                    
                await msg.channel.send({ embeds: [successEmbed] });
                
                // عرض مواقيت اليوم
                const timesEmbed = showTodayPrayerTimes();
                await msg.channel.send({ embeds: [timesEmbed] });
                
            } else {
                await msg.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        });
        
        channelCollector.on('end', (collected) => {
            if (collected.size === 0) {
                message.channel.send('⏰ **انتهت مهلة الانتظار!**');
            }
        });
        
    } else if (subCommand === 'times' || subCommand === 'مواقيت') {
        // عرض مواقيت الصلاة
        const embed = showTodayPrayerTimes();
        await message.channel.send({ embeds: [embed] });
        
    } else if (subCommand === 'status') {
        // عرض حالة التذكير
        const config = readPrayerConfig();
        const guildConfig = config.guilds?.[message.guild.id];
        
        if (!guildConfig || !guildConfig.enabled) {
            return message.channel.send('❌ **تذكير الصلاة غير مفعل في هذا السيرفر!**');
        }
        
        const channel = await client.channels.fetch(guildConfig.channelId).catch(() => null);
        const statusEmbed = colorManager.createEmbed()
            .setTitle('📊 حالة تذكير الصلاة')
            .addFields([
                { name: '✅ الحالة', value: 'مفعل', inline: true },
                { name: '📍 القناة', value: channel ? `${channel}` : 'قناة محذوفة', inline: true },
                { name: 'المدينة', value: 'مكة المكرمة', inline: true },
                { name: '👤 تم الإعداد بواسطة', value: `<@${guildConfig.setupBy}>`, inline: true },
                { name: '📅 تاريخ الإعداد', value: new Date(guildConfig.setupAt).toLocaleDateString('ar-SA'), inline: true }
            ])
            .setColor('#00ff00');
            
        await message.channel.send({ embeds: [statusEmbed] });
        
    } else if (subCommand === 'disable' || subCommand === 'تعطيل') {
        // تعطيل التذكير
        const config = readPrayerConfig();
        if (config.guilds && config.guilds[message.guild.id]) {
            config.guilds[message.guild.id].enabled = false;
            
            if (savePrayerConfig(config)) {
                await message.channel.send('✅ **تم تعطيل تذكير الصلاة!**');
            } else {
                await message.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        } else {
            await message.channel.send('❌ **تذكير الصلاة غير مفعل أساساً!**');
        }
        
    } else if (subCommand === 'enable' || subCommand === 'تفعيل') {
        // تفعيل التذكير
        const config = readPrayerConfig();
        if (config.guilds && config.guilds[message.guild.id] && config.guilds[message.guild.id].channelId) {
            config.guilds[message.guild.id].enabled = true;
            
            if (savePrayerConfig(config)) {
                await message.channel.send('✅ **تم تفعيل تذكير الصلاة!**');
            } else {
                await message.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        } else {
            await message.channel.send('❌ **يجب إعداد التذكير أولاً باستخدام الأمر بدون معاملات!**');
        }
        
    } else {
        // عرض المساعدة
        const helpEmbed = colorManager.createEmbed()
            .setTitle('أمر تذكير الصلاة')
            .setDescription('**الاستخدام:**')
            .addFields([
                { name: '⚙️ إعداد التذكير', value: '`prayer-reminder` أو `prayer-reminder setup`', inline: false },
                { name: '🕐 عرض المواقيت', value: '`prayer-reminder times`', inline: false },
                { name: '📊 حالة التذكير', value: '`prayer-reminder status`', inline: false },
                { name: '✅ تفعيل', value: '`prayer-reminder enable`', inline: false },
                { name: '❌ تعطيل', value: '`prayer-reminder disable`', inline: false }
            ])
            .setColor('#007fff')
            .setFooter({ text: 'مواقيت الصلاة حسب توقيت مكة المكرمة' });
            
        await message.channel.send({ embeds: [helpEmbed] });
    }
}

module.exports = { 
    name, 
    execute,
    startPrayerReminderSystem,
    checkPrayerTimes,
    showTodayPrayerTimes
};
