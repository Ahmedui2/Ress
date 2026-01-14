const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadConfig() {
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return { enabled: false, imageUrl: 'https://i.imgur.com/Xv7XzXz.png', welcomeMessage: 'مرحباً بك!', buttons: [] };
}

function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

module.exports = {
    name: 'map-setup',
    description: 'إعدادات خريطة السيرفر',
    async execute(message, args, { BOT_OWNERS }) {
        if (!BOT_OWNERS.includes(message.author.id) && message.guild.ownerId !== message.author.id) return;

        let config = loadConfig();

        const sendMainEmbed = async (msgOrInteraction) => {
            const embed = new EmbedBuilder()
                .setTitle('⚙️ إعدادات خريطة السيرفر')
                .setDescription(`**الحالة:** ${config.enabled ? '✅ مفعل' : '❌ معطل'}\n**الرسالة:** ${config.welcomeMessage}\n**عدد الأزرار:** ${config.buttons.length}`)
                .setImage(config.imageUrl)
                .setColor('#5865F2');

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('toggle_map').setLabel(config.enabled ? 'تعطيل' : 'تفعيل').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
                new ButtonBuilder().setCustomId('edit_image').setLabel('تغيير الصورة').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('edit_msg').setLabel('تعديل الرسالة').setStyle(ButtonStyle.Primary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('add_button').setLabel('إضافة زر').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('clear_buttons').setLabel('مسح الأزرار').setStyle(ButtonStyle.Danger)
            );

            const options = { embeds: [embed], components: [row1, row2] };
            if (msgOrInteraction.replied || msgOrInteraction.deferred) {
                return await msgOrInteraction.editReply(options);
            } else if (msgOrInteraction.isButton()) {
                return await msgOrInteraction.update(options);
            } else {
                return await message.channel.send(options);
            }
        };

        const mainMsg = await sendMainEmbed(message);

        const collector = mainMsg.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return i.reply({ content: 'ليست لك', ephemeral: true });

            if (i.customId === 'toggle_map') {
                config.enabled = !config.enabled;
                saveConfig(config);
                await sendMainEmbed(i);
            } else if (i.customId === 'edit_image') {
                const modal = new ModalBuilder().setCustomId('modal_image').setTitle('تغيير صورة الخريطة');
                const input = new TextInputBuilder().setCustomId('img_url').setLabel('رابط الصورة (URL)').setStyle(TextInputStyle.Short).setValue(config.imageUrl);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await i.showModal(modal);
            } else if (i.customId === 'edit_msg') {
                const modal = new ModalBuilder().setCustomId('modal_msg').setTitle('تعديل رسالة الترحيب');
                const input = new TextInputBuilder().setCustomId('welcome_text').setLabel('النص').setStyle(TextInputStyle.Paragraph).setValue(config.welcomeMessage);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                await i.showModal(modal);
            } else if (i.customId === 'add_button') {
                const modal = new ModalBuilder().setCustomId('modal_add_btn').setTitle('إضافة زر جديد');
                const labelInput = new TextInputBuilder().setCustomId('btn_label').setLabel('اسم الزر').setStyle(TextInputStyle.Short);
                const descInput = new TextInputBuilder().setCustomId('btn_desc').setLabel('شرح الزر (يظهر عند الضغط)').setStyle(TextInputStyle.Paragraph);
                const linkInput = new TextInputBuilder().setCustomId('btn_link').setLabel('رابط الروم (اختياري)').setStyle(TextInputStyle.Short).setRequired(false);
                
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
        });

        // معالجة المودال (Modals)
        const modalCollector = message.client.on('interactionCreate', async mi => {
            if (!mi.isModalSubmit() || mi.user.id !== message.author.id) return;

            if (mi.customId === 'modal_image') {
                config.imageUrl = mi.fields.getTextInputValue('img_url');
                saveConfig(config);
                await mi.reply({ content: '✅ تم تحديث الصورة', ephemeral: true });
                await sendMainEmbed(mainMsg);
            } else if (mi.customId === 'modal_msg') {
                config.welcomeMessage = mi.fields.getTextInputValue('welcome_text');
                saveConfig(config);
                await mi.reply({ content: '✅ تم تحديث الرسالة', ephemeral: true });
                await sendMainEmbed(mainMsg);
            } else if (mi.customId === 'modal_add_btn') {
                config.buttons.push({
                    label: mi.fields.getTextInputValue('btn_label'),
                    description: mi.fields.getTextInputValue('btn_desc'),
                    link: mi.fields.getTextInputValue('btn_link') || null
                });
                saveConfig(config);
                await mi.reply({ content: '✅ تم إضافة الزر', ephemeral: true });
                await sendMainEmbed(mainMsg);
            }
        });
    }
};
