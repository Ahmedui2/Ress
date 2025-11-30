const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');

const name = 'create';
const aliases = ['انشاء', 'اضافة'];

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

    const filter = m => m.author.id === message.author.id;

    const step1Embed = colorManager.createEmbed()
        .setTitle('➕ **إنشاء رول خاص**')
        .setDescription('**الخطوة 1/4:** منشن المالك للرول الخاص')
        .setFooter({ text: 'اكتب cancel للإلغاء' })
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    await message.channel.send({ embeds: [step1Embed] });

    try {
        const ownerResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const ownerMsg = ownerResponse.first();
        
        if (ownerMsg.content.toLowerCase() === 'cancel') {
            const cancelEmbed = colorManager.createEmbed().setDescription('❌ **تم إلغاء العملية**');
            await message.channel.send({ embeds: [cancelEmbed] });
            return;
        }

        let ownerId;
        if (ownerMsg.mentions.users.size > 0) {
            ownerId = ownerMsg.mentions.users.first().id;
        } else {
            ownerId = ownerMsg.content.replace(/[<@!>]/g, '');
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

        const step2Embed = colorManager.createEmbed()
            .setTitle('➕ **إنشاء رول خاص**')
            .setDescription(`**المالك:** <@${ownerId}>\n\n**الخطوة 2/4:** منشن النائب (أو اكتب \`none\` للتخطي)`)
            .setFooter({ text: 'اكتب cancel للإلغاء' })
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [step2Embed] });

        const deputyResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const deputyMsg = deputyResponse.first();
        
        if (deputyMsg.content.toLowerCase() === 'cancel') {
            const cancelEmbed = colorManager.createEmbed().setDescription('❌ **تم إلغاء العملية**');
            await message.channel.send({ embeds: [cancelEmbed] });
            return;
        }

        let deputyId = null;
        if (deputyMsg.content.toLowerCase() !== 'none') {
            if (deputyMsg.mentions.users.size > 0) {
                deputyId = deputyMsg.mentions.users.first().id;
            } else if (/^\d{17,19}$/.test(deputyMsg.content)) {
                deputyId = deputyMsg.content;
            }
        }

        const step3Embed = colorManager.createEmbed()
            .setTitle('➕ **إنشاء رول خاص**')
            .setDescription(`**المالك:** <@${ownerId}>\n**النائب:** ${deputyId ? `<@${deputyId}>` : 'لا يوجد'}\n\n**الخطوة 3/4:** اكتب اسم الرول`)
            .setFooter({ text: 'اكتب cancel للإلغاء' })
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [step3Embed] });

        const nameResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const roleName = nameResponse.first().content;
        
        if (roleName.toLowerCase() === 'cancel') {
            const cancelEmbed = colorManager.createEmbed().setDescription('❌ **تم إلغاء العملية**');
            await message.channel.send({ embeds: [cancelEmbed] });
            return;
        }

        const step4Embed = colorManager.createEmbed()
            .setTitle('➕ **إنشاء رول خاص**')
            .setDescription(`**المالك:** <@${ownerId}>\n**النائب:** ${deputyId ? `<@${deputyId}>` : 'لا يوجد'}\n**الاسم:** ${roleName}\n\n**الخطوة 4/4:** اكتب حد الأعضاء (رقم)`)
            .setFooter({ text: 'اكتب cancel للإلغاء' })
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [step4Embed] });

        const limitResponse = await message.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const limitMsg = limitResponse.first().content;
        
        if (limitMsg.toLowerCase() === 'cancel') {
            const cancelEmbed = colorManager.createEmbed().setDescription('❌ **تم إلغاء العملية**');
            await message.channel.send({ embeds: [cancelEmbed] });
            return;
        }

        const memberLimit = parseInt(limitMsg) || 5;

        const loadingEmbed = colorManager.createEmbed()
            .setDescription('⏳ **جاري إنشاء الرول الخاص...**');
        const loadingMsg = await message.channel.send({ embeds: [loadingEmbed] });

        try {
            const { AVAILABLE_PERMISSIONS } = require('./perms.js');
            const enabledPerms = await prManager.getPermissions();
            const permissionFlags = [];
            
            for (const perm of enabledPerms) {
                if (PermissionFlagsBits[perm.permission_name]) {
                    permissionFlags.push(PermissionFlagsBits[perm.permission_name]);
                }
            }

            const discordRole = await message.guild.roles.create({
                name: roleName,
                color: 'Random',
                reason: `رول خاص للمستخدم ${ownerId}`,
                permissions: permissionFlags
            });

            const result = await prManager.createRole(
                discordRole.id,
                roleName,
                ownerId,
                deputyId,
                memberLimit
            );

            if (!result.success) {
                await discordRole.delete();
                throw new Error(result.error);
            }

            const ownerMember = await message.guild.members.fetch(ownerId).catch(() => null);
            if (ownerMember) {
                await ownerMember.roles.add(discordRole);
            }

            if (deputyId) {
                const deputyMember = await message.guild.members.fetch(deputyId).catch(() => null);
                if (deputyMember) {
                    await deputyMember.roles.add(discordRole);
                }
            }

            const successEmbed = colorManager.createEmbed()
                .setTitle('✅ **تم إنشاء الرول الخاص**')
                .setDescription(`**الرول:** <@&${discordRole.id}>`)
                .addFields(
                    { name: '👤 المالك', value: `<@${ownerId}>`, inline: true },
                    { name: '👥 النائب', value: deputyId ? `<@${deputyId}>` : 'لا يوجد', inline: true },
                    { name: '🔢 حد الأعضاء', value: `${memberLimit}`, inline: true }
                )
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            await loadingMsg.edit({ embeds: [successEmbed] });

            const logChannel = await prManager.getSetting('log_channel');
            if (logChannel) {
                const channel = message.guild.channels.cache.get(logChannel);
                if (channel) {
                    const logEmbed = colorManager.createEmbed()
                        .setTitle('📝 **تم إنشاء رول خاص**')
                        .addFields(
                            { name: 'الرول', value: `<@&${discordRole.id}>`, inline: true },
                            { name: 'المالك', value: `<@${ownerId}>`, inline: true },
                            { name: 'أنشأه', value: `<@${message.author.id}>`, inline: true }
                        )
                        .setTimestamp();
                    await channel.send({ embeds: [logEmbed] });
                }
            }

        } catch (error) {
            console.error('خطأ في إنشاء الرول:', error);
            const errorEmbed = colorManager.createEmbed()
                .setDescription(`❌ **حدث خطأ أثناء إنشاء الرول:**\n${error.message}`);
            await loadingMsg.edit({ embeds: [errorEmbed] });
        }

    } catch (error) {
        if (error.message === 'time') {
            const timeoutEmbed = colorManager.createEmbed()
                .setDescription('❌ **انتهى الوقت المخصص للإجابة**');
            await message.channel.send({ embeds: [timeoutEmbed] });
        } else {
            console.error('خطأ:', error);
            const errorEmbed = colorManager.createEmbed()
                .setDescription(`❌ **حدث خطأ:** ${error.message}`);
            await message.channel.send({ embeds: [errorEmbed] });
        }
    }
}

module.exports = { name, aliases, execute };
