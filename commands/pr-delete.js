const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');

const name = 'delete';
const aliases = ['حذف', 'ازالة'];

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

    const roles = await prManager.getAllRoles();

    if (roles.length === 0) {
        const noRolesEmbed = colorManager.createEmbed()
            .setDescription('**لا توجد رولات خاصة للحذف**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [noRolesEmbed] });
        return;
    }

    const mainEmbed = colorManager.createEmbed()
        .setTitle('🗑️ **حذف رولات خاصة**')
        .setDescription('**اختر طريقة الحذف:**')
        .addFields(
            { name: '🎯 حذف محدد', value: 'اختر رولات معينة للحذف', inline: true },
            { name: '⚠️ حذف الكل', value: 'حذف جميع الرولات الخاصة', inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('delete_select')
            .setLabel('حذف محدد')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯'),
        new ButtonBuilder()
            .setCustomId('delete_all')
            .setLabel('حذف الكل')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⚠️')
    );

    const sentMessage = await message.channel.send({ embeds: [mainEmbed], components: [mainRow] });

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 300000
    });

    let selectedRoles = [];

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'delete_select') {
                const options = roles.slice(0, 25).map(role => ({
                    label: role.role_name,
                    value: role.role_id,
                    description: `المالك: ${role.owner_id}`
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('delete_role_select')
                    .setPlaceholder('اختر الرولات للحذف...')
                    .setMinValues(1)
                    .setMaxValues(Math.min(options.length, 25))
                    .addOptions(options);

                const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('delete_confirm_selected')
                        .setLabel('تأكيد الحذف')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🗑️'),
                    new ButtonBuilder()
                        .setCustomId('delete_cancel')
                        .setLabel('إلغاء')
                        .setStyle(ButtonStyle.Secondary)
                );

                await interaction.update({
                    embeds: [mainEmbed],
                    components: [selectRow, confirmRow]
                });
            }
            else if (interaction.customId === 'delete_role_select') {
                selectedRoles = interaction.values;

                const selectedEmbed = colorManager.createEmbed()
                    .setTitle('🗑️ **تأكيد الحذف**')
                    .setDescription(`**تم اختيار ${selectedRoles.length} رول للحذف**\n\nاضغط "تأكيد الحذف" للمتابعة`);

                await interaction.update({ embeds: [selectedEmbed] });
            }
            else if (interaction.customId === 'delete_confirm_selected') {
                if (selectedRoles.length === 0) {
                    await interaction.reply({ content: '❌ لم تختر أي رولات', ephemeral: true });
                    return;
                }

                await interaction.deferUpdate();

                let deleted = 0;
                let failed = 0;

                for (const roleId of selectedRoles) {
                    try {
                        const discordRole = message.guild.roles.cache.get(roleId);
                        if (discordRole) {
                            await discordRole.delete();
                        }
                        await prManager.deleteRole(roleId, true);
                        deleted++;
                    } catch (error) {
                        console.error(`خطأ في حذف الرول ${roleId}:`, error);
                        failed++;
                    }
                }

                const resultEmbed = colorManager.createEmbed()
                    .setTitle('✅ **تم الحذف**')
                    .setDescription(`**تم حذف ${deleted} رول${failed > 0 ? ` (فشل ${failed})` : ''}**`);

                await interaction.editReply({ embeds: [resultEmbed], components: [] });

                const logChannel = await prManager.getSetting('log_channel');
                if (logChannel) {
                    const channel = message.guild.channels.cache.get(logChannel);
                    if (channel) {
                        const logEmbed = colorManager.createEmbed()
                            .setTitle('🗑️ **تم حذف رولات خاصة**')
                            .addFields(
                                { name: 'العدد', value: `${deleted}`, inline: true },
                                { name: 'حذفها', value: `<@${message.author.id}>`, inline: true }
                            )
                            .setTimestamp();
                        await channel.send({ embeds: [logEmbed] });
                    }
                }
            }
            else if (interaction.customId === 'delete_all') {
                const confirmEmbed = colorManager.createEmbed()
                    .setTitle('⚠️ **تحذير!**')
                    .setDescription(`**أنت على وشك حذف جميع الرولات الخاصة (${roles.length} رول)**\n\nهل أنت متأكد؟`)
                    .setColor('#ff0000');

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('delete_all_confirm')
                        .setLabel('نعم، احذف الكل')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('delete_cancel')
                        .setLabel('إلغاء')
                        .setStyle(ButtonStyle.Secondary)
                );

                await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
            }
            else if (interaction.customId === 'delete_all_confirm') {
                await interaction.deferUpdate();

                let deleted = 0;

                for (const role of roles) {
                    try {
                        const discordRole = message.guild.roles.cache.get(role.role_id);
                        if (discordRole) {
                            await discordRole.delete();
                        }
                        await prManager.deleteRole(role.role_id, true);
                        deleted++;
                    } catch (error) {
                        console.error(`خطأ في حذف الرول ${role.role_id}:`, error);
                    }
                }

                const resultEmbed = colorManager.createEmbed()
                    .setTitle('✅ **تم حذف جميع الرولات**')
                    .setDescription(`**تم حذف ${deleted} رول خاص**`);

                await interaction.editReply({ embeds: [resultEmbed], components: [] });
            }
            else if (interaction.customId === 'delete_cancel') {
                const cancelEmbed = colorManager.createEmbed()
                    .setDescription('**تم إلغاء العملية**');
                await interaction.update({ embeds: [cancelEmbed], components: [] });
            }
        } catch (error) {
            console.error('خطأ في التفاعل:', error);
        }
    });
}

module.exports = { name, aliases, execute };
