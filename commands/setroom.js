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
const setupEmbedMessagesPath = path.join(__dirname, '..', 'data', 'setupEmbedMessages.json');

// تخزين الجدولات النشطة
const activeSchedules = new Map();

// مسار ملف الجدولات
const schedulesPath = path.join(__dirname, '..', 'data', 'roomSchedules.json');
const activeRooms = new Map();
// مسار ملف الرومات النشطة
const activeRoomsPath = path.join(__dirname, '..', 'data', 'activeRooms.json');
// تخزين جدولات حذف الرومات
const roomDeletionJobs = new Map();
// تخزين جدولات الفحص الدورية للرسائل
const messageVerificationJobs = new Map();

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
// حفظ الرومات النشطة
function saveActiveRooms() {
    try {
        const roomsData = Array.from(activeRooms.entries()).map(([channelId, data]) => ({
            channelId,
            ...data
        }));
        fs.writeFileSync(activeRoomsPath, JSON.stringify(roomsData, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ الرومات النشطة:', error);
        return false;
    }
}
// تحميل الرومات النشطة
function loadActiveRooms() {
    try {
        if (fs.existsSync(activeRoomsPath)) {
            const roomsData = JSON.parse(fs.readFileSync(activeRoomsPath, 'utf8'));
            const roomsMap = new Map();
            roomsData.forEach(room => {
                roomsMap.set(room.channelId, {
                    guildId: room.guildId,
                    createdAt: room.createdAt,
                    emojis: room.emojis || [],
                    requestId: room.requestId
                });
            });
            return roomsMap;
        }
        return new Map();
    } catch (error) {
        console.error('خطأ في تحميل الرومات النشطة:', error);
        return new Map();
    }
}
async function deleteRoom(channelId, client) {
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.log(`⚠️ الروم ${channelId} غير موجود (ربما تم حذفه مسبقاً)`);
            activeRooms.delete(channelId);
            roomEmbedMessages.delete(channelId);
            cancelVerificationJobs(channelId);
            saveActiveRooms();
            return;
        }
        await channel.delete('انتهت مدة الروم (12 ساعة)');
        console.log(`🗑️ تم حذف الروم: ${channel.name}`);
        
        activeRooms.delete(channelId);
        roomEmbedMessages.delete(channelId);
        cancelVerificationJobs(channelId);
        saveActiveRooms();
    } catch (error) {
        console.error(`❌ خطأ في حذف الروم ${channelId}:`, error);
    }
}
// جدولة حذف روم بعد 12 ساعة
function scheduleRoomDeletion(channelId, client) {
    const deletionTime = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 ساعة
    
    const job = schedule.scheduleJob(deletionTime, async () => {
        console.log(`⏰ حان موعد حذف الروم: ${channelId}`);
        await deleteRoom(channelId, client);
        roomDeletionJobs.delete(channelId);
    });
    
    roomDeletionJobs.set(channelId, job);
    console.log(`✅ تم جدولة حذف الروم ${channelId} بعد 12 ساعة`);
}

// إلغاء جميع جدولات الفحص لروم معين
function cancelVerificationJobs(channelId) {
    const jobs = messageVerificationJobs.get(channelId);
    if (jobs && Array.isArray(jobs)) {
        jobs.forEach(job => {
            if (job && job.cancel) {
                job.cancel();
            }
        });
        messageVerificationJobs.delete(channelId);
        console.log(`🗑️ تم إلغاء جدولات الفحص للروم ${channelId}`);
    }
}

// إعادة إرسال setup embed إذا لم يكن موجوداً
async function resendSetupEmbed(guildId, client) {
    try {
        const config = loadRoomConfig();
        const guildConfig = config[guildId];
        
        if (!guildConfig || !guildConfig.embedChannelId || !guildConfig.imageUrl) {
            console.error(`❌ لا توجد بيانات setup للسيرفر ${guildId}`);
            return false;
        }

        const setupData = setupEmbedMessages.get(guildId);
        const embedChannel = await client.channels.fetch(guildConfig.embedChannelId).catch(() => null);
        
        if (!embedChannel) {
            console.error(`❌ قناة الإيمبد ${guildConfig.embedChannelId} غير موجودة`);
            return false;
        }

        // محاولة جلب الرسالة الأصلية
        if (setupData && setupData.messageId) {
            const existingMessage = await embedChannel.messages.fetch(setupData.messageId).catch(() => null);
            if (existingMessage) {
                console.log(`✅ رسالة setup embed موجودة بالفعل في ${embedChannel.name}`);
                return true;
            }
        }

        // إعادة الإرسال
        console.log(`🔄 إعادة إرسال setup embed في ${embedChannel.name}`);
        
        const finalEmbed = colorManager.createEmbed()
            .setTitle('**Rooms**')
            .setDescription('**اختر نوع الروم التي تريد طلبها :**')
            .setImage(guildConfig.imageUrl)
            .setFooter({ text: 'Rooms system' });

        const menu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('room_type_menu')
                .setPlaceholder('اختر نوع الروم')
                .addOptions([
                    {
                        label: 'روم تعزيه',
                        description: 'طلب روم عزاء',
                        value: 'condolence',
                    },
                    {
                        label: 'روم ميلاد',
                        description: 'طلب روم hbd',
                        value: 'birthday',
                    }
                ])
        );

        const newMessage = await embedChannel.send({ embeds: [finalEmbed], components: [menu] });

        // تحديث معلومات الرسالة
        setupEmbedMessages.set(guildId, {
            messageId: newMessage.id,
            channelId: embedChannel.id,
            imageUrl: guildConfig.imageUrl
        });
        
        saveSetupEmbedMessages(setupEmbedMessages);

        console.log(`✅ تم إعادة إرسال setup embed بنجاح في ${embedChannel.name}`);
        return true;
    } catch (error) {
        console.error(`❌ خطأ في إعادة إرسال setup embed:`, error.message);
        return false;
    }
}

