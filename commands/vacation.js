const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager.js');
const vacationManager = require('../utils/vacationManager.js');

const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json'); // Added path for responsibilities.json

// Helper to read a JSON file
function readJson(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultData;
}

async function execute(message, args, { BOT_OWNERS }) {
    const member = message.member;
    const adminRoles = readJson(adminRolesPath, []);
    const isOwner = BOT_OWNERS.includes(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id));

    const replyEmbed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff');

    if (!isOwner && !hasAdminRole) {
        replyEmbed.setDescription('❌ **هذا الأمر للمدراء المُحددين فقط.**');
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    const settings = vacationManager.getSettings();
    if (!settings || !settings.approverType || !settings.notificationMethod) {
        replyEmbed.setDescription('⚠️ The vacation system has not been fully configured yet. Please ask the bot owner to use `set-vacation`.');
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    // التحقق من وجود المسؤولية والمسؤولين إذا كان نوع المعتمد هو مسؤولية
    if (settings.approverType === 'responsibility') {
        const responsibilities = readJson(responsibilitiesPath, {});
        for (const respName of settings.approverTargets || []) {
            const respData = responsibilities[respName];
            if (!respData) {
                replyEmbed.setDescription(`❌ **المسؤولية "${respName}" غير موجودة! يرجى إعداد النظام مرة أخرى.**`);
                return message.reply({ embeds: [replyEmbed], ephemeral: true });
            }
            if (!respData.responsibles || respData.responsibles.length === 0) {
                replyEmbed.setDescription(`❌ **المسؤولية "${respName}" لا تحتوي على أي مسؤولين! يرجى إضافة مسؤولين أولاً.**`);
                return message.reply({ embeds: [replyEmbed], ephemeral: true });
            }
        }
    }

    if (vacationManager.isUserOnVacation(member.id)) {
        replyEmbed.setDescription("You are already on vacation.");
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
    if (vacations.pending?.[member.id]) {
        replyEmbed.setDescription("You already have a pending vacation request.");
        return message.reply({ embeds: [replyEmbed], ephemeral: true });
    }

    replyEmbed.setDescription("Click the button below to open the vacation request form.");
    const requestButton = new ButtonBuilder()
        .setCustomId(`vac_request_start_${member.id}`)
        .setLabel("Request Vacation")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(requestButton);
    const sentMessage = await message.reply({ embeds: [replyEmbed], components: [row] });
}

async function handleInteraction(interaction, context) {
    const { client, BOT_OWNERS } = context;
    const customId = interaction.customId;

    const replyEmbed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff');

    if (customId.startsWith('vac_request_start_')) {
        const userId = customId.split('_').pop();
        if (interaction.user.id !== userId) {
            replyEmbed.setDescription("You can only request a vacation for yourself.");
            return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`vac_request_modal_${userId}`)
            .setTitle('Vacation Request Form');

        const durationInput = new TextInputBuilder().setCustomId('vac_duration').setLabel("المدة (مثل: 7d أو 12h أو 30m)").setStyle(TextInputStyle.Short).setRequired(true);
        const reasonInput = new TextInputBuilder().setCustomId('vac_reason').setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(durationInput), new ActionRowBuilder().addComponents(reasonInput));

        await interaction.showModal(modal);

        // لا نقوم بتحديث الرسالة هنا، سيتم التحديث بعد إرسال الطلب بنجاح

    }

    if (interaction.isModalSubmit() && customId.startsWith('vac_request_modal_')) {
        try {
            const userId = customId.split('_').pop();
            const member = await interaction.guild.members.fetch(userId);
            const durationStr = interaction.fields.getTextInputValue('vac_duration').trim();
            const reason = interaction.fields.getTextInputValue('vac_reason');

            // فحص التنسيق المسموح (رقم + d/h/m فقط)
            const durationRegex = /^(\d+)(d|h|m)$/i;
            const match = durationStr.match(durationRegex);
            
            if (!match) {
                replyEmbed.setDescription('❌ **صيغة المدة غير صحيحة!** \nيرجى استخدام:\n• `رقم+d` للأيام (مثل: 7d)\n• `رقم+h` للساعات (مثل: 12h)\n• `رقم+m` للدقائق (مثل: 30m)\n\n**مثال:** `3d` للإجازة لمدة 3 أيام');
                return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
            }

            const durationMs = ms(durationStr);
            if (!durationMs || durationMs <= 0) {
                replyEmbed.setDescription('❌ **صيغة المدة غير صحيحة.** يرجى التأكد من أن المدة صحيحة.');
                return interaction.reply({ embeds: [replyEmbed], ephemeral: true });
            }

            // Get and validate settings first
            const settings = vacationManager.getSettings();
            if (!settings.approverType) {
                return interaction.reply({
                    content: '**نظام الإجازات غير مُعد بعد! يرجى استخدام أمر `set-vacation` لإعداد النظام أولاً.**',
                    ephemeral: true
                });
            }

            // التحقق من وجود طلب إجازة معلق مسبقاً
            const existingVacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
            if (existingVacations.pending?.[userId]) {
                return interaction.reply({
                    content: '❌ **لديك طلب إجازة معلق بالفعل! لا يمكنك تقديم طلب آخر.**',
                    ephemeral: true
                });
            }

            if (vacationManager.isUserOnVacation(userId)) {
                return interaction.reply({
                    content: '❌ **أنت في إجازة حالياً! لا يمكنك تقديم طلب إجازة جديد.**',
                    ephemeral: true
                });
            }

            // Check for responsibles in the selected responsibility
            if (settings.approverType === 'responsibility') {
                const responsibilities = readJson(responsibilitiesPath, {});
                for (const respName of settings.approverTargets) {
                    const respData = responsibilities[respName];
                    if (!respData) {
                        return interaction.reply({
                            content: `**المسؤولية "${respName}" غير موجودة!**`,
                            ephemeral: true
                        });
                    }
                    if (!respData.responsibles || respData.responsibles.length === 0) {
                        return interaction.reply({
                            content: `**المسؤولية "${respName}" لا تحتوي على أي مسؤولين! يرجى إضافة مسؤولين أولاً.**`,
                            ephemeral: true
                        });
                    }
                }
            }

            const approvers = await vacationManager.getApprovers(interaction.guild, settings, BOT_OWNERS);

            if (approvers.length === 0) {
                let errorMessage = 'لا يمكن العثور على أي معتمدين صالحين بناءً على الإعدادات الحالية.';

                if (settings.approverType === 'responsibility') {
                    errorMessage += ' يرجى التأكد من وجود مسؤولين في المسؤولية المحددة وأنهم متصلون بالخادم.';
                } else if (settings.approverType === 'role') {
                    errorMessage += ' يرجى التأكد من وجود أعضاء في الأدوار المحددة.';
                }

                return interaction.reply({ content: errorMessage, ephemeral: true });
            }

            // Save vacation request
            const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
            if (!vacations.pending) {
                vacations.pending = {};
            }
            vacations.pending[userId] = {
                reason: reason,
                startDate: new Date().toISOString(),
                endDate: new Date(Date.now() + durationMs).toISOString(),
            };
            vacationManager.saveVacations(vacations);


            // Send notification to approvers
            const adminRoles = readJson(adminRolesPath, []);
            const rolesToBeRemoved = member.roles.cache.filter(role => adminRoles.includes(role.id));
            const rolesDisplay = rolesToBeRemoved.map(r => `<@&${r.id}>`).join(', ') || 'لا توجد';

            const embed = new EmbedBuilder()
                .setTitle("طلب إجازة جديد")
                .setColor(colorManager.getColor('pending') || '#E67E22')
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
                .addFields(
                    { name: "___المستخدم___", value: `${member}`, inline: true },
                    { name: "___المدة___", value: `**${ms(durationMs, { long: true })}**`, inline: true },
                    { name: "___السبب___", value: reason, inline: false },
                    { name: "___الأدوار المراد إزالتها___", value: rolesDisplay, inline: false }
                )
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vac_approve_${userId}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`vac_reject_${userId}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
            );

            // Send notifications
            if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
                const channel = await client.channels.fetch(settings.notificationChannel).catch(() => null);
                if (channel) {
                    await channel.send({ embeds: [embed], components: [buttons] });
                }
            } else { // DM by default
                for (const approver of approvers) {
                    await approver.send({ embeds: [embed], components: [buttons] }).catch(e => 
                        console.error(`Could not DM user ${approver.id}: ${e.message}`)
                    );
                }
            }

            // تعطيل الزر في الرسالة الأصلية
            try {
                const originalMessage = await interaction.message.fetch();
                const disabledButton = new ButtonBuilder()
                    .setCustomId(`vac_request_used_${userId}`)
                    .setLabel("✅ تم الإرسال")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true);

                const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
                await originalMessage.edit({ components: [disabledRow] });
            } catch (error) {
                console.error('فشل في تعطيل الزر:', error);
            }

            // Send success response to user
            replyEmbed.setDescription('✅ **تم إرسال طلب الإجازة للمعتمدين بنجاح.**');
            await interaction.reply({ embeds: [replyEmbed], ephemeral: true });

        } catch (error) {
            console.error("Error in vacation modal submission:", error);
            const errorEmbed = new EmbedBuilder().setColor('#FF0000')
                .setDescription(`**حدث خطأ أثناء إرسال طلبك:**\n\`\`\`${error.message}\`\`\``);
            
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
}

module.exports = {
    name: 'اجازه',
    execute,
    handleInteraction
};