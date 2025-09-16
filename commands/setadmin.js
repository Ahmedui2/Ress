const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager');

const adminApplicationsPath = path.join(__dirname, '..', 'data', 'adminApplications.json');

// دالة لقراءة إعدادات التقديم الإداري
function loadAdminApplicationSettings() {
    try {
        if (fs.existsSync(adminApplicationsPath)) {
            const data = fs.readFileSync(adminApplicationsPath, 'utf8');
            return JSON.parse(data);
        }
        return {
            settings: {
                applicationChannel: null,
                approvers: { type: "roles", list: [] },
                maxPendingPerAdmin: 3,
                rejectCooldownHours: 24,
                evaluation: {
                    minMessages: {
                        weak: 20,
                        good: 50,
                        excellent: 100
                    },
                    minVoiceTime: {
                        weak: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
                        good: 5 * 60 * 60 * 1000, // 5 hours in milliseconds
                        excellent: 10 * 60 * 60 * 1000 // 10 hours in milliseconds
                    },
                    activeDaysPerWeek: {
                        minimum: 3,
                        resetWeekly: true
                    },
                    timeInServerDays: {
                        minimum: 7,
                        excellent: 30
                    }
                }
            },
            pendingApplications: {},
            rejectedCooldowns: {}
        };
    } catch (error) {
        console.error('خطأ في قراءة إعدادات التقديم الإداري:', error);
        return {
            settings: {
                applicationChannel: null,
                approvers: { type: "roles", list: [] },
                maxPendingPerAdmin: 3,
                rejectCooldownHours: 24,
                evaluation: {
                    minMessages: {
                        weak: 20,
                        good: 50,
                        excellent: 100
                    },
                    minVoiceTime: {
                        weak: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
                        good: 5 * 60 * 60 * 1000, // 5 hours in milliseconds
                        excellent: 10 * 60 * 60 * 1000 // 10 hours in milliseconds
                    },
                    activeDaysPerWeek: {
                        minimum: 3,
                        resetWeekly: true
                    },
                    timeInServerDays: {
                        minimum: 7,
                        excellent: 30
                    }
                }
            },
            pendingApplications: {},
            rejectedCooldowns: {}
        };
    }
}

// دالة لحفظ إعدادات التقديم الإداري
function saveAdminApplicationSettings(data) {
    try {
        fs.writeFileSync(adminApplicationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات التقديم الإداري:', error);
        return false;
    }
}

// دالة لتحميل أدوار المشرفين
function loadAdminRoles() {
    try {
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        if (fs.existsSync(adminRolesPath)) {
            const data = fs.readFileSync(adminRolesPath, 'utf8');
            const adminRoles = JSON.parse(data);
            return Array.isArray(adminRoles) ? adminRoles : [];
        }
        return [];
    } catch (error) {
        console.error('خطأ في تحميل أدوار المشرفين:', error);
        return [];
    }
}

// التحقق من الصلاحيات - مقيد لمالكي البوت ومالك السيرفر فقط
function hasPermission(member) {
    // فحص إذا كان مالك السيرفر
    const isGuildOwner = member.guild.ownerId === member.id;

    // فحص إذا كان من مالكي البوت
    const BOT_OWNERS = global.BOT_OWNERS || [];
    const isBotOwner = BOT_OWNERS.includes(member.id);

    return isGuildOwner || isBotOwner;
}

module.exports = {
    name: 'setadmin',
    description: 'إعداد نظام التقديم الإداري',

    async execute(interaction) {
        // التحقق من الصلاحيات
        if (!hasPermission(interaction.member)) {
            return interaction.reply({
                content: 'ليس لديك صلاحية لاستخدام هذا الأمر. هذا الأمر مقيد لمالكي البوت ومالك السيرفر فقط.'
            });
        }

        const settings = loadAdminApplicationSettings();

        // إنشاء قائمة الخيارات
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setadmin_menu')
            .setPlaceholder('اختر الإعداد المراد تعديله')
            .addOptions([
                {
                    label: 'Application Channel',
                    description: 'تحديد الروم التي ستظهر بها طلبات التقديم الإداري',
                    value: 'set_channel'
                },
                {
                    label: 'Approvers',
                    description: 'تحديد من يستطيع الموافقة على طلبات التقديم',
                    value: 'set_approvers'
                },
                {
                    label: 'Pending Limit',
                    description: 'تحديد عدد الطلبات المعلقة المسموح لكل إداري',
                    value: 'set_pending_limit'
                },
                {
                    label: 'Cooldown Duration',
                    description: 'تحديد مدة منع التقديم بعد الرفض (بالساعات)',
                    value: 'set_cooldown'
                },
                {
                    label: 'Evaluation Settings',
                    description: 'تعديل معايير التقييم (الرسائل، النشاط، الوقت في السيرفر، الوقت الصوتي)',
                    value: 'set_evaluation'
                },
                {
                    label: 'Current Settings',
                    description: 'عرض جميع الإعدادات الحالية للنظام',
                    value: 'show_settings'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = colorManager.createEmbed()
            .setTitle('Admin system')
            .setDescription('** اختار ماذا تريد ان تعديل فالنظام الاداري **')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });
    }
};

// معالج تحديد القناة
async function handleSetChannel(interaction, settings) {
    const channels = interaction.guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText)
        .first(25);

    if (channels.length === 0) {
        return interaction.reply({
            content: 'لا توجد رومات نصية في السيرفر'
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_application_channel')
        .setPlaceholder('اختر روم التقديم الإداري')
        .addOptions(
            channels.map(channel => ({
                label: `#${channel.name}`,
                description: `ID: ${channel.id}`,
                value: channel.id
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '**اختر الروم التي ستظهر بها طلبات التقديم الإداري:**',
        components: [row]
    });

    try {
        const channelInteraction = await interaction.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id && i.customId === 'select_application_channel',
            time: 60000
        });

        const channelId = channelInteraction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);

        settings.settings.applicationChannel = channelId;

        if (saveAdminApplicationSettings(settings)) {
            await channelInteraction.update({
                content: `**تم تحديد روم التقديم الإداري إلى: ${channel}**`,
                components: []
            });
        } else {
            await channelInteraction.update({
                content: 'فشل في حفظ الإعدادات',
                components: []
            });
        }
    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            await interaction.editReply({
                content: '**انتهت مهلة الانتظار.**',
                components: []
            }).catch(() => {});
        }
    }
}

// معالج تحديد المعتمدين
async function handleSetApprovers(interaction, settings) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_approver_type')
        .setPlaceholder('اختر نوع المعتمدين')
        .addOptions([
            {
                label: 'Specific Roles',
                description: 'تحديد رولات معينة يمكنها الموافقة على الطلبات',
                value: 'roles'
            },
            {
                label: 'Specific Responsibility',
                description: 'تحديد مسؤولية معينة يمكن لأصحابها الموافقة',
                value: 'responsibility'
            },
            {
                label: 'Bot Owners Only',
                description: 'مالكي البوت فقط يمكنهم الموافقة على الطلبات',
                value: 'owners'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '**اختر نوع المعتمدين للموافقة على طلبات التقديم:**',
        components: [row]
    });

    try {
        const typeInteraction = await interaction.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id && i.customId === 'select_approver_type',
            time: 60000
        });

        const approverType = typeInteraction.values[0];

        if (approverType === 'owners') {
            settings.settings.approvers = { type: 'owners', list: [] };

            if (saveAdminApplicationSettings(settings)) {
                await typeInteraction.update({
                    content: '**تم تحديد المعتمدين إلى : مالكي البوت فقط**',
                    components: []
                });
            } else {
                await typeInteraction.update({
                    content: 'فشل في حفظ الإعدادات',
                    components: []
                });
            }
            return;
        }

        if (approverType === 'roles') {
            await handleSelectRoles(typeInteraction, settings);
        } else if (approverType === 'responsibility') {
            await handleSelectResponsibility(typeInteraction, settings);
        }
    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            await interaction.editReply({
                content: 'انتهت مهلة الانتظار.',
                components: []
            }).catch(() => {});
        }
    }
}

