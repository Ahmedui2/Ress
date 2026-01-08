const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');

// نظام الكولداون
const applyCooldowns = new Map();
const COOLDOWN_TIME = 30 * 60 * 1000; // 30 دقيقة بالملي ثانية

const DATA_FILES = {
    responsibilities: path.join(__dirname, '..', 'data', 'responsibilities.json'),
    respConfig: path.join(__dirname, '..', 'data', 'respConfig.json'),
    categories: path.join(__dirname, '..', 'data', 'respCategories.json')
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
        .setTitle('Responsibilities');
    
    const currentResps = global.responsibilities || responsibilities;
    const categories = readJSONFile(DATA_FILES.categories, {});
    
    if (Object.keys(currentResps).length === 0 && Object.keys(categories).length === 0) {
        embed.setDescription('لا توجد مسؤوليات محددة حالياً');
        return embed;
    }
    
    let description = '';
    
    if (Object.keys(categories).length > 0) {
        const sortedCategories = Object.entries(categories).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
        
        for (const [catName, catData] of sortedCategories) {
            description += `\n**# ${catName} Category**\n\n`;    
            const categoryResps = catData.responsibilities || [];
            
            if (categoryResps.length === 0) {
                description += `*No Res*\n\n`;
            } else {
                for (const respName of categoryResps) {
                    const respData = currentResps[respName];
                    if (respData) {
                        description += `** المسؤوليه : ال${respName}**\n`;
                        
                        if (respData.responsibles && respData.responsibles.length > 0) {
                            const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' , ');
                            description += `- **المسؤولين : ${responsiblesList}**\n\n`;
                        } else {
                            description += `- ** المسؤولين : N/A **\n\n`;
                        }
                    }
                }
            }
        }
        
        const uncategorizedResps = Object.keys(currentResps).filter(respName => {
            return !sortedCategories.some(([_, catData]) => 
                catData.responsibilities && catData.responsibilities.includes(respName)
            );
        });
        
        if (uncategorizedResps.length > 0) {
            description += `\n**# No categories**\n\n`;
            
            for (const respName of uncategorizedResps) {
                const respData = currentResps[respName];
                description += `**المسؤوليه : ال${respName}**\n`;
                
                if (respData.responsibles && respData.responsibles.length > 0) {
                    const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' , ');
                    description += `- **المسؤولين : ${responsiblesList}**\n\n`;
                } else {
                    description += `- ** المسؤولين : N/A **\n\n`;
                }
            }
        }
    } else {
        const sortedKeys = Object.keys(currentResps).sort((a, b) => (currentResps[a].order || 0) - (currentResps[b].order || 0));
        for (const respName of sortedKeys) {
            const respData = currentResps[respName];
            description += `**المسؤوليه : ال${respName}**\n`;
            
            if (respData.responsibles && respData.responsibles.length > 0) {
                const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' , ');
                description += `- **المسؤولين : ${responsiblesList}**\n\n`;
            } else {
                description += `- ** المسؤولين : N/A **\n\n`;
            }
        }
    }
    
    embed.setDescription(description);
    return embed;
}

// دالة لإنشاء رسالة نصية للمسؤوليات
function createResponsibilitiesText(responsibilities) {
    const currentResps = global.responsibilities || responsibilities;
    const categories = readJSONFile(DATA_FILES.categories, {});
    
    if (Object.keys(currentResps).length === 0 && Object.keys(categories).length === 0) {
        return '**Responsibilities**\n\nلا توجد مسؤوليات محددة حالياً';
    }
    let text = '**Responsibilities**\n';
    
    if (Object.keys(categories).length > 0) {
        const sortedCategories = Object.entries(categories).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
        
        for (const [catName, catData] of sortedCategories) {
            text += `\n**# ${catName} Category**\n\n`;    
            const categoryResps = catData.responsibilities || [];
            
            if (categoryResps.length === 0) {
                text += `*No Res*\n\n`;
            } else {
                for (const respName of categoryResps) {
                    const respData = currentResps[respName];
                    if (respData) {
                        text += `**المسؤوليه : ال${respName}**\n`;
                        
                        if (respData.responsibles && respData.responsibles.length > 0) {
                            const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' , ');
                            text += `- **المسؤولين : ${responsiblesList}**\n\n`;
                        } else {
                            text += `- ** المسؤولين : N/A **\n\n`;
                        }
                    }
                }
            }
        }
        
        const uncategorizedResps = Object.keys(currentResps).filter(respName => {
            return !sortedCategories.some(([_, catData]) => 
                catData.responsibilities && catData.responsibilities.includes(respName)
            );
        });
        
        if (uncategorizedResps.length > 0) {
            text += `\n**# No categories**\n\n`;
            
            for (const respName of uncategorizedResps) {
                const respData = currentResps[respName];
                text += `**المسؤوليه : ال${respName}**\n`;
                
                if (respData.responsibles && respData.responsibles.length > 0) {
                    const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join(' , ');
                    text += `- **المسؤولين  : ${responsiblesList}**\n\n`;
                } else {
                    text += `- **المسؤولين : N/A **\n\n`;
                }
            }
        }
    } else {
        const sortedKeys = Object.keys(currentResps).sort((a, b) => (currentResps[a].order || 0) - (currentResps[b].order || 0));
        for (const respName of sortedKeys) {
            const respData = currentResps[respName];
            text += `**المسؤوليه : ال${respName}**\n`;
            
            if (respData.responsibles && respData.responsibles.length > 0) {
                const responsiblesList = respData.responsibles.map(id => `<@${id}>`).join('  ,  ');
                text += `- **المسؤولين : ${responsiblesList}**\n\n`;
            } else {
                text += `- ** المسؤولين : N/A **\n\n`;
            }
        }
    }
    
    return text;
}
function splitText(text, maxLength = 2000) {

    const parts = [];

    let current = '';

    for (const line of text.split('\n')) {

        if ((current + line + '\n').length > maxLength) {

            parts.push(current);

            current = '';

        }

        current += line + '\n';

    }

    if (current.trim()) parts.push(current);

    return parts;

}

