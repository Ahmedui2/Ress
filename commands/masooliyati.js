
const {
    StringSelectMenuBuilder,
    ActionRowBuilder,
    AttachmentBuilder
} = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getCustomProfile, initDatabase } = require('./myprofile.js');
const fs = require('fs');
const path = require('path');

const DATA_FILES = {
    categories: path.join(__dirname, '..', 'data', 'respCategories.json')
};

module.exports = {

    name: 'مسؤولياتي',

    aliases: ['مسؤولياتي', 'مسؤولتي'],

    description: 'تقديم شخص للحصول على صلاحيات إدارية',

    async execute(message, args, { responsibilities, client, BOT_OWNERS, ADMIN_ROLES }) {

        // فحص البلوك أولاً

        if (isUserBlocked(message.author.id)) {

            const blockedEmbed = colorManager.createEmbed()

                .setDescription('**أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')

                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            await message.channel.send({ embeds: [blockedEmbed] });

            return;

        }

        const member = await message.guild.members.fetch(message.author.id);

        const hasAdminRole = ADMIN_ROLES && ADMIN_ROLES.length > 0 && member.roles.cache.some(role => ADMIN_ROLES.includes(role.id));

        const hasAdministrator = member.permissions.has('Administrator');

        const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

        if (!hasAdminRole && !isOwner && !hasAdministrator) {

            await message.react('❌');

            return;

        }

        // التحقق من وجود منشن

        let targetUser = message.mentions.users.first();

        

        if (!targetUser && args[0]) {

            // محاولة جلب المستخدم عن طريق الآي دي إذا لم يكن هناك منشن

            const userIdArg = args[0].replace(/[<@!>]/g, '');

            if (/^\d{17,19}$/.test(userIdArg)) {

                targetUser = await client.users.fetch(userIdArg).catch(() => null);

            }

        }

        if (!targetUser) targetUser = message.author;
        let userId = targetUser.id;

        // تحميل المسؤوليات الحديثة من الكائن العالمي أو SQLite
        let currentResponsibilities = global.responsibilities;
        if (!currentResponsibilities || Object.keys(currentResponsibilities).length === 0) {
            try {
                const database = require('../utils/database');
                const dbManager = database.getDatabase ? database.getDatabase() : database.dbManager;
                currentResponsibilities = await dbManager.getResponsibilities();
                global.responsibilities = currentResponsibilities;
            } catch (error) {
                console.error('خطأ في جلب المسؤوليات:', error);
                currentResponsibilities = {};
            }
        }

        // دالة للبحث عن قسم المسؤولية
        const categories = fs.existsSync(DATA_FILES.categories) ? JSON.parse(fs.readFileSync(DATA_FILES.categories, 'utf8')) : {};
        function findCategoryForResp(respName) {
            for (const [catName, catData] of Object.entries(categories)) {
                if (catData.responsibilities && catData.responsibilities.includes(respName)) {
                    return catName;
                }
            }
            return null;
        }

        const loadImg = async (url) => {
            try {
                if (!url) return null;
                if (url.startsWith('/data/')) {
                    const localPath = path.join(__dirname, '..', url);
                    if (fs.existsSync(localPath)) {
                        return await loadImage(localPath);
                    }
                }
                const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
                return await loadImage(Buffer.from(response.data));
            } catch (err) {
                console.error(`Failed to load image from ${url}:`, err.message);
                return null;
            }
        };

        const wrapText = (ctx, text, maxWidth) => {
            const words = text.split(' ');
            const lines = [];
            let line = '';
            for (const word of words) {
                const testLine = line ? `${line} ${word}` : word;
                if (ctx.measureText(testLine).width > maxWidth && line) {
                    lines.push(line);
                    line = word;
                } else {
                    line = testLine;
                }
            }
            if (line) lines.push(line);
            return lines;
        };

        const buildResponsibilitiesCanvas = async (targetUser, responsibilitiesList) => {
            await initDatabase();
            const customProfile = await getCustomProfile(targetUser.id);
            const canvasWidth = 1000;
            const headerHeight = 135;
            const padding = 40;
            const panelPadding = 24;
            const maxHeight = 1800;
            const contentWidth = canvasWidth - (padding * 2);

            const groupedResps = {};
            responsibilitiesList.forEach(resp => {
                const cat = resp.category || 'بدون تصنيف';
                if (!groupedResps[cat]) groupedResps[cat] = [];
                groupedResps[cat].push(resp.name);
            });

            const orderedCategories = Object.keys(groupedResps).sort((a, b) => {
                if (a === 'بدون تصنيف') return 1;
                if (b === 'بدون تصنيف') return -1;
                return a.localeCompare(b, 'ar');
            });

            const lines = [];
            const ctxMeasure = createCanvas(1, 1).getContext('2d');
            ctxMeasure.font = 'bold 22px Arial';
            const categoryLineHeight = 32;
            const itemLineHeight = 26;

            for (const categoryName of orderedCategories) {
                lines.push({
                    text: categoryName,
                    type: 'category',
                    height: categoryLineHeight
                });
                ctxMeasure.font = '16px Arial';
                for (const respName of groupedResps[categoryName]) {
                    const wrapped = wrapText(ctxMeasure, `• ${respName}`, contentWidth - (panelPadding * 2));
                    wrapped.forEach(line => {
                        lines.push({
                            text: line,
                            type: 'item',
                            height: itemLineHeight
                        });
                    });
                }
                lines.push({ text: '', type: 'spacer', height: 10 });
            }

            let contentHeight = lines.reduce((sum, line) => sum + line.height, 0) + (panelPadding * 2);
            let canvasHeight = Math.max(380, headerHeight + contentHeight + padding);

            if (canvasHeight > maxHeight) {
                const availableHeight = maxHeight - headerHeight - padding - (panelPadding * 2);
                let runningHeight = 0;
                const trimmedLines = [];
                for (const line of lines) {
                    if (runningHeight + line.height > availableHeight) {
                        trimmedLines.push({
                            text: '... والمزيد',
                            type: 'item',
                            height: itemLineHeight
                        });
                        break;
                    }
                    trimmedLines.push(line);
                    runningHeight += line.height;
                }
                lines.length = 0;
                lines.push(...trimmedLines);
                contentHeight = runningHeight + (panelPadding * 2);
                canvasHeight = maxHeight;
            }

            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            let backgroundDrawn = false;
            if (customProfile && customProfile.banner_url) {
                const bannerImage = await loadImg(customProfile.banner_url);
                if (bannerImage) {
                    ctx.drawImage(bannerImage, 0, 0, canvasWidth, canvasHeight);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                    backgroundDrawn = true;
                }
            }

            if (!backgroundDrawn) {
                const bgGradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
                bgGradient.addColorStop(0, '#0f1525');
                bgGradient.addColorStop(0.3, '#1a1f3a');
                bgGradient.addColorStop(0.6, '#2d3561');
                bgGradient.addColorStop(1, '#1e2442');
                ctx.fillStyle = bgGradient;
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            }

            const radialBg = ctx.createRadialGradient(canvasWidth / 2, canvasHeight / 2, 50, canvasWidth / 2, canvasHeight / 2, canvasWidth / 1.6);
            radialBg.addColorStop(0, 'rgba(60, 80, 120, 0.15)');
            radialBg.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
            ctx.fillStyle = radialBg;
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);

            const circles = [
                { x: 160, y: 90, r: 120, opacity: 0.05, color: '100, 150, 255' },
                { x: 850, y: 260, r: 140, opacity: 0.06, color: '150, 100, 255' },
                { x: 500, y: 180, r: 180, opacity: 0.04, color: '120, 140, 255' }
            ];
            circles.forEach(circle => {
                const gradient = ctx.createRadialGradient(circle.x, circle.y, 0, circle.x, circle.y, circle.r);
                gradient.addColorStop(0, `rgba(${circle.color}, ${circle.opacity})`);
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetX = -5;
            ctx.shadowOffsetY = 5;
            ctx.fillStyle = '#0a0e1a';
            ctx.beginPath();
            ctx.moveTo(canvasWidth, 0);
            ctx.lineTo(canvasWidth, 130);
            ctx.quadraticCurveTo(canvasWidth - 60, 90, canvasWidth - 130, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            const avatarSize = 78;
            const avatarX = padding;
            const avatarY = padding + 5;
            const avatarImage = await loadImg(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
            if (avatarImage) {
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fill();
                ctx.restore();

                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatarImage, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();

                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
            }

            const displayName = targetUser.displayName || targetUser.globalName || targetUser.username;
            ctx.save();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 28px Arial';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 6;
            ctx.textAlign = 'left';
            ctx.fillText(displayName, avatarX + avatarSize + 20, avatarY + 30);
            ctx.font = '16px Arial';
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.fillText(`عدد المسؤوليات: ${responsibilitiesList.length}`, avatarX + avatarSize + 20, avatarY + 58);
            ctx.restore();

            const panelX = padding;
            const panelY = headerHeight;
            const panelWidth = canvasWidth - (padding * 2);
            const panelHeight = canvasHeight - panelY - padding;

            ctx.save();
            ctx.fillStyle = 'rgba(10, 15, 30, 0.6)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 16);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            let currentY = panelY + panelPadding + 6;
            for (const line of lines) {
                if (!line.text) {
                    currentY += line.height;
                    continue;
                }

                if (line.type === 'category') {
                    ctx.save();
                    ctx.font = 'bold 20px Arial';
                    ctx.fillStyle = '#9cc4ff';
                    ctx.fillText(`📂 ${line.text}`, panelX + panelPadding, currentY + 22);
                    ctx.restore();
                    currentY += line.height;
                } else {
                    ctx.save();
                    ctx.font = '16px Arial';
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                    ctx.fillText(line.text, panelX + panelPadding, currentY + 18);
                    ctx.restore();
                    currentY += line.height;
                }
            }

            return canvas;
        };

        // البحث عن مسؤوليات المستخدم المحدد

        const userResponsibilities = [];

        for (const [respName, respData] of Object.entries(currentResponsibilities)) {

            if (respData.responsibles && respData.responsibles.includes(userId)) {

                const otherResponsibles = respData.responsibles.filter(id => id !== userId);

                const category = findCategoryForResp(respName);

                userResponsibilities.push({

                    name: respName,

                    description: respData.description || 'لا يوجد وصف',

                    otherResponsiblesCount: otherResponsibles.length,

                    category: category

                });

            }

        }

        // إنشاء الرد

        if (userResponsibilities.length === 0) {

            const displayName = targetUser.displayName || targetUser.username;

            const noRespEmbed = colorManager.createEmbed()

                .setTitle(`مسؤوليات ${displayName}`)

                .setDescription(userId === message.author.id ?

                    '**ليس لديك أي مسؤوليات معينة حتى الآن.**' :

                    `**${displayName} ليس لديه أي مسؤوليات معينة حتى الآن.**`)

                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

            await message.channel.send({ embeds: [noRespEmbed] });

        } else {

            const canvas = await buildResponsibilitiesCanvas(targetUser, userResponsibilities);
            const buffer = canvas.toBuffer('image/png');
            const attachment = new AttachmentBuilder(buffer, { name: 'responsibilities.png' });

            const selectMenu = new StringSelectMenuBuilder()

                .setCustomId('masooliyati_select_desc')

                .setPlaceholder('اختر مسؤولية لعرض شرحها')

                .addOptions(userResponsibilities.map(resp => ({

                    label: resp.name.substring(0, 100),

                    value: resp.name,

                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const sentMessage = await message.channel.send({ files: [attachment], components: [row] });

            const filter = (interaction) =>
                interaction.customId === 'masooliyati_select_desc' &&
                interaction.user.id === message.author.id;

            const collector = sentMessage.createMessageComponentCollector({ filter, time: 600000 }); // 10 minutes

            collector.on('collect', async (interaction) => {
                const selectedRespName = interaction.values[0];
                const selectedResp = userResponsibilities.find(r => r.name === selectedRespName);

                if (selectedResp) {
                    const desc = selectedResp.description || 'لا يوجد وصف لهذه المسؤولية.';
                    
                    if (desc.length > 2000) {
                        const parts = [];
                        let current = '';
                        for (const line of desc.split('\n')) {
                            if ((current + line + '\n').length > 2000) {
                                parts.push(current);
                                current = '';
                            }
                            current += line + '\n';
                        }
                        if (current.trim()) parts.push(current);

                        for (let i = 0; i < parts.length; i++) {
                            const content = i === 0 ? `**شرح مسؤولية "${selectedRespName}" :**\n${parts[i]}` : parts[i];
                            if (i === 0) {
                                await interaction.reply({ content, ephemeral: true });
                            } else {
                                await interaction.followUp({ content, ephemeral: true });
                            }
                        }
                    } else {
                        await interaction.reply({
                            content: `**شرح مسؤولية "${selectedRespName}" :**\n${desc}`,
                            ephemeral: true
                        });
                    }
                }
            });

            collector.on('end', () => {
                collector.removeAllListeners();
                const disabledRow = new ActionRowBuilder().addComponents(
                    StringSelectMenuBuilder.from(selectMenu).setDisabled(true)
                );
                sentMessage.edit({ components: [disabledRow] }).catch(() => {});
            });

        }

    }

};
