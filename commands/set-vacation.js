const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const { createPaginatedResponsibilityArray, handlePaginationInteraction } = require('../utils/responsibilityPagination.js');

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

// Helper to read a JSON file
function readJsonFile(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultData;
}

// Helper to write to the vacations file
function saveVacations(data) {
    try {
        fs.writeFileSync(vacationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing to vacations.json:', error);
        return false;
    }
}

// Helper to create the main status embed
function createStatusEmbed(settings = {}) {
    let approverDisplay = 'Not Set';
    if (settings.approverType === 'owners') {
        approverDisplay = 'Bot Owners';
    } else if (settings.approverType === 'role' && settings.approverTargets && settings.approverTargets.length > 0) {
        approverDisplay = settings.approverTargets.map(id => `<@&${id}>`).join(', ');
    } else if (settings.approverType === 'responsibility' && settings.approverTargets && settings.approverTargets.length > 0) {
        approverDisplay = `Members of: ${settings.approverTargets.join(', ')}`;
    }

    let notificationDisplay = 'Not Set';
    if (settings.notificationMethod === 'dm') {
        notificationDisplay = 'Direct Messages (DM)';
    } else if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
        notificationDisplay = `<#${settings.notificationChannel}>`;
    }

    return new EmbedBuilder()
        .setTitle('Vacation System Setup')
        .setColor(colorManager.getColor() || '#0099ff')
        .setDescription('Configure who approves vacation requests and where notifications are sent.')
        .addFields(
            { name: 'Approver Type', value: `\`${settings.approverType || 'Not Set'}\``, inline: false },
            { name: 'Approvers', value: approverDisplay, inline: false },
            { name: 'Notification Method', value: notificationDisplay, inline: false }
        );
}

