const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { collectUserStats, createUserStatsEmbed } = require('./userStatsCollector');
const colorManager = require('./colorManager');

const interactiveRolesPath = path.join(__dirname, '..', 'data', 'interactiveRoles.json');

function loadSettings() {
    try {
        if (fs.existsSync(interactiveRolesPath)) {
            const data = JSON.parse(fs.readFileSync(interactiveRolesPath, 'utf8'));
            if (!data.settings) {
                data.settings = { approvers: [], interactiveRoles: [], requestChannel: null, exceptions: [] };
            }
            if (!Array.isArray(data.settings.exceptions)) {
                data.settings.exceptions = [];
            } else {
                data.settings.exceptions = data.settings.exceptions.map((entry) => {
                    if (entry && Array.isArray(entry.keywords)) {
                        return { roleId: entry.roleId, keywords: entry.keywords.map(keyword => keyword.toLowerCase()) };
                    }
                    if (entry && typeof entry.keyword === 'string') {
                        return { roleId: entry.roleId, keywords: [entry.keyword.toLowerCase()] };
                    }
                    return entry;
                }).filter(entry => entry && entry.roleId && Array.isArray(entry.keywords));
            }
            if (!data.exceptionCooldowns) {
                data.exceptionCooldowns = {};
            }
            if (!data.pendingExceptionRequests) {
                data.pendingExceptionRequests = {};
            }
            return data;
        }
    } catch (error) {
        console.error('Error loading interactive roles settings:', error);
    }
    return {
        settings: { approvers: [], interactiveRoles: [], requestChannel: null, exceptions: [] },
        pendingRequests: {},
        cooldowns: {},
        exceptionCooldowns: {},
        pendingExceptionRequests: {}
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

    // Avoid processing the same message more than once. Sometimes bots may receive multiple events
    // for the same user message (e.g., due to edits or other discord.js internals). Keep track of
    // processed messages using a global set. This prevents duplicate request embeds being sent for
    // a single mention. Entries are cleared automatically after a delay to free memory.
    if (!global.processedInteractiveMessages) global.processedInteractiveMessages = new Set();
    if (global.processedInteractiveMessages.has(message.id)) return;
    global.processedInteractiveMessages.add(message.id);

    // Check if message contains a mention or ID (anywhere in the content)
    const mentionMatch = message.content.match(/<@!?(\d+)>|(?<=\s|^)(\d{17,19})(?=\s|$)/);
    if (!mentionMatch) {
        // Delete message if it doesn't contain a mention/ID in the request channel
        try { await message.delete(); } catch (e) {}
        return;
    }

    const targetId = mentionMatch[1] || mentionMatch[2];
    // Use a lock to prevent concurrent requests for the same target. If the lock exists, delete
    // the triggering message and abort processing. The lock is cleared in a finally block below.
    if (!global.activeInteractiveRequests) global.activeInteractiveRequests = new Set();
    if (global.activeInteractiveRequests.has(targetId)) {
        try { await message.delete(); } catch (e) {}
        return;
    }
    global.activeInteractiveRequests.add(targetId);

    // Wrap the main logic in a try/finally so that the lock is always released, even if
    // exceptions occur or early returns happen. This avoids leaving the target locked,
    // which would block future requests and appear as if nothing is accepted.
    try {
        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);

        // Always delete the original message in the request channel
        try { await message.delete(); } catch (e) {}

        if (!targetMember) {
            return;
        }

        const normalizedContent = message.content.toLowerCase();
        const exceptions = settings.settings.exceptions || [];
        const matchedException = exceptions
            .map((entry) => {
                if (!entry || !entry.roleId || !Array.isArray(entry.keywords)) return null;
                const matchedKeyword = entry.keywords.find((keyword) => keyword && normalizedContent.includes(keyword.toLowerCase()));
                if (!matchedKeyword) return null;
                return { roleId: entry.roleId, keyword: matchedKeyword.toLowerCase() };
            })
            .find(Boolean);
        const isExceptionAllowed = matchedException && !targetMember.roles.cache.has(matchedException.roleId);

        // Check if member already has any of the interactive roles
        const hasInteractiveRole = targetMember.roles.cache.some(r => settings.settings.interactiveRoles.includes(r.id));
        if (hasInteractiveRole && !isExceptionAllowed) {
            const reply = await message.channel.send(`⚠️ <@${targetId}> لديه بالفعل رولات تفاعلية.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        if (matchedException && !settings.settings.interactiveRoles.includes(matchedException.roleId)) {
            const reply = await message.channel.send(`⚠️ رول الاستثناء لم يعد ضمن الرولات التفاعلية.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        if (matchedException && targetMember.roles.cache.has(matchedException.roleId)) {
            const reply = await message.channel.send(`⚠️ <@${targetId}> لديه بالفعل رول الاستثناء.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        if (isExceptionAllowed) {
            const exceptionCooldown = settings.exceptionCooldowns?.[targetId]?.[matchedException.roleId]?.[matchedException.keyword];
            if (exceptionCooldown && Date.now() < exceptionCooldown) {
                const timeLeft = Math.ceil((exceptionCooldown - Date.now()) / (1000 * 60 * 60));
                const reply = await message.channel.send(`❌ <@${targetId}> لديه كولداون لاستثناء هذه الكلمة. المتبقي: ${timeLeft} ساعة.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                return;
            }

            const hasPendingException = Object.values(settings.pendingExceptionRequests || {}).some((req) => req.targetId === targetId);
            if (hasPendingException) {
                const reply = await message.channel.send(`⚠️ <@${targetId}> لديه طلب مستثنى معلق بالفعل.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                return;
            }

            const userStats = await collectUserStats(targetMember);
            const statsEmbed = await createUserStatsEmbed(userStats, colorManager, true, message.member?.displayName ?? null, `<@${message.author.id}>`);
            statsEmbed.setTitle('🎭 طلب رول تفاعلي (استثناء)')
                .setDescription(`**Admin :** <@${message.author.id}>\n**Member :** <@${targetId}>\n**الرول المستثنى:** <@&${matchedException.roleId}>\n**الكلمة:** ${matchedException.keyword}\n\n${message.content}`);

            const respConfigPath = path.join(__dirname, '..', 'data', 'respConfig.json');
            let globalImageUrl = null;
            try {
                if (fs.existsSync(respConfigPath)) {
                    const config = JSON.parse(fs.readFileSync(respConfigPath, 'utf8'));
                    globalImageUrl = config.guilds?.[message.guild.id]?.globalImageUrl;
                }
            } catch (e) {}

            const applicationId = `${Date.now()}_${targetId}`;
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`int_ex_approve_${applicationId}`)
                    .setLabel('Approve')
                    .setEmoji('<:emoji_1:1436850272734285856>')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`int_ex_reject_trigger_${applicationId}`)
                    .setLabel('Reject')
                    .setEmoji('<:emoji_1:1436850215154880553>')
                    .setStyle(ButtonStyle.Secondary)
            );

            const detailsMenu = new StringSelectMenuBuilder()
                .setCustomId(`int_ex_details_${applicationId}`)
                .setPlaceholder('تفاصيل عن العضو')
                .addOptions([
                    { label: 'Dates', description: 'عرض تواريخ الانضمام وإنشاء الحساب', value: 'dates' },
                    { label: 'Evaluation', description: 'عرض تقييم العضو والمعايير', value: 'evaluation' },
                    { label: 'Roles', description: 'عرض جميع الرولات للعضو', value: 'roles' },
                    { label: 'Stats', description: 'عرض تفاصيل النشاط', value: 'advanced_stats' },
                    { label: 'first ep', description: 'العودة للعرض الأساسي', value: 'simple_view' }
                ]);

            const row2 = new ActionRowBuilder().addComponents(detailsMenu);
            const messageOptions = {
                content: `**طلب مستثنى من <@${message.author.id}> بخصوص <@${targetId}>**`,
                embeds: [statsEmbed],
                components: [row1, row2]
            };

            if (globalImageUrl) {
                messageOptions.files = [globalImageUrl];
            }

            const sentMessage = await message.channel.send(messageOptions);

            settings.pendingExceptionRequests = settings.pendingExceptionRequests || {};
            settings.pendingExceptionRequests[applicationId] = {
                applicationId,
                messageId: sentMessage.id,
                requesterId: message.author.id,
                targetId,
                originalContent: message.content,
                userStats,
                roleId: matchedException.roleId,
                keyword: matchedException.keyword,
                timestamp: Date.now()
            });
            saveSettings(settings);

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

        // Check if already pending (In JSON)
        if (settings.pendingRequests[targetId]) {
            const reply = await message.channel.send(`⚠️ <@${targetId}> لديه طلب معلق بالفعل.`);
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        // Collect stats and create embed using the admin-apply style
        const userStats = await collectUserStats(targetMember);
        // Use simpleView = true for the initial embed as in admin-apply
        const statsEmbed = await createUserStatsEmbed(userStats, colorManager, true, message.member?.displayName ?? null, `<@${message.author.id}>`);
        
        //Customize title for interactive roles
        statsEmbed.setTitle(`🎭 طلب رول تفاعلي`)
                  .setDescription(`**Admin :** <@${message.author.id}>\n**Member :** <@${targetId}>\n\n${message.content}`);

        // جلب الصورة العامة المحفوظة عبر resp img all
        const respConfigPath = path.join(__dirname, '..', 'data', 'respConfig.json');
        let globalImageUrl = null;
        try {
            if (fs.existsSync(respConfigPath)) {
                const config = JSON.parse(fs.readFileSync(respConfigPath, 'utf8'));
                globalImageUrl = config.guilds?.[message.guild.id]?.globalImageUrl;
            }
        } catch (e) {}

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

        const messageOptions = {
            content: `**طلب جديد من <@${message.author.id}> بخصوص <@${targetId}>**`,
            embeds: [statsEmbed],
            components: [row1, row2]
        };

        // إرسال الصورة كملف مرفق إذا وجدت (بدلاً من رابط)
        if (globalImageUrl) {
            messageOptions.files = [globalImageUrl];
        }

        const sentMessage = await message.channel.send(messageOptions);

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
    } finally {
        // Always release the lock for this target to ensure new requests can be processed
        if (global.activeInteractiveRequests) {
            global.activeInteractiveRequests.delete(targetId);
        }
        // Remove message from processed set after a timeout to free memory and allow future edits
        setTimeout(() => {
            if (global.processedInteractiveMessages) {
                global.processedInteractiveMessages.delete(message.id);
            }
        }, 5 * 60 * 1000);
    }
}

async function handleInteraction(interaction) {
    const settings = loadSettings();
    const customId = interaction.customId;

    if (!customId.startsWith('int_')) return;

    // Check if user is an approver
    const isApprover = interaction.member.roles.cache.some(r => settings.settings.approvers.includes(r.id)) || 
                       interaction.guild.ownerId === interaction.user.id;

    const getExceptionRequest = (applicationId) => {
        const requests = settings.pendingExceptionRequests || {};
        return requests[applicationId] || null;
    };

    const setExceptionCooldown = (targetId, roleId, keyword, durationMs) => {
        if (!settings.exceptionCooldowns) settings.exceptionCooldowns = {};
        if (!settings.exceptionCooldowns[targetId]) settings.exceptionCooldowns[targetId] = {};
        if (!settings.exceptionCooldowns[targetId][roleId]) settings.exceptionCooldowns[targetId][roleId] = {};
        settings.exceptionCooldowns[targetId][roleId][keyword] = Date.now() + durationMs;
    };

    if (customId.startsWith('int_ex_details_')) {
        if (interaction.replied || interaction.deferred) return;
        if (!isApprover) {
            return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});
        }

        await interaction.deferUpdate().catch(err => {
            if (err.code !== 10062) console.error('Error deferring update:', err);
        });

        if (!interaction.deferred && !interaction.replied) return;

        const applicationId = customId.replace('int_ex_details_', '');
        const request = getExceptionRequest(applicationId);

        if (!request) {
            return interaction.followUp({ content: '❌ لم يتم العثور على بيانات الطلب المستثنى.', ephemeral: true }).catch(() => {});
        }

        const value = interaction.values[0];
        const userStats = request.userStats;

        let updatedEmbed;
        try {
            if (value === 'simple_view') {
                updatedEmbed = await createUserStatsEmbed(userStats, colorManager, true, null, `<@${request.requesterId}>`);
                updatedEmbed.setTitle('🎭 طلب رول تفاعلي (استثناء)').setDescription(`**Admin :** <@${request.requesterId}>\n**Member :** <@${request.targetId}>\n**الرول المستثنى:** <@&${request.roleId}>\n**الكلمة:** ${request.keyword}\n\n${request.originalContent}`);
            } else {
                updatedEmbed = await createUserStatsEmbed(userStats, colorManager, false, null, `<@${request.requesterId}>`, value);
                const targetMember = await interaction.guild.members.fetch(request.targetId).catch(() => null);
                updatedEmbed.setTitle(`🎭 تفاصيل العضو: ${targetMember ? targetMember.user.username : request.targetId}`);

                if (updatedEmbed.data && updatedEmbed.data.fields && !updatedEmbed.data.fields.some(f => f.name && f.name.includes('بواسطة'))) {
                    updatedEmbed.addFields({ name: 'بواسطة', value: `<@${request.requesterId}>`, inline: true });
                }
            }

            await interaction.editReply({ embeds: [updatedEmbed] }).catch(err => {
                if (err.code !== 10062) console.error('Error in editReply (details):', err);
            });
        } catch (error) {
            console.error('Error updating read-only interaction embed:', error);
        }
        return;
    }

    if (customId.startsWith('int_ex_approve_')) {
        if (interaction.replied || interaction.deferred) return;
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});

        const applicationId = customId.replace('int_ex_approve_', '');
        const request = getExceptionRequest(applicationId);
        if (!request) {
            return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب المستثنى.', ephemeral: true }).catch(() => {});
        }

        const targetMember = await interaction.guild.members.fetch(request.targetId).catch(() => null);
        const role = interaction.guild.roles.cache.get(request.roleId);
        if (!targetMember || !role) {
            return interaction.reply({ content: '❌ تعذر العثور على العضو أو الرول.', ephemeral: true }).catch(() => {});
        }

        if (targetMember.roles.cache.has(role.id)) {
            setExceptionCooldown(request.targetId, request.roleId, request.keyword, 24 * 60 * 60 * 1000);
            delete settings.pendingExceptionRequests[applicationId];
            saveSettings(settings);
            return interaction.reply({ content: `⚠️ <@${request.targetId}> لديه بالفعل الرول المستثنى.`, ephemeral: true }).catch(() => {});
        }

        if (typeof global.markInteractiveRoleGrant === 'function') {
            global.markInteractiveRoleGrant(interaction.guild.id, targetMember.id, role.id);
        }
        await targetMember.roles.add(role).catch(() => {});
        try {
            await targetMember.send(`✅ **تهانينا!** تم قبول طلبك للرول التفاعلي (استثناء) وحصلت على رول: **${role.name}** في سيرفر **${interaction.guild.name}**.`);
        } catch (e) {}

        const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
        if (channel) {
            const msg = await channel.messages.fetch(request.messageId).catch(() => null);
            if (msg) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor(colorManager.getColor ? colorManager.getColor() : '#00ff00')
                    .addFields({ name: 'الحالة', value: `✅ تم القبول بواسطة <@${interaction.user.id}>\nالرول الممنوح: <@&${request.roleId}>\nنوع الطلب: مستثنى` });
                await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
            }
        }

        setExceptionCooldown(request.targetId, request.roleId, request.keyword, 24 * 60 * 60 * 1000);
        delete settings.pendingExceptionRequests[applicationId];
        saveSettings(settings);

        await interaction.reply({ content: `✅ تم منح الرول <@&${request.roleId}> لـ <@${request.targetId}> بنجاح (استثناء).`, ephemeral: true }).catch(() => {});
        return;
    }

    if (customId.startsWith('int_ex_reject_trigger_')) {
        if (interaction.replied || interaction.deferred) return;
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});

        const applicationId = customId.replace('int_ex_reject_trigger_', '');
        const request = getExceptionRequest(applicationId);
        if (!request) {
            return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب المستثنى.', ephemeral: true }).catch(() => {});
        }

        const modal = new ModalBuilder()
            .setCustomId(`int_ex_reject_modal_${applicationId}`)
            .setTitle('سبب الرفض');

        const reasonInput = new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('السبب')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('اذكر سبب الرفض هنا...');

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal).catch(() => {});
        return;
    }

    if (customId.startsWith('int_ex_reject_modal_')) {
        if (interaction.replied || interaction.deferred) return;
        const applicationId = customId.replace('int_ex_reject_modal_', '');
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const request = getExceptionRequest(applicationId);
        if (!request) {
            return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب المستثنى.', ephemeral: true }).catch(() => {});
        }

        const targetMember = await interaction.guild.members.fetch(request.targetId).catch(() => null);
        if (targetMember) {
            try {
                await targetMember.send(`❌ **للأسف!** تم رفض طلبك للرول التفاعلي (استثناء) في سيرفر **${interaction.guild.name}**.\n**السبب:** ${reason}`);
            } catch (e) {}
        }

        const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
        if (channel) {
            const msg = await channel.messages.fetch(request.messageId).catch(() => null);
            if (msg) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor(colorManager.getColor ? colorManager.getColor() : '#ff0000')
                    .addFields({ name: 'الحالة', value: `❌ تم الرفض بواسطة <@${interaction.user.id}>\n**السبب:** ${reason}\nنوع الطلب: مستثنى` });
                await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
            }
        }

        setExceptionCooldown(request.targetId, request.roleId, request.keyword, 24 * 60 * 60 * 1000);
        delete settings.pendingExceptionRequests[applicationId];
        saveSettings(settings);
        await interaction.reply({ content: `✅ تم رفض الطلب ووضع كولداون لاستثناء <@${request.targetId}>.`, ephemeral: true }).catch(() => {});
        return;
    }

    // Handle Details Menu (Same as admin-apply)
    if (customId.startsWith('int_details_')) {
        // التحقق من حالة التفاعل فوراً لمنع التكرار
        if (interaction.replied || interaction.deferred) return;
        
        // التحقق من صلاحية المستخدم فوراً
        if (!isApprover) {
            return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});
        }

        // إرجاء الرد لتجنب خطأ انتهاء وقت التفاعل (Unknown Interaction)
        await interaction.deferUpdate().catch(err => {
            if (err.code !== 10062) console.error('Error deferring update:', err);
        });
        
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
        if (interaction.replied || interaction.deferred) return;
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});
        
        const applicationId = customId.replace('int_approve_', '');
        const targetId = applicationId.split('_')[1];
        const request = settings.pendingRequests[targetId];
        if (!request) return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب.', ephemeral: true }).catch(() => {});

        const roles = settings.settings.interactiveRoles;
        if (roles.length === 0) return interaction.reply({ content: '❌ لم يتم تحديد رولات تفاعلية في الإعدادات.', ephemeral: true }).catch(() => {});

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`int_select_role_${targetId}`)
            .setPlaceholder('اختر الرول المراد إعطاؤه...')
            .addOptions(roles.map(id => {
                const role = interaction.guild.roles.cache.get(id);
                return { label: role ? role.name : id, value: id };
            }));

        await interaction.reply({ content: '✅ اختر الرول المناسب للعضو بناءً على تفاعله:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true }).catch(() => {});

    } else if (customId.startsWith('int_select_role_')) {
        if (interaction.replied || interaction.deferred) return;
        const targetId = customId.split('_')[3];
        const roleId = interaction.values[0];
        const request = settings.pendingRequests[targetId];

        // If no pending request exists for this target, inform the approver and abort.
        if (!request) {
            return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب.', ephemeral: true }).catch(() => {});
        }

        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        const role = interaction.guild.roles.cache.get(roleId);

        if (targetMember && role) {
            // Assign the role to the member
            if (typeof global.markInteractiveRoleGrant === 'function') {
                global.markInteractiveRoleGrant(interaction.guild.id, targetMember.id, role.id);
            }
            await targetMember.roles.add(role).catch(() => {});
            try {
                await targetMember.send(`✅ **تهانينا!** تم قبول طلبك للرول التفاعلي وحصلت على رول: **${role.name}** في سيرفر **${interaction.guild.name}**.`);
            } catch (e) {}

            // Update the original request message to reflect approval
            const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
            if (channel) {
                const msg = await channel.messages.fetch(request.messageId).catch(() => null);
                if (msg) {
                    const embed = EmbedBuilder.from(msg.embeds[0])
                        .setColor(colorManager.getColor ? colorManager.getColor() : '#00ff00')
                        .addFields({ name: 'الحالة', value: `✅ تم القبول بواسطة <@${interaction.user.id}>\nالرول الممنوح: <@&${roleId}>` });
                    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
                }
            }

            // Remove pending request and persist
            delete settings.pendingRequests[targetId];
            saveSettings(settings);

            await interaction.update({ content: `✅ تم منح الرول <@&${roleId}> لـ <@${targetId}> بنجاح.`, components: [] }).catch(() => {});
        }

    } else if (customId.startsWith('int_reject_trigger_')) {
        if (interaction.replied || interaction.deferred) return;
        if (!isApprover) return interaction.reply({ content: '❌ **مب مسؤول؟ والله ماوريك.**', ephemeral: true }).catch(() => {});
        
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
        await interaction.showModal(modal).catch(() => {});

    } else if (customId.startsWith('int_reject_modal_')) {
        if (interaction.replied || interaction.deferred) return;
        const targetId = customId.split('_')[3];
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const request = settings.pendingRequests[targetId];
        // If there is no matching pending request, inform the moderator
        if (!request) {
            return interaction.reply({ content: '❌ لم يتم العثور على هذا الطلب.', ephemeral: true }).catch(() => {});
        }

        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (targetMember) {
            try {
                await targetMember.send(`❌ **للأسف!** تم رفض طلبك للرول التفاعلي في سيرفر **${interaction.guild.name}**.\n**السبب:** ${reason}\nيمكنك التقديم مرة أخرى بعد 24 ساعة.`);
            } catch (e) {}
        }

        // Apply a 24 hour cooldown to prevent immediate re-application
        settings.cooldowns[targetId] = Date.now() + (24 * 60 * 60 * 1000);

        // Update the original request message to reflect rejection
        const channel = interaction.guild.channels.cache.get(settings.settings.requestChannel);
        if (channel) {
            const msg = await channel.messages.fetch(request.messageId).catch(() => null);
            if (msg) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor(colorManager.getColor ? colorManager.getColor() : '#ff0000')
                    .addFields({ name: 'الحالة', value: `❌ تم الرفض بواسطة <@${interaction.user.id}>\n**السبب:** ${reason}` });
                await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
            }
        }

        // Remove the pending request and persist
        delete settings.pendingRequests[targetId];
        saveSettings(settings);
        await interaction.reply({ content: `✅ تم رفض الطلب ووضع كولداون لـ <@${targetId}>.`, ephemeral: true }).catch(() => {});
    }
}

module.exports = { handleMessage, handleInteraction };
