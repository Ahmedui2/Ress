const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const { isUserOnVacation } = require('../utils/vacationManager.js');
const ms = require('ms');

const name = 'اجازه';
const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

function readData(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return {};
    }
}

function saveData(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error saving ${filePath}:`, error);
        return false;
    }
}

function getAdminRoles() {
    return readData(adminRolesPath) || [];
}

async function execute(message, args, { client, BOT_OWNERS }) {
    const member = message.member;
    const adminRoles = getAdminRoles();
    const isOwner = BOT_OWNERS.includes(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id)) || isOwner;

    if (!hasAdminRole) {
        return message.reply({ content: '❌ هذا الأمر مخصص للإداريين فقط.', ephemeral: true });
    }

    if (isUserOnVacation(member.id)) {
        const alreadyOnVacationEmbed = new EmbedBuilder()
            .setTitle("Vacation Status")
            .setDescription("أنت بالفعل في إجازة حاليًا. لا يمكنك طلب إجازة أخرى.")
            .setColor(colorManager.getColor());
        return message.reply({ embeds: [alreadyOnVacationEmbed] });
    }

    const vacations = readData(vacationsPath);
    if (vacations.pending && vacations.pending[member.id]) {
         const pendingEmbed = new EmbedBuilder()
            .setTitle("Pending Request")
            .setDescription("لديك بالفعل طلب إجازة معلق.")
            .setColor(colorManager.getColor());
        return message.reply({ embeds: [pendingEmbed] });
    }

    const initialEmbed = new EmbedBuilder()
        .setTitle("Vacation Request")
        .setDescription("لتقديم طلب إجازة، يرجى الضغط على الزر أدناه وإدخال التفاصيل المطلوبة.")
        .setColor(colorManager.getColor());

    const requestButton = new ButtonBuilder()
        .setCustomId(`vacation_request_${member.id}`)
        .setLabel("تقديم الطلب")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(requestButton);

    await message.reply({ embeds: [initialEmbed], components: [row] });
}


async function handleInteraction(interaction, context) {
    const { client } = context;
    const member = interaction.member;

    if (interaction.customId.startsWith('vacation_request_')) {
        const vacations = readData(vacationsPath);
        if (vacations.pending && vacations.pending[member.id] || isUserOnVacation(member.id)) {
            return interaction.reply({ content: 'لديك طلب معلق أو أنك في إجازة بالفعل.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`vacation_submit_${member.id}`)
            .setTitle('Vacation Request Details');

        const durationInput = new TextInputBuilder()
            .setCustomId('vacation_duration')
            .setLabel("المدة (مثال: 7d, 12h, 30m)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const reasonInput = new TextInputBuilder()
            .setCustomId('vacation_reason')
            .setLabel("السبب")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(durationInput), new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }

    else if (interaction.customId.startsWith('vacation_submit_')) {
        await interaction.deferUpdate();
        const durationStr = interaction.fields.getTextInputValue('vacation_duration');
        const reason = interaction.fields.getTextInputValue('vacation_reason');
        const durationMs = ms(durationStr);

        if (!durationMs || durationMs <= 0) {
            return interaction.followUp({ content: 'المدة التي أدخلتها غير صالحة. الرجاء استخدام صيغة مثل `7d`, `12h`, `30m`.', ephemeral: true });
        }

        const adminRoles = getAdminRoles();
        const userRoles = member.roles.cache
            .filter(role => adminRoles.includes(role.id))
            .map(role => role.id);

        if (userRoles.length === 0) {
            return interaction.followUp({ content: 'ليس لديك أي رتب إدارية ليتم سحبها.', ephemeral: true });
        }

        const vacations = readData(vacationsPath);
        const settings = vacations.settings || {};
        const approverType = settings.approverType;
        const approverTarget = settings.approverTarget;

        if (!approverType || !approverTarget) {
            return interaction.followUp({ content: 'لم يتم تعيين جهة الموافقة على الإجازات بعد. يرجى التواصل مع الأونر.', ephemeral: true });
        }

        const userId = member.id;
        vacations.pending[userId] = {
            reason: reason,
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + durationMs).toISOString(),
            roles: userRoles,
        };
        saveData(vacationsPath, vacations);

        const requestEmbed = new EmbedBuilder()
            .setTitle("New Vacation Request")
            .setColor(colorManager.getColor())
            .setDescription(`**طلب إجازة جديد من قبل:** ${member}`)
            .addFields(
                { name: "**المدة**", value: ms(durationMs, { long: true }), inline: true },
                { name: "**السبب**", value: reason, inline: false },
                { name: "**الرتب التي سيتم سحبها**", value: userRoles.map(r => `<@&${r}>`).join(', ') || 'لا يوجد', inline: false }
            )
            .setTimestamp();

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vacation_approve_${userId}`).setLabel("قبول").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`vacation_reject_${userId}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
        );

        // Send to the configured destination
        try {
            if (settings.notificationType === 'channel' && settings.notificationChannel) {
                const channel = await client.channels.fetch(settings.notificationChannel);
                await channel.send({ embeds: [requestEmbed], components: [actionRow] });
            } else { // DM by default
                const approvers = await getApprovers(interaction.guild, settings);
                approvers.forEach(approver => {
                    approver.send({ embeds: [requestEmbed], components: [actionRow] }).catch(e => console.error(`Could not DM user ${approver.id}`));
                });
            }
            await interaction.followUp({ content: '✅ تم إرسال طلب إجازتك بنجاح.', ephemeral: true });
        } catch (e) {
            console.error("Failed to send vacation request:", e);
            await interaction.followUp({ content: '❌ حدث خطأ أثناء إرسال طلبك.', ephemeral: true });
        }
    }
}

async function getApprovers(guild, settings) {
    const approvers = new Set();
    if (settings.approverType === 'role') {
        try {
            const role = await guild.roles.fetch(settings.approverTarget);
            role.members.forEach(m => approvers.add(m));
        } catch (e) { console.error("Could not fetch approver role:", e); }
    }
    // Add logic for 'responsibility' and 'owners' in Phase 2
    return Array.from(approvers);
}


module.exports = {
    name,
    execute,
    handleInteraction
};
