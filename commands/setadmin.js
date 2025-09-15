const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

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
                rejectCooldownHours: 24
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
                rejectCooldownHours: 24
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

// التحقق من الصلاحيات
function hasPermission(member) {
    const adminRoles = loadAdminRoles();
    const hasAdminRole = member.roles.cache.some(role => adminRoles.includes(role.id));
    
    // فحص إذا كان مالك السيرفر
    const isGuildOwner = member.guild.ownerId === member.id;
    
    // فحص إذا كان من مالكي البوت
    const BOT_OWNERS = global.BOT_OWNERS || [];
    const isBotOwner = BOT_OWNERS.includes(member.id);
    
    return hasAdminRole || isGuildOwner || isBotOwner;
}

module.exports = {
    name: 'setadmin',
    description: 'إعداد نظام التقديم الإداري',
    
    async execute(interaction) {
        // التحقق من الصلاحيات
        if (!hasPermission(interaction.member)) {
            return interaction.reply({
                content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر'
            });
        }

        const settings = loadAdminApplicationSettings();
        
        // إنشاء قائمة الخيارات
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('setadmin_menu')
            .setPlaceholder('اختر الإعداد المراد تعديله')
            .addOptions([
                {
                    label: 'تحديد قناة التقديم',
                    description: 'تحديد القناة التي ستظهر بها طلبات التقديم الإداري',
                    value: 'set_channel'
                },
                {
                    label: 'تحديد المعتمدين',
                    description: 'تحديد من يستطيع الموافقة على طلبات التقديم',
                    value: 'set_approvers'
                },
                {
                    label: 'حد الطلبات المعلقة',
                    description: 'تحديد عدد الطلبات المعلقة المسموح لكل إداري',
                    value: 'set_pending_limit'
                },
                {
                    label: 'مدة الكولداون',
                    description: 'تحديد مدة منع التقديم بعد الرفض (بالساعات)',
                    value: 'set_cooldown'
                },
                {
                    label: 'عرض الإعدادات الحالية',
                    description: 'عرض جميع الإعدادات الحالية للنظام',
                    value: 'show_settings'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعداد نظام التقديم الإداري')
            .setDescription('اختر الإعداد الذي تريد تعديله من القائمة أدناه')
            .setColor('#3498db')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row]
        });

        try {
            // انتظار تفاعل المستخدم
            const selectInteraction = await interaction.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && i.customId === 'setadmin_menu',
                time: 300000 // 5 دقائق
            });

            const choice = selectInteraction.values[0];
            
            switch (choice) {
                case 'set_channel':
                    await handleSetChannel(selectInteraction, settings);
                    break;
                case 'set_approvers':
                    await handleSetApprovers(selectInteraction, settings);
                    break;
                case 'set_pending_limit':
                    await handleSetPendingLimit(selectInteraction, settings);
                    break;
                case 'set_cooldown':
                    await handleSetCooldown(selectInteraction, settings);
                    break;
                case 'show_settings':
                    await handleShowSettings(selectInteraction, settings);
                    break;
            }
        } catch (error) {
            if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                await interaction.editReply({
                    content: '⏰ انتهت مهلة الانتظار. يرجى تشغيل الأمر مرة أخرى.',
                    components: []
                }).catch(() => {});
            } else {
                console.error('خطأ في معالجة تفاعل setadmin:', error);
            }
        }
    }
};

