const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager.js');
const vacationManager = require('../utils/vacationManager.js');

const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

// Helper to read a JSON file
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
    const member = message.member;
    const adminRoles = readJson(adminRolesPath, []);
    const isOwner = BOT_OWNERS.includes(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id));

    if (!isOwner && !hasAdminRole) {
        return message.reply({ content: '❌ This command is for administrators only.', ephemeral: true });
    }

    const settings = vacationManager.getSettings();
    if (!settings.approverType || !settings.notificationMethod) {
        return message.reply({ content: 'The vacation system has not been fully configured yet. Please ask the bot owner to use `set-vacation`.', ephemeral: true });
    }

    if (vacationManager.isUserOnVacation(member.id)) {
        return message.reply({ content: "You are already on vacation.", ephemeral: true });
    }

    const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
    if (vacations.pending?.[member.id]) {
        return message.reply({ content: "You already have a pending vacation request.", ephemeral: true });
    }

    const requestButton = new ButtonBuilder()
        .setCustomId(`vac_request_start_${member.id}`)
        .setLabel("Request Vacation")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(requestButton);
    await message.reply({ content: "Click the button to open the vacation request form.", components: [row] });
}

async function handleInteraction(interaction, context) {
    const { client, BOT_OWNERS } = context;
    const customId = interaction.customId;

    if (customId.startsWith('vac_request_start_')) {
        const userId = customId.split('_').pop();
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: "You can only request a vacation for yourself.", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`vac_request_modal_${userId}`)
            .setTitle('Vacation Request Form');

        const durationInput = new TextInputBuilder().setCustomId('vac_duration').setLabel("Duration (e.g., 7d, 12h, 30m)").setStyle(TextInputStyle.Short).setRequired(true);
        const reasonInput = new TextInputBuilder().setCustomId('vac_reason').setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(durationInput), new ActionRowBuilder().addComponents(reasonInput));

        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && customId.startsWith('vac_request_modal_')) {
        await interaction.deferReply({ ephemeral: true });

        const userId = customId.split('_').pop();
        const member = await interaction.guild.members.fetch(userId);
        const durationStr = interaction.fields.getTextInputValue('vac_duration');
        const reason = interaction.fields.getTextInputValue('vac_reason');

        const durationMs = ms(durationStr);
        if (!durationMs || durationMs <= 0) {
            return interaction.editReply({ content: 'Invalid duration format. Please use a format like `7d`, `12h`, or `30m`.' });
        }

        const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
        vacations.pending[userId] = {
            reason: reason,
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + durationMs).toISOString(),
        };
        vacationManager.saveVacations(vacations);

        // --- Notification Logic ---
        const settings = vacationManager.getSettings();
        const approvers = await vacationManager.getApprovers(interaction.guild, settings, BOT_OWNERS);

        if (approvers.length === 0) {
            return interaction.editReply({ content: 'Could not find any valid approvers based on the current settings.' });
        }

        const embed = new EmbedBuilder()
            .setTitle("New Vacation Request")
            .setColor(colorManager.getColor('pending') || '#E67E22')
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .addFields(
                { name: "User", value: `${member}`, inline: true },
                { name: "Duration", value: ms(durationMs, { long: true }), inline: true },
                { name: "Reason", value: reason, inline: false }
            )
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`vac_approve_${userId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`vac_reject_${userId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );

        if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
            const channel = await client.channels.fetch(settings.notificationChannel).catch(() => null);
            if (channel) {
                await channel.send({ embeds: [embed], components: [buttons] });
            }
        } else { // DM by default
            for (const approver of approvers) {
                await approver.send({ embeds: [embed], components: [buttons] }).catch(e => console.error(`Could not DM user ${approver.id}`));
            }
        }

        await interaction.editReply({ content: '✅ Your vacation request has been submitted for approval.' });
    }
}

module.exports = {
    name: 'اجازه',
    execute,
    handleInteraction
};
