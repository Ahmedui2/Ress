const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');

const name = 'رولك';
const aliases = ['rolak', 'yourrole'];

async function execute(message, args, { BOT_OWNERS, client, ADMIN_ROLES }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const member = await message.guild.members.fetch(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => ADMIN_ROLES.includes(role.id));
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

    if (!hasAdminRole && !isOwner) {
        await message.react('❌');
        return;
    }

    const prManager = getPrivateRolesManager();

    if (!message.mentions.users.size && !args[0]) {
        const usageEmbed = colorManager.createEmbed()
            .setTitle('📋 **طلب إنشاء رول خاص**')
            .setDescription('**الاستخدام:**\n`رولك @المالك`\n\n**مثال:**\n`رولك @User1`\n\n*سيُطلب منك إدخال النائب واسم الرول وحد الأعضاء*')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [usageEmbed] });
        return;
    }

    let ownerId;
    if (message.mentions.users.size > 0) {
        ownerId = message.mentions.users.first().id;
    } else {
        ownerId = args[0].replace(/[<@!>]/g, '');
    }

    if (!/^\d{17,19}$/.test(ownerId)) {
        const errorEmbed = colorManager.createEmbed()
            .setDescription('❌ **آي دي المالك غير صحيح**');
        await message.channel.send({ embeds: [errorEmbed] });
        return;
    }

    const existingRole = await prManager.getRoleByOwner(ownerId);
    if (existingRole) {
        const errorEmbed = colorManager.createEmbed()
            .setDescription('❌ **هذا المستخدم لديه رول خاص بالفعل**');
        await message.channel.send({ embeds: [errorEmbed] });
        return;
    }

    const stepEmbed = colorManager.createEmbed()
        .setTitle('📋 **إنشاء رول خاص**')
        .setDescription(`**المالك:** <@${ownerId}>\n\n**الخطوة 1/3:** منشن النائب (أو اكتب \`none\` لتخطي)`)
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    await message.channel.send({ embeds: [stepEmbed] });

    const filter = m => m.author.id === message.author.id;
    let deputyId = null;
    let roleName = null;
    let memberLimit = 5;

    try {
        const deputyResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const deputyMsg = deputyResponse.first().content;

        if (deputyMsg.toLowerCase() !== 'none') {
            if (deputyMsg.includes('<@')) {
                deputyId = deputyMsg.replace(/[<@!>]/g, '');
            } else if (/^\d{17,19}$/.test(deputyMsg)) {
                deputyId = deputyMsg;
            }
        }

        const nameEmbed = colorManager.createEmbed()
            .setTitle('📋 **إنشاء رول خاص**')
            .setDescription(`**المالك:** <@${ownerId}>\n**النائب:** ${deputyId ? `<@${deputyId}>` : 'لا يوجد'}\n\n**الخطوة 2/3:** اكتب اسم الرول`)
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [nameEmbed] });

        const nameResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        roleName = nameResponse.first().content;

        const limitEmbed = colorManager.createEmbed()
            .setTitle('📋 **إنشاء رول خاص**')
            .setDescription(`**المالك:** <@${ownerId}>\n**النائب:** ${deputyId ? `<@${deputyId}>` : 'لا يوجد'}\n**الاسم:** ${roleName}\n\n**الخطوة 3/3:** اكتب حد الأعضاء (رقم)`)
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [limitEmbed] });

        const limitResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        memberLimit = parseInt(limitResponse.first().content) || 5;

        const requestResult = await prManager.createRequest(
            message.author.id,
            ownerId,
            deputyId,
            roleName,
            memberLimit
        );

        if (!requestResult.success) {
            throw new Error(requestResult.error);
        }

        const pendingEmbed = colorManager.createEmbed()
            .setTitle('📨 **تم إرسال الطلب**')
            .setDescription('**تفاصيل الطلب:**')
            .addFields(
                { name: '👤 المالك', value: `<@${ownerId}>`, inline: true },
                { name: '👥 النائب', value: deputyId ? `<@${deputyId}>` : 'لا يوجد', inline: true },
                { name: '📝 الاسم', value: roleName, inline: true },
                { name: '🔢 الحد', value: `${memberLimit}`, inline: true },
                { name: '📌 الحالة', value: '⏳ قيد الانتظار', inline: true }
            )
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [pendingEmbed] });

        const approvalChannel = await prManager.getSetting('approval_channel');
        if (approvalChannel) {
            const channel = message.guild.channels.cache.get(approvalChannel);
            if (channel) {
                const approvalEmbed = colorManager.createEmbed()
                    .setTitle('📋 **طلب رول خاص جديد**')
                    .setDescription(`**طلب من:** <@${message.author.id}>`)
                    .addFields(
                        { name: '👤 المالك', value: `<@${ownerId}>`, inline: true },
                        { name: '👥 النائب', value: deputyId ? `<@${deputyId}>` : 'لا يوجد', inline: true },
                        { name: '📝 الاسم', value: roleName, inline: true },
                        { name: '🔢 الحد', value: `${memberLimit}`, inline: true }
                    )
                    .setTimestamp();

                const approvalRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rolk_approve_${requestResult.requestId}`)
                        .setLabel('قبول')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`rolk_reject_${requestResult.requestId}`)
                        .setLabel('رفض')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );

                await channel.send({ embeds: [approvalEmbed], components: [approvalRow] });
            }
        } else {
            const noChannelEmbed = colorManager.createEmbed()
                .setDescription('⚠️ **تنبيه:** لم يتم تعيين قناة الموافقات. يرجى تعيينها من إعدادات المسؤولين.');
            await message.channel.send({ embeds: [noChannelEmbed] });
        }

    } catch (error) {
        if (error.message === 'time') {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await message.channel.send({ embeds: [timeoutEmbed] });
        } else {
            console.error('خطأ في إنشاء طلب الرول:', error);
            const errorEmbed = colorManager.createEmbed()
                .setDescription(`❌ **حدث خطأ:** ${error.message}`);
            await message.channel.send({ embeds: [errorEmbed] });
        }
    }
}

async function handleApproval(interaction, prManager, client, BOT_OWNERS) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const action = parts[1];
    const requestId = parseInt(parts[2]);

    const isOwner = BOT_OWNERS.includes(interaction.user.id) || interaction.guild.ownerId === interaction.user.id;
    const isManager = await prManager.isManager(interaction.user.id);

    if (!isOwner && !isManager) {
        await interaction.reply({ content: '❌ ليس لديك صلاحية للموافقة أو الرفض', ephemeral: true });
        return;
    }

    const request = await prManager.getRequest(requestId);
    if (!request) {
        await interaction.reply({ content: '❌ الطلب غير موجود', ephemeral: true });
        return;
    }

    if (request.status !== 'pending') {
        await interaction.reply({ content: '❌ تم معالجة هذا الطلب مسبقاً', ephemeral: true });
        return;
    }

    if (action === 'approve') {
        await interaction.deferUpdate();

        try {
            const { AVAILABLE_PERMISSIONS } = require('./perms.js');
            const { PermissionFlagsBits } = require('discord.js');

            const enabledPerms = await prManager.getPermissions();
            const permissionFlags = [];
            
            for (const perm of enabledPerms) {
                if (PermissionFlagsBits[perm.permission_name]) {
                    permissionFlags.push(PermissionFlagsBits[perm.permission_name]);
                }
            }

            const discordRole = await interaction.guild.roles.create({
                name: request.role_name,
                color: 'Random',
                reason: `رول خاص للمستخدم ${request.owner_id} - موافقة من ${interaction.user.id}`,
                permissions: permissionFlags
            });

            await prManager.createRole(
                discordRole.id,
                request.role_name,
                request.owner_id,
                request.deputy_id,
                request.member_limit
            );

            const ownerMember = await interaction.guild.members.fetch(request.owner_id).catch(() => null);
            if (ownerMember) {
                await ownerMember.roles.add(discordRole);
            }

            if (request.deputy_id) {
                const deputyMember = await interaction.guild.members.fetch(request.deputy_id).catch(() => null);
                if (deputyMember) {
                    await deputyMember.roles.add(discordRole);
                }
            }

            await prManager.updateRequestStatus(requestId, 'approved', interaction.user.id);

            const approvedEmbed = colorManager.createEmbed()
                .setTitle('✅ **تم قبول الطلب**')
                .addFields(
                    { name: 'الرول', value: `<@&${discordRole.id}>`, inline: true },
                    { name: 'المالك', value: `<@${request.owner_id}>`, inline: true },
                    { name: 'وافق عليه', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [approvedEmbed], components: [] });

        } catch (error) {
            console.error('خطأ في الموافقة على الطلب:', error);
            const errorEmbed = colorManager.createEmbed()
                .setDescription(`❌ **حدث خطأ:** ${error.message}`);
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
        }

    } else if (action === 'reject') {
        await prManager.updateRequestStatus(requestId, 'rejected', interaction.user.id);

        const rejectedEmbed = colorManager.createEmbed()
            .setTitle('❌ **تم رفض الطلب**')
            .addFields(
                { name: 'الاسم', value: request.role_name, inline: true },
                { name: 'المالك', value: `<@${request.owner_id}>`, inline: true },
                { name: 'رفضه', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp();

        await interaction.update({ embeds: [rejectedEmbed], components: [] });
    }
}

module.exports = { name, aliases, execute, handleApproval };
