const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getDatabase } = require('../utils/database.js');
const moment = require('moment-timezone');

const name = 'tops';

function formatDuration(milliseconds, showSeconds = false) {
    if (!milliseconds || milliseconds <= 0) return 'لا يوجد';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || showSeconds) parts.push(`${minutes}m`);
    if (showSeconds && seconds > 0) parts.push(`${seconds}s`);

    return parts.length > 0 ? parts.join(' and ') : 'أقل من دقيقة';
}

function shouldShowSeconds(users) {
    // Check if there are duplicate minute values
    const minuteValues = users.map(u => Math.floor(u.value / 60000));
    const hasDuplicates = minuteValues.some((val, idx) => minuteValues.indexOf(val) !== idx);
    return hasDuplicates;
}

async function getTopUsers(db, category, period, limit = 50) {
    try {
        const now = moment().tz('Asia/Riyadh');
        let dateFilter = '';
        let params = [];

        if (period === 'daily') {
            const today = now.format('YYYY-MM-DD');
            dateFilter = 'AND date = ?';
            params.push(today);
        } else if (period === 'weekly') {
            const weekStart = now.clone().startOf('week').format('YYYY-MM-DD');
            dateFilter = 'AND date >= ?';
            params.push(weekStart);
        } else if (period === 'monthly') {
            const monthStart = now.clone().startOf('month').format('YYYY-MM-DD');
            dateFilter = 'AND date >= ?';
            params.push(monthStart);
        }

        let query = '';

        if (category === 'voice') {
            if (period === 'total') {
                query = `
                    SELECT user_id, total_voice_time as value
                    FROM user_totals
                    WHERE total_voice_time > 0
                    ORDER BY total_voice_time DESC
                    LIMIT ?
                `;
                params = [limit];
            } else {
                query = `
                    SELECT user_id, SUM(voice_time) as value
                    FROM daily_activity
                    WHERE voice_time > 0 ${dateFilter}
                    GROUP BY user_id
                    ORDER BY value DESC
                    LIMIT ?
                `;
                params.push(limit);
            }
        } else if (category === 'chat') {
            if (period === 'total') {
                query = `
                    SELECT user_id, total_messages as value
                    FROM user_totals
                    WHERE total_messages > 0
                    ORDER BY total_messages DESC
                    LIMIT ?
                `;
                params = [limit];
            } else {
                query = `
                    SELECT user_id, SUM(messages) as value
                    FROM daily_activity
                    WHERE messages > 0 ${dateFilter}
                    GROUP BY user_id
                    ORDER BY value DESC
                    LIMIT ?
                `;
                params.push(limit);
            }
        } else if (category === 'reactions') {
            if (period === 'total') {
                query = `
                    SELECT user_id, total_reactions as value
                    FROM user_totals
                    WHERE total_reactions > 0
                    ORDER BY total_reactions DESC
                    LIMIT ?
                `;
                params = [limit];
            } else {
                query = `
                    SELECT user_id, SUM(reactions) as value
                    FROM daily_activity
                    WHERE reactions > 0 ${dateFilter}
                    GROUP BY user_id
                    ORDER BY value DESC
                    LIMIT ?
                `;
                params.push(limit);
            }
        } else if (category === 'joins') {
            if (period === 'total') {
                query = `
                    SELECT user_id, total_voice_joins as value
                    FROM user_totals
                    WHERE total_voice_joins > 0
                    ORDER BY total_voice_joins DESC
                    LIMIT ?
                `;
                params = [limit];
            } else {
                query = `
                    SELECT user_id, SUM(voice_joins) as value
                    FROM daily_activity
                    WHERE voice_joins > 0 ${dateFilter}
                    GROUP BY user_id
                    ORDER BY value DESC
                    LIMIT ?
                `;
                params.push(limit);
            }
        }

        const results = await db.all(query, params);
        return results || [];
    } catch (error) {
        console.error('خطأ في جلب أفضل المستخدمين:', error);
        return [];
    }
}

