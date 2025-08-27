const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const ms = require('ms');

const name = 'اجازتي';
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

    let targetUser = message.mentions.users.first() || client.users.cache.get(args[0]);
    if (!targetUser) {
        targetUser = message.author;
    }

    const vacations = readData(vacationsPath);
    const activeVacation = vacations.active ? vacations.active[targetUser.id] : null;

    if (!activeVacation) {
        const noVacationEmbed = new EmbedBuilder()
            .setTitle("Vacation Status")
            .setDescription(targetUser.id === message.author.id ? 'أنت لست في إجازة حاليًا.' : `${targetUser.username} ليس في إجازة حاليًا.`)
            .setColor(colorManager.getColor());
        return message.reply({ embeds: [noVacationEmbed] });
    }

    const remainingTime = new Date(activeVacation.endDate).getTime() - Date.now();
    const approver = activeVacation.approvedBy ? `<@${activeVacation.approvedBy}>` : 'غير معروف';
    const roles = activeVacation.roles.map(r => `<@&${r}>`).join(', ') || 'لا يوجد';

    const statusEmbed = new EmbedBuilder()
        .setTitle(`Vacation Status for ${targetUser.username}`)
        .setColor(colorManager.getColor())
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: "**الحالة**", value: "في إجازة", inline: true },
            { name: "**الوقت المتبقي**", value: remainingTime > 0 ? ms(remainingTime, { long: true }) : "انتهت", inline: true },
            { name: "**تمت الموافقة بواسطة**", value: approver, inline: true },
            { name: "**الرولات المسحوبة**", value: roles, inline: false }
        );

    const components = [];
    if (targetUser.id === message.author.id) {
        const endVacationButton = new ButtonBuilder()
            .setCustomId(`vacation_end_request_${targetUser.id}`)
            .setLabel("إنهاء الاجازه")
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(endVacationButton);
        components.push(row);
    }

    await message.reply({ embeds: [statusEmbed], components: components });
}


async function handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('vacation_end_request_')) {
        return;
    }

    const userId = interaction.customId.split('_').pop();

    if (interaction.user.id !== userId) {
        return interaction.reply({ content: 'You can only end your own vacation.', ephemeral: true });
    }

    // Add a confirmation step
    const confirmButton = new ButtonBuilder()
        .setCustomId(`vacation_end_confirm_${userId}`)
        .setLabel("Yes, end my vacation")
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId(`vacation_end_cancel_${userId}`)
        .setLabel("No, keep it")
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    await interaction.reply({
        content: 'Are you sure you want to end your vacation early?',
        components: [row],
        ephemeral: true
    });
}

module.exports = {
    name,
    execute,
    handleInteraction
};
