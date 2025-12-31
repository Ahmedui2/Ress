const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager.js');
const vacationManager = require('../utils/vacationManager.js');

const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

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

// دالة لتحديث الوقت المتبقي في الإيمبد مع عرض الثواني
function updateTimeRemaining(embed, activeVacation) {
    const remainingTime = new Date(activeVacation.endDate).getTime() - Date.now();

    let timeDisplay;
    if (remainingTime > 0) {
        const totalSeconds = Math.floor(remainingTime / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (days > 0) {
            timeDisplay = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        } else if (hours > 0) {
            timeDisplay = `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            timeDisplay = `${minutes}m ${seconds}s`;
        } else {
            timeDisplay = `${seconds}s`;
        }
    } else {
        timeDisplay = "انتهت الإجازة";
    }

    // تحديث الحقل الثاني (Time Remaining)
    if (embed.data.fields && embed.data.fields[1]) {
        embed.data.fields[1].value = timeDisplay;
    }

    return embed;
}

async function execute(message, args, { client, BOT_OWNERS }) {
    const authorMember = message.member;

    let targetUser = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
    const isSelfCheck = !targetUser || targetUser.id === message.author.id;
    if (!targetUser) {
        targetUser = message.author;
    }

    // التحقق من الصلاحيات عند فحص إجازة مستخدم آخر
    if (!isSelfCheck) {
        const adminRoles = readJson(adminRolesPath, []);
        const isOwner = BOT_OWNERS.includes(message.author.id);
        const hasAdminRole = authorMember.roles.cache.some(role => adminRoles.includes(role.id));

        if (!isOwner && !hasAdminRole) {
            const noPermissionEmbed = new EmbedBuilder()
                .setDescription('❌ ** خوي.**')
                .setColor(colorManager.getColor());
            return message.reply({ embeds: [noPermissionEmbed] });
        }
    }

    const activeVacation = vacationManager.isUserOnVacation(targetUser.id)
        ? readJson(path.join(__dirname, '..', 'data', 'vacations.json')).active[targetUser.id]
        : null;

    if (!activeVacation) {
        const desc = isSelfCheck ? 'أنت لست في إجازة حالياً.' : `${targetUser.tag} ليس في إجازة حالياً.`;
        const noVacationEmbed = new EmbedBuilder().setDescription(desc).setColor(colorManager.getColor());
        return message.reply({ embeds: [noVacationEmbed] });
    }

    const remainingTime = new Date(activeVacation.endDate).getTime() - Date.now();

    const statusEmbed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff')
        .setTitle(`حالة الإجازة لـ ${targetUser.username}`)
        .setColor(colorManager.getColor('active') || '#2ECC71')
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
            { name: "الحالة", value: "في إجازة", inline: true },
            { name: "الوقت المتبقي", value: remainingTime > 0 ? ms(remainingTime, { long: true }) : "انتهت", inline: true },
            { name: "معتمد من", value: activeVacation.approvedBy ? `<@${activeVacation.approvedBy}>` : 'غير معروف', inline: true },
            { name: "الرولات المسحوبة", value: activeVacation.removedRoles?.map(r => `<@&${r}>`).join(', ') || 'لا توجد', inline: false }
        )
        .setFooter({ text: `تاريخ البداية: ${new Date(activeVacation.startDate).toLocaleString('en-US', {
            timeZone: 'Asia/Riyadh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })}`})
        .setTimestamp();

    const components = [];
    if (isSelfCheck) {
        const endButton = new ButtonBuilder()
            .setCustomId(`vac_end_request_${targetUser.id}`)
            .setLabel("طلب إنهاء الإجازة مبكراً")
            .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(endButton);
        components.push(row);
    }

    const sentMessage = await message.reply({ embeds: [statusEmbed], components: components });

    // إذا كان المستخدم يفحص إجازته الخاصة، ابدأ العداد التلقائي
    if (isSelfCheck && remainingTime > 0) {
        const updateInterval = setInterval(async () => {
            try {
                const currentVacation = vacationManager.isUserOnVacation(targetUser.id)
                    ? readJson(path.join(__dirname, '..', 'data', 'vacations.json')).active[targetUser.id]
                    : null;

                if (!currentVacation) {
                    clearInterval(updateInterval);
                    return;
                }

                const currentRemaining = new Date(currentVacation.endDate).getTime() - Date.now();

                if (currentRemaining <= 0) {
                    clearInterval(updateInterval);
                    return;
                }

                const updatedEmbed = updateTimeRemaining(statusEmbed, currentVacation);
                await sentMessage.edit({ embeds: [updatedEmbed], components: components });
            } catch (error) {
                clearInterval(updateInterval);
                console.error('خطأ في تحديث العداد:', error);
            }
        }, 5000); // تحديث كل 5 ثواني لجعله أكثر سلاسة

        // إيقاف العداد بعد انتهاء الإجازة أو بعد ساعة
        setTimeout(() => {
            clearInterval(updateInterval);
        }, Math.min(remainingTime, 3600000)); // ساعة واحدة كحد أقصى
    }
}

async function handleInteraction(interaction, context) {
    if (!interaction.isButton()) return;

    const { client, BOT_OWNERS } = context || {};

    if (interaction.customId.startsWith('vac_end_request_')) {
        const userId = interaction.customId.split('_').pop();
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: "يمكنك فقط التفاعل مع طلب إجازتك الخاصة.", ephemeral: true });
        }

        // التحقق من وجود طلب إنهاء معلق مسبقاً
        const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
        
        // التحقق من الكولداون (12 ساعة)
        if (vacations.cooldowns?.[userId]) {
            const cooldownTime = vacations.cooldowns[userId];
            if (Date.now() < cooldownTime) {
                const timeLeft = cooldownTime - Date.now();
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                
                return interaction.reply({
                    content: `❌ **عليك كولداون حالياً.**\nالمتبقي: ${hours} ساعة و ${minutes} دقيقة.`,
                    ephemeral: true
                });
            }
        }

        if (vacations.pendingTermination?.[userId]) {
            return interaction.reply({
                content: '❌ **لديك طلب إنهاء إجازة معلق بالفعل! لا يمكنك تقديم طلب آخر.**',
                ephemeral: true
            });
        }

        const confirmButton = new ButtonBuilder()
            .setCustomId(`vac_end_confirm_${userId}`)
            .setLabel("نعم، أرسل الطلب")
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('vac_end_cancel')
            .setLabel("لا، إلغاء")
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.reply({
            content: 'هل أنت متأكد من أنك تريد طلب إنهاء مبكر لإجازتك؟.',
            components: [row],
            ephemeral: true
        });

    }

    if (interaction.customId.startsWith('vac_end_confirm_')) {
        const userId = interaction.customId.split('_').pop();
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: "يمكنك فقط التفاعل مع طلب إجازتك الخاصة.", ephemeral: true });
        }

        try {
            const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));

            // التحقق من وجود طلب إنهاء معلق مسبقاً (حماية إضافية)
            if (vacations.pendingTermination?.[userId]) {
                return interaction.update({
                    content: '❌ **لديك طلب إنهاء إجازة معلق بالفعل!**',
                    components: []
                });
            }
            const activeVacation = vacations.active?.[userId];

            if (!activeVacation) {
                return interaction.reply({ content: 'لا توجد إجازة نشطة لك.', ephemeral: true });
            }

            // إضافة الطلب إلى قائمة الطلبات المعلقة للإنهاء
            if (!vacations.pendingTermination) {
                vacations.pendingTermination = {};
            }

            vacations.pendingTermination[userId] = {
                ...activeVacation,
                terminationRequestedAt: new Date().toISOString(),
                requestedBy: userId
            };

            vacationManager.saveVacations(vacations);

            // الحصول على المعتمدين
            const settings = vacationManager.getSettings();

            // التحقق من اكتمال إعدادات النظام
            if (!settings.approverType || !settings.notificationMethod) {
                return interaction.reply({
                    content: '⚠️ نظام الإجازات غير مكتمل الإعداد. يرجى التواصل مع إدارة البوت.',
                    ephemeral: true
                });
            }

            const approvers = await vacationManager.getApprovers(interaction.guild, settings, BOT_OWNERS);

            if (approvers.length === 0) {
                return interaction.reply({ content: 'لا يمكن العثور على معتمدين صالحين.', ephemeral: true });
            }

            const user = await client.users.fetch(userId);
            const member = await interaction.guild.members.fetch(userId);

            const embed = new EmbedBuilder().setColor(colorManager.getColor() || '#0099ff')
                .setTitle("طلب إنهاء إجازة مبكر")
                .setColor(colorManager.getColor('pending') || '#E67E22')
                .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                .addFields(
                    { name: "___العضو___", value: `${member}`, inline: true },
                    { name: "___السبب الأصلي___", value: activeVacation.reason || 'غير محدد', inline: false },
                    { name: "___تاريخ انتهاء الإجازة الأصلي___", value: new Date(activeVacation.endDate).toLocaleString('en-US', {
                        timeZone: 'Asia/Riyadh',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    }), inline: true },
                    { name: "___الرولات المسحوبة___", value: activeVacation.removedRoles?.map(r => `<@&${r}>`).join(', ') || 'لا توجد', inline: false }
                )
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`vac_approve_termination_${userId}`).setLabel("موافقة على الإنهاء").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`vac_reject_termination_${userId}`).setLabel("رفض الإنهاء").setStyle(ButtonStyle.Danger)
            );

            let notificationSent = false;

            // إرسال الإشعارات للمعتمدين حسب نفس إعدادات طلبات الإجازة
            if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
                try {
                    const channel = await client.channels.fetch(settings.notificationChannel);
                    if (channel && channel.isTextBased()) {
                        await channel.send({
                            content: '⏰ **طلب إنهاء إجازة مبكر**',
                            embeds: [embed],
                            components: [buttons]
                        });
                        notificationSent = true;
                        console.log(`تم إرسال طلب إنهاء الإجازة إلى القناة: ${channel.name}`);
                    } else {
                        console.error('القناة المحددة غير صالحة للرسائل النصية');
                    }
                } catch (error) {
                    console.error('خطأ في إرسال الإشعار للقناة:', error.message);
                }

                // إذا فشل الإرسال للقناة، استخدم الرسائل الخاصة كبديل
                if (!notificationSent) {
                    console.log('فشل الإرسال للقناة، جاري المحاولة عبر الرسائل الخاصة...');
                    for (const approver of approvers) {
                        try {
                            await approver.send({
                                content: '⏰ **طلب إنهاء إجازة مبكر**',
                                embeds: [embed],
                                components: [buttons]
                            });
                            notificationSent = true;
                            console.log(`تم إرسال رسالة خاصة لـ ${approver.tag}`);
                        } catch (dmError) {
                            console.error(`فشل في إرسال رسالة خاصة لـ ${approver.tag}:`, dmError.message);
                        }
                    }
                }
            } else {
                // إرسال رسائل خاصة (الافتراضي أو عند عدم تحديد قناة)
                for (const approver of approvers) {
                    try {
                        await approver.send({
                            content: '⏰ **طلب إنهاء إجازة مبكر**',
                            embeds: [embed],
                            components: [buttons]
                        });
                        notificationSent = true;
                        console.log(`تم إرسال رسالة خاصة لـ ${approver.tag}`);
                    } catch (dmError) {
                        console.error(`فشل في إرسال رسالة خاصة لـ ${approver.tag}:`, dmError.message);
                    }
                }
            }

            // التحقق من نجاح إرسال الإشعار
            if (!notificationSent) {
                // إزالة الطلب من قائمة الانتظار إذا فشل الإرسال
                delete vacations.pendingTermination[userId];
                vacationManager.saveVacations(vacations);

                return interaction.reply({
                    content: '❌ فشل في إرسال الإشعار للمعتمدين. يرجى المحاولة مرة أخرى أو التواصل مع الإدارة.',
                    ephemeral: true
                });
            }

            // تعطيل جميع الأزرار نهائياً
            const disabledConfirmButton = new ButtonBuilder()
                .setCustomId(`vac_end_sent_${userId}`)
                .setLabel("✅ تم الإرسال")
                .setStyle(ButtonStyle.Success)
                .setDisabled(true);

            const disabledCancelButton = new ButtonBuilder()
                .setCustomId('vac_end_cancel_disabled')
                .setLabel("إلغاء")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);

            const disabledRow = new ActionRowBuilder().addComponents(disabledConfirmButton, disabledCancelButton);

            await interaction.update({
                content: '✅ **تم إرسال طلب إنهاء الإجازة المبكر للمعتمدين بنجاح.**',
                components: [disabledRow]
            });

            // تعطيل الزر الأصلي في رسالة اجازتي
            try {
                const disabledButton = new ButtonBuilder()
                    .setCustomId(`vac_end_processing_${userId}`)
                    .setLabel("⏳ تم إرسال الطلب")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);

                const disabledRowOriginal = new ActionRowBuilder().addComponents(disabledButton);
                const originalEmbed = interaction.message.embeds[0];
                await interaction.message.edit({ embeds: [originalEmbed], components: [disabledRowOriginal] });
            } catch (error) {
                console.error('خطأ في تعطيل الزر الأصلي:', error);
            }

            // تعطيل الزر الأصلي في رسالة اجازتي
            setTimeout(async () => {
                try {
                    const channel = interaction.message?.channel;
                    if (channel) {
                        const messages = await channel.messages.fetch({ limit: 10 });
                        const originalMessage = messages.find(msg =>
                            msg.author.id === interaction.client.user.id &&
                            msg.components.length > 0 &&
                            msg.components[0].components.some(btn => btn.customId === `vac_end_request_${userId}`)
                        );

                        if (originalMessage) {
                            const disabledButton = new ButtonBuilder()
                                .setCustomId(`vac_end_sent_${userId}`)
                                .setLabel("✅ تم إرسال طلب الإنهاء")
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(true);

                            const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
                            const originalEmbed = originalMessage.embeds[0];
                            await originalMessage.edit({ embeds: [originalEmbed], components: [disabledRow] });
                        }
                    }
                } catch (error) {
                    console.error('خطأ في تحديث الزر الأصلي:', error);
                }
            }, 1000);

        } catch (error) {
            console.error("خطأ في طلب إنهاء الإجازة:", error);
            await interaction.reply({
                content: `**حدث خطأ أثناء إرسال الطلب:**\n\`\`\`${error.message}\`\`\``,
                ephemeral: true
            });
        }
    }

    if (interaction.customId === 'vac_end_cancel') {
        // تعطيل جميع الأزرار بعد الإلغاء
        const disabledConfirmButton = new ButtonBuilder()
            .setCustomId(`vac_end_cancelled`)
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true);

        const disabledCancelButton = new ButtonBuilder()
            .setCustomId('vac_end_cancelled_cancel')
            .setLabel("✅ Cancelled")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true);

        const disabledRow = new ActionRowBuilder().addComponents(disabledConfirmButton, disabledCancelButton);

        await interaction.update({
            content: '❌ تم إلغاء طلب إنهاء الإجازة.',
            components: [disabledRow]
        });

        // إعادة تفعيل الزر الأصلي في رسالة اجازتي
        setTimeout(async () => {
            try {
                const userId = interaction.user.id;
                const channel = interaction.message?.channel;
                if (channel) {
                    const messages = await channel.messages.fetch({ limit: 10 });
                    const originalMessage = messages.find(msg =>
                        msg.author.id === interaction.client.user.id &&
                        msg.components.length > 0 &&
                        msg.components[0].components.some(btn => btn.customId === `vac_end_processing_${userId}`)
                    );

                    if (originalMessage) {
                        const reactivatedButton = new ButtonBuilder()
                            .setCustomId(`vac_end_request_${userId}`)
                            .setLabel("طلب إنهاء الإجازة مبكراً")
                            .setStyle(ButtonStyle.Danger);

                        const reactivatedRow = new ActionRowBuilder().addComponents(reactivatedButton);
                        const originalEmbed = originalMessage.embeds[0];
                        await originalMessage.edit({ embeds: [originalEmbed], components: [reactivatedRow] });
                    }
                }
            } catch (error) {
                console.error('خطأ في إعادة تفعيل الزر:', error);
            }
        }, 1000);
    }

    // معالجة تفاعلات الموافقة والرفض على طلب إنهاء الإجازة
    if (interaction.customId.startsWith('vac_approve_termination_') || interaction.customId.startsWith('vac_reject_termination_')) {
        // تأجيل الرد فوراً لتجنب خطأ Unknown interaction
        await interaction.deferUpdate().catch(() => {});

        const parts = interaction.customId.split('_');
        const action = parts[1]; // approve or reject
        const userId = parts[3];

        // فحص الصلاحيات قبل السماح بالموافقة/الرفض على الإنهاء
        const vacationSettings = vacationManager.getSettings();
        const isAuthorizedApprover = await vacationManager.isUserAuthorizedApprover(
            interaction.user.id,
            interaction.guild,
            vacationSettings,
            BOT_OWNERS
        );

        if (!isAuthorizedApprover) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription('❌ **يعني محد شاف لا تسوي خوي بس**')
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        const vacations = readJson(path.join(__dirname, '..', 'data', 'vacations.json'));
        const terminationRequest = vacations.pendingTermination?.[userId];

        if (!terminationRequest) {
            return interaction.editReply({ content: '❌ **لم يتم العثور على طلب إنهاء إجازة معلق لهذا المستخدم.**', components: [] });
        }

        const requestedUser = await client.users.fetch(userId).catch(() => null);
        if (!requestedUser) {
            return interaction.editReply({ content: '❌ **لم يتمكن البوت من العثور على المستخدم المطلوب.**', components: [] });
        }

        if (action === 'approve') {
            try {
                // إزالة الطلب من قائمة الانتظار
                delete vacations.pendingTermination[userId];
                vacationManager.saveVacations(vacations);

                // تحديث حالة الإجازة لتصبح منتهية
                const activeVacations = vacations.active || {};
                if (activeVacations[userId]) {
                    delete activeVacations[userId];
                    vacations.active = activeVacations;
                    vacationManager.saveVacations(vacations);
                }

                // إرسال رسالة تأكيد للمستخدم
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Accepted')
                    .setColor('#2ECC71')
                    .setDescription(`**تمت الموافقة على طلب إنهاء إجازتك مبكراً.**`)
                    .addFields([
                        { name: 'المسؤول', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'العضو', value: `<@${userId}>`, inline: true }
                    ])
                    .setTimestamp();

                try {
                    await requestedUser.send({ embeds: [successEmbed] });
                } catch (dmError) {
                    console.error(`فشل في إرسال رسالة تأكيد إنهاء الإجازة لـ ${requestedUser.tag}:`, dmError.message);
                }

                // تحديث الرسالة الحالية فوراً لمنع unknown interaction
                await interaction.editReply({
                    embeds: [successEmbed],
                    components: []
                });

            } catch (error) {
                console.error('خطأ في الموافقة على إنهاء الإجازة:', error);
                await interaction.editReply({
                    content: `❌ **حدث خطأ أثناء الموافقة على إنهاء الإجازة:**\n\`\`\`${error.message}\`\`\``,
                    components: []
                });
            }
        } else if (action === 'reject') {
            try {
                // إضافة كولداون 12 ساعة
                if (!vacations.cooldowns) vacations.cooldowns = {};
                vacations.cooldowns[userId] = Date.now() + (12 * 60 * 60 * 1000);

                // إزالة الطلب من قائمة الانتظار
                delete vacations.pendingTermination[userId];
                vacationManager.saveVacations(vacations);

                // إرسال رسالة رفض للمستخدم
                const rejectEmbed = new EmbedBuilder()
                    .setTitle('❌ Rejected')
                    .setColor('#E74C3C')
                    .setDescription(`**تم رفض طلب إنهاء إجازتك مبكراً.**`)
                    .addFields([
                        { name: 'العضو', value: `<@${userId}>`, inline: true },
                        { name: 'الكولداون', value: '12 ساعة', inline: true }
                    ])
                    .setTimestamp();

                try {
                    await requestedUser.send({ embeds: [rejectEmbed] });
                } catch (dmError) {
                    console.error(`فشل في إرسال رسالة رفض إنهاء الإجازة لـ ${requestedUser.tag}:`, dmError.message);
                }

                // تحديث الرسالة الحالية فوراً لمنع unknown interaction
                await interaction.editReply({
                    embeds: [rejectEmbed],
                    components: []
                });

            } catch (error) {
                console.error('خطأ في رفض إنهاء الإجازة:', error);
                await interaction.editReply({
                    content: `❌ **حدث خطأ أثناء رفض إنهاء الإجازة:**\n\`\`\`${error.message}\`\`\``,
                    components: []
                });
            }
        }
    }
}

module.exports = {
    name: 'اجازتي',
    execute,
    handleInteraction
};