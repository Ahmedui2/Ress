const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'data', 'serverMapConfig.json');

function loadAllConfigs() {
    try {
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data.imageUrl && !data.global) return { global: data };
            return data;
        }
    } catch (e) { console.error('Error loading map config:', e.message); }
    return { global: { enabled: false, imageUrl: 'https://i.ibb.co/pP9GzD7/default-map.png', welcomeMessage: 'مرحباً بك!', buttons: [] } };
}

module.exports = {
    name: 'map',
    description: 'عرض خريطة السيرفر التفاعلية',
    async execute(message, args, { client, BOT_OWNERS }) {
        try {
            // التحقق من أن BOT_OWNERS موجودة كـ Array
            const owners = Array.isArray(BOT_OWNERS) ? BOT_OWNERS : [];
            const isOwner = message.author ? owners.includes(message.author.id) : false;
            
            // إذا كان الطلب من نظام الترحيب (تلقائي) أو من الأونر
            const isAutomatic = message.isAutomatic === true;

            if (!isOwner && !isAutomatic) {
                if (message.react) await message.react('❌').catch(() => {});
                return;
            }
            
            const allConfigs = loadAllConfigs();
            // إذا كان طلباً تلقائياً أو إجبارياً للعالمية، نستخدم global، وإلا نستخدم القناة الحالية
            const config = (message.isGlobalOnly || !message.guild) ? allConfigs['global'] : (allConfigs[`channel_${message.channel.id}`] || allConfigs['global']);

            if (!config || (!config.enabled && !args.includes('--force'))) {
                return message.reply('⚠️ نظام الخريطة معطل حالياً.').catch(() => {});
            }

            // التحقق من صلاحيات البوت في القناة (تخطي في حالة الإرسال التلقائي للخاص)
            if (!isAutomatic && !message.channel.permissionsFor(client.user).has(['SendMessages', 'AttachFiles', 'EmbedLinks'])) {
                return console.log(`🚫 نقص في الصلاحيات لإرسال الخريطة في قناة: ${message.channel.name}`);
            }

            // إنشاء الصورة باستخدام Canvas
            const canvas = createCanvas(1280, 720); // جودة عالية
            const ctx = canvas.getContext('2d');

            try {
                const bg = await loadImage(config.imageUrl || 'https://i.ibb.co/pP9GzD7/default-map.png');
                ctx.drawImage(bg, 0, 0, 1280, 720);
                
                // تمت إزالة تأثيرات الاسم والخلفية السوداء بناءً على طلب المستخدم
            } catch (e) {
                console.error("Error drawing map image:", e.message);
                ctx.fillStyle = '#23272a';
                ctx.fillRect(0, 0, 1280, 720);
                ctx.font = 'bold 60px Arial';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(message.guild.name, 640, 360);
            }

            const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'server-map.png' });

            // إنشاء الأزرار مع التحقق من العدد (الحد الأقصى 25 زر في 5 صفوف)
            const rows = [];
            if (config.buttons && config.buttons.length > 0) {
                let currentRow = new ActionRowBuilder();
                config.buttons.slice(0, 25).forEach((btn, index) => {
                    // إذا كان الزر يحتاج سطر جديد أو وصلنا لـ 5 أزرار في الصف
                    if ((index > 0 && index % 5 === 0) || (btn.newline && currentRow.components.length > 0)) {
                        rows.push(currentRow);
                        currentRow = new ActionRowBuilder();
                    }
                    
                    const button = new ButtonBuilder()
                        .setCustomId(`map_btn_${index}`)
                        .setLabel(btn.label || 'زر بدون اسم')
                        .setStyle(btn.style || ButtonStyle.Secondary);
                    
                    if (btn.emoji) {
                        button.setEmoji(btn.emoji);
                    }
                    
                    currentRow.addComponents(button);
                });
                if (currentRow.components.length > 0) rows.push(currentRow);
            }

            const sendOptions = {
                content: (config.welcomeMessage && config.welcomeMessage.trim() !== '') ? config.welcomeMessage : null,
                files: [attachment],
                components: rows
            };

            if (message.send) {
                await message.send(sendOptions).catch(err => console.error('Error sending map (send):', err));
            } else {
                await message.channel.send(sendOptions).catch(err => {
                    if (err.code === 50007) {
                        console.log('🚫 لا يمكن إرسال الخريطة في الخاص للمستخدم.');
                    } else {
                        console.error('Error sending map message:', err);
                    }
                });
            }
        } catch (error) {
            console.error('❌ خطأ في تنفيذ أمر الخريطة:', error.message);
        }
    }
};
