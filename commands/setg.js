const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');

const name = 'setg';
const aliases = ['تعديل', 'استرجاع'];

async function execute(message, args, { BOT_OWNERS, client }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const prManager = getPrivateRolesManager();
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    const isManager = await prManager.isManager(message.author.id);

    if (!isOwner && !isManager) {
        await message.react('❌');
        return;
    }

    const mainEmbed = colorManager.createEmbed()
        .setTitle('⚙️ **إعدادات الرولات الخاصة**')
        .setDescription('**اختر العملية:**')
        .addFields(
            { name: '🔄 استرجاع رول', value: 'استرجاع رول محذوف', inline: true },
            { name: '✏️ تعديل رول', value: 'تعديل إعدادات رول موجود', inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('setg_restore')
            .setLabel('استرجاع رول')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('setg_edit')
            .setLabel('تعديل رول')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️')
    );

    const sentMessage = await message.channel.send({ embeds: [mainEmbed], components: [mainRow] });

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 300000
    });

    let selectedRoleId = null;

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'setg_restore') {
                const deletedRoles = await prManager.getDeletedRoles();

                if (deletedRoles.length === 0) {
                    const noRolesEmbed = colorManager.createEmbed()
                        .setDescription('**لا توجد رولات محذوفة للاسترجاع**');
                    await interaction.update({ embeds: [noRolesEmbed], components: [] });
                    return;
                }

                const options = deletedRoles.slice(0, 25).map(role => ({
                    label: role.role_name,
                    value: role.role_id,
                    description: `المالك: ${role.owner_id}`
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('setg_restore_select')
                    .setPlaceholder('اختر الرول للاسترجاع...')
                    .addOptions(options);

                const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                
                const restoreEmbed = colorManager.createEmbed()
                    .setTitle('🔄 **استرجاع رول محذوف**')
                    .setDescription(`**الرولات المحذوفة: ${deletedRoles.length}**\n\nاختر الرول الذي تريد استرجاعه:`);

                await interaction.update({ embeds: [restoreEmbed], components: [selectRow] });
            }
            else if (interaction.customId === 'setg_restore_select') {
                const roleId = interaction.values[0];
                const role = await prManager.get('SELECT * FROM private_roles WHERE role_id = ?', [roleId]);

                if (!role) {
                    await interaction.reply({ content: '❌ الرول غير موجود', ephemeral: true });
                    return;
                }

                await interaction.deferUpdate();

                try {
                    const existingRole = message.guild.roles.cache.get(roleId);
                    
                    if (!existingRole) {
                        const newRole = await message.guild.roles.create({
                            name: role.role_name,
                            color: role.color || 'Random',
                            reason: `استرجاع رول خاص للمستخدم ${role.owner_id}`
                        });

                        await prManager.run('UPDATE private_roles SET role_id = ?, is_deleted = 0 WHERE role_id = ?', [newRole.id, roleId]);
                        await prManager.run('UPDATE private_role_members SET role_id = ? WHERE role_id = ?', [newRole.id, roleId]);

                        const members = await prManager.getMembers(newRole.id);
                        for (const member of members) {
                            try {
                                const guildMember = await message.guild.members.fetch(member.user_id);
                                await guildMember.roles.add(newRole);
                            } catch (e) {}
                        }

                        const successEmbed = colorManager.createEmbed()
                            .setTitle('✅ **تم استرجاع الرول**')
                            .setDescription(`**الرول:** <@&${newRole.id}>\n**المالك:** <@${role.owner_id}>`);
                        await interaction.editReply({ embeds: [successEmbed], components: [] });
                    } else {
                        await prManager.restoreRole(roleId);
                        const successEmbed = colorManager.createEmbed()
                            .setTitle('✅ **تم استرجاع الرول**')
                            .setDescription(`**الرول:** <@&${roleId}>\n**المالك:** <@${role.owner_id}>`);
                        await interaction.editReply({ embeds: [successEmbed], components: [] });
                    }
                } catch (error) {
                    console.error('خطأ في استرجاع الرول:', error);
                    const errorEmbed = colorManager.createEmbed()
                        .setDescription(`❌ **حدث خطأ أثناء الاسترجاع:**\n${error.message}`);
                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
            }
            else if (interaction.customId === 'setg_edit') {
                const roles = await prManager.getAllRoles();

                if (roles.length === 0) {
                    const noRolesEmbed = colorManager.createEmbed()
                        .setDescription('**لا توجد رولات للتعديل**');
                    await interaction.update({ embeds: [noRolesEmbed], components: [] });
                    return;
                }

                const options = roles.slice(0, 25).map(role => ({
                    label: role.role_name,
                    value: role.role_id,
                    description: `المالك: ${role.owner_id}`
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('setg_edit_select')
                    .setPlaceholder('اختر الرول للتعديل...')
                    .addOptions(options);

                const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                
                const editEmbed = colorManager.createEmbed()
                    .setTitle('✏️ **تعديل رول**')
                    .setDescription('**اختر الرول الذي تريد تعديله:**');

                await interaction.update({ embeds: [editEmbed], components: [selectRow] });
            }
            else if (interaction.customId === 'setg_edit_select') {
                selectedRoleId = interaction.values[0];
                const role = await prManager.getRole(selectedRoleId);

                const editEmbed = colorManager.createEmbed()
                    .setTitle(`✏️ **تعديل: ${role.role_name}**`)
                    .setDescription('**اختر ما تريد تعديله:**')
                    .addFields(
                        { name: '👤 المالك', value: `<@${role.owner_id}>`, inline: true },
                        { name: '👥 النائب', value: role.deputy_id ? `<@${role.deputy_id}>` : 'لا يوجد', inline: true },
                        { name: '🔢 الحد', value: `${role.member_limit}`, inline: true }
                    );

                const editRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('setg_change_owner')
                        .setLabel('تغيير المالك')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('👤'),
                    new ButtonBuilder()
                        .setCustomId('setg_change_deputy')
                        .setLabel('تغيير النائب')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('👥'),
                    new ButtonBuilder()
                        .setCustomId('setg_change_limit')
                        .setLabel('تغيير الحد')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🔢'),
                    new ButtonBuilder()
                        .setCustomId('setg_change_name')
                        .setLabel('تغيير الاسم')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('✏️')
                );

                await interaction.update({ embeds: [editEmbed], components: [editRow] });
            }
            else if (interaction.customId === 'setg_change_owner') {
                const modal = new ModalBuilder()
                    .setCustomId('setg_owner_modal')
                    .setTitle('تغيير المالك');

                const ownerInput = new TextInputBuilder()
                    .setCustomId('new_owner')
                    .setLabel('آي دي أو منشن المالك الجديد')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(ownerInput));
                await interaction.showModal(modal);
            }
            else if (interaction.customId === 'setg_change_deputy') {
                const modal = new ModalBuilder()
                    .setCustomId('setg_deputy_modal')
                    .setTitle('تغيير النائب');

                const deputyInput = new TextInputBuilder()
                    .setCustomId('new_deputy')
                    .setLabel('آي دي أو منشن النائب الجديد (أو none)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(deputyInput));
                await interaction.showModal(modal);
            }
            else if (interaction.customId === 'setg_change_limit') {
                const modal = new ModalBuilder()
                    .setCustomId('setg_limit_modal')
                    .setTitle('تغيير حد الأعضاء');

                const limitInput = new TextInputBuilder()
                    .setCustomId('new_limit')
                    .setLabel('الحد الجديد للأعضاء')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
                await interaction.showModal(modal);
            }
            else if (interaction.customId === 'setg_change_name') {
                const modal = new ModalBuilder()
                    .setCustomId('setg_name_modal')
                    .setTitle('تغيير اسم الرول');

                const nameInput = new TextInputBuilder()
                    .setCustomId('new_name')
                    .setLabel('الاسم الجديد للرول')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(modal);
            }
        } catch (error) {
            console.error('خطأ في التفاعل:', error);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (!selectedRoleId) return;

        try {
            if (interaction.customId === 'setg_owner_modal') {
                let newOwnerId = interaction.fields.getTextInputValue('new_owner');
                newOwnerId = newOwnerId.replace(/[<@!>]/g, '');

                const result = await prManager.changeOwner(selectedRoleId, newOwnerId);
                
                if (result.success) {
                    const discordRole = message.guild.roles.cache.get(selectedRoleId);
                    if (discordRole) {
                        try {
                            const newOwnerMember = await message.guild.members.fetch(newOwnerId);
                            await newOwnerMember.roles.add(discordRole);
                        } catch (e) {}
                    }

                    const successEmbed = colorManager.createEmbed()
                        .setDescription(`✅ **تم تغيير المالك إلى <@${newOwnerId}>**`);
                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                } else {
                    await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
                }
            }
            else if (interaction.customId === 'setg_deputy_modal') {
                let newDeputyId = interaction.fields.getTextInputValue('new_deputy');
                
                if (newDeputyId.toLowerCase() === 'none') {
                    newDeputyId = null;
                } else {
                    newDeputyId = newDeputyId.replace(/[<@!>]/g, '');
                }

                await prManager.updateRole(selectedRoleId, { deputyId: newDeputyId });

                if (newDeputyId) {
                    const discordRole = message.guild.roles.cache.get(selectedRoleId);
                    if (discordRole) {
                        try {
                            const newDeputyMember = await message.guild.members.fetch(newDeputyId);
                            await newDeputyMember.roles.add(discordRole);
                        } catch (e) {}
                    }
                }

                const successEmbed = colorManager.createEmbed()
                    .setDescription(`✅ **تم تغيير النائب ${newDeputyId ? `إلى <@${newDeputyId}>` : '(تم الإزالة)'}**`);
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            }
            else if (interaction.customId === 'setg_limit_modal') {
                const newLimit = parseInt(interaction.fields.getTextInputValue('new_limit'));
                
                if (isNaN(newLimit) || newLimit < 1) {
                    await interaction.reply({ content: '❌ الحد يجب أن يكون رقماً أكبر من 0', ephemeral: true });
                    return;
                }

                await prManager.updateRole(selectedRoleId, { memberLimit: newLimit });

                const successEmbed = colorManager.createEmbed()
                    .setDescription(`✅ **تم تغيير الحد إلى ${newLimit}**`);
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            }
            else if (interaction.customId === 'setg_name_modal') {
                const newName = interaction.fields.getTextInputValue('new_name');

                const discordRole = message.guild.roles.cache.get(selectedRoleId);
                if (discordRole) {
                    await discordRole.setName(newName);
                }

                await prManager.updateRole(selectedRoleId, { roleName: newName });

                const successEmbed = colorManager.createEmbed()
                    .setDescription(`✅ **تم تغيير الاسم إلى ${newName}**`);
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            }
        } catch (error) {
            console.error('خطأ في معالجة المودال:', error);
            try {
                await interaction.reply({ content: `❌ حدث خطأ: ${error.message}`, ephemeral: true });
            } catch (e) {}
        }
    });
}

module.exports = { name, aliases, execute };
