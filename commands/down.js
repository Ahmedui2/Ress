const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager');
const downManager = require('../utils/downManager');

const name = 'down';

// Helper function to read JSON files
function readJson(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultValue;
}

async function execute(message, args, context) {
    const { client, BOT_OWNERS } = context;

    // Check if user is owner only
    if (!BOT_OWNERS.includes(message.author.id)) {
        const noPermEmbed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setDescription('❌ **هذا الأمر مخصص للمالكين فقط!**\n\n**للاستخدام العادي:** توجه للمنيو الثابت في الروم المحدد.');
        return message.reply({ embeds: [noPermEmbed] });
    }

    // Create main menu embed
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
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
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
    await message.reply({ embeds: [menuEmbed], components: [menuRow] });
}

async function handleInteraction(interaction, context) {
    try {
        const { client, BOT_OWNERS } = context;

        // Check interaction validity
        if (interaction.replied || interaction.deferred) {
            console.log('تم تجاهل تفاعل متكرر في down');
            return;
        }

        // Check permissions
        const hasPermission = await downManager.hasPermission(interaction, BOT_OWNERS);
        if (!hasPermission) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
        }

        const customId = interaction.customId;
        console.log(`معالجة تفاعل down: ${customId}`);

        // Main menu selection
        if (interaction.isStringSelectMenu() && customId === 'down_main_menu') {
            const selectedValue = interaction.values[0];

            switch (selectedValue) {
                case 'remove_role':
                    await handleRemoveRole(interaction, context);
                    break;
                case 'user_records':
                    await handleUserRecords(interaction, context);
                    break;
                case 'modify_duration':
                    await handleModifyDuration(interaction, context);
                    break;
                case 'active_downs':
                    await handleActiveDowns(interaction, context);
                    break;
                case 'user_downs':
                    await handleUserDowns(interaction, context);
                    break;
            }
            return;
        }

        // Handle other interactions
        if (customId.startsWith('down_remove_user_select')) {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('down_selected_user')
                .setPlaceholder('اختر العضو المراد سحب الرول منه...');

            const selectRow = new ActionRowBuilder().addComponents(userSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '👤 **اختر العضو المراد سحب الرول منه:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        if (interaction.isUserSelectMenu() && customId === 'down_selected_user') {
            const selectedUserId = interaction.values[0];
            const selectedUser = await interaction.guild.members.fetch(selectedUserId);
            
            // Get admin roles that the user has
            const adminRoles = downManager.getAdminRoles();
            const userAdminRoles = selectedUser.roles.cache.filter(role => adminRoles.includes(role.id));

            if (userAdminRoles.size === 0) {
                const noRolesEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **هذا العضو لا يملك أي رولات إدارية!**');
                
                const backButton = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));
                
                await interaction.update({ embeds: [noRolesEmbed], components: [backButton] });
                return;
            }

            // Create role selection menu
            const roleOptions = userAdminRoles.map(role => ({
                label: role.name,
                value: `${selectedUserId}_${role.id}`,
                description: `سحب رول ${role.name} من ${selectedUser.displayName}`
            }));

            const roleSelect = new StringSelectMenuBuilder()
                .setCustomId('down_role_selection')
                .setPlaceholder('اختر الرول المراد سحبه...')
                .addOptions(roleOptions);

            const selectRow = new ActionRowBuilder().addComponents(roleSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: `🔻 **اختر الرول المراد سحبه من ${selectedUser.displayName}:**`, 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        if (interaction.isStringSelectMenu() && customId === 'down_role_selection') {
            const [userId, roleId] = interaction.values[0].split('_');
            
            // Create modal for duration and reason
            const modal = new ModalBuilder()
                .setCustomId(`down_modal_${userId}_${roleId}`)
                .setTitle('تفاصيل الداون');

            const durationInput = new TextInputBuilder()
                .setCustomId('down_duration')
                .setLabel('المدة (مثل: 7d أو 12h أو permanent)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('7d, 12h, 30m, permanent');

            const reasonInput = new TextInputBuilder()
                .setCustomId('down_reason')
                .setLabel('السبب')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder('اذكر سبب سحب الرول...');

            modal.addComponents(
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(reasonInput)
            );

            await interaction.showModal(modal);
            return;
        }

        // Handle modal submission
        if (interaction.isModalSubmit() && customId.startsWith('down_modal_')) {
            const [_, __, userId, roleId] = customId.split('_');
            const duration = interaction.fields.getTextInputValue('down_duration').trim();
            const reason = interaction.fields.getTextInputValue('down_reason').trim();

            // Validate duration format
            if (duration !== 'permanent' && !ms(duration)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **صيغة المدة غير صحيحة!**\nاستخدم: 7d للأيام، 12h للساعات، 30m للدقائق، أو permanent للدائم');
                
                return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

            // Apply the down
            const result = await downManager.createDown(
                interaction.guild,
                client,
                userId,
                roleId,
                duration,
                reason,
                interaction.user.id
            );

            if (result.success) {
                const member = await interaction.guild.members.fetch(userId);
                const role = await interaction.guild.roles.fetch(roleId);
                
                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ تم تطبيق الداون بنجاح')
                    .addFields([
                        { name: 'العضو', value: `${member}`, inline: true },
                        { name: 'الرول', value: `${role}`, inline: true },
                        { name: 'المدة', value: duration === 'permanent' ? 'نهائي' : duration, inline: true },
                        { name: 'السبب', value: reason, inline: false }
                    ])
                    .setTimestamp();

                await interaction.reply({ embeds: [successEmbed] });
            } else {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription(`❌ **فشل في تطبيق الداون:** ${result.error}`);
                
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            return;
        }

        // Handle user records selection
        if (customId === 'down_records_user_select') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('down_show_user_records')
                .setPlaceholder('اختر العضو لعرض سجلاته...');

            const selectRow = new ActionRowBuilder().addComponents(userSelect);
            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

            await interaction.update({ 
                content: '👤 **اختر العضو لعرض سجلاته في نظام الداون:**', 
                embeds: [], 
                components: [selectRow, backButton] 
            });
            return;
        }

        if (interaction.isUserSelectMenu() && customId === 'down_show_user_records') {
            const userId = interaction.values[0];
            const member = await interaction.guild.members.fetch(userId);
            const records = downManager.getUserDownHistory(userId);

            if (records.length === 0) {
                const noRecordsEmbed = new EmbedBuilder()
                    .setColor('#ffaa00')
                    .setDescription(`📊 **لا توجد سجلات داون للعضو ${member}**`);
                
                const backButton = new ActionRowBuilder()
                    .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));
                
                await interaction.update({ embeds: [noRecordsEmbed], components: [backButton] });
                return;
            }

            const recordsEmbed = new EmbedBuilder()
                .setTitle(`📊 سجلات الداون - ${member.displayName}`)
                .setColor(colorManager.getColor() || '#0099ff')
                .setThumbnail(member.displayAvatarURL({ dynamic: true }));

            // Show last 10 records
            const recentRecords = records.slice(-10);
            let recordText = '';

            for (const record of recentRecords) {
                const role = await interaction.guild.roles.fetch(record.data.roleId).catch(() => null);
                const byUser = await client.users.fetch(record.data.byUserId).catch(() => null);
                
                recordText += `**${record.type === 'DOWN_APPLIED' ? '🔻 تطبيق' : '🔺 إنهاء'}** - ${role ? role.name : 'رول محذوف'}\n`;
                recordText += `المدة: ${record.data.duration || 'نهائي'} | بواسطة: ${byUser ? byUser.username : 'مستخدم محذوف'}\n`;
                recordText += `<t:${Math.floor(record.timestamp / 1000)}:R>\n\n`;
            }

            recordsEmbed.setDescription(recordText || 'لا توجد سجلات');
            recordsEmbed.setFooter({ text: `إجمالي السجلات: ${records.length}` });

            const backButton = new ActionRowBuilder()
                .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

            await interaction.update({ embeds: [recordsEmbed], components: [backButton] });
            return;
        }

        // Handle modify duration selection
        if (interaction.isStringSelectMenu() && customId === 'down_modify_selection') {
            const selectedDownId = interaction.values[0];
            
            // Create modal for new duration
            const modal = new ModalBuilder()
                .setCustomId(`down_modify_modal_${selectedDownId}`)
                .setTitle('تعديل مدة الداون');

            const newDurationInput = new TextInputBuilder()
                .setCustomId('new_duration')
                .setLabel('المدة الجديدة (مثل: 7d أو 12h أو permanent)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('7d, 12h, 30m, permanent');

            modal.addComponents(new ActionRowBuilder().addComponents(newDurationInput));
            await interaction.showModal(modal);
            return;
        }

        // Handle modify duration modal
        if (interaction.isModalSubmit() && customId.startsWith('down_modify_modal_')) {
            const selectedDownId = customId.replace('down_modify_modal_', '');
            const newDuration = interaction.fields.getTextInputValue('new_duration').trim();

            // Validate duration
            if (newDuration !== 'permanent' && !ms(newDuration)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ **صيغة المدة غير صحيحة!**\nاستخدم: 7d للأيام، 12h للساعات، 30m للدقائق، أو permanent للدائم');
                
                return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

            // Modify the down duration
            const result = await downManager.modifyDownDuration(
                interaction.guild,
                client,
                selectedDownId,
                newDuration,
                interaction.user.id
            );

            if (result.success) {
                const successEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ تم تعديل مدة الداون بنجاح')
                    .setDescription(`تم تعديل المدة إلى: ${newDuration === 'permanent' ? 'نهائي' : newDuration}`)
                    .setTimestamp();

                await interaction.reply({ embeds: [successEmbed] });
            } else {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription(`❌ **فشل في تعديل المدة:** ${result.error}`);
                
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            return;
        }

        // Handle end user downs
        if (customId.startsWith('down_end_user_downs_')) {
            const userId = customId.replace('down_end_user_downs_', '');
            const userDowns = downManager.getUserDowns(userId);
            
            if (userDowns.length === 0) {
                const noDownsEmbed = new EmbedBuilder()
                    .setColor('#ffaa00')
                    .setDescription('❌ **لا توجد داونات نشطة لإنهائها!**');
                
                return interaction.reply({ embeds: [noDownsEmbed], ephemeral: true });
            }

            // End all user downs
            let endedCount = 0;
            const member = await interaction.guild.members.fetch(userId);

            for (const downData of userDowns) {
                try {
                    const result = await downManager.endDown(
                        interaction.guild,
                        client,
                        downData.id,
                        `تم الإنهاء يدوياً بواسطة ${interaction.user.username}`
                    );
                    if (result.success) endedCount++;
                } catch (error) {
                    console.error(`خطأ في إنهاء داون ${downData.id}:`, error);
                }
            }

            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ تم إنهاء الداونات')
                .setDescription(`تم إنهاء ${endedCount} من أصل ${userDowns.length} داون للعضو ${member}`)
                .setTimestamp();

            await interaction.reply({ embeds: [successEmbed] });
            return;
        }

        if (interaction.isUserSelectMenu() && customId === 'down_show_user_active_downs') {
            const userId = interaction.values[0];
            await showUserActiveDowns(interaction, userId, context);
            return;
        }

        // Back to main menu
        if (customId === 'down_back_to_main') {
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
                    { label: 'سحب رول', value: 'remove_role', description: 'سحب رول من عضو لمدة محددة أو نهائياً', emoji: '🔻' },
                    { label: 'سجلات الشخص في الداون', value: 'user_records', description: 'عرض سجلات الداون لعضو معين', emoji: '📊' },
                    { label: 'تعديل مدة الداون', value: 'modify_duration', description: 'تعديل مدة داون حالي', emoji: '⏰' },
                    { label: 'الداونات النشطة', value: 'active_downs', description: 'عرض جميع الداونات الجارية ووقت انتهائها', emoji: '📋' },
                    { label: 'عرض الداونات على الشخص', value: 'user_downs', description: 'إدارة الداونات لعضو محدد', emoji: '👤' }
                ]);

            const menuRow = new ActionRowBuilder().addComponents(menuSelect);
            await interaction.update({ embeds: [menuEmbed], components: [menuRow] });
            return;
        }

    } catch (error) {
        console.error('Error in down handleInteraction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة التفاعل!', ephemeral: true });
        }
    }
}

