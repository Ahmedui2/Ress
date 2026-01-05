const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const vacationManager = require('../utils/vacationManager.js');

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

function readJson(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultData;
}

async function execute(message, args, { BOT_OWNERS }) {
    const adminRoles = readJson(adminRolesPath, []);
    const isOwner = BOT_OWNERS.includes(message.author.id);
    const hasAdminRole = message.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!isOwner && !hasAdminRole) {
        return message.reply({ content: '❌ **خوي.**', ephemeral: true });
    }

    const { embed, row } = await getVacationsListEmbed(message.guild);
    await message.reply({ embeds: [embed], components: [row] });
}

async function getVacationsListEmbed(guild) {
    const vacations = readJson(vacationsPath, { active: {}, pending: {} });
    const active = vacations.active || {};
    
    const embed = colorManager.createEmbed()
        .setTitle('🌴 قائمة الإجازات الحالية')
        .setColor(colorManager.getColor('active') || '#0099ff')
        .setTimestamp();

    let description = '';
    const activeEntries = Object.entries(active);
    
    if (activeEntries.length === 0) {
        description = '*لا يوجد إداريين في إجازة حالياً.*';
    } else {
        activeEntries.forEach(([userId, data], index) => {
            const endTimestamp = Math.floor(new Date(data.endDate).getTime() / 1000);
            const roles = data.rolesData ? data.rolesData.map(r => `<@&${r.id}>`).join(', ') : 'غير محدد';
            description += `${index + 1}. <@${userId}> : ${roles} : ينتهي <t:${endTimestamp}:R>\n`;
        });
    }

    embed.setDescription(description);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('vac_list_pending')
            .setLabel('الطلبات المعلقة')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('vac_list_terminate')
            .setLabel('إنهاء إجازة')
            .setStyle(ButtonStyle.Danger)
    );

    return { embed, row };
}

async function getPendingListEmbed(guild) {
    const vacations = readJson(vacationsPath, { pending: {} });
    const pending = vacations.pending || {};
    
    const embed = colorManager.createEmbed()
        .setTitle('⏳ طلبات الإجازة المعلقة')
        .setColor(colorManager.getColor('pending') || '#E67E22')
        .setTimestamp();

    let description = '';
    const pendingEntries = Object.entries(pending);

    if (pendingEntries.length === 0) {
        description = '*لا توجد طلبات معلقة حالياً.*';
    } else {
        pendingEntries.forEach(([userId, data], index) => {
            const start = new Date(data.startDate);
            const end = new Date(data.endDate);
            const durationMs = end - start;
            const days = Math.round(durationMs / (1000 * 60 * 60 * 24));
            description += `${index + 1}. <@${userId}> : الوقت: ${days} يوم : السبب: ${data.reason}\n`;
        });
    }

    embed.setDescription(description);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('vac_list_back')
            .setLabel('رجوع')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('vac_pending_approve_multi')
            .setLabel('قبول متعدد')
            .setStyle(ButtonStyle.Success)
            .setDisabled(pendingEntries.length === 0),
        new ButtonBuilder()
            .setCustomId('vac_pending_reject_multi')
            .setLabel('رفض متعدد')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(pendingEntries.length === 0)
    );

    return { embed, row };
}

