const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');

const DATA_FILES = {
    responsibilities: path.join(__dirname, '..', 'data', 'responsibilities.json'),
    respConfig: path.join(__dirname, '..', 'data', 'respConfig.json')
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

// متغير لتخزين رسائل الايمبد (دعم عدة سيرفرات)
let embedMessages = new Map(); // guildId -> { messageId, channelId, message }

// دالة لإنشاء الايمبد
function createResponsibilitiesEmbed(responsibilities) {
    const embed = colorManager.createEmbed()
        .setTitle('المسؤوليات');
    
    if (Object.keys(responsibilities).length === 0) {
        embed.setDescription('لا توجد مسؤوليات محددة حالياً');
    } else {
        let description = '';
        for (const [respName, respData] of Object.entries(responsibilities)) {
            description += `**المسؤولية :** ${respName}\n`;
            if (respData.responsibles && respData.responsibles.length > 0) {
                const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' ، ');
                description += `**المسؤولين :** ${responsiblesList}\n\n`;
            } else {
                description += `**المسؤولين :** لا يوجد مسؤولين\n\n`;
            }
        }
        embed.setDescription(description);
    }
    
    return embed;
}

// دالة لإنشاء الزر
function createSuggestionButton() {
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('suggestion_button')
                .setLabel('اقتراحات')
                .setStyle(ButtonStyle.Primary)
        );
    return row;
}

// دالة لتحديث جميع رسائل الايمبد
async function updateEmbedMessage(client) {
    const responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
    const newEmbed = createResponsibilitiesEmbed(responsibilities);
    const button = createSuggestionButton();
    
    for (const [guildId, embedData] of embedMessages.entries()) {
        try {
            if (embedData.message) {
                await embedData.message.edit({
                    embeds: [newEmbed],
                    components: [button]
                });
                console.log(`تم تحديث رسالة المسؤوليات في السيرفر ${guildId}`);
            } else if (embedData.messageId && embedData.channelId) {
                // إعادة بناء مرجع الرسالة
                const channel = await client.channels.fetch(embedData.channelId);
                const message = await channel.messages.fetch(embedData.messageId);
                await message.edit({
                    embeds: [newEmbed],
                    components: [button]
                });
                embedData.message = message;
                console.log(`تم إعادة بناء وتحديث رسالة المسؤوليات في السيرفر ${guildId}`);
            }
        } catch (error) {
            console.error(`خطأ في تحديث رسالة المسؤوليات للسيرفر ${guildId}:`, error);
            // إزالة البيانات التالفة
            embedMessages.delete(guildId);
            updateStoredEmbedData();
        }
    }
}

// دالة للتعامل مع زر الاقتراحات
async function handleSuggestionButton(interaction, client) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('suggestion_modal')
            .setTitle('اقتراح جديد');

        const suggestionInput = new TextInputBuilder()
            .setCustomId('suggestion_text')
            .setLabel('اقتراحك')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('اكتب اقتراحك هنا...')
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(suggestionInput);
        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    } catch (error) {
        console.error('خطأ في عرض مودال الاقتراح:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'حدث خطأ في عرض نموذج الاقتراح',
                ephemeral: true
            });
        }
    }
}

