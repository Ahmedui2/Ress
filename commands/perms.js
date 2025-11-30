const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { getPrivateRolesManager } = require('../utils/privateRolesManager.js');

const name = 'perms';
const aliases = ['صلاحيات', 'permissions'];

const AVAILABLE_PERMISSIONS = [
    { name: 'SendMessages', value: 'SendMessages', label: 'إرسال الرسائل', emoji: '💬' },
    { name: 'AttachFiles', value: 'AttachFiles', label: 'إرفاق الملفات', emoji: '📎' },
    { name: 'EmbedLinks', value: 'EmbedLinks', label: 'روابط مضمنة', emoji: '🔗' },
    { name: 'AddReactions', value: 'AddReactions', label: 'إضافة تفاعلات', emoji: '👍' },
    { name: 'UseExternalEmojis', value: 'UseExternalEmojis', label: 'إيموجي خارجية', emoji: '😀' },
    { name: 'UseExternalStickers', value: 'UseExternalStickers', label: 'ستيكرات خارجية', emoji: '🏷️' },
    { name: 'ReadMessageHistory', value: 'ReadMessageHistory', label: 'قراءة السجل', emoji: '📜' },
    { name: 'Connect', value: 'Connect', label: 'الاتصال بالصوت', emoji: '🔊' },
    { name: 'Speak', value: 'Speak', label: 'التحدث', emoji: '🎤' },
    { name: 'Stream', value: 'Stream', label: 'البث المباشر', emoji: '📺' },
    { name: 'UseVAD', value: 'UseVAD', label: 'استخدام VAD', emoji: '🎙️' },
    { name: 'PrioritySpeaker', value: 'PrioritySpeaker', label: 'أولوية التحدث', emoji: '⭐' },
    { name: 'MuteMembers', value: 'MuteMembers', label: 'كتم الأعضاء', emoji: '🔇' },
    { name: 'DeafenMembers', value: 'DeafenMembers', label: 'إصمات الأعضاء', emoji: '🔕' },
    { name: 'MoveMembers', value: 'MoveMembers', label: 'نقل الأعضاء', emoji: '↔️' },
    { name: 'ManageMessages', value: 'ManageMessages', label: 'إدارة الرسائل', emoji: '🗑️' },
    { name: 'MentionEveryone', value: 'MentionEveryone', label: 'منشن الجميع', emoji: '📢' },
    { name: 'CreateInstantInvite', value: 'CreateInstantInvite', label: 'إنشاء دعوات', emoji: '✉️' },
    { name: 'ChangeNickname', value: 'ChangeNickname', label: 'تغيير اللقب', emoji: '📝' },
    { name: 'ManageNicknames', value: 'ManageNicknames', label: 'إدارة الألقاب', emoji: '👤' }
];

