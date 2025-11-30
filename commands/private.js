const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');
const { getDatabase } = require('../utils/database.js');

const name = 'private';
const aliases = ['خاص', 'رولات'];

async function execute(message, args, { BOT_OWNERS, client, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    
    if (!isOwner) {
        await message.react('❌');
        return;
    }

    const prManager = getPrivateRolesManager();

    const mainEmbed = colorManager.createEmbed()
        .setTitle('🔐 **إدارة الرولات الخاصة**')
        .setDescription('**اختر العملية المطلوبة من القائمة أدناه**')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }))
        .addFields(
            { name: '📊 توب الرولات', value: 'إرسال قائمة أفضل الرولات حسب التفاعل', inline: true },
            { name: '🔄 تصفير النقاط', value: 'تصفير نقاط جميع الرولات أو رول معين', inline: true },
            { name: '📋 عرض الرولات', value: 'عرض جميع الرولات الخاصة', inline: true },
            { name: '👥 إدارة المسؤولين', value: 'إضافة أو إزالة مسؤول رولات', inline: true },
            { name: '📝 لوق الرولات', value: 'تعيين قناة سجلات الرولات', inline: true },
            { name: '🎛️ إيمبد التحكم', value: 'إرسال لوحة تحكم لأصحاب الرولات', inline: true },
            { name: '⚙️ تحكم المسؤولين', value: 'لوحة تحكم متقدمة للمسؤولين', inline: true }
        );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('private_main_menu')
        .setPlaceholder('اختر العملية...')
        .addOptions([
            { label: 'توب الرولات الخاصة', description: 'إرسال قائمة أفضل الرولات', value: 'top_roles', emoji: '📊' },
            { label: 'تصفير النقاط', description: 'تصفير نقاط الرولات', value: 'reset_points', emoji: '🔄' },
            { label: 'عرض جميع الرولات', description: 'عرض قائمة الرولات الخاصة', value: 'view_roles', emoji: '📋' },
            { label: 'إضافة/إزالة مسؤول', description: 'إدارة مسؤولي الرولات', value: 'manage_managers', emoji: '👥' },
            { label: 'تعيين لوق الرولات', description: 'تحديد قناة السجلات', value: 'set_log', emoji: '📝' },
            { label: 'إيمبد تحكم الأعضاء', description: 'إرسال لوحة تحكم للمالكين', value: 'member_control', emoji: '🎛️' },
            { label: 'إيمبد تحكم المسؤولين', description: 'لوحة تحكم متقدمة', value: 'admin_control', emoji: '⚙️' }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const sentMessage = await message.channel.send({ embeds: [mainEmbed], components: [row] });

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 300000
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'private_main_menu') {
                const value = interaction.values[0];

                switch (value) {
                    case 'top_roles':
                        await handleTopRoles(interaction, prManager, client, message);
                        break;
                    case 'reset_points':
                        await handleResetPoints(interaction, prManager, client);
                        break;
                    case 'view_roles':
                        await handleViewRoles(interaction, prManager, client);
                        break;
                    case 'manage_managers':
                        await handleManageManagers(interaction, prManager, client, message);
                        break;
                    case 'set_log':
                        await handleSetLog(interaction, prManager, client, message);
                        break;
                    case 'member_control':
                        await handleMemberControl(interaction, prManager, client, message);
                        break;
                    case 'admin_control':
                        await handleAdminControl(interaction, prManager, client, message);
                        break;
                }
            } else if (interaction.customId === 'back_to_main') {
                await interaction.update({ embeds: [mainEmbed], components: [row] });
            } else if (interaction.customId.startsWith('pr_')) {
                await handleSubInteraction(interaction, prManager, client, message);
            }
        } catch (error) {
            console.error('خطأ في التفاعل:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ حدث خطأ', ephemeral: true });
                }
            } catch (e) {}
        }
    });
}

async function handleTopRoles(interaction, prManager, client, message) {
    await interaction.deferUpdate();

    const dbManager = getDatabase();
    const topRoles = await prManager.getTopRoles(10, dbManager);

    if (topRoles.length === 0) {
        const noRolesEmbed = colorManager.createEmbed()
            .setDescription('**لا توجد رولات خاصة حالياً**');
        
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [noRolesEmbed], components: [backRow] });
        return;
    }

    let description = '';
    for (let i = 0; i < topRoles.length; i++) {
        const role = topRoles[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        description += `${medal} <@&${role.role_id}> - **${role.total_points}** نقطة\n`;
        description += `   └ المالك: <@${role.owner_id}>\n`;
    }

    const topEmbed = colorManager.createEmbed()
        .setTitle('📊 **توب الرولات الخاصة**')
        .setDescription(description)
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }))
        .setFooter({ text: 'النقاط = XP الفويس + XP الشات لجميع الأعضاء' });

    const sendRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_send_top').setLabel('إرسال للقناة').setStyle(ButtonStyle.Primary).setEmoji('📤'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [topEmbed], components: [sendRow] });
}