module.exports = {
    name: 'set-vacation',
    description: 'Sets up the vacation approval system.',
    async execute(message, args, { BOT_OWNERS }) {
        if (!BOT_OWNERS.includes(message.author.id)) {
            return message.react('❌');
        }

        const vacations = readJsonFile(vacationsPath, { settings: {}, pending: {}, active: {}, pendingTermination: {} });
        const mainEmbed = createStatusEmbed(vacations.settings);

        const mainButtons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('vac_set_approver')
                    .setLabel('Configure Approvers')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('vac_set_notification')
                    .setLabel('Configure Notifications')
                    .setStyle(ButtonStyle.Secondary)
            );

        await message.channel.send({ embeds: [mainEmbed], components: [mainButtons] });
    },

    async handleInteraction(interaction, context) {
        try {
            const { client, BOT_OWNERS } = context;
            if (!BOT_OWNERS.includes(interaction.user.id)) {
                return interaction.reply({ content: 'This is for the bot owner only.', ephemeral: true });
            }

            // التحقق من حالة التفاعل قبل المعالجة
            if (interaction.replied || interaction.deferred) {
                console.log('تم تجاهل تفاعل متكرر في set-vacation');
                return;
            }

            const customId = interaction.customId;
            console.log(`معالجة تفاعل set-vacation: ${customId}`);
            
            let vacations = readJsonFile(vacationsPath, { settings: {}, pending: {}, active: {}, pendingTermination: {} });

        // Main Menu Button Handlers
        if (customId === 'vac_set_approver') {
            const approverButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('vac_choice_owners').setLabel('Owners').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('vac_choice_role').setLabel('Role').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('vac_choice_resp').setLabel('Responsibility').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('vac_back_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ content: 'Choose the type of approver:', embeds: [], components: [approverButtons] });
            return;
        }

        if (customId === 'vac_set_notification') {
            const notificationButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('vac_choice_dm').setLabel('DM').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('vac_choice_channel').setLabel('Channel').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('vac_back_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ content: 'Choose the notification method:', embeds: [], components: [notificationButtons] });
            return;
        }

        // Back Button
        if (customId === 'vac_back_main') {
            const mainEmbed = createStatusEmbed(vacations.settings);
            const mainButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('vac_set_approver').setLabel('Configure Approvers').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('vac_set_notification').setLabel('Configure Notifications').setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ content: null, embeds: [mainEmbed], components: [mainButtons] });
            return;
        }

        // Approver Choice Handlers
        if (customId === 'vac_choice_owners') {
            if (!vacations.settings) vacations.settings = {};
            vacations.settings.approverType = 'owners';
            vacations.settings.approverTargets = [];
            saveVacations(vacations);
            const mainEmbed = createStatusEmbed(vacations.settings);
            await interaction.update({ content: '✅ Approvers set to **Bot Owners**.', embeds: [mainEmbed], components: [] });
            return;
        }

        if (customId === 'vac_choice_role') {
            const roleMenu = new RoleSelectMenuBuilder()
                .setCustomId('vac_role_select')
                .setPlaceholder('Select roles to approve vacations')
                .setMinValues(1)
                .setMaxValues(10);
            const row = new ActionRowBuilder().addComponents(roleMenu);
            await interaction.update({ content: 'Select the roles:', components: [row] });
            return;
        }

        if (customId === 'vac_choice_resp') {
            const responsibilitiesData = readJsonFile(responsibilitiesPath, {});
            const respNames = Object.keys(responsibilitiesData);
            if (respNames.length === 0) {
                 await interaction.update({ content: 'There are no responsibilities configured.', components: [] });
                 return;
            }
            
            const pagination = createPaginatedResponsibilityArray(respNames, 0, 'vac_resp_select', 'Select a responsibility');
            await interaction.update({ content: 'Select the responsibility:', components: pagination.components });
            
            if (pagination.hasMultiplePages) {
                let currentPage = 0;
                const filter = i => i.user.id === interaction.user.id;
                const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000 });
                
                collector.on('collect', async i => {
                    const paginationAction = handlePaginationInteraction(i, 'vac_resp_select');
                    if (paginationAction) {
                        if (paginationAction.action === 'next') {
                            currentPage++;
                        } else if (paginationAction.action === 'prev') {
                            currentPage--;
                        }
                        
                        const newPagination = createPaginatedResponsibilityArray(respNames, currentPage, 'vac_resp_select', 'Select a responsibility');
                        currentPage = newPagination.currentPage;
                        
                        await i.update({ content: 'Select the responsibility:', components: newPagination.components });
                    }
                });
            }
            return;
        }

        // Notification Choice Handlers
        if (customId === 'vac_choice_dm') {
            if (!vacations.settings) vacations.settings = {};
            vacations.settings.notificationMethod = 'dm';
            vacations.settings.notificationChannel = null;
            saveVacations(vacations);
            const mainEmbed = createStatusEmbed(vacations.settings);
            await interaction.update({ content: '✅ Notifications will now be sent via **DM**.', embeds: [mainEmbed], components: [] });
            return;
        }

        if (customId === 'vac_choice_channel') {
            const channelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('vac_channel_select')
                .setPlaceholder('Select a notification channel')
                .addChannelTypes(ChannelType.GuildText);
            const row = new ActionRowBuilder().addComponents(channelMenu);
            await interaction.update({ content: 'Select the channel:', components: [row] });
            return;
        }

        // Select Menu Handlers
        if (interaction.isRoleSelectMenu() && customId === 'vac_role_select') {
            if (!vacations.settings) vacations.settings = {};
            vacations.settings.approverType = 'role';
            vacations.settings.approverTargets = interaction.values;
            saveVacations(vacations);
            const mainEmbed = createStatusEmbed(vacations.settings);
            await interaction.update({ content: '✅ Approver roles have been updated.', embeds: [mainEmbed], components: [] });
            return;
        }

        if (interaction.isChannelSelectMenu() && customId === 'vac_channel_select') {
            if (!vacations.settings) vacations.settings = {};
            vacations.settings.notificationMethod = 'channel';
            vacations.settings.notificationChannel = interaction.values[0];
            saveVacations(vacations);
            const mainEmbed = createStatusEmbed(vacations.settings);
            await interaction.update({ content: '✅ Notification channel has been updated.', embeds: [mainEmbed], components: [] });
            return;
        }

        if (interaction.isStringSelectMenu() && customId === 'vac_resp_select') {
            const selectedResp = interaction.values[0];
            const responsibilitiesData = readJsonFile(responsibilitiesPath, {});
            
            // التحقق من صحة المسؤولية المختارة
            if (!responsibilitiesData[selectedResp]) {
                await interaction.update({ content: '❌ المسؤولية المختارة غير موجودة!', components: [] });
                return;
            }
            
            // التحقق من وجود مسؤولين
            if (!responsibilitiesData[selectedResp].responsibles || responsibilitiesData[selectedResp].responsibles.length === 0) {
                await interaction.update({ 
                    content: `❌ المسؤولية "${selectedResp}" لا تحتوي على أي مسؤولين! يرجى إضافة مسؤولين أولاً قبل استخدامها لنظام الإجازات.`, 
                    components: [] 
                });
                return;
            }
            
            if (!vacations.settings) vacations.settings = {};
            vacations.settings.approverType = 'responsibility';
            vacations.settings.approverTargets = interaction.values;
            saveVacations(vacations);
            const mainEmbed = createStatusEmbed(vacations.settings);
            await interaction.update({ 
                content: `✅ تم تعيين المسؤولية "${selectedResp}" كمعتمد للإجازات (${responsibilitiesData[selectedResp].responsibles.length} مسؤول).`, 
                embeds: [mainEmbed], 
                components: [] 
            });
            return;
        }
        
        } catch (error) {
            console.error('خطأ في معالجة تفاعل set-vacation:', error);
            
            // محاولة الرد بخطأ إذا لم يتم الرد مسبقاً
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ 
                        content: 'حدث خطأ أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.', 
                        ephemeral: true 
                    });
                } catch (replyError) {
                    console.error('فشل في إرسال رسالة الخطأ:', replyError);
                }
            }
        }
    }
};
