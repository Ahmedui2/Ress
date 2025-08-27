const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const vacationManager = require('../utils/vacationManager');
const colorManager = require('../utils/colorManager');
const { BOT_OWNERS } = require('../index.js');


module.exports = {
    name: 'vacation-requests',
    description: 'Manage pending vacation requests.',
    async execute(message, args) {
        // This command should be handled via interactions, but we add a message command for completeness.
        if (!BOT_OWNERS.includes(message.author.id)) {
            return message.reply({ content: 'This command is for the bot owner only.', ephemeral: true });
        }

        const pending = vacationManager.getPendingVacations();
        const pendingUsers = Object.keys(pending);

        if (pendingUsers.length === 0) {
            return message.reply('There are no pending vacation requests.');
        }

        const embed = new EmbedBuilder()
            .setTitle('Pending Vacation Requests')
            .setColor(colorManager.getColor('pending') || '#E67E22')
            .setDescription(`Found ${pendingUsers.length} pending request(s).`);

        await message.channel.send({ embeds: [embed] });

        for (const userId of pendingUsers) {
            const request = pending[userId];
            const user = await message.client.users.fetch(userId).catch(() => ({ username: 'Unknown User' }));

            const requestEmbed = new EmbedBuilder()
                .setColor(colorManager.getColor('pending') || '#E67E22')
                .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
                .setTitle(`Request from ${user.username}`)
                .addFields(
                    { name: 'User ID', value: userId, inline: false },
                    { name: 'Start Date', value: new Date(request.startDate).toLocaleDateString(), inline: true },
                    { name: 'End Date', value: new Date(request.endDate).toLocaleDateString(), inline: true },
                    { name: 'Reason', value: request.reason, inline: false }
                )
                .setFooter({ text: `Request ID: ${userId}` });

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vacation_approve_${userId}`)
                        .setLabel('Approve')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`vacation_reject_${userId}`)
                        .setLabel('Reject')
                        .setStyle(ButtonStyle.Danger)
                );

            await message.channel.send({ embeds: [requestEmbed], components: [buttons] });
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return;
        if (!BOT_OWNERS.includes(interaction.user.id)) {
            return interaction.reply({ content: 'This action is for the bot owner only.', ephemeral: true });
        }

        const [action, decision, userId] = interaction.customId.split('_');

        if (action !== 'vacation') return;

        const request = vacationManager.getPendingVacations()[userId];
        if (!request) {
            await interaction.update({ content: 'This request has already been handled.', components: [] });
            return;
        }

        const user = await interaction.client.users.fetch(userId).catch(() => null);

        if (decision === 'approve') {
            const result = vacationManager.approveVacation(userId, interaction.user.id);
            if (result.success) {
                const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(colorManager.getColor('approved') || '#2ECC71')
                    .addFields({ name: 'Status', value: `Approved by ${interaction.user.username}` })
                    .setTitle(`Request from ${user.username} (Approved)`);

                await interaction.update({ embeds: [approvedEmbed], components: [] });

                if (user) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Vacation Request Approved')
                        .setColor(colorManager.getColor('approved') || '#2ECC71')
                        .setDescription('Your vacation request has been approved.')
                        .addFields(
                            { name: 'Start Date', value: new Date(result.vacation.startDate).toLocaleDateString() },
                            { name: 'End Date', value: new Date(result.vacation.endDate).toLocaleDateString() }
                        )
                        .setFooter({ text: 'Enjoy your time off!' });
                    await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM user ${userId}: ${err}`));
                }
            } else {
                await interaction.reply({ content: `Failed to approve: ${result.message}`, ephemeral: true });
            }
        } else if (decision === 'reject') {
            const result = vacationManager.rejectVacation(userId, interaction.user.id);
             if (result.success) {
                const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(colorManager.getColor('rejected') || '#E74C3C')
                    .addFields({ name: 'Status', value: `Rejected by ${interaction.user.username}` })
                    .setTitle(`Request from ${user.username} (Rejected)`);

                await interaction.update({ embeds: [rejectedEmbed], components: [] });

                if (user) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Vacation Request Rejected')
                        .setColor(colorManager.getColor('rejected') || '#E74C3C')
                        .setDescription('Unfortunately, your vacation request has been rejected.')
                        .setFooter({ text: 'Please contact an admin for more information.' });
                    await user.send({ embeds: [dmEmbed] }).catch(err => console.log(`Failed to DM user ${userId}: ${err}`));
                }
            } else {
                 await interaction.reply({ content: `Failed to reject: ${result.message}`, ephemeral: true });
            }
        }
    }
};
