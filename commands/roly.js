const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');
const { getDatabase } = require('../utils/database.js');

const name = 'رولي';
const aliases = ['myrole', 'role'];

async function execute(message, args, { BOT_OWNERS, client }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const prManager = getPrivateRolesManager();

    const userRole = await prManager.getOwnedRole(message.author.id);
    
    if (!userRole) {
        const roles = await prManager.getUserRoles(message.author.id);
        const deputyRole = roles.find(r => r.deputy_id === message.author.id);
        
        if (!deputyRole) {
            const noRoleEmbed = colorManager.createEmbed()
                .setDescription('❌ **ليس لديك رول خاص**\n\nيمكنك طلب رول خاص من الإدارة.')
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
            await message.channel.send({ embeds: [noRoleEmbed] });
            return;
        }
    }

    const role = userRole || (await prManager.getUserRoles(message.author.id)).find(r => r.deputy_id === message.author.id);
    const isOwner = role.owner_id === message.author.id;
    const memberCount = await prManager.getMemberCount(role.role_id);

    const dbManager = getDatabase();
    await prManager.calculateRolePoints(role.role_id, dbManager);
    const updatedRole = await prManager.getRole(role.role_id);

    const mainEmbed = colorManager.createEmbed()
        .setTitle(`🎭 **رولك الخاص: ${role.role_name}**`)
        .setDescription(`<@&${role.role_id}>`)
        .addFields(
            { name: '👤 المالك', value: `<@${role.owner_id}>`, inline: true },
            { name: '👥 النائب', value: role.deputy_id ? `<@${role.deputy_id}>` : 'لا يوجد', inline: true },
            { name: '🔢 الأعضاء', value: `${memberCount}/${role.member_limit}`, inline: true },
            { name: '⭐ النقاط', value: `${updatedRole.total_points}`, inline: true },
            { name: '🎨 اللون', value: role.color || 'افتراضي', inline: true },
            { name: '📅 تاريخ الإنشاء', value: `<t:${role.created_at}:R>`, inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('roly_menu')
        .setPlaceholder('اختر العملية...')
        .addOptions([
            { label: 'إضافة/إزالة عضو', description: 'التحكم بأعضاء الرول', value: 'toggle_member', emoji: '👥' },
            { label: 'تغيير النائب', description: 'تعيين نائب جديد', value: 'change_deputy', emoji: '👤' },
            { label: 'وضع أيقون', description: 'تعيين أيقون للرول', value: 'set_icon', emoji: '🖼️' },
            { label: 'تغيير اللون', description: 'تغيير لون الرول', value: 'change_color', emoji: '🎨' },
            { label: 'عرض الأعضاء', description: 'عرض قائمة أعضاء الرول', value: 'view_members', emoji: '📋' }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const sentMessage = await message.channel.send({ embeds: [mainEmbed], components: [row] });

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 300000
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'roly_menu') {
                const value = interaction.values[0];

                switch (value) {
                    case 'toggle_member':
                        await handleToggleMember(interaction, prManager, role, message, client);
                        break;
                    case 'change_deputy':
                        await handleChangeDeputy(interaction, prManager, role, isOwner, message, client);
                        break;
                    case 'set_icon':
                        await handleSetIcon(interaction, role, message, client);
                        break;
                    case 'change_color':
                        await handleChangeColor(interaction, prManager, role, message, client);
                        break;
                    case 'view_members':
                        await handleViewMembers(interaction, prManager, role, client);
                        break;
                }
            } else if (interaction.customId.startsWith('roly_')) {
                await handleSubInteraction(interaction, prManager, role, message, client, mainEmbed, row);
            }
        } catch (error) {
            console.error('خطأ في التفاعل:', error);
        }
    });
}

async function handleToggleMember(interaction, prManager, role, message, client) {
    const toggleEmbed = colorManager.createEmbed()
        .setTitle('👥 **إضافة/إزالة عضو**')
        .setDescription('**اختر العملية:**')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('roly_add_member')
            .setLabel('إضافة عضو')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId('roly_remove_member')
            .setLabel('إزالة عضو')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('➖'),
        new ButtonBuilder()
            .setCustomId('roly_back')
            .setLabel('رجوع')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({ embeds: [toggleEmbed], components: [toggleRow] });
}