// فحص setup embed
async function verifySetupEmbed(guildId, messageId, channelId, client, attempt = 1) {
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.error(`❌ [فحص setup ${attempt}] القناة ${channelId} غير موجودة`);
            return false;
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
            console.error(`❌ [فحص setup ${attempt}] رسالة setup ${messageId} غير موجودة`);
            return false;
        }

        console.log(`✅ [فحص setup ${attempt}] تم التحقق من وجود setup embed في ${channel.name}`);
        return true;
    } catch (error) {
        console.error(`❌ [فحص setup ${attempt}] خطأ في التحقق:`, error.message);
        return false;
    }
}

// جدولة فحص setup embed بعد 3 دقائق
function scheduleSetupEmbedThreeMinuteCheck(guildId, messageId, channelId, client) {
    const checkTime = new Date(Date.now() + 3 * 60 * 1000);
    
    const job = schedule.scheduleJob(checkTime, async () => {
        console.log(`⏰ [فحص setup 3 دقائق] فحص setup embed للسيرفر ${guildId}`);
        
        const isValid = await verifySetupEmbed(guildId, messageId, channelId, client, 2);
        if (!isValid) {
            console.log(`🔄 [فحص setup 3 دقائق] محاولة إعادة الإرسال...`);
            await resendSetupEmbed(guildId, client);
        }
    });
    
    console.log(`📅 تم جدولة فحص setup embed بعد 3 دقائق للسيرفر ${guildId}`);
    return job;
}

