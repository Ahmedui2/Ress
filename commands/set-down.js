const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager');
const downManager = require('../utils/downManager');

const name = 'set-down';

// Helper function to read JSON files
function readJsonFile(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultValue;
}

function createStatusEmbed(settings) {
    return new EmbedBuilder()
        .setTitle('⚙️ إعدادات نظام الداون')
        .setColor(colorManager.getColor() || '#0099ff')
        .addFields([
            { 
                name: '📋 روم المنيو', 
                value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', 
                inline: true 
            },
            { 
                name: '📝 روم السجلات', 
                value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', 
                inline: true 
            },
            { 
                name: '👥 المصرح لهم', 
                value: settings.allowedUsers.type ? 
                    `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets.length})` : 
                    'غير محدد', 
                inline: true 
            }
        ])
        .setDescription('إعداد نظام الداون لإدارة الرولات الإدارية')
        .setTimestamp();
}

function getPermissionTypeText(type) {
    switch (type) {
        case 'owners': return 'المالكين';
        case 'roles': return 'رولات محددة';
        case 'responsibility': return 'مسؤوليات محددة';
        default: return 'غير محدد';
    }
}

async function execute(message, args, context) {
    const { client, BOT_OWNERS } = context;

    // Check if user is bot owner
    if (!BOT_OWNERS.includes(message.author.id)) {
        const noPermEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setDescription('❌ **هذا الأمر مخصص لمالكي البوت فقط!**');
        return message.reply({ embeds: [noPermEmbed] });
    }

    const settings = downManager.getSettings();
    const statusEmbed = createStatusEmbed(settings);

    const mainButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('down_set_permissions')
                .setLabel('تحديد المصرح لهم')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('down_set_channels')
                .setLabel('تحديد الرومات')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('down_send_menu')
                .setLabel('إرسال المنيو')
                .setStyle(ButtonStyle.Success)
        );

    await message.reply({ embeds: [statusEmbed], components: [mainButtons] });
}