// Helper functions for different menu options
async function handleRemoveRole(interaction, context) {
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('down_selected_user')
        .setPlaceholder('اختر العضو المراد سحب الرول منه...');

    const selectRow = new ActionRowBuilder().addComponents(userSelect);
    const backButton = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

    await interaction.update({ 
        content: '👤 **اختر العضو المراد سحب الرول منه:**', 
        embeds: [], 
        components: [selectRow, backButton] 
    });
}

async function handleUserRecords(interaction, context) {
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('down_show_user_records')
        .setPlaceholder('اختر العضو لعرض سجلاته...');

    const selectRow = new ActionRowBuilder().addComponents(userSelect);
    const backButton = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

    await interaction.update({ 
        content: '👤 **اختر العضو لعرض سجلاته في نظام الداون:**', 
        embeds: [], 
        components: [selectRow, backButton] 
    });
}

async function handleModifyDuration(interaction, context) {
    const activeDowns = downManager.getActiveDowns();
    const downEntries = Object.entries(activeDowns);

    if (downEntries.length === 0) {
        const noDownsEmbed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setDescription('📋 **لا توجد داونات نشطة حالياً!**');
        
        const backButton = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));
        
        await interaction.update({ embeds: [noDownsEmbed], components: [backButton] });
        return;
    }

    // Create selection options for active downs
    const downOptions = await Promise.all(downEntries.slice(0, 25).map(async ([downId, downData]) => {
        try {
            const member = await interaction.guild.members.fetch(downData.userId);
            const role = await interaction.guild.roles.fetch(downData.roleId);
            
            return {
                label: `${member.displayName} - ${role.name}`,
                value: downId,
                description: `المدة: ${downData.duration || 'نهائي'} | ${downData.endTime ? `ينتهي <t:${Math.floor(downData.endTime / 1000)}:R>` : 'دائم'}`
            };
        } catch (error) {
            return {
                label: 'عضو أو رول محذوف',
                value: downId,
                description: 'داون معطل'
            };
        }
    }));

    const downSelect = new StringSelectMenuBuilder()
        .setCustomId('down_modify_selection')
        .setPlaceholder('اختر الداون المراد تعديل مدته...')
        .addOptions(downOptions);

    const selectRow = new ActionRowBuilder().addComponents(downSelect);
    const backButton = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

    await interaction.update({ 
        content: '⏰ **اختر الداون المراد تعديل مدته:**', 
        embeds: [], 
        components: [selectRow, backButton] 
    });
}

