const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager.js');
const vacationManager = require('../utils/vacationManager.js');

const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

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

    const replyEmbed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff');

    if (!isOwner && !hasAdminRole) {
        replyEmbed.setDescription('❌ **This command is for administrators only.**');
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    const settings = vacationManager.getSettings();
    if (!settings.approverType || !settings.notificationMethod) {
        replyEmbed.setDescription('⚠️ The vacation system has not been fully configured yet. Please ask the bot owner to use `set-vacation`.');
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    if (vacationManager.isUserOnVacation(member.id)) {
        replyEmbed.setDescription("You are already on vacation.");
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
    if (vacations.pending?.[member.id]) {
        replyEmbed.setDescription("You already have a pending vacation request.");
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    replyEmbed.setDescription("Click the button below to open the vacation request form.");
    const requestButton = new ButtonBuilder()
        .setCustomId(`vac_request_start_${member.id}`)
        .setLabel("Request Vacation")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(requestButton);
    await message.reply({ embeds: [replyEmbed], components: [row] });
}

async function handleInteraction(interaction, context) {
    const { client, BOT_OWNERS } = context;
    const customId = interaction.customId;

    const replyEmbed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff');

    if (customId.startsWith('vac_request_start_')) {
        const userId = customId.split('_').pop();
        if (interaction.user.id !== userId) {
            replyEmbed.setDescription("You can only request a vacation for yourself.");
            return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
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
            replyEmbed.setDescription('Invalid duration format. Please use a format like `7d`, `12h`, or `30m`.');
            return interaction.editReply({ embeds: [replyEmbed] });
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
            replyEmbed.setDescription('Could not find any valid approvers based on the current settings.');
            return interaction.editReply({ embeds: [replyEmbed] });
        }

        const adminRoles = readJson(adminRolesPath, []);
        const rolesToBeRemoved = member.roles.cache.filter(role => adminRoles.includes(role.id));
        const rolesDisplay = rolesToBeRemoved.map(r => `<@&${r.id}>`).join(', ') || 'None';

        const embed = new EmbedBuilder()
            .setTitle("New Vacation Request")
            .setColor(colorManager.getColor('pending') || '#E67E22')
            .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
            .addFields(
                { name: "___User___", value: `${member}`, inline: true },
                { name: "___Duration___", value: `**${ms(durationMs, { long: true })}**`, inline: true },
                { name: "___Reason___", value: reason, inline: false },
                { name: "___Roles to be Removed___", value: rolesDisplay, inline: false }
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

        replyEmbed.setDescription('✅ **Your vacation request has been submitted for approval.**');
        await interaction.editReply({ embeds: [replyEmbed] });
    }
}

module.exports = {
    name: 'اجازه',
    execute,
    handleInteraction
};
