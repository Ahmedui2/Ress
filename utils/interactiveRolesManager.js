const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { collectUserStats, createUserStatsEmbed } = require('./userStatsCollector');
const colorManager = require('./colorManager');

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

async function handleMessage(message) {
    if (message.author.bot) return;
    
    const settings = loadSettings();
    if (!settings.settings.requestChannel || message.channel.id !== settings.settings.requestChannel) return;

    // Check if message contains a mention or ID
    const mentionMatch = message.content.match(/<@!?(\d+)>|(\d{17,19})/);
    if (!mentionMatch) {
        // Delete message if it doesn't contain a mention/ID in the request channel
        try { await message.delete(); } catch (e) {}
        return;
    }

    const targetId = mentionMatch[1] || mentionMatch[2];
    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);

    // Always delete the original message in the request channel
    try { await message.delete(); } catch (e) {}

    if (!targetMember) return;

    // Check if member already has any of the interactive roles
    const hasInteractiveRole = targetMember.roles.cache.some(r => settings.settings.interactiveRoles.includes(r.id));
    if (hasInteractiveRole) {
        const reply = await message.channel.send(`⚠️ <@${targetId}> لديه بالفعل رولات تفاعلية.`);
        setTimeout(() => reply.delete().catch(() => {}), 5000);
        return;
    }

    // Check cooldown
    const cooldown = settings.cooldowns[targetId];
    if (cooldown && Date.now() < cooldown) {
        const timeLeft = Math.ceil((cooldown - Date.now()) / (1000 * 60 * 60));
        const reply = await message.channel.send(`❌ <@${targetId}> لديه كولداون حالياً. المتبقي: ${timeLeft} ساعة.`);
        setTimeout(() => reply.delete().catch(() => {}), 5000);
        return;
    }

    // Check if already pending
    if (settings.pendingRequests[targetId]) {
        const reply = await message.channel.send(`⚠️ <@${targetId}> لديه طلب معلق بالفعل.`);
        setTimeout(() => reply.delete().catch(() => {}), 5000);
        return;
    }

    // Collect stats and create embed using the admin-apply style
    const userStats = await collectUserStats(targetMember);
    // Use simpleView = true for the initial embed as in admin-apply
    const statsEmbed = await createUserStatsEmbed(userStats, colorManager, true, message.member.displayName, `<@${message.author.id}>`);
    
    // Customize title for interactive roles
    statsEmbed.setTitle(`🎭 طلب رول تفاعلي`)
              .setDescription(`**Admin :** <@${message.author.id}>\n**Member :** <@${targetId}>\n\n${message.content}`);

    const applicationId = `${Date.now()}_${targetId}`;

    // Buttons using the admin-apply style (ButtonStyle.Secondary and specific emojis)
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`int_approve_${applicationId}`)
            .setLabel('Approve')
            .setEmoji('<:emoji_1:1436850272734285856>')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`int_reject_trigger_${applicationId}`)
            .setLabel('Reject')
            .setEmoji('<:emoji_1:1436850215154880553>')
            .setStyle(ButtonStyle.Secondary)
    );

    // Details menu using the admin-apply style
    const detailsMenu = new StringSelectMenuBuilder()
        .setCustomId(`int_details_${applicationId}`)
        .setPlaceholder('تفاصيل عن العضو')
        .addOptions([
            { label: 'Dates', description: 'عرض تواريخ الانضمام وإنشاء الحساب', value: 'dates' },
            { label: 'Evaluation', description: 'عرض تقييم العضو والمعايير', value: 'evaluation' },
            { label: 'Roles', description: 'عرض جميع الرولات للعضو', value: 'roles' },
            { label: 'Stats', description: 'عرض تفاصيل النشاط', value: 'advanced_stats' },
            { label: 'first ep', description: 'العودة للعرض الأساسي', value: 'simple_view' }
        ]);

    const row2 = new ActionRowBuilder().addComponents(detailsMenu);

    const sentMessage = await message.channel.send({
        content: `**طلب جديد من <@${message.author.id}> بخصوص <@${targetId}>**`,
        embeds: [statsEmbed],
        components: [row1, row2]
    });

    // Save pending request
    settings.pendingRequests[targetId] = {
        applicationId: applicationId,
        messageId: sentMessage.id,
        requesterId: message.author.id,
        targetId: targetId,
        timestamp: Date.now(),
        originalContent: message.content,
        userStats: userStats
    };
    saveSettings(settings);
}

