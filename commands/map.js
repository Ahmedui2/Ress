const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return { enabled: false, imageUrl: '', welcomeMessage: '', buttons: [] };
}

module.exports = {
    name: 'map',
    description: 'عرض خريطة السيرفر التفاعلية',
    async execute(message, args, { client }) {
        const config = loadConfig();
        if (!config.enabled) return;

        // إنشاء الصورة باستخدام Canvas (محاكاة لنظام البروفايل)
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');

        try {
            const bg = await loadImage(config.imageUrl || 'https://i.imgur.com/Xv7XzXz.png');
            ctx.drawImage(bg, 0, 0, 800, 400);
            
            // إضافة تأثيرات بسيطة (مثل البروفايل)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.fillRect(0, 330, 800, 70);
            
            ctx.font = 'bold 40px Arial';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(message.guild.name, 400, 380);
        } catch (e) {
            console.error("Error loading map image:", e);
            ctx.fillStyle = '#2c2f33';
            ctx.fillRect(0, 0, 800, 400);
            ctx.font = 'bold 40px Arial';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(message.guild.name, 400, 200);
        }

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'server-map.png' });

        // إنشاء الأزرار
        const rows = [];
        if (config.buttons && config.buttons.length > 0) {
            let currentRow = new ActionRowBuilder();
            config.buttons.forEach((btn, index) => {
                if (index > 0 && index % 5 === 0) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`map_btn_${index}`)
                        .setLabel(btn.label)
                        .setStyle(ButtonStyle.Secondary)
                );
            });
            rows.push(currentRow);
        }

        await message.channel.send({
            content: config.welcomeMessage,
            files: [attachment],
            components: rows
        });
    }
};