// دالة لإنشاء الأزرار والمنيو
function createSuggestionComponents() {
    const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
    const components = [];
    
    // إنشاء منيو المسؤوليات إذا وجدت
    if (Object.keys(currentResps).length > 0) {
        // ترتيب المسؤوليات حسب الـ order
        const sortedResps = Object.entries(currentResps)
            .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
            .slice(0, 25); // حد أقصى 25 خيار
        
        const options = sortedResps.map(([name, data]) => ({
            label: name.length > 100 ? name.slice(0, 97) + '...' : name,
            value: name.length > 100 ? name.slice(0, 100) : name
        }));
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('resp_info_select')
            .setPlaceholder('اختر مسؤولية لعرض تفاصيلها')
            .addOptions(options);
        
        const menuRow = new ActionRowBuilder().addComponents(selectMenu);
        components.push(menuRow);
    }
    
    // زر الاقتراحات وطلب المسؤولية
    const buttonRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('suggestion_button')
                .setLabel('أقتراح')
                .setEmoji('<:emoji_72:1442588665913151619>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('apply_resp_button')
                .setLabel('طلب مسؤولية')
                .setEmoji('<:emoji_19:1457493164826034186> ')
                .setStyle(ButtonStyle.Secondary)
        );
    components.push(buttonRow);
    
    return components;
}

// دالة قديمة للتوافقية
function createSuggestionButton() {
    return createSuggestionComponents();
}