async function handleResetPoints(interaction, prManager, client) {
    const resetEmbed = colorManager.createEmbed()
        .setTitle('🔄 **تصفير نقاط الرولات**')
        .setDescription('**اختر نوع التصفير:**')
        .addFields(
            { name: '🔴 تصفير الكل', value: 'تصفير نقاط جميع الرولات', inline: true },
            { name: '🎯 تصفير رول معين', value: 'تصفير نقاط رول محدد', inline: true }
        );

    const resetRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_reset_all').setLabel('تصفير الكل').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
        new ButtonBuilder().setCustomId('pr_reset_specific').setLabel('رول معين').setStyle(ButtonStyle.Primary).setEmoji('🎯'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({ embeds: [resetEmbed], components: [resetRow] });
}

async function handleViewRoles(interaction, prManager, client) {
    await interaction.deferUpdate();

    const roles = await prManager.getAllRoles();

    if (roles.length === 0) {
        const noRolesEmbed = colorManager.createEmbed()
            .setDescription('**لا توجد رولات خاصة حالياً**');
        
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [noRolesEmbed], components: [backRow] });
        return;
    }

    let description = '';
    for (const role of roles) {
        const memberCount = await prManager.getMemberCount(role.role_id);
        description += `**•** <@&${role.role_id}>\n`;
        description += `   └ المالك: <@${role.owner_id}> | النائب: ${role.deputy_id ? `<@${role.deputy_id}>` : 'لا يوجد'}\n`;
        description += `   └ الأعضاء: **${memberCount}/${role.member_limit}** | النقاط: **${role.total_points}**\n\n`;
    }

    const viewEmbed = colorManager.createEmbed()
        .setTitle(`📋 **جميع الرولات الخاصة (${roles.length})**`)
        .setDescription(description)
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [viewEmbed], components: [backRow] });
}

async function handleManageManagers(interaction, prManager, client, message) {
    await interaction.deferUpdate();

    const managers = await prManager.getManagers();

    let description = '**المسؤولين الحاليين:**\n\n';
    if (managers.length === 0) {
        description += '*لا يوجد مسؤولين*';
    } else {
        for (const manager of managers) {
            description += `• <@${manager.user_id}> - أضافه: <@${manager.added_by}>\n`;
        }
    }

    const manageEmbed = colorManager.createEmbed()
        .setTitle('👥 **إدارة مسؤولي الرولات**')
        .setDescription(description)
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const manageRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_add_manager').setLabel('إضافة مسؤول').setStyle(ButtonStyle.Success).setEmoji('➕'),
        new ButtonBuilder().setCustomId('pr_remove_manager').setLabel('إزالة مسؤول').setStyle(ButtonStyle.Danger).setEmoji('➖'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [manageEmbed], components: [manageRow] });
}

