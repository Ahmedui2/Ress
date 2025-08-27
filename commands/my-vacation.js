const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager.js');

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

async function execute(message, args, { client, BOT_OWNERS }) {
    const member = message.member;
    const adminRoles = readJson(adminRolesPath, []);
    const isOwner = BOT_OWNERS.includes(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!isOwner && !hasAdminRole) {
        return message.reply({ content: '❌ This command is for administrators only.', ephemeral: true });
    }

    let targetUser = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
    if (!targetUser) {
        targetUser = message.author;
    }

    const vacations = readJson(vacationsPath);
    const activeVacation = vacations.active?.[targetUser.id];

    if (!activeVacation) {
        const desc = targetUser.id === message.author.id ? 'You are not currently on vacation.' : `${targetUser.tag} is not currently on vacation.`;
        const noVacationEmbed = new EmbedBuilder().setDescription(desc).setColor(colorManager.getColor());
        return message.reply({ embeds: [noVacationEmbed] });
    }

    const remainingTime = new Date(activeVacation.endDate).getTime() - Date.now();

    const statusEmbed = new EmbedBuilder()
        .setTitle(`Vacation Status for ${targetUser.username}`)
        .setColor(colorManager.getColor('active') || '#2ECC71')
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: "Status", value: "On Vacation", inline: true },
            { name: "Time Remaining", value: remainingTime > 0 ? ms(remainingTime, { long: true }) : "Ended", inline: true },
            { name: "Approved By", value: activeVacation.approvedBy ? `<@${activeVacation.approvedBy}>` : 'Unknown', inline: true },
            { name: "Removed Roles", value: activeVacation.removedRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: false }
        )
        .setFooter({ text: `Start Date: ${new Date(activeVacation.startDate).toLocaleDateString()}`})
        .setTimestamp();

    const components = [];
    if (targetUser.id === message.author.id) {
        const endButton = new ButtonBuilder()
            .setCustomId(`vac_end_request_${targetUser.id}`)
            .setLabel("Request to End Vacation Early")
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(endButton);
        components.push(row);
    }

    await message.reply({ embeds: [statusEmbed], components: components });
}


async function handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('vac_end_request_')) return;

    const userId = interaction.customId.split('_').pop();
    if (interaction.user.id !== userId) {
        return interaction.reply({ content: "You can only interact with your own vacation request.", ephemeral: true });
    }

    const confirmButton = new ButtonBuilder()
        .setCustomId(`vac_end_confirm_${userId}`)
        .setLabel("Yes, send request")
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('vac_end_cancel')
        .setLabel("No, cancel")
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    await interaction.reply({
        content: 'Are you sure you want to request an early end to your vacation? This will require approval from the original approvers.',
        components: [row],
        ephemeral: true
    });
}

module.exports = {
    name: 'اجازتي',
    execute,
    handleInteraction
};