async function handleChangeDeputy(interaction, prManager, role, isOwner, message, client) {
    if (!isOwner) {
        await interaction.reply({ content: '❌ فقط المالك يمكنه تغيير النائب', ephemeral: true });
        return;
    }

    const promptEmbed = colorManager.createEmbed()
        .setDescription('👤 **منشن النائب الجديد (أو اكتب `none` للإزالة):**');
    
    await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

    const filter = m => m.author.id === interaction.user.id;
    
    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const response = collected.first();
        
        let newDeputyId = null;
        if (response.content.toLowerCase() !== 'none') {
            if (response.mentions.users.size > 0) {
                newDeputyId = response.mentions.users.first().id;
            } else if (/^\d{17,19}$/.test(response.content)) {
                newDeputyId = response.content;
            }
        }

        await response.delete().catch(() => {});

        const result = await prManager.changeDeputy(role.role_id, newDeputyId, interaction.user.id);

        if (result.success) {
            if (newDeputyId) {
                const discordRole = interaction.guild.roles.cache.get(role.role_id);
                if (discordRole) {
                    try {
                        const member = await interaction.guild.members.fetch(newDeputyId);
                        await member.roles.add(discordRole);
                    } catch (e) {}
                }
            }

            const successEmbed = colorManager.createEmbed()
                .setDescription(`✅ **تم تغيير النائب ${newDeputyId ? `إلى <@${newDeputyId}>` : '(تم الإزالة)'}**`);
            await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
        } else {
            await interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true });
        }
    } catch (error) {
        const timeoutEmbed = colorManager.createEmbed()
            .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
        await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
    }
}

async function handleSetIcon(interaction, role, message, client) {
    const discordRole = message.guild.roles.cache.get(role.role_id);
    
    if (!discordRole) {
        await interaction.reply({ content: '❌ الرول غير موجود في السيرفر', ephemeral: true });
        return;
    }

    if (!message.guild.features.includes('ROLE_ICONS')) {
        await interaction.reply({ content: '❌ السيرفر لا يدعم أيقونات الرولات (مطلوب مستوى بوست 2+)', ephemeral: true });
        return;
    }

    const promptEmbed = colorManager.createEmbed()
        .setDescription('🖼️ **أرسل رابط الأيقون (PNG/JPG/GIF):**');
    
    await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

    const filter = m => m.author.id === interaction.user.id;
    
    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const response = collected.first();
        const iconUrl = response.content;

        await response.delete().catch(() => {});

        try {
            await discordRole.setIcon(iconUrl);
            const prManager = getPrivateRolesManager();
            await prManager.updateRole(role.role_id, { iconUrl });

            const successEmbed = colorManager.createEmbed()
                .setDescription('✅ **تم تعيين أيقون الرول**')
                .setThumbnail(iconUrl);
            await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
        } catch (error) {
            await interaction.followUp({ content: `❌ فشل في تعيين الأيقون: ${error.message}`, ephemeral: true });
        }
    } catch (error) {
        const timeoutEmbed = colorManager.createEmbed()
            .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
        await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
    }
}

async function handleChangeColor(interaction, prManager, role, message, client) {
    const promptEmbed = colorManager.createEmbed()
        .setDescription('🎨 **اكتب اللون الجديد (HEX مثل #FF5733):**');
    
    await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

    const filter = m => m.author.id === interaction.user.id;
    
    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const response = collected.first();
        const newColor = response.content;

        await response.delete().catch(() => {});

        if (!/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
            await interaction.followUp({ content: '❌ اللون غير صحيح. استخدم صيغة HEX مثل #FF5733', ephemeral: true });
            return;
        }

        const discordRole = message.guild.roles.cache.get(role.role_id);
        if (discordRole) {
            try {
                await discordRole.setColor(newColor);
                await prManager.updateRole(role.role_id, { color: newColor });

                const successEmbed = colorManager.createEmbed()
                    .setDescription(`✅ **تم تغيير اللون إلى ${newColor}**`)
                    .setColor(newColor);
                await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
            } catch (error) {
                await interaction.followUp({ content: `❌ فشل في تغيير اللون: ${error.message}`, ephemeral: true });
            }
        }
    } catch (error) {
        const timeoutEmbed = colorManager.createEmbed()
            .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
        await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
    }
}

async function handleViewMembers(interaction, prManager, role, client) {
    await interaction.deferUpdate();

    const members = await prManager.getMembers(role.role_id);

    let description = '';
    for (const member of members) {
        let badge = '';
        if (member.user_id === role.owner_id) {
            badge = '👑 ';
        } else if (member.user_id === role.deputy_id) {
            badge = '⭐ ';
        }

        description += `${badge}<@${member.user_id}> - انضم <t:${member.joined_at}:R>\n`;
    }

    const membersEmbed = colorManager.createEmbed()
        .setTitle(`📋 **أعضاء ${role.role_name}**`)
        .setDescription(description || 'لا يوجد أعضاء')
        .addFields(
            { name: '👑 المالك', value: `<@${role.owner_id}>`, inline: true },
            { name: '⭐ النائب', value: role.deputy_id ? `<@${role.deputy_id}>` : 'لا يوجد', inline: true },
            { name: '🔢 العدد', value: `${members.length}/${role.member_limit}`, inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('roly_back')
            .setLabel('رجوع')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [membersEmbed], components: [backRow] });
}