async function handleSetLog(interaction, prManager, client, message) {
    const currentLog = await prManager.getSetting('log_channel');

    const logEmbed = colorManager.createEmbed()
        .setTitle('📝 **تعيين لوق الرولات الخاصة**')
        .setDescription(`**القناة الحالية:** ${currentLog ? `<#${currentLog}>` : 'غير محدد'}`)
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const logRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_set_log_channel').setLabel('تعيين القناة').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        new ButtonBuilder().setCustomId('pr_remove_log').setLabel('إزالة القناة').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({ embeds: [logEmbed], components: [logRow] });
}

async function handleMemberControl(interaction, prManager, client, message) {
    const controlEmbed = colorManager.createEmbed()
        .setTitle('🎛️ **إيمبد تحكم أصحاب الرولات**')
        .setDescription('**هذا الإيمبد سيُرسل لقناة معينة ليتمكن أصحاب الرولات الخاصة من:**\n\n• تغيير اسم الرول\n• تغيير لون الرول\n• إضافة عضو\n• إزالة عضو\n• حذف الرول')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_send_member_control').setLabel('إرسال الإيمبد').setStyle(ButtonStyle.Primary).setEmoji('📤'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({ embeds: [controlEmbed], components: [controlRow] });
}

async function handleAdminControl(interaction, prManager, client, message) {
    const adminEmbed = colorManager.createEmbed()
        .setTitle('⚙️ **إيمبد تحكم المسؤولين**')
        .setDescription('**لوحة تحكم متقدمة للمسؤولين تحتوي على:**\n\n• ➕ إضافة رول خاص\n• ➖ إزالة رول خاص\n• ℹ️ معلومات رول\n• 🔄 تصفير رول\n• 💬 تعيين شات استقبال الأوامر')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const adminRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pr_send_admin_control').setLabel('إرسال الإيمبد').setStyle(ButtonStyle.Primary).setEmoji('📤'),
        new ButtonBuilder().setCustomId('back_to_main').setLabel('رجوع').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({ embeds: [adminEmbed], components: [adminRow] });
}

async function handleSubInteraction(interaction, prManager, client, message) {
    const customId = interaction.customId;

    if (customId === 'pr_reset_all') {
        await prManager.resetRolePoints();
        const successEmbed = colorManager.createEmbed()
            .setDescription('✅ **تم تصفير نقاط جميع الرولات بنجاح**');
        await interaction.update({ embeds: [successEmbed], components: [] });
    }
    else if (customId === 'pr_add_manager') {
        const promptEmbed = colorManager.createEmbed()
            .setDescription('👥 **منشن المستخدم الذي تريد إضافته كمسؤول:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id && (m.mentions.users.size > 0 || /^\d{17,19}$/.test(m.content));
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let userId;
            if (response.mentions.users.size > 0) {
                userId = response.mentions.users.first().id;
            } else {
                userId = response.content;
            }

            await response.delete().catch(() => {});
            await prManager.addManager(userId, interaction.user.id);
            
            const successEmbed = colorManager.createEmbed()
                .setDescription(`✅ **تم إضافة <@${userId}> كمسؤول رولات**`);
            await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'pr_remove_manager') {
        const managers = await prManager.getManagers();
        
        if (managers.length === 0) {
            await interaction.reply({ content: '❌ لا يوجد مسؤولين لإزالتهم', ephemeral: true });
            return;
        }

        const options = managers.map(m => ({
            label: `المستخدم ${m.user_id}`,
            value: m.user_id,
            description: `أضافه: ${m.added_by}`
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('pr_select_remove_manager')
            .setPlaceholder('اختر المسؤول لإزالته')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.update({ components: [row] });
    }
    else if (customId === 'pr_set_log_channel') {
        const promptEmbed = colorManager.createEmbed()
            .setDescription('📝 **منشن القناة التي تريد تعيينها كلوق:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id && (m.mentions.channels.size > 0 || /^\d{17,19}$/.test(m.content));
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let channelId;
            if (response.mentions.channels.size > 0) {
                channelId = response.mentions.channels.first().id;
            } else {
                channelId = response.content;
            }

            await response.delete().catch(() => {});
            
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.followUp({ content: '❌ القناة غير موجودة', ephemeral: true });
                return;
            }

            await prManager.setSetting('log_channel', channelId);
            
            const successEmbed = colorManager.createEmbed()
                .setDescription(`✅ **تم تعيين <#${channelId}> كقناة لوق الرولات**`);
            await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'pr_remove_log') {
        await prManager.setSetting('log_channel', null);
        const successEmbed = colorManager.createEmbed()
            .setDescription('✅ **تم إزالة قناة اللوق بنجاح**');
        await interaction.update({ embeds: [successEmbed], components: [] });
    }
    else if (customId === 'pr_send_member_control') {
        const promptEmbed = colorManager.createEmbed()
            .setDescription('📤 **منشن القناة التي تريد إرسال الإيمبد فيها:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id && (m.mentions.channels.size > 0 || /^\d{17,19}$/.test(m.content));
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let channelId;
            if (response.mentions.channels.size > 0) {
                channelId = response.mentions.channels.first().id;
            } else {
                channelId = response.content;
            }

            await response.delete().catch(() => {});
            
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.followUp({ content: '❌ القناة غير موجودة', ephemeral: true });
                return;
            }

            const controlEmbed = colorManager.createEmbed()
                .setTitle('🎛️ **لوحة تحكم الرولات الخاصة**')
                .setDescription('**استخدم الأزرار أدناه للتحكم برولك الخاص:**')
                .addFields(
                    { name: '✏️ تغيير الاسم', value: 'تغيير اسم الرول', inline: true },
                    { name: '🎨 تغيير اللون', value: 'تغيير لون الرول', inline: true },
                    { name: '➕ إضافة عضو', value: 'إضافة عضو للرول', inline: true },
                    { name: '➖ إزالة عضو', value: 'إزالة عضو من الرول', inline: true },
                    { name: '🗑️ حذف الرول', value: 'حذف الرول نهائياً', inline: true }
                )
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            const controlRow1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prc_change_name').setLabel('تغيير الاسم').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
                new ButtonBuilder().setCustomId('prc_change_color').setLabel('تغيير اللون').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
                new ButtonBuilder().setCustomId('prc_add_member').setLabel('إضافة عضو').setStyle(ButtonStyle.Success).setEmoji('➕')
            );

            const controlRow2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prc_remove_member').setLabel('إزالة عضو').setStyle(ButtonStyle.Danger).setEmoji('➖'),
                new ButtonBuilder().setCustomId('prc_delete_role').setLabel('حذف الرول').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
            );

            await channel.send({ embeds: [controlEmbed], components: [controlRow1, controlRow2] });
            await interaction.followUp({ content: `✅ تم إرسال إيمبد التحكم إلى <#${channelId}>`, ephemeral: true });
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'pr_send_admin_control') {
        const promptEmbed = colorManager.createEmbed()
            .setDescription('📤 **منشن القناة التي تريد إرسال الإيمبد فيها:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id && (m.mentions.channels.size > 0 || /^\d{17,19}$/.test(m.content));
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let channelId;
            if (response.mentions.channels.size > 0) {
                channelId = response.mentions.channels.first().id;
            } else {
                channelId = response.content;
            }

            await response.delete().catch(() => {});
            
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.followUp({ content: '❌ القناة غير موجودة', ephemeral: true });
                return;
            }

            const adminEmbed = colorManager.createEmbed()
                .setTitle('⚙️ **لوحة تحكم مسؤولي الرولات**')
                .setDescription('**استخدم الأزرار أدناه لإدارة الرولات الخاصة:**')
                .addFields(
                    { name: '➕ إضافة رول', value: 'إنشاء رول خاص جديد', inline: true },
                    { name: '➖ إزالة رول', value: 'حذف رول موجود', inline: true },
                    { name: 'ℹ️ معلومات رول', value: 'عرض تفاصيل رول', inline: true },
                    { name: '🔄 تصفير رول', value: 'تصفير نقاط رول', inline: true },
                    { name: '💬 شات الأوامر', value: 'تعيين روم استقبال', inline: true }
                )
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            const adminRow1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pra_add_role').setLabel('إضافة رول').setStyle(ButtonStyle.Success).setEmoji('➕'),
                new ButtonBuilder().setCustomId('pra_remove_role').setLabel('إزالة رول').setStyle(ButtonStyle.Danger).setEmoji('➖'),
                new ButtonBuilder().setCustomId('pra_role_info').setLabel('معلومات رول').setStyle(ButtonStyle.Primary).setEmoji('ℹ️')
            );

            const adminRow2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pra_reset_role').setLabel('تصفير رول').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
                new ButtonBuilder().setCustomId('pra_set_command_channel').setLabel('شات الأوامر').setStyle(ButtonStyle.Primary).setEmoji('💬')
            );

            await channel.send({ embeds: [adminEmbed], components: [adminRow1, adminRow2] });
            await interaction.followUp({ content: `✅ تم إرسال إيمبد تحكم المسؤولين إلى <#${channelId}>`, ephemeral: true });
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'pr_send_top') {
        const promptEmbed = colorManager.createEmbed()
            .setDescription('📤 **منشن القناة التي تريد إرسال التوب فيها:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id && (m.mentions.channels.size > 0 || /^\d{17,19}$/.test(m.content));
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let channelId;
            if (response.mentions.channels.size > 0) {
                channelId = response.mentions.channels.first().id;
            } else {
                channelId = response.content;
            }

            await response.delete().catch(() => {});
            
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel) {
                await interaction.followUp({ content: '❌ القناة غير موجودة', ephemeral: true });
                return;
            }

            const dbManager = getDatabase();
            const topRoles = await prManager.getTopRoles(10, dbManager);

            let description = '';
            for (let i = 0; i < topRoles.length; i++) {
                const role = topRoles[i];
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
                description += `${medal} <@&${role.role_id}> - **${role.total_points}** نقطة\n`;
                description += `   └ المالك: <@${role.owner_id}>\n`;
            }

            if (description === '') {
                description = '**لا توجد رولات خاصة حالياً**';
            }

            const topEmbed = colorManager.createEmbed()
                .setTitle('📊 **توب الرولات الخاصة**')
                .setDescription(description)
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }))
                .setFooter({ text: 'النقاط = XP الفويس + XP الشات لجميع الأعضاء' });

            await channel.send({ embeds: [topEmbed] });
            await interaction.followUp({ content: `✅ تم إرسال توب الرولات إلى <#${channelId}>`, ephemeral: true });
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'pr_select_remove_manager') {
        const userId = interaction.values[0];
        await prManager.removeManager(userId);
        const successEmbed = colorManager.createEmbed()
            .setDescription(`✅ **تم إزالة المسؤول <@${userId}> بنجاح**`);
        await interaction.update({ embeds: [successEmbed], components: [] });
    }
}

module.exports = { name, aliases, execute };
