const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading map config in setup:', e.message);
    }
    return { enabled: false, imageUrl: 'https://i.imgur.com/Xv7XzXz.png', welcomeMessage: 'مرحباً بك!', buttons: [] };
}

function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving map config:', e.message);
        return false;
    }
}

module.exports = {
    name: 'map-setup',
    description: 'إعدادات خريطة السيرفر',
    async execute(message, args, { BOT_OWNERS }) {
        try {
            const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
            if (!isOwner) return;

            let config = loadConfig();

            const sendMainEmbed = async (msgOrInteraction) => {
                const embed = new EmbedBuilder()
                    .setTitle('⚙️ إعدادات خريطة السيرفر')
                    .setDescription(`**الحالة:** ${config.enabled ? '✅ مفعل' : '❌ معطل'}\n**الرسالة:** ${config.welcomeMessage}\n**عدد الأزرار:** ${config.buttons.length}/25`)
                    .setImage(config.imageUrl)
                    .setColor(config.enabled ? '#43b581' : '#f04747')
                    .setFooter({ text: 'نظام الخريطة التفاعلي • Ress Bot' });

                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('toggle_map').setLabel(config.enabled ? 'تعطيل' : 'تفعيل').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('edit_image').setLabel('تغيير الصورة').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('edit_msg').setLabel('تعديل الرسالة').setStyle(ButtonStyle.Primary)
                );

                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('add_button').setLabel('إضافة زر').setStyle(ButtonStyle.Secondary).setDisabled(config.buttons.length >= 25),
                    new ButtonBuilder().setCustomId('clear_buttons').setLabel('مسح الأزرار').setStyle(ButtonStyle.Danger)
                );

                const options = { embeds: [embed], components: [row1, row2] };
                
                try {
                    if (msgOrInteraction.isButton && (msgOrInteraction.replied || msgOrInteraction.deferred)) {
                        return await msgOrInteraction.editReply(options);
                    } else if (msgOrInteraction.isButton()) {
                        return await msgOrInteraction.update(options);
                    } else {
                        return await message.channel.send(options);
                    }
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
                    if (i.customId === 'toggle_map') {
                        config.enabled = !config.enabled;
                        saveConfig(config);
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
                        const descInput = new TextInputBuilder().setCustomId('btn_desc').setLabel('شرح الزر (يظهر عند الضغط)').setStyle(TextInputStyle.Paragraph).setRequired(true);
                        const linkInput = new TextInputBuilder().setCustomId('btn_link').setLabel('رابط الروم (اختياري)').setStyle(TextInputStyle.Short).setPlaceholder('https://discord.com/channels/...').setRequired(false);
                        
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(labelInput),
                            new ActionRowBuilder().addComponents(descInput),
                            new ActionRowBuilder().addComponents(linkInput)
                        );
                        await i.showModal(modal);
                    } else if (i.customId === 'clear_buttons') {
                        config.buttons = [];
                        saveConfig(config);
                        await sendMainEmbed(i);
                    }
                } catch (err) {
                    console.error('Collector interaction error:', err.message);
                }
            });

            collector.on('end', () => {
                mainMsg.edit({ components: [] }).catch(() => {});
            });

            // معالجة المودال (Modals) - يتم تعريفها مرة واحدة في البوت
            // ملاحظة: في هذا الهيكل، يتم استخدام مستمع مؤقت للمودال
            const modalHandler = async mi => {
                if (!mi.isModalSubmit() || mi.user.id !== message.author.id) return;

                try {
                    if (mi.customId === 'modal_image') {
                        config.imageUrl = mi.fields.getTextInputValue('img_url');
                        saveConfig(config);
                        await mi.reply({ content: '✅ تم تحديث الصورة بنجاح.', ephemeral: true });
                        await sendMainEmbed(mainMsg);
                    } else if (mi.customId === 'modal_msg') {
                        config.welcomeMessage = mi.fields.getTextInputValue('welcome_text');
                        saveConfig(config);
                        await mi.reply({ content: '✅ تم تحديث الرسالة بنجاح.', ephemeral: true });
                        await sendMainEmbed(mainMsg);
                    } else if (mi.customId === 'modal_add_btn') {
                        const link = mi.fields.getTextInputValue('btn_link');
                        if (link && !link.startsWith('http')) {
                            return await mi.reply({ content: '❌ الرابط غير صحيح، يجب أن يبدأ بـ http أو https', ephemeral: true });
                        }
                        config.buttons.push({
                            label: mi.fields.getTextInputValue('btn_label'),
                            description: mi.fields.getTextInputValue('btn_desc'),
                            link: link || null
                        });
                        saveConfig(config);
                        await mi.reply({ content: '✅ تم إضافة الزر بنجاح.', ephemeral: true });
                        await sendMainEmbed(mainMsg);
                    }
                } catch (err) {
                    console.error('Modal submission error:', err.message);
                }
            };

            message.client.on('interactionCreate', modalHandler);
            setTimeout(() => message.client.off('interactionCreate', modalHandler), 600000);

        } catch (error) {
            console.error('❌ خطأ في تنفيذ إعدادات الخريطة:', error.message);
        }
    }
};