async function handleActiveDowns(interaction, context) {
    const activeDowns = downManager.getActiveDowns();
    const downEntries = Object.entries(activeDowns);

    if (downEntries.length === 0) {
        const noDownsEmbed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setDescription('📋 **لا توجد داونات نشطة حالياً!**');
        
        const backButton = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));
        
        await interaction.update({ embeds: [noDownsEmbed], components: [backButton] });
        return;
    }

    const activeDownsEmbed = new EmbedBuilder()
        .setTitle('📋 الداونات النشطة')
        .setColor(colorManager.getColor() || '#ff6b6b')
        .setTimestamp();

    let downsList = '';
    const displayDowns = downEntries.slice(0, 10); // Show first 10

    for (const [downId, downData] of displayDowns) {
        try {
            const member = await interaction.guild.members.fetch(downData.userId);
            const role = await interaction.guild.roles.fetch(downData.roleId);
            
            downsList += `**${member.displayName}** - ${role.name}\n`;
            downsList += `المدة: ${downData.duration || 'نهائي'}`;
            if (downData.endTime) {
                downsList += ` | ينتهي: <t:${Math.floor(downData.endTime / 1000)}:R>`;
            }
            downsList += `\nالسبب: ${downData.reason}\n\n`;
        } catch (error) {
            downsList += `**عضو محذوف** - رول محذوف\nداون معطل\n\n`;
        }
    }

    activeDownsEmbed.setDescription(downsList || 'لا توجد داونات نشطة');
    if (downEntries.length > 10) {
        activeDownsEmbed.setFooter({ text: `عرض 10 من أصل ${downEntries.length} داون` });
    }

    const backButton = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

    await interaction.update({ embeds: [activeDownsEmbed], components: [backButton] });
}

