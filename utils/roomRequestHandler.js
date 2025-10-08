const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('./colorManager.js');
const { loadRoomConfig, loadRoomRequests, saveRoomRequests } = require('../commands/setroom.js');
const schedule = require('node-schedule');

// تخزين الجدولات النشطة
const activeSchedules = new Map();

// معالجة طلبات الغرف (الأزرار)
async function handleRoomRequestButton(interaction, client) {
    const roomType = interaction.customId === 'room_request_condolence' ? 'عزاء' : 'ميلاد';
    const roomTypeEn = interaction.customId === 'room_request_condolence' ? 'condolence' : 'birthday';

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

    const forWho = interaction.fields.getTextInputValue('for_who');
    const when = interaction.fields.getTextInputValue('when');
    const message = interaction.fields.getTextInputValue('message');

    const config = loadRoomConfig();
    const guildConfig = config[interaction.guild.id];

    if (!guildConfig) {
        await interaction.reply({ content: '❌ **لم يتم إعداد نظام الغرف بعد**', ephemeral: true });
        return;
    }

    // إنشاء الطلب
    const request = {
        id: `${Date.now()}_${interaction.user.id}`,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
        roomType: roomType,
        roomTypeEn: roomTypeEn,
        forWho: forWho,
        when: when,
        message: message,
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
        .setTitle(`${roomEmoji} **طلب روم ${roomType} جديد**`)
        .setDescription(`**تم استلام طلب جديد:**`)
        .addFields([
            { name: '👤 صاحب الطلب', value: `<@${interaction.user.id}>`, inline: true },
            { name: '🎯 لمن؟', value: forWho, inline: true },
            { name: '⏰ موعد الإنشاء', value: when, inline: true },
            { name: '💬 الرسالة', value: message, inline: false },
            { name: '🆔 معرف الطلب', value: `\`${request.id}\``, inline: false }
        ])
        .setTimestamp()
        .setFooter({ text: `طلب من ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

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

    // رد على المستخدم
    const replyEmbed = colorManager.createEmbed()
        .setTitle('✅ **تم إرسال الطلب**')
        .setDescription(`**تم إرسال طلبك بنجاح!**\n\n${roomEmoji} نوع الروم: ${roomType}\n🎯 لـ: ${forWho}\n⏰ الموعد: ${when}\n\nسيتم مراجعة طلبك وإبلاغك بالنتيجة قريباً`)
        .setTimestamp();

    await interaction.reply({ embeds: [replyEmbed], ephemeral: true });
}

// معالجة قبول/رفض الطلب
async function handleRoomRequestAction(interaction, client) {
    const action = interaction.customId.startsWith('room_accept') ? 'accept' : 'reject';
    const requestId = interaction.customId.split('_')[2];

    // التحقق من الصلاحيات
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ **ليس لديك صلاحية لهذا الإجراء**', ephemeral: true });
        return;
    }

    const requests = loadRoomRequests();
    const requestIndex = requests.findIndex(r => r.id === requestId);

    if (requestIndex === -1) {
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

    if (!guildConfig) return;

    // تحليل الوقت (هنا يمكن تحسين التحليل)
    const scheduleTime = parseScheduleTime(request.when);
    
    if (!scheduleTime) {
        console.error('فشل في تحليل الوقت:', request.when);
        return;
    }

    // جدولة المهمة
    const job = schedule.scheduleJob(scheduleTime, async () => {
        await createRoom(request, client, guildConfig);
        activeSchedules.delete(request.id);
    });

    activeSchedules.set(request.id, job);
    console.log(`✅ تم جدولة إنشاء روم ${request.roomType} للوقت: ${scheduleTime}`);
}

// إنشاء الروم
async function createRoom(request, client, guildConfig) {
    try {
        const guild = await client.guilds.fetch(request.guildId);
        const roomName = `${request.roomTypeEn === 'condolence' ? '🖤' : '🎂'}-${request.forWho.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '-')}`;

        // إنشاء الروم
        const channel = await guild.channels.create({
            name: roomName,
            type: ChannelType.GuildText,
            reason: `طلب من ${request.userId}`
        });

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

        // إضافة الريآكتات
        for (const reaction of guildConfig.reactions) {
            try {
                await sentMessage.react(reaction);
            } catch (error) {
                console.error('خطأ في إضافة الريآكت:', error);
            }
        }

        // إعداد نظام الريآكت التلقائي
        setupAutoReact(channel.id, guildConfig.reactions, client);

        console.log(`✅ تم إنشاء روم ${request.roomType}: ${roomName}`);
    } catch (error) {
        console.error('خطأ في إنشاء الروم:', error);
    }
}

// إعداد نظام الريآكت التلقائي
function setupAutoReact(channelId, reactions, client) {
    client.on('messageCreate', async (message) => {
        if (message.channel.id === channelId && !message.author.bot) {
            for (const reaction of reactions) {
                try {
                    await message.react(reaction);
                } catch (error) {
                    console.error('خطأ في إضافة الريآكت التلقائي:', error);
                }
            }
        }
    });
}

// تحليل الوقت
function parseScheduleTime(timeString) {
    const now = new Date();
    
    // بعد X ساعات
    const hoursMatch = timeString.match(/بعد\s+(\d+)\s*ساعات?/);
    if (hoursMatch) {
        const hours = parseInt(hoursMatch[1]);
        return new Date(now.getTime() + hours * 60 * 60 * 1000);
    }

    // بعد X دقائق
    const minutesMatch = timeString.match(/بعد\s+(\d+)\s*دقائق?|دقيقة/);
    if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1] || 1);
        return new Date(now.getTime() + minutes * 60 * 1000);
    }

    // الساعة X
    const hourMatch = timeString.match(/(\d+)\s*(صباحاً|مساءً|ص|م)?/);
    if (hourMatch) {
        const hour = parseInt(hourMatch[1]);
        const isPM = hourMatch[2] && (hourMatch[2].includes('مساء') || hourMatch[2] === 'م');
        const targetHour = isPM && hour < 12 ? hour + 12 : hour;
        
        const targetDate = new Date(now);
        targetDate.setHours(targetHour, 0, 0, 0);
        
        // إذا كان الوقت قد مضى، اجعله غداً
        if (targetDate <= now) {
            targetDate.setDate(targetDate.getDate() + 1);
        }
        
        return targetDate;
    }

    // غداً
    if (timeString.includes('غداً') || timeString.includes('غدا')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(12, 0, 0, 0);
        return tomorrow;
    }

    // الآن أو فوراً
    if (timeString.includes('الآن') || timeString.includes('فوراً') || timeString.includes('فورا')) {
        return new Date(now.getTime() + 1000); // بعد ثانية واحدة
    }

    // افتراضياً: بعد ساعة
    return new Date(now.getTime() + 60 * 60 * 1000);
}

module.exports = {
    handleRoomRequestButton,
    handleRoomModalSubmit,
    handleRoomRequestAction,
    setupAutoReact
};