async function execute(message, args, { client }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const db = getDatabase();
    if (!db || !db.isInitialized) {
        await message.channel.send('❌ قاعدة البيانات غير متاحة');
        return;
    }

    let currentCategory = null; // null means initial view (voice + chat)
    let currentPeriod = 'weekly';
    let currentPage = 0;
    const pageSize = 10;

    async function buildInitialEmbed() {
        const topVoice = await getTopUsers(db, 'voice', currentPeriod, 5);
        const topChat = await getTopUsers(db, 'chat', currentPeriod, 5);

        const periodNames = {
            daily: 'اليوم',
            weekly: 'الأسبوع',
            monthly: 'الشهر'
        };

        const embed = colorManager.createEmbed()
            .setTitle('**Top**')
            .setTimestamp()
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        let description = '';

        // Voice section
        description += '**top voice :**\n';
        if (topVoice.length === 0) {
            description += 'لا توجد بيانات\n';
        } else {
            const showSeconds = shouldShowSeconds(topVoice);
            description += topVoice.map((user, idx) => {
                const rank = idx + 1;
                const time = formatDuration(user.value, showSeconds);
                return `**#${rank}** - <@${user.user_id}> : **${time}**`;
            }).join('\n') + '\n';
        }

        description += '\n**top chat :**\n';
        if (topChat.length === 0) {
            description += 'لا توجد بيانات';
        } else {
            description += topChat.map((user, idx) => {
                const rank = idx + 1;
                const xp = Math.floor(user.value / 10);
                return `**#${rank}** - <@${user.user_id}> : **${xp}xp**`;
            }).join('\n');
        }

        embed.setDescription(description)
            .setFooter({ text: `${periodNames[currentPeriod]}` });

        return embed;
    }

    async function buildCategoryEmbed() {
        const topUsers = await getTopUsers(db, currentCategory, currentPeriod, 100);
        
        const categoryNames = {
            voice: 'Voice',
            chat: 'chat',
            reactions: 'Reactions',
            joins: 'Joins'
        };

        const periodNames = {
            daily: 'اليوم',
            weekly: 'الأسبوع',
            monthly: 'الشهر'
        };

        const embed = colorManager.createEmbed()
            .setTimestamp()
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        if (topUsers.length === 0) {
            embed.setTitle(`**${categoryNames[currentCategory]}**`)
                .setDescription('**لا توجد بيانات في هذه الفترة**')
                .setFooter({ text: `${periodNames[currentPeriod]} • الصفحة 1 من 1` });
            return embed;
        }

        const totalPages = Math.ceil(topUsers.length / pageSize);
        const startIndex = currentPage * pageSize;
        const endIndex = Math.min(startIndex + pageSize, topUsers.length);
        const pageUsers = topUsers.slice(startIndex, endIndex);

        let description = '';
        
        if (currentCategory === 'voice') {
            embed.setTitle(`**top voice*`);
            const showSeconds = shouldShowSeconds(pageUsers);
            description = pageUsers.map((user, idx) => {
                const rank = startIndex + idx + 1;
                const time = formatDuration(user.value, showSeconds);
                return `**#${rank}** - <@${user.user_id}> : **${time}**`;
            }).join('\n');
        } else if (currentCategory === 'chat') {
            embed.setTitle(`**top chat**`);
            description = pageUsers.map((user, idx) => {
                const rank = startIndex + idx + 1;
                const xp = Math.floor(user.value / 10);
                return `**#${rank}** - <@${user.user_id}> : **${xp}xp**`;
            }).join('\n');
        } else if (currentCategory === 'reactions') {
            embed.setTitle(`**Reactions**`);
            description = pageUsers.map((user, idx) => {
                const rank = startIndex + idx + 1;
                return `**#${rank}** - <@${user.user_id}> : **${user.value}R**`;
            }).join('\n');
        } else if (currentCategory === 'joins') {
            embed.setTitle(`**Joins**`);
            description = pageUsers.map((user, idx) => {
                const rank = startIndex + idx + 1;
                return `**#${rank}** - <@${user.user_id}> : **${user.value}J**`;
            }).join('\n');
        }

        embed.setDescription(description)
            .setFooter({ text: `${periodNames[currentPeriod]} • الصفحة ${currentPage + 1} من ${totalPages}` });

        return embed;
    }

    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId('tops_category_select')
        .setPlaceholder('اختر القسم...')
        .addOptions([
            { label: 'Voice', value: 'voice', description: 'توب الفويس' },
            { label: 'Chat', value: 'chat', description: 'توب الشات' },
            { label: 'Reactions', value: 'reactions', description: 'توب الرياكتات' },
            { label: 'Joins', value: 'joins', description: 'توب الجوين فويس' }
        ]);

    const selectRow = new ActionRowBuilder().addComponents(categorySelect);

    async function buildButtons() {
        const periodRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tops_daily')
                .setLabel('يوم')
                .setStyle(currentPeriod === 'daily' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('tops_weekly')
                .setLabel('اسبوع')
                .setStyle(currentPeriod === 'weekly' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('tops_monthly')
                .setLabel('شهر')
                .setStyle(currentPeriod === 'monthly' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

        // Only show navigation if we're in category view
        if (currentCategory === null) {
            return [selectRow, periodRow];
        }

        const topUsers = await getTopUsers(db, currentCategory, currentPeriod, 100);
        const totalPages = Math.ceil(topUsers.length / pageSize);

        // Only show arrows if there are more than 10 users
        if (totalPages <= 1) {
            return [selectRow, periodRow];
        }

        const navigationRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tops_prev')
                .setLabel('🔙')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId('tops_next')
                .setLabel('🔜')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1)
        );

        return [selectRow, periodRow, navigationRow];
    }

    const initialEmbed = await buildInitialEmbed();
    const initialButtons = await buildButtons();
    const sentMessage = await message.channel.send({ 
        embeds: [initialEmbed], 
        components: initialButtons 
    });

    const filter = i => i.user.id === message.author.id && i.message.id === sentMessage.id;
    const collector = message.channel.createMessageComponentCollector({ filter, time: 600000 });

    collector.on('collect', async interaction => {
        try {
            if (interaction.customId === 'tops_category_select') {
                currentCategory = interaction.values[0];
                currentPage = 0;
            } else if (interaction.customId === 'tops_daily') {
                currentPeriod = 'daily';
                currentPage = 0;
            } else if (interaction.customId === 'tops_weekly') {
                currentPeriod = 'weekly';
                currentPage = 0;
            } else if (interaction.customId === 'tops_monthly') {
                currentPeriod = 'monthly';
                currentPage = 0;
            } else if (interaction.customId === 'tops_prev' && currentPage > 0) {
                currentPage--;
            } else if (interaction.customId === 'tops_next') {
                const topUsers = await getTopUsers(db, currentCategory, currentPeriod, 100);
                const totalPages = Math.ceil(topUsers.length / pageSize);
                if (currentPage < totalPages - 1) {
                    currentPage++;
                }
            }

            let newEmbed;
            if (currentCategory === null) {
                newEmbed = await buildInitialEmbed();
            } else {
                newEmbed = await buildCategoryEmbed();
            }
            
            const newButtons = await buildButtons();

            await interaction.update({ 
                embeds: [newEmbed], 
                components: newButtons 
            });
        } catch (error) {
            console.error('Error in tops collector:', error);
        }
    });

    collector.on('end', () => {
        sentMessage.edit({ components: [] }).catch(() => {});
    });
}

module.exports = { name, execute };