// دالة للتعامل مع مودال الاقتراح
async function handleSuggestionModal(interaction, client) {
    try {
        const suggestionText = interaction.fields.getTextInputValue('suggestion_text');
        const guildId = interaction.guild.id;
        
        // قراءة الكونفيغ مباشرة من الملف
        const config = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
        
        if (!config.guilds[guildId] || !config.guilds[guildId].suggestionsChannel) {
            await interaction.reply({
                content: 'لم يتم تحديد قناة الاقتراحات بعد',
                ephemeral: true
            });
            return;
        }
        
        const channel = await client.channels.fetch(config.guilds[guildId].suggestionsChannel);
        
        // تأكيد أن القناة تنتمي لنفس السيرفر
        if (!channel || channel.guild.id !== guildId) {
            await interaction.reply({
                content: 'قناة الاقتراحات غير موجودة أو غير صحيحة',
                ephemeral: true
            });
            return;
        }
        
        // إنشاء إيمبد الاقتراح بتنسيق محسن
        const suggestionEmbed = colorManager.createEmbed()
            .setTitle('اقتراح')
            .setDescription(`**اقتراح من:** <@${interaction.user.id}>\n\n**الاقتراح:**\n${suggestionText}`)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: `معرف المقترح: ${interaction.user.id}` });
        
        await channel.send({ embeds: [suggestionEmbed] });
        
        await interaction.reply({
            content: 'تم إرسال اقتراحك بنجاح',
            ephemeral: true
        });
        
    } catch (error) {
        console.error('خطأ في إرسال الاقتراح:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'حدث خطأ في إرسال الاقتراح',
                ephemeral: true
            });
        }
    }
}

module.exports = {
    name: 'resp',
    description: 'عرض المسؤوليات وإعداد نظام الاقتراحات',
    
    // تهيئة النظام عند بدء التشغيل
    initialize(client) {
        loadEmbedData(client);
    },
    
    async execute(message, args, context) {
        const { client } = context;
        
        // فحص إذا كان المستخدم مالكًا
        const botConfig = readJSONFile(path.join(__dirname, '..', 'data', 'botConfig.json'), {});
        const BOT_OWNERS = botConfig.owners || [];
        const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

        if (!isOwner) {
            await message.react('❌');
            return;
        }

        const guildId = message.guild.id;
        const config = getGuildConfig(guildId);
        const guildConfig = config.guilds[guildId];
        
        // التحقق من وجود قناة الاقتراحات
        if (!guildConfig.suggestionsChannel) {
            await message.channel.send('منشن روم الاقتراحات');
            
            // انتظار منشن القناة
            const channelCollector = message.channel.createMessageCollector({
                filter: m => m.author.id === message.author.id && m.mentions.channels.size > 0,
                time: 60000,
                max: 1
            });
            
            channelCollector.on('collect', async (msg) => {
                const suggestionsChannel = msg.mentions.channels.first();
                
                // تأكيد أن القناة تنتمي لنفس السيرفر
                if (suggestionsChannel.guild.id !== guildId) {
                    await msg.channel.send('يجب اختيار قناة من نفس السيرفر');
                    return;
                }
                
                setGuildConfig(guildId, { suggestionsChannel: suggestionsChannel.id });
                
                await msg.channel.send('منشن روم الايمبد');
                
                // انتظار منشن روم الايمبد
                const embedCollector = msg.channel.createMessageCollector({
                    filter: m => m.author.id === message.author.id && m.mentions.channels.size > 0,
                    time: 60000,
                    max: 1
                });
                
                embedCollector.on('collect', async (embedMsg) => {
                    const embedChannel = embedMsg.mentions.channels.first();
                    
                    // تأكيد أن القناة تنتمي لنفس السيرفر
                    if (embedChannel.guild.id !== guildId) {
                        await embedMsg.channel.send('يجب اختيار قناة من نفس السيرفر');
                        return;
                    }
                    
                    setGuildConfig(guildId, { embedChannel: embedChannel.id });
                    
                    // إرسال الايمبد
                    await sendResponsibilitiesEmbed(embedChannel, client);
                });
                
                embedCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        msg.channel.send('انتهت مهلة الانتظار لمنشن روم الايمبد');
                    }
                });
            });
            
            channelCollector.on('end', (collected) => {
                if (collected.size === 0) {
                    message.channel.send('انتهت مهلة الانتظار لمنشن روم الاقتراحات');
                }
            });
            
        } else if (!guildConfig.embedChannel) {
            await message.channel.send('منشن روم الايمبد');
            
            const embedCollector = message.channel.createMessageCollector({
                filter: m => m.author.id === message.author.id && m.mentions.channels.size > 0,
                time: 60000,
                max: 1
            });
            
            embedCollector.on('collect', async (msg) => {
                const embedChannel = msg.mentions.channels.first();
                
                // تأكيد أن القناة تنتمي لنفس السيرفر
                if (embedChannel.guild.id !== guildId) {
                    await msg.channel.send('يجب اختيار قناة من نفس السيرفر');
                    return;
                }
                
                setGuildConfig(guildId, { embedChannel: embedChannel.id });
                
                await sendResponsibilitiesEmbed(embedChannel, client);
            });
            
            embedCollector.on('end', (collected) => {
                if (collected.size === 0) {
                    message.channel.send('انتهت مهلة الانتظار لمنشن روم الايمبد');
                }
            });
            
        } else {
            // إذا كانت القنوات محددة، أرسل الايمبد مباشرة
            try {
                const embedChannel = await client.channels.fetch(guildConfig.embedChannel);
                if (embedChannel && embedChannel.guild.id === guildId) {
                    await sendResponsibilitiesEmbed(embedChannel, client);
                } else {
                    await message.channel.send('روم الايمبد المحدد غير موجود أو غير صحيح، منشن روم جديد للايمبد');
                }
            } catch (error) {
                console.error('خطأ في جلب قناة الايمبد:', error);
                await message.channel.send('حدث خطأ في جلب روم الايمبد، منشن روم جديد للايمبد');
            }
        }
    },
    
    // دوال مساعدة
    updateEmbedMessage,
    handleSuggestionButton,
    handleSuggestionModal,
    initialize: (client) => loadEmbedData(client)
};