// جدولة فحص دوري لـ setup embed
function scheduleSetupEmbedPeriodicChecks(guildId, messageId, channelId, client) {
    const jobs = [];
    const jobKey = `setup_${guildId}`;
    
    // فحص كل 10 دقائق لمدة ساعة (6 فحوصات)
    for (let i = 1; i <= 6; i++) {
        const checkTime = new Date(Date.now() + (i * 10 * 60 * 1000));
        
        const job = schedule.scheduleJob(checkTime, async () => {
            console.log(`⏰ [فحص دوري setup ${i}/6] فحص setup embed للسيرفر ${guildId}`);
            
            const isValid = await verifySetupEmbed(guildId, messageId, channelId, client, i + 2);
            if (!isValid) {
                console.log(`🔄 [فحص دوري setup ${i}/6] محاولة إعادة الإرسال...`);
                await resendSetupEmbed(guildId, client);
            }
        });
        
        jobs.push(job);
    }
    
    console.log(`📅 تم جدولة 6 فحوصات دورية لـ setup embed (كل 10 دقائق) للسيرفر ${guildId}`);
    messageVerificationJobs.set(jobKey, jobs);
}
// فحص وحذف الرومات القديمة
async function checkAndDeleteOldRooms(client) {
    const now = Date.now();
    const roomsToDelete = [];
    
    for (const [channelId, roomData] of activeRooms.entries()) {
        const roomAge = now - roomData.createdAt;
        const hoursSinceCreation = roomAge / (1000 * 60 * 60);
        
        if (hoursSinceCreation >= 12) {
            roomsToDelete.push(channelId);
        } else { const remainingTime = (12 * 60 * 60 * 1000) - roomAge;
            const deletionTime = new Date(now + remainingTime);
            
            const job = schedule.scheduleJob(deletionTime, async () => {
                console.log(`⏰ حان موعد حذف الروم: ${channelId}`);
                await deleteRoom(channelId, client);
                roomDeletionJobs.delete(channelId);
            });
            
            roomDeletionJobs.set(channelId, job);
            console.log(`✅ تم إعادة جدولة حذف الروم ${channelId} بعد ${Math.round(remainingTime / (1000 * 60))} دقيقة`);
        }
    }
    
    // حذف الرومات القديمة
    for (const channelId of roomsToDelete) {
        await deleteRoom(channelId, client);
    }
    
    if (roomsToDelete.length > 0) {
        console.log(`🗑️ تم حذف ${roomsToDelete.length} روم قديم`);
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

// نظام فحص دوري مستمر - يعمل كل 5 دقائق
function startContinuousSetupEmbedCheck(client) {
    setInterval(async () => {
        try {
            await checkAndRestoreSetupEmbed(client);
        } catch (error) {
            console.error('❌ خطأ في الفحص الدوري المستمر:', error);
        }
    }, 5 * 60 * 1000); // كل 5 دقائق
    
    console.log('✅ تم تشغيل نظام الفحص الدوري المستمر (كل 5 دقائق)');
}

// فحص واستعادة الإيمبد المحذوف
async function checkAndRestoreSetupEmbed(client) {
    try {
        setupEmbedMessages = loadSetupEmbedMessages();
        const config = loadRoomConfig();
        
        for (const [guildId, guildConfig] of Object.entries(config)) {
            if (!guildConfig.embedChannelId || !guildConfig.imageUrl) {
                continue;
            }

            const setupData = setupEmbedMessages.get(guildId);
            
            try {
                const embedChannel = await client.channels.fetch(guildConfig.embedChannelId);
                
                let needsNewMessage = false;
                
                if (!setupData || !setupData.messageId) {
                    console.log(`📝 لا توجد رسالة محفوظة للسيرفر ${guildId} - سيتم إنشاء رسالة جديدة`);
                    needsNewMessage = true;
                } else {
                    try {
                        await embedChannel.messages.fetch(setupData.messageId);
                        // رسالة موجودة - لا حاجة للطباعة في كل مرة
                    } catch (fetchError) {
                        if (fetchError.code === 10008) {
                            console.log(`🔄 رسالة الإيمبد محذوفة في السيرفر ${guildId} - إعادة الإرسال...`);
                            needsNewMessage = true;
                        }
                    }
                }

                if (needsNewMessage) {
                    const finalEmbed = colorManager.createEmbed()
                        .setTitle('**Rooms**')
                        .setDescription('**اختر نوع الروم التي تريد طلبها :**')
                        .setImage(guildConfig.imageUrl)
                        .setFooter({ text: 'Rooms system' });

                    const menu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('room_type_menu')
                            .setPlaceholder('اختر نوع الروم')
                            .addOptions([
                                {
                                    label: 'روم تعزيه',
                                    description: 'طلب روم عزاء',
                                    value: 'condolence',
                                },
                                {
                                    label: 'روم ميلاد',
                                    description: 'طلب روم hbd',
                                    value: 'birthday',
                                }
                            ])
                    );

                    const newMessage = await embedChannel.send({ embeds: [finalEmbed], components: [menu] });
                    console.log(`📤 تم إرسال setup embed في السيرفر ${guildId}`);

                    setupEmbedMessages.set(guildId, {
                        messageId: newMessage.id,
                        channelId: embedChannel.id,
                        imageUrl: guildConfig.imageUrl
                    });
                    
                    saveSetupEmbedMessages(setupEmbedMessages);

                    // فحص فوري بعد ثانية واحدة
                    setTimeout(async () => {
                        const isVerified = await verifySetupEmbed(guildId, newMessage.id, embedChannel.id, client, 1);
                        if (!isVerified) {
                            console.error(`⚠️ فشل التحقق الفوري - سيتم المحاولة في الفحص التالي`);
                        }
                    }, 1000);

                    console.log(`✅ تم إرسال setup embed في السيرفر ${guildId}`);
                }
            } catch (channelError) {
                console.error(`❌ خطأ في فحص/استعادة الإيمبد للسيرفر ${guildId}:`, channelError);
            }
        }
    } catch (error) {
        console.error('❌ خطأ عام في فحص واستعادة الإيمبد:', error);
    }
}

// تخزين انتظار الإيموجي
const awaitingEmojis = new Map();

// تخزين رسائل الإمبد في الغرف للحماية من الحذف
const roomEmbedMessages = new Map();

// تخزين رسائل إيمبد السيتب للحماية من الحذف - يتم تحميلها من الملف
let setupEmbedMessages = loadSetupEmbedMessages();

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

function loadSetupEmbedMessages() {
    try {
        if (fs.existsSync(setupEmbedMessagesPath)) {
            const data = JSON.parse(fs.readFileSync(setupEmbedMessagesPath, 'utf8'));
            const embedMap = new Map();
            for (const [guildId, embedData] of Object.entries(data)) {
                embedMap.set(guildId, embedData);
            }
            return embedMap;
        }
        return new Map();
    } catch (error) {
        console.error('خطأ في قراءة setupEmbedMessages:', error);
        return new Map();
    }
}

function saveSetupEmbedMessages(embedMap) {
    try {
        const data = {};
        for (const [guildId, embedData] of embedMap.entries()) {
            data[guildId] = {
                messageId: embedData.messageId,
                channelId: embedData.channelId,
                imageUrl: embedData.imageUrl
            };
        }
        fs.writeFileSync(setupEmbedMessagesPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ setupEmbedMessages:', error);
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
        .setLabel('الطلب لمن؟')
        .setPlaceholder('يمكنك كتابة منشن أو اسم أو آيدي')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const whenInput = new TextInputBuilder()
        .setCustomId('when')
        .setLabel('موعد إنشاء الروم')
        .setPlaceholder('، مثال: 12 صباحاً، بعد 3 ساعات، غداً الساعة 5، الحين')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const messageInput = new TextInputBuilder()
        .setCustomId('message')
        .setLabel(' اكتب رسالتك')
        .setPlaceholder('الرسالة التي سيتم إرسالها في الروم')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    const imageInput = new TextInputBuilder()
        .setCustomId('image_url')
        .setLabel('رابط الصورة (اختياري)')
        .setPlaceholder('ضع رابط الصورة هنا إن أردت (اختياري)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    const row1 = new ActionRowBuilder().addComponents(forWhoInput);
    const row2 = new ActionRowBuilder().addComponents(whenInput);
    const row3 = new ActionRowBuilder().addComponents(messageInput);
    const row4 = new ActionRowBuilder().addComponents(imageInput);

    modal.addComponents(row1, row2, row3, row4);

    await interaction.showModal(modal);

    // إعادة تعيين المنيو فورًا بعد فتح المودال
    try {
        const config = loadRoomConfig();
        const guildConfig = config[interaction.guild.id];
        
        if (guildConfig) {
            const setupData = setupEmbedMessages.get(interaction.guild.id);
            
            if (setupData && setupData.messageId && setupData.channelId === guildConfig.embedChannelId) {
                const embedChannel = await client.channels.fetch(guildConfig.embedChannelId);
                const setupMessage = await embedChannel.messages.fetch(setupData.messageId);
                
                // إعادة بناء المنيو بدون اختيار افتراضي
                const freshMenu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('room_type_menu')
                        .setPlaceholder('اختر نوع الروم')
                        .addOptions([
                            {
                                label: 'روم تعزيه',
                                description: 'طلب روم عزاء',
                                value: 'condolence',
                            },
                            {
                                label: 'روم ميلاد',
                                description: 'طلب روم hbd',
                                value: 'birthday',
                            }
                        ])
                );
                
                await setupMessage.edit({ components: [freshMenu] });
                console.log('✅ تم إعادة تعيين المنيو فورًا بعد فتح المودال');
            }
        }
    } catch (updateError) {
        console.error('❌ خطأ في إعادة تعيين المنيو:', updateError);
    }
}

// معالجة إرسال المودال
async function handleRoomModalSubmit(interaction, client) {
    const modalId = interaction.customId;
    const roomTypeEn = modalId.includes('condolence') ? 'condolence' : 'birthday';
    const roomType = roomTypeEn === 'condolence' ? 'عزاء' : 'ميلاد';
    const roomEmoji = roomTypeEn === 'condolence' ? '🖤' : '🎂';

    let forWho = interaction.fields.getTextInputValue('for_who').trim();
    const when = interaction.fields.getTextInputValue('when').trim();
    const message = interaction.fields.getTextInputValue('message').trim();
    let imageUrl = interaction.fields.getTextInputValue('image_url')?.trim() || null;

    // التحقق من الإدخالات
    const validationErrors = [];

    // فحص "لمن"
    if (!forWho || forWho.length < 2) {
        validationErrors.push('❌ اسم الشخص يجب أن يكون حرفين على الأقل');
    }
    if (forWho.length > 50) {
        validationErrors.push('❌ اسم الشخص طويل جداً (الحد الأقصى 50 حرف)');
    }

    // فحص "متى"
    if (!when || when.length < 2) {
        validationErrors.push('❌ موعد الإنشاء مطلوب');
    }
    if (when.length > 100) {
        validationErrors.push('❌ موعد الإنشاء طويل جداً');
    }

    // فحص الرسالة
    if (!message || message.length < 5) {
        validationErrors.push('❌ الرسالة يجب أن تكون 5 أحرف على الأقل');
    }
    if (message.length > 1000) {
        validationErrors.push('❌ الرسالة طويلة جداً (الحد الأقصى 1000 حرف)');
    }

    // فحص رابط الصورة (إذا تم إدخاله)
    if (imageUrl && imageUrl.length > 0) {
        const imageUrlPattern = /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp)/i;
        if (!imageUrlPattern.test(imageUrl)) {
            validationErrors.push('❌ رابط الصورة غير صالح. يجب أن يكون رابط صورة صحيح (jpg, png, gif, webp)');
        }
    }

    // إذا كان هناك أخطاء، أرسلها
    if (validationErrors.length > 0) {
        const errorEmbed = colorManager.createEmbed()
            .setTitle('**أخطاء في الإدخال**')
            .setDescription(validationErrors.join('\n'))
            .setColor('#ff0000');
        
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        return;
    }

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
        .setTitle('**خطوة أخيرة**')
        .setDescription('**الرجاء إرسال الإيموجيات التي تريد إضافتها للروم**\n\nأرسل الإيموجيات (لازم من السيرفر)')
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
        imageUrl,
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

    // استخراج الإيموجيات المخصصة (عادية ومتحركة)
    const customEmojiRegex = /<a?:\w+:\d+>/g;
    const customEmojis = message.content.match(customEmojiRegex) || [];
    
    // استخراج الإيموجيات Unicode
    const unicodeEmojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji})/gu;
    const unicodeEmojis = [];
    
    // إزالة الإيموجيات المخصصة من النص للحصول على Unicode فقط
    let cleanContent = message.content;
    for (const customEmoji of customEmojis) {
        cleanContent = cleanContent.replace(customEmoji, '');
    }
    
    // استخراج Unicode
    const unicodeMatches = cleanContent.match(unicodeEmojiRegex) || [];
    for (const emoji of unicodeMatches) {
        if (emoji.trim()) {
            unicodeEmojis.push(emoji);
        }
    }
    
    // دمج جميع الإيموجيات
    const emojis = [...customEmojis, ...unicodeEmojis];
    
    if (emojis.length === 0) {
        await message.reply('❌ **لم يتم العثور على إيموجيات. تم إلغاء الطلب**').then(msg => {
            setTimeout(() => msg.delete().catch(() => {}), 5000);
        });
        return;
    }

    // فحص عدد الإيموجيات
    if (emojis.length > 20) {
        await message.reply('❌ **الحد الأقصى للإيموجيات هو 20. تم إلغاء الطلب**').then(msg => {
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
        imageUrl: requestData.imageUrl,
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
            { name: 'صاحب الطلب', value: `<@${userId}>`, inline: true },
            { name: 'لمن؟', value: requestData.forWho, inline: true },
            { name: 'موعد الإنشاء', value: requestData.when, inline: true },
            { name: 'الرسالة', value: requestData.message, inline: false },
            { name: 'الإيموجيات', value: emojis.join(' '), inline: false },
            { name: 'معرف الطلب', value: `\`${request.id}\``, inline: false }
        ])
        .setTimestamp()
        .setFooter({ text: `طلب من ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });

    // إضافة الصورة إذا كانت موجودة
    if (requestData.imageUrl) {
        requestEmbed.setImage(requestData.imageUrl);
    }

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

    // تحديث رسالة السيتب لإعادة تعيين المنيو
    try {
        const embedChannel = await client.channels.fetch(guildConfig.embedChannelId);
        const setupData = setupEmbedMessages.get(requestData.guildId);
        
        if (setupData && setupData.messageId && setupData.channelId === guildConfig.embedChannelId) {
            const setupMessage = await embedChannel.messages.fetch(setupData.messageId);
            
            // إعادة بناء المنيو بدون اختيار افتراضي
            const freshMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('room_type_menu')
                    .setPlaceholder('اختر نوع الروم')
                    .addOptions([
                        {
                            label: 'روم تعزيه',
                            description: 'طلب روم عزاء',
                            value: 'condolence',
                        },
                        {
                            label: 'روم ميلاد',
                            description: 'طلب روم hbd',
                            value: 'birthday',
                        }
                    ])
            );
            
            await setupMessage.edit({ components: [freshMenu] });
            console.log('✅ تم تحديث منيو السيتب لإعادة تعيينه');
        }
    } catch (updateError) {
        console.error('❌ خطأ في تحديث منيو السيتب:', updateError);
    }

    // حذف رسالة الإيموجيات من المستخدم
    await message.delete().catch(() => {});
    
    // إرسال رد مخفي للمستخدم في الخاص
    try {
        let description = `**تم إرسال طلبك بنجاح!**\n\n${requestData.roomEmoji} نوع الروم : ${requestData.roomType}\n🎯 لـ: ${requestData.forWho}\n الموعد : ${requestData.when}\n لإيموجيات : ${emojis.join(' ')}`;
        
        if (requestData.imageUrl) {
            description += `\n🖼️ الصورة: مضافة`;
        }
        
        description += `\n\nسيتم مراجعة طلبك وإبلاغك بالنتيجة قريباً`;

        const replyEmbed = colorManager.createEmbed()
            .setTitle('**تم إرسال الطلب**')
            .setDescription(description)
            .setTimestamp();
        
        if (requestData.imageUrl) {
            replyEmbed.setImage(requestData.imageUrl);
        }
        
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
        await interaction.reply({ content: `**هذا الطلب تم ${request.status === 'accepted' ? 'قبوله' : 'رفضه'} مسبقاً**`, ephemeral: true });
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
            { name: ' الحالة', value: action === 'accept' ? 'تم القبول' : 'تم الرفض', inline: true },
            { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
        ]);

    await interaction.update({ embeds: [updatedEmbed], components: [] });

    // إرسال إشعار لصاحب الطلب
    try {
        const requester = await client.users.fetch(request.userId);
        const roomEmoji = request.roomTypeEn === 'condolence' ? '🖤' : '🎂';

        const notificationEmbed = colorManager.createEmbed()
            .setTitle(`${action === 'accept' ? '✅' : '❌'} **${action === 'accept' ? 'تم قبول' : 'تم رفض'} طلبك**`)
            .setDescription(`**طلب روم ${request.roomType}**\n\n${roomEmoji} لـ: ${request.forWho}\n الموعد: ${request.when}\n\n${action === 'accept' ? 'سيتم إنشاء الروم في الوقت المحدد' : 'تم رفض طلبك'}`)
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

        // استخراج اسم العرض (nickname) من forWho
        let displayName = request.forWho;
        
        // إذا كان منشن، جلب المعلومات من السيرفر
        const mentionMatch = request.forWho.match(/<@!?(\d+)>/);
        if (mentionMatch) {
            const userId = mentionMatch[1];
            try {
                const member = await guild.members.fetch(userId);
                // استخدام nickname إذا كان موجوداً، وإلا استخدام displayName
                displayName = member.nickname || member.user.displayName || member.user.username;
            } catch (err) {
                console.error('فشل في جلب معلومات المستخدم، استخدام النص الأصلي:', err);
                displayName = request.forWho.replace(/<@!?\d+>/g, '').trim() || 'مجهول';
            }
        }

        const roomName = `${request.roomTypeEn === 'condolence' ? 'تعزية' : 'hbd'}-${displayName.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '-')}`;

        // إنشاء الروم
        const channel = await guild.channels.create({
            name: roomName,
            type: ChannelType.GuildText,
            reason: `طلب من ${request.userId}`
        });

        console.log(`✅ تم إنشاء القناة: ${channel.name} (${channel.id})`);

        // إرسال الرسالة
        const roomEmbed = colorManager.createEmbed()
            .setTitle(`${request.roomTypeEn === 'condolence' ? 'تعزيه' : 'hbd'} **Room**`)
            .setDescription(request.message)
            .addFields([
                { name: 'لـ', value: request.forWho, inline: true },
                { name: 'بطلب من', value: `<@${request.userId}>`, inline: true }
            ])
            .setTimestamp();

        // إضافة الصورة إذا كانت موجودة
        if (request.imageUrl) {
            roomEmbed.setImage(request.imageUrl);
        }

        const sentMessage = await channel.send({ content: '@here', embeds: [roomEmbed] });
        console.log(`✅ تم إرسال رسالة الإمبد في الروم`);

        // حفظ معلومات الرسالة للحماية من الحذف
        roomEmbedMessages.set(channel.id, {
            messageId: sentMessage.id,
            channelId: channel.id,
            embed: roomEmbed,
            emojis: request.emojis || [],
            request: request
        });

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
        activeRooms.set(channel.id, {
            guildId: request.guildId,
            createdAt: Date.now(),
            emojis: emojis,
            requestId: request.id
        });
        saveActiveRooms();
        
        // جدولة حذف الروم بعد 12 ساعة
        scheduleRoomDeletion(channel.id, client);
        console.log(`✅ تم إنشاء روم ${request.roomType} بنجاح: ${roomName} (سيتم حذفها تلقائياً بعد 12 ساعة)`);
        
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


// تحليل الوقت
function parseScheduleTime(timeString) {
    const moment = require('moment-timezone');
    const now = moment().tz('Asia/Riyadh');

    // تنظيف المدخل
    const cleanTime = timeString.trim().toLowerCase();

    // الآن أو فوراً أو دحين أو الحين
    if (cleanTime.includes('الآن') || cleanTime.includes('فوراً') || cleanTime.includes('فورا') || 
        cleanTime.includes('دحين') || cleanTime.includes('الحين') || cleanTime.includes('حين') ||
        cleanTime.includes('توني') || cleanTime === 'الان') {
        return now.clone().add(1, 'second').toDate();
    }

    // بعد X ثانية
    const secondsMatch = cleanTime.match(/بعد\s+(\d+)\s*ثوان[يی]?|ثانية|بعد\s+ثانية/);
    if (secondsMatch) {
        const seconds = parseInt(secondsMatch[1] || 1);
        return now.clone().add(seconds, 'seconds').toDate();
    }

    // بعد X دقائق
    const minutesMatch = cleanTime.match(/بعد\s+(\d+)\s*دقائق?|دقيقة|بعد\s+دقيقة/);
    if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1] || 1);
        return now.clone().add(minutes, 'minutes').toDate();
    }

    // بعد X ساعات
    const hoursMatch = cleanTime.match(/بعد\s+(\d+)\s*ساعات?|ساعة|بعد\s+ساعة/);
    if (hoursMatch) {
        const hours = parseInt(hoursMatch[1] || 1);
        return now.clone().add(hours, 'hours').toDate();
    }

    // بعد X أيام
    const daysMatch = cleanTime.match(/بعد\s+(\d+)\s*أيام?|يوم|بعد\s+يوم/);
    if (daysMatch) {
        const days = parseInt(daysMatch[1] || 1);
        return now.clone().add(days, 'days').toDate();
    }

    // بكره (غداً) أو غدوة
    if (cleanTime.includes('بكره') || cleanTime.includes('بكرة') || cleanTime.includes('غدوة')) {
        const tomorrowMatch = cleanTime.match(/(\d+)\s*(صباحاً|مساءً|ص|م)?/);
        if (tomorrowMatch) {
            const hour = parseInt(tomorrowMatch[1]);
            const isPM = tomorrowMatch[2] && (tomorrowMatch[2].includes('مساء') || tomorrowMatch[2] === 'م');
            const targetHour = isPM && hour < 12 ? hour + 12 : hour;
            return now.clone().add(1, 'day').hour(targetHour).minute(0).second(0).millisecond(0).toDate();
        }
        return now.clone().add(1, 'day').hour(12).minute(0).second(0).millisecond(0).toDate();
    }

    // غداً أو غدا
    if (cleanTime.includes('غداً') || cleanTime.includes('غدا')) {
        const tomorrowMatch = cleanTime.match(/(\d+)\s*(صباحاً|مساءً|ص|م)?/);
        if (tomorrowMatch) {
            const hour = parseInt(tomorrowMatch[1]);
            const isPM = tomorrowMatch[2] && (tomorrowMatch[2].includes('مساء') || tomorrowMatch[2] === 'م');
            const targetHour = isPM && hour < 12 ? hour + 12 : hour;
            return now.clone().add(1, 'day').hour(targetHour).minute(0).second(0).millisecond(0).toDate();
        }
        return now.clone().add(1, 'day').hour(12).minute(0).second(0).millisecond(0).toDate();
    }

    // قبل شوي (بعد ساعة - كترجمة معكوسة)
    if (cleanTime.includes('قبل شوي') || cleanTime.includes('شوي')) {
        return now.clone().add(10, 'minutes').toDate();
    }

    // الساعة X
    const hourMatch = cleanTime.match(/(\d+)\s*(صباحاً|مساءً|ص|م)?/);
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
        if (message.author.bot) return;
        
        const roomData = activeRooms.get(message.channel.id);
        if (roomData && roomData.emojis && roomData.emojis.length > 0) {
            for (const reaction of roomData.emojis) {
                try {
                    await message.react(reaction);
                } catch (error) {
                    // محاولة استخدام آيدي الإيموجي إذا فشل
                    const emojiIdMatch = reaction.match(/<a?:\w+:(\d+)>/);
                    if (emojiIdMatch) {
                        try {
                            await message.react(emojiIdMatch[1]);
                        } catch (err) {
                            console.error('فشل في إضافة الريآكت التلقائي:', err.message);
                        }
                    }
                }
            }
        }
    });

    // معالج حذف الرسائل - لإعادة إرسال الإمبد
    client.on('messageDelete', async (message) => {
        try {
            // التحقق من أن الرسالة في روم محمي
            if (roomEmbedMessages.has(message.channel.id)) {
                const roomData = roomEmbedMessages.get(message.channel.id);
                
                // التحقق من أن الرسالة المحذوفة هي رسالة الإمبد
                if (message.id === roomData.messageId) {
                    console.log(`⚠️ تم حذف رسالة الإمبد في ${message.channel.name} - سيتم إعادة الإرسال بعد 5 ثواني`);

                    // الانتظار 5 ثواني ثم إعادة الإرسال
                    setTimeout(async () => {
                        try {
                            const channel = await client.channels.fetch(roomData.channelId);
                            if (!channel) return;

                            const newMessage = await channel.send({ 
                                content: '@here', 
                                embeds: [roomData.embed] 
                            });

                            console.log(`✅ تم إعادة إرسال رسالة الإمبد في ${channel.name}`);

                            // تحديث معلومات الرسالة
                            roomEmbedMessages.set(channel.id, {
                                ...roomData,
                                messageId: newMessage.id
                            });

                            // إعادة إضافة الريآكتات
                            for (const reaction of roomData.emojis) {
                                try {
                                    await newMessage.react(reaction);
                                } catch (error) {
                                    const emojiIdMatch = reaction.match(/<a?:\w+:(\d+)>/);
                                    if (emojiIdMatch) {
                                        try {
                                            await newMessage.react(emojiIdMatch[1]);
                                        } catch (err) {
                                            console.error('فشل في إضافة الريآكت:', err.message);
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            console.error('❌ فشل في إعادة إرسال الإمبد:', error);
                        }
                    }, 5000);
                }
            }

            // التحقق من أن الرسالة هي رسالة سيتب روم
            for (const [guildId, setupData] of setupEmbedMessages.entries()) {
                if (message.id === setupData.messageId && message.channel.id === setupData.channelId) {
                    console.log(`⚠️ تم حذف رسالة سيتب الروم - سيتم إعادة الإرسال بعد 5 ثواني`);

                    // الانتظار 5 ثواني ثم إعادة الإرسال
                    setTimeout(async () => {
                        try {
                            const channel = await client.channels.fetch(setupData.channelId);
                            if (!channel) return;

                            const finalEmbed = colorManager.createEmbed()
                                .setTitle('**Rooms**')
                                .setDescription('**اختر نوع الروم التي تريد طلبها :**')
                                .setImage(setupData.imageUrl)
                                .setFooter({ text: 'Rooms system' });

                            const menu = new ActionRowBuilder().addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId('room_type_menu')
                                    .setPlaceholder('اختر نوع الروم')
                                    .addOptions([
                                        {
                                            label: 'روم تعزيه',
                                            description: 'طلب روم عزاء',
                                            value: 'condolence',
                                        },
                                        {
                                            label: 'روم ميلاد',
                                            description: 'طلب روم hbd',
                                            value: 'birthday',
                                        }
                                    ])
                            );

                            const newMessage = await channel.send({ embeds: [finalEmbed], components: [menu] });

                            console.log(`✅ تم إعادة إرسال رسالة سيتب الروم`);

                            // تحديث معلومات الرسالة
                            setupEmbedMessages.set(guildId, {
                                messageId: newMessage.id,
                                channelId: channel.id,
                                embed: finalEmbed,
                                menu: menu,
                                imageUrl: setupData.imageUrl
                            });
                            
                            saveSetupEmbedMessages(setupEmbedMessages);

                        } catch (error) {
                            console.error('❌ فشل في إعادة إرسال رسالة سيتب الروم:', error);
                        }
                    }, 5000);
                    
                    break;
                }
            }

        } catch (error) {
            console.error('❌ خطأ في معالج حذف الرسائل:', error);
        }
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
        .setTitle('**إعداد نظام الرومات**')
        .setDescription('**الخطوة 1/3: منشن روم الطلبات**\n\nقم بعمل منشن للروم الذي سيتم إرسال الطلبات فيه\n\n**📌 دليل صيغ الوقت المدعومة:**\n```\n⏰ فوري:\n• الآن / فوراً / دحين / الحين / توني\n\n⏱️ ثواني/دقائق:\n• بعد 30 ثانية / بعد ثانية\n• بعد دقيقة / بعد 5 دقائق / دقيقتين\n\n🕐 ساعات:\n• بعد ساعة / بعد ساعتين / بعد 3 ساعات\n• 12 صباحاً / 5 مساءً / الساعة 8\n\n📅 أيام:\n• غداً / غدا / بكره / بكرة / غدوة\n• بكره الساعة 10 / غداً 5 مساءً\n• بعد يوم / بعد 3 أيام\n\n⏳ أخرى:\n• شوي (بعد 10 دقائق)```')
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
            .setTitle('**إعداد نظام الرومات**')
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
                .setTitle('**إعداد نظام الرومات**')
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
                        .setTitle('**Rooms**')
                        .setDescription('**اختر نوع الروم التي تريد طلبها :**')
                        .setImage(imageUrl)
                        .setFooter({ text: 'Rooms system' });

                    const menu = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('room_type_menu')
                            .setPlaceholder('اختر نوع الروم')
                            .addOptions([
                                {
                                    label: 'روم تعزيه',
                                    description: 'طلب روم عزاء',
                                    value: 'condolence',
                            
                                },
                                {
                                    label: 'روم ميلاد',
                                    description: 'طلب روم hbd',
                                    value: 'birthday',
                                    
                                }
                            ])
                    );

                    const setupMessage = await embedChannel.send({ embeds: [finalEmbed], components: [menu] });
                    console.log(`📤 تم إرسال setup embed للمرة الأولى - جاري التحقق...`);

                    // حفظ رسالة السيتب للحماية من الحذف
                    setupEmbedMessages.set(guildId, {
                        messageId: setupMessage.id,
                        channelId: embedChannel.id,
                        embed: finalEmbed,
                        menu: menu,
                        imageUrl: imageUrl
                    });
                    
                    saveSetupEmbedMessages(setupEmbedMessages);

                    // فحص فوري للتأكد من الإرسال (بعد ثانية واحدة)
                    setTimeout(async () => {
                        const isVerified = await verifySetupEmbed(guildId, setupMessage.id, embedChannel.id, client, 1);
                        if (isVerified) {
                            console.log(`✅ [فحص فوري] تأكيد نجاح إرسال setup embed في ${embedChannel.name}`);
                        } else {
                            console.error(`⚠️ [فحص فوري] فشل التحقق من setup embed - سيتم المحاولة مجدداً`);
                            await resendSetupEmbed(guildId, client);
                        }
                    }, 1000);

                    // جدولة فحص بعد 3 دقائق
                    scheduleSetupEmbedThreeMinuteCheck(guildId, setupMessage.id, embedChannel.id, client);

                    // جدولة فحوصات دورية كل 10 دقائق لمدة ساعة
                    scheduleSetupEmbedPeriodicChecks(guildId, setupMessage.id, embedChannel.id, client);

                    // رسالة نجاح
                    const successEmbed = colorManager.createEmbed()
                        .setTitle('✅ **تم الإعداد بنجاح**')
                        .setDescription(`**تم إعداد نظام الرومات بنجاح مع نظام الفحص المتقدم!**\n\n روم الطلبات : ${requestsChannel}\nروم الإيمبد : ${embedChannel}`)
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
    restoreSchedules,
    checkAndRestoreSetupEmbed,
    startContinuousSetupEmbedCheck
};