async function handleInteraction(interaction, context) {
    try {
        const { client, BOT_OWNERS } = context;

        // Check permissions
        if (!BOT_OWNERS.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ هذا الأمر مخصص لمالكي البوت فقط!', ephemeral: true });
        }

        // Check interaction state
        if (interaction.replied || interaction.deferred) {
            console.log('تم تجاهل تفاعل متكرر في set-down');
            return;
        }

        const customId = interaction.customId;
        console.log(`معالجة تفاعل set-down: ${customId}`);
        
        let settings = downManager.getSettings();

        // Main Menu Buttons
        if (customId === 'down_set_permissions') {
            const permissionButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('down_perm_owners').setLabel('المالكين فقط').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('down_perm_roles').setLabel('رولات محددة').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('down_perm_responsibility').setLabel('مسؤوليات محددة').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ content: '👥 **اختر من يمكنه استخدام نظام الداون:**', embeds: [], components: [permissionButtons] });
            return;
        }

        if (customId === 'down_set_channels') {
            const channelButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('down_set_menu_channel').setLabel('تحديد روم المنيو').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('down_set_log_channel').setLabel('تحديد روم السجلات').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
                );
            await interaction.update({ content: '🏠 **اختر الروم المراد تحديده:**', embeds: [], components: [channelButtons] });
            return;
        }

        if (customId === 'down_send_menu') {
            if (!settings.menuChannel) {
                return interaction.update({ content: '❌ **يجب تحديد روم المنيو أولاً!**', embeds: [], components: [] });
            }

            try {
                const menuChannel = await interaction.guild.channels.fetch(settings.menuChannel);
                if (!menuChannel) {
                    return interaction.update({ content: '❌ **روم المنيو غير موجود!**', embeds: [], components: [] });
                }

                // Create menu embed
                const menuEmbed = new EmbedBuilder()
                    .setTitle('🔧 نظام إدارة الداون')
                    .setDescription('اختر الإجراء المطلوب من القائمة أدناه:')
                    .setColor(colorManager.getColor() || '#ff6b6b')
                    .addFields([
                        { name: '🔻 سحب رول', value: 'سحب رول من عضو لمدة محددة أو نهائياً', inline: true },
                        { name: '📊 سجلات الشخص', value: 'عرض سجلات الداون لعضو معين', inline: true },
                        { name: '⏰ تعديل مدة الداون', value: 'تعديل مدة داون حالي', inline: true },
                        { name: '📋 الداونات النشطة', value: 'عرض جميع الداونات الجارية', inline: true },
                        { name: '👤 عرض الداونات على الشخص', value: 'إدارة الداونات لعضو محدد', inline: true }
                    ])
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .setTimestamp();

                const menuSelect = new StringSelectMenuBuilder()
                    .setCustomId('down_main_menu')
                    .setPlaceholder('اختر الإجراء المطلوب...')
                    .addOptions([
                        {
                            label: 'سحب رول',
                            value: 'remove_role',
                            description: 'سحب رول من عضو لمدة محددة أو نهائياً',
                            emoji: '🔻'
                        },
                        {
                            label: 'سجلات الشخص في الداون',
                            value: 'user_records',
                            description: 'عرض سجلات الداون لعضو معين',
                            emoji: '📊'
                        },
                        {
                            label: 'تعديل مدة الداون',
                            value: 'modify_duration',
                            description: 'تعديل مدة داون حالي',
                            emoji: '⏰'
                        },
                        {
                            label: 'الداونات النشطة',
                            value: 'active_downs',
                            description: 'عرض جميع الداونات الجارية ووقت انتهائها',
                            emoji: '📋'
                        },
                        {
                            label: 'عرض الداونات على الشخص',
                            value: 'user_downs',
                            description: 'إدارة الداونات لعضو محدد',
                            emoji: '👤'
                        }
                    ]);

                const menuRow = new ActionRowBuilder().addComponents(menuSelect);

                await menuChannel.send({ embeds: [menuEmbed], components: [menuRow] });
                await interaction.update({ content: '✅ **تم إرسال المنيو بنجاح!**', embeds: [], components: [] });
            } catch (error) {
                console.error('Error sending down menu:', error);
                await interaction.update({ content: '❌ **حدث خطأ أثناء إرسال المنيو!**', embeds: [], components: [] });
            }
            return;
        }

        // Back to main button
        if (customId === 'down_back_main') {
            const mainEmbed = createStatusEmbed(settings);
            const mainButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('down_set_permissions').setLabel('تحديد المصرح لهم').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('down_set_channels').setLabel('تحديد الرومات').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('down_send_menu').setLabel('إرسال المنيو').setStyle(ButtonStyle.Success)
                );
            await interaction.update({ embeds: [mainEmbed], components: [mainButtons] });
            return;
        }

        // Permission selection
        if (customId === 'down_perm_owners') {
            settings.allowedUsers = { type: 'owners', targets: [] };
            downManager.updateSettings(settings);
            
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription('✅ **تم تحديد الصلاحيات للمالكين فقط!**');
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        if (customId === 'down_perm_roles') {
            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId('down_role_select')
                .setPlaceholder('اختر الرولات المسموح لها استخدام النظام...')
                .setMinValues(1)
                .setMaxValues(10);

            const selectRow = new ActionRowBuilder().addComponents(roleSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_set_permissions').setLabel('رجوع').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '👥 **اختر الرولات المسموح لها استخدام نظام الداون:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        // Handle role selection for permissions
        if (interaction.isRoleSelectMenu() && customId === 'down_role_select') {
            const selectedRoles = interaction.values;
            settings.allowedUsers = { type: 'roles', targets: selectedRoles };
            downManager.updateSettings(settings);
            
            const roleNames = selectedRoles.map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return role ? role.name : 'Unknown Role';
            }).join(', ');
            
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`✅ **تم تحديد الصلاحيات للرولات التالية:**\n${roleNames}`);
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        // Handle channel selection for menu
        if (interaction.isChannelSelectMenu() && customId === 'down_menu_channel_select') {
            const selectedChannel = interaction.values[0];
            settings.menuChannel = selectedChannel;
            downManager.updateSettings(settings);
            
            const channel = interaction.guild.channels.cache.get(selectedChannel);
            const channelName = channel ? channel.name : 'Unknown Channel';
            
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`✅ **تم تحديد روم المنيو:**\n<#${selectedChannel}>`);
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        // Handle channel selection for logs  
        if (interaction.isChannelSelectMenu() && customId === 'down_log_channel_select') {
            const selectedChannel = interaction.values[0];
            settings.logChannel = selectedChannel;
            downManager.updateSettings(settings);
            
            const channel = interaction.guild.channels.cache.get(selectedChannel);
            const channelName = channel ? channel.name : 'Unknown Channel';
            
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`✅ **تم تحديد روم السجلات:**\n<#${selectedChannel}>`);
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        // Handle responsibility selection
        if (interaction.isStringSelectMenu() && customId === 'down_responsibility_select') {
            const selectedResponsibilities = interaction.values;
            settings.allowedUsers = { type: 'responsibility', targets: selectedResponsibilities };
            downManager.updateSettings(settings);
            
            const respNames = selectedResponsibilities.join(', ');
            
            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`✅ **تم تحديد الصلاحيات للمسؤوليات التالية:**\n${respNames}`);
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        if (customId === 'down_perm_responsibility') {
            const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
            const responsibilities = readJsonFile(responsibilitiesPath, {});
            const responsibilityNames = Object.keys(responsibilities);

            if (responsibilityNames.length === 0) {
                const noRespEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **لا توجد مسؤوليات في النظام!**');
                const backButton = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
                await interaction.update({ embeds: [noRespEmbed], components: [backButton] });
                return;
            }

            const respOptions = responsibilityNames.slice(0, 25).map(name => ({
                label: name,
                value: name,
                description: `تحديد مسؤولية: ${name}`
            }));

            const respSelect = new StringSelectMenuBuilder()
                .setCustomId('down_responsibility_select')
                .setPlaceholder('اختر المسؤوليات المسموح لها استخدام النظام...')
                .setMinValues(1)
                .setMaxValues(Math.min(respOptions.length, 10))
                .addOptions(respOptions);

            const selectRow = new ActionRowBuilder().addComponents(respSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_set_permissions').setLabel('رجوع').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '📋 **اختر المسؤوليات المسموح لها استخدام نظام الداون:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        // Channel selection
        if (customId === 'down_set_menu_channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('down_menu_channel_select')
                .setPlaceholder('اختر روم المنيو...')
                .setChannelTypes(ChannelType.GuildText);

            const selectRow = new ActionRowBuilder().addComponents(channelSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_set_channels').setLabel('رجوع').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '📋 **اختر الروم الذي سيتم إرسال المنيو فيه:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        if (customId === 'down_set_log_channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('down_log_channel_select')
                .setPlaceholder('اختر روم السجلات...')
                .setChannelTypes(ChannelType.GuildText);

            const selectRow = new ActionRowBuilder().addComponents(channelSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_set_channels').setLabel('رجوع').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '📝 **اختر الروم الذي سيتم إرسال السجلات فيه:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }



        // Handle string select menus (responsibilities)
        if (interaction.isStringSelectMenu() && customId === 'down_responsibility_select') {
            const selectedResponsibilities = interaction.values;
            settings.allowedUsers = { type: 'responsibility', targets: selectedResponsibilities };
            downManager.updateSettings(settings);

            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`✅ **تم تحديد الصلاحيات للمسؤوليات:** \n${selectedResponsibilities.map(r => `• ${r}`).join('\n')}`);
            
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
            
            await interaction.update({ embeds: [successEmbed], components: [backButton] });
            return;
        }

        if (interaction.isChannelSelectMenu()) {
            if (customId === 'down_menu_channel_select') {
                const selectedChannel = interaction.values[0];
                settings.menuChannel = selectedChannel;
                downManager.updateSettings(settings);

                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setDescription(`✅ **تم تحديد روم المنيو:** <#${selectedChannel}>`);
                
                const backButton = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
                
                await interaction.update({ embeds: [successEmbed], components: [backButton] });
                return;
            }

            if (customId === 'down_log_channel_select') {
                const selectedChannel = interaction.values[0];
                settings.logChannel = selectedChannel;
                downManager.updateSettings(settings);

                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setDescription(`✅ **تم تحديد روم السجلات:** <#${selectedChannel}>`);
                
                const backButton = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('down_back_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary));
                
                await interaction.update({ embeds: [successEmbed], components: [backButton] });
                return;
            }
        }

    } catch (error) {
        console.error('Error in set-down handleInteraction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة التفاعل!', ephemeral: true });
        }
    }
}

module.exports = { name, execute, handleInteraction };