// دالة لتحديث جميع رسائل الايمبد
async function updateEmbedMessage(client) {
    try {
        const { dbManager } = require('../utils/database.js');
        const responsibilities = await dbManager.getResponsibilities();
        
        const newEmbed = createResponsibilitiesEmbed(responsibilities);
        const newText = createResponsibilitiesText(responsibilities);
        const components = createSuggestionComponents();
        
        for (const [guildId, embedData] of embedMessages.entries()) {
            try {
                // جلب نوع الرسالة من الكونفيغ
                const config = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
                const format = config.guilds[guildId]?.messageFormat || embedData.format || 'embed';
                
                let editOptions;
                if (format === 'text') {
                    editOptions = {
                        content: newText,
                        embeds: [],
                        components: components
                    };
                } else {
                    editOptions = {
                        content: null,
                        embeds: [newEmbed],
                        components: components
                    };
                }
                
                if (embedData.message) {
                    await embedData.message.edit(editOptions);
                    console.log(`تم تحديث رسالة المسؤوليات في السيرفر ${guildId} (${format})`);
                } else if (embedData.messageId && embedData.channelId) {
                    // إعادة بناء مرجع الرسالة
                    const channel = await client.channels.fetch(embedData.channelId);
                    const message = await channel.messages.fetch(embedData.messageId);
                    await message.edit(editOptions);
                    embedData.message = message;
                    console.log(`تم إعادة بناء وتحديث رسالة المسؤوليات في السيرفر ${guildId} (${format})`);
                }
            } catch (error) {
                console.error(`خطأ في تحديث رسالة المسؤوليات للسيرفر ${guildId}:`, error);
            }
        }
    } catch (error) {
        console.error('خطأ في جلب المسؤوليات من قاعدة البيانات:', error);
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
                content: 'لم يتم تحديد روم الاقتراحات بعد',
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
            .setTitle('Suggest')
            .setDescription(`**اقتراح من :** <@${interaction.user.id}>\n\n**الاقتراح :**\n${suggestionText}`)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: `اي دي المقترح : ${interaction.user.id}` });
        
        await channel.send({ embeds: [suggestionEmbed] });
        
        await interaction.reply({
            content: 'Done ✅️',
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

// دالة للتعامل مع اختيار مسؤولية من المنيو
async function handleResponsibilitySelect(interaction, client) {
    try {
        // فحص حالة التفاعل قبل البدء
        if (interaction.replied || interaction.deferred) return;

        // Defer immediately to prevent "Unknown Interaction" error
        await interaction.deferReply({ ephemeral: true });
        
        const selectedResp = interaction.values[0];
        const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
        
        if (!currentResps[selectedResp]) {
            await interaction.editReply({
                content: '**المسؤولية غير موجودة!**'
            });
            return;
        }
        
        const respData = currentResps[selectedResp];
        
        // إنشاء إيمبد منظم
        const embed = colorManager.createEmbed()
            .setTitle(`معلومات المسؤولية : ${selectedResp}`)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setTimestamp()
            .setFooter({ text: `طلب بواسطة : ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) });
        
        // إضافة الحقول
        let fields = [];
        
        // حقل الاختصار
        if (respData.mentShortcut) {
            const prefix = respData.mentPrefix || '-';
            fields.push({
                name: ' الاختصار',
                value: `\`${prefix}${respData.mentShortcut}\``,
                inline: true
            });
        }
        
        // حقل للأدمن فقط
        if (respData.mentShortcut) {
            fields.push({
                name: 'الاختصار للادمن بس؟',
                value: respData.mentAdminOnly ? 'نعم' : 'لا',
                inline: true
            });
        }
        
        // حقل الشرح - مع دعم الأوصاف الطويلة
        if (respData.description && respData.description.trim()) {
            const desc = respData.description;
            const maxFieldLength = 1024;
            
            if (desc.length > maxFieldLength) {
                // تقسيم الشرح الطويل إلى عدة حقول
                let descriptionParts = [];
                let currentPart = '';
                const words = desc.split(' ');
                
                for (const word of words) {
                    if ((currentPart + ' ' + word).length > maxFieldLength) {
                        if (currentPart) descriptionParts.push(currentPart);
                        currentPart = word;
                    } else {
                        currentPart += (currentPart ? ' ' : '') + word;
                    }
                }
                if (currentPart) descriptionParts.push(currentPart);
                
                // إضافة كل جزء كـ field منفصل
                descriptionParts.forEach((part, index) => {
                    fields.push({
                        name: index === 0 ? 'شرح المسؤوليه' : `شرح المسؤوليه (${index + 1})`,
                        value: part,
                        inline: false
                    });
                });
            } else {
                fields.push({
                    name: 'شرح المسؤوليه',
                    value: desc,
                    inline: false
                });
            }
        }
        
        // حقل المسؤولين - مع تحسين التعامل مع الأعداد الكبيرة
        if (respData.responsibles && respData.responsibles.length > 0) {
            // عرض أول 10 مسؤولين فقط إذا كان العدد كبير
            const maxResponsibles = 10;
            const responsibleSlice = respData.responsibles.slice(0, maxResponsibles);
            let responsiblesList = responsibleSlice.map((id, index) => `${index + 1}. <@${id}>`).join('\n');
            
            // إذا كان هناك أكثر من 10، أضف ملاحظة
            if (respData.responsibles.length > maxResponsibles) {
                responsiblesList += `\n\n**+${respData.responsibles.length - maxResponsibles} آخرين**`;
            }
            
            // تأكد من أن الـ value لا يتجاوز 1024 حرف
            if (responsiblesList.length > 1024) {
                responsiblesList = responsiblesList.slice(0, 1000) + '\n**...(انظر المزيد)**';
            }
            
            fields.push({
                name: ` المسؤولين : (${respData.responsibles.length})`,
                value: responsiblesList,
                inline: false
            });
        } else {
            fields.push({
                name: ' المسؤولين',
                value: 'لا يوجد مسؤولين معينين',
                inline: false
            });
        }
        
        // إضافة الحقول للإيمبد
        if (fields.length > 0) {
            embed.addFields(fields);
        }
        
        await interaction.editReply({
            embeds: [embed]
        });
        
    } catch (error) {
        console.error('خطأ في عرض معلومات المسؤولية:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'حدث خطأ في عرض معلومات المسؤولية',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'حدث خطأ في عرض معلومات المسؤولية'
                });
            }
        } catch (replyError) {
            console.error('فشل في الرد على الـ interaction:', replyError);
        }
    }
}