async function handleSubInteraction(interaction, prManager, role, message, client, mainEmbed, mainRow) {
    const customId = interaction.customId;

    if (customId === 'roly_add_member') {
        const memberCount = await prManager.getMemberCount(role.role_id);
        
        if (memberCount >= role.member_limit) {
            await interaction.reply({ content: '❌ تم الوصول للحد الأقصى من الأعضاء', ephemeral: true });
            return;
        }

        const promptEmbed = colorManager.createEmbed()
            .setDescription('➕ **منشن العضو الذي تريد إضافته:**');
        
        await interaction.reply({ embeds: [promptEmbed], ephemeral: true });

        const filter = m => m.author.id === interaction.user.id;
        
        try {
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const response = collected.first();
            
            let memberId;
            if (response.mentions.users.size > 0) {
                memberId = response.mentions.users.first().id;
            } else {
                memberId = response.content.replace(/[<@!>]/g, '');
            }

            await response.delete().catch(() => {});

            const result = await prManager.addMember(role.role_id, memberId, interaction.user.id);

            if (result.success) {
                const discordRole = interaction.guild.roles.cache.get(role.role_id);
                if (discordRole) {
                    try {
                        const member = await interaction.guild.members.fetch(memberId);
                        await member.roles.add(discordRole);
                    } catch (e) {}
                }

                const successEmbed = colorManager.createEmbed()
                    .setDescription(`✅ **تم إضافة <@${memberId}> للرول**`);
                await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
            } else {
                await interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true });
            }
        } catch (error) {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await interaction.followUp({ embeds: [timeoutEmbed], ephemeral: true });
        }
    }
    else if (customId === 'roly_remove_member') {
        const members = await prManager.getMembers(role.role_id);
        const removableMembers = members.filter(m => m.user_id !== role.owner_id);

        if (removableMembers.length === 0) {
            await interaction.reply({ content: '❌ لا يوجد أعضاء يمكن إزالتهم', ephemeral: true });
            return;
        }

        const options = removableMembers.slice(0, 25).map(m => ({
            label: `المستخدم ${m.user_id}`,
            value: m.user_id,
            description: m.user_id === role.deputy_id ? 'النائب' : 'عضو'
        }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('roly_remove_member_select')
            .setPlaceholder('اختر العضو للإزالة...')
            .addOptions(options);

        const selectRow = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({ components: [selectRow] });
    }
    else if (customId === 'roly_remove_member_select') {
        const memberId = interaction.values[0];

        const result = await prManager.removeMember(role.role_id, memberId);

        if (result.success) {
            const discordRole = message.guild.roles.cache.get(role.role_id);
            if (discordRole) {
                try {
                    const member = await message.guild.members.fetch(memberId);
                    await member.roles.remove(discordRole);
                } catch (e) {}
            }

            const successEmbed = colorManager.createEmbed()
                .setDescription(`✅ **تم إزالة <@${memberId}> من الرول**`);
            await interaction.update({ embeds: [successEmbed], components: [] });
        } else {
            await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
    }
    else if (customId === 'roly_back') {
        const dbManager = getDatabase();
        await prManager.calculateRolePoints(role.role_id, dbManager);
        const updatedRole = await prManager.getRole(role.role_id);
        const memberCount = await prManager.getMemberCount(role.role_id);

        const newMainEmbed = colorManager.createEmbed()
            .setTitle(`🎭 **رولك الخاص: ${role.role_name}**`)
            .setDescription(`<@&${role.role_id}>`)
            .addFields(
                { name: '👤 المالك', value: `<@${role.owner_id}>`, inline: true },
                { name: '👥 النائب', value: role.deputy_id ? `<@${role.deputy_id}>` : 'لا يوجد', inline: true },
                { name: '🔢 الأعضاء', value: `${memberCount}/${role.member_limit}`, inline: true },
                { name: '⭐ النقاط', value: `${updatedRole.total_points}`, inline: true }
            )
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('roly_menu')
            .setPlaceholder('اختر العملية...')
            .addOptions([
                { label: 'إضافة/إزالة عضو', description: 'التحكم بأعضاء الرول', value: 'toggle_member', emoji: '👥' },
                { label: 'تغيير النائب', description: 'تعيين نائب جديد', value: 'change_deputy', emoji: '👤' },
                { label: 'وضع أيقون', description: 'تعيين أيقون للرول', value: 'set_icon', emoji: '🖼️' },
                { label: 'تغيير اللون', description: 'تغيير لون الرول', value: 'change_color', emoji: '🎨' },
                { label: 'عرض الأعضاء', description: 'عرض قائمة أعضاء الرول', value: 'view_members', emoji: '📋' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({ embeds: [newMainEmbed], components: [row] });
    }
}

module.exports = { name, aliases, execute };