// معالج تحديد القناة
async function handleSetChannel(interaction, settings) {
    const channels = interaction.guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText)
        .first(25);
    
    if (channels.length === 0) {
        return interaction.reply({
            content: '❌ لا توجد قنوات نصية في السيرفر'
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
    
    await interaction.reply({
        content: 'اختر القناة التي ستظهر بها طلبات التقديم الإداري:',
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
                content: `✅ تم تحديد قناة التقديم الإداري إلى: ${channel}`,
                components: []
            });
        } else {
            await channelInteraction.update({
                content: '❌ فشل في حفظ الإعدادات',
                components: []
            });
        }
    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            await interaction.editReply({
                content: '⏰ انتهت مهلة الانتظار.',
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
                label: 'أدوار محددة',
                description: 'تحديد أدوار معينة يمكنها الموافقة على الطلبات',
                value: 'roles'
            },
            {
                label: 'مسؤولية معينة',
                description: 'تحديد مسؤولية معينة يمكن لأصحابها الموافقة',
                value: 'responsibility'
            },
            {
                label: 'مالكي البوت فقط',
                description: 'مالكي البوت فقط يمكنهم الموافقة على الطلبات',
                value: 'owners'
            }
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.reply({
        content: 'اختر نوع المعتمدين للموافقة على طلبات التقديم:',
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
                    content: '✅ تم تحديد المعتمدين إلى: مالكي البوت فقط',
                    components: []
                });
            } else {
                await typeInteraction.update({
                    content: '❌ فشل في حفظ الإعدادات',
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
                content: '⏰ انتهت مهلة الانتظار.',
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
            content: '❌ لا توجد أدوار متاحة في السيرفر',
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

    try {
        const rolesInteraction = await interaction.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id && i.customId === 'select_approver_roles',
            time: 60000
        });

        const selectedRoles = rolesInteraction.values;
        const roleNames = selectedRoles.map(roleId => 
            interaction.guild.roles.cache.get(roleId)?.name || 'دور غير معروف'
        );
        
        settings.settings.approvers = { type: 'roles', list: selectedRoles };
        
        if (saveAdminApplicationSettings(settings)) {
            await rolesInteraction.update({
                content: `✅ تم تحديد الأدوار المعتمدة إلى: ${roleNames.join(', ')}`,
                components: []
            });
        } else {
            await rolesInteraction.update({
                content: '❌ فشل في حفظ الإعدادات',
                components: []
            });
        }
    } catch (error) {
        if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            await interaction.editReply({
                content: '⏰ انتهت مهلة الانتظار.',
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
                content: '❌ لا توجد مسؤوليات محددة في النظام',
                components: []
            });
        }

        const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
        const responsibilities = Object.keys(responsibilitiesData);

        if (responsibilities.length === 0) {
            return interaction.update({
                content: '❌ لا توجد مسؤوليات محددة في النظام',
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

        try {
            const respInteraction = await interaction.awaitMessageComponent({
                filter: i => i.user.id === interaction.user.id && i.customId === 'select_approver_responsibility',
                time: 60000
            });

            const selectedResp = respInteraction.values[0];
            
            settings.settings.approvers = { type: 'responsibility', list: [selectedResp] };
            
            if (saveAdminApplicationSettings(settings)) {
                await respInteraction.update({
                    content: `✅ تم تحديد المعتمدين إلى: أصحاب مسؤولية "${selectedResp}"`,
                    components: []
                });
            } else {
                await respInteraction.update({
                    content: '❌ فشل في حفظ الإعدادات',
                    components: []
                });
            }
        } catch (awaitError) {
            if (awaitError.code === 'INTERACTION_COLLECTOR_ERROR') {
                await interaction.editReply({
                    content: '⏰ انتهت مهلة الانتظار.',
                    components: []
                }).catch(() => {});
            }
        }
    } catch (error) {
        console.error('خطأ في تحميل المسؤوليات:', error);
        await interaction.update({
            content: '❌ خطأ في تحميل المسؤوليات',
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
                content: '❌ يجب أن يكون الحد رقماً بين 1 و 10'
            });
        }

        settings.settings.maxPendingPerAdmin = limit;
        
        if (saveAdminApplicationSettings(settings)) {
            await modalSubmission.reply({
                content: `✅ تم تحديد حد الطلبات المعلقة إلى: ${limit} طلبات لكل إداري`
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
                content: '❌ يجب أن تكون المدة رقماً بين 1 و 168 ساعة (أسبوع)'
            });
        }

        settings.settings.rejectCooldownHours = hours;
        
        if (saveAdminApplicationSettings(settings)) {
            await modalSubmission.reply({
                content: `✅ تم تحديد مدة الكولداون إلى: ${hours} ساعة`
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

    const embed = new EmbedBuilder()
        .setTitle('📋 الإعدادات الحالية لنظام التقديم الإداري')
        .addFields([
            { name: '📢 قناة التقديم', value: channelText, inline: true },
            { name: '👥 المعتمدين', value: approversText, inline: true },
            { name: '📊 حد الطلبات المعلقة', value: `${set.maxPendingPerAdmin} طلبات`, inline: true },
            { name: '⏰ مدة الكولداون', value: `${set.rejectCooldownHours} ساعة`, inline: true },
            { name: '📈 الطلبات المعلقة الحالية', value: `${Object.keys(settings.pendingApplications).length} طلب`, inline: true },
            { name: '🚫 في الكولداون الحالي', value: `${Object.keys(settings.rejectedCooldowns).length} شخص`, inline: true }
        ])
        .setColor('#3498db')
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
            const acceptEmbed = new EmbedBuilder()
                .setTitle('🎉 تم قبولك في الإدارة!')
                .setDescription(`تهانينا! تم قبول طلبك للحصول على صلاحيات إدارية في **${interaction.guild.name}**`)
                .addFields([
                    { name: '👨‍💼 تمت الموافقة بواسطة', value: interaction.user.username, inline: true },
                    { name: '📅 تاريخ الموافقة', value: new Date().toLocaleDateString('ar-EG'), inline: true },
                    { name: '🎯 الأدوار الممنوحة', value: rolesToAdd.map(r => r.name).join(', ') || 'لا توجد أدوار جديدة', inline: false }
                ])
                .setColor('#00ff00')
                .setTimestamp();
                
            await candidate.send({ embeds: [acceptEmbed] });
        } catch (dmError) {
            console.log(`لا يمكن إرسال رسالة خاصة للمرشح ${candidate.displayName}`);
        }
        
        // تحديث رسالة التقديم الأصلية
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#00ff00')
            .addFields([
                { name: '✅ حالة الطلب', value: 'تمت الموافقة', inline: true },
                { name: '👨‍💼 تمت الموافقة بواسطة', value: interaction.user.username, inline: true },
                { name: '📅 تاريخ الموافقة', value: new Date().toLocaleDateString('ar-EG'), inline: true }
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
            const rejectEmbed = new EmbedBuilder()
                .setTitle('❌ تم رفض طلبك للإدارة')
                .setDescription(`للأسف، تم رفض طلبك للحصول على صلاحيات إدارية في **${interaction.guild.name}**`)
                .addFields([
                    { name: '👨‍💼 تم الرفض بواسطة', value: interaction.user.username, inline: true },
                    { name: '📅 تاريخ الرفض', value: new Date().toLocaleDateString('ar-EG'), inline: true },
                    { name: '⏰ يمكنك التقديم مرة أخرى بعد', value: `${settings.settings.rejectCooldownHours} ساعة`, inline: true }
                ])
                .setColor('#ff0000')
                .setTimestamp();
                
            await candidate.send({ embeds: [rejectEmbed] });
        } catch (dmError) {
            console.log(`لا يمكن إرسال رسالة خاصة للمرشح ${candidate.displayName}`);
        }
        
        // تحديث رسالة التقديم الأصلية
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#ff0000')
            .addFields([
                { name: '❌ حالة الطلب', value: 'تم الرفض', inline: true },
                { name: '👨‍💼 تم الرفض بواسطة', value: interaction.user.username, inline: true },
                { name: '📅 تاريخ الرفض', value: new Date().toLocaleDateString('ar-EG'), inline: true }
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

// تصدير الدالة للاستخدام في bot.js
module.exports.handleAdminApplicationInteraction = handleAdminApplicationInteraction;