async function handleInteraction(interaction) {
    const settings = loadSettings();
    const customId = interaction.customId;

    if (!customId.startsWith('int_')) return;

    // Check if user is an approver
    const isApprover = interaction.member.roles.cache.some(r => settings.settings.approvers.includes(r.id)) || 
                       interaction.guild.ownerId === interaction.user.id;

    // Handle Details Menu (Same as admin-apply)
    if (customId.startsWith('int_details_')) {
        // التحقق من صلاحية المستخدم فوراً
        if (!isApprover) {
            return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});
        }

        // إرجاء الرد لتجنب خطأ انتهاء وقت التفاعل (Unknown Interaction)
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate().catch(err => {
                if (err.code !== 10062) console.error('Error deferring update:', err);
            });
        }
        
        // التحقق من حالة التفاعل بعد التأجيل
        if (!interaction.deferred && !interaction.replied) return;

        const applicationId = customId.replace('int_details_', '');
        const targetId = applicationId.split('_')[1];
        const request = settings.pendingRequests[targetId];
        
        if (!request) {
            return interaction.followUp({ content: '❌ لم يتم العثور على بيانات الطلب.', ephemeral: true }).catch(() => {});
        }

        const value = interaction.values[0];
        const userStats = request.userStats;
        
        let updatedEmbed;
        try {
            if (value === 'simple_view') {
                updatedEmbed = await createUserStatsEmbed(userStats, colorManager, true, null, `<@${request.requesterId}>`);
                updatedEmbed.setTitle(`🎭 طلب رول تفاعلي`).setDescription(`**Admin :** <@${request.requesterId}>\n**Member :** <@${targetId}>\n\n${request.originalContent}`);
            } else {
                // Full view with specific category matching admin-apply logic
                updatedEmbed = await createUserStatsEmbed(userStats, colorManager, false, null, `<@${request.requesterId}>`, value);
                
                // Re-apply title and correct styling after createUserStatsEmbed
                const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
                updatedEmbed.setTitle(`🎭 تفاصيل العضو: ${targetMember ? targetMember.user.username : targetId}`);
                
                // Add requester field if it's missing in some views
                if (updatedEmbed.data && updatedEmbed.data.fields && !updatedEmbed.data.fields.some(f => f.name && f.name.includes('بواسطة'))) {
                    updatedEmbed.addFields({ name: 'بواسطة', value: `<@${request.requesterId}>`, inline: true });
                }
            }

            await interaction.editReply({ embeds: [updatedEmbed] }).catch(err => {
                if (err.code !== 10062) console.error('Error in editReply (details):', err);
            });
        } catch (error) {
            console.error('Error updating interaction embed:', error);
        }
        return;
    }

    if (customId.startsWith('int_approve_')) {
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true });
        
        const applicationId = customId.replace('int_approve_', '');
        const targetId = applicationId.split('_')[1];
        const request = settings.pendingRequests[targetId];
        if (!request) return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب.', ephemeral: true });

        const roles = settings.settings.interactiveRoles;
        if (roles.length === 0) return interaction.reply({ content: '❌ لم يتم تحديد رولات تفاعلية في الإعدادات.', ephemeral: true });

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`int_select_role_${targetId}`)
            .setPlaceholder('اختر الرول المراد إعطاؤه...')
            .addOptions(roles.map(id => {
                const role = interaction.guild.roles.cache.get(id);
                return { label: role ? role.name : id, value: id };
            }));

        await interaction.reply({ content: '✅ اختر الرول المناسب للعضو بناءً على تفاعله:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });

    } else if (customId.startsWith('int_select_role_')) {
        const targetId = customId.split('_')[3];
        const roleId = interaction.values[0];
        const request = settings.pendingRequests[targetId];
        
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        const role = interaction.guild.roles.cache.get(roleId);

        if (targetMember && role) {
            await targetMember.roles.add(role);
            try {
                await targetMember.send(`✅ **تهانينا!** تم قبول طلبك للرول التفاعلي وحصلت على رول: **${role.name}** في سيرفر **${interaction.guild.name}**.`);
            } catch (e) {}

            const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
            if (channel) {
                const msg = await channel.messages.fetch(request.messageId).catch(() => null);
                if (msg) {
                    const embed = EmbedBuilder.from(msg.embeds[0])
                        .setColor(colorManager.getColor ? colorManager.getColor() : '#00ff00')
                        .addFields({ name: 'الحالة', value: `✅ تم القبول بواسطة <@${interaction.user.id}>\nالرول الممنوح: <@&${roleId}>` });
                    await msg.edit({ embeds: [embed], components: [] });
                }
            }

            delete settings.pendingRequests[targetId];
            saveSettings(settings);
            await interaction.update({ content: `✅ تم منح الرول <@&${roleId}> لـ <@${targetId}> بنجاح.`, components: [] });
        }

    } else if (customId.startsWith('int_reject_trigger_')) {
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true });
        
        const applicationId = customId.replace('int_reject_trigger_', '');
        const targetId = applicationId.split('_')[1];
        
        const modal = new ModalBuilder()
            .setCustomId(`int_reject_modal_${targetId}`)
            .setTitle('سبب الرفض');
        
        const reasonInput = new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('السبب')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('اذكر سبب الرفض هنا...');
        
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);

    } else if (customId.startsWith('int_reject_modal_')) {
        const targetId = customId.split('_')[3];
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const request = settings.pendingRequests[targetId];

        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (targetMember) {
            try {
                await targetMember.send(`❌ **للأسف!** تم رفض طلبك للرول التفاعلي في سيرفر **${interaction.guild.name}**.\n**السبب:** ${reason}\nيمكنك التقديم مرة أخرى بعد 24 ساعة.`);
            } catch (e) {}
        }

        settings.cooldowns[targetId] = Date.now() + (24 * 60 * 60 * 1000);

        const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
        if (channel) {
            const msg = await channel.messages.fetch(request.messageId).catch(() => null);
            if (msg) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor(colorManager.getColor ? colorManager.getColor() : '#ff0000')
                    .addFields({ name: 'الحالة', value: `❌ تم الرفض بواسطة <@${interaction.user.id}>\n**السبب:** ${reason}` });
                await msg.edit({ embeds: [embed], components: [] });
            }
        }

        delete settings.pendingRequests[targetId];
        saveSettings(settings);
        await interaction.reply({ content: `✅ تم رفض الطلب ووضع كولداون لـ <@${targetId}>.`, ephemeral: true });
    }
}

module.exports = { handleMessage, handleInteraction };
