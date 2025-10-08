const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');

const name = 'setroom';

// مسار ملف إعدادات الغرف
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');
const roomRequestsPath = path.join(__dirname, '..', 'data', 'roomRequests.json');

// تخزين الجدولات النشطة
const activeSchedules = new Map();

// مسار ملف الجدولات
const schedulesPath = path.join(__dirname, '..', 'data', 'roomSchedules.json');

// حفظ الجدولات
function saveSchedules() {
    try {
        const schedulesData = {};
        for (const [requestId, job] of activeSchedules.entries()) {
            if (job.nextInvocation) {
                schedulesData[requestId] = {
                    nextRun: job.nextInvocation().toISOString()
                };
            }
        }
        fs.writeFileSync(schedulesPath, JSON.stringify(schedulesData, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ الجدولات:', error);
        return false;
    }
}

// تحميل واستعادة الجدولات
function restoreSchedules(client) {
    try {
        if (!fs.existsSync(schedulesPath)) return;

        const schedulesData = JSON.parse(fs.readFileSync(schedulesPath, 'utf8'));
        const requests = loadRoomRequests();

        for (const request of requests) {
            if (request.status === 'accepted' && schedulesData[request.id]) {
                const nextRun = new Date(schedulesData[request.id].nextRun);

                // إذا كان الموعد في المستقبل، أعد جدولته
                if (nextRun > new Date()) {
                    scheduleRoomCreation(request, client);
                    console.log(`✅ تم استعادة جدولة الروم: ${request.roomType} - ${request.forWho}`);
                }
                // إذا كان الموعد قد مضى، قم بإنشاء الروم فوراً
                else {
                    createRoom(request, client, loadRoomConfig()[request.guildId]);
                    console.log(`⚡ تم إنشاء روم متأخر: ${request.roomType} - ${request.forWho}`);
                }
            }
        }
    } catch (error) {
        console.error('خطأ في استعادة الجدولات:', error);
    }
}

// تخزين انتظار الإيموجي
const awaitingEmojis = new Map();

// قراءة وحفظ الإعدادات
function loadRoomConfig() {
    try {
        if (fs.existsSync(roomConfigPath)) {
            return JSON.parse(fs.readFileSync(roomConfigPath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('خطأ في قراءة إعدادات الغرف:', error);
        return {};
    }
}

function saveRoomConfig(config) {
    try {
        fs.writeFileSync(roomConfigPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات الغرف:', error);
        return false;
    }
}

function loadRoomRequests() {
    try {
        if (fs.existsSync(roomRequestsPath)) {
            return JSON.parse(fs.readFileSync(roomRequestsPath, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('خطأ في قراءة طلبات الغرف:', error);
        return [];
    }
}

function saveRoomRequests(requests) {
    try {
        fs.writeFileSync(roomRequestsPath, JSON.stringify(requests, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ طلبات الغرف:', error);
        return false;
    }
}

// دالة لتحويل الآيدي أو اليوزر إلى منشن
async function formatUserMention(input, guild) {
    // تنظيف المدخل
    const cleaned = input.trim();

    // إذا كان منشن بالفعل، أرجعه كما هو
    if (cleaned.match(/^<@!?\d{17,19}>$/)) {
        return cleaned;
    }

    // إذا كان آيدي فقط (أرقام)
    if (/^\d{17,19}$/.test(cleaned)) {
        return `<@${cleaned}>`;
    }

    // محاولة البحث عن المستخدم بالاسم (username أو display name)
    try {
        // إزالة @ إذا كانت موجودة في البداية
        const searchName = cleaned.startsWith('@') ? cleaned.substring(1) : cleaned;
        
        // البحث في أعضاء السيرفر
        const members = await guild.members.fetch();
        const member = members.find(m => 
            m.user.username.toLowerCase() === searchName.toLowerCase() ||
            m.user.tag.toLowerCase() === searchName.toLowerCase() ||
            m.displayName.toLowerCase() === searchName.toLowerCase()
        );
        
        if (member) {
            return `<@${member.user.id}>`;
        }
    } catch (error) {
        console.error('خطأ في البحث عن المستخدم:', error);
    }

    // إذا كان اسم عادي، أرجعه كما هو
    return cleaned;
}

// معالجة طلبات الغرف (المنيو)
async function handleRoomRequestMenu(interaction, client) {
    const roomTypeEn = interaction.values[0]; // 'condolence' أو 'birthday'
    const roomType = roomTypeEn === 'condolence' ? 'عزاء' : 'ميلاد';

    // إنشاء المودال
    const modal = new ModalBuilder()
        .setCustomId(`room_modal_${roomTypeEn}_${interaction.user.id}`)
        .setTitle(`طلب روم ${roomType}`);

    const forWhoInput = new TextInputBuilder()
        .setCustomId('for_who')
        .setLabel('موعد الطلب لمن؟')
        .setPlaceholder('يمكنك كتابة منشن أو اسم أو آيدي')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const whenInput = new TextInputBuilder()
        .setCustomId('when')
        .setLabel('موعد إنشاء الروم')
        .setPlaceholder('مثال: 12 صباحاً، بعد 3 ساعات، غداً الساعة 5')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const messageInput = new TextInputBuilder()
        .setCustomId('message')
        .setLabel('اكتب رسالتك')
        .setPlaceholder('الرسالة التي سيتم إرسالها في الروم')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(forWhoInput);
    const row2 = new ActionRowBuilder().addComponents(whenInput);
    const row3 = new ActionRowBuilder().addComponents(messageInput);

    modal.addComponents(row1, row2, row3);

    await interaction.showModal(modal);
}

// معالجة إرسال المودال
async function handleRoomModalSubmit(interaction, client) {
    const modalId = interaction.customId;
    const roomTypeEn = modalId.includes('condolence') ? 'condolence' : 'birthday';
    const roomType = roomTypeEn === 'condolence' ? 'عزاء' : 'ميلاد';
    const roomEmoji = roomTypeEn === 'condolence' ? '🖤' : '🎂';

    let forWho = interaction.fields.getTextInputValue('for_who');
    const when = interaction.fields.getTextInputValue('when');
    const message = interaction.fields.getTextInputValue('message');

    // تحويل الآيدي أو اليوزر إلى منشن
    forWho = await formatUserMention(forWho, interaction.guild);

    const config = loadRoomConfig();
    const guildConfig = config[interaction.guild.id];

    if (!guildConfig) {
        await interaction.reply({ content: '❌ **لم يتم إعداد نظام الغرف بعد**', ephemeral: true });
        return;
    }

    // طلب الإيموجي من المستخدم
    const emojiPrompt = colorManager.createEmbed()
        .setTitle('📝 **خطوة أخيرة**')
        .setDescription('**الرجاء إرسال الإيموجيات التي تريد إضافتها للروم**\n\nأرسل الإيموجيات (افصلها بمسافات)')
        .setFooter({ text: 'لديك 60 ثانية للرد' });

    await interaction.reply({ embeds: [emojiPrompt], ephemeral: true });

    // حفظ بيانات الطلب مؤقتاً في انتظار الإيموجي
    awaitingEmojis.set(interaction.user.id, {
        roomType,
        roomTypeEn,
        roomEmoji,
        forWho,
        when,
        message,
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        timestamp: Date.now()
    });

    // ضبط timeout لإزالة الانتظار بعد 60 ثانية
    setTimeout(() => {
        if (awaitingEmojis.has(interaction.user.id)) {
            awaitingEmojis.delete(interaction.user.id);
        }
    }, 60000);
}

// معالج رسائل الإيموجي
async function handleEmojiMessage(message, client) {
    if (message.author.bot) return;

    const userId = message.author.id;
    if (!awaitingEmojis.has(userId)) return;

    const requestData = awaitingEmojis.get(userId);
    awaitingEmojis.delete(userId);

    // استخراج الإيموجيات (Unicode, مخصصة, خارجية)
    const emojiRegex = /(?:<a?:\w+:\d+>)|(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;
    const extractedEmojis = message.content.match(emojiRegex) || [];
    
    // معالجة الإيموجيات المخصصة الخارجية
    const customEmojiRegex = /<a?:(\w+):(\d+)>/g;
    const emojis = [];
    
    for (const emoji of extractedEmojis) {
        const customMatch = emoji.match(customEmojiRegex);
        if (customMatch) {
            // إيموجي مخصص - استخدام الآيدي مباشرة
            emojis.push(emoji);
        } else {
            // إيموجي Unicode عادي
            emojis.push(emoji);
        }
    }

    if (emojis.length === 0) {
        await message.reply('❌ **لم يتم العثور على إيموجيات. تم إلغاء الطلب**').then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
        return;
    }

    const config = loadRoomConfig();
    const guildConfig = config[requestData.guildId];

    // إنشاء الطلب
    const request = {
        id: `${Date.now()}_${userId}`,
        guildId: requestData.guildId,
        userId: userId,
        roomType: requestData.roomType,
        roomTypeEn: requestData.roomTypeEn,
        forWho: requestData.forWho,
        when: requestData.when,
        message: requestData.message,
        emojis: emojis,
        status: 'pending',
        createdAt: Date.now()
    };

    // حفظ الطلب
    const requests = loadRoomRequests();
    requests.push(request);
    saveRoomRequests(requests);

    // إرسال الطلب لروم الطلبات
    const requestsChannel = await client.channels.fetch(guildConfig.requestsChannelId);

    const requestEmbed = colorManager.createEmbed()
        .setTitle(`${requestData.roomEmoji} **طلب روم ${requestData.roomType} جديد**`)
        .setDescription(`**تم استلام طلب جديد:**`)
        .addFields([
            { name: '👤 صاحب الطلب', value: `<@${userId}>`, inline: true },
            { name: '🎯 لمن؟', value: requestData.forWho, inline: true },
            { name: '⏰ موعد الإنشاء', value: requestData.when, inline: true },
            { name: '💬 الرسالة', value: requestData.message, inline: false },
            { name: '🎭 الإيموجيات', value: emojis.join(' '), inline: false },
            { name: '🆔 معرف الطلب', value: `\`${request.id}\``, inline: false }
        ])
        .setTimestamp()
        .setFooter({ text: `طلب من ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });

    const buttons = new ActionRowBuilder().addComponents([
        new ButtonBuilder()
            .setCustomId(`room_accept_${request.id}`)
            .setLabel('قبول')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`room_reject_${request.id}`)
            .setLabel('رفض')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    ]);

    await requestsChannel.send({ embeds: [requestEmbed], components: [buttons] });

    // حذف رسالة الإيموجيات من المستخدم
    await message.delete().catch(() => {});
    
    // إرسال رد مخفي للمستخدم في الخاص
    try {
        const replyEmbed = colorManager.createEmbed()
            .setTitle('✅ **تم إرسال الطلب**')
            .setDescription(`**تم إرسال طلبك بنجاح!**\n\n${requestData.roomEmoji} نوع الروم: ${requestData.roomType}\n🎯 لـ: ${requestData.forWho}\n⏰ الموعد: ${requestData.when}\n🎭 الإيموجيات: ${emojis.join(' ')}\n\nسيتم مراجعة طلبك وإبلاغك بالنتيجة قريباً`)
            .setTimestamp();
        
        await message.author.send({ embeds: [replyEmbed] });
    } catch (error) {
        console.error('فشل في إرسال رسالة خاصة للمستخدم:', error);
    }
}

// معالجة قبول/رفض الطلب
async function handleRoomRequestAction(interaction, client) {
    const action = interaction.customId.startsWith('room_accept') ? 'accept' : 'reject';

    // استخراج الـ ID بشكل صحيح
    const prefix = action === 'accept' ? 'room_accept_' : 'room_reject_';
    const requestId = interaction.customId.substring(prefix.length);

    console.log(`🔍 محاولة ${action} للطلب: ${requestId}`);

    // التحقق من الصلاحيات
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ **ليس لديك صلاحية لهذا الإجراء**', ephemeral: true });
        return;
    }

    const requests = loadRoomRequests();
    const requestIndex = requests.findIndex(r => r.id === requestId);

    console.log(`📊 عدد الطلبات: ${requests.length}, الموقع: ${requestIndex}`);

    if (requestIndex === -1) {
        console.log(`❌ لم يتم العثور على الطلب: ${requestId}`);
        console.log(`📋 الطلبات المتاحة: ${requests.map(r => r.id).join(', ')}`);
        await interaction.reply({ content: '❌ **لم يتم العثور على الطلب**', ephemeral: true });
        return;
    }

    const request = requests[requestIndex];

    if (request.status !== 'pending') {
        await interaction.reply({ content: `⚠️ **هذا الطلب تم ${request.status === 'accepted' ? 'قبوله' : 'رفضه'} مسبقاً**`, ephemeral: true });
        return;
    }

    // تحديث حالة الطلب
    requests[requestIndex].status = action === 'accept' ? 'accepted' : 'rejected';
    requests[requestIndex].reviewedBy = interaction.user.id;
    requests[requestIndex].reviewedAt = Date.now();
    saveRoomRequests(requests);

    // تحديث رسالة الطلب
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(action === 'accept' ? '#00ff00' : '#ff0000')
        .addFields([
            { name: '✅ الحالة', value: action === 'accept' ? 'تم القبول' : 'تم الرفض', inline: true },
            { name: '👤 بواسطة', value: `<@${interaction.user.id}>`, inline: true }
        ]);

    await interaction.update({ embeds: [updatedEmbed], components: [] });

    // إرسال إشعار لصاحب الطلب
    try {
        const requester = await client.users.fetch(request.userId);
        const roomEmoji = request.roomTypeEn === 'condolence' ? '🖤' : '🎂';

        const notificationEmbed = colorManager.createEmbed()
            .setTitle(`${action === 'accept' ? '✅' : '❌'} **${action === 'accept' ? 'تم قبول' : 'تم رفض'} طلبك**`)
            .setDescription(`**طلب روم ${request.roomType}**\n\n${roomEmoji} لـ: ${request.forWho}\n⏰ الموعد: ${request.when}\n\n${action === 'accept' ? 'سيتم إنشاء الروم في الوقت المحدد' : 'تم رفض طلبك'}`)
            .setTimestamp();

        await requester.send({ embeds: [notificationEmbed] });
    } catch (error) {
        console.error('فشل في إرسال الإشعار:', error);
    }

    // إذا تم القبول، جدولة إنشاء الروم
    if (action === 'accept') {
        await scheduleRoomCreation(request, client);
    }
}

// جدولة إنشاء الروم
async function scheduleRoomCreation(request, client) {
    const config = loadRoomConfig();
    const guildConfig = config[request.guildId];

    if (!guildConfig) {
        console.error(`❌ لم يتم العثور على إعدادات السيرفر ${request.guildId}`);
        return;
    }

    // تحليل الوقت
    const scheduleTime = parseScheduleTime(request.when);

    if (!scheduleTime) {
        console.error('❌ فشل في تحليل الوقت:', request.when);
        return;
    }

    // التحقق من أن الوقت في المستقبل
    if (scheduleTime <= new Date()) {
        console.log(`⚡ الوقت المحدد قد مضى، إنشاء الروم فوراً`);
        await createRoom(request, client, guildConfig);
        return;
    }

    // جدولة المهمة
    const job = schedule.scheduleJob(scheduleTime, async () => {
        console.log(`⏰ حان موعد إنشاء الروم: ${request.roomType} لـ ${request.forWho}`);
        await createRoom(request, client, guildConfig);
        activeSchedules.delete(request.id);
        saveSchedules(); // حفظ بعد حذف الجدولة
    });

    activeSchedules.set(request.id, job);
    saveSchedules(); // حفظ الجدولة الجديدة
    console.log(`✅ تم جدولة إنشاء روم ${request.roomType} للوقت: ${scheduleTime.toLocaleString('ar-SA')}`);
}

// إنشاء الروم
async function createRoom(request, client, guildConfig) {
    try {
        console.log(`🔄 بدء إنشاء روم: ${request.roomType} لـ ${request.forWho}`);
        
        const guild = await client.guilds.fetch(request.guildId);
        if (!guild) {
            console.error(`❌ السيرفر ${request.guildId} غير موجود`);
            return;
        }

        const roomName = `${request.roomTypeEn === 'condolence' ? '🖤' : '🎂'}-${request.forWho.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '-')}`;

        // إنشاء الروم
        const channel = await guild.channels.create({
            name: roomName,
            type: ChannelType.GuildText,
            reason: `طلب من ${request.userId}`
        });

        console.log(`✅ تم إنشاء القناة: ${channel.name} (${channel.id})`);

        // إرسال الرسالة
        const roomEmbed = colorManager.createEmbed()
            .setTitle(`${request.roomTypeEn === 'condolence' ? '🖤' : '🎂'} **روم ${request.roomType}**`)
            .setDescription(request.message)
            .addFields([
                { name: 'لـ', value: request.forWho, inline: true },
                { name: 'بطلب من', value: `<@${request.userId}>`, inline: true }
            ])
            .setTimestamp();

        const sentMessage = await channel.send({ embeds: [roomEmbed] });
        console.log(`✅ تم إرسال رسالة الإمبد في الروم`);

        // إضافة الريآكتات من الطلب
        const emojis = request.emojis || [];
        console.log(`📝 محاولة إضافة ${emojis.length} ريآكشن`);
        
        for (const reaction of emojis) {
            try {
                // محاولة إضافة الريآكت (يدعم Unicode والمخصص والخارجي)
                await sentMessage.react(reaction);
                console.log(`✅ تم إضافة ريآكت: ${reaction}`);
            } catch (error) {
                // إذا فشل، حاول استخراج الآيدي من الإيموجي المخصص
                const emojiIdMatch = reaction.match(/<a?:\w+:(\d+)>/);
                if (emojiIdMatch) {
                    try {
                        await sentMessage.react(emojiIdMatch[1]);
                        console.log(`✅ تم إضافة ريآكت بالآيدي: ${emojiIdMatch[1]}`);
                    } catch (err) {
                        console.error('فشل في إضافة الريآكت بالآيدي:', err.message);
                    }
                } else {
                    console.error('خطأ في إضافة الريآكت:', error.message);
                }
            }
        }

        // إعداد نظام الريآكت التلقائي
        if (emojis.length > 0) {
            setupAutoReact(channel.id, emojis, client);
            console.log(`✅ تم إعداد نظام الريآكت التلقائي`);
        }

        console.log(`✅ تم إنشاء روم ${request.roomType} بنجاح: ${roomName}`);
        
        // إرسال إشعار لصاحب الطلب
        try {
            const requester = await client.users.fetch(request.userId);
            const notificationEmbed = colorManager.createEmbed()
                .setTitle('✅ تم إنشاء الروم')
                .setDescription(`تم إنشاء روم ${request.roomType} الذي طلبته`)
                .addFields([
                    { name: 'اسم الروم', value: roomName, inline: true },
                    { name: 'رابط الروم', value: `<#${channel.id}>`, inline: true }
                ])
                .setTimestamp();
            
            await requester.send({ embeds: [notificationEmbed] });
            console.log(`✅ تم إرسال إشعار لصاحب الطلب`);
        } catch (dmError) {
            console.error('فشل في إرسال إشعار لصاحب الطلب:', dmError.message);
        }

    } catch (error) {
        console.error('❌ خطأ في إنشاء الروم:', error);
        
        // محاولة إرسال إشعار بالخطأ لصاحب الطلب
        try {
            const requester = await client.users.fetch(request.userId);
            const errorEmbed = colorManager.createEmbed()
                .setTitle('❌ فشل في إنشاء الروم')
                .setDescription(`حدث خطأ أثناء إنشاء روم ${request.roomType}`)
                .addFields([
                    { name: 'السبب', value: error.message || 'خطأ غير معروف', inline: false }
                ])
                .setColor('#ff0000')
                .setTimestamp();
            
            await requester.send({ embeds: [errorEmbed] });
        } catch (dmError) {
            console.error('فشل في إرسال إشعار الخطأ:', dmError.message);
        }
    }
}

// إعداد نظام الريآكت التلقائي
function setupAutoReact(channelId, reactions, client) {
    const handler = async (message) => {
        if (message.channel.id === channelId && !message.author.bot) {
            for (const reaction of reactions) {
                try {
                    await message.react(reaction);
                } catch (error) {
                    // محاولة استخدام آيدي الإيموجي إذا فشل
                    const emojiIdMatch = reaction.match(/<a?:\w+:(\d+)>/);
                    if (emojiIdMatch) {
                        try {
                            await message.react(emojiIdMatch[1]);
                        } catch (err) {
                            console.error('فشل في إضافة الريآكت التلقائي بالآيدي:', err.message);
                        }
                    } else {
                        console.error('خطأ في إضافة الريآكت التلقائي:', error.message);
                    }
                }
            }
        }
    };

    client.on('messageCreate', handler);
}

// تحليل الوقت
function parseScheduleTime(timeString) {
    const moment = require('moment-timezone');
    const now = moment().tz('Asia/Riyadh');

    // بعد X ساعات
    const hoursMatch = timeString.match(/بعد\s+(\d+)\s*ساعات?/);
    if (hoursMatch) {
        const hours = parseInt(hoursMatch[1]);
        return now.clone().add(hours, 'hours').toDate();
    }

    // بعد X دقائق
    const minutesMatch = timeString.match(/بعد\s+(\d+)\s*دقائق?|دقيقة/);
    if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1] || 1);
        return now.clone().add(minutes, 'minutes').toDate();
    }

    // الساعة X
    const hourMatch = timeString.match(/(\d+)\s*(صباحاً|مساءً|ص|م)?/);
    if (hourMatch) {
        const hour = parseInt(hourMatch[1]);
        const isPM = hourMatch[2] && (hourMatch[2].includes('مساء') || hourMatch[2] === 'م');
        const targetHour = isPM && hour < 12 ? hour + 12 : hour;

        const targetDate = now.clone().hour(targetHour).minute(0).second(0).millisecond(0);

        // إذا كان الوقت قد مضى، اجعله غداً
        if (targetDate.isSameOrBefore(now)) {
            targetDate.add(1, 'day');
        }

        return targetDate.toDate();
    }

    // غداً
    if (timeString.includes('غداً') || timeString.includes('غدا')) {
        return now.clone().add(1, 'day').hour(12).minute(0).second(0).millisecond(0).toDate();
    }

    // الآن أو فوراً
    if (timeString.includes('الآن') || timeString.includes('فوراً') || timeString.includes('فورا')) {
        return now.clone().add(1, 'second').toDate();
    }

    // افتراضياً: بعد ساعة
    return now.clone().add(1, 'hour').toDate();
}

// تسجيل معالجات التفاعلات
function registerHandlers(client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit() && !interaction.isButton()) return;

        try {
            // معالجة منيو طلبات الغرف
            if (interaction.isStringSelectMenu() && interaction.customId === 'room_type_menu') {
                await handleRoomRequestMenu(interaction, client);
                return;
            }

            // معالجة مودالات طلبات الغرف
            if (interaction.isModalSubmit() && interaction.customId.startsWith('room_modal_')) {
                await handleRoomModalSubmit(interaction, client);
                return;
            }

            // معالجة قبول/رفض طلبات الغرف
            if (interaction.isButton() && (interaction.customId.startsWith('room_accept_') || interaction.customId.startsWith('room_reject_'))) {
                await handleRoomRequestAction(interaction, client);
                return;
            }
        } catch (error) {
            console.error('❌ خطأ في معالجة تفاعل setroom:', error);
        }
    });

    // معالج رسائل الإيموجي
    client.on('messageCreate', async (message) => {
        await handleEmojiMessage(message, client);
    });

    console.log('✅ تم تسجيل معالجات setroom بنجاح');
}

async function execute(message, args, { BOT_OWNERS, client }) {
    // التحقق من الصلاحيات
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && 
        !BOT_OWNERS.includes(message.author.id)) {
        await message.reply('❌ **هذا الأمر متاح للمسؤولين فقط**');
        return;
    }

    const guildId = message.guild.id;

    // الخطوة 1: طلب روم الطلبات
    const step1Embed = colorManager.createEmbed()
        .setTitle('📝 **إعداد نظام الغرف**')
        .setDescription('**الخطوة 1/3: منشن روم الطلبات**\n\nقم بعمل منشن للروم الذي سيتم إرسال الطلبات فيه\n\n**📌 دليل صيغ الوقت المدعومة:**\n```\n• بعد ساعة / بعد ساعتين / بعد 3 ساعات\n• دقيقتين / بعد 5 دقائق / بعد دقيقة\n• 12 صباحاً / 5 مساءً / الساعة 8\n• غداً / غدا الساعة 3 / بكره 10 صباحاً\n• الآن / فوراً / دحين / الحين\n• بعد 30 ثانية```')
        .setFooter({ text: 'لديك 60 ثانية للرد' });

    await message.channel.send({ embeds: [step1Embed] });

    const filter = m => m.author.id === message.author.id;
    const collector = message.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on('collect', async (msg1) => {
        const requestsChannel = msg1.mentions.channels.first();
        if (!requestsChannel) {
            await message.channel.send('❌ **لم يتم العثور على الروم. حاول مرة أخرى**');
            return;
        }

        // الخطوة 2: طلب روم الإيمبد
        const step2Embed = colorManager.createEmbed()
            .setTitle('📝 **إعداد نظام الغرف**')
            .setDescription('**الخطوة 2/3: منشن روم الإيمبد**\n\nقم بعمل منشن للروم الذي سيتم إرسال الإيمبد فيه')
            .setFooter({ text: 'لديك 60 ثانية للرد' });

        await message.channel.send({ embeds: [step2Embed] });

        const collector2 = message.channel.createMessageCollector({ filter, time: 60000, max: 1 });

        collector2.on('collect', async (msg2) => {
            const embedChannel = msg2.mentions.channels.first();
            if (!embedChannel) {
                await message.channel.send('❌ **لم يتم العثور على الروم. حاول مرة أخرى**');
                return;
            }

            // الخطوة 3: طلب الصورة
            const step3Embed = colorManager.createEmbed()
                .setTitle('📝 **إعداد نظام الغرف**')
                .setDescription('**الخطوة 3/3: أرسل الصورة**\n\nأرسل الصورة (إرفاق أو رابط)')
                .setFooter({ text: 'لديك 120 ثانية للرد' });

            await message.channel.send({ embeds: [step3Embed] });

            const collector3 = message.channel.createMessageCollector({ filter, time: 120000, max: 1 });

            collector3.on('collect', async (msg3) => {
                let imageUrl = null;

                // التحقق من المرفقات
                if (msg3.attachments.size > 0) {
                    const attachment = msg3.attachments.first();
                    if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                        imageUrl = attachment.url;
                    }
                } 
                // التحقق من الرابط
                else if (msg3.content.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i)) {
                    imageUrl = msg3.content;
                }

                if (!imageUrl) {
                    await message.channel.send('❌ **لم يتم العثور على صورة صحيحة. حاول مرة أخرى**');
                    return;
                }

                // حفظ الإعدادات
                const config = loadRoomConfig();
                config[guildId] = {
                    requestsChannelId: requestsChannel.id,
                    embedChannelId: embedChannel.id,
                    imageUrl: imageUrl,
                    setupBy: message.author.id,
                    setupAt: Date.now()
                };

                if (saveRoomConfig(config)) {
                    // إرسال الإيمبد في روم الإيمبد
                    const finalEmbed = colorManager.createEmbed()
                        .setTitle('🏠 **نظام طلبات الغرف**')
                        .setDescription('**اختر نوع الغرفة التي تريد طلبها:**')
                        .setImage(imageUrl)
                        .setFooter({ text: 'اختر من القائمة أدناه' });

                    const menu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('room_type_menu')
                            .setPlaceholder('اختر نوع الروم')
                            .addOptions([
                                {
                                    label: 'روم عزاء',
                                    description: 'طلب روم عزاء',
                                    value: 'condolence',
                                    emoji: '🖤'
                                },
                                {
                                    label: 'روم ميلاد',
                                    description: 'طلب روم ميلاد',
                                    value: 'birthday',
                                    emoji: '🎂'
                                }
                            ])
                    );

                    await embedChannel.send({ embeds: [finalEmbed], components: [menu] });

                    // رسالة نجاح
                    const successEmbed = colorManager.createEmbed()
                        .setTitle('✅ **تم الإعداد بنجاح**')
                        .setDescription(`**تم إعداد نظام الغرف بنجاح!**\n\n📝 روم الطلبات: ${requestsChannel}\n📊 روم الإيمبد: ${embedChannel}`)
                        .setTimestamp();

                    await message.channel.send({ embeds: [successEmbed] });

                    // تسجيل الحدث
                    logEvent(client, message.guild, {
                        type: 'SETUP_ACTIONS',
                        title: 'إعداد نظام الغرف',
                        description: `تم إعداد نظام طلبات الغرف`,
                        user: message.author,
                        fields: [
                            { name: 'روم الطلبات', value: requestsChannel.name, inline: true },
                            { name: 'روم الإيمبد', value: embedChannel.name, inline: true }
                        ]
                    });
                } else {
                    await message.channel.send('❌ **فشل في حفظ الإعدادات**');
                }
            });
        });
    });
}

module.exports = { 
    name,
    execute,
    loadRoomConfig,
    saveRoomConfig,
    loadRoomRequests,
    saveRoomRequests,
    registerHandlers,
    restoreSchedules
};