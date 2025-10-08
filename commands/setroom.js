const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const fs = require('fs');
const path = require('path');

const name = 'setroom';

// مسار ملف إعدادات الغرف
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');
const roomRequestsPath = path.join(__dirname, '..', 'data', 'roomRequests.json');

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
        .setDescription('**الخطوة 1/4: منشن روم الطلبات**\n\nقم بعمل منشن للروم الذي سيتم إرسال الطلبات فيه')
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
            .setDescription('**الخطوة 2/4: منشن روم الإيمبد**\n\nقم بعمل منشن للروم الذي سيتم إرسال الإيمبد فيه')
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
                .setDescription('**الخطوة 3/4: أرسل الصورة**\n\nأرسل الصورة (إرفاق أو رابط)')
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

                // الخطوة 4: طلب الريآكتات
                const step4Embed = colorManager.createEmbed()
                    .setTitle('📝 **إعداد نظام الغرف**')
                    .setDescription('**الخطوة 4/4: أرسل الريآكتات**\n\nأرسل الإيموجيات التي تريد إضافتها كريآكتات (افصلها بمسافات)')
                    .setFooter({ text: 'لديك 60 ثانية للرد' });

                await message.channel.send({ embeds: [step4Embed] });

                const collector4 = message.channel.createMessageCollector({ filter, time: 60000, max: 1 });

                collector4.on('collect', async (msg4) => {
                    const reactions = msg4.content.split(/\s+/).filter(r => r.trim());
                    
                    if (reactions.length === 0) {
                        await message.channel.send('❌ **لم يتم العثور على إيموجيات. حاول مرة أخرى**');
                        return;
                    }

                    // حفظ الإعدادات
                    const config = loadRoomConfig();
                    config[guildId] = {
                        requestsChannelId: requestsChannel.id,
                        embedChannelId: embedChannel.id,
                        imageUrl: imageUrl,
                        reactions: reactions,
                        setupBy: message.author.id,
                        setupAt: Date.now()
                    };

                    if (saveRoomConfig(config)) {
                        // إرسال الإيمبد في روم الإيمبد
                        const finalEmbed = colorManager.createEmbed()
                            .setTitle('🏠 **نظام طلبات الغرف**')
                            .setDescription('**اختر نوع الغرفة التي تريد طلبها:**')
                            .setImage(imageUrl)
                            .setFooter({ text: 'اضغط على الزر المناسب لبدء الطلب' });

                        const buttons = new ActionRowBuilder().addComponents([
                            new ButtonBuilder()
                                .setCustomId('room_request_condolence')
                                .setLabel('روم عزاء')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('🖤'),
                            new ButtonBuilder()
                                .setCustomId('room_request_birthday')
                                .setLabel('روم ميلاد')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('🎂')
                        ]);

                        const embedMessage = await embedChannel.send({ embeds: [finalEmbed], components: [buttons] });

                        // إضافة الريآكتات
                        for (const reaction of reactions) {
                            try {
                                await embedMessage.react(reaction);
                            } catch (error) {
                                console.error('خطأ في إضافة الريآكت:', error);
                            }
                        }

                        // رسالة نجاح
                        const successEmbed = colorManager.createEmbed()
                            .setTitle('✅ **تم الإعداد بنجاح**')
                            .setDescription(`**تم إعداد نظام الغرف بنجاح!**\n\n📝 روم الطلبات: ${requestsChannel}\n📊 روم الإيمبد: ${embedChannel}\n🎭 عدد الريآكتات: ${reactions.length}`)
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
    });
}

module.exports = { 
    name,
    execute,
    loadRoomConfig,
    saveRoomConfig,
    loadRoomRequests,
    saveRoomRequests
};