// دالة للتعامل مع زر طلب المسؤولية
async function handleApplyRespButton(interaction, client) {
    try {
        if (interaction.replied || interaction.deferred) return;

        // التحقق من الكولداون
        const lastApply = applyCooldowns.get(interaction.user.id);
        if (lastApply) {
            const timeLeft = lastApply + COOLDOWN_TIME - Date.now();
            if (timeLeft > 0) {
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);
                return await interaction.reply({
                    content: `⏳ **يجب عليك الانتظار ${minutes}د و ${seconds}ث قبل تقديم طلب آخر أو اختيار مسؤولية أخرى.**`,
                    ephemeral: true
                });
            }
        }

        const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
        
        if (Object.keys(currentResps).length === 0) {
            return await interaction.reply({
                content: 'لا توجد مسؤوليات متاحة للتقديم عليها حالياً',
                ephemeral: true
            });
        }

        const sortedResps = Object.entries(currentResps)
            .sort((a, b) => (a[1].order || 0) - (b[1].order || 0))
            .slice(0, 25);
        
        const options = sortedResps.map(([name, data]) => {
            const isAlreadyResponsible = data.responsibles && data.responsibles.includes(interaction.user.id);
            return {
                label: name,
                value: name,
                description: isAlreadyResponsible ? 'أنت بالفعل مسؤول في هذه المسؤولية' : `عدد المسؤولين : ${data.responsibles ? data.responsibles.length : 0}`
            };
        });
        
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('apply_resp_select')
            .setPlaceholder('اختر المسؤولية التي تود التقديم عليها')
            .addOptions(options);
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        
        await interaction.reply({
            content: 'يرجى اختيار المسؤولية من القائمة أدناه:',
            components: [row],
            ephemeral: true
        });
    } catch (error) {
        console.error('Error in handleApplyRespButton:', error);
    }
}

// دالة للتعامل مع اختيار المسؤولية للتقديم
async function handleApplyRespSelect(interaction, client) {
    try {
        if (interaction.replied || interaction.deferred) return;

        // التحقق من الكولداون
        const lastApply = applyCooldowns.get(interaction.user.id);
        if (lastApply) {
            const timeLeft = lastApply + COOLDOWN_TIME - Date.now();
            if (timeLeft > 0) {
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);
                return await interaction.reply({
                    content: `⏳ **يجب عليك الانتظار ${minutes}د و ${seconds}ث قبل تقديم طلب آخر أو اختيار مسؤولية أخرى.**`,
                    ephemeral: true
                });
            }
        }

        const selectedResp = interaction.values[0];
        
        const modal = new ModalBuilder()
            .setCustomId(`apply_resp_modal_${selectedResp}`)
            .setTitle(`تقديم طلب مسؤولية : ${selectedResp}`);

        const reasonInput = new TextInputBuilder()
            .setCustomId('apply_reason')
            .setLabel('لماذا تود الحصول على هذه المسؤولية؟')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('اكتب أسبابك وخبراتك هنا...')
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
    } catch (error) {
        console.error('Error in handleApplyRespSelect:', error);
    }
}