// معالج اختيار الأدوار
async function handleSelectRoles(interaction, settings) {
    const roles = interaction.guild.roles.cache
        .filter(role => !role.managed && role.id !== interaction.guild.id)
        .first(25);

    if (roles.length === 0) {
        return interaction.update({
            content: 'لا توجد رولات متاحة في السيرفر',
            components: []
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_approver_roles')
        .setPlaceholder('**اختر الرولات التي يمكنها الموافقة على الطلبات**')
        .setMaxValues(Math.min(roles.length, 25))
        .addOptions(
            roles.map(role => ({
                label: role.name,
                description: `أعضاء: ${role.members.size}`,
                value: role.id
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
        content: '**اختر الرولات التي يمكنها الموافقة على طلبات التقديم:**',
        components: [row]
    });

    try {
        const rolesInteraction = await interaction.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id && i.customId === 'select_approver_roles',
            time: 60000
        });

        const selectedRoles = rolesInteraction.values;
        const roleNames = selectedRoles.map(roleId => 
            interaction.guild.roles.cache.get(roleId)?.name || 'رول غير معروف'
        );

        settings.settings.approvers = { type: 'roles', list: selectedRoles };

        if (saveAdminApplicationSettings(settings)) {
            await rolesInteraction.update({
                content: `**تم تحديد اارولات المعتمدة إلى: ${roleNames.join(', ')}**`,
                components: []
            });
        } else {
            await rolesInteraction.update({
                content: 'فشل في حفظ الإعدادات',
                components: []
            });
        }
    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            await interaction.editReply({
                content: 'انتهت مهلة الانتظار.',
                components: []
            }).catch(() => {});
        }
    }
}

// معالج اختيار المسؤولية
async function handleSelectResponsibility(interaction, settings) {
    const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

    try {
        if (!fs.existsSync(responsibilitiesPath)) {
            return interaction.update({
                content: 'لا توجد مسؤوليات محددة في النظام',
                components: []
            });
        }

        const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
        const responsibilities = Object.keys(responsibilitiesData);

        if (responsibilities.length === 0) {
            return interaction.update({
                content: '**لا توجد مسؤوليات محددة في النظام**',
                components: []
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_approver_responsibility')
            .setPlaceholder('اختر المسؤولية التي يمكن لأصحابها الموافقة')
            .addOptions(
                responsibilities.slice(0, 25).map(resp => ({
                    label: resp,
                    description: `أصحاب مسؤولية ${resp}`,
                    value: resp
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({
            content: '**اختر المسؤولية التي يمكن لأصحابها الموافقة على طلبات التقديم:**',
            components: [row]
        });

        try {
            const respInteraction = await interaction.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && i.customId === 'select_approver_responsibility',
                time: 60000
            });

            const selectedResp = respInteraction.values[0];

            settings.settings.approvers = { type: 'responsibility', list: [selectedResp] };

            if (saveAdminApplicationSettings(settings)) {
                await respInteraction.update({
                    content: `**تم تحديد المعتمدين إلى: أصحاب مسؤولية "${selectedResp}"**`,
                    components: []
                });
            } else {
                await respInteraction.update({
                    content: 'فشل في حفظ الإعدادات',
                    components: []
                });
            }
        } catch (awaitError) {
            if (awaitError.code === 'INTERACTION_COLLECTOR_ERROR') {
                await interaction.editReply({
                    content: 'انتهت مهلة الانتظار.',
                    components: []
                }).catch(() => {});
            }
        }
    } catch (error) {
        console.error('خطأ في تحميل المسؤوليات:', error);
        await interaction.update({
            content: 'خطأ في تحميل المسؤوليات',
            components: []
        });
    }
}

// معالج تحديد حد الطلبات المعلقة
async function handleSetPendingLimit(interaction, settings) {
    const modal = new ModalBuilder()
        .setCustomId('set_pending_limit_modal')
        .setTitle('تحديد حد الطلبات المعلقة');

    const limitInput = new TextInputBuilder()
        .setCustomId('pending_limit_input')
        .setLabel('حد الطلبات المعلقة لكل إداري')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('أدخل رقم (مثال: 3)')
        .setValue(settings.settings.maxPendingPerAdmin.toString())
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(limitInput);
    modal.addComponents(row);

    await interaction.showModal(modal);

    const modalSubmission = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'set_pending_limit_modal' && i.user.id === interaction.user.id,
        time: 60000
    }).catch(() => null);

    if (modalSubmission) {
        const limit = parseInt(modalSubmission.fields.getTextInputValue('pending_limit_input'));

        if (isNaN(limit) || limit < 1 || limit > 10) {
            return modalSubmission.reply({
                content: 'يجب أن يكون الحد رقماً بين 1 و 10'
            });
        }

        settings.settings.maxPendingPerAdmin = limit;

        if (saveAdminApplicationSettings(settings)) {
            await modalSubmission.reply({
                content: `تم تحديد حد الطلبات المعلقة إلى: ${limit} طلبات لكل إداري`
            });
        } else {
            await modalSubmission.reply({
                content: '❌ فشل في حفظ الإعدادات'
            });
        }
    }
}

// معالج تحديد مدة الكولداون
async function handleSetCooldown(interaction, settings) {
    const modal = new ModalBuilder()
        .setCustomId('set_cooldown_modal')
        .setTitle('تحديد مدة الكولداون');

    const cooldownInput = new TextInputBuilder()
        .setCustomId('cooldown_input')
        .setLabel('مدة منع التقديم بعد الرفض (بالساعات)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('أدخل رقم (مثال: 24)')
        .setValue(settings.settings.rejectCooldownHours.toString())
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(cooldownInput);
    modal.addComponents(row);

    await interaction.showModal(modal);

    const modalSubmission = await interaction.awaitModalSubmit({
        filter: i => i.customId === 'set_cooldown_modal' && i.user.id === interaction.user.id,
        time: 60000
    }).catch(() => null);

    if (modalSubmission) {
        const hours = parseInt(modalSubmission.fields.getTextInputValue('cooldown_input'));

        if (isNaN(hours) || hours < 1 || hours > 168) { // أسبوع كحد أقصى
            return modalSubmission.reply({
                content: 'يجب أن تكون المدة رقماً بين 1 و 168 ساعة (أسبوع)'
            });
        }

        settings.settings.rejectCooldownHours = hours;

        if (saveAdminApplicationSettings(settings)) {
            await modalSubmission.reply({
                content: `تم تحديد مدة الكولداون إلى: ${hours} ساعة`
            });
        } else {
            await modalSubmission.reply({
                content: '❌ فشل في حفظ الإعدادات'
            });
        }
    }
}

// معالج عرض الإعدادات
async function handleShowSettings(interaction, settings) {
    const guild = interaction.guild;
    const set = settings.settings;

    let channelText = 'غير محدد';
    if (set.applicationChannel) {
        const channel = guild.channels.cache.get(set.applicationChannel);
        channelText = channel ? `${channel}` : 'قناة محذوفة';
    }

    let approversText = 'غير محدد';
    if (set.approvers.type === 'owners') {
        approversText = 'مالكي البوت فقط';
    } else if (set.approvers.type === 'roles' && set.approvers.list.length > 0) {
        const roleNames = set.approvers.list
            .map(roleId => guild.roles.cache.get(roleId)?.name || 'دور محذوف')
            .join(', ');
        approversText = `الأدوار: ${roleNames}`;
    } else if (set.approvers.type === 'responsibility' && set.approvers.list.length > 0) {
        approversText = `المسؤولية: ${set.approvers.list[0]}`;
    }

    const eval = set.evaluation || {};
    const minMessages = eval.minMessages || { weak: 20, good: 50, excellent: 100 };
    const minVoiceTime = eval.minVoiceTime || { weak: 2 * 60 * 60 * 1000, good: 5 * 60 * 60 * 1000, excellent: 10 * 60 * 60 * 1000 };
    const activityDays = eval.activeDaysPerWeek || { minimum: 3, resetWeekly: true };
    const serverTime = eval.timeInServerDays || { minimum: 7, excellent: 30 };

    const embed = colorManager.createEmbed()
        .setTitle('Current Admin Application Settings')
        .addFields([
            { name: 'Application Channel', value: channelText, inline: true },
            { name: 'Approvers', value: approversText, inline: true },
            { name: 'Pending Limit', value: `${set.maxPendingPerAdmin} طلبات`, inline: true },
            { name: 'Cooldown Duration', value: `${set.rejectCooldownHours} ساعة`, inline: true },
            { name: 'Current Pending Applications', value: `${Object.keys(settings.pendingApplications).length} طلب`, inline: true },
            { name: 'Users in Cooldown', value: `${Object.keys(settings.rejectedCooldowns).length} شخص`, inline: true },
            { 
                name: 'Evaluation - Messages', 
                value: `ضعيف: <${minMessages.weak} | جيد: ${minMessages.good}-${minMessages.excellent-1} | ممتاز: ${minMessages.excellent}+`, 
                inline: false 
            },
            { 
                name: 'Evaluation - Voice Time', 
                value: `ضعيف: ${Math.round(minVoiceTime.weak / (60 * 60 * 1000))} ساعة | جيد: ${Math.round(minVoiceTime.good / (60 * 60 * 1000))} ساعة | ممتاز: ${Math.round(minVoiceTime.excellent / (60 * 60 * 1000))} ساعة`, 
                inline: false 
            },
            { 
                name: 'Evaluation - Activity', 
                value: `${activityDays.minimum} أيام/أسبوع | إعادة تعيين: ${activityDays.resetWeekly ? 'أسبوعي' : 'تراكمي'}`, 
                inline: true 
            },
            { 
                name: 'Evaluation - Server Time', 
                value: `حد أدنى: ${serverTime.minimum} يوم | ممتاز: ${serverTime.excellent} يوم`, 
                inline: true 
            }
        ])
        .setTimestamp();

    await interaction.reply({
        embeds: [embed]
    });
}

// دالة للتحقق من صلاحيات المعتمدين
function canApproveApplication(member, settings) {
    const approvers = settings.settings.approvers;

    // فحص إذا كان من مالكي البوت
    const BOT_OWNERS = global.BOT_OWNERS || [];
    if (BOT_OWNERS.includes(member.id)) {
        return true;
    }

    // فحص إذا كان مالك السيرفر
    if (member.guild.ownerId === member.id) {
        return true;
    }

    // فحص بناءً على نوع المعتمدين
    if (approvers.type === 'owners') {
        return BOT_OWNERS.includes(member.id);
    }

    if (approvers.type === 'roles') {
        return member.roles.cache.some(role => approvers.list.includes(role.id));
    }

    if (approvers.type === 'responsibility') {
        try {
            const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
            if (fs.existsSync(responsibilitiesPath)) {
                const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
                const targetResponsibility = approvers.list[0];

                if (responsibilitiesData[targetResponsibility]) {
                    return responsibilitiesData[targetResponsibility].includes(member.id);
                }
            }
        } catch (error) {
            console.error('خطأ في فحص المسؤوليات:', error);
        }
    }

    return false;
}

// دالة للتحقق من hierarchy الأدوار
function canManageRoles(guild, botMember, targetRoles) {
    // التحقق من وجود صلاحية إدارة الأدوار
    if (!botMember.permissions.has('ManageRoles')) {
        return { canManage: false, reason: 'البوت لا يملك صلاحية إدارة الأدوار' };
    }

    const botHighestRole = botMember.roles.highest;

    for (const roleId of targetRoles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            continue; // تجاهل الأدوار المحذوفة
        }

        // التحقق من أن دور البوت أعلى من الدور المستهدف
        if (botHighestRole.position <= role.position) {
            return { 
                canManage: false, 
                reason: `دور البوت أقل من أو يساوي دور "${role.name}"` 
            };
        }
    }

    return { canManage: true };
}

// المعالج الرئيسي لتفاعلات التقديم الإداري
async function handleAdminApplicationInteraction(interaction) {
    try {
        const customId = interaction.customId;

        // التحقق من أن التفاعل متعلق بالتقديم الإداري
        if (!customId.startsWith('admin_approve_') && !customId.startsWith('admin_reject_')) {
            return false; // ليس تفاعل تقديم إداري
        }

        // استخراج معرف الطلب
        const applicationId = customId.replace('admin_approve_', '').replace('admin_reject_', '');
        const isApproval = customId.startsWith('admin_approve_');

        // تحميل الإعدادات
        const settings = loadAdminApplicationSettings();

        // التحقق من وجود الطلب
        const application = settings.pendingApplications[applicationId];
        if (!application) {
            await interaction.reply({
                content: '❌ هذا الطلب غير موجود أو تم التعامل معه بالفعل.',
                ephemeral: true
            });
            return true;
        }

        // التحقق من صلاحيات المعتمد
        if (!canApproveApplication(interaction.member, settings)) {
            await interaction.reply({
                content: '❌ ليس لديك صلاحية للموافقة على طلبات التقديم الإداري.',
                ephemeral: true
            });
            return true;
        }

        // الحصول على المرشح
        const candidate = await interaction.guild.members.fetch(application.candidateId).catch(() => null);
        if (!candidate) {
            await interaction.reply({
                content: '❌ المرشح لم يعد موجوداً في السيرفر.',
                ephemeral: true
            });

            // حذف الطلب
            delete settings.pendingApplications[applicationId];
            saveAdminApplicationSettings(settings);
            return true;
        }

        if (isApproval) {
            await handleApproval(interaction, settings, applicationId, application, candidate);
        } else {
            await handleRejection(interaction, settings, applicationId, application, candidate);
        }

        return true;

    } catch (error) {
        console.error('خطأ في معالجة تفاعل التقديم الإداري:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ حدث خطأ في معالجة طلبك. حاول مرة أخرى.',
                ephemeral: true
            }).catch(() => {});
        }

        return true;
    }
}

// معالج الموافقة
async function handleApproval(interaction, settings, applicationId, application, candidate) {
    await interaction.deferReply();

    try {
        // تحميل أدوار المشرفين
        const adminRoles = loadAdminRoles();

        if (adminRoles.length === 0) {
            await interaction.editReply({
                content: '❌ لا توجد أدوار إدارية محددة في النظام. استخدم أمر `adminroles` لتحديدها أولاً.'
            });
            return;
        }

        // التحقق من hierarchy الأدوار
        const botMember = interaction.guild.members.me;
        const roleCheck = canManageRoles(interaction.guild, botMember, adminRoles);

        if (!roleCheck.canManage) {
            await interaction.editReply({
                content: `❌ لا يمكن منح الأدوار الإدارية: ${roleCheck.reason}`
            });
            return;
        }

        // إضافة الأدوار الإدارية للمرشح
        const rolesToAdd = [];
        for (const roleId of adminRoles) {
            const role = interaction.guild.roles.cache.get(roleId);
            if (role && !candidate.roles.cache.has(roleId)) {
                rolesToAdd.push(role);
            }
        }

        if (rolesToAdd.length > 0) {
            await candidate.roles.add(rolesToAdd, `تمت الموافقة على طلب الإدارة بواسطة ${interaction.user.username}`);
        }

        // إرسال رسالة للمرشح
        try {
            const acceptEmbed = colorManager.createEmbed()
                .setTitle('🎉 تم قبول طلبك للإدارة')
                .setDescription(`**قبلك مسؤول القبول :** ${interaction.user.username}\n**رولك الذي عُطي :** ${rolesToAdd.length > 0 ? rolesToAdd.map(r => r.name).join(', ') : 'لا يوجد'}\n**تاريخ الموافقة :** ${new Date().toLocaleDateString('ar-EG')}\n**قوانين يجب أن تتبعها:**\n• استخدم صلاحياتك بحكمة\n• اتبع قوانين السيرفر\n• كن مثالاً يُحتذى به`)
                .setTimestamp();

            await candidate.send({ embeds: [acceptEmbed] });
        } catch (dmError) {
            console.log(`لا يمكن إرسال رسالة خاصة للمرشح ${candidate.displayName}`);
        }

        // تحديث رسالة التقديم الأصلية
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            
            .addFields([
                { name: 'Status', value: 'تمت الموافقة', inline: true },
                { name: 'Approved By', value: interaction.user.username, inline: true },
                { name: 'Approval Date', value: new Date().toLocaleDateString('ar-EG'), inline: true }
            ]);

        await interaction.message.edit({
            embeds: [originalEmbed],
            components: [] // إزالة الأزرار
        });

        // حذف الطلب من البيانات (atomic update)
        delete settings.pendingApplications[applicationId];
        saveAdminApplicationSettings(settings);

        await interaction.editReply({
            content: `✅ تم قبول ${candidate.displayName} في الإدارة بنجاح!`
        });

        console.log(`✅ تم قبول طلب إداري: ${candidate.displayName} (${candidate.id}) بواسطة ${interaction.user.username}`);

    } catch (error) {
        console.error('خطأ في معالجة الموافقة:', error);
        await interaction.editReply({
            content: '❌ حدث خطأ أثناء معالجة الموافقة. حاول مرة أخرى.'
        });
    }
}

// معالج الرفض
async function handleRejection(interaction, settings, applicationId, application, candidate) {
    await interaction.deferReply();

    try {
        // إرسال رسالة للمرشح
        try {
            const rejectEmbed = colorManager.createEmbed()
                .setTitle('❌ تم رفض تقديمك للإدارة')
                .setDescription(`**المسؤول:** ${interaction.user.username}\n**عليك كولداون تقديم إدارة لمدة:** ${settings.settings.rejectCooldownHours} ساعة`)
                .setTimestamp();

            await candidate.send({ embeds: [rejectEmbed] });
        } catch (dmError) {
            console.log(`لا يمكن إرسال رسالة خاصة للمرشح ${candidate.displayName}`);
        }

        // تحديث رسالة التقديم الأصلية
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            
            .addFields([
                { name: 'Status', value: 'تم الرفض', inline: true },
                { name: 'Rejected By', value: interaction.user.username, inline: true },
                { name: 'Rejection Date', value: new Date().toLocaleDateString('ar-EG'), inline: true }
            ]);

        await interaction.message.edit({
            embeds: [originalEmbed],
            components: [] // إزالة الأزرار
        });

        // إضافة كولداون (atomic update)
        settings.rejectedCooldowns[application.candidateId] = {
            rejectedAt: new Date().toISOString(),
            rejectedBy: interaction.user.id
        };

        // حذف الطلب من البيانات
        delete settings.pendingApplications[applicationId];
        saveAdminApplicationSettings(settings);

        await interaction.editReply({
            content: `❌ تم رفض طلب ${candidate.displayName} للإدارة.`
        });

        console.log(`❌ تم رفض طلب إداري: ${candidate.displayName} (${candidate.id}) بواسطة ${interaction.user.username}`);

    } catch (error) {
        console.error('خطأ في معالجة الرفض:', error);
        await interaction.editReply({
            content: '❌ حدث خطأ أثناء معالجة الرفض. حاول مرة أخرى.'
        });
    }
}

// دالة لحساب الوقت الصوتي للمستخدم (تحتاج إلى تكامل مع نظام تتبع الوقت الصوتي)
async function getUserVoiceTime(guildId, userId) {
    // هذه دالة وهمية، يجب استبدالها بمنطق حقيقي لتتبع الوقت الصوتي
    // يمكنك استخدام قاعدة بيانات لتخزين أوقات المستخدمين الصوتي
    console.log(`Placeholder: Fetching voice time for user ${userId} in guild ${guildId}`);
    // Return time in milliseconds
    return Math.floor(Math.random() * 20 * 60 * 60 * 1000); // Random time for example
}

// دالة لحساب أيام النشاط الأسبوعية للمستخدم (تحتاج إلى تكامل مع نظام تتبع النشاط)
async function getUserActiveDays(guildId, userId) {
    // هذه دالة وهمية، يجب استبدالها بمنطق حقيقي لتتبع النشاط
    // يمكنك استخدام قاعدة بيانات لتخزين أيام نشاط المستخدمين
    console.log(`Placeholder: Fetching active days for user ${userId} in guild ${guildId}`);
    // Return number of active days
    return Math.floor(Math.random() * 7) + 1; // Random days for example
}

// دالة لحساب الوقت في السيرفر بالايام
async function getUserServerTimeDays(member) {
    const now = new Date();
    const joinDate = member.joinedAt;
    const diffTime = now.getTime() - joinDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// دالة لتقييم المرشح
async function evaluateApplication(member, settings) {
    const evaluation = settings.settings.evaluation;
    let score = 0;
    let feedback = [];

    // 1. تقييم عدد الرسائل
    const messageCount = 0; // يجب جلب عدد رسائل المستخدم الفعلي
    feedback.push(`عدد الرسائل: ${messageCount}`);
    if (messageCount < evaluation.minMessages.weak) {
        feedback.push('ضعيف في عدد الرسائل.');
    } else if (messageCount < evaluation.minMessages.good) {
        score += 1;
        feedback.push('جيد في عدد الرسائل.');
    } else if (messageCount < evaluation.minMessages.excellent) {
        score += 2;
        feedback.push('جيد جداً في عدد الرسائل.');
    } else {
        score += 3;
        feedback.push('ممتاز في عدد الرسائل.');
    }

    // 2. تقييم الوقت الصوتي (بالساعات)
    const voiceTimeMs = await getUserVoiceTime(member.guild.id, member.id);
    const voiceTimeHours = voiceTimeMs / (1000 * 60 * 60);
    feedback.push(`الوقت الصوتي: ${voiceTimeHours.toFixed(2)} ساعة`);
    if (voiceTimeHours < evaluation.minVoiceTime.weak / (1000 * 60 * 60)) {
        feedback.push('ضعيف في الوقت الصوتي.');
    } else if (voiceTimeHours < evaluation.minVoiceTime.good / (1000 * 60 * 60)) {
        score += 1;
        feedback.push('جيد في الوقت الصوتي.');
    } else if (voiceTimeHours < evaluation.minVoiceTime.excellent / (1000 * 60 * 60)) {
        score += 2;
        feedback.push('جيد جداً في الوقت الصوتي.');
    } else {
        score += 3;
        feedback.push('ممتاز في الوقت الصوتي.');
    }

    // 3. تقييم أيام النشاط الأسبوعية
    const activeDays = await getUserActiveDays(member.guild.id, member.id);
    feedback.push(`أيام النشاط: ${activeDays} أيام`);
    if (activeDays < evaluation.activeDaysPerWeek.minimum) {
        feedback.push('ضعيف في أيام النشاط الأسبوعية.');
    } else {
        score += 1;
        feedback.push('جيد في أيام النشاط الأسبوعية.');
    }

    // 4. تقييم الوقت في السيرفر
    const serverTimeDays = await getUserServerTimeDays(member);
    feedback.push(`الوقت في السيرفر: ${serverTimeDays} يوم`);
    if (serverTimeDays < evaluation.timeInServerDays.minimum) {
        feedback.push('ضعيف في مدة البقاء في السيرفر.');
    } else if (serverTimeDays < evaluation.timeInServerDays.excellent) {
        score += 1;
        feedback.push('جيد في مدة البقاء في السيرفر.');
    } else {
        score += 2;
        feedback.push('ممتاز في مدة البقاء في السيرفر.');
    }

    // تحديد التقييم النهائي
    let evaluationResult = 'غير مؤهل';
    if (score >= 10) {
        evaluationResult = 'ممتاز';
    } else if (score >= 7) {
        evaluationResult = 'جيد جداً';
    } else if (score >= 4) {
        evaluationResult = 'جيد';
    } else if (score >= 2) {
        evaluationResult = 'مقبول';
    }

    return { score, feedback, evaluationResult };
}

// المعالج الرئيسي لتفاعلات setadmin
async function handleInteraction(interaction) {
    try {
        const customId = interaction.customId;

        // التحقق من الصلاحيات
        if (!hasPermission(interaction.member)) {
            return interaction.reply({
                content: 'ليس لديك صلاحية لاستخدام هذا الأمر. هذا الأمر مقيد لمالكي البوت ومالك السيرفر فقط.',
                ephemeral: true
            });
        }

        const settings = loadAdminApplicationSettings();

        // معالجة القائمة الرئيسية
        if (customId === 'setadmin_menu') {
            const choice = interaction.values[0];

            switch (choice) {
                case 'set_channel':
                    await handleSetChannelInteraction(interaction, settings);
                    break;
                case 'set_approvers':
                    await handleSetApproversInteraction(interaction, settings);
                    break;
                case 'set_pending_limit':
                    await handleSetPendingLimitInteraction(interaction, settings);
                    break;
                case 'set_cooldown':
                    await handleSetCooldownInteraction(interaction, settings);
                    break;
                case 'set_evaluation':
                    await handleSetEvaluationInteraction(interaction, settings);
                    break;
                case 'show_settings':
                    await handleShowSettingsInteraction(interaction, settings);
                    break;
            }
            return;
        }

        // معالجة اختيار قناة التقديم
        if (customId === 'select_application_channel') {
            const channelId = interaction.values[0];
            const channel = interaction.guild.channels.cache.get(channelId);

            settings.settings.applicationChannel = channelId;

            if (saveAdminApplicationSettings(settings)) {
                await interaction.update({
                    content: `تم تحديد قناة التقديم الإداري إلى: ${channel}`,
                    components: []
                });
            } else {
                await interaction.update({
                    content: 'فشل في حفظ الإعدادات',
                    components: []
                });
            }
            return;
        }

        // معالجة اختيار نوع المعتمدين
        if (customId === 'select_approver_type') {
            const approverType = interaction.values[0];

            if (approverType === 'owners') {
                settings.settings.approvers = { type: 'owners', list: [] };

                if (saveAdminApplicationSettings(settings)) {
                    await interaction.update({
                        content: 'تم تحديد المعتمدين إلى: مالكي البوت فقط',
                        components: []
                    });
                } else {
                    await interaction.update({
                        content: 'فشل في حفظ الإعدادات',
                        components: []
                    });
                }
                return;
            }

            if (approverType === 'roles') {
                await handleSelectRolesInteraction(interaction, settings);
            } else if (approverType === 'responsibility') {
                await handleSelectResponsibilityInteraction(interaction, settings);
            }
            return;
        }

        // معالجة اختيار الأدوار المعتمدة
        if (customId === 'select_approver_roles') {
            const selectedRoles = interaction.values;
            const roleNames = selectedRoles.map(roleId => 
                interaction.guild.roles.cache.get(roleId)?.name || 'دور غير معروف'
            );

            settings.settings.approvers = { type: 'roles', list: selectedRoles };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.update({
                    content: `تم تحديد الأدوار المعتمدة إلى: ${roleNames.join(', ')}`,
                    components: []
                });
            } else {
                await interaction.update({
                    content: 'فشل في حفظ الإعدادات',
                    components: []
                });
            }
            return;
        }

        // معالجة اختيار المسؤولية المعتمدة
        if (customId === 'select_approver_responsibility') {
            const selectedResp = interaction.values[0];

            settings.settings.approvers = { type: 'responsibility', list: [selectedResp] };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.update({
                    content: `تم تحديد المعتمدين إلى: أصحاب مسؤولية "${selectedResp}"`,
                    components: []
                });
            } else {
                await interaction.update({
                    content: 'فشل في حفظ الإعدادات',
                    components: []
                });
            }
            return;
        }

        // معالجة مودال حد الطلبات المعلقة
        if (customId === 'set_pending_limit_modal') {
            const limit = parseInt(interaction.fields.getTextInputValue('pending_limit_input'));

            if (isNaN(limit) || limit < 1 || limit > 10) {
                return interaction.reply({
                    content: 'يجب أن يكون الحد رقماً بين 1 و 10',
                    ephemeral: true
                });
            }

            settings.settings.maxPendingPerAdmin = limit;

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديد حد الطلبات المعلقة إلى: ${limit} طلبات لكل إداري`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

        // معالجة مودال مدة الكولداون
        if (customId === 'set_cooldown_modal') {
            const hours = parseInt(interaction.fields.getTextInputValue('cooldown_input'));

            if (isNaN(hours) || hours < 1 || hours > 168) {
                return interaction.reply({
                    content: 'يجب أن تكون المدة رقماً بين 1 و 168 ساعة (أسبوع)',
                    ephemeral: true
                });
            }

            settings.settings.rejectCooldownHours = hours;

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديد مدة الكولداون إلى: ${hours} ساعة`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

        // معالجة اختيار إعداد التقييم
        if (customId === 'select_evaluation_setting') {
            const evaluationType = interaction.values[0];

            if (evaluationType === 'messages_criteria') {
                await handleMessagesCriteriaInteraction(interaction, settings);
            } else if (evaluationType === 'voice_time_criteria') {
                await handleVoiceTimeCriteriaInteraction(interaction, settings);
            } else if (evaluationType === 'activity_criteria') {
                await handleActivityCriteriaInteraction(interaction, settings);
            } else if (evaluationType === 'server_time_criteria') {
                await handleServerTimeCriteriaInteraction(interaction, settings);
            }
            return;
        }

        // معالجة مودال معايير الرسائل
        if (customId === 'messages_criteria_modal') {
            const weakLimit = parseInt(interaction.fields.getTextInputValue('min_messages_weak'));
            const goodLimit = parseInt(interaction.fields.getTextInputValue('min_messages_good'));
            const excellentLimit = parseInt(interaction.fields.getTextInputValue('min_messages_excellent'));

            if (isNaN(weakLimit) || isNaN(goodLimit) || isNaN(excellentLimit) || 
                weakLimit >= goodLimit || goodLimit >= excellentLimit || 
                weakLimit < 1 || excellentLimit > 10000) {
                return interaction.reply({
                    content: 'قيم غير صحيحة! تأكد أن: ضعيف < جيد < ممتاز، وجميع القيم بين 1-10000',
                    ephemeral: true
                });
            }

            if (!settings.settings.evaluation) {
                settings.settings.evaluation = {};
            }
            settings.settings.evaluation.minMessages = {
                weak: weakLimit,
                good: goodLimit,
                excellent: excellentLimit
            };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديث معايير الرسائل:\n• ضعيف: أقل من ${weakLimit}\n• جيد: ${weakLimit}-${goodLimit-1}\n• ممتاز: ${excellentLimit}+`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

        // معالجة مودال معايير النشاط
        if (customId === 'activity_criteria_modal') {
            const minDays = parseInt(interaction.fields.getTextInputValue('min_active_days'));
            const resetWeekly = interaction.fields.getTextInputValue('reset_weekly').toLowerCase() === 'true';

            if (isNaN(minDays) || minDays < 1 || minDays > 7) {
                return interaction.reply({
                    content: 'عدد الأيام يجب أن يكون بين 1 و 7',
                    ephemeral: true
                });
            }

            if (!settings.settings.evaluation) {
                settings.settings.evaluation = {};
            }
            settings.settings.evaluation.activeDaysPerWeek = {
                minimum: minDays,
                resetWeekly: resetWeekly
            };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديث معايير النشاط:\n• الحد الأدنى: ${minDays} أيام/أسبوع\n• إعادة التعيين: ${resetWeekly ? 'أسبوعي' : 'تراكمي'}`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

        // معالجة مودال معايير الوقت الصوتي
        if (customId === 'voice_time_criteria_modal') {
            const weakHours = parseFloat(interaction.fields.getTextInputValue('min_voice_time_weak'));
            const goodHours = parseFloat(interaction.fields.getTextInputValue('min_voice_time_good'));
            const excellentHours = parseFloat(interaction.fields.getTextInputValue('min_voice_time_excellent'));

            if (isNaN(weakHours) || isNaN(goodHours) || isNaN(excellentHours) || 
                weakHours >= goodHours || goodHours >= excellentHours || 
                weakHours < 0 || excellentHours > 1000) {
                return interaction.reply({
                    content: 'قيم الوقت الصوتي غير صحيحة! تأكد أن: ضعيف < جيد < ممتاز، وجميع القيم بين 0-1000 ساعة',
                    ephemeral: true
                });
            }

            if (!settings.settings.evaluation) {
                settings.settings.evaluation = {};
            }
            settings.settings.evaluation.minVoiceTime = {
                weak: weakHours * 60 * 60 * 1000, // تحويل للميلي ثانية
                good: goodHours * 60 * 60 * 1000,
                excellent: excellentHours * 60 * 60 * 1000
            };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديث معايير الوقت الصوتي:\n• ضعيف: ${weakHours} ساعة\n• جيد: ${goodHours} ساعة\n• ممتاز: ${excellentHours} ساعة`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

        // معالجة مودال معايير الوقت في السيرفر
        if (customId === 'server_time_criteria_modal') {
            const minDays = parseInt(interaction.fields.getTextInputValue('min_server_days'));
            const excellentDays = parseInt(interaction.fields.getTextInputValue('excellent_server_days'));

            if (isNaN(minDays) || isNaN(excellentDays) || 
                minDays < 1 || excellentDays <= minDays || excellentDays > 365) {
                return interaction.reply({
                    content: 'قيم غير صحيحة! تأكد أن: الحد الأدنى < الممتاز، وجميع القيم بين 1-365',
                    ephemeral: true
                });
            }

            if (!settings.settings.evaluation) {
                settings.settings.evaluation = {};
            }
            settings.settings.evaluation.timeInServerDays = {
                minimum: minDays,
                excellent: excellentDays
            };

            if (saveAdminApplicationSettings(settings)) {
                await interaction.reply({
                    content: `تم تحديث معايير الوقت في السيرفر:\n• الحد الأدنى: ${minDays} يوم\n• ممتاز: ${excellentDays} يوم`
                });
            } else {
                await interaction.reply({
                    content: 'فشل في حفظ الإعدادات'
                });
            }
            return;
        }

    } catch (error) {
        console.error('خطأ في معالجة تفاعل setadmin:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'حدث خطأ في معالجة طلبك. حاول مرة أخرى.',
                ephemeral: true
            }).catch(() => {});
        }
    }
}

// المعالجات المساعدة للتفاعلات
async function handleSetChannelInteraction(interaction, settings) {
    const channels = interaction.guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText)
        .first(25);

    if (channels.length === 0) {
        return interaction.update({
            content: 'لا توجد قنوات نصية في السيرفر',
            components: []
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_application_channel')
        .setPlaceholder('اختر قناة التقديم الإداري')
        .addOptions(
            channels.map(channel => ({
                label: `#${channel.name}`,
                description: `ID: ${channel.id}`,
                value: channel.id
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
        content: 'اختر القناة التي ستظهر بها طلبات التقديم الإداري:',
        components: [row]
    });
}

async function handleSetApproversInteraction(interaction, settings) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_approver_type')
        .setPlaceholder('اختر نوع المعتمدين')
        .addOptions([
            {
                label: 'Specific Roles',
                description: 'تحديد أدوار معينة يمكنها الموافقة على الطلبات',
                value: 'roles'
            },
            {
                label: 'Specific Responsibility',
                description: 'تحديد مسؤولية معينة يمكن لأصحابها الموافقة',
                value: 'responsibility'
            },
            {
                label: 'Bot Owners Only',
                description: 'مالكي البوت فقط يمكنهم الموافقة على الطلبات',
                value: 'owners'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
        content: 'اختر نوع المعتمدين للموافقة على طلبات التقديم:',
        components: [row]
    });
}

async function handleSelectRolesInteraction(interaction, settings) {
    const roles = interaction.guild.roles.cache
        .filter(role => !role.managed && role.id !== interaction.guild.id)
        .first(25);

    if (roles.length === 0) {
        return interaction.update({
            content: 'لا توجد أدوار متاحة في السيرفر',
            components: []
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_approver_roles')
        .setPlaceholder('اختر الأدوار التي يمكنها الموافقة على الطلبات')
        .setMaxValues(Math.min(roles.length, 25))
        .addOptions(
            roles.map(role => ({
                label: role.name,
                description: `أعضاء: ${role.members.size}`,
                value: role.id
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
        content: 'اختر الأدوار التي يمكنها الموافقة على طلبات التقديم:',
        components: [row]
    });
}

async function handleSelectResponsibilityInteraction(interaction, settings) {
    const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

    try {
        if (!fs.existsSync(responsibilitiesPath)) {
            return interaction.update({
                content: 'لا توجد مسؤوليات محددة في النظام',
                components: []
            });
        }

        const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
        const responsibilities = Object.keys(responsibilitiesData);

        if (responsibilities.length === 0) {
            return interaction.update({
                content: 'لا توجد مسؤوليات محددة في النظام',
                components: []
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_approver_responsibility')
            .setPlaceholder('اختر المسؤولية التي يمكن لأصحابها الموافقة')
            .addOptions(
                responsibilities.slice(0, 25).map(resp => ({
                    label: resp,
                    description: `أصحاب مسؤولية ${resp}`,
                    value: resp
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.update({
            content: 'اختر المسؤولية التي يمكن لأصحابها الموافقة على طلبات التقديم:',
            components: [row]
        });
    } catch (error) {
        console.error('خطأ في تحميل المسؤوليات:', error);
        await interaction.update({
            content: 'خطأ في تحميل المسؤوليات',
            components: []
        });
    }
}

async function handleSetPendingLimitInteraction(interaction, settings) {
    const modal = new ModalBuilder()
        .setCustomId('set_pending_limit_modal')
        .setTitle('تحديد حد الطلبات المعلقة');

    const limitInput = new TextInputBuilder()
        .setCustomId('pending_limit_input')
        .setLabel('حد الطلبات المعلقة لكل إداري')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('أدخل رقم (مثال: 3)')
        .setValue(settings.settings.maxPendingPerAdmin.toString())
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(limitInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleSetCooldownInteraction(interaction, settings) {
    const modal = new ModalBuilder()
        .setCustomId('set_cooldown_modal')
        .setTitle('تحديد مدة الكولداون');

    const cooldownInput = new TextInputBuilder()
        .setCustomId('cooldown_input')
        .setLabel('مدة منع التقديم بعد الرفض (بالساعات)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('أدخل رقم (مثال: 24)')
        .setValue(settings.settings.rejectCooldownHours.toString())
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(cooldownInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

// معالج إعدادات التقييم
async function handleSetEvaluationInteraction(interaction, settings) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_evaluation_setting')
        .setPlaceholder('اختر إعداد التقييم المراد تعديله')
        .addOptions([
            {
                label: 'Messages Criteria',
                description: 'تعديل معايير عدد الرسائل للتقييم',
                value: 'messages_criteria'
            },
            {
                label: 'Voice Time Criteria',
                description: 'تعديل معايير الوقت الصوتي للتقييم',
                value: 'voice_time_criteria'
            },
            {
                label: 'Activity Criteria',
                description: 'تعديل معايير أيام النشاط الأسبوعية',
                value: 'activity_criteria'
            },
            {
                label: 'Server Time Criteria',
                description: 'تعديل معايير الوقت في السيرفر',
                value: 'server_time_criteria'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.update({
        content: 'اختر معيار التقييم الذي تريد تعديله:',
        components: [row]
    });
}

// معالج معايير الرسائل
async function handleMessagesCriteriaInteraction(interaction, settings) {
    const eval = settings.settings.evaluation || {};
    const minMessages = eval.minMessages || { weak: 20, good: 50, excellent: 100 };

    const modal = new ModalBuilder()
        .setCustomId('messages_criteria_modal')
        .setTitle('تعديل معايير الرسائل');

    const weakInput = new TextInputBuilder()
        .setCustomId('min_messages_weak')
        .setLabel('الحد الأدنى للمرشح الضعيف')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 20')
        .setValue(minMessages.weak.toString())
        .setRequired(true);

    const goodInput = new TextInputBuilder()
        .setCustomId('min_messages_good')
        .setLabel('الحد الأدنى للمرشح الجيد')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 50')
        .setValue(minMessages.good.toString())
        .setRequired(true);

    const excellentInput = new TextInputBuilder()
        .setCustomId('min_messages_excellent')
        .setLabel('الحد الأدنى للمرشح الممتاز')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 100')
        .setValue(minMessages.excellent.toString())
        .setRequired(true);

    const rows = [
        new ActionRowBuilder().addComponents(weakInput),
        new ActionRowBuilder().addComponents(goodInput),
        new ActionRowBuilder().addComponents(excellentInput)
    ];

    modal.addComponents(rows);
    await interaction.showModal(modal);
}

// معالج معايير الوقت الصوتي
async function handleVoiceTimeCriteriaInteraction(interaction, settings) {
    const eval = settings.settings.evaluation || {};
    const minVoiceTime = eval.minVoiceTime || { weak: 2 * 60 * 60 * 1000, good: 5 * 60 * 60 * 1000, excellent: 10 * 60 * 60 * 1000 };

    const modal = new ModalBuilder()
        .setCustomId('voice_time_criteria_modal')
        .setTitle('تعديل معايير الوقت الصوتي');

    const weakInput = new TextInputBuilder()
        .setCustomId('min_voice_time_weak')
        .setLabel('الحد الأدنى للصوتي (ساعات) - ضعيف')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 2')
        .setValue((minVoiceTime.weak / (60 * 60 * 1000)).toFixed(1))
        .setRequired(true);

    const goodInput = new TextInputBuilder()
        .setCustomId('min_voice_time_good')
        .setLabel('الحد الأدنى للصوتي (ساعات) - جيد')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 5')
        .setValue((minVoiceTime.good / (60 * 60 * 1000)).toFixed(1))
        .setRequired(true);

    const excellentInput = new TextInputBuilder()
        .setCustomId('min_voice_time_excellent')
        .setLabel('الحد الأدنى للصوتي (ساعات) - ممتاز')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 10')
        .setValue((minVoiceTime.excellent / (60 * 60 * 1000)).toFixed(1))
        .setRequired(true);

    const rows = [
        new ActionRowBuilder().addComponents(weakInput),
        new ActionRowBuilder().addComponents(goodInput),
        new ActionRowBuilder().addComponents(excellentInput)
    ];

    modal.addComponents(rows);
    await interaction.showModal(modal);
}

// معالج معايير النشاط
async function handleActivityCriteriaInteraction(interaction, settings) {
    const eval = settings.settings.evaluation || {};
    const activityDays = eval.activeDaysPerWeek || { minimum: 3, resetWeekly: true };

    const modal = new ModalBuilder()
        .setCustomId('activity_criteria_modal')
        .setTitle('تعديل معايير النشاط');

    const minDaysInput = new TextInputBuilder()
        .setCustomId('min_active_days')
        .setLabel('الحد الأدنى لأيام النشاط (1-7)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 3')
        .setValue(activityDays.minimum.toString())
        .setRequired(true);

    const resetWeeklyInput = new TextInputBuilder()
        .setCustomId('reset_weekly')
        .setLabel('إعادة تعيين أسبوعي؟ (true/false)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('true للأسبوعي، false للتراكمي')
        .setValue(activityDays.resetWeekly.toString())
        .setRequired(true);

    const rows = [
        new ActionRowBuilder().addComponents(minDaysInput),
        new ActionRowBuilder().addComponents(resetWeeklyInput)
    ];

    modal.addComponents(rows);
    await interaction.showModal(modal);
}

// معالج معايير الوقت في السيرفر
async function handleServerTimeCriteriaInteraction(interaction, settings) {
    const eval = settings.settings.evaluation || {};
    const serverTime = eval.timeInServerDays || { minimum: 7, excellent: 30 };

    const modal = new ModalBuilder()
        .setCustomId('server_time_criteria_modal')
        .setTitle('تعديل معايير الوقت في السيرفر');

    const minDaysInput = new TextInputBuilder()
        .setCustomId('min_server_days')
        .setLabel('الحد الأدنى للوقت في السيرفر (أيام)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 7')
        .setValue(serverTime.minimum.toString())
        .setRequired(true);

    const excellentDaysInput = new TextInputBuilder()
        .setCustomId('excellent_server_days')
        .setLabel('الحد الممتاز للوقت في السيرفر (أيام)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('مثال: 30')
        .setValue(serverTime.excellent.toString())
        .setRequired(true);

    const rows = [
        new ActionRowBuilder().addComponents(minDaysInput),
        new ActionRowBuilder().addComponents(excellentDaysInput)
    ];

    modal.addComponents(rows);
    await interaction.showModal(modal);
}

async function handleShowSettingsInteraction(interaction, settings) {
    const guild = interaction.guild;
    const set = settings.settings;

    let channelText = 'غير محدد';
    if (set.applicationChannel) {
        const channel = guild.channels.cache.get(set.applicationChannel);
        channelText = channel ? `${channel}` : 'قناة محذوفة';
    }

    let approversText = 'غير محدد';
    if (set.approvers.type === 'owners') {
        approversText = 'مالكي البوت فقط';
    } else if (set.approvers.type === 'roles' && set.approvers.list.length > 0) {
        const roleNames = set.approvers.list
            .map(roleId => guild.roles.cache.get(roleId)?.name || 'دور محذوف')
            .join(', ');
        approversText = `الأدوار: ${roleNames}`;
    } else if (set.approvers.type === 'responsibility' && set.approvers.list.length > 0) {
        approversText = `المسؤولية: ${set.approvers.list[0]}`;
    }

    const eval = set.evaluation || {};
    const minMessages = eval.minMessages || { weak: 20, good: 50, excellent: 100 };
    const minVoiceTime = eval.minVoiceTime || { weak: 2 * 60 * 60 * 1000, good: 5 * 60 * 60 * 1000, excellent: 10 * 60 * 60 * 1000 };
    const activityDays = eval.activeDaysPerWeek || { minimum: 3, resetWeekly: true };
    const serverTime = eval.timeInServerDays || { minimum: 7, excellent: 30 };

    const embed = colorManager.createEmbed()
        .setTitle('Current Admin Application Settings')
        .addFields([
            { name: 'Application Channel', value: channelText, inline: true },
            { name: 'Approvers', value: approversText, inline: true },
            { name: 'Pending Limit', value: `${set.maxPendingPerAdmin} طلبات`, inline: true },
            { name: 'Cooldown Duration', value: `${set.rejectCooldownHours} ساعة`, inline: true },
            { name: 'Current Pending Applications', value: `${Object.keys(settings.pendingApplications).length} طلب`, inline: true },
            { name: 'Users in Cooldown', value: `${Object.keys(settings.rejectedCooldowns).length} شخص`, inline: true },
            { 
                name: 'Evaluation - Messages', 
                value: `ضعيف: <${minMessages.weak} | جيد: ${minMessages.good}-${minMessages.excellent-1} | ممتاز: ${minMessages.excellent}+`, 
                inline: false 
            },
            { 
                name: 'Evaluation - Voice Time', 
                value: `ضعيف: ${Math.round(minVoiceTime.weak / (60 * 60 * 1000))} ساعة | جيد: ${Math.round(minVoiceTime.good / (60 * 60 * 1000))} ساعة | ممتاز: ${Math.round(minVoiceTime.excellent / (60 * 60 * 1000))} ساعة`, 
                inline: false 
            },
            { 
                name: 'Evaluation - Activity', 
                value: `${activityDays.minimum} أيام/أسبوع | إعادة تعيين: ${activityDays.resetWeekly ? 'أسبوعي' : 'تراكمي'}`, 
                inline: true 
            },
            { 
                name: 'Evaluation - Server Time', 
                value: `حد أدنى: ${serverTime.minimum} يوم | ممتاز: ${serverTime.excellent} يوم`, 
                inline: true 
            }
        ])
        .setTimestamp();

    await interaction.update({
        embeds: [embed],
        components: []
    });
}

// معالجة modal إعدادات التقييم الجديد
async function handleEvaluationSettingsModalSubmit(interaction, settings) {
    if (customId === 'evaluation_settings_modal') {
        const minMessagesWeak = parseInt(interaction.fields.getTextInputValue('min_messages_weak')) || 20;
        const minMessagesGood = parseInt(interaction.fields.getTextInputValue('min_messages_good')) || 50;
        const minMessagesExcellent = parseInt(interaction.fields.getTextInputValue('min_messages_excellent')) || 100;
        const voiceTimeInput = interaction.fields.getTextInputValue('min_voice_time') || '2,5,10';
        const activeDaysInput = interaction.fields.getTextInputValue('active_days_settings') || '3,7,30';

        const voiceTimeParts = voiceTimeInput.split(',').map(s => parseFloat(s.trim()));
        const voiceTimeWeak = voiceTimeParts[0] || 2;
        const voiceTimeGood = voiceTimeParts[1] || 5;
        const voiceTimeExcellent = voiceTimeParts[2] || 10;

        const activeDaysParts = activeDaysInput.split(',').map(s => parseInt(s.trim()));
        const activeDaysPerWeek = activeDaysParts[0] || 3;
        const timeInServerMinimum = activeDaysParts[1] || 7;
        const timeInServerExcellent = activeDaysParts[2] || 30;

        // التحقق من صحة القيم
        if (isNaN(minMessagesWeak) || isNaN(minMessagesGood) || isNaN(minMessagesExcellent) ||
            minMessagesWeak >= minMessagesGood || minMessagesGood >= minMessagesExcellent ||
            minMessagesWeak < 1 || minMessagesExcellent > 10000) {
            return interaction.reply({
                content: 'قيم الرسائل غير صحيحة! تأكد أن: ضعيف < جيد < ممتاز، وجميع القيم بين 1-10000',
                ephemeral: true
            });
        }
        if (isNaN(voiceTimeWeak) || isNaN(voiceTimeGood) || isNaN(voiceTimeExcellent) ||
            voiceTimeWeak >= voiceTimeGood || voiceTimeGood >= voiceTimeExcellent ||
            voiceTimeWeak < 0 || voiceTimeExcellent > 1000) {
            return interaction.reply({
                content: 'قيم الوقت الصوتي غير صحيحة! تأكد أن: ضعيف < جيد < ممتاز، وجميع القيم بين 0-1000 ساعة',
                ephemeral: true
            });
        }
        if (isNaN(activeDaysPerWeek) || activeDaysPerWeek < 1 || activeDaysPerWeek > 7) {
            return interaction.reply({
                content: 'عدد أيام النشاط يجب أن يكون بين 1 و 7',
                ephemeral: true
            });
        }
        if (isNaN(timeInServerMinimum) || isNaN(timeInServerExcellent) ||
            timeInServerMinimum < 1 || timeInServerExcellent <= timeInServerMinimum || timeInServerExcellent > 365) {
            return interaction.reply({
                content: 'قيم خبرة السيرفر غير صحيحة! تأكد أن: الحد الأدنى < الممتاز، وجميع القيم بين 1-365 يوم',
                ephemeral: true
            });
        }

        // حفظ الإعدادات في ملف adminApplications.json
        const evaluationSettings = {
            minMessages: {
                weak: minMessagesWeak,
                good: minMessagesGood,
                excellent: minMessagesExcellent
            },
            minVoiceTime: {
                weak: voiceTimeWeak * 60 * 60 * 1000, // تحويل للميلي ثانية
                good: voiceTimeGood * 60 * 60 * 1000,
                excellent: voiceTimeExcellent * 60 * 60 * 1000
            },
            activeDaysPerWeek: {
                minimum: activeDaysPerWeek,
                resetWeekly: true // سيتم استخدامه لاحقًا
            },
            timeInServerDays: {
                minimum: timeInServerMinimum,
                excellent: timeInServerExcellent
            }
        };

        if (!settings.settings.evaluation) {
            settings.settings.evaluation = {};
        }
        settings.settings.evaluation = { ...settings.settings.evaluation, ...evaluationSettings };

        if (saveAdminApplicationSettings(settings)) {
            await interaction.reply({
                content: `✅ **تم حفظ إعدادات التقييم بنجاح!**\n\n` +
                        `📊 **الحد الأدنى للرسائل:**\n` +
                        `• مرشح ضعيف: ${minMessagesWeak} رسالة\n` +
                        `• مرشح جيد: ${minMessagesGood} رسالة\n` +
                        `• مرشح ممتاز: ${minMessagesExcellent} رسالة\n\n` +
                        `🎙️ **الحد الأدنى للوقت الصوتي:**\n` +
                        `• مرشح ضعيف: ${voiceTimeWeak.toFixed(1)} ساعة\n` +
                        `• مرشح جيد: ${voiceTimeGood.toFixed(1)} ساعة\n` +
                        `• مرشح ممتاز: ${voiceTimeExcellent.toFixed(1)} ساعة\n\n` +
                        `⚡ **أيام النشاط:** ${activeDaysPerWeek} أيام/أسبوع\n` +
                        `📅 **خبرة السيرفر:** ${timeInServerMinimum} يوم (أدنى) - ${timeInServerExcellent} يوم (ممتاز)`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: '❌ **فشل في حفظ الإعدادات**',
                ephemeral: true
            });
        }
        return;
    }
}

// تصدير الدوال للاستخدام في bot.js
module.exports.handleAdminApplicationInteraction = handleAdminApplicationInteraction;
module.exports.handleInteraction = handleInteraction;
module.exports.handleEvaluationSettingsModalSubmit = handleEvaluationSettingsModalSubmit; // Export new handler