async function handleUserDowns(interaction, context) {
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('down_show_user_active_downs')
        .setPlaceholder('اختر العضو لعرض داوناته النشطة...');

    const selectRow = new ActionRowBuilder().addComponents(userSelect);
    const backButton = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));

    await interaction.update({ 
        content: '👤 **اختر العضو لعرض داوناته النشطة:**', 
        embeds: [], 
        components: [selectRow, backButton] 
    });
}

async function showUserActiveDowns(interaction, userId, context) {
    const { client } = context;
    const userDowns = downManager.getUserDowns(userId);
    const member = await interaction.guild.members.fetch(userId);

    if (userDowns.length === 0) {
        const noDownsEmbed = new EmbedBuilder()
            .setColor('#ffaa00')
            .setDescription(`👤 **لا توجد داونات نشطة للعضو ${member}**`);
        
        const backButton = new ActionRowBuilder()
            .addComponents(new ButtonBuilder().setCustomId('down_back_to_main').setLabel('رجوع للقائمة الرئيسية').setStyle(ButtonStyle.Secondary));
        
        await interaction.update({ embeds: [noDownsEmbed], components: [backButton] });
        return;
    }

    const userDownsEmbed = new EmbedBuilder()
        .setTitle(`👤 داونات ${member.displayName}`)
        .setColor(colorManager.getColor() || '#ff6b6b')
        .setThumbnail(member.displayAvatarURL({ dynamic: true }));

    let downsList = '';
    for (const downData of userDowns) {
        try {
            const role = await interaction.guild.roles.fetch(downData.roleId);
            const byUser = await client.users.fetch(downData.byUserId);
            
            downsList += `**${role.name}**\n`;
            downsList += `المدة: ${downData.duration || 'نهائي'}`;
            if (downData.endTime) {
                downsList += ` | ينتهي: <t:${Math.floor(downData.endTime / 1000)}:R>`;
            }
            downsList += `\nالسبب: ${downData.reason}\n`;
            downsList += `بواسطة: ${byUser.username}\n`;
            downsList += `التاريخ: <t:${Math.floor(downData.startTime / 1000)}:F>\n\n`;
        } catch (error) {
            downsList += `**رول محذوف**\nداون معطل\n\n`;
        }
    }

    userDownsEmbed.setDescription(downsList);

    // Add buttons for managing user downs
    const actionButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`down_end_user_downs_${userId}`)
                .setLabel('إنهاء جميع الداونات')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('down_back_to_main')
                .setLabel('رجوع للقائمة الرئيسية')
                .setStyle(ButtonStyle.Secondary)
        );

    await interaction.update({ embeds: [userDownsEmbed], components: [actionButtons] });
}

module.exports = { name, execute, handleInteraction };