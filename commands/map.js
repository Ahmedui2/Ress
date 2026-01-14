const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
    } catch (e) { 
        console.error('Error loading map config:', e.message); 
    }
    return { enabled: false, imageUrl: 'https://i.imgur.com/Xv7XzXz.png', welcomeMessage: 'مرحباً بك!', buttons: [] };
}

module.exports = {
    name: 'map',
    description: 'عرض خريطة السيرفر التفاعلية',
    async execute(message, args, { client }) {
        try {
            const config = loadConfig();
            if (!config.enabled && !args.includes('--force')) {
                return message.reply('⚠️ نظام الخريطة معطل حالياً.').catch(() => {});
            }

            // التحقق من صلاحيات البوت في القناة
            if (!message.channel.permissionsFor(client.user).has(['SendMessages', 'AttachFiles', 'EmbedLinks'])) {
                return console.log(`🚫 نقص في الصلاحيات لإرسال الخريطة في قناة: ${message.channel.name}`);
            }

            // إنشاء الصورة باستخدام Canvas
            const canvas = createCanvas(800, 400);
            const ctx = canvas.getContext('2d');

            try {
                const bg = await loadImage(config.imageUrl || 'https://i.imgur.com/Xv7XzXz.png');
                ctx.drawImage(bg, 0, 0, 800, 400);
                
                // تأثيرات جمالية
                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                ctx.fillRect(0, 320, 800, 80);
                
                ctx.font = 'bold 35px Arial';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(message.guild.name, 400, 370);
            } catch (e) {
                console.error("Error drawing map image:", e.message);
                ctx.fillStyle = '#23272a';
                ctx.fillRect(0, 0, 800, 400);
                ctx.font = 'bold 40px Arial';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(message.guild.name, 400, 200);
            }

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'server-map.png' });

            // إنشاء الأزرار مع التحقق من العدد (الحد الأقصى 25 زر في 5 صفوف)
            const rows = [];
            if (config.buttons && config.buttons.length > 0) {
                let currentRow = new ActionRowBuilder();
                config.buttons.slice(0, 25).forEach((btn, index) => {
                    if (index > 0 && index % 5 === 0) {
                        rows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                    currentRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`map_btn_${index}`)
                            .setLabel(btn.label || 'زر بدون اسم')
                            .setStyle(ButtonStyle.Secondary)
                    );
                });
                if (currentRow.components.length > 0) rows.push(currentRow);
            }

            await message.channel.send({
                content: config.welcomeMessage || 'مرحباً بك في السيرفر!',
                files: [attachment],
                components: rows
            }).catch(err => {
                if (err.code === 50007) {
                    console.log('🚫 لا يمكن إرسال الخريطة في الخاص للمستخدم.');
                } else {
                    console.error('Error sending map message:', err);
                }
            });
        } catch (error) {
            console.error('❌ خطأ في تنفيذ أمر الخريطة:', error.message);
        }
    }
};