// دوال إدارة الإعدادات لكل سيرفر
function getGuildConfig(guildId) {
    const config = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
    if (!config.guilds) config.guilds = {};
    if (!config.guilds[guildId]) {
        config.guilds[guildId] = {
            suggestionsChannel: null,
            embedChannel: null,
            embedData: null
        };
    }
    return config;
}

function setGuildConfig(guildId, updates) {
    const config = getGuildConfig(guildId);
    Object.assign(config.guilds[guildId], updates);
    writeJSONFile(DATA_FILES.respConfig, config);
    return config;
}

// دالة لحفظ بيانات الايمبد في الكونفيغ
function updateStoredEmbedData() {
    for (const [guildId, embedData] of embedMessages.entries()) {
        setGuildConfig(guildId, {
            embedData: {
                messageId: embedData.messageId,
                channelId: embedData.channelId
            }
        });
    }
}

// دالة لتحميل بيانات الايمبد عند بدء التشغيل
function loadEmbedData(client) {
    try {
        const config = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
        if (config.guilds) {
            for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
                if (guildConfig.embedData) {
                    embedMessages.set(guildId, {
                        messageId: guildConfig.embedData.messageId,
                        channelId: guildConfig.embedData.channelId,
                        message: null // سيتم إعادة بنائه عند الحاجة
                    });
                }
            }
            console.log(`تم تحميل ${embedMessages.size} رسالة ايمبد مسؤوليات`);
        }
    } catch (error) {
        console.error('خطأ في تحميل بيانات الايمبد:', error);
    }
}

// دالة لإرسال ايمبد المسؤوليات
async function sendResponsibilitiesEmbed(channel, client) {
    try {
        const responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
        const embed = createResponsibilitiesEmbed(responsibilities);
        const button = createSuggestionButton();
        
        const message = await channel.send({
            embeds: [embed],
            components: [button]
        });
        
        // حفظ مرجع للرسالة
        const guildId = channel.guild.id;
        embedMessages.set(guildId, {
            messageId: message.id,
            channelId: channel.id,
            message: message
        });
        
        // حفظ البيانات في الكونفيغ
        updateStoredEmbedData();
        
        console.log('تم إرسال ايمبد المسؤوليات بنجاح');
        
    } catch (error) {
        console.error('خطأ في إرسال ايمبد المسؤوليات:', error);
    }
}