const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadAllConfigs() {
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            // تحويل التنسيق القديم (object واحد) إلى الجديد (multi-config) إذا لزم الأمر
            if (data.imageUrl && !data.global) {
                return { global: data };
            }
            return data;
        }
    } catch (e) {
        console.error('Error loading map config in setup:', e.message);
    }
    return { global: { enabled: false, imageUrl: 'https://i.ibb.co/pP9GzD7/default-map.png', welcomeMessage: 'مرحباً بك!', buttons: [] } };
}

function saveAllConfigs(allConfigs) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(allConfigs, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving map config:', e.message);
        return false;
    }
}

function loadConfig() {
    const all = loadAllConfigs();
    return all.global;
}

function saveConfig(config) {
    const all = loadAllConfigs();
    all.global = config;
    return saveAllConfigs(all);
}

module.exports = {
    name: 'map-setup',
    description: 'إعدادات خريطة السيرفر',
    async execute(message, args, { BOT_OWNERS }) {
        try {
            const isOwner = BOT_OWNERS.includes(message.author.id);
            if (!isOwner) {
                await message.react('❌').catch(() => {});
                return;
            }

            // تحديد القناة المستهدفة (من المنشن أو الأيدي أو القناة الحالية)
            const targetChannel = message.mentions.channels.first() || 
                                 (args[0] && message.guild.channels.cache.get(args[0])) || 
                                 null;
            
            const configKey = targetChannel ? `channel_${targetChannel.id}` : 'global';
            const allConfigs = loadAllConfigs();
            let config = allConfigs[configKey] || { enabled: false, imageUrl: 'https://i.ibb.co/pP9GzD7/default-map.png', welcomeMessage: 'مرحباً بك!', buttons: [] };

            const sendMainEmbed = async (msgOrInteraction) => {
                const colorManager = require('../utils/colorManager.js');
                const embed = new EmbedBuilder()
                    .setTitle(targetChannel ? `⚙️ إعدادات خريطة روم: ${targetChannel.name}` : '⚙️ إعدادات خريطة السيرفر العامة')
                    .setDescription(`**الحالة:** ${config.enabled ? '✅ مفعل' : '❌ معطل'}\n**الرسالة:** ${config.welcomeMessage}\n**عدد الأزرار:** ${config.buttons.length}/25\n\n*ملاحظة: هذه الإعدادات ${targetChannel ? 'خاصة بهذا الروم فقط' : 'عامة (تُستخدم في الخاص)'}.*`)
                    .setImage(config.imageUrl)
                    .setColor(colorManager.getColor('primary'))
                    .setFooter({ text: 'نظام الخريطة التفاعلي • Ress Bot' });

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('toggle_map').setLabel(config.enabled ? 'تعطيل' : 'تفعيل').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('edit_image').setLabel('تغيير الصورة').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('edit_msg').setLabel('تعديل الرسالة').setStyle(ButtonStyle.Primary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('add_button').setLabel('إضافة زر').setStyle(ButtonStyle.Secondary).setDisabled(config.buttons.length >= 25),
                    new ButtonBuilder().setCustomId('manage_emojis').setLabel('إدارة الإيموجيات').setStyle(ButtonStyle.Secondary).setDisabled(config.buttons.length === 0),
                    new ButtonBuilder().setCustomId('clear_buttons').setLabel('مسح الأزرار').setStyle(ButtonStyle.Danger)
                );

                const options = { embeds: [embed], components: [row1, row2] };
                
                try {
                    // إذا كان لدينا تفاعل (Interaction)
                    if (msgOrInteraction.isRepliable && msgOrInteraction.isRepliable()) {
                        if (msgOrInteraction.replied || msgOrInteraction.deferred) {
                            return await msgOrInteraction.editReply(options);
                        } else {
                            return await msgOrInteraction.update(options).catch(async () => {
                                return await msgOrInteraction.reply(options);
                            });
                        }
                    } 
                    
                    // إذا كان لدينا كائن رسالة (Message)
                    if (msgOrInteraction.edit && msgOrInteraction.author?.id === message.client.user.id) {
                        return await msgOrInteraction.edit(options);
                    }

                    // كخيار أخير: إرسال رسالة جديدة (فقط في المرة الأولى)
                    return await message.channel.send(options);
                } catch (err) {
                    console.error('Error updating setup menu:', err.message);
                }
            };

            const mainMsg = await sendMainEmbed(message);
            if (!mainMsg) return;

            const collector = mainMsg.createMessageComponentCollector({ 
                filter: i => i.user.id === message.author.id,
                time: 600000 
            });

            collector.on('collect', async i => {
                try {
                    const currentAll = loadAllConfigs();
                    if (i.customId === 'toggle_map') {
                        config.enabled = !config.enabled;
                        currentAll[configKey] = config;
                        saveAllConfigs(currentAll);
                        await sendMainEmbed(i);
                    } else if (i.customId === 'edit_image') {
                        const modal = new ModalBuilder().setCustomId('modal_image').setTitle('تغيير صورة الخريطة');
                        const input = new TextInputBuilder().setCustomId('img_url').setLabel('رابط الصورة (URL)').setStyle(TextInputStyle.Short).setValue(config.imageUrl).setRequired(true);
                        modal.addComponents(new ActionRowBuilder().addComponents(input));
                        await i.showModal(modal);
                    } else if (i.customId === 'edit_msg') {
                        const modal = new ModalBuilder().setCustomId('modal_msg').setTitle('تعديل رسالة الترحيب');
                        const input = new TextInputBuilder().setCustomId('welcome_text').setLabel('النص').setStyle(TextInputStyle.Paragraph).setValue(config.welcomeMessage).setRequired(true);
                        modal.addComponents(new ActionRowBuilder().addComponents(input));
                        await i.showModal(modal);
                    } else if (i.customId === 'add_button') {
                        const modal = new ModalBuilder().setCustomId('modal_add_btn').setTitle('إضافة زر جديد');
                        const labelInput = new TextInputBuilder().setCustomId('btn_label').setLabel('اسم الزر').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true);
                        const emojiInput = new TextInputBuilder().setCustomId('btn_emoji').setLabel('إيموجي الزر (اختياري)').setStyle(TextInputStyle.Short).setPlaceholder('مثال: 📍 أو :emoji_name:').setRequired(false);
                        const descInput = new TextInputBuilder().setCustomId('btn_desc').setLabel('شرح الزر (يظهر عند الضغط)').setStyle(TextInputStyle.Paragraph).setRequired(true);
                        const roleInput = new TextInputBuilder().setCustomId('btn_role').setLabel('ID الرول (اختياري - للإعطاء/الإزالة)').setStyle(TextInputStyle.Short).setRequired(false);
                        const linksInput = new TextInputBuilder().setCustomId('btn_links').setLabel('الروابط (اسم1,رابط1 | اسم2,رابط2)').setStyle(TextInputStyle.Paragraph).setPlaceholder('مثال:\nروم الفعاليات,https://...\nروم القوانين,https://...').setRequired(false);
                        
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(labelInput),
                            new ActionRowBuilder().addComponents(emojiInput),
                            new ActionRowBuilder().addComponents(descInput),
                            new ActionRowBuilder().addComponents(roleInput),
                            new ActionRowBuilder().addComponents(linksInput)
                        );
                        await i.showModal(modal);
                    } else if (i.customId === 'manage_emojis') {
                        const modal = new ModalBuilder().setCustomId('modal_bulk_emojis').setTitle('إدارة إيموجيات الأزرار');
                        const input = new TextInputBuilder()
                            .setCustomId('emojis_list')
                            .setLabel('قائمة الإيموجيات (إيموجي لكل سطر)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('ضع الإيموجيات هنا بالترتيب.\nاترك السطر فارغاً لإزالة إيموجي زر معين.\nاكتب "clear" في أول سطر لإزالة الكل.')
                            .setRequired(true);
                        
                        input.setValue(config.buttons.map(b => b.emoji || '').join('\n'));
                        
                        modal.addComponents(new ActionRowBuilder().addComponents(input));
                        await i.showModal(modal);
                    } else if (i.customId === 'clear_buttons') {
                        config.buttons = [];
                        currentAll[configKey] = config;
                        saveAllConfigs(currentAll);
                        await sendMainEmbed(i);
                    }
                } catch (err) {
                    console.error('Collector interaction error:', err.message);
                }
            });

            collector.on('end', () => {
                mainMsg.edit({ components: [] }).catch(() => {});
            });

            const modalHandler = async mi => {
                if (!mi.isModalSubmit() || mi.user.id !== message.author.id) return;

                try {
                    const currentAll = loadAllConfigs();
                    if (mi.customId === 'modal_image') {
                        const newUrl = mi.fields.getTextInputValue('img_url').trim();
                        // فحص صحة الرابط (URL)
                        if (!newUrl.startsWith('http')) {
                            return await mi.reply({ content: '❌ فشل: رابط الصورة غير صالح. يجب أن يبدأ بـ http أو https.', ephemeral: true });
                        }
                        
                        // محاولة التحقق من امتداد الصورة بشكل بسيط
                        const isImage = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(newUrl.split('?')[0]);
                        if (!isImage) {
                            await mi.reply({ content: '⚠️ تحذير: الرابط لا يبدو كرابط صورة مباشر، ولكن سيتم اعتماده.', ephemeral: true });
                        }

                        config.imageUrl = newUrl;
                        currentAll[configKey] = config;
                        if (saveAllConfigs(currentAll)) {
                            await sendMainEmbed(mi);
                            const feedback = { content: '✅ تم تحديث صورة الخريطة بنجاح.', ephemeral: true };
                            if (mi.replied || mi.deferred) await mi.followUp(feedback).catch(() => {});
                            else await mi.reply(feedback).catch(() => {});
                        } else {
                            await mi.reply({ content: '❌ فشل في حفظ البيانات في قاعدة البيانات.', ephemeral: true });
                        }
                    } else if (mi.customId === 'modal_msg') {
                        const newMsg = mi.fields.getTextInputValue('welcome_text').trim();
                        if (newMsg.length < 2) {
                            return await mi.reply({ content: '❌ فشل: الرسالة قصيرة جداً.', ephemeral: true });
                        }

                        config.welcomeMessage = newMsg;
                        currentAll[configKey] = config;
                        if (saveAllConfigs(currentAll)) {
                            await sendMainEmbed(mi);
                            const feedback = { content: '✅ تم تحديث رسالة الترحيب بنجاح.', ephemeral: true };
                            if (mi.replied || mi.deferred) await mi.followUp(feedback).catch(() => {});
                            else await mi.reply(feedback).catch(() => {});
                        } else {
                            await mi.reply({ content: '❌ فشل في حفظ البيانات.', ephemeral: true });
                        }
                    } else if (mi.customId === 'modal_bulk_emojis') {
                        const list = mi.fields.getTextInputValue('emojis_list').trim();
                        const lines = list.split('\n');
                        
                        if (lines[0]?.toLowerCase() === 'clear') {
                            config.buttons.forEach(b => b.emoji = null);
                        } else {
                            config.buttons.forEach((btn, idx) => {
                                if (lines[idx] !== undefined) {
                                    const emoji = lines[idx].trim();
                                    btn.emoji = emoji !== '' ? emoji : null;
                                }
                            });
                        }
                        
                        currentAll[configKey] = config;
                        if (saveAllConfigs(currentAll)) {
                            await sendMainEmbed(mi);
                            const feedback = { content: '✅ تم تحديث إيموجيات الأزرار بنجاح.', ephemeral: true };
                            if (mi.replied || mi.deferred) await mi.followUp(feedback).catch(() => {});
                            else await mi.reply(feedback).catch(() => {});
                        } else {
                            await mi.reply({ content: '❌ فشل في حفظ البيانات.', ephemeral: true });
                        }
                    } else if (mi.customId === 'modal_add_btn') {
                        const label = mi.fields.getTextInputValue('btn_label').trim();
                        const emoji = mi.fields.getTextInputValue('btn_emoji').trim();
                        const description = mi.fields.getTextInputValue('btn_desc').trim();
                        const roleId = mi.fields.getTextInputValue('btn_role').trim();
                        const linksRaw = mi.fields.getTextInputValue('btn_links').trim();
                        
                        // فحص المدخلات الأساسية
                        if (label.length < 1) return await mi.reply({ content: '❌ اسم الزر مطلوب.', ephemeral: true });
                        
                        // فحص الروابط الداخلية في الشرح
                        const internalLinkRegex = /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d+\/\d+/g;
                        const hasInternalLinks = internalLinkRegex.test(description);
                        if (hasInternalLinks) {
                            // يمكنك إضافة منطق تنبيه أو منع هنا إذا أردت
                            console.log('Internal Discord link detected in button description');
                        }

                        // فحص الرول إذا تم وضعه
                        if (roleId && !/^\d{17,19}$/.test(roleId)) {
                            return await mi.reply({ content: '❌ ID الرول غير صالح. يجب أن يكون رقماً مكوناً من 17-19 خانة.', ephemeral: true });
                        }

                        const links = [];
                        if (linksRaw) {
                            const lines = linksRaw.split(/[\n|]/);
                            for (let line of lines) {
                                const parts = line.split(',');
                                if (parts.length >= 2) {
                                    const l = parts[0].trim();
                                    const url = parts.slice(1).join(',').trim();
                                    if (url.startsWith('http')) {
                                        links.push({ label: l, url });
                                    }
                                }
                            }
                        }

                        config.buttons.push({
                            label: label,
                            emoji: emoji !== '' ? emoji : null,
                            description: description,
                            roleId: roleId !== '' ? roleId : null,
                            links: links.length > 0 ? links : null
                        });
                        
                        currentAll[configKey] = config;
                        if (saveAllConfigs(currentAll)) {
                            await sendMainEmbed(mi);
                            const feedback = { content: `✅ تم إضافة الزر "${label}" بنجاح.`, ephemeral: true };
                            if (mi.replied || mi.deferred) await mi.followUp(feedback).catch(() => {});
                            else await mi.reply(feedback).catch(() => {});
                        } else {
                            await mi.reply({ content: '❌ فشل في حفظ البيانات.', ephemeral: true });
                        }
                    }
                } catch (err) {
                    console.error('Modal submission error:', err.message);
                    try {
                        if (!mi.replied && !mi.deferred) await mi.reply({ content: '❌ حدث خطأ غير متوقع أثناء معالجة البيانات.', ephemeral: true });
                        else await mi.followUp({ content: '❌ حدث خطأ غير متوقع أثناء معالجة البيانات.', ephemeral: true });
                    } catch (e) {}
                }
            };

            message.client.on('interactionCreate', modalHandler);
            setTimeout(() => message.client.off('interactionCreate', modalHandler), 600000);

        } catch (error) {
            console.error('❌ خطأ في تنفيذ إعدادات الخريطة:', error.message);
        }
    }
};