async function execute(message, args, { BOT_OWNERS, client }) {
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
    const currentPerms = await prManager.getPermissions();
    const enabledPerms = currentPerms.map(p => p.permission_name);

    const mainEmbed = colorManager.createEmbed()
        .setTitle('🔐 **صلاحيات الرولات الخاصة**')
        .setDescription('**اختر الصلاحيات التي تريد منحها للرولات الخاصة عند إنشائها:**\n\n*يمكنك اختيار عدة صلاحيات*')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    let currentPage = 0;
    const permsPerPage = 10;
    const totalPages = Math.ceil(AVAILABLE_PERMISSIONS.length / permsPerPage);

    function buildSelectMenu(page) {
        const start = page * permsPerPage;
        const end = start + permsPerPage;
        const pagePerms = AVAILABLE_PERMISSIONS.slice(start, end);

        const options = pagePerms.map(perm => ({
            label: perm.label,
            value: perm.value,
            emoji: perm.emoji,
            description: enabledPerms.includes(perm.name) ? '✅ مفعل' : '❌ معطل',
            default: enabledPerms.includes(perm.name)
        }));

        return new StringSelectMenuBuilder()
            .setCustomId(`perms_select_${page}`)
            .setPlaceholder('اختر الصلاحيات...')
            .setMinValues(0)
            .setMaxValues(options.length)
            .addOptions(options);
    }

    function buildEmbed(page) {
        const start = page * permsPerPage;
        const end = Math.min(start + permsPerPage, AVAILABLE_PERMISSIONS.length);
        const pagePerms = AVAILABLE_PERMISSIONS.slice(start, end);

        let description = '**الصلاحيات المتاحة:**\n\n';
        for (const perm of pagePerms) {
            const status = enabledPerms.includes(perm.name) ? '✅' : '❌';
            description += `${perm.emoji} **${perm.label}** ${status}\n`;
        }

        description += `\n**الصفحة ${page + 1} من ${totalPages}**`;

        return colorManager.createEmbed()
            .setTitle('🔐 **صلاحيات الرولات الخاصة**')
            .setDescription(description)
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
    }

    function buildComponents(page) {
        const components = [];
        
        components.push(new ActionRowBuilder().addComponents(buildSelectMenu(page)));

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('perms_prev')
                .setLabel('السابق')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('perms_next')
                .setLabel('التالي')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === totalPages - 1),
            new ButtonBuilder()
                .setCustomId('perms_save')
                .setLabel('حفظ الإعدادات')
                .setStyle(ButtonStyle.Success)
                .setEmoji('💾'),
            new ButtonBuilder()
                .setCustomId('perms_reset')
                .setLabel('إعادة تعيين')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔄')
        );

        components.push(navRow);
        return components;
    }

    const sentMessage = await message.channel.send({
        embeds: [buildEmbed(currentPage)],
        components: buildComponents(currentPage)
    });

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 300000
    });

    let selectedPerms = [...enabledPerms];

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId.startsWith('perms_select_')) {
                const page = parseInt(interaction.customId.split('_')[2]);
                const start = page * permsPerPage;
                const end = start + permsPerPage;
                const pagePerms = AVAILABLE_PERMISSIONS.slice(start, end);

                for (const perm of pagePerms) {
                    const index = selectedPerms.indexOf(perm.name);
                    if (index > -1) {
                        selectedPerms.splice(index, 1);
                    }
                }

                for (const value of interaction.values) {
                    if (!selectedPerms.includes(value)) {
                        selectedPerms.push(value);
                    }
                }

                enabledPerms.length = 0;
                enabledPerms.push(...selectedPerms);

                await interaction.update({
                    embeds: [buildEmbed(currentPage)],
                    components: buildComponents(currentPage)
                });
            }
            else if (interaction.customId === 'perms_prev') {
                currentPage = Math.max(0, currentPage - 1);
                await interaction.update({
                    embeds: [buildEmbed(currentPage)],
                    components: buildComponents(currentPage)
                });
            }
            else if (interaction.customId === 'perms_next') {
                currentPage = Math.min(totalPages - 1, currentPage + 1);
                await interaction.update({
                    embeds: [buildEmbed(currentPage)],
                    components: buildComponents(currentPage)
                });
            }
            else if (interaction.customId === 'perms_save') {
                for (const perm of AVAILABLE_PERMISSIONS) {
                    const isEnabled = selectedPerms.includes(perm.name);
                    await prManager.setPermission(perm.name, perm.value, isEnabled);
                }

                const successEmbed = colorManager.createEmbed()
                    .setTitle('✅ **تم الحفظ**')
                    .setDescription(`**تم حفظ ${selectedPerms.length} صلاحية للرولات الخاصة**`)
                    .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

                await interaction.update({ embeds: [successEmbed], components: [] });
            }
            else if (interaction.customId === 'perms_reset') {
                selectedPerms = [];
                enabledPerms.length = 0;

                for (const perm of AVAILABLE_PERMISSIONS) {
                    await prManager.setPermission(perm.name, perm.value, false);
                }

                await interaction.update({
                    embeds: [buildEmbed(currentPage)],
                    components: buildComponents(currentPage)
                });
            }
        } catch (error) {
            console.error('خطأ في التفاعل:', error);
        }
    });
}

module.exports = { name, aliases, execute, AVAILABLE_PERMISSIONS };
