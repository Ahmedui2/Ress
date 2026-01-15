const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { collectUserStats, createUserStatsEmbed, loadEvaluationSettings, getEvaluationType } = require('./userStatsCollector');
const colorManager = require('./colorManager');

const interactiveRolesPath = path.join(__dirname, '..', 'data', 'interactiveRoles.json');

function loadSettings() {
    try {
        if (fs.existsSync(interactiveRolesPath)) {
            const data = fs.readFileSync(interactiveRolesPath, 'utf8');
            return JSON.parse(data);
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
    try {
        if (!message || !message.guild || message.author.bot) return;
        
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
        
        // Always delete the original message in the request channel
        try { await message.delete(); } catch (e) {}

        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) {
            const reply = await message.channel.send(`❌ لم يتم العثور على العضو <@${targetId}> في السيرفر.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

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

        // Collect stats and create embed
        const userStats = await collectUserStats(targetMember);
        const statsEmbed = await createUserStatsEmbed(userStats, colorManager, true, message.member.displayName, `<@${message.author.id}>`);
        
        statsEmbed.setTitle(`🎭 طلب رول تفاعلي`)
                  .setDescription(`**Admin :** <@${message.author.id}>\n**Member :** <@${targetId}>\n\n${message.content}`);

        const applicationId = `${Date.now()}_${targetId}`;

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

        const approverMentions = settings.settings.approvers && settings.settings.approvers.length > 0 
            ? settings.settings.approvers.map(id => `<@&${id}>`).join(' ') 
            : '';

        const sentMessage = await message.channel.send({
            content: approverMentions || null,
            embeds: [statsEmbed],
            components: [row1, row2]
        });

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
    } catch (error) {
        console.error('Error in handleMessage (Interactive Roles):', error);
    }
}

async function handleInteraction(interaction) {
    try {
        if (!interaction || !interaction.customId || !interaction.customId.startsWith('int_')) return;

        const settings = loadSettings();
        const customId = interaction.customId;

        const isApprover = interaction.member.roles.cache.some(r => settings.settings.approvers.includes(r.id)) || 
                           interaction.guild.ownerId === interaction.user.id;

        // Handle Details Menu
        if (customId.startsWith('int_details_')) {
            const applicationId = customId.replace('int_details_', '');
            const targetId = applicationId.split('_')[1];
            const request = settings.pendingRequests[targetId];
            
            if (!request) {
                return interaction.reply({ content: '❌ لم يتم العثور على بيانات الطلب أو تم معالجته.', ephemeral: true });
            }

            const value = interaction.values[0];
            const userStats = request.userStats;
            let updatedEmbed;
            
            switch (value) {
                case 'dates':
                    updatedEmbed = colorManager.createEmbed()
                        .setTitle(`📅 Dates - ${userStats.mention}`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '**انضمام السيرفر**', value: `**${userStats.joinedServerFormatted}**`, inline: false },
                            { name: '**إنشاء الحساب**', value: `**${userStats.accountCreatedFormatted}**`, inline: false },
                            { name: '**المدة في السيرفر**', value: `${userStats.timeInServerFormatted}`, inline: true },
                            { name: '**عمر الحساب**', value: `${userStats.accountAgeFormatted}`, inline: true },
                            { name: ' **آخر نشاط**', value: `**${userStats.lastActivity}**`, inline: true }
                        ]);
                    break;

                case 'evaluation':
                    const evaluationSettings = loadEvaluationSettings();
                    const timeInServerDays = Math.floor(userStats.timeInServerMs / (24 * 60 * 60 * 1000));
                    const messageCount = evaluationSettings.minMessages.resetWeekly ? userStats.weeklyMessages || 0 : userStats.realMessages;
                    const voiceTime = evaluationSettings.minVoiceTime.resetWeekly ? userStats.weeklyVoiceTime || 0 : userStats.realVoiceTime;
                    const reactionCount = evaluationSettings.minReactions.resetWeekly ? userStats.weeklyReactions || 0 : userStats.reactionsGiven || 0;

                    const messageLabel = evaluationSettings.minMessages.resetWeekly ? "<:emoji:1443616698996359380> Messages : ( week )" : "<:emoji:1443616698996359380> Messages : ( All )";
                    const voiceLabel = evaluationSettings.minVoiceTime.resetWeekly ? "<:emoji:1443616700707635343> Voice : ( week )" : "<:emoji:1443616700707635343> Voice : ( All )";
                    const reactionLabel = evaluationSettings.minReactions.resetWeekly ? "Reactions : ( week )" : "Reactions : ( All )";

                    const evaluation = getEvaluationType(
                        userStats.realMessages, userStats.weeklyMessages || 0,
                        userStats.realVoiceTime, userStats.weeklyVoiceTime || 0,
                        userStats.reactionsGiven || 0, userStats.weeklyReactions || 0,
                        userStats.activeDays, timeInServerDays
                    );

                    updatedEmbed = colorManager.createEmbed()
                        .setTitle(`📊 Evaluation - ${userStats.mention}`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: ` **${messageLabel}**`, value: `**${messageCount.toLocaleString()}**`, inline: true },
                            { name: ` **${voiceLabel}**`, value: `**${evaluationSettings.minVoiceTime.resetWeekly ? userStats.formattedWeeklyVoiceTime || 'No Data' : userStats.formattedVoiceTime || 'No Data'}**`, inline: true },
                            { name: ` **${reactionLabel}**`, value: `**${reactionCount.toLocaleString()}**`, inline: true },
                            { name: ' **Active**', value: userStats.activeDays >= evaluationSettings.activeDaysPerWeek.minimum ? '🟢 **نشط**' : '🔴 **غير نشط**', inline: true },
                            { name: '  **الخبرة حسب المدة**', value: timeInServerDays >= evaluationSettings.timeInServerDays.excellent ? '🟢 **خبرة ممتازة**' : timeInServerDays >= evaluationSettings.timeInServerDays.minimum ? '🟡 **خبرة جيدة**' : '🔴 **جديد**', inline: true }
                        ]);
                    break;

                case 'roles':
                    const rolesText = userStats.roles.length > 0
                        ? userStats.roles.map((role, index) => `**${index + 1}.** <@&${role.id}> (${role.name})`).join('\n')
                        : '**لا توجد رولات إضافية**';

                    updatedEmbed = colorManager.createEmbed()
                        .setTitle(`🎭 Roles - ${userStats.mention}`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: '**إجمالي الرولات**', value: `**${userStats.roleCount}** رول`, inline: true },
                            { name: ' **حالة الإدارة**', value: userStats.hasAdminRoles ? '✅ **لديه رولات إدارية**' : '❌ **لا يملك رولات إدارية**', inline: true },
                            { name: '**قائمة الرولات**', value: rolesText.length > 1024 ? rolesText.substring(0, 1021) + '...' : rolesText, inline: false }
                        ]);
                    break;

                case 'advanced_stats':
                    updatedEmbed = colorManager.createEmbed()
                        .setTitle(`📈 Stats - ${userStats.mention}`)
                        .setThumbnail(userStats.avatar)
                        .addFields([
                            { name: ' **Messages**', value: `**${userStats.realMessages.toLocaleString()}** رسالة`, inline: true },
                            { name: ' **In voice**', value: `${userStats.formattedVoiceTime}`, inline: true },
                            { name: ' **Join voice**', value: `**${userStats.joinedChannels}** `, inline: true },
                            { name: ' **Reactions**', value: `**${userStats.reactionsGiven}** `, inline: true },
                            { name: ' **Active days**', value: `**${userStats.activeDays}** `, inline: true },
                            { name: ' **Bot?**', value: userStats.isBot ? ' **بوت**' : ' **حقيقي**', inline: true }
                        ]);
                    break;

                case 'simple_view':
                default:
                    updatedEmbed = await createUserStatsEmbed(userStats, colorManager, true, null, `<@${request.requesterId}>`);
                    updatedEmbed.setTitle(`🎭 طلب رول تفاعلي`).setDescription(`**Admin :** <@${request.requesterId}>\n**Member :** <@${targetId}>\n\n${request.originalContent}`);
                    break;
            }

            if (value !== 'simple_view') {
                updatedEmbed.addFields({ name: 'بواسطة', value: `<@${request.requesterId}>`, inline: true });
            }

            await interaction.update({ embeds: [updatedEmbed] }).catch(e => console.error('Error updating interaction embed:', e));
            return;
        }

        // Handle Approve
        if (customId.startsWith('int_approve_')) {
            if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true });
            
            const applicationId = customId.replace('int_approve_', '');
            const targetId = applicationId.split('_')[1];
            const request = settings.pendingRequests[targetId];
            if (!request) return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب.', ephemeral: true });

            const roles = settings.settings.interactiveRoles;
            if (!roles || roles.length === 0) return interaction.reply({ content: '❌ لم يتم تحديد رولات تفاعلية في الإعدادات.', ephemeral: true });

            const options = roles.map(id => {
                const role = interaction.guild.roles.cache.get(id);
                return { label: role ? role.name : `Role ID: ${id}`, value: id };
            }).filter(opt => opt.label);

            if (options.length === 0) return interaction.reply({ content: '❌ الرولات المحددة غير موجودة في السيرفر.', ephemeral: true });

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`int_select_role_${targetId}`)
                .setPlaceholder('اختر الرول المراد إعطاؤه...')
                .addOptions(options);

            await interaction.reply({ content: '✅ اختر الرول المناسب للعضو بناءً على تفاعله:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } 
        
        // Handle Role Selection
        else if (customId.startsWith('int_select_role_')) {
            const targetId = customId.split('_')[3];
            const roleId = interaction.values[0];
            const request = settings.pendingRequests[targetId];
            
            if (!request) return interaction.reply({ content: '❌ لم يتم العثور على بيانات الطلب.', ephemeral: true });

            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
            const role = interaction.guild.roles.cache.get(roleId);

            if (!targetMember) return interaction.reply({ content: '❌ العضو غادر السيرفر.', ephemeral: true });
            if (!role) return interaction.reply({ content: '❌ الرول غير موجود.', ephemeral: true });

            await targetMember.roles.add(role).catch(e => console.error('Error adding role:', e));
            
            try {
                await targetMember.send(`✅ **تهانينا!** تم قبول طلبك للرول التفاعلي وحصلت على رول: **${role.name}** في سيرفر **${interaction.guild.name}**.`);
            } catch (e) {}

            const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
            if (channel) {
                const msg = await channel.messages.fetch(request.messageId).catch(() => null);
                if (msg) {
                    const embed = EmbedBuilder.from(msg.embeds[0])
                        .setColor('#00ff00')
                        .addFields({ name: 'الحالة', value: `✅ تم القبول بواسطة <@${interaction.user.id}>\nالرول الممنوح: <@&${roleId}>` });
                    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                }
            }

            delete settings.pendingRequests[targetId];
            saveSettings(settings);
            await interaction.update({ content: `✅ تم منح الرول <@&${roleId}> لـ <@${targetId}> بنجاح.`, components: [] }).catch(() => {});
        }

        // Handle Reject Trigger
        else if (customId.startsWith('int_reject_trigger_')) {
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
            await interaction.showModal(modal).catch(e => console.error('Error showing modal:', e));
        }

        // Handle Reject Modal Submit
        else if (customId.startsWith('int_reject_modal_')) {
            const targetId = customId.split('_')[3];
            const reason = interaction.fields.getTextInputValue('reject_reason');
            const request = settings.pendingRequests[targetId];

            if (!request) return interaction.reply({ content: '❌ لم يتم العثور على بيانات الطلب.', ephemeral: true });

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
                        .setColor('#ff0000')
                        .addFields({ name: 'الحالة', value: `❌ تم الرفض بواسطة <@${interaction.user.id}>\n**السبب:** ${reason}` });
                    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                }
            }

            delete settings.pendingRequests[targetId];
            saveSettings(settings);
            await interaction.reply({ content: `✅ تم رفض الطلب ووضع كولداون لـ <@${targetId}>.`, ephemeral: true }).catch(() => {});
        }
    } catch (error) {
        console.error('Error in handleInteraction (Interactive Roles):', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: '❌ حدث خطأ أثناء معالجة التفاعل.', ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة التفاعل.', ephemeral: true }).catch(() => {});
        }
    }
}

module.exports = { handleMessage, handleInteraction };