// دالة للتعامل مع مودال التقديم
async function handleApplyRespModal(interaction, client) {
    try {
        if (interaction.replied || interaction.deferred) return;

        // التحقق من الكولداون
        const lastApply = applyCooldowns.get(interaction.user.id);
        if (lastApply) {
            const timeLeft = lastApply + COOLDOWN_TIME - Date.now();
            if (timeLeft > 0) {
                const minutes = Math.floor(timeLeft / 60000);
                const seconds = Math.floor((timeLeft % 60000) / 1000);
                return await interaction.reply({
                    content: `⏳ **يجب عليك الانتظار ${minutes}د و ${seconds}ث قبل تقديم طلب آخر أو اختيار مسؤولية أخرى.**`,
                    ephemeral: true
                });
            }
        }

        const respName = interaction.customId.replace('apply_resp_modal_', '');
        const reason = interaction.fields.getTextInputValue('apply_reason');
        const guildId = interaction.guild.id;
      
        const config = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
        const applyChannelId = config.guilds[guildId]?.applyChannel;
        
        // التحقق من أن العضو ليس مسؤولاً بالفعل في هذه المسؤولية
        const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
        if (currentResps[respName] && currentResps[respName].responsibles && currentResps[respName].responsibles.includes(interaction.user.id)) {
            return await interaction.reply({
                content: `❌ **أنت بالفعل مسؤول في "${respName}" ولا يمكنك التقديم عليها مرة أخرى.**`,
                ephemeral: true
            });
        }

        if (!applyChannelId) {
            return await interaction.reply({
                content: 'نظام الطلبات غير مفعل حالياً (لم يتم تحديد قناة الطلبات)',
                ephemeral: true
            });
        }

        const channel = await client.channels.fetch(applyChannelId).catch(() => null);
        if (!channel) {
            return await interaction.reply({
                content: 'قناة الطلبات غير موجودة، يرجى التواصل مع الإدارة',
                ephemeral: true
            });
        }

        const respData = currentResps[respName];
        const applyEmbed = colorManager.createEmbed()
            .setTitle('طلب مسؤولية جديد')
            .addFields([
                { name: 'المقدم', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المسؤولية', value: respName, inline: true },
                { name: 'السبب/الخبرة', value: reason }
            ])
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        // إضافة صورة المسؤولية داخل الإيمبد لضمان وصولهما معاً
        if (respData && respData.image) {
            applyEmbed.setImage(respData.image);
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve_apply_${interaction.user.id}_${respName}`)
                .setLabel('قبول')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`reject_apply_${interaction.user.id}_${respName}`)
                .setLabel('رفض')
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [applyEmbed], components: [row] });
        
        // إرسال الصورة الفاصلة كرسالة منفصلة بعد الإيمبد مباشرة
        const separatorUrl = 'https://cdn.discordapp.com/attachments/1446184605056106690/1447086623954173972/colors-5.png?ex=693657f0&is=69350670&hm=126e0ab559dc0a642e9672d1c0d1a3e62d10a704b14fa25c46460870b67d9682&';
        await channel.send({ content: separatorUrl }).catch(err => console.error('Failed to send separator image:', err));

        // تعيين الكولداون للمستخدم بعد إرسال الطلب بنجاح
        applyCooldowns.set(interaction.user.id, Date.now());
        
        await interaction.reply({
            content: 'تم إرسال طلبك بنجاح، سيتم الرد عليك قريباً',
            ephemeral: true
        });
    } catch (error) {
        console.error('Error in handleApplyRespModal:', error);
    }
}

// دالة للتعامل مع أزرار القبول والرفض
async function handleApplyAction(interaction, client) {
    try {
        const botConfig = readJSONFile(path.join(__dirname, '..', 'data', 'botConfig.json'), {});
        const BOT_OWNERS = botConfig.owners || [];
        const isAllowed = BOT_OWNERS.includes(interaction.user.id) || interaction.guild.ownerId === interaction.user.id;

        if (!isAllowed) {
            return await interaction.reply({
                content: '❌ **مب مسؤول؟ والله ماوريك.**',
                ephemeral: true
            });
        }

        const [action, , userId, respName] = interaction.customId.split('_');
        const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
        
        if (action === 'approve') {
            if (interaction.replied || interaction.deferred) return;
            await interaction.deferUpdate();

            const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
            if (!currentResps[respName]) {
                return interaction.followUp({ content: 'المسؤولية لم تعد موجودة', ephemeral: true });
            }
            
            if (!currentResps[respName].responsibles) currentResps[respName].responsibles = [];
            if (!currentResps[respName].responsibles.includes(userId)) {
                currentResps[respName].responsibles.push(userId);
                const { dbManager } = require('../utils/database.js');
                await dbManager.updateResponsibility(respName, currentResps[respName]);
                
                // إضافة الرولات تلقائياً
                if (targetMember && currentResps[respName].roles) {
                    for (const roleId of currentResps[respName].roles) {
                        const role = interaction.guild.roles.cache.get(roleId);
                        if (role) {
                            await targetMember.roles.add(role).catch(err => console.error(`Failed to add responsibility role ${roleId}:`, err));
                        }
                    }
                }
                
                // إخطار المستخدم
                if (targetMember) {
                    const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
                    const respData = currentResps[respName];
                    
                    const approveEmbed = colorManager.createEmbed()
                        .setTitle('Accepted')
                        .setDescription(`** تم قبول طلبك لمسؤولية ال${respName}**\n\n ** في سيرفر ${interaction.guild.name}**`)
                        .setThumbnail(interaction.guild.iconURL({ dynamic: true }));
                    
                    if (respData && respData.image) {
                        approveEmbed.setImage(respData.image);
                    }
                    
                    await targetMember.send({ embeds: [approveEmbed] }).catch(() => {});
                }
                
                await interaction.editReply({ 
                    content: `**✅ تم قبول المسؤول الجديد : <@${userId}>**\n\n ليكون مسؤول** لمسؤولية ال${respName}**\n\n** قبلة مسؤول المسؤوليات : ** <@${interaction.user.id}>`, 
                    embeds: [],
                    files: [],
                    components: [] 
                });
            } else {
                await interaction.editReply({
                    content: `**⚠️ <@${userId}> مسؤول بالفعل في مسؤولية ال${respName}**`,
                    components: []
                });
            }
        } else if (action === 'reject') {
            const modal = new ModalBuilder()
                .setCustomId(`reject_reason_modal_${userId}_${respName}`)
                .setTitle('سبب الرفض');
            
            const reasonInput = new TextInputBuilder()
                .setCustomId('reject_reason')
                .setLabel('اذكر سبب الرفض')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
        }
    } catch (error) {
        console.error('Error in handleApplyAction:', error);
    }
}

// دالة للتعامل مع مودال سبب الرفض
async function handleRejectReasonModal(interaction, client) {
    try {
        const botConfig = readJSONFile(path.join(__dirname, '..', 'data', 'botConfig.json'), {});
        const BOT_OWNERS = botConfig.owners || [];
        const isAllowed = BOT_OWNERS.includes(interaction.user.id) || interaction.guild.ownerId === interaction.user.id;

        if (!isAllowed) {
            return await interaction.reply({
                content: '❌ **مب مسؤول؟ والله ماوريك.**',
                ephemeral: true
            });
        }

        const [, , , userId, respName] = interaction.customId.split('_');
        const reason = interaction.fields.getTextInputValue('reject_reason');
        
        if (interaction.replied || interaction.deferred) return;
        await interaction.deferReply({ ephemeral: true });

        const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
        
        if (targetMember) {
            const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
            const respData = currentResps[respName];
            
            const rejectEmbed = colorManager.createEmbed()
                .setTitle('Rejected')
                .setDescription(`**تم رفض طلبك لمسؤولية ال${respName}**\n\n ** في سيرفر ${interaction.guild.name}**\n\n**السبب للرفض:** ${reason}`)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }));
            
            if (respData && respData.image) {
                rejectEmbed.setImage(respData.image);
            }
            
            await targetMember.send({ embeds: [rejectEmbed] }).catch(() => {});
        }
        
        await interaction.editReply({ 
            content: `❌** تم رفض الإداري <@${userId}>**\n\n** لتقديمة في مسؤولية ال${respName}** مع ذكر السبب.`,
            embeds: [],
            files: []
        });
        // محاولة تعديل الرسالة الأصلية في قناة الطلبات
        if (interaction.message) {
            await interaction.message.edit({ 
                content: `** ❌ تم رفض الاداري <@${userId}>**\n\n **لمسؤولية ال${respName}**\n\n** بواسطة مسؤول المسؤوليات **:<@${interaction.user.id}>\n**السبب :** ${reason}`,
                embeds: [],
                files: [],
                components: [] 
            }).catch(() => {});
        }
    } catch (error) {
        console.error('Error in handleRejectReasonModal:', error);
    }
}

module.exports = {
    name: 'resp',
    description: 'عرض المسؤوليات وإعداد نظام الاقتراحات والطلبات',
    handleApplyRespButton,
    handleApplyRespSelect,
    handleApplyRespModal,
    handleApplyAction,
    handleRejectReasonModal,
    
    // تهيئة النظام عند بدء التشغيل
    initialize(client) {
        loadEmbedData(client);
    },
    
    async execute(message, args, context) {
        const { client } = context;
        const subCommand = args[0] ? args[0].toLowerCase() : null;
        
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
        
        // دالة لسؤال نوع الرسالة
        async function askMessageFormat(channel, authorId, callback) {
            const formatRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('format_embed')
                        .setLabel('إيمبد')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('format_text')
                        .setLabel('نص عادي')
                        .setStyle(ButtonStyle.Secondary)
                );
            
            const formatMsg = await channel.send({
                content: 'اختر نوع رسالة المسؤوليات:',
                components: [formatRow]
            });
            
            const formatCollector = formatMsg.createMessageComponentCollector({
                filter: i => i.user.id === authorId && (i.customId === 'format_embed' || i.customId === 'format_text'),
                time: 60000,
                max: 1
            });
            
            formatCollector.on('collect', async (interaction) => {
                const format = interaction.customId === 'format_embed' ? 'embed' : 'text';
                setGuildConfig(guildId, { messageFormat: format });
                await interaction.update({ content: `تم اختيار : ${format === 'embed' ? 'إيمبد' : 'نص عادي'}`, components: [] });
                callback(format);
            });
            
            formatCollector.on('end', (collected) => {
                if (collected.size === 0) {
                    formatMsg.edit({ content: 'انتهت مهلة الانتظار لاختيار نوع الرسالة', components: [] });
                }
            });
        }

        
if (subCommand === 'delete' && args[1] === 'all') {
    const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});
    let totalRemoved = 0;
    let totalRolesRemoved = 0;

    const confirmMsg = await message.reply(
        '**⚠️ هل أنت متأكد من إزالة جميع المسؤولين من كافة المسؤوليات؟**\n' +
        'سيتم فقط:\n' +
        '- سحب رولات المسؤوليات\n' +
        '- تفريغ المسؤولين\n' +
        '**(لن يتم حذف أي مسؤولية أو إعداداتها)**\n\n' +
        'لديك 15 ثانية للتأكيد.'
    );

    await confirmMsg.react('✅');
    await confirmMsg.react('❌');

    const filter = (reaction, user) =>
        ['✅', '❌'].includes(reaction.emoji.name) &&
        user.id === message.author.id;

    const collected = await confirmMsg
        .awaitReactions({ filter, max: 1, time: 15000 })
        .catch(() => null);

    if (!collected || collected.first().emoji.name === '❌') {
        return confirmMsg.edit('**❌ تم إلغاء العملية.**');
    }

    await confirmMsg.edit('**⏳ جاري إزالة المسؤولين وسحب الرولات...**');

    const { dbManager } = require('../utils/database.js');

    for (const respName in currentResps) {
        const resp = currentResps[respName];
        const roleId = resp.roleId;

        // توحيد المصدر
        const members = resp.responsibles || resp.members || [];

        if (members.length > 0) {
            for (const userId of members) {
                totalRemoved++;
                try {
                    const member = await message.guild.members.fetch(userId).catch(() => null);
                    if (member && roleId && member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId).catch(() => {});
                        totalRolesRemoved++;
                    }
                } catch (_) {}
            }
        }

        // تفريغ المسؤولين
        resp.members = [];
        resp.responsibles = [];
        
        // تحديث قاعدة البيانات لكل مسؤولية بشكل صحيح
        if (dbManager && dbManager.updateResponsibility) {
            await dbManager.updateResponsibility(respName, resp);
        }
    }

    // مزامنة الملف والذاكرة العالمية
    writeJSONFile(DATA_FILES.responsibilities, currentResps);
    global.responsibilities = currentResps;

    // تحديث إيمبد العرض تلقائياً ليعكس التغييرات
    try {
        await updateEmbedMessage(message.client);
    } catch (error) {
        console.error('Error updating embed message after delete all:', error);
    }

    return confirmMsg.edit(
        `**✅ تم بنجاح.**\n` +
        `- عدد المسؤولين المزالين: \`${totalRemoved}\`\n` +
        `- عدد الرولات المسحوبة: \`${totalRolesRemoved}\`\n\n` +
        `**المسؤوليات ما زالت موجودة بدون أي تغيير ✅**`
    );
}

        if (subCommand === 'img') {
    const respName = args[1];

    if (!respName) {
        return message.reply({
            content: '❌ يرجى تحديد اسم المسؤولية أو كتابة `all`.\nمثال: `resp img الشات` أو `resp img all`'
        });
    }

    const currentResps = global.responsibilities || readJSONFile(DATA_FILES.responsibilities, {});

    // جلب الصورة (مرفوعة أو رابط)
    const attachment = message.attachments.first();
    const imageUrl = attachment?.url || args[2];

    if (!imageUrl) {
        return message.reply({ content: '❌ يرجى إرفاق صورة أو وضع رابطها.' });
    }

    // فحص بسيط للصورة
    const isImage =
        attachment ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(imageUrl);

    if (!isImage) {
        return message.reply({ content: '❌ الرابط المقدم لا يبدو أنه صورة صالحة.' });
    }

    const { dbManager } = require('../utils/database.js');

    // ===== img all =====
    if (respName.toLowerCase() === 'all') {
        const respKeys = Object.keys(currentResps);

        if (respKeys.length === 0) {
            return message.reply({ content: '❌ لا توجد مسؤوليات مسجلة حالياً.' });
        }

        for (const name of respKeys) {
            currentResps[name].image = imageUrl;
        }

        writeJSONFile(DATA_FILES.responsibilities, currentResps);
        global.responsibilities = currentResps;

        // تحديث قاعدة البيانات (مرة وحدة فقط)
        try {
            if (dbManager?.run) {
                await dbManager.run(
                    'ALTER TABLE responsibilities ADD COLUMN image TEXT'
                ).catch(() => {});
                await dbManager.run(
                    'UPDATE responsibilities SET image = ?',
                    [imageUrl]
                );
            }
        } catch (_) {}

        return message.reply({
            content: `✅ تم تعيين الصورة لجميع المسؤوليات (${respKeys.length}) بنجاح.`
        });
    }

    // ===== img <respName> =====
    if (!currentResps[respName]) {
        return message.reply({
            content: `❌ المسؤولية "**${respName}**" غير موجودة.`
        });
    }

    currentResps[respName].image = imageUrl;

    writeJSONFile(DATA_FILES.responsibilities, currentResps);
    global.responsibilities = currentResps;

    try {
        if (dbManager?.run) {
            await dbManager.run(
                'ALTER TABLE responsibilities ADD COLUMN image TEXT'
            ).catch(() => {});
            await dbManager.run(
                'UPDATE responsibilities SET image = ? WHERE name = ?',
                [imageUrl, respName]
            );
        }
    } catch (_) {}

    return message.reply({
        content: `✅ تم تعيين الصورة للمسؤولية "**${respName}**" بنجاح.`
    });
}


        if (args[0] === 'chat') {
            const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
            if (!channel) return message.reply('**يرجى منشن القناة أو كتابة الآيدي الخاص بها**');
            
            const configData = readJSONFile(DATA_FILES.respConfig, { guilds: {} });
            if (!configData.guilds[guildId]) configData.guilds[guildId] = {};
            configData.guilds[guildId].applyChannel = channel.id;
            writeJSONFile(DATA_FILES.respConfig, configData);
            
            return message.reply(`**✅ تم تحديد قناة طلبات المسؤولية: <#${channel.id}>**`);
        }

        if (subCommand === 'setup') {
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
                        await msg.channel.send('يجب اختيار روم من نفس السيرفر');
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
                        
                        // سؤال نوع الرسالة
                        askMessageFormat(embedMsg.channel, message.author.id, async (format) => {
                            await sendResponsibilitiesMessage(embedChannel, client, format);
                        });
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
                    
                    // سؤال نوع الرسالة
                    askMessageFormat(msg.channel, message.author.id, async (format) => {
                        await sendResponsibilitiesMessage(embedChannel, client, format);
                    });
                });
                
                embedCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        message.channel.send('انتهت مهلة الانتظار لمنشن روم الايمبد');
                    }
                });
                
            } else {
                // إذا كانت القنوات محددة، اسأل عن نوع الرسالة ثم أرسلها
                try {
                    const embedChannel = await client.channels.fetch(guildConfig.embedChannel);
                    if (embedChannel && embedChannel.guild.id === guildId) {
                        // سؤال نوع الرسالة
                        askMessageFormat(message.channel, message.author.id, async (format) => {
                            await sendResponsibilitiesMessage(embedChannel, client, format);
                        });
                    } else {
                        await message.channel.send('روم الايمبد المحدد غير موجود أو غير صحيح، منشن روم جديد للايمبد');
                    }
                } catch (error) {
                    console.error('خطأ في جلب قناة الايمبد:', error);
                    await message.channel.send('حدث خطأ في جلب روم الايمبد، منشن روم جديد للايمبد');
                }
            }
        }
    },
    
    // دوال مساعدة
    updateEmbedMessage,
    handleSuggestionButton,
    handleSuggestionModal,
    handleResponsibilitySelect,
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
            embedData: null,
            messageFormat: 'embed' // 'embed' or 'text'
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
        const components = createSuggestionComponents();
        
        const message = await channel.send({
            embeds: [embed],
            components: components
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

// دالة لإرسال رسالة المسؤوليات (إيمبد أو نص)
async function sendResponsibilitiesMessage(channel, client, format = 'embed') {
    try {
        const responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
        const components = createSuggestionComponents();
        let message;
        
if (format === 'text') {

    const textContent = createResponsibilitiesText(responsibilities);

    const parts = splitText(textContent);

    for (let i = 0; i < parts.length; i++) {

        const sentMessage = await channel.send({

            content: parts[i],

            components: i === parts.length - 1 ? components : []

        });

        // حفظ آخر رسالة فقط (عشان التحديث لاحقًا)

        if (i === parts.length - 1) {

            const guildId = channel.guild.id;

            embedMessages.set(guildId, {

                messageId: sentMessage.id,

                channelId: channel.id,

                message: sentMessage,

                format: 'text'

            });

            updateStoredEmbedData();

        }

    }

    console.log('تم إرسال رسالة المسؤوليات بنجاح (text - multi messages)');

    return;

}


            else {
            const embed = createResponsibilitiesEmbed(responsibilities);
            message = await channel.send({
                embeds: [embed],
                components: components
            });
        }
        
        // حفظ مرجع للرسالة
        const guildId = channel.guild.id;
        embedMessages.set(guildId, {
            messageId: message.id,
            channelId: channel.id,
            message: message,
            format: format
        });
        
        // حفظ البيانات في الكونفيغ
        updateStoredEmbedData();
        
        console.log(`تم إرسال رسالة المسؤوليات بنجاح (${format})`);
        
    } catch (error) {
        console.error('خطأ في إرسال رسالة المسؤوليات:', error);
    }
}