async function handleInteraction(interaction, context) {
    const { client, BOT_OWNERS } = context;
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const adminRoles = readJson(adminRolesPath, []);
    const isOwner = BOT_OWNERS.includes(interaction.user.id);
    const hasAdminRole = interaction.member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!isOwner && !hasAdminRole) {
        return interaction.reply({ content: '❌ **خوي.**', ephemeral: true });
    }

    if (interaction.customId === 'vac_list_pending') {
        const { embed, row } = await getPendingListEmbed(interaction.guild);
        await interaction.update({ embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'vac_list_back') {
        const { embed, row } = await getVacationsListEmbed(interaction.guild);
        await interaction.update({ content: null, embeds: [embed], components: [row] });
    }

    if (interaction.customId === 'vac_list_terminate') {
        const vacations = readJson(vacationsPath, { active: {} });
        const active = vacations.active || {};
        const entries = Object.entries(active);

        if (entries.length === 0) {
            return interaction.reply({ content: 'لا توجد إجازات نشطة لإنهائها.', ephemeral: true });
        }

        const options = entries.map(([userId, data]) => ({
            label: data.memberData?.displayName || userId,
            description: data.rolesData ? data.rolesData.map(r => r.name).join(', ') : 'رولات غير معروفة',
            value: userId
        }));

        const menu = new StringSelectMenuBuilder()
            .setCustomId('vac_terminate_select')
            .setPlaceholder('اختر الإداريين لإنهاء إجازتهم')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vac_list_back').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({ content: 'اختر من القائمة لإنهاء الإجازة:', embeds: [], components: [row, backRow] });
    }

    if (interaction.customId === 'vac_terminate_select') {
        const userIds = interaction.values;
        let results = [];
        
        await interaction.deferUpdate();

        for (const userId of userIds) {
            const res = await vacationManager.endVacation(interaction.guild, client, userId, `تم الإنهاء بواسطة ${interaction.user.tag}`);
            results.push(`<@${userId}>: ${res.success ? '✅ تم' : '❌ فشل'}`);
        }

        const { embed, row } = await getVacationsListEmbed(interaction.guild);
        await interaction.editReply({ 
            content: `**نتائج الإنهاء:**\n${results.join('\n')}`, 
            embeds: [embed], 
            components: [row] 
        });
    }

    if (interaction.customId === 'vac_pending_reject_multi') {
        const vacations = readJson(vacationsPath, { pending: {} });
        const pending = vacations.pending || {};
        const entries = Object.entries(pending);

        const options = entries.map(([userId, data]) => ({
            label: userId,
            description: `السبب: ${data.reason}`,
            value: userId
        }));

        const menu = new StringSelectMenuBuilder()
            .setCustomId('vac_pending_reject_select')
            .setPlaceholder('اختر الطلبات لرفضها')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vac_list_back').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({ content: 'اختر الطلبات للرفض المتعدد:', embeds: [], components: [row, backRow] });
    }

    if (interaction.customId === 'vac_pending_approve_multi') {
        const vacations = readJson(vacationsPath, { pending: {} });
        const pending = vacations.pending || {};
        const entries = Object.entries(pending);

        const options = entries.map(([userId, data]) => ({
            label: userId,
            description: `السبب: ${data.reason}`,
            value: userId
        }));

        const menu = new StringSelectMenuBuilder()
            .setCustomId('vac_pending_approve_select')
            .setPlaceholder('اختر الطلبات لقبولها')
            .setMinValues(1)
            .setMaxValues(options.length)
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vac_list_back').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
        );

        await interaction.update({ content: 'اختر الطلبات للقبول المتعدد:', embeds: [], components: [row, backRow] });
    }

    if (interaction.customId === 'vac_pending_approve_select') {
        const userIds = interaction.values;
        let results = [];
        
        await interaction.deferUpdate();

        for (const userId of userIds) {
            const res = await vacationManager.approveVacation(interaction, userId, interaction.user.id);
            if (res.success) {
                // إرسال رسالة خاصة للعضو
                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (member) {
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle('تم قبول طلب إجازتك')
                        .setColor(colorManager.getColor('approved') || '#2ECC71')
                        .setDescription(`**تم قبول طلب إجازتك.**\n**الرولات المسحوبة:** ${res.vacation.removedRoles.map(id => `<@&${id}>`).join(', ') || 'لا توجد'}\n**تاريخ العودة:** <t:${Math.floor(new Date(res.vacation.endDate).getTime() / 1000)}:f>`)
                        .setTimestamp();
                    await member.user.send({ embeds: [dmEmbed] }).catch(() => {});
                }
            }
            results.push(`<@${userId}>: ${res.success ? '✅ تم القبول' : '❌ فشل'}`);
        }

        const { embed, row } = await getPendingListEmbed(interaction.guild);
        await interaction.editReply({ 
            content: `**نتائج المعالجة:**\n${results.join('\n')}`, 
            embeds: [embed], 
            components: [row] 
        });
    }

    if (interaction.customId === 'vac_pending_reject_select') {
        const userIds = interaction.values;
        let results = [];
        
        await interaction.deferUpdate();

        for (const userId of userIds) {
            const res = await rejectVacation(interaction, userId);
            results.push(`<@${userId}>: ${res.success ? '❌ تم الرفض' : '❌ فشل'}`);
        }

        const { embed, row } = await getPendingListEmbed(interaction.guild);
        await interaction.editReply({ 
            content: `**نتائج المعالجة:**\n${results.join('\n')}`, 
            embeds: [embed], 
            components: [row] 
        });
    }
}

async function rejectVacation(interaction, userId) {
    try {
        const vacationsData = readJson(vacationsPath, { pending: {}, rejected: {}, cooldowns: {} });
        const pendingRequest = vacationsData.pending?.[userId];

        if (!pendingRequest) return { success: false };

        if (!vacationsData.cooldowns) vacationsData.cooldowns = {};
        vacationsData.cooldowns[userId] = Date.now() + (12 * 60 * 60 * 1000);

        if (!vacationsData.rejected) vacationsData.rejected = {};
        vacationsData.rejected[userId] = {
            reason: pendingRequest.reason,
            startDate: pendingRequest.startDate,
            endDate: pendingRequest.endDate,
            rejectedBy: interaction.user.tag,
            rejectedAt: new Date().toISOString(),
        };
        delete vacationsData.pending[userId];
        
        fs.writeFileSync(vacationsPath, JSON.stringify(vacationsData, null, 2));

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) {
            const dmEmbed = colorManager.createEmbed()
                .setTitle('تم رفض طلب إجازتك')
                .setColor(colorManager.getColor('rejected') || '#E74C3C')
                .setDescription(`**تم رفض طلب إجازتك من قبل الإدارة.**\n**عليك كولداون 12 ساعة لتقديم طلب جديد.**`)
                .setTimestamp();
            await member.user.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        return { success: true };
    } catch (error) {
        console.error('Error rejecting vacation:', error);
        return { success: false };
    }
}

module.exports = {
    name: 'اجازات',
    execute,
    handleInteraction
};
