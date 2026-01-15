const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, ChannelSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager');

const interactiveRolesPath = path.join(__dirname, '..', 'data', 'interactiveRoles.json');

function loadSettings() {
    try {
        if (fs.existsSync(interactiveRolesPath)) {
            return JSON.parse(fs.readFileSync(interactiveRolesPath, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading interactive roles settings:', error);
    }
    return {
        settings: { approvers: [], interactiveRoles: [], requestChannel: null },
        pendingRequests: {},
        cooldowns: {}
    };
}

function saveSettings(data) {
    try {
        fs.writeFileSync(interactiveRolesPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving interactive roles settings:', error);
        return false;
    }
}

function hasPermission(member) {
    const isGuildOwner = member.guild.ownerId === member.id;
    const botConfigPath = path.join(__dirname, '..', 'data', 'botConfig.json');
    let BOT_OWNERS = global.BOT_OWNERS || [];
    if (BOT_OWNERS.length === 0) {
        try {
            if (fs.existsSync(botConfigPath)) {
                const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
                BOT_OWNERS = botConfig.owners || [];
            }
        } catch (e) {}
    }
    return isGuildOwner || BOT_OWNERS.includes(member.id);
}

module.exports = {
    name: 'setactive',
    description: 'إعداد نظام الرولات التفاعلية',
    async execute(interaction) {
        if (!hasPermission(interaction.member)) {
            return interaction.reply({ content: '**لا تملك صلاحية لاستخدام هذا الأمر.**', ephemeral: true });
        }

        const settings = loadSettings();
        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات الرولات التفاعلية')
            .setDescription('**الرجاء اختيار الإعداد الذي ترغب في تعديله من القائمة أدناه:**')
            .setColor(colorManager.getColor ? colorManager.getColor() : '#0099ff')
            .setTimestamp();

        const menu = new StringSelectMenuBuilder()
            .setCustomId('setactive_main_menu')
            .setPlaceholder('اختر الإعداد...')
            .addOptions([
                { label: 'تحديد المسؤولين', description: 'تحديد الرولات التي يمكنها قبول/رفض الطلبات', value: 'set_approvers', emoji: '👮' },
                { label: 'الرولات التفاعلية', description: 'إضافة أو إزالة الرولات التي يمكن طلبها', value: 'set_roles', emoji: '🎭' },
                { label: 'روم الطلبات', description: 'تحديد الروم التي يتم فيها معالجة الطلبات', value: 'set_channel', emoji: '📍' },
                { label: 'عرض الإعدادات', description: 'عرض الإعدادات الحالية للنظام', value: 'show_settings', emoji: '📊' }
            ]);

        const row = new ActionRowBuilder().addComponents(menu);
        await interaction.reply({ embeds: [embed], components: [row] });
    }
};

// Interaction Handler for setactive
async function handleSetActiveInteraction(interaction) {
    if (!interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isButton()) return;
    if (!interaction.customId.startsWith('setactive_')) return;
    if (!hasPermission(interaction.member)) return interaction.reply({ content: '❌ لا تملك صلاحية.', ephemeral: true });

    const settings = loadSettings();
    const customId = interaction.customId;

    if (customId === 'setactive_main_menu') {
        const value = interaction.values[0];
        if (value === 'set_approvers') {
            const roleMenu = new RoleSelectMenuBuilder()
                .setCustomId('setactive_select_approvers')
                .setPlaceholder('اختر رولات المسؤولين...')
                .setMinValues(1)
                .setMaxValues(10);
            const row = new ActionRowBuilder().addComponents(roleMenu);
            await interaction.update({ content: '**الرجاء اختيار الرولات التي يحق لها القبول والرفض:**', embeds: [], components: [row] });
        } else if (value === 'set_roles') {
            const roleMenu = new RoleSelectMenuBuilder()
                .setCustomId('setactive_select_interactive_roles')
                .setPlaceholder('اختر الرولات التفاعلية...')
                .setMinValues(1)
                .setMaxValues(10);
            const row = new ActionRowBuilder().addComponents(roleMenu);
            await interaction.update({ content: '**الرجاء اختيار الرولات التي ستكون متاحة كـ "رولات تفاعلية":**', embeds: [], components: [row] });
        } else if (value === 'set_channel') {
            const channelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('setactive_select_channel')
                .setPlaceholder('اختر الروم...')
                .addChannelTypes(ChannelType.GuildText);
            const row = new ActionRowBuilder().addComponents(channelMenu);
            await interaction.update({ content: '**الرجاء اختيار الروم التي سيتم فيها استقبال ومعالجة الطلبات:**', embeds: [], components: [row] });
        } else if (value === 'show_settings') {
            const approvers = settings.settings.approvers.map(id => `<@&${id}>`).join(', ') || 'لا يوجد';
            const roles = settings.settings.interactiveRoles.map(id => `<@&${id}>`).join(', ') || 'لا يوجد';
            const channel = settings.settings.requestChannel ? `<#${settings.settings.requestChannel}>` : 'لا يوجد';

            const embed = new EmbedBuilder()
                .setTitle('📊 الإعدادات الحالية')
                .addFields(
                    { name: '👮 المسؤولين', value: approvers, inline: false },
                    { name: '🎭 الرولات التفاعلية', value: roles, inline: false },
                    { name: '📍 روم الطلبات', value: channel, inline: false }
                )
                .setColor(colorManager.getColor ? colorManager.getColor() : '#00ff00');
            
            const backButton = new ButtonBuilder().setCustomId('setactive_back').setLabel('رجوع').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(backButton);
            await interaction.update({ embeds: [embed], components: [row], content: null });
        }
    } else if (customId === 'setactive_select_approvers') {
        settings.settings.approvers = interaction.values;
        saveSettings(settings);
        await interaction.update({ content: '✅ تم تحديث رولات المسؤولين بنجاح!', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setactive_back').setLabel('رجوع').setStyle(ButtonStyle.Primary))] });
    } else if (customId === 'setactive_select_interactive_roles') {
        settings.settings.interactiveRoles = interaction.values;
        saveSettings(settings);
        await interaction.update({ content: '✅ تم تحديث الرولات التفاعلية بنجاح!', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setactive_back').setLabel('رجوع').setStyle(ButtonStyle.Primary))] });
    } else if (customId === 'setactive_select_channel') {
        settings.settings.requestChannel = interaction.values[0];
        saveSettings(settings);
        await interaction.update({ content: `✅ تم تحديد <#${interaction.values[0]}> كروم للطلبات بنجاح!`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setactive_back').setLabel('رجوع').setStyle(ButtonStyle.Primary))] });
    } else if (customId === 'setactive_back') {
        // Re-execute the main menu logic
        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات الرولات التفاعلية')
            .setDescription('**الرجاء اختيار الإعداد الذي ترغب في تعديله من القائمة أدناه:**')
            .setColor(colorManager.getColor ? colorManager.getColor() : '#0099ff');
        const menu = new StringSelectMenuBuilder()
            .setCustomId('setactive_main_menu')
            .setPlaceholder('اختر الإعداد...')
            .addOptions([
                { label: 'تحديد المسؤولين', value: 'set_approvers', emoji: '👮' },
                { label: 'الرولات التفاعلية', value: 'set_roles', emoji: '🎭' },
                { label: 'روم الطلبات', value: 'set_channel', emoji: '📍' },
                { label: 'عرض الإعدادات', value: 'show_settings', emoji: '📊' }
            ]);
        await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], content: null });
    }
}

module.exports.handleSetActiveInteraction = handleSetActiveInteraction;
