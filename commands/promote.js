const { ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager');
const { displayEnhancedUserRecords } = require('../enhanced_user_records.js');
const promoteManager = require('../utils/promoteManager');

/**
 * Check if bot has required permissions for promotion operations
 */
async function checkPromotionPermissions(interaction) {
    const requiredPermissions = [
        'ManageRoles',
        'ViewChannel',
        'SendMessages',
        'EmbedLinks'
    ];
    
    const permissionCheck = await promoteManager.checkBotPermissions(interaction.guild, requiredPermissions);
    
    if (!permissionCheck.hasAll) {
        const embed = colorManager.createEmbed()
            .setTitle('❌ صلاحيات البوت غير كافية')
            .setDescription(permissionCheck.message)
            .setColor(0xff0000)
            .setTimestamp();
            
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
        return false;
    }
    
    return true;
}

/**
 * Validate promotion input data
 */
function validatePromotionInput(userId, roleId, duration, reason) {
    const errors = [];
    
    // Validate user ID
    if (!userId || !/^\d{17,19}$/.test(userId)) {
        errors.push('معرف المستخدم غير صالح');
    }
    
    // Validate role ID
    if (roleId && !/^\d{17,19}$/.test(roleId)) {
        errors.push('معرف الدور غير صالح');
    }
    
    // Validate duration
    const validDurations = ['دائم', 'permanent', '1h', '1d', '7d', '30d', '1w', '1m'];
    if (duration && !validDurations.includes(duration) && !/^\d+[smhdw]$/.test(duration)) {
        errors.push('مدة الترقية غير صالحة');
    }
    
    // Validate reason length
    if (reason && reason.length > 500) {
        errors.push('السبب طويل جداً (الحد الأقصى 500 حرف)');
    }
    
    // Sanitize reason
    if (reason) {
        const sanitizedReason = reason.replace(/[<>&]/g, '').trim();
        if (sanitizedReason.length === 0) {
            errors.push('السبب غير صالح');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors,
        sanitized: {
            userId: userId?.toString().trim(),
            roleId: roleId?.toString().trim(),
            duration: duration?.toString().trim(),
            reason: reason?.toString().replace(/[<>&]/g, '').trim()
        }
    };
}

const name = 'promote';

// Helper function to read JSON files
function readJson(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultValue;
}

// Helper function to save JSON files
function saveJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error saving ${filePath}:`, error);
        return false;
    }
}

// Alias for saveJson (for compatibility)
function writeJson(filePath, data) {
    return saveJson(filePath, data);
}

// Check if initial setup is required
function needsSetup() {
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {});

    return !settings.menuChannel || !settings.logChannel || !settings.allowedUsers?.type;
}

// Create setup status embed
function createSetupEmbed(step, settings = {}, client) {
    const embed = colorManager.createEmbed()
        .setTitle('Promote System Setup')
        .setDescription('يحتاج النظام للإعداد الأولي قبل الاستخدام')
        .setThumbnail(client?.user?.displayAvatarURL() || 'https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
        .setTimestamp();

    // Add fields showing progress
    embed.addFields([
        {
            name: 'تحديد المعتمدين',
            value: settings.allowedUsers?.type ?
                `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets?.length || 0})` :
                step === 1 ? 'جاري التحديد...' : 'لم يتم بعد',
            inline: true
        },
        {
            name: 'روم السجلات',
            value: settings.logChannel ? `<#${settings.logChannel}>` :
                step === 2 ? 'جاري التحديد...' : 'لم يتم بعد',
            inline: true
        },
        {
            name: 'روم المنيو',
            value: settings.menuChannel ? `<#${settings.menuChannel}>` :
                step === 3 ? 'جاري التحديد...' : 'لم يتم بعد',
            inline: true
        }
    ]);

    return embed;
}

function getPermissionTypeText(type) {
    switch (type) {
        case 'owners': return 'المالكين فقط';
        case 'roles': return 'رولات محددة';
        case 'responsibility': return 'مسؤوليات محددة';
        default: return 'غير محدد';
    }
}

// Create permanent menu for the menu channel
async function createPermanentMenu(client, channelId) {
    try {
        console.log(`🔧 بدء إنشاء المنيو الدائم للقناة: ${channelId}`);

        const channel = await client.channels.fetch(channelId).catch(err => {
            console.error('❌ خطأ في جلب القناة:', err);
            return null;
        });

        if (!channel) {
            console.error('❌ القناة غير موجودة أو لا يمكن الوصول إليها');
            return false;
        }

        console.log(`✅ تم العثور على القناة: ${channel.name} (${channel.id})`);

        // التحقق من صلاحيات البوت
        const permissions = channel.permissionsFor(client.user);
        if (!permissions.has(['SendMessages', 'EmbedLinks'])) {
            console.error('❌ البوت لا يملك صلاحيات كافية في القناة');
            return false;
        }

        // إنشاء المنيو الرئيسي نفسه بدون تغييرات
        const settings = promoteManager.getSettings();
        const menuEmbed = colorManager.createEmbed()
            .setTitle('Promote Management System')
            .setDescription('** منيو الترقية للمسؤولين **\n\n')
            .addFields([
                { name: 'Up', value: 'ترقية اداري وإعطاؤه رول إداري لمدة محددة أو نهائياً', inline: false },
                { name: 'Up log', value: 'عرض الترقيات لإداري معين', inline: false },
                { name: 'Block', value: 'منع عضو من الحصول على ترقيات', inline: false },
                { name: 'Unblock', value: 'إزالة منع الترقية عن إداري', inline: false },
                { name: 'Admins active', value: 'فحص إحصائيات تفاعل الادارة قبل الترقية', inline: false }
            ])
            .setThumbnail(client?.user?.displayAvatarURL({ size: 256 }) || 'https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
            .setFooter({text :' By Ahmed'})  
            .setTimestamp();

        const menuSelect = new StringSelectMenuBuilder()
            .setCustomId('promote_main_menu')
            .setPlaceholder(' اختر الإجراء المطلوب...')
            .addOptions([
                {
                    label: 'Up',
                    value: 'promote_user_or_role',
                    description: 'ترقية لاداري وإعطاؤه رول إداري لمدة محددة أو نهائياً',
                              },
                {
                    label: 'Record',
                    value: 'promotion_records',
                    description: 'عرض تاريخ الترقيات لاداري معين',

                },
                {
                    label: 'Block',
                    value: 'ban_from_promotion',
                    description: 'منع اداري من الحصول على ترقيات',

                },
                {
                    label: 'Unblock',
                    value: 'unban_promotion',
                    description: 'إزالة حظر الترقية عن عضو',

                },
                {
                    label: 'Check Admin',
                    value: 'check_admin_activity',
                    description: 'فحص إحصائيات تفاعل الادارة قبل الترقية',
                           }
            ]);

        const settingsButton = new ButtonBuilder()
            .setCustomId('promote_settings_button')
            .setLabel(' الإعدادات')
            .setStyle(ButtonStyle.Secondary);

        const menuRow = new ActionRowBuilder().addComponents(menuSelect);
        const buttonRow = new ActionRowBuilder().addComponents(settingsButton);

        let message = null;

        // حذف الرسالة القديمة إن وجدت
        if (settings.menuMessageId) {
            console.log(`🔄 محاولة حذف المنيو القديم: ${settings.menuMessageId}`);
            try {
                const existingMessage = await channel.messages.fetch(settings.menuMessageId);
                if (existingMessage) {
                    await existingMessage.delete();
                    console.log('🗑️ تم حذف المنيو القديم');
                }
            } catch (error) {
                console.log('⚠️ لم يتم العثور على الرسالة القديمة أو تم حذفها مسبقاً');
            }

            // مسح معرف الرسالة القديمة
            settings.menuMessageId = null;
            promoteManager.updateSettings(settings);
        }

        // انتظار قصير بين الحذف والإنشاء
        await new Promise(resolve => setTimeout(resolve, 1000));

        // إنشاء المنيو الجديد
        console.log('🆕 إنشاء منيو جديد...');
        try {
            message = await channel.send({
                embeds: [menuEmbed],
                components: [menuRow, buttonRow]
            });

            if (!message) {
                console.error('❌ فشل في إنشاء الرسالة - الاستجابة فارغة');
                return false;
            }

            // حفظ معرف الرسالة الجديدة
            settings.menuMessageId = message.id;
            const saveResult = promoteManager.updateSettings(settings);

            if (!saveResult) {
                console.error('⚠️ فشل في حفظ معرف الرسالة الجديد');
            }

            console.log(`✅ تم إنشاء منيو جديد بنجاح - معرف الرسالة: ${message.id}`);
            console.log(`📍 تم إرسال المنيو إلى القناة: ${channel.name} (${channel.id})`);
            return true;
        } catch (error) {
            console.error('❌ خطأ في إنشاء المنيو الجديد:', error);

            // إضافة تفاصيل أكثر عن نوع الخطأ
            if (error.code === 50013) {
                console.error('❌ البوت لا يملك صلاحية إرسال الرسائل في هذه القناة');
            } else if (error.code === 50001) {
                console.error('❌ البوت لا يملك صلاحية الوصول لهذه القناة');
            } else if (error.code === 10003) {
                console.error('❌ القناة غير موجودة');
            }

            return false;
        }
    } catch (error) {
        console.error('❌ خطأ عام في إنشاء المنيو الدائم:', error);
        return false;
    }
}

async function execute(message, args, context) {
    const { client, BOT_OWNERS } = context;

    // Check if user is owner
    if (!BOT_OWNERS.includes(message.author.id)) {
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});

        const noPermEmbed = colorManager.createEmbed()
            .setDescription(' **هذا الأمر مخصص للاونرز فقط!**');

        if (settings.menuChannel) {
            noPermEmbed.addFields([
                { name: ' روم المنيو', value: `<#${settings.menuChannel}>`, inline: true }
            ]);
        }

        return message.reply({ embeds: [noPermEmbed] });
    }

    // Check if setup is needed
    if (needsSetup()) {
        const setupEmbed = createSetupEmbed(1, {}, client);

        const setupSelect = new StringSelectMenuBuilder()
            .setCustomId('promote_setup_permission')
            .setPlaceholder('اختر نوع المعتمدين...')
            .addOptions([
                {
                    label: 'المالكين فقط',
                    value: 'owners',
                    description: 'السماح للمالكين فقط باستخدام النظام',

                },
                {
                    label: 'رولات محددة',
                    value: 'roles',
                    description: 'السماح لحاملي رولات معينة',

                },
                {
                    label: 'مسؤوليات محددة',
                    value: 'responsibility',
                    description: 'السماح للمسؤولين عن مسؤوليات معينة',
                }
            ]);

        const setupRow = new ActionRowBuilder().addComponents(setupSelect);

        return message.reply({
            embeds: [setupEmbed],
            components: [setupRow],
            content: '**مرحباً بك في إعداد نظام الترقيات!**\n\nيرجى اتباع الخطوات التالية لإكمال الإعداد:'
        });
    }

    // If setup is complete, show admin management menu
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {});

    const adminEmbed = colorManager.createEmbed()
        .setTitle('Promote System Management')
        .setDescription('النظام مُعد ويعمل! يمكنك إدارته من هنا أو استخدام المنيو التفاعلي.')
        .addFields([
            {
                name: 'المنيو التفاعلي',
                value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد',
                inline: true
            },
            {
                name: 'روم السجلات',
                value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد',
                inline: true
            },
            {
                name: 'المعتمدين',
                value: settings.allowedUsers?.type ?
                    `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets?.length || 0})` :
                    'غير محدد',
                inline: true
            }
        ])
        .setThumbnail(client?.user?.displayAvatarURL() || 'https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
        .setTimestamp();

    const quickActionsSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_quick_actions')
        .setPlaceholder('إجراءات سريعة...')
        .addOptions([
            {
                label: 'إعادة إرسال المنيو التفاعلي',
                value: 'resend_menu',
                description: 'إرسال المنيو التفاعلي مرة أخرى للقناة المحددة',

            },
            {
                label: 'تعديل الإعدادات',
                value: 'edit_settings',
                description: 'تعديل إعدادات النظام (المعتمدين، القنوات)',
            },
            {
                label: 'إحصائيات النظام',
                value: 'system_stats',
                description: 'عرض إحصائيات الترقيات والاستخدام',
            }
        ]);

    const actionRow = new ActionRowBuilder().addComponents(quickActionsSelect);

    await message.reply({ embeds: [adminEmbed], components: [actionRow] });
}

async function handleInteraction(interaction, context) {
    try {
        const { client, BOT_OWNERS } = context;

        // Check interaction validity
        if (interaction.replied || interaction.deferred) {
            console.log('تم تجاهل تفاعل متكرر في promote');
            return;
        }

        const customId = interaction.customId;
        console.log(`معالجة تفاعل promote: ${customId}`);

        // Handle setup interactions
        if (customId.startsWith('promote_setup_')) {
            await handleSetupStep(interaction, context);
            return;
        }

        // Handle quick admin actions
        if (customId === 'promote_quick_actions') {
            await handleQuickActions(interaction, context);
            return;
        }

        // Check permissions for main functionality
        const hasPermission = await promoteManager.hasPermission(interaction, BOT_OWNERS);
        if (!hasPermission) {
            return interaction.reply({
                content: ' **ليس لديك صلاحية لاستخدام هذا النظام!**',
                ephemeral: true
            });
        }

        // Handle main menu interactions
        if (customId === 'promote_main_menu') {
            await handleMainMenu(interaction, context);
            return;
        }

        // Handle settings button
        if (customId === 'promote_settings_button') {
            await handleSettingsButton(interaction, context);
            return;
        }

        // Handle other promote interactions
        await handlePromoteInteractions(interaction, context);

    } catch (error) {
        console.error('خطأ في معالجة تفاعل promote:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: ' **حدث خطأ أثناء المعالجة! يرجى المحاولة مرة أخرى.**',
                ephemeral: true
            }).catch(console.error);
        }
    }
}

async function handleSetupStep(interaction, context) {
    const { client, BOT_OWNERS } = context;
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {
        menuChannel: null,
        logChannel: null,
        allowedUsers: { type: null, targets: [] }
    });

    if (interaction.customId === 'promote_setup_permission') {
        const selectedType = interaction.values[0];

        // Ensure allowedUsers object exists
        if (!settings.allowedUsers) {
            settings.allowedUsers = { type: null, targets: [] };
        }

        settings.allowedUsers.type = selectedType;

        if (selectedType === 'owners') {
            // Owners selected - move to next step
            settings.allowedUsers.targets = BOT_OWNERS;
            saveJson(settingsPath, settings);

            const setupEmbed = createSetupEmbed(2, settings, client);

            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('promote_setup_log_channel')
                .setPlaceholder(' اختر روم السجلات...')
                .setChannelTypes([ChannelType.GuildText]);

            const channelRow = new ActionRowBuilder().addComponents(channelSelect);

            await interaction.update({
                embeds: [setupEmbed],
                components: [channelRow]
            });

        } else if (selectedType === 'roles') {
            // Roles selected - show role selector
            settings.allowedUsers.targets = []; // Reset targets for new selection
            saveJson(settingsPath, settings);

            const setupEmbed = createSetupEmbed(1, settings, client);
            setupEmbed.setDescription('اختر الرولات المعتمدة لاستخدام نظام الترقيات');

            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId('promote_setup_select_roles')
                .setPlaceholder(' اختر الرولات المعتمدة...')
                .setMaxValues(10);

            const roleRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.update({
                embeds: [setupEmbed],
                components: [roleRow]
            });

        } else if (selectedType === 'responsibility') {
            // Responsibility selected - show available responsibilities
            settings.allowedUsers.targets = []; // Reset targets for new selection
            const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
            const responsibilities = readJson(responsibilitiesPath, {});

            if (Object.keys(responsibilities).length === 0) {
                const noRespEmbed = colorManager.createEmbed()
                    .setTitle('لا توجد مسؤوليات')
                    .setDescription('لا توجد مسؤوليات معرّفة في النظام!\n\nيرجى استخدام أمر `settings` أولاً لإضافة مسؤوليات.')
                    .addFields([
                        { name: 'نصيحة', value: 'يمكنك اختيار "المالكين فقط" أو "رولات محددة" بدلاً من ذلك', inline: false }
                    ]);

                const backSelect = new StringSelectMenuBuilder()
                    .setCustomId('promote_setup_permission')
                    .setPlaceholder('🔙 اختر خياراً آخر...')
                    .addOptions([
                        {
                            label: 'المالكين فقط',
                            value: 'owners',
                            description: 'السماح للمالكين فقط باستخدام النظام',

                        },
                        {
                            label: 'رولات محددة',
                            value: 'roles',
                            description: 'السماح لحاملي رولات معينة',

                        }
                    ]);

                const backRow = new ActionRowBuilder().addComponents(backSelect);

                await interaction.update({
                    embeds: [noRespEmbed],
                    components: [backRow]
                });
                return;
            }

            // Show responsibility selector
            saveJson(settingsPath, settings);

            const setupEmbed = createSetupEmbed(1, settings, client);
            setupEmbed.setDescription('اختر المسؤوليات المعتمدة لاستخدام نظام الترقيات');

            const respOptions = Object.keys(responsibilities).slice(0, 25).map(name => ({
                label: name,
                value: name,
                description: `السماح للمسؤولين عن ${name}`
            }));

            const respSelect = new StringSelectMenuBuilder()
                .setCustomId('promote_setup_select_responsibilities')
                .setPlaceholder(' اختر المسؤوليات المعتمدة...')
                .setMaxValues(Math.min(respOptions.length, 10))
                .addOptions(respOptions);

            const respRow = new ActionRowBuilder().addComponents(respSelect);

            await interaction.update({
                embeds: [setupEmbed],
                components: [respRow]
            });
        }
        return;
    }

    // Handle role selection for setup
    if (interaction.customId === 'promote_setup_select_roles') {
        settings.allowedUsers.targets = interaction.values;
        saveJson(settingsPath, settings);

        // Move to log channel selection
        const setupEmbed = createSetupEmbed(2, settings, client);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('promote_setup_log_channel')
            .setPlaceholder(' اختر روم السجلات...')
            .setChannelTypes([ChannelType.GuildText]);

        const channelRow = new ActionRowBuilder().addComponents(channelSelect);

        await interaction.update({
            embeds: [setupEmbed],
            components: [channelRow]
        });
        return;
    }

    // Handle responsibility selection for setup
    if (interaction.customId === 'promote_setup_select_responsibilities') {
        settings.allowedUsers.targets = interaction.values;
        saveJson(settingsPath, settings);

        // Move to log channel selection
        const setupEmbed = createSetupEmbed(2, settings, client);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('promote_setup_log_channel')
            .setPlaceholder(' اختر روم السجلات...')
            .setChannelTypes([ChannelType.GuildText]);

        const channelRow = new ActionRowBuilder().addComponents(channelSelect);

        await interaction.update({
            embeds: [setupEmbed],
            components: [channelRow]
        });
        return;
    }

    // Handle log channel selection
    if (interaction.customId === 'promote_setup_log_channel') {
        const logChannelId = interaction.values[0];
        settings.logChannel = logChannelId;
        saveJson(settingsPath, settings);

        // Move to menu channel selection
        const setupEmbed = createSetupEmbed(3, settings, client);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('promote_setup_menu_channel')
            .setPlaceholder(' اختر روم المنيو التفاعلي...')
            .setChannelTypes([ChannelType.GuildText]);

        const channelRow = new ActionRowBuilder().addComponents(channelSelect);

        await interaction.update({
            embeds: [setupEmbed],
            components: [channelRow]
        });
        return;
    }

    // Handle menu channel selection - final step
    if (interaction.customId === 'promote_setup_menu_channel') {
        try {
            console.log('📋 بدء معالجة اختيار قناة المنيو...');

            const menuChannelId = interaction.values[0];
            settings.menuChannel = menuChannelId;

            console.log(`📋 حفظ قناة المنيو الجديدة: ${menuChannelId}`);
            const saveResult = saveJson(settingsPath, settings);

            if (!saveResult) {
                console.error('❌ فشل في حفظ الإعدادات');
                return interaction.reply({
                    content: '❌ **فشل في حفظ الإعدادات! يرجى المحاولة مرة أخرى.**',
                    ephemeral: true
                });
            }

            // إرسال رسالة تأكيد أولاً
            console.log('📋 إرسال رسالة التأكيد...');
            await interaction.reply({
                content: '⏳ **جاري إكمال الإعداد وإنشاء المنيو التفاعلي...**',
                ephemeral: true
            });

            // تأخير قصير للتأكد من معالجة الرد
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Setup complete - create permanent menu
            console.log('📋 إنشاء المنيو الدائم...');
            const success = await createPermanentMenu(client, menuChannelId);

            const completeEmbed = colorManager.createEmbed()
                .setTitle('Setup Complete Successfully')
                .setDescription('تم إكمال إعداد نظام الترقيات بنجاح!')
                .addFields([
                    { name: '✅ المعتمدين', value: `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets?.length || 0})`, inline: true },
                    { name: '✅ روم السجلات', value: `<#${settings.logChannel}>`, inline: true },
                    { name: '✅ روم المنيو', value: `<#${settings.menuChannel}>`, inline: true }
                ])
                .setThumbnail(client?.user?.displayAvatarURL())
                .setTimestamp();

            if (success) {
                completeEmbed.addFields([
                    { name: 'الحالة', value: 'النظام جاهز للاستخدام! تم إرسال المنيو التفاعلي للروم المحددة.', inline: false }
                ]);
                console.log('✅ تم إنشاء المنيو الدائم بنجاح');
            } else {
                completeEmbed.addFields([
                    { name: ' تحذير', value: 'تم الإعداد ولكن فشل في إرسال المنيو. يمكنك استخدام "إعادة إرسال المنيو" من الإعدادات.', inline: false }
                ]);
                console.log('⚠️ فشل في إنشاء المنيو الدائم');
            }

            // تحديث الرسالة بالنتيجة النهائية
            await interaction.editReply({
                content: success ? '✅ **تم إكمال الإعداد بنجاح!**' : '⚠️ **تم الإعداد مع تحذيرات**',
                embeds: [completeEmbed]
            });

            console.log('📋 تم إكمال معالجة اختيار قناة المنيو');
        } catch (error) {
            console.error('❌ خطأ في معالجة اختيار قناة المنيو:', error);

            try {
                if (interaction.replied) {
                    await interaction.editReply({
                        content: '❌ **حدث خطأ أثناء إكمال الإعداد! يرجى المحاولة مرة أخرى.**'
                    });
                } else {
                    await interaction.reply({
                        content: '❌ **حدث خطأ أثناء إكمال الإعداد! يرجى المحاولة مرة أخرى.**',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('❌ خطأ في الرد على خطأ اختيار قناة المنيو:', replyError);
            }
        }
        return;
    }
}

async function handleQuickActions(interaction, context) {
    const selectedAction = interaction.values[0];

    switch (selectedAction) {
        case 'resend_menu':
            await handleResendMenu(interaction, context);
            break;
        case 'edit_settings':
            await handleEditSettings(interaction, context);
            break;
        case 'system_stats':
            await handleSystemStats(interaction, context);
            break;
    }
}

async function handleResendMenu(interaction, context) {
    try {
        console.log('🔄 بدء معالجة إعادة إرسال المنيو...');

        const { client } = context;
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});

        if (!settings.menuChannel) {
            console.log('⚠️ قناة المنيو غير محددة');
            await interaction.reply({
                content: '⚠️ **لم يتم تحديد روم المنيو! يرجى تعديل الإعدادات أولاً.**',
                ephemeral: true
            });
            return;
        }

        // التحقق من وجود القناة
        let targetChannel;
        try {
            targetChannel = await client.channels.fetch(settings.menuChannel);
            if (!targetChannel) {
                throw new Error('الروم غير موجودة');
            }
        } catch (channelError) {
            console.error('❌ خطأ في العثور على القناة:', channelError);
            await interaction.reply({
                content: '❌ **الروم المحددة للمنيو غير موجودة أو لا يمكن الوصول إليها!**',
                ephemeral: true
            });
            return;
        }

        // إرسال رسالة تأكيد أولاً
        console.log('🔄 إرسال رسالة التأكيد...');
        await interaction.reply({
            content: '⏳ **جاري إعادة إرسال المنيو التفاعلي...**',
            ephemeral: true
        });

        // تأخير قصير للتأكد من معالجة الرد
        await new Promise(resolve => setTimeout(resolve, 500));

        // حذف الرسالة القديمة إذا كانت موجودة
        if (settings.menuMessageId) {
            try {
                console.log('🗑️ محاولة حذف الرسالة القديمة...');
                const oldMessage = await targetChannel.messages.fetch(settings.menuMessageId);
                if (oldMessage) {
                    await oldMessage.delete();
                    console.log('✅ تم حذف الرسالة القديمة');
                }
            } catch (deleteError) {
                console.log('⚠️ لم يتم العثور على الرسالة القديمة أو تم حذفها مسبقاً');
            }

            // تنظيف معرف الرسالة القديمة
            settings.menuMessageId = null;
            saveJson(settingsPath, settings);
        }

        // تأخير إضافي بين حذف الرسالة القديمة وإنشاء الجديدة
        await new Promise(resolve => setTimeout(resolve, 1000));

        // إنشاء المنيو الجديد
        console.log('🔄 إنشاء المنيو الجديد...');
        const success = await createPermanentMenu(client, settings.menuChannel);

        if (success) {
            console.log('✅ تم إعادة إرسال المنيو بنجاح');
            await interaction.editReply({
                content: '✅ **تم إعادة إرسال المنيو التفاعلي بنجاح!**\n\n' +
                        `**الروم :** <#${settings.menuChannel}>\n` +
                        ` **الوقت :** <t:${Math.floor(Date.now() / 1000)}:F>`
            });
        } else {
            console.log('❌ فشل في إعادة إرسال المنيو');
            await interaction.editReply({
                content: '❌ **فشل في إعادة إرسال المنيو!**\n\n' +
                        '**الأسباب المحتملة:**\n' +
                        '• عدم وجود صلاحيات كافية للبوت في الروم\n' +
                        '• الروم محذوفة أو غير متاحة\n' +
                        '• خطأ في الاتصال\n\n' +
                        '**يرجى التحقق من الصلاحيات والمحاولة مرة أخرى.**'
            });
        }

        console.log('🔄 تم إكمال معالجة إعادة إرسال المنيو');

    } catch (error) {
        console.error('❌ خطأ في معالجة إعادة إرسال المنيو:', error);

        try {
            if (interaction.replied) {
                await interaction.editReply({
                    content: '❌ **حدث خطأ أثناء إعادة إرسال المنيو!**\n\n' +
                            `**تفاصيل الخطأ:** ${error.message || 'خطأ غير معروف'}\n\n` +
                            '**يرجى المحاولة مرة أخرى أو الاتصال بالدعم.**'
                });
            } else {
                await interaction.reply({
                    content: '❌ **حدث خطأ أثناء إعادة إرسال المنيو! يرجى المحاولة مرة أخرى.**',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('❌ خطأ في الرد على خطأ إعادة إرسال المنيو:', replyError);
        }
    }
}

async function handleSystemStats(interaction, context) {
    // Create quick stats or detailed stats menu
    const statsSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_stats_menu')
        .setPlaceholder('اختر نوع الإحصائيات...')
        .addOptions([
            {
                label: 'إحصائيات سريعة',
                value: 'quick_stats',
                description: 'عرض نظرة عامة سريعة على النظام'
            },
            {
                label: 'إحصائيات مفصلة',
                value: 'detailed_stats',
                description: 'عرض إحصائيات شاملة ومفصلة'
            },
            {
                label: 'إعادة تعيين النظام',
                value: 'reset_system',
                description: 'إعادة تعيين جميع البيانات والإعدادات'
            }
        ]);

    const statsRow = new ActionRowBuilder().addComponents(statsSelect);

    await interaction.reply({
        content: ' **اختر نوع الإحصائيات المطلوبة:**',
        components: [statsRow],
        ephemeral: true
    });
}

async function createSystemStats() {
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {});
    const activePromotesPath = path.join(__dirname, '..', 'data', 'activePromotes.json');
    const activePromotes = readJson(activePromotesPath, {});
    const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
    const promoteLogs = readJson(promoteLogsPath, []);

    const totalActivePromotes = Object.keys(activePromotes).length;
    const totalPromoteLogs = promoteLogs.length;

    const embed = colorManager.createEmbed()
        .setTitle('Promote System Statistics')
        .setDescription('إحصائيات شاملة عن نظام الترقيات')
        .addFields([
            { name: ' الترقيات النشطة', value: totalActivePromotes.toString(), inline: true },
            { name: ' إجمالي السجلات', value: totalPromoteLogs.toString(), inline: true },
            { name: ' المعتمدين', value: settings.allowedUsers?.type ? `${getPermissionTypeText(settings.allowedUsers.type)}` : 'غير محدد', inline: true },
            { name: ' روم السجلات', value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', inline: true },
            { name: ' روم المنيو', value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', inline: true },
            { name: ' حالة النظام', value: needsSetup() ? 'يحتاج إعداد' : 'جاهز', inline: true }
        ])
        .setTimestamp();

    return embed;
}

async function handleMainMenu(interaction, context) {
    const selectedOption = interaction.values[0];

    switch (selectedOption) {
        case 'promote_user_or_role':
            await handlePromoteUserOrRole(interaction, context);
            break;
        case 'promotion_records':
            await handlePromotionRecords(interaction, context);
            break;
        case 'ban_from_promotion':
            await handleBanFromPromotion(interaction, context);
            break;
        case 'unban_promotion':
            await handleUnbanPromotion(interaction, context);
            break;
        case 'check_admin_activity':
            await handleCheckAdminActivity(interaction, context);
            break;
    }
}

async function handlePromoteUserOrRole(interaction, context) {
    // Check bot permissions first
    const hasPermissions = await checkPromotionPermissions(interaction);
    if (!hasPermissions) return;
    
    // Validate user permissions
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has('ManageRoles')) {
        const embed = colorManager.createEmbed()
            .setTitle('❌ صلاحيات غير كافية')
            .setDescription('تحتاج صلاحية ManageRoles للقيام بالترقيات')
            .setColor(0xff0000)
            .setTimestamp();
            
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
        return;
    }
    
    // إنشاء قائمة خيارات للترقية
    const optionSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_user_or_role_option')
        .setPlaceholder('اختر طريقة الترقية...')
        .addOptions([
            {
                label: 'ترقية شخص محدد',
                value: 'promote_specific_user',
                description: 'ترقية عضو معين إلى رول إداري'
            },
            {
                label: 'ترقية من رول محدد',
                value: 'promote_from_role',
                description: 'ترقية جميع أعضاء رول معين إلى رول أعلى'
            }
        ]);

    const optionRow = new ActionRowBuilder().addComponents(optionSelect);

    await interaction.reply({
        content: ' **اختر طريقة الترقية المطلوبة:**',
        components: [optionRow],
        ephemeral: true
    });
}

async function handlePromotionRecords(interaction, context) {
    // إنشاء قائمة خيارات لسجلات الترقيات
    const optionSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_records_option')
        .setPlaceholder('اختر نوع السجلات...')
        .addOptions([
            {
                label: 'سجل شخص محدد',
                value: 'records_specific_user',
                description: 'عرض سجلات ترقيات عضو معين'
            },
            {
                label: 'سجل رول محدد',
                value: 'records_specific_role',
                description: 'عرض سجلات جميع ترقيات رول معين'
            }
        ]);

    const optionRow = new ActionRowBuilder().addComponents(optionSelect);

    await interaction.reply({
        content: ' **اختر نوع السجلات المطلوب عرضها:**',
        components: [optionRow],
        ephemeral: true
    });
}

async function handleBanFromPromotion(interaction, context) {
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('promote_ban_select_user')
        .setPlaceholder(' اختر العضو لحظره من الترقيات...')
        .setMaxValues(1);

    const userRow = new ActionRowBuilder().addComponents(userSelect);

    await interaction.reply({
        content: ' **اختر العضو لحظره من الترقيات:**',
        components: [userRow],
        ephemeral: true
    });
}

async function handleUnbanPromotion(interaction, context) {
    // Get banned users that this moderator can unban
    const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
    const promoteBans = readJson(promoteBansPath, {});
    const { BOT_OWNERS } = context;

    // Filter bans: owners can unban anyone, others only their own bans
    const eligibleBans = [];
    for (const [banKey, banData] of Object.entries(promoteBans)) {
        const [userId, guildId] = banKey.split('_');

        // Skip if different guild
        if (guildId !== interaction.guild.id) continue;

        // Skip if ban has expired
        if (banData.endTime && banData.endTime <= Date.now()) continue;

        // Check permissions: owners can unban anyone, others only their own bans
        if (BOT_OWNERS.includes(interaction.user.id) || banData.byUserId === interaction.user.id) {
            eligibleBans.push({
                userId: userId,
                banKey: banKey,
                ...banData
            });
        }
    }

    if (eligibleBans.length === 0) {
        const noEligibleEmbed = colorManager.createEmbed()
            .setDescription('**لا يوجد أعضاء محظورين مؤهلين لفك الحظر عنهم.**\n\n' +
                           '**يمكنك فك الحظر عن:**\n' +
                           '• الأعضاء الذين قمت بحظرهم بنفسك\n' +
                           (BOT_OWNERS.includes(interaction.user.id) ? '• جميع الأعضاء المحظورين (كونك مالك)' : ''));

        await interaction.reply({
            embeds: [noEligibleEmbed],
            ephemeral: true
        });
        return;
    }

    // Create user options with ban details
    const userOptions = await Promise.all(eligibleBans.slice(0, 25).map(async (ban) => {
        try {
            const member = await interaction.guild.members.fetch(ban.userId);
            const banEndText = ban.endTime ? 
                `ينتهي <t:${Math.floor(ban.endTime / 1000)}:R>` : 
                'نهائي';

            return {
                label: member.displayName,
                value: ban.userId,
                description: `محظور ${banEndText} - بواسطة <@${ban.byUserId}>`
            };
        } catch (error) {
            return {
                label: `مستخدم غير موجود (${ban.userId})`,
                value: ban.userId,
                description: `محظور ${ban.endTime ? 'مؤقت' : 'نهائي'} - بواسطة <@${ban.byUserId}>`
            };
        }
    }));

    const userSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_unban_select_user_eligible')
        .setPlaceholder('اختر العضو المحظور لفك الحظر عنه...')
        .addOptions(userOptions.filter(Boolean));

    const userRow = new ActionRowBuilder().addComponents(userSelect);

    const eligibleEmbed = colorManager.createEmbed()
        .setTitle('Eligible Banned Users')
        .setDescription(`**الأعضاء المحظورين المؤهلين لفك الحظر عنهم:** **${eligibleBans.length}** عضو\n\n` +
                       'يمكنك فك الحظر عن الأعضاء الذين تم حظرهم بواسطتك أو كونك مالك.')
        .addFields([
            { name: ' إجمالي المحظورين', value: Object.keys(promoteBans).length.toString(), inline: true },
            { name: ' مؤهلين لك', value: eligibleBans.length.toString(), inline: true },
            { name: ' الصلاحية', value: BOT_OWNERS.includes(interaction.user.id) ? 'مالك (الكل)' : 'محدودة', inline: true }]);

    await interaction.reply({
        embeds: [eligibleEmbed],
        components: [userRow],
        ephemeral: true
    });
}

async function handleCheckAdminActivity(interaction, context) {
    // إنشاء قائمة خيارات لفحص التفاعل
    const optionSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_activity_option')
        .setPlaceholder('اختر نوع الفحص...')
        .addOptions([
            {
                label: 'فحص شخص محدد',
                value: 'activity_specific_user',
                description: 'فحص إحصائيات تفاعل عضو معين'
            },
            {
                label: 'فحص رول محدد',
                value: 'activity_specific_role',
                description: 'فحص إحصائيات تفاعل جميع أعضاء رول معين'
            }
        ]);

    const optionRow = new ActionRowBuilder().addComponents(optionSelect);

    await interaction.reply({
        content: ' **اختر نوع فحص التفاعل المطلوب:**',
        components: [optionRow],
        ephemeral: true
    });
}

async function handleSettingsButton(interaction, context) {
    const settingsEmbed = colorManager.createEmbed()
        .setTitle('Promote System Settings')
        .setDescription('إدارة إعدادات نظام الترقيات')
        .addFields([
            { name: ' تعديل الإعدادات', value: 'تغيير المعتمدين، الرومات، أو إعدادات أخرى', inline: false },
            { name: ' إعادة إرسال المنيو', value: 'إعادة إرسال المنيو التفاعلي للروم المحددة', inline: false },
            { name: ' إحصائيات النظام', value: 'عرض إحصائيات شاملة عن الاستخدام', inline: false }
        ]);

    const settingsSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_settings_menu')
        .setPlaceholder('اختر الإعداد المطلوب...')
        .addOptions([
            {
                label: 'تعديل المعتمدين',
                value: 'edit_permissions',
                description: 'تغيير من يحق له استخدام النظام'
            },
            {
                label: 'تعديل روم السجلات',
                value: 'edit_log_channel',
                description: 'تغيير قناة حفظ سجلات الترقيات'
            },
            {
                label: 'تعديل الروم المنيو',
                value: 'edit_menu_channel',
                description: 'تغيير قناة المنيو التفاعلي'
            },
            {
                label: 'إعادة إرسال المنيو',
                value: 'resend_menu',
                description: 'إعادة إرسال المنيو التفاعلي'
            },
            {
                label: 'إحصائيات مفصلة',
                value: 'detailed_stats',
                description: 'عرض إحصائيات شاملة عن النظام'
            },
            {
                label: 'إعادة تعيين النظام',
                value: 'reset_system',
                description: 'حذف جميع البيانات والإعدادات'
            }
        ]);

    const settingsRow = new ActionRowBuilder().addComponents(settingsSelect);

    await interaction.reply({
        embeds: [settingsEmbed],
        components: [settingsRow],
        ephemeral: true
    });
}

async function handlePromoteInteractions(interaction, context) {
    const customId = interaction.customId;

    // Handle main menu selection
    if (interaction.isStringSelectMenu() && customId === 'promote_main_menu') {
        await handleMainMenu(interaction, context);
        return;
    }

    // Handle settings menu
    if (interaction.isStringSelectMenu() && customId === 'promote_settings_menu') {
        const selectedOption = interaction.values[0];
        switch (selectedOption) {
            case 'edit_permissions':
                await handleEditPermissions(interaction, context);
                break;
            case 'edit_log_channel':
                await handleEditLogChannel(interaction, context);
                break;
            case 'edit_menu_channel':
                await handleEditMenuChannel(interaction, context);
                break;
            case 'resend_menu':
                await handleResendMenu(interaction, context);
                break;
            case 'detailed_stats':
                await handleDetailedStats(interaction, context);
                break;
            case 'reset_system':
                await handleResetSystem(interaction, context);
                break;
        }
        return;
    }

    // Handle stats menu
    if (interaction.isStringSelectMenu() && customId === 'promote_stats_menu') {
        const selectedOption = interaction.values[0];
        switch (selectedOption) {
            case 'quick_stats':
                const quickStats = await createSystemStats();
                await interaction.update({
                    embeds: [quickStats],
                    components: []
                });
                break;
            case 'detailed_stats':
                await handleDetailedStats(interaction, context);
                break;
            case 'reset_system':
                await handleResetSystem(interaction, context);
                break;
        }
        return;
    }

    // Handle promote user or role option selection
    if (interaction.isStringSelectMenu() && customId === 'promote_user_or_role_option') {
        const selectedOption = interaction.values[0];

        if (selectedOption === 'promote_specific_user') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('promote_select_user')
                .setPlaceholder(' اختر العضو للترقية...')
                .setMaxValues(1);

            const userRow = new ActionRowBuilder().addComponents(userSelect);

            await interaction.update({
                content: ' **اختر العضو الذي تريد ترقيته:**',
                components: [userRow]
            });
        } else if (selectedOption === 'promote_from_role') {
            const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
            const adminRoles = readJson(adminRolesPath, []);

            if (adminRoles.length === 0) {
                await interaction.update({
                    content: '⚠️ **لا توجد رولات إدارية محددة! يرجى إضافة رولات إدارية أولاً.**',
                    components: []
                });
                return;
            }

            const availableRoles = adminRoles.map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return role ? {
                    label: role.name,
                    value: roleId,
                    description: `ترقية جميع أعضاء ${role.name}`
                } : null;
            }).filter(Boolean).slice(0, 25);

            const roleSelect = new StringSelectMenuBuilder()
                .setCustomId('promote_select_source_role')
                .setPlaceholder('اختر الرول الذي تريد ترقية أعضائه...')
                .addOptions(availableRoles);

            const roleRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.update({
                content: ' **اختر الرول الذي تريد ترقية أعضائه:**',
                components: [roleRow]
            });
        }
        return;
    }

    // Handle source role selection for bulk promotion
    if (interaction.isStringSelectMenu() && customId === 'promote_select_source_role') {
        const sourceRoleId = interaction.values[0];
        const sourceRole = interaction.guild.roles.cache.get(sourceRoleId);

        if (!sourceRole) {
            await interaction.update({
                content: ' **لم يتم العثور على الرول المصدر!**',
                components: []
            });
            return;
        }

        // Get members with this role and show stats
        const membersWithRole = sourceRole.members;

        console.log(`فحص الرول ${sourceRole.name}: يحتوي على ${membersWithRole.size} عضو`);

        if (membersWithRole.size === 0) {
            console.log(`الرول ${sourceRole.name} لا يحتوي على أعضاء`);
            await interaction.update({
                content: ` **الرول** <@&${sourceRoleId}> **لا يحتوي على أي أعضاء!**`,
                components: []
            });
            return;
        }

        // Get target role for checking if members already have it
        const targetRoleId = interaction.customId.split('_')[4]; // This will be set later, for now we'll get it from the next step

        // Get database stats for all members
        const database = context.database;
        let statsText = '';
        let validMembers = 0;
        let excludedMembers = [];

        // Check bans and collect stats
        const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
        const promoteBans = readJson(promoteBansPath, {});
        let bannedMembers = [];
        let membersWithTargetRole = [];

        console.log(`بدء فحص ${membersWithRole.size} عضو في الرول ${sourceRole.name}`);

        for (const [userId, member] of membersWithRole) {
            const banKey = `${userId}_${interaction.guild.id}`;

            console.log(`فحص العضو: ${member.displayName} (${userId})`);

            // تجاهل البوتات
            if (member.user.bot) {
                excludedMembers.push({
                    name: member.displayName,
                    reason: 'بوت'
                });
                console.log(`العضو ${member.displayName} بوت - تم تجاهله`);
                continue;
            }

            // Check if banned from promotions
            if (promoteBans[banKey]) {
                const banData = promoteBans[banKey];
                const banEndTime = banData.endTime;

                if (!banEndTime || banEndTime > Date.now()) {
                    bannedMembers.push(`<@${userId}>`);
                    excludedMembers.push({
                        name: member.displayName,
                        reason: 'محظور من الترقيات'
                    });
                    console.log(`العضو ${member.displayName} محظور من الترقيات`);
                    continue;
                }
            }

            // Get stats from database with better error handling
            const databaseModule = require('../utils/database');
            let database = null;
            try {
                database = databaseModule.getDatabase();
            } catch (error) {
                console.log(`قاعدة البيانات غير متاحة للعضو ${member.displayName}`);
            }

            let memberIsValid = true;

            if (database) {
                try {
                    const userStats = await database.get(
                        'SELECT total_voice_time, total_messages, total_voice_joins FROM user_totals WHERE user_id = ?',
                        [userId]
                    );

                    const voiceMinutes = userStats ? Math.floor(userStats.total_voice_time / 60000) : 0;
                    const messages = userStats ? userStats.total_messages : 0;
                    const voiceJoins = userStats ? userStats.total_voice_joins : 0;

                    // Get member join date
                    const joinedDate = member.joinedTimestamp ? 
                        `<t:${Math.floor(member.joinedTimestamp / 1000)}:d>` : 'غير معروف';

                    // تنسيق منظم للمعلومات
                    statsText += `**${member.displayName}** <@${userId}>\n`;
                    statsText += `├─ 📅 **انضم :** ${joinedDate}\n`;
                    statsText += `├─ 💬 **الرسائل :** ${messages.toLocaleString()}\n`;
                    statsText += `├─ 🎤 **الوقت بالفويسات :** ${voiceMinutes.toLocaleString()} دقيقة\n`;
                    statsText += `└─ 🔗 **انضمام فويس :** ${voiceJoins.toLocaleString()}\n\n`;

                } catch (dbError) {
                    console.error(`خطأ في قراءة إحصائيات العضو ${userId}:`, dbError);
                    // لا نستبعد العضو بسبب خطأ في قاعدة البيانات، بل نعرض بيانات أساسية
                    const joinedDate = member.joinedTimestamp ? 
                        `<t:${Math.floor(member.joinedTimestamp / 1000)}:d>` : 'غير معروف';

                    statsText += `**${member.displayName}** <@${userId}>\n`;
                    statsText += `├─ 📅 **انضم :** ${joinedDate}\n`;
                    statsText += `└─ ⚠️ خطأ في قراءة البيانات (سيتم المتابعة)\n\n`;
                }
            } else {
                // قاعدة البيانات غير متاحة - نعرض بيانات أساسية
                const joinedDate = member.joinedTimestamp ? 
                    `<t:${Math.floor(member.joinedTimestamp / 1000)}:d>` : 'غير معروف';

                statsText += `**${member.displayName}** <@${userId}>\n`;
                statsText += `├─ 📅 **انضم :** ${joinedDate}\n`;
                statsText += `└─ ⚠️ بيانات غير متاحة\n\n`;
            }

            if (memberIsValid) {
                validMembers++;
                console.log(`العضو ${member.displayName} مؤهل للترقية`);
            }
        }

        console.log(`تم فحص جميع الأعضاء: ${validMembers} مؤهل، ${bannedMembers.length} محظور، ${excludedMembers.length} مستبعد`);

        // Create embed with stats
        const statsEmbed = colorManager.createEmbed()
            .setTitle('Bulk Promotion Preview')
            .setDescription(`**معاينة ترقية أعضاء الرول** <@&${sourceRoleId}>\n\n**الأعضاء المؤهلين للترقية:**\n${statsText}`)
            .addFields([
                { name: ' إجمالي الأعضاء', value: membersWithRole.size.toString(), inline: true },
                { name: ' مؤهلين للترقية', value: validMembers.toString(), inline: true },
                { name: ' مستبعدين', value: (excludedMembers.length + bannedMembers.length).toString(), inline: true }
            ]);

        // إضافة تفاصيل الأعضاء المستبعدين
        if (excludedMembers.length > 0 || bannedMembers.length > 0) {
            let excludedText = '';

            // الأعضاء المحظورين
            if (bannedMembers.length > 0) {
                excludedText += `**محظورين من الترقيات (${bannedMembers.length}):**\n`;
                excludedText += bannedMembers.slice(0, 5).join(', ');
                if (bannedMembers.length > 5) excludedText += `\n*+${bannedMembers.length - 5} محظور إضافي*`;
                excludedText += '\n\n';
            }

            // الأعضاء المستبعدين لأسباب أخرى
            if (excludedMembers.length > 0) {
                excludedText += `**مستبعدين لأسباب أخرى (${excludedMembers.length}):**\n`;
                const otherExcluded = excludedMembers.slice(0, 5);
                for (const excluded of otherExcluded) {
                    excludedText += `• ${excluded.name} - ${excluded.reason}\n`;
                }
                if (excludedMembers.length > 5) {
                    excludedText += `*+${excludedMembers.length - 5} مستبعد إضافي*\n`;
                }
            }

            if (excludedText) {
                statsEmbed.addFields([
                    { name: ' الأعضاء المستبعدين', value: excludedText.trim(), inline: false }
                ]);
            }
        }

        if (validMembers === 0) {
            statsEmbed.addFields([
                { name: '⚠️ **ملاحظة مهمة**', value: 'لا يوجد أعضاء مؤهلين للترقية! جميع الأعضاء إما محظورين أو لديهم مشاكل في البيانات', inline: false }
            ]);
            await interaction.update({
                embeds: [statsEmbed],
                content: ' **لا يوجد أعضاء مؤهلين للترقية!**',
                components: []
            });
            return;
        }

        // إضافة ملاحظة توضيحية إذا كان هناك أعضاء مستبعدين
        if (excludedMembers.length > 0 || bannedMembers.length > 0) {
            statsEmbed.addFields([
                { name: '📋 **ملاحظة**', value: `يتم عرض ${validMembers} من أصل ${membersWithRole.size} عضو. الباقي مستبعد للأسباب المذكورة أعلاه.`, inline: false }
            ]);
        }

        // Show admin roles for selection - only higher roles
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        const adminRoles = readJson(adminRolesPath, []);
        const currentSourceRole = interaction.guild.roles.cache.get(sourceRoleId);

        const availableTargetRoles = adminRoles.filter(roleId => {
            if (roleId === sourceRoleId) return false; // استبعاد نفس الرول
            const targetRole = interaction.guild.roles.cache.get(roleId);
            // إظهار الرولات الأعلى فقط (position أكبر)
            return targetRole && currentSourceRole && targetRole.position > currentSourceRole.position;
        }).map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? {
                label: role.name,
                value: `${sourceRoleId}_${roleId}`,
                description: `ترقية إلى ${role.name} (موضع أعلى)`
            } : null;
        }).filter(Boolean).slice(0, 25);

        if (availableTargetRoles.length === 0) {
            await interaction.update({
                embeds: [statsEmbed],
                content: ' **لا توجد رولات متاحة للترقية إليها!**',
                components: []
            });
            return;
        }

        const targetRoleSelect = new StringSelectMenuBuilder()
            .setCustomId('promote_bulk_role_target')
            .setPlaceholder('اختر الرول المستهدف للترقية...')
            .addOptions(availableTargetRoles);

        const targetRoleRow = new ActionRowBuilder().addComponents(targetRoleSelect);

        await interaction.update({
            embeds: [statsEmbed],
            content: ' **اختر الرول المستهدف لترقية الأعضاء إليه:**',
            components: [targetRoleRow]
        });
        return;
    }

    // Handle bulk promotion target role selection
    if (interaction.isStringSelectMenu() && customId === 'promote_bulk_role_target') {
        const [sourceRoleId, targetRoleId] = interaction.values[0].split('_');

        // التحقق من هرمية الرولات قبل إظهار النموذج
        const sourceRole = interaction.guild.roles.cache.get(sourceRoleId);
        const targetRole = interaction.guild.roles.cache.get(targetRoleId);

        if (!sourceRole || !targetRole) {
            await interaction.reply({
                content: '❌ **لم يتم العثور على أحد الرولات!**',
                ephemeral: true
            });
            return;
        }

        // فحص أن الرول المستهدف أعلى من الرول المصدر
        if (targetRole.position <= sourceRole.position) {
            await interaction.reply({
                content: `❌ **الرول المستهدف (${targetRole.name}) يجب أن يكون أعلى من الرول المصدر (${sourceRole.name})**`,
                ephemeral: true
            });
            return;
        }

        // فحص أن الرول المستهدف أقل من رول المُرقي
        const promoterMember = await interaction.guild.members.fetch(interaction.user.id);
        const promoterHighestRole = promoterMember.roles.highest;

        // تحسين منطق التحقق: إذا كان الشخص المعين مالك البوت، يُسمح بالترقية بغض النظر عن الهرمية
        const settings = promoteManager.getSettings();
        const botOwnersData = readJson(path.join(__dirname, '..', 'data', 'botConfig.json'), {});
        const botOwners = botOwnersData.owners || [];

        if (!botOwners.includes(interaction.user.id)) {
            if (targetRole.position >= promoterHighestRole.position) {
                await interaction.reply({
                    content: `❌ **لا يمكنك ترقية أعضاء إلى رول (${targetRole.name}) أعلى من أو مساوي لرولك الأعلى (${promoterHighestRole.name})**`,
                    ephemeral: true
                });
                return;
            }
        }

        // Create modal for duration and reason
        const modal = new ModalBuilder()
            .setCustomId(`promote_bulk_modal_${sourceRoleId}_${targetRoleId}`)
            .setTitle('تفاصيل الترقية الجماعية');

        const durationInput = new TextInputBuilder()
            .setCustomId('promote_duration')
            .setLabel('المدة (مثل: 7d أو 12h أو نهائي)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('7d, 12h, 30m, نهائي');

        const reasonInput = new TextInputBuilder()
            .setCustomId('promote_reason')
            .setLabel('السبب')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('اذكر سبب الترقية الجماعية...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Handle user selection for promotion
    if (interaction.isUserSelectMenu() && customId === 'promote_select_user') {
        const selectedUserId = interaction.values[0];
        
        // Validate user input first
        const validation = validatePromotionInput(selectedUserId);
        if (!validation.isValid) {
            const embed = colorManager.createEmbed()
                .setTitle('❌ بيانات غير صالحة')
                .setDescription(validation.errors.join('\n'))
                .setColor(0xff0000)
                .setTimestamp();
                
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            return;
        }
        
        const member = await interaction.guild.members.fetch(selectedUserId);

        // Check if user is banned from promotions
        const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
        const promoteBans = readJson(promoteBansPath, {});
        const banKey = `${selectedUserId}_${interaction.guild.id}`;

        if (promoteBans[banKey]) {
            const banData = promoteBans[banKey];
            const banEndTime = banData.endTime;

            if (!banEndTime || banEndTime > Date.now()) {
                const banEndText = banEndTime ? 
                    `<t:${Math.floor(banEndTime / 1000)}:R>` : 
                    'نهائي';
                await interaction.reply({
                    content: ` **العضو** <@${selectedUserId}> **محظور من الترقيات.**\n**ينتهي الحظر:** ${banEndText}`,
                    ephemeral: true
                });
                return;
            }
        }

        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        const adminRoles = readJson(adminRolesPath, []);

        if (adminRoles.length === 0) {
            await interaction.reply({
                content: '⚠️ **لا توجد رولات إدارية محددة! يرجى إضافة رولات إدارية أولاً.**',
                ephemeral: true
            });
            return;
        }

        // Check if member has multiple admin roles to support multiple selection
        const memberAdminRoles = member.roles.cache.filter(role => adminRoles.includes(role.id));
        const memberHighestRole = member.roles.highest;

        // Filter admin roles that user doesn't already have and show higher roles only
        const availableRoles = adminRoles.filter(roleId => {
            if (member.roles.cache.has(roleId)) return false; // العضو يملكه بالفعل
            const targetRole = interaction.guild.roles.cache.get(roleId);
            // إظهار الرولات الأعلى من أعلى رول للعضو فقط
            return targetRole && targetRole.position > memberHighestRole.position;
        }).map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? {
                label: role.name,
                value: roleId,
                description: `ترقية إلى ${role.name} (أعلى من رولك الحالي)`
            } : null;
        }).filter(Boolean).slice(0, 25);

        if (availableRoles.length === 0) {
            await interaction.reply({
                content: ` **العضو** <@${selectedUserId}> **يملك جميع الرولات الإدارية المتاحة!**`,
                ephemeral: true
            });
            return;
        }

        // تحسين النظام لدعم الاختيار المتعدد
        const maxSelections = Math.min(availableRoles.length, 10); // الحد الأقصى 10 رولات
        const hasMultipleOptions = availableRoles.length > 1;

        const roleSelect = new StringSelectMenuBuilder()
            .setCustomId(`promote_role_${selectedUserId}`)
            .setPlaceholder(hasMultipleOptions ? 'اختر الرول/الرولات للترقية (يمكن اختيار متعدد)...' : 'اختر الرول للترقية...')
            .setMinValues(1)
            .setMaxValues(maxSelections)
            .addOptions(availableRoles);

        const roleRow = new ActionRowBuilder().addComponents(roleSelect);

        const embedContent = colorManager.createEmbed()
            .setTitle('🎯 اختيار رولات الترقية')
            .setDescription(`**العضو المختار:** <@${selectedUserId}>\n\n` +
                          `✅ **رولات متاحة للترقية:** ${availableRoles.length}\n` +
                          `🎮 **اختيار متعدد:** ${hasMultipleOptions ? 'متاح' : 'غير متاح'}\n\n` +
                          `${hasMultipleOptions ? 
                              '**يمكنك اختيار رول واحد أو عدة رولات للترقية دفعة واحدة.**' : 
                              '**يوجد رول واحد فقط متاح للترقية.**'}`)
            .addFields([
                {
                    name: '📋 **الرولات المتاحة**',
                    value: availableRoles.map((role, index) => 
                        `${index + 1}. **${role.label}**`
                    ).join('\n'),
                    inline: false
                }
            ])
            .setTimestamp();

        await interaction.reply({
            embeds: [embedContent],
            components: [roleRow],
            ephemeral: true
        });
        return;
    }

    // Handle role selection for promotion - محسن لدعم الاختيار المتعدد
    if (interaction.isStringSelectMenu() && customId.startsWith('promote_role_')) {
        const userId = customId.split('_')[2];
        const selectedRoleIds = interaction.values; // دعم الاختيار المتعدد
        const isMultipleRoles = selectedRoleIds.length > 1;

        // إنشاء embed لعرض المختارات قبل إظهار المودال
        const selectedRoles = selectedRoleIds.map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? role.name : 'رول غير معروف';
        });

        const confirmationEmbed = colorManager.createEmbed()
            .setTitle(isMultipleRoles ? '🎯 ترقية متعددة مختارة' : '🎯 ترقية فردية مختارة')
            .setDescription(`**العضو:** <@${userId}>\n**عدد الرولات المختارة:** ${selectedRoleIds.length}`)
            .addFields([
                {
                    name: isMultipleRoles ? '🏷️ **الرولات المختارة**' : '🏷️ **الرول المختار**',
                    value: selectedRoles.map((roleName, index) => `${index + 1}. **${roleName}**`).join('\n'),
                    inline: false
                },
                {
                    name: '⏭️ **الخطوة التالية**',
                    value: 'سيتم فتح نافذة لإدخال المدة والسبب',
                    inline: false
                }
            ])
            .setTimestamp();

        // Join roleIds with comma for modal customId
        const roleIdsString = selectedRoleIds.join(',');

        // Create modal for duration and reason
        const modal = new ModalBuilder()
            .setCustomId(`promote_modal_${userId}_${roleIdsString}`)
            .setTitle(isMultipleRoles ? 'تفاصيل الترقية المتعددة' : 'تفاصيل الترقية');

        const durationInput = new TextInputBuilder()
            .setCustomId('promote_duration')
            .setLabel('المدة (مثل: 7d أو 12h أو نهائي)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('7d, 12h, 30m, نهائي')
            .setValue('نهائي'); // قيمة افتراضية

        const reasonInput = new TextInputBuilder()
            .setCustomId('promote_reason')
            .setLabel('السبب')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder(isMultipleRoles ? 
                'اذكر سبب الترقية المتعددة...' : 
                'اذكر سبب الترقية...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );

        // إظهار المودال مباشرة مع معلومات توضيحية في العنوان
        await interaction.showModal(modal);

        // إرسال رسالة توضيحية منفصلة
        setTimeout(async () => {
            try {
                await interaction.followUp({
                    embeds: [confirmationEmbed],
                    ephemeral: true
                });
            } catch (error) {
                console.log('تم إغلاق التفاعل أو انتهت صلاحيته');
            }
        }, 2000);

        return;
    }

    // Handle promotion records option selection
    if (interaction.isStringSelectMenu() && customId === 'promote_records_option') {
        const selectedOption = interaction.values[0];

        if (selectedOption === 'records_specific_user') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('promote_records_select_user')
                .setPlaceholder(' اختر العضو لعرض سجلات ترقياته...')
                .setMaxValues(1);

            const userRow = new ActionRowBuilder().addComponents(userSelect);

            await interaction.update({
                content: ' **اختر العضو لعرض سجلات ترقياته:**',
                components: [userRow]
            });
        } else if (selectedOption === 'records_specific_role') {
            const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
            const adminRoles = readJson(adminRolesPath, []);

            if (adminRoles.length === 0) {
                await interaction.update({
                    content: '⚠️ **لا توجد رولات إدارية محددة! يرجى إضافة رولات إدارية أولاً.**',
                    components: []
                });
                return;
            }

            const availableRoles = adminRoles.map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return role ? {
                    label: role.name,
                    value: roleId,
                    description: `عرض سجلات ترقيات ${role.name}`
                } : null;
            }).filter(Boolean).slice(0, 25);

            const roleSelect = new StringSelectMenuBuilder()
                .setCustomId('promote_records_select_role')
                .setPlaceholder('اختر الرول لعرض سجلات ترقياته...')
                .addOptions(availableRoles);

            const roleRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.update({
                content: ' **اختر الرول لعرض سجلات ترقياته:**',
                components: [roleRow]
            });
        }
        return;
    }

    // Handle role selection for records
    if (interaction.isStringSelectMenu() && customId === 'promote_records_select_role') {
        const selectedRoleId = interaction.values[0];
        const role = interaction.guild.roles.cache.get(selectedRoleId);

        if (!role) {
            await interaction.update({
                content: ' **لم يتم العثور على الرول!**',
                components: []
            });
            return;
        }

        // Get promotion records from promoteLogs.json with improved filtering
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        // تحسين فلترة السجلات لتشمل جميع أنواع الترقيات المتعلقة بالرول
        let roleRecords = promoteLogs.filter(log => {
            if (!log.data) return false;

            // فلترة بناءً على أنواع مختلفة من الترقيات
            if (log.type === 'BULK_PROMOTION') {
                // للترقية الجماعية، تحقق من الرول المصدر أو المستهدف
                return log.data.targetRoleId === selectedRoleId || log.data.sourceRoleId === selectedRoleId;
            } else if (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') {
                // للترقية الفردية، تحقق من الرول المستهدف
                return log.data.roleId === selectedRoleId || log.data.role?.id === selectedRoleId;
            } else if (log.type === 'MULTI_PROMOTION_APPLIED') {
                // للترقية المتعددة، تحقق من قائمة الرولات
                return log.data.roleIds && log.data.roleIds.includes(selectedRoleId);
            }

            // فلترة إضافية بناءً على معرف الرول
            return log.data.roleId === selectedRoleId;
        });

        // تجميع السجلات المتعددة بـ Transaction ID
        const groupedRecords = {};
        const standaloneRecords = [];

        roleRecords.forEach(record => {
            if (record.data && record.data.transactionId && record.type === 'PROMOTION_APPLIED') {
                const txId = record.data.transactionId;
                if (!groupedRecords[txId]) {
                    groupedRecords[txId] = {
                        transactionId: txId,
                        type: 'MULTI_PROMOTION_GROUP',
                        timestamp: record.timestamp,
                        records: [],
                        targetUserId: record.data.targetUserId,
                        reason: record.data.reason,
                        duration: record.data.duration,
                        byUserId: record.data.byUserId
                    };
                }
                groupedRecords[txId].records.push(record);
            } else {
                standaloneRecords.push(record);
            }
        });

        // دمج السجلات المجمّعة مع المفردة
        roleRecords = [
            ...Object.values(groupedRecords),
            ...standaloneRecords
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (roleRecords.length === 0) {
            // تحسين رسالة عدم وجود سجلات
            const backButton = new ButtonBuilder()
                .setCustomId('promote_records_back')
                .setLabel('العودة لقائمة الرولات')
                .setStyle(ButtonStyle.Secondary);

            const backRow = new ActionRowBuilder().addComponents(backButton);

            await interaction.update({
                content: `📋 **الرول** <@&${selectedRoleId}> **ليس لديه أي سجلات ترقيات مسجلة.**\n\n` +
                        `هذا يعني أنه لم يتم تسجيل أي عمليات ترقية من/إلى هذا الرول منذ تفعيل نظام التسجيل.`,
                components: [backRow]
            });
            return;
        }

        // نظام pagination محسّن: كل سجل في صفحة منفصلة
        let currentPage = 0;
        const totalRecords = roleRecords.length;

        function createSingleRecordEmbed(recordIndex) {
            const record = roleRecords[recordIndex];
            const recordDate = new Date(record.timestamp || Date.now());
            const timestamp = Math.floor(recordDate.getTime() / 1000);

            // البيانات الأساسية
            const moderatorId = record.data?.byUserId || record.data?.moderatorId || 'غير معروف';
            const targetUserId = record.data?.targetUserId || record.data?.userId;
            const duration = record.data?.duration || 'نهائي';
            const reason = record.data?.reason || 'لم يتم تحديد سبب';

            // معالجة خاصة للترقيات المجمّعة
            if (record.type === 'MULTI_PROMOTION_GROUP') {
                const rolesCount = record.records.length;
                const roleNames = record.records.map(r => {
                    const roleObj = interaction.guild.roles.cache.get(r.data.roleId);
                    return roleObj ? roleObj.name : 'رول محذوف';
                });

                const isTemporary = duration !== 'نهائي';

                const embed = colorManager.createEmbed()
                    .setTitle(`📋 سجل ترقية - الرول ${role.name}`)
                    .setDescription(
                        `**رقم السجل:** ${recordIndex + 1} من ${totalRecords}\n\n` +
                        `✅ **تم ترقية العضو** <@${targetUserId}> **لعدة رولات**\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `👥 **الإدارة الذين تأثروا:**\n<@${targetUserId}>\n\n` +
                        `🎖️ **الرولات المطبقة:**\n${roleNames.map((name, i) => `${i + 1}. **${name}**`).join('\n')}\n\n` +
                        `📝 **السبب:**\n${reason}\n\n` +
                        `📅 **الوقت:**\n<t:${timestamp}:F>\n\n` +
                        `⏰ **منذ:**\n<t:${timestamp}:R>\n\n` +
                        `👤 **بواسطة:**\n<@${moderatorId}>\n\n` +
                        (isTemporary ? `⏱️ **ترقية مؤقتة** - المدة: ${duration}` : '')
                    )
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .setFooter({ text: `معرف السجل: ${record.transactionId || record.timestamp}` })
                    .setTimestamp();

                return embed;
            }

            // تحديد نوع السجل ومعالجته
            let descriptionText = '';
            let affectedMembers = '';

            if (record.type === 'BULK_PROMOTION') {
                // ترقية جماعية
                const sourceRoleId = record.data?.sourceRoleId;
                const targetRoleId = record.data?.targetRoleId;
                const sourceRoleObj = sourceRoleId ? interaction.guild.roles.cache.get(sourceRoleId) : null;
                const targetRoleObj = targetRoleId ? interaction.guild.roles.cache.get(targetRoleId) : null;

                const sourceRoleName = sourceRoleObj ? sourceRoleObj.name : (record.data?.sourceRoleName || 'رول محذوف');
                const targetRoleName = targetRoleObj ? targetRoleObj.name : (record.data?.targetRoleName || 'رول محذوف');

                // تحديد إذا كان الرول المحدد هو المصدر أو الهدف
                if (sourceRoleId === selectedRoleId) {
                    descriptionText = `✅ **من هذا الرول:** ${sourceRoleName} **إلى الرول:** ${targetRoleName}`;
                } else {
                    descriptionText = `✅ **من الرول:** ${sourceRoleName} **إلى هذا الرول:** ${targetRoleName}`;
                }

                // قائمة الأعضاء المتأثرين
                if (record.data?.successfulMembers && record.data.successfulMembers.length > 0) {
                    const memberMentions = record.data.successfulMembers.map(m => {
                        // التحقق من البنية المختلفة للبيانات
                        if (typeof m === 'object' && m.id) {
                            return `<@${m.id}>`;
                        } else if (typeof m === 'string') {
                            return `<@${m}>`;
                        } else if (m.user && m.user.id) {
                            return `<@${m.user.id}>`;
                        } else if (m.member && m.member.id) {
                            return `<@${m.member.id}>`;
                        }
                        return null;
                    }).filter(Boolean);

                    if (memberMentions.length > 0) {
                        if (memberMentions.length <= 10) {
                            affectedMembers = memberMentions.join(' ');
                        } else {
                            affectedMembers = memberMentions.slice(0, 10).join(' ') + `\n**و ${memberMentions.length - 10} عضو آخر**`;
                        }
                    } else {
                        affectedMembers = 'خطأ في تحليل بيانات الأعضاء';
                    }
                } else if (record.data?.successCount && record.data.successCount > 0) {
                    affectedMembers = `تم ترقية ${record.data.successCount} عضو بنجاح`;
                } else {
                    affectedMembers = 'لا توجد معلومات';
                }

            } else if (record.type === 'PROMOTION_APPLIED') {
                // ترقية فردية
                const previousRoleName = record.data?.previousRole?.name || 'بدون رول سابق';
                const currentRoleId = record.data?.roleId;
                const currentRoleObj = currentRoleId ? interaction.guild.roles.cache.get(currentRoleId) : null;
                const currentRoleName = currentRoleObj ? currentRoleObj.name : 'رول محذوف';

                descriptionText = `✅ **من الرول:** ${previousRoleName} **إلى الرول:** ${currentRoleName}`;
                affectedMembers = `<@${targetUserId}>`;

            } else if (record.type === 'PROMOTION_ENDED') {
                // انتهاء ترقية
                const roleIdRecord = record.data?.roleId;
                const roleObj = roleIdRecord ? interaction.guild.roles.cache.get(roleIdRecord) : null;
                const roleName = roleObj ? roleObj.name : 'رول محذوف';

                descriptionText = `⏱️ **انتهت مدة الترقية للرول:** ${roleName}`;
                affectedMembers = `<@${targetUserId}>`;
            } else {
                descriptionText = `ℹ️ **سجل غير معروف**`;
                affectedMembers = targetUserId ? `<@${targetUserId}>` : 'غير محدد';
            }

            const isTemporary = duration !== 'نهائي';

            const embed = colorManager.createEmbed()
                .setTitle(`📋 سجل ترقية - الرول ${role.name}`)
                .setDescription(
                    `**رقم السجل:** ${recordIndex + 1} من ${totalRecords}\n\n` +
                    `${descriptionText}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👥 **الإدارة الذين تأثروا:**\n${affectedMembers}\n\n` +
                    `📝 **السبب:**\n${reason}\n\n` +
                    `📅 **الوقت:**\n<t:${timestamp}:F>\n\n` +
                    `⏰ **منذ:**\n<t:${timestamp}:R>\n\n` +
                    `👤 **بواسطة:**\n<@${moderatorId}>\n\n` +
                    (isTemporary ? `⏱️ **ترقية مؤقتة** - المدة: ${duration}` : '')
                )
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setFooter({ text: `معرف السجل: ${record.timestamp || 'غير محدد'}` })
                .setTimestamp();

            return embed;
        }

        const embed = createSingleRecordEmbed(currentPage);

        // أزرار التنقل والإدارة
        const components = [];

        // صف التنقل
        const navigationRow = new ActionRowBuilder();

        const prevButton = new ButtonBuilder()
            .setCustomId(`role_record_prev_${selectedRoleId}_${currentPage}`)
            .setLabel('السابق')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0);

        const pageButton = new ButtonBuilder()
            .setCustomId(`role_record_page`)
            .setLabel(`${currentPage + 1} / ${totalRecords}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        const nextButton = new ButtonBuilder()
            .setCustomId(`role_record_next_${selectedRoleId}_${currentPage}`)
            .setLabel('التالي')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalRecords - 1);

        navigationRow.addComponents(prevButton, pageButton, nextButton);
        components.push(navigationRow);

        // صف إدارة السجلات
        const manageRow = new ActionRowBuilder();

        const deleteRecordButton = new ButtonBuilder()
            .setCustomId(`delete_record_${selectedRoleId}_${currentPage}`)
            .setLabel('حذف هذا السجل')
            .setStyle(ButtonStyle.Danger);

        const deleteAllButton = new ButtonBuilder()
            .setCustomId(`delete_all_records_${selectedRoleId}`)
            .setLabel('حذف جميع السجلات')
            .setStyle(ButtonStyle.Danger);

        const backButton = new ButtonBuilder()
            .setCustomId('promote_records_back')
            .setLabel('العودة')
            .setStyle(ButtonStyle.Primary);

        manageRow.addComponents(deleteRecordButton, deleteAllButton, backButton);
        components.push(manageRow);

        await interaction.update({
            embeds: [embed],
            content: '',
            components: components
        });
        return;
    }

    // Handle user selection for records
    if (interaction.isUserSelectMenu() && customId === 'promote_records_select_user') {
        const selectedUserId = interaction.values[0];

        // البحث في جميع أنواع السجلات
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const allLogs = readJson(promoteLogsPath, []);

        // فلترة السجلات لتشمل جميع الأنواع المتعلقة بالمستخدم
        const records = allLogs.filter(log => {
            if (!log.data) return false;

            // سجلات الترقية الفردية
            if ((log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') && 
                log.data.targetUserId === selectedUserId) {
                return true;
            }

            // سجلات الترقية الجماعية
            if (log.type === 'BULK_PROMOTION' && log.data.successfulMembers) {
                const members = log.data.successfulMembers;
                return members.some(member => {
                    if (typeof member === 'string') return member === selectedUserId;
                    if (typeof member === 'object' && member.id) return member.id === selectedUserId;
                    return false;
                });
            }

            // سجلات الترقية المتعددة
            if (log.type === 'MULTI_PROMOTION_APPLIED' && log.data.targetUserId === selectedUserId) {
                return true;
            }

            return false;
        }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (records.length === 0) {
            await interaction.reply({
                content: ` **العضو** <@${selectedUserId}> **ليس لديه أي سجلات ترقيات.**`,
                ephemeral: true
            });
            return;
        }

        // تحسين عرض السجلات الخاصة بالمستخدم
        const member = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
        const memberName = member ? member.displayName : `العضو ID: ${selectedUserId}`;

        const recordsEmbed = colorManager.createEmbed()
            .setTitle('👤 سجلات الترقيات - العضو')
            .setDescription(`**العضو المحدد:** <@${selectedUserId}> (${memberName})\n` +
                          `**إجمالي السجلات:** ${records.length}\n` +
                          `**آخر تحديث:** <t:${Math.floor(Date.now() / 1000)}:R>`)
            .setThumbnail(member?.displayAvatarURL({ dynamic: true }) || interaction.guild.iconURL({ dynamic: true }))
            .addFields(records.slice(0, 20).map((record, index) => {
                const recordDate = new Date(record.timestamp || Date.now());
                const timestamp = Math.floor(recordDate.getTime() / 1000);

                // تحسين تحديد نوع الترقية والنص المناسب
                let actionDescription = '';
                let actionIcon = '';
                let statusColor = '';

                switch (record.type) {
                    case 'BULK_PROMOTION':
                        const sourceRoleName = record.data?.sourceRoleName || 'غير محدد';
                        const targetRoleName = record.data?.targetRoleName || 'غير محدد';
                        actionDescription = `ترقية جماعية من "${sourceRoleName}" إلى "${targetRoleName}"`;
                        actionIcon = '👥';
                        statusColor = '🟢';
                        break;

                    case 'PROMOTION_APPLIED':
                        const previousRoleName = record.data?.previousRole?.name || 'بدون رول سابق';
                        const roleId = record.data?.roleId;
                        const roleObj = roleId ? interaction.guild.roles.cache.get(roleId) : null;
                        const currentRoleName = roleObj ? roleObj.name : 'رول محذوف';
                        actionDescription = `ترقية فردية من "${previousRoleName}" إلى "${currentRoleName}"`;
                        actionIcon = '⬆️';
                        statusColor = '🟢';
                        break;

                    case 'MULTI_PROMOTION_APPLIED':
                        const rolesCount = record.data?.roleIds?.length || 0;
                        actionDescription = `ترقية متعددة لـ ${rolesCount} رول`;
                        actionIcon = '🎯';
                        statusColor = '🟢';
                        break;

                    case 'PROMOTION_ENDED':
                        const endedRoleId = record.data?.roleId;
                        const endedRoleObj = endedRoleId ? interaction.guild.roles.cache.get(endedRoleId) : null;
                        const endedRoleName = endedRoleObj ? endedRoleObj.name : 'رول محذوف';
                        actionDescription = `انتهاء ترقية الرول "${endedRoleName}"`;
                        actionIcon = '⏰';
                        statusColor = '🔴';
                        break;

                    default:
                        actionDescription = `إجراء غير معروف`;
                        actionIcon = '❓';
                        statusColor = '🟡';
                        break;
                }

                // تحديد حالة الترقية
                const duration = record.data?.duration || 'نهائي';
                const reason = record.data?.reason || 'لم يتم تحديد سبب';
                const moderatorId = record.data?.byUserId || record.data?.moderatorId || 'غير معروف';

                let statusInfo = '';
                if (record.type === 'PROMOTION_APPLIED' && duration !== 'نهائي') {
                    const endTime = record.data?.endTime;
                    if (endTime) {
                        const isExpired = Date.now() > endTime;
                        statusInfo = isExpired ? '\n🔴 **حالة الترقية:** منتهية' : '\n🟢 **حالة الترقية:** نشطة';
                    }
                }

                return {
                    name: `${statusColor} ${actionIcon} سجل رقم ${index + 1}`,
                    value: `**النوع:** ${actionDescription}\n` +
                           `**المدة المحددة:** ${duration}\n` +
                           `**السبب:** ${reason}\n` +
                           `**تم بواسطة:** <@${moderatorId}>\n` +
                           `**تاريخ الإجراء:** <t:${timestamp}:F> (<t:${timestamp}:R>)` +
                           statusInfo,
                    inline: false
                };
            }))
            .setTimestamp();

        await interaction.reply({
            embeds: [recordsEmbed],
            ephemeral: true
        });
        return;
    }

    // معالجات حذف السجلات
    if (interaction.isButton() && customId.startsWith('delete_record_')) {
        const parts = customId.split('_');
        const roleId = parts[2];
        const recordIndex = parseInt(parts[3]);

        try {
            await handleDeleteSingleRecord(interaction, roleId, recordIndex);
        } catch (error) {
            console.error('خطأ في حذف السجل:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ أثناء حذف السجل.',
                    ephemeral: true
                });
            }
        }
        return;
    }

    if (interaction.isButton() && customId.startsWith('delete_all_records_')) {
        const roleId = customId.split('_')[3];

        // طلب تأكيد قبل الحذف
        const confirmEmbed = colorManager.createEmbed()
            .setTitle('تأكيد حذف جميع السجلات')
            .setDescription(
                `هل أنت متأكد من حذف جميع سجلات الرول <@&${roleId}>؟\n\n` +
                `**تحذير:** هذا الإجراء لا يمكن التراجع عنه!`
            )
            .setTimestamp();

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_delete_all_${roleId}`)
            .setLabel('تأكيد الحذف')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId(`cancel_delete_all`)
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary);

        const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.update({
            embeds: [confirmEmbed],
            components: [buttonRow]
        });
        return;
    }

    if (interaction.isButton() && customId.startsWith('confirm_delete_all_')) {
        const roleId = customId.split('_')[3];
        await handleDeleteAllRecords(interaction, roleId);
        return;
    }

    if (interaction.isButton() && customId === 'cancel_delete_all') {
        await interaction.update({
            content: 'تم إلغاء عملية الحذف',
            embeds: [],
            components: []
        });
        return;
    }

    // Handle user selection for banning
    if (interaction.isUserSelectMenu() && customId === 'promote_ban_select_user') {
        const selectedUserId = interaction.values[0];

        try {
            // التحقق من أن المستخدم ليس محظوراً بالفعل
            const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
            const promoteBans = readJson(promoteBansPath, {});
            const banKey = `${selectedUserId}_${interaction.guild.id}`;

            if (promoteBans[banKey]) {
                const banData = promoteBans[banKey];
                const banEndTime = banData.endTime;
                const banEndText = banEndTime ? 
                    `<t:${Math.floor(banEndTime / 1000)}:R>` : 
                    'نهائي';

                await interaction.reply({
                    content: ` **العضو** <@${selectedUserId}> **محظور بالفعل من الترقيات.**\n**ينتهي الحظر:** ${banEndText}`,
                    ephemeral: true
                });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId(`promote_ban_modal_${selectedUserId}`)
                .setTitle('حظر من الترقيات');

            const durationInput = new TextInputBuilder()
                .setCustomId('ban_duration')
                .setLabel('مدة الحظر (مثل: 30d أو نهائي)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('30d, 7d, نهائي');

            const reasonInput = new TextInputBuilder()
                .setCustomId('ban_reason')
                .setLabel('سبب الحظر')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder('اذكر سبب منع الترقية...');

            modal.addComponents(
                new ActionRowBuilder().addComponents(durationInput),
                new ActionRowBuilder().addComponents(reasonInput)
            );

            await interaction.showModal(modal);
        } catch (error) {
            console.error('خطأ في معالجة اختيار المستخدم للحظر:', error);
            await interaction.reply({
                content: '❌ **حدث خطأ أثناء معالجة الطلب.**',
                ephemeral: true
            });
        }
        return;
    }

    // Handle eligible user selection for unbanning
    if (interaction.isStringSelectMenu() && customId === 'promote_unban_select_user_eligible') {
        const selectedUserId = interaction.values[0];

        const result = await promoteManager.unbanFromPromotions(selectedUserId, interaction.guild.id, interaction.user);

        if (result.success) {
            const successEmbed = colorManager.createEmbed()
                .setTitle('User Unbanned from Promotions')
                .setDescription(`**تم فك حظر الترقية بنجاح عن العضو** <@${selectedUserId}>`)
                .addFields([
                    { name: ' العضو', value: `<@${selectedUserId}>`, inline: true },
                    { name: ' تم فك الحظر بواسطة', value: `<@${interaction.user.id}>`, inline: true },
                    { name: ' التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                ])
                .setTimestamp();

            await interaction.update({
                embeds: [successEmbed],
                components: []
            });

            // Send DM notification to unbanned user
            try {
                const member = await interaction.guild.members.fetch(selectedUserId);
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('Promotion Ban Lifted')
                    .setDescription(`**تم فك حظر الترقية عنك من قبل الإدارة.**`)
                    .addFields([
                        { name: ' تم فك الحظر بواسطة', value: `${interaction.user.username}`, inline: true },
                        { name: ' التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ])
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`لا يمكن إرسال رسالة خاصة إلى ${selectedUserId} - قد تكون الرسائل الخاصة مغلقة`);
            }
        } else {
            await interaction.update({
                content: ` **فشل في فك الحظر:** ${result.error}`,
                components: []
            });
        }
        return;
    }

    // Handle admin activity option selection
    if (interaction.isStringSelectMenu() && customId === 'promote_activity_option') {
        const selectedOption = interaction.values[0];

        if (selectedOption === 'activity_specific_user') {
            const userSelect = new UserSelectMenuBuilder()
                .setCustomId('promote_activity_select_user')
                .setPlaceholder(' اختر العضو لفحص تفاعله...')
                .setMaxValues(1);

            const userRow = new ActionRowBuilder().addComponents(userSelect);

            await interaction.update({
                content: ' **اختر العضو لفحص إحصائيات تفاعله:**',
                components: [userRow]
            });
        } else if (selectedOption === 'activity_specific_role') {
            const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
            const adminRoles = readJson(adminRolesPath, []);

            if (adminRoles.length === 0) {
                await interaction.update({
                    content: '⚠️ **لا توجد رولات إدارية محددة! يرجى إضافة رولات إدارية أولاً.**',
                    components: []
                });
                return;
            }

            const availableRoles = adminRoles.map(roleId => {
                const role = interaction.guild.roles.cache.get(roleId);
                return role ? {
                    label: role.name,
                    value: roleId,
                    description: `فحص تفاعل أعضاء ${role.name}`
                } : null;
            }).filter(Boolean).slice(0, 25);

            const roleSelect = new StringSelectMenuBuilder()
                .setCustomId('promote_activity_select_role')
                .setPlaceholder('اختر الرول لفحص تفاعل أعضائه...')
                .addOptions(availableRoles);

            const roleRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.update({
                content: ' **اختر الرول لفحص إحصائيات تفاعل أعضائه:**',
                components: [roleRow]
            });
        }
        return;
    }

    // Handle role selection for activity check
    if (interaction.isStringSelectMenu() && customId === 'promote_activity_select_role') {
        const selectedRoleId = interaction.values[0];
        const role = interaction.guild.roles.cache.get(selectedRoleId);

        if (!role) {
            await interaction.update({
                content: ' **لم يتم العثور على الرول!**',
                components: []
            });
            return;
        }

        // Create period selection
        const periodSelect = new StringSelectMenuBuilder()
            .setCustomId(`promote_activity_period_role_${selectedRoleId}`)
            .setPlaceholder('اختر فترة الفحص...')
            .addOptions([
                {
                    label: 'أسبوعي (آخر 7 أيام)',
                    value: 'weekly',
                    description: 'إحصائيات آخر أسبوع فقط'
                },
                {
                    label: 'إجمالي (كل الوقت)',
                    value: 'total',
                    description: 'جميع الإحصائيات منذ البداية'
                }
            ]);

        const periodRow = new ActionRowBuilder().addComponents(periodSelect);

        await interaction.update({
            content: ` **اختر فترة فحص التفاعل للرول** <@&${selectedRoleId}>**:**`,
            components: [periodRow]
        });
        return;
    }

    // Handle period selection for role activity check
    if (interaction.isStringSelectMenu() && customId.startsWith('promote_activity_period_role_')) {
        const roleId = customId.replace('promote_activity_period_role_', '');
        const period = interaction.values[0];
        const role = interaction.guild.roles.cache.get(roleId);

        if (!role) {
            await interaction.update({
                content: ' **لم يتم العثور على الرول!**',
                components: []
            });
            return;
        }

        const membersWithRole = role.members;
        if (membersWithRole.size === 0) {
            await interaction.update({
                content: ` **الرول** <@&${roleId}> **لا يحتوي على أي أعضاء!**`,
                components: []
            });
            return;
        }

        // Get database stats for all members
        const database = context.database;
        let totalVoiceTime = 0;
        let totalMessages = 0;
        let totalReactions = 0;
        let totalVoiceJoins = 0;
        const memberStats = [];

        const weekAgo = period === 'weekly' ? Date.now() - (7 * 24 * 60 * 60 * 1000) : 0;

        for (const [userId, member] of membersWithRole) {
            if (database) {
                let userStats;
                if (period === 'weekly') {
                    // Get weekly stats
                    const weeklyData = await database.all(
                        `SELECT SUM(voice_time) as voice_time, SUM(messages) as messages, SUM(voice_joins) as voice_joins, SUM(reactions) as reactions FROM daily_activity WHERE user_id = ? AND date >= ?`,
                        [userId, new Date(weekAgo).toDateString()]
                    );
                    userStats = weeklyData[0] || { voice_time: 0, messages: 0, voice_joins: 0, reactions: 0 };
                } else {
                    // Get total stats
                    userStats = await database.get(
                        'SELECT total_voice_time as voice_time, total_messages as messages, total_voice_joins as voice_joins, total_reactions as reactions FROM user_totals WHERE user_id = ?',
                        [userId]
                    );
                }

                const voiceTime = userStats ? (userStats.voice_time || 0) : 0;
                const voiceMinutes = Math.floor(voiceTime / 60000);
                const messages = userStats ? (userStats.messages || 0) : 0;
                const reactions = userStats ? (userStats.reactions || 0) : 0;
                const voiceJoins = userStats ? (userStats.voice_joins || 0) : 0;

                totalVoiceTime += voiceTime;
                totalMessages += messages;
                totalReactions += reactions;
                totalVoiceJoins += voiceJoins;

                // Create object for activity rating
                const memberStatObj = {
                    totalVoiceTime: voiceTime,
                    totalMessages: messages,
                    totalReactions: reactions,
                    totalVoiceJoins: voiceJoins,
                    activeDays: period === 'weekly' ? 7 : 30
                };

                // Get member activity rating
                const rating = await getActivityRating(memberStatObj, context);

                memberStats.push({
                    member: member,
                    voiceTime: voiceTime,
                    voiceMinutes: voiceMinutes,
                    messages: messages,
                    reactions: reactions,
                    voiceJoins: voiceJoins,
                    rating: rating,
                    score: rating.score || rating.percentage || 0
                });
            }
        }

        // Sort by activity score
        memberStats.sort((a, b) => b.score - a.score);

        // Calculate averages
        const avgVoiceMinutes = Math.round((totalVoiceTime / 60000) / membersWithRole.size);
        const avgMessages = Math.round(totalMessages / membersWithRole.size);
        const avgReactions = Math.round(totalReactions / membersWithRole.size);
        const avgVoiceJoins = Math.round(totalVoiceJoins / membersWithRole.size);

        // Classify members by rating
        const excellentMembers = memberStats.filter(s => s.score >= 80 || s.score >= 150).length;
        const goodMembers = memberStats.filter(s => (s.score >= 50 && s.score < 80) || (s.score >= 90 && s.score < 150)).length;
        const weakMembers = memberStats.filter(s => s.score < 50 || s.score < 90).length;

        // Create detailed embed
        const activityEmbed = colorManager.createEmbed()
            .setTitle('📊 **إحصائيات نشاط الرول**')
            .setDescription(`**إحصائيات تفاعل أعضاء الرول** <@&${roleId}>
**الفترة:** ${period === 'weekly' ? 'أسبوعي (آخر 7 أيام)' : 'إجمالي (كل الوقت)'}`)
            .addFields([
                { name: '👥 **إجمالي الأعضاء**', value: membersWithRole.size.toString(), inline: true },
                { name: '🌟 **ممتازين**', value: excellentMembers.toString(), inline: true },
                { name: '✅ **جيدين**', value: goodMembers.toString(), inline: true },
                { name: '⚠️ **ضعفاء**', value: weakMembers.toString(), inline: true },
                { name: '📈 **متوسط الرسائل**', value: avgMessages.toLocaleString(), inline: true },
                { name: '🎤 **متوسط الصوت**', value: `${avgVoiceMinutes} دقيقة`, inline: true },
                { name: '👍 **متوسط التفاعلات**', value: avgReactions.toLocaleString(), inline: true },
                { name: '🔗 **متوسط انضمام الصوت**', value: avgVoiceJoins.toLocaleString(), inline: true }
            ]);

        // Add top performers with their ratings
        const topPerformers = memberStats.slice(0, 8).map((stat, index) => {
            const voiceHours = Math.floor(stat.voiceMinutes / 60);
            const voiceMinutesRem = stat.voiceMinutes % 60;
            const timeText = voiceHours > 0 ? `${voiceHours}ساعة ${voiceMinutesRem}د` : `${voiceMinutesRem}د`;

            return `**${index + 1}.** ${stat.member.displayName} ${stat.rating.emoji}\n` +
                   `├─ 🎤 ${timeText} | 💬 ${stat.messages} | 👍 ${stat.reactions}\n` +
                   `└─ ${stat.rating.rating}`;
        }).join('\n\n');

        if (topPerformers) {
            activityEmbed.addFields([
                { name: '🏆 **أعلى المتفاعلين**', value: topPerformers, inline: false }
            ]);
        }

        // Add ملاحظة عن نظام التقييم
        const guildAverages = await calculateGuildAverages(context);
        const ratingMethod = guildAverages ? 'مقارنة بمتوسط السيرفر' : 'نظام النقاط المرن';

        activityEmbed.addFields([
            { name: '📋 **نظام التقييم**', value: `يتم حساب التقييم بناءً على: ${ratingMethod}`, inline: false }
        ]);

        await interaction.update({
            embeds: [activityEmbed],
            content: '',
            components: []
        });
        return;
    }

    // Handle user selection for activity check with period
    if (interaction.isUserSelectMenu() && customId === 'promote_activity_select_user') {
        const selectedUserId = interaction.values[0];

        // Create period selection
        const periodSelect = new StringSelectMenuBuilder()
            .setCustomId(`promote_activity_period_user_${selectedUserId}`)
            .setPlaceholder('اختر فترة الفحص...')
            .addOptions([
                {
                    label: 'أسبوعي (آخر 7 أيام)',
                    value: 'weekly',
                    description: 'إحصائيات آخر أسبوع فقط'
                },
                {
                    label: 'إجمالي (كل الوقت)',
                    value: 'total',
                    description: 'جميع الإحصائيات منذ البداية'
                }
            ]);

        const periodRow = new ActionRowBuilder().addComponents(periodSelect);

        await interaction.update({
            content: ` **اختر فترة فحص التفاعل للعضو** <@${selectedUserId}>**:**`,
            components: [periodRow]
        });
        return;
    }

    // Handle period selection for user activity check
    if (interaction.isStringSelectMenu() && customId.startsWith('promote_activity_period_user_')) {
        const userId = customId.replace('promote_activity_period_user_', '');
        const period = interaction.values[0];

        const database = context.database;
        let userStats = { 
            totalVoiceTime: 0, 
            totalMessages: 0, 
            totalReactions: 0, 
            totalVoiceJoins: 0,
            activeDays: 0
        };

        if (database) {
            if (period === 'weekly') {
                // Get weekly stats
                const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                const weeklyData = await database.all(
                    `SELECT SUM(voice_time) as voice_time, SUM(messages) as messages, SUM(voice_joins) as voice_joins, SUM(reactions) as reactions FROM daily_activity WHERE user_id = ? AND date >= ?`,
                    [userId, new Date(weekAgo).toDateString()]
                );
                const weeklyStats = weeklyData[0] || {};
                userStats = {
                    totalVoiceTime: weeklyStats.voice_time || 0,
                    totalMessages: weeklyStats.messages || 0,
                    totalReactions: weeklyStats.reactions || 0,
                    totalVoiceJoins: weeklyStats.voice_joins || 0,
                    activeDays: 7 // أسبوع كامل
                };
            } else {
                // Get total stats
                const totalData = await database.get(
                    'SELECT total_voice_time, total_messages, total_reactions, total_voice_joins FROM user_totals WHERE user_id = ?',
                    [userId]
                );
                if (totalData) {
                    userStats = {
                        totalVoiceTime: totalData.total_voice_time || 0,
                        totalMessages: totalData.total_messages || 0,
                        totalReactions: totalData.total_reactions || 0,
                        totalVoiceJoins: totalData.total_voice_joins || 0,
                        activeDays: 30 // تقدير لشهر
                    };
                }
            }
        }

        // استخدام نظام التقييم الجديد
        const activityRating = await getActivityRating(userStats, context);

        const voiceMinutes = Math.floor(userStats.totalVoiceTime / 60000);
        const voiceHours = Math.floor(voiceMinutes / 60);

        const activityEmbed = colorManager.createEmbed()
            .setTitle('📊 **فحص نشاط الإداري**')
            .setDescription(`**إحصائيات تفاعل العضو** <@${userId}>
**الفترة:** ${period === 'weekly' ? 'أسبوعي (آخر 7 أيام)' : 'إجمالي (كل الوقت)'}`)
            .addFields([
                { name: '🎤 **وقت الصوت**', value: `${voiceHours} ساعة و ${voiceMinutes % 60} دقيقة`, inline: true },
                { name: '💬 **إجمالي الرسائل**', value: userStats.totalMessages.toLocaleString(), inline: true },
                { name: '👍 **التفاعلات**', value: userStats.totalReactions.toLocaleString(), inline: true },
                { name: '🔗 **انضمامات الصوت**', value: userStats.totalVoiceJoins.toLocaleString(), inline: true },
                { name: '📅 **الأيام النشطة**', value: userStats.activeDays.toString(), inline: true },
                { name: '📊 **تقييم التفاعل**', value: activityRating.rating, inline: true }
            ])
            .setTimestamp();

        // إضافة تفاصيل التقييم إذا كانت متاحة
        if (activityRating.details) {
            let detailsText = '';
            if (activityRating.method === 'flexible') {
                detailsText = `**النقاط:** ${activityRating.score}/100\n**التفاصيل:** الصوت: ${activityRating.details.voice}ساعة، الرسائل: ${activityRating.details.messages}، التفاعلات: ${activityRating.details.reactions}`;
            } else {
                detailsText = `**النسبة الإجمالية:** ${activityRating.percentage}% من المتوسط\n**التفاصيل:**\n• الصوت: ${activityRating.details.voice}%\n• الرسائل: ${activityRating.details.messages}%\n• التفاعلات: ${activityRating.details.reactions}%`;
            }

            activityEmbed.addFields([
                { name: '📈 **تفاصيل التقييم**', value: activityRating.description, inline: false },
                { name: '🔍 **تحليل مفصل**', value: detailsText, inline: false }
            ]);
        }

        await interaction.update({
            embeds: [activityEmbed],
            content: '',
            components: []
        });
        return;
    }

    // Handle old user selection for unbanning (kept for backward compatibility)
    if (interaction.isUserSelectMenu() && customId === 'promote_unban_select_user') {
        const selectedUserId = interaction.values[0];

        const result = await promoteManager.unbanFromPromotions(selectedUserId, interaction.guild.id, interaction.user);

        if (result.success) {
            await interaction.reply({
                content: ` **تم فك حظر الترقية بنجاح عن العضو** <@${selectedUserId}>`,
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: ` **فشل في فك الحظر:** ${result.error}`,
                ephemeral: true
            });
        }
        return;
    }

    // Handle user selection for activity check
    if (interaction.isUserSelectMenu() && customId === 'promote_activity_select_user') {
        const selectedUserId = interaction.values[0];

        const stats = await promoteManager.getUserInteractionStats(selectedUserId);

        const activityEmbed = colorManager.createEmbed()
            .setTitle('Admin Activity Check')
            .setDescription(`إحصائيات تفاعل العضو <@${selectedUserId}>`)
            .addFields([
                { name: ' وقت الصوت الإجمالي', value: `${Math.floor(stats.totalVoiceTime / 60)} دقيقة`, inline: true },
                { name: ' إجمالي الرسائل', value: stats.totalMessages.toString(), inline: true },
                { name: ' إجمالي التفاعلات', value: stats.totalReactions.toString(), inline: true },
                { name: ' جلسات الصوت', value: stats.totalSessions.toString(), inline: true },
                { name: ' الأيام النشطة', value: stats.activeDays.toString(), inline: true },
                { name: ' تقييم التفاعل', value: getActivityRating(stats), inline: true }
            ])
            .setTimestamp();

        await interaction.reply({
            embeds: [activityEmbed],
            ephemeral: true
        });
        return;
    }

    // Handle modal submission for bulk promotion
    if (interaction.isModalSubmit() && customId.startsWith('promote_bulk_modal_')) {
        const [, , , sourceRoleId, targetRoleId] = customId.split('_');
        const duration = interaction.fields.getTextInputValue('promote_duration');
        const reason = interaction.fields.getTextInputValue('promote_reason');

        try {
            // إرجاء الرد فوراً لتجنب انتهاء صلاحية التفاعل
            await interaction.deferReply({ ephemeral: true });

            const bulkSourceRole = interaction.guild.roles.cache.get(sourceRoleId);
            const targetRole = interaction.guild.roles.cache.get(targetRoleId);

            if (!bulkSourceRole || !targetRole) {
                await interaction.editReply({
                    content: ' **لم يتم العثور على أحد الرولات!**'
                });
                return;
            }

            const membersWithRole = bulkSourceRole.members;
            const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
            const promoteBans = readJson(promoteBansPath, {});

            let successCount = 0;
            let failedCount = 0;
            let bannedCount = 0;
            let results = [];
            let successfulMembers = [];
            let failedMembers = [];
            let bannedMembers = [];

            // إرسال رسالة تحديث للمستخدم
            await interaction.editReply({
                content: `⏳ **جاري معالجة الترقية الجماعية...**\n**الأعضاء المستهدفين:** ${membersWithRole.size}\n**من:** ${bulkSourceRole.name}\n**إلى:** ${targetRole.name}`
            });

            // Process each member
            for (const [userId, member] of membersWithRole) {
                const banKey = `${userId}_${interaction.guild.id}`;

                // تجاهل البوتات
                if (member.user.bot) {
                    continue;
                }

                // Check if banned
                if (promoteBans[banKey]) {
                    const banData = promoteBans[banKey];
                    const banEndTime = banData.endTime;

                    if (!banEndTime || banEndTime > Date.now()) {
                        bannedCount++;
                        bannedMembers.push({
                            member: member,
                            reason: 'محظور من الترقيات'
                        });
                        results.push(`🚫 ${member.displayName}: محظور من الترقيات`);
                        continue;
                    }
                }

                // Validate role hierarchy
                const validation = await promoteManager.validateRoleHierarchy(
                    interaction.guild, 
                    userId, 
                    targetRoleId, 
                    interaction.user.id
                );

                if (!validation.valid) {
                    failedCount++;
                    failedMembers.push({
                        member: member,
                        reason: validation.error
                    });
                    results.push(`❌ ${member.displayName}: ${validation.error}`);
                    continue;
                }

                // Process promotion (mark as bulk operation)
                const result = await promoteManager.createBulkPromotion(
                    interaction.guild,
                    context.client,
                    userId,
                    sourceRoleId,
                    targetRoleId,
                    duration,
                    reason,
                    interaction.user.id
                );

                if (result.success) {
                    successCount++;
                    successfulMembers.push(member);
                    results.push(`✅ ${member.displayName}: تم ترقيته بنجاح`);
                } else {
                    failedCount++;
                    failedMembers.push({
                        member: member,
                        reason: result.error
                    });
                    results.push(`❌ ${member.displayName}: ${result.error}`);
                }
            }

            // إرسال رسائل DM للأعضاء الذين تم ترقيتهم بنجاح (رسالة جماعية موحدة)
            if (successfulMembers.length > 0) {
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('**ترقية جماعية - تهانينا!**')
                    .setDescription(`**تم ترقيتك ضمن ترقية جماعية**`)
                    .addFields([
                        { name: '**نوع الترقية**', value: 'ترقية جماعية لجميع أعضاء الرول', inline: false },
                        { name: '**من الرول**', value: `${bulkSourceRole.name}`, inline: true },
                        { name: '**إلى الرول**', value: `**${targetRole.name}**`, inline: true },
                        { name: '**المدة**', value: duration === 'نهائي' || !duration ? 'نهائي' : duration, inline: true },
                        { name: '**السبب**', value: reason, inline: false },
                        { name: '**تم بواسطة**', value: `${interaction.user.username}`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                        { name: '**العدد الإجمالي**', value: `${successCount} عضو تم ترقيتهم`, inline: true }
                    ])
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ text: `خادم ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });

                let dmSuccessCount = 0;
                let dmFailCount = 0;

                for (const member of successfulMembers) {
                    try {
                        await member.send({ embeds: [dmEmbed] });
                        dmSuccessCount++;
                    } catch (dmError) {
                        dmFailCount++;
                        console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName}`);
                    }
                }

                console.log(`تم إرسال ${dmSuccessCount} رسالة خاصة من أصل ${successfulMembers.length} عضو`);
            }

            // Create summary embed
            const summaryEmbed = colorManager.createEmbed()
                .setTitle('**نتائج الترقية الجماعية**')
                .setDescription(`**تم تطبيق ترقية جماعية من الرول** **${bulkSourceRole.name}** **إلى** **${targetRole.name}**`)
                .addFields([
                    { name: '**نجح**', value: successCount.toString(), inline: true },
                    { name: '**فشل**', value: failedCount.toString(), inline: true },
                    { name: '**محظورين**', value: bannedCount.toString(), inline: true },
                    { name: '**إجمالي الأعضاء**', value: membersWithRole.size.toString(), inline: true },
                    { name: '**المدة**', value: duration === 'نهائي' || !duration ? 'نهائي' : duration, inline: true },
                    { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '**السبب**', value: reason, inline: false }
                ])
                .setTimestamp();

            // Add results if there are failures or bans
            if (failedCount > 0 || bannedCount > 0) {
                const problemResults = results.filter(r => r.startsWith('❌') || r.startsWith('🚫')).slice(0, 15);
                if (problemResults.length > 0) {
                    summaryEmbed.addFields([
                        { name: '⚠️ **تفاصيل المشاكل**', value: problemResults.join('\n'), inline: false }
                    ]);
                }
            }

            if (successCount > 0) {
                summaryEmbed.addFields([
                    { name: '✅ **ملاحظة**', value: `تم إرسال إشعارات خاصة لجميع الأعضاء الذين تم ترقيتهم بنجاح`, inline: false }
                ]);
            }

            await interaction.editReply({ embeds: [summaryEmbed] });

            // Log bulk promotion with unified logging
            promoteManager.logAction('BULK_PROMOTION', {
                sourceRoleId,
                sourceRoleName: bulkSourceRole.name,
                targetRoleId,
                targetRoleName: targetRole.name,
                moderatorId: interaction.user.id,
                duration,
                reason,
                successCount,
                failedCount,
                bannedCount,
                totalMembers: membersWithRole.size,
                guildId: interaction.guild.id,
                timestamp: Date.now()
            });

            // إرسال سجل موحد بدلاً من سجلات فردية
            await promoteManager.sendLogMessage(interaction.guild, context.client, 'BULK_PROMOTION', {
                sourceRoleId: sourceRoleId,
                sourceRoleName: bulkSourceRole.name,
                targetRoleId: targetRoleId,
                targetRoleName: targetRole.name,
                moderatorId: interaction.user.id,
                moderatorUser: interaction.user,
                duration: duration || 'نهائي',
                reason,
                successCount,
                failedCount: failedMembers.length,
                bannedCount: bannedMembers.length,
                totalMembers: membersWithRole.size,
                successfulMembers: successfulMembers,
                failedMembers: failedMembers,
                bannedMembers: bannedMembers
            });

        } catch (error) {
            console.error('خطأ في معالجة الترقية الجماعية:', error);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: ' **حدث خطأ أثناء معالجة الترقية الجماعية!**'
                    });
                } else {
                    await interaction.reply({
                        content: ' **حدث خطأ أثناء معالجة الترقية الجماعية!**',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('خطأ في الرد على خطأ الترقية الجماعية:', replyError);
            }
        }
        return;
    }

    // Handle modal submission for promotion
    if (interaction.isModalSubmit() && customId.startsWith('promote_modal_')) {
        const parts = customId.split('_');
        const userId = parts[2];
        const roleIds = parts[3].split(','); // Support multiple roles
        let duration = interaction.fields.getTextInputValue('promote_duration').trim();
        const reason = interaction.fields.getTextInputValue('promote_reason').trim();

        // Normalize duration input - تحسين معالجة المدة
        if (!duration || duration.trim() === '') {
            duration = null; // empty input means permanent
        } else if (duration.toLowerCase() === 'نهائي' || duration.toLowerCase() === 'permanent' || duration.toLowerCase() === 'دائم') {
            duration = null; // null for permanent promotions
        } else {
            // تنظيف المدة وإضافة دعم للغة العربية
            duration = duration.trim()
                .replace('ايام', 'd').replace('ايام', 'd').replace('يوم', 'd')
                .replace('ساعات', 'h').replace('ساعة', 'h')
                .replace('دقائق', 'm').replace('دقيقة', 'm');
        }

        try {
            const member = await interaction.guild.members.fetch(userId);
            if (!member) {
                await interaction.reply({
                    content: '❌ **لم يتم العثور على العضو!**',
                    ephemeral: true
                });
                return;
            }

            // Validate duration with better error handling
            if (duration && duration !== null) {
                try {
                    const durationMs = ms(duration);
                    if (!durationMs || durationMs <= 0) {
                        await interaction.reply({
                            content: '❌ **صيغة المدة غير صحيحة!**\n\n**أمثلة صحيحة:**\n• `7d` أو `7 ايام` - لسبعة أيام\n• `12h` أو `12 ساعات` - لاثني عشر ساعة\n• `30m` أو `30 دقائق` - لثلاثين دقيقة\n• `نهائي` أو `دائم` - للترقية الدائمة',
                            ephemeral: true
                        });
                        return;
                    }
                } catch (durationError) {
                    console.error('خطأ في تحليل المدة:', durationError);
                    await interaction.reply({
                        content: '❌ **خطأ في تحليل المدة المدخلة!**\n\nيرجى التأكد من الصيغة الصحيحة.',
                        ephemeral: true
                    });
                    return;
                }
            }

            const results = [];
            const failedPromotions = [];
            let successCount = 0;
            let allRemovedOldRoles = [];

            // إنشاء Transaction ID موحد للترقية المتعددة
            const transactionId = `multi_${userId}_${Date.now()}`;

            // احفظ الرولات الإدارية الحالية قبل الترقية المتعددة
            const initialAdminRoles = member.roles.cache.filter(r => 
                r.name !== '@everyone' && 
                promoteManager.isAdminRole && promoteManager.isAdminRole(r.id)
            );

            // Process each role - disable DM and logging for individual roles
            for (const roleId of roleIds) {
                const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
                if (!role) {
                    failedPromotions.push(`Role ID ${roleId}: الرول غير موجود`);
                    continue;
                }

                // Process the promotion without individual DM or log messages
                const result = await promoteManager.createPromotion(
                    interaction.guild,
                    context.client,
                    userId,
                    roleId,
                    duration,
                    reason,
                    interaction.user.id,
                    false, // not bulk operation
                    false, // disable DM for individual roles
                    true,  // is multi-promotion - disable individual logging
                    transactionId // Transaction ID للربط
                );

                if (result.success) {
                    successCount++;
                    results.push({
                        roleId: roleId,
                        roleName: role.name,
                        success: true,
                        duration: result.duration,
                        endTime: result.endTime,
                        removedOldRoles: result.removedOldRoles || [],
                        previousRoleName: result.previousRoleName
                    });
                } else {
                    failedPromotions.push(`${role.name}: ${result.error}`);
                    results.push({
                        roleId: roleId,
                        roleName: role.name,
                        success: false,
                        error: result.error
                    });
                }
            }

            // معالجة إزالة الرولات القديمة بعد إضافة جميع الرولات الجديدة (للترقيات النهائية فقط)
            const isPermanentPromotion = !duration || duration === null || duration === undefined || duration === 'نهائي';
            if (isPermanentPromotion && successCount > 0 && initialAdminRoles.size > 0) {
                const newRoleIds = results.filter(r => r.success).map(r => r.roleId);

                for (const [oldRoleId, oldRole] of initialAdminRoles) {
                    try {
                        // تأكد من أن الرول ليس من الرولات الجديدة المضافة
                        if (!newRoleIds.includes(oldRoleId) && member.roles.cache.has(oldRoleId)) {
                            await member.roles.remove(oldRoleId, `إزالة الرول الإداري القديم بعد الترقية المتعددة النهائية: ${reason}`);
                            allRemovedOldRoles.push(oldRole.name);
                            console.log(`تم إزالة الرول القديم ${oldRole.name} من ${member.displayName} بعد الترقية المتعددة النهائية`);
                        }
                    } catch (removeError) {
                        console.error(`خطأ في إزالة الرول القديم ${oldRole.name}:`, removeError);
                    }
                }
            }

            // إرسال رسالة لوج موحدة للترقية المتعددة
            if (successCount > 0) {
                const member = await interaction.guild.members.fetch(userId);
                const successfulRoles = results.filter(r => r.success);

                // تسجيل الترقية المتعددة
                promoteManager.logAction('MULTI_PROMOTION_APPLIED', {
                    targetUserId: userId,
                    roleIds: successfulRoles.map(r => r.roleId),
                    roleNames: successfulRoles.map(r => r.roleName),
                    guildId: interaction.guild.id,
                    duration: duration || 'نهائي',
                    reason,
                    byUserId: interaction.user.id,
                    successCount,
                    failedCount: failedPromotions.length,
                    transactionId,
                    timestamp: Date.now()
                });

                // إرسال رسالة لوج موحدة
                await promoteManager.sendLogMessage(interaction.guild, context.client, 'MULTI_PROMOTION_APPLIED', {
                    targetUser: member.user,
                    roles: successfulRoles.map(r => ({ id: r.roleId, name: r.roleName })),
                    previousRoleName: successfulRoles[0]?.previousRoleName || 'لا يوجد رول سابق',
                    duration: duration || 'نهائي',
                    reason,
                    byUser: interaction.user,
                    successCount,
                    failedCount: failedPromotions.length,
                    removedOldRoles: [...new Set(allRemovedOldRoles)], // إزالة التكرارات
                    isMultiPromotion: true
                });
            }

            // Create response embed
            const isMultipleRoles = roleIds.length > 1;
            const successEmbed = colorManager.createEmbed()
                .setTitle(isMultipleRoles ? '👥 **نتائج الترقية المتعددة**' : '✅ **تم تطبيق الترقية بنجاح**')
                .setDescription(isMultipleRoles ? 
                    `**العضو:** <@${userId}>\n**تمت معالجة ${roleIds.length} رول` : 
                    `تم ترقية العضو وإعطاؤه الرول كما هو مطلوب`)
                .addFields([
                    { name: '👤 **العضو**', value: `<@${userId}>`, inline: true },
                    { name: '✅ **نجح**', value: successCount.toString(), inline: true },
                    { name: '❌ **فشل**', value: failedPromotions.length.toString(), inline: true },
                    { name: '⏰ **المدة**', value: duration || 'نهائي', inline: true },
                    { name: '📝 **السبب**', value: reason, inline: false },
                    { name: '👤 **بواسطة**', value: `<@${interaction.user.id}>`, inline: true }
                ])
                .setTimestamp();

            // Add successful promotions list
            if (successCount > 0) {
                const successfulRoles = results.filter(r => r.success).map(r => 
                    `• <@&${r.roleId}> - ينتهي: ${r.endTime ? `<t:${Math.floor(Number(r.endTime) / 1000)}:R>` : 'نهائي'}`
                ).join('\n');

                successEmbed.addFields([
                    { name: '🎉 **الرولات المضافة بنجاح**', value: successfulRoles, inline: false }
                ]);
            }

            // Add failed promotions if any
            if (failedPromotions.length > 0) {
                successEmbed.addFields([
                    { name: '⚠️ **الرولات التي فشلت**', value: failedPromotions.join('\n'), inline: false }
                ]);
            }

            await interaction.reply({ embeds: [successEmbed], ephemeral: true });

            // Send unified DM notification for all successful promotions
            if (successCount > 0) {
                try {
                    const member = await interaction.guild.members.fetch(userId);
                    const successfulRolesList = results.filter(r => r.success);
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle(isMultipleRoles ? '🎉 **تم ترقيتك (رولات متعددة)**' : '🎉 **تم ترقيتك**')
                        .setDescription(isMultipleRoles ? 
                            `تم ترقيتك وإعطاؤك ${successCount} رول إداري جديد من قبل الإدارة.` :
                            `تم ترقيتك وإعطاؤك رول **${successfulRolesList[0].roleName}** من قبل الإدارة.`)
                        .addFields([
                            { name: '👤 **تمت الترقية بواسطة**', value: `${interaction.user.username}`, inline: true },
                            { name: '⏰ **المدة**', value: duration || 'نهائي', inline: true },
                            { name: '📝 **السبب**', value: reason, inline: false }
                        ])
                        .setTimestamp()
                        .setFooter({ text: `سيرفر ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });

                    // Add roles list for multiple or single promotions
                    const rolesText = successfulRolesList.map(r => 
                        `• **${r.roleName}** - ينتهي: ${r.endTime ? `<t:${Math.floor(Number(r.endTime) / 1000)}:R>` : 'نهائي'}`
                    ).join('\n');

                    dmEmbed.addFields([
                        { name: isMultipleRoles ? '🏷️ **الرولات الجديدة**' : '🏷️ **الرول الجديد**', value: rolesText, inline: false }
                    ]);

                    // إضافة معلومات الرولات المُزالة إذا وجدت (فقط للترقيات النهائية)
                    if (allRemovedOldRoles.length > 0 && (!duration || duration === null || duration === 'نهائي')) {
                        const uniqueRemovedRoles = [...new Set(allRemovedOldRoles)];
                        const removedRolesText = uniqueRemovedRoles.length === 1 ? 
                            `تم إزالة الرول السابق **${uniqueRemovedRoles[0]}**` :
                            `تم إزالة الرولات السابقة: **${uniqueRemovedRoles.join('**, **')}**`;

                        dmEmbed.addFields([
                            { name: '⚠️ **ملاحظة مهمة**', value: `${removedRolesText} لأن الترقية نهائية`, inline: false }
                        ]);
                    }

                    await member.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة خاصة إلى العضو ${userId}`);
                }
            }

        } catch (error) {
            console.error('Error in promotion modal submission:', error);
            await interaction.reply({
                content: '❌ **حدث خطأ أثناء معالجة الترقية!**\n\n' +
                        `**تفاصيل الخطأ:** ${error.message || 'خطأ غير معروف'}`,
                ephemeral: true
            });
        }
        return;
    }

    // Handle permission type selection for editing
    if (interaction.isStringSelectMenu() && customId === 'promote_edit_permission_type') {
        const permissionType = interaction.values[0];
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});

        settings.allowedUsers.type = permissionType;
        settings.allowedUsers.targets = []; // Clear existing targets

        if (permissionType === 'owners') {
            settings.allowedUsers.targets = context.BOT_OWNERS;
            saveJson(settingsPath, settings);
            await interaction.update({
                content: ' **تم تغيير صلاحيات المعتمدين إلى "المالكين فقط".**',
                components: []
            });
        } else if (permissionType === 'roles') {
            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId('promote_edit_select_roles')
                .setPlaceholder(' اختر الرولات المعتمدة...')
                .setMaxValues(10);

            const roleRow = new ActionRowBuilder().addComponents(roleSelect);

            await interaction.update({
                content: ' **اختر الرولات المعتمدة لاستخدام النظام:**',
                components: [roleRow]
            });
        } else if (permissionType === 'responsibility') {
            const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
            const responsibilities = readJson(responsibilitiesPath, {});

            if (Object.keys(responsibilities).length === 0) {
                await interaction.update({
                    content: '⚠️ **لا توجد مسؤوليات معرّفة! يرجى إضافتها أولاً.**',
                    components: []
                });
                return;
            }

            const respOptions = Object.keys(responsibilities).slice(0, 25).map(name => ({
                label: name,
                value: name,
                description: `السماح للمسؤولين عن ${name}`
            }));

            const respSelect = new StringSelectMenuBuilder()
                .setCustomId('promote_edit_select_responsibilities')
                .setPlaceholder(' اختر المسؤوليات المعتمدة...')
                .setMaxValues(Math.min(respOptions.length, 10))
                .addOptions(respOptions);

            const respRow = new ActionRowBuilder().addComponents(respSelect);

            await interaction.update({
                content: ' **اختر المسؤوليات المعتمدة لاستخدام النظام:**',
                components: [respRow]
            });
        }
        return;
    }

    // Handle role selection for editing permissions
    if (interaction.isRoleSelectMenu() && customId === 'promote_edit_select_roles') {
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});
        settings.allowedUsers.targets = interaction.values;
        saveJson(settingsPath, settings);

        await interaction.update({
            content: ' **تم تحديد الرولات المعتمدة بنجاح.**',
            components: []
        });
        return;
    }

    // Handle responsibility selection for editing permissions
    if (interaction.isStringSelectMenu() && customId === 'promote_edit_select_responsibilities') {
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});
        settings.allowedUsers.targets = interaction.values;
        saveJson(settingsPath, settings);

        await interaction.update({
            content: ' **تم تحديد المسؤوليات المعتمدة بنجاح.**',
            components: []
        });
        return;
    }

    // Handle log channel selection for editing
    if (interaction.isChannelSelectMenu() && customId === 'promote_edit_log_channel_select') {
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});
        settings.logChannel = interaction.values[0];
        saveJson(settingsPath, settings);

        await interaction.update({
            content: ' **تم تغيير قناة السجلات بنجاح.**',
            components: []
        });
        return;
    }

    // Handle menu channel selection for editing
    if (interaction.isChannelSelectMenu() && customId === 'promote_edit_menu_channel_select') {
        const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
        const settings = readJson(settingsPath, {});
        settings.menuChannel = interaction.values[0];
        saveJson(settingsPath, settings);

        // Re-send the menu to the new channel
        await createPermanentMenu(context.client, settings.menuChannel);

        await interaction.update({
            content: ' **تم تغيير روم المنيو وإعادة إرسال المنيو بنجاح.**',
            components: []
        });
        return;
    }

    // Handle reset confirmation buttons
    if (interaction.isButton() && (customId === 'promote_confirm_reset' || customId === 'promote_cancel_reset')) {
        if (customId === 'promote_cancel_reset') {
            await interaction.update({
                content: ' **تم إلغاء إعادة التعيين.**',
                embeds: [],
                components: []
            });
            return;
        }

        // Confirm reset - clear all data
        const dataFiles = [
            path.join(__dirname, '..', 'data', 'promoteSettings.json'),
            path.join(__dirname, '..', 'data', 'activePromotes.json'),
            path.join(__dirname, '..', 'data', 'promoteLogs.json'),
            path.join(__dirname, '..', 'data', 'leftMembersPromotes.json'),
            path.join(__dirname, '..', 'data', 'promoteBans.json')
        ];

        for (const filePath of dataFiles) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                console.error(`Error deleting ${filePath}:`, error);
            }
        }

        await interaction.update({
            content: ' **تم إعادة تعيين النظام بنجاح! جميع البيانات والإعدادات تم حذفها.**',
            embeds: [],
            components: []
        });
        return;
    }

    // معالجات التنقل الجديدة للسجلات
    if (interaction.isButton() && (customId.startsWith('role_record_prev_') || customId.startsWith('role_record_next_'))) {
        const parts = customId.split('_');
        const direction = parts[2]; // prev or next
        const selectedRoleId = parts[3];
        let currentPage = parseInt(parts[4]) || 0;

        // تحديث الصفحة الحالية
        if (direction === 'prev') {
            currentPage = Math.max(0, currentPage - 1);
        } else if (direction === 'next') {
            currentPage = currentPage + 1;
        }

        // جلب السجلات
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        const roleRecords = promoteLogs.filter(log => {
            if (!log.data) return false;
            if (log.type === 'BULK_PROMOTION') {
                return log.data.targetRoleId === selectedRoleId || log.data.sourceRoleId === selectedRoleId;
            } else if (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') {
                return log.data.roleId === selectedRoleId || log.data.role?.id === selectedRoleId;
            }

            return log.data.roleId === selectedRoleId;
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const totalRecords = roleRecords.length;

        const roleObj = interaction.guild.roles.cache.get(selectedRoleId);
        if (!roleObj) {
            await interaction.update({
                content: 'لم يتم العثور على الرول!',
                components: []
            });
            return;
        }

        // التحقق من وجود سجلات
        if (totalRecords === 0) {
            const noRecordsEmbed = colorManager.createEmbed()
                .setTitle(`سجلات الترقيات - الرول ${roleObj.name}`)
                .setDescription(
                    `لا توجد سجلات ترقيات لهذا الرول\n\n` +
                    `الرول: <@&${selectedRoleId}>`
                )
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setTimestamp();

            const backButton = new ButtonBuilder()
                .setCustomId('promote_records_back')
                .setLabel('العودة')
                .setStyle(ButtonStyle.Primary);

            const backRow = new ActionRowBuilder().addComponents(backButton);

            await interaction.update({
                embeds: [noRecordsEmbed],
                content: '',
                components: [backRow]
            });
            return;
        }

        currentPage = Math.max(0, Math.min(currentPage, totalRecords - 1));

        // إنشاء embed للسجل الحالي باستخدام نفس المنطق المبسط
        const record = roleRecords[currentPage];
        const recordDate = new Date(record.timestamp || Date.now());
        const timestamp = Math.floor(recordDate.getTime() / 1000);

        // البيانات الأساسية
        const moderatorId = record.data?.byUserId || record.data?.moderatorId || 'غير معروف';
        const targetUserId = record.data?.targetUserId || record.data?.userId;
        const duration = record.data?.duration || 'نهائي';
        const reason = record.data?.reason || 'لم يتم تحديد سبب';

        // تحديد نوع السجل ومعالجته
        let descriptionText = '';
        let affectedMembers = '';

        if (record.type === 'MULTI_PROMOTION_GROUP') {
            // Handling multi-promotion group logs correctly
            const rolesCount = record.records.length;
            const roleNames = record.records.map(r => {
                const roleObj = interaction.guild.roles.cache.get(r.data.roleId);
                return roleObj ? roleObj.name : 'رول محذوف';
            });

            const isTemporary = duration !== 'نهائي';

            const embed = colorManager.createEmbed()
                .setTitle(`📋 سجل ترقية - الرول ${role.name}`)
                .setDescription(
                    `**رقم السجل:** ${currentPage + 1} من ${totalRecords}\n\n` +
                    `✅ **تم ترقية العضو** <@${targetUserId}> **لعدة رولات**\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👥 **الإدارة الذين تأثروا:**\n<@${targetUserId}>\n\n` +
                    `🎖️ **الرولات المطبقة:**\n${roleNames.map((name, i) => `${i + 1}. **${name}**`).join('\n')}\n\n` +
                    `📝 **السبب:**\n${reason}\n\n` +
                    `📅 **الوقت:**\n<t:${timestamp}:F>\n\n` +
                    `⏰ **منذ:**\n<t:${timestamp}:R>\n\n` +
                    `👤 **بواسطة:**\n<@${moderatorId}>\n\n` +
                    (isTemporary ? `⏱️ **ترقية مؤقتة** - المدة: ${duration}` : '')
                )
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setFooter({ text: `معرف السجل: ${record.transactionId || record.timestamp}` })
                .setTimestamp();

            return embed;
        } else if (record.type === 'BULK_PROMOTION') {
            // ترقية جماعية
            const sourceRoleId = record.data?.sourceRoleId;
            const targetRoleId = record.data?.targetRoleId;
            const sourceRoleObjNav = sourceRoleId ? interaction.guild.roles.cache.get(sourceRoleId) : null;
            const targetRoleObjNav = targetRoleId ? interaction.guild.roles.cache.get(targetRoleId) : null;

            const sourceRoleName = sourceRoleObjNav ? sourceRoleObjNav.name : (record.data?.sourceRoleName || 'رول محذوف');
            const targetRoleName = targetRoleObjNav ? targetRoleObjNav.name : (record.data?.targetRoleName || 'رول محذوف');

            // تحديد إذا كان الرول المحدد هو المصدر أو الهدف
            if (sourceRoleId === selectedRoleId) {
                descriptionText = `✅ **من هذا الرول:** ${sourceRoleName} **إلى الرول:** ${targetRoleName}`;
            } else {
                descriptionText = `✅ **من الرول:** ${sourceRoleName} **إلى هذا الرول:** ${targetRoleName}`;
            }

            // قائمة الأعضاء المتأثرين
            if (record.data?.successfulMembers && record.data.successfulMembers.length > 0) {
                const memberMentions = record.data.successfulMembers.map(m => {
                    // التحقق من البنية المختلفة للبيانات
                    if (typeof m === 'object' && m.id) {
                        return `<@${m.id}>`;
                    } else if (typeof m === 'string') {
                        return `<@${m}>`;
                    } else if (m.user && m.user.id) {
                        return `<@${m.user.id}>`;
                    } else if (m.member && m.member.id) {
                        return `<@${m.member.id}>`;
                    }
                    return null;
                }).filter(Boolean);

                if (memberMentions.length > 0) {
                    if (memberMentions.length <= 10) {
                        affectedMembers = memberMentions.join(' ');
                    } else {
                        affectedMembers = memberMentions.slice(0, 10).join(' ') + `\n**و ${memberMentions.length - 10} عضو آخر**`;
                    }
                } else {
                    affectedMembers = 'خطأ في تحليل بيانات الأعضاء';
                }
            } else if (record.data?.successCount && record.data.successCount > 0) {
                affectedMembers = `تم ترقية ${record.data.successCount} عضو بنجاح`;
            } else {
                affectedMembers = 'لا توجد معلومات';
            }

        } else if (record.type === 'PROMOTION_APPLIED') {
            // ترقية فردية
            const previousRoleName = record.data?.previousRole?.name || 'بدون رول سابق';
            const currentRoleId = record.data?.roleId;
            const currentRoleObjNav = currentRoleId ? interaction.guild.roles.cache.get(currentRoleId) : null;
            const currentRoleName = currentRoleObjNav ? currentRoleObjNav.name : 'رول محذوف';

            descriptionText = `✅ **من الرول:** ${previousRoleName} **إلى الرول:** ${currentRoleName}`;
            affectedMembers = `<@${targetUserId}>`;

        } else if (record.type === 'PROMOTION_ENDED') {
            // انتهاء ترقية
            const roleIdRecord = record.data?.roleId;
            const roleObjNav = roleIdRecord ? interaction.guild.roles.cache.get(roleIdRecord) : null;
            const roleName = roleObjNav ? roleObjNav.name : 'رول محذوف';

            descriptionText = `⏱️ **انتهت مدة الترقية للرول:** ${roleName}`;
            affectedMembers = `<@${targetUserId}>`;
        } else {
            descriptionText = `ℹ️ **سجل غير معروف**`;
            affectedMembers = targetUserId ? `<@${targetUserId}>` : 'غير محدد';
        }

        const isTemporary = duration !== 'نهائي';

        const embed = colorManager.createEmbed()
            .setTitle(`📋 سجل ترقية - الرول ${role.name}`)
            .setDescription(
                `**رقم السجل:** ${currentPage + 1} من ${totalRecords}\n\n` +
                `${descriptionText}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👥 **الإدارة الذين تأثروا:**\n${affectedMembers}\n\n` +
                `📝 **السبب:**\n${reason}\n\n` +
                `📅 **الوقت:**\n<t:${timestamp}:F>\n\n` +
                `⏰ **منذ:**\n<t:${timestamp}:R>\n\n` +
                `👤 **بواسطة:**\n<@${moderatorId}>\n\n` +
                (isTemporary ? `⏱️ **ترقية مؤقتة** - المدة: ${duration}` : '')
            )
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setFooter({ text: `معرف السجل: ${record.timestamp || 'غير محدد'}` })
            .setTimestamp();

        // أزرار التنقل والإدارة
        const components = [];

        // صف التنقل
        const navigationRow = new ActionRowBuilder();

        const prevButton = new ButtonBuilder()
            .setCustomId(`role_record_prev_${selectedRoleId}_${currentPage}`)
            .setLabel('السابق')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0);

        const pageButton = new ButtonBuilder()
            .setCustomId(`role_record_page`)
            .setLabel(`${currentPage + 1} / ${totalRecords}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        const nextButton = new ButtonBuilder()
            .setCustomId(`role_record_next_${selectedRoleId}_${currentPage}`)
            .setLabel('التالي')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalRecords - 1);

        navigationRow.addComponents(prevButton, pageButton, nextButton);
        components.push(navigationRow);

        // صف إدارة السجلات
        const manageRow = new ActionRowBuilder();

        const deleteRecordButton = new ButtonBuilder()
            .setCustomId(`delete_record_${selectedRoleId}_${currentPage}`)
            .setLabel('حذف هذا السجل')
            .setStyle(ButtonStyle.Danger);

        const deleteAllButton = new ButtonBuilder()
            .setCustomId(`delete_all_records_${selectedRoleId}`)
            .setLabel('حذف جميع السجلات')
            .setStyle(ButtonStyle.Danger);

        const backButton = new ButtonBuilder()
            .setCustomId('promote_records_back')
            .setLabel('العودة')
            .setStyle(ButtonStyle.Primary);

        manageRow.addComponents(deleteRecordButton, deleteAllButton, backButton);
        components.push(manageRow);

        await interaction.update({
            embeds: [embed],
            content: '',
            components: components
        });
        return;
    }

    // Handle back to roles list button
    if (interaction.isButton() && customId === 'promote_records_back') {
        // إعادة توجيه إلى قائمة الرولات
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        const adminRoles = readJson(adminRolesPath, []);

        if (adminRoles.length === 0) {
            await interaction.update({
                content: 'لا توجد رولات إدارية محددة!',
                components: []
            });
            return;
        }

        const availableRoles = adminRoles.map(roleId => {
            const role = interaction.guild.roles.cache.get(roleId);
            return role ? {
                label: role.name,
                value: roleId,
                description: `عرض سجلات ترقيات ${role.name}`
            } : null;
        }).filter(Boolean).slice(0, 25);

        const roleSelect = new StringSelectMenuBuilder()
            .setCustomId('promote_records_select_role')
            .setPlaceholder('اختر الرول لعرض سجلات ترقياته...')
            .addOptions(availableRoles);

        const roleRow = new ActionRowBuilder().addComponents(roleSelect);

        await interaction.update({
            content: 'اختر الرول لعرض سجلات ترقياته:',
            components: [roleRow]
        });
        return;
    }

    // معالج مودال حظر الترقيات
    if (interaction.isModalSubmit() && customId.startsWith('promote_ban_modal_')) {
        const { client } = context;
        const userId = customId.split('_')[3];
        const duration = interaction.fields.getTextInputValue('ban_duration').trim();
        const reason = interaction.fields.getTextInputValue('ban_reason').trim();

        let parsedDuration = null;
        if (duration !== 'نهائي' && duration !== 'permanent') {
            parsedDuration = ms(duration);
            if (!parsedDuration) {
                await interaction.reply({
                    content: '❌ صيغة المدة غير صحيحة! استخدم: 30d, 7d, أو نهائي',
                    ephemeral: true
                });
                return;
            }
        }

        const result = await promoteManager.addPromotionBan(
            interaction.guild,
            client,
            userId,
            duration === 'نهائي' || duration === 'permanent' ? null : parsedDuration,
            reason,
            interaction.user.id
        );

        if (result.success) {
            const successEmbed = colorManager.createEmbed()
                .setTitle('تم الحظر من الترقيات')
                .setDescription(`تم حظر <@${userId}> من الترقيات بنجاح`)
                .addFields([
                    { name: 'المدة', value: duration, inline: true },
                    { name: 'السبب', value: reason, inline: false },
                    { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true }
                ])
                .setTimestamp();

            await interaction.reply({
                embeds: [successEmbed],
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: `❌ ${result.error}`,
                ephemeral: true
            });
        }
        return;
    }

    // معالجات سجلات المستخدم مع pagination
    if (interaction.isUserSelectMenu() && customId === 'promote_records_select_user') {
        const selectedUserId = interaction.values[0];
        
        // Use enhanced display system instead of basic one
        await displayEnhancedUserRecords(interaction, selectedUserId, 0);
        return;
    }

    // أزرار التنقل لسجلات المستخدم
    if (interaction.isButton() && customId.startsWith('user_record_prev_')) {
        const parts = customId.split('_');
        const userId = parts[3];
        const currentPage = parseInt(parts[4]);
        const records = await promoteManager.getUserPromotionRecords(userId, interaction.guild.id);
        await displayUserRecord(interaction, userId, currentPage - 1, records);
        return;
    }

    if (interaction.isButton() && customId.startsWith('user_record_next_')) {
        const parts = customId.split('_');
        const userId = parts[3];
        const currentPage = parseInt(parts[4]);
        const records = await promoteManager.getUserPromotionRecords(userId, interaction.guild.id);
        await displayUserRecord(interaction, userId, currentPage + 1, records);
        return;
    }

    // حذف سجل واحد للمستخدم
    if (interaction.isButton() && customId.startsWith('delete_user_record_')) {
        const parts = customId.split('_');
        const userId = parts[3];
        const recordIndex = parseInt(parts[4]);
        await handleDeleteUserRecord(interaction, userId, recordIndex);
        return;
    }

    // حذف جميع سجلات المستخدم
    if (interaction.isButton() && customId.startsWith('delete_all_user_records_')) {
        const userId = customId.split('_')[4];

        const confirmEmbed = colorManager.createEmbed()
            .setTitle('تأكيد حذف جميع السجلات')
            .setDescription(`هل أنت متأكد من حذف جميع سجلات <@${userId}>؟\n\n**تحذير:** هذا الإجراء لا يمكن التراجع عنه!`)
            .setTimestamp();

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_delete_all_user_${userId}`)
            .setLabel('تأكيد الحذف')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId(`cancel_delete_user`)
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary);

        const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.update({
            embeds: [confirmEmbed],
            components: [buttonRow]
        });
        return;
    }

    if (interaction.isButton() && customId.startsWith('confirm_delete_all_user_')) {
        const userId = customId.split('_')[4];
        await handleDeleteAllUserRecords(interaction, userId);
        return;
    }

    if (interaction.isButton() && customId === 'cancel_delete_user') {
        await interaction.update({
            content: 'تم إلغاء عملية الحذف',
            embeds: [],
            components: []
        });
        return;
    }

    if (interaction.isButton() && customId === 'promote_user_records_back') {
        const userSelect = new UserSelectMenuBuilder()
            .setCustomId('promote_records_select_user')
            .setPlaceholder('اختر المستخدم لعرض سجلاته...')
            .setMaxValues(1);

        const userRow = new ActionRowBuilder().addComponents(userSelect);

        await interaction.update({
            content: 'اختر المستخدم لعرض سجلات ترقياته:',
            components: [userRow]
        });
        return;
    }
}

async function getActivityRating(userStats, context) {
    try {
        // الحصول على إحصائيات جميع الأعضاء للمقارنة
        const guildAverages = await calculateGuildAverages(context);

        if (!guildAverages) {
            // في حالة عدم توفر البيانات، استخدام نظام النسب المرن
            return getFlexibleRating(userStats);
        }

        // حساب النسب المئوية مقارنة بالمتوسط
        const voicePercentage = guildAverages.avgVoiceTime > 0 ? 
            (userStats.totalVoiceTime / guildAverages.avgVoiceTime) * 100 : 0;

        const messagesPercentage = guildAverages.avgMessages > 0 ? 
            (userStats.totalMessages / guildAverages.avgMessages) * 100 : 0;

        const reactionsPercentage = guildAverages.avgReactions > 0 ? 
            (userStats.totalReactions / guildAverages.avgReactions) * 100 : 0;

        const activeDaysPercentage = guildAverages.avgActiveDays > 0 ? 
            (userStats.activeDays / guildAverages.avgActiveDays) * 100 : 0;

        // حساب المتوسط الإجمالي للنسب
        const overallPercentage = (voicePercentage + messagesPercentage + reactionsPercentage + activeDaysPercentage) / 4;

        // تحديد التقييم بناءً على النسبة المئوية مقارنة بالمتوسط
        let rating, emoji, description;

        if (overallPercentage >= 150) {
            rating = '🌟 **ممتاز جداً**';
            emoji = '🌟';
            description = `أداء استثنائي (${Math.round(overallPercentage)}% من المتوسط)`;
        } else if (overallPercentage >= 120) {
            rating = '⭐ **ممتاز**';
            emoji = '⭐';
            description = `أداء ممتاز (${Math.round(overallPercentage)}% من المتوسط)`;
        } else if (overallPercentage >= 90) {
            rating = '✅ **جيد جداً**';
            emoji = '✅';
            description = `أداء جيد جداً (${Math.round(overallPercentage)}% من المتوسط)`;
        } else if (overallPercentage >= 70) {
            rating = '🟡 **جيد**';
            emoji = '🟡';
            description = `أداء جيد (${Math.round(overallPercentage)}% من المتوسط)`;
        } else if (overallPercentage >= 50) {
            rating = '🔸 **متوسط**';
            emoji = '🔸';
            description = `أداء متوسط (${Math.round(overallPercentage)}% من المتوسط)`;
        } else if (overallPercentage >= 30) {
            rating = '⚠️ **ضعيف**';
            emoji = '⚠️';
            description = `أداء ضعيف (${Math.round(overallPercentage)}% من المتوسط)`;
        } else {
            rating = '❌ **ضعيف جداً**';
            emoji = '❌';
            description = `أداء ضعيف جداً (${Math.round(overallPercentage)}% من المتوسط)`;
        }

        return {
            rating,
            emoji,
            description,
            percentage: Math.round(overallPercentage),
            details: {
                voice: Math.round(voicePercentage),
                messages: Math.round(messagesPercentage),
                reactions: Math.round(reactionsPercentage),
                activeDays: Math.round(activeDaysPercentage)
            },
            averages: guildAverages
        };

    } catch (error) {
        console.error('خطأ في حساب تقييم النشاط:', error);
        return getFlexibleRating(userStats);
    }
}

// حساب متوسطات السيرفر
async function calculateGuildAverages(context) {
    try {
        const database = context.database;
        if (!database) {
            console.log('قاعدة البيانات غير متاحة لحساب المتوسطات');
            return null;
        }

        // حساب متوسطات النشاط من قاعدة البيانات
        const averages = await database.get(`
            SELECT 
                AVG(total_voice_time) as avgVoiceTime,
                AVG(total_messages) as avgMessages,
                AVG(total_reactions) as avgReactions,
                COUNT(*) as totalUsers
            FROM user_totals 
            WHERE total_messages > 0 OR total_voice_time > 0
        `);

        if (!averages || averages.totalUsers === 0) {
            return null;
        }

        // حساب متوسط الأيام النشطة (تقدير معقول)
        const avgActiveDays = Math.max(7, averages.totalUsers > 50 ? 14 : 10);

        return {
            avgVoiceTime: averages.avgVoiceTime || 0,
            avgMessages: averages.avgMessages || 0,
            avgReactions: averages.avgReactions || 0,
            avgActiveDays: avgActiveDays,
            totalUsers: averages.totalUsers,
            lastUpdated: Date.now()
        };

    } catch (error) {
        console.error('خطأ في حساب متوسطات السيرفر:', error);
        return null;
    }
}

// نظام التقييم المرن (في حالة عدم توفر بيانات المقارنة)
function getFlexibleRating(userStats) {
    // حساب نقاط مرنة بناءً على النشاط العام
    let score = 0;

    // نقاط الوقت الصوتي (0-30 نقطة)
    const voiceHours = userStats.totalVoiceTime / 3600000; // تحويل من milliseconds إلى ساعات
    if (voiceHours >= 50) score += 30;
    else if (voiceHours >= 25) score += 25;
    else if (voiceHours >= 10) score += 20;
    else if (voiceHours >= 5) score += 15;
    else if (voiceHours >= 1) score += 10;

    // نقاط الرسائل (0-25 نقطة)
    if (userStats.totalMessages >= 500) score += 25;
    else if (userStats.totalMessages >= 250) score += 20;
    else if (userStats.totalMessages >= 100) score += 15;
    else if (userStats.totalMessages >= 50) score += 10;
    else if (userStats.totalMessages >= 10) score += 5;

    // نقاط التفاعلات (0-20 نقطة)
    if (userStats.totalReactions >= 100) score += 20;
    else if (userStats.totalReactions >= 50) score += 15;
    else if (userStats.totalReactions >= 25) score += 10;
    else if (userStats.totalReactions >= 10) score += 5;

    // نقاط الأيام النشطة (0-25 نقطة)
    if (userStats.activeDays >= 20) score += 25;
    else if (userStats.activeDays >= 15) score += 20;
    else if (userStats.activeDays >= 10) score += 15;
    else if (userStats.activeDays >= 7) score += 10;
    else if (userStats.activeDays >= 3) score += 5;

    // تحديد التقييم بناءً على النقاط
    let rating, emoji, description;

    if (score >= 80) {
        rating = '🌟 **ممتاز**';
        emoji = '🌟';
        description = `نشاط ممتاز (${score}/100 نقطة)`;
    } else if (score >= 65) {
        rating = '⭐ **جيد جداً**';
        emoji = '⭐';
        description = `نشاط جيد جداً (${score}/100 نقطة)`;
    } else if (score >= 50) {
        rating = '✅ **جيد**';
        emoji = '✅';
        description = `نشاط جيد (${score}/100 نقطة)`;
    } else if (score >= 35) {
        rating = '🟡 **متوسط**';
        emoji = '🟡';
        description = `نشاط متوسط (${score}/100 نقطة)`;
    } else if (score >= 20) {
        rating = '⚠️ **ضعيف**';
        emoji = '⚠️';
        description = `نشاط ضعيف (${score}/100 نقطة)`;
    } else {
        rating = '❌ **ضعيف جداً**';
        emoji = '❌';
        description = `نشاط ضعيف جداً (${score}/100 نقطة)`;
    }

    return {
        rating,
        emoji,
        description,
        score,
        details: {
            voice: Math.round(voiceHours * 10) / 10,
            messages: userStats.totalMessages,
            reactions: userStats.totalReactions,
            activeDays: userStats.activeDays
        },
        method: 'flexible'
    };
}

async function handleEditSettings(interaction, context) {
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {});

    const editEmbed = colorManager.createEmbed()
        .setTitle('Edit System Settings')
        .setDescription('اختر الإعداد الذي تريد تعديله')
        .addFields([
            { name: ' المعتمدين الحاليين', value: settings.allowedUsers?.type ? `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets?.length || 0})` : 'غير محدد', inline: true },
            { name: ' روم السجلات', value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', inline: true },
            { name: ' روم المنيو', value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', inline: true }
        ]);

    const editSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_edit_settings_menu')
        .setPlaceholder('اختر الإعداد للتعديل...')
        .addOptions([
            {
                label: 'تعديل المعتمدين',
                value: 'edit_permissions',
                description: 'تغيير من يحق له استخدام النظام'
            },
            {
                label: 'تعديل روم السجلات',
                value: 'edit_log_channel',
                description: 'تغيير قناة حفظ سجلات الترقيات'
            },
            {
                label: 'تعديل روم المنيو',
                value: 'edit_menu_channel',
                description: 'تغيير قناة المنيو التفاعلي'
            }
        ]);

    const editRow = new ActionRowBuilder().addComponents(editSelect);

    await interaction.update({
        embeds: [editEmbed],
        components: [editRow]
    });
}

async function handleEditPermissions(interaction, context) {
    const permissionSelect = new StringSelectMenuBuilder()
        .setCustomId('promote_edit_permission_type')
        .setPlaceholder(' اختر نوع المعتمدين الجديد...')
        .addOptions([
            {
                label: 'المالكين فقط',
                value: 'owners',
                description: 'السماح للمالكين فقط باستخدام النظام'
            },
            {
                label: 'رولات محددة',
                value: 'roles',
                description: 'السماح لحاملي رولات معينة'
            },
            {
                label: 'مسؤوليات محددة',
                value: 'responsibility',
                description: 'السماح للمسؤولين عن مسؤوليات معينة'
            }
        ]);

    const permissionRow = new ActionRowBuilder().addComponents(permissionSelect);

    await interaction.update({
        content: ' **اختر نوع المعتمدين الجديد:**',
        components: [permissionRow]
    });
}

async function handleEditLogChannel(interaction, context) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('promote_edit_log_channel_select')
        .setPlaceholder(' اختر روم السجلات الجديدة...')
        .setChannelTypes([ChannelType.GuildText]);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.update({
        content: ' **اختر روم السجلات الجديدة:**',
        components: [channelRow]
    });
}

async function handleEditMenuChannel(interaction, context) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('promote_edit_menu_channel_select')
        .setPlaceholder(' اختر روم المنيو الجديدة...')
        .setChannelTypes([ChannelType.GuildText]);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.update({
        content: ' **اختر روم المنيو الجديدة:**',
        components: [channelRow]
    });
}

async function createSystemStats() {
    const stats = promoteManager.getSystemStats();
    const activePromotes = promoteManager.getActivePromotes();
    const totalPromotes = Object.keys(activePromotes).length;
    const bans = promoteManager.getPromotionBans();
    const totalBans = Object.keys(bans).length;

    const embed = colorManager.createEmbed()
        .setTitle('📊 **إحصائيات نظام الترقيات**')
        .setDescription('ملخص شامل لحالة النظام')
        .addFields([
            { name: '🎖️ **الترقيات النشطة**', value: `${totalPromotes}`, inline: true },
            { name: '🚫 **المحظورين**', value: `${totalBans}`, inline: true },
            { name: '📈 **إجمالي الترقيات**', value: `${stats?.totalPromotions || 0}`, inline: true },
            { name: '⏰ **النظام يعمل منذ**', value: `<t:${Math.floor((stats?.systemStartTime || Date.now()) / 1000)}:R>`, inline: false }
        ])
        .setTimestamp();

    return embed;
}

async function handleDetailedStats(interaction, context) {
    const statsEmbed = await createSystemStats();
    await interaction.update({
        embeds: [statsEmbed],
        components: []
    });
}

async function handleResetSystem(interaction, context) {
    const confirmEmbed = colorManager.createEmbed()
        .setTitle('Reset Confirmation')
        .setDescription('هل أنت متأكد من أنك تريد إعادة تعيين جميع إعدادات النظام؟')
        .addFields([
            { name: '🔄 سيتم حذف:', value: '• جميع الإعدادات\n• الترقيات النشطة\n• السجلات', inline: false },
            { name: '⚠️ تحذير:', value: 'هذا الإجراء لا يمكن التراجع عنه!', inline: false }
        ]);

    const confirmButton = new ButtonBuilder()
        .setCustomId('promote_confirm_reset')
        .setLabel(' تأكيد الإعادة')
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('promote_cancel_reset')
        .setLabel(' إلغاء')
        .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    await interaction.update({
        embeds: [confirmEmbed],
        components: [buttonRow]
    });
}

// معالجات حذف السجلات
async function handleDeleteSingleRecord(interaction, roleId, recordIndex) {
    try {
        // التحقق من صحة التفاعل أولاً
        if (interaction.replied || interaction.deferred) {
            console.log('التفاعل تم الرد عليه مسبقاً');
            return;
        }

        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        // Filter records for the specific role
        let roleRecords = promoteLogs.filter(log => {
            if (!log.data) return false;

            if (log.type === 'BULK_PROMOTION') {
                return log.data.targetRoleId === roleId || log.data.sourceRoleId === roleId;
            } else if (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') {
                return log.data.roleId === roleId || log.data.role?.id === roleId;
            } else if (log.type === 'MULTI_PROMOTION_APPLIED') {
                return log.data.roleIds && log.data.roleIds.includes(roleId);
            }

            return log.data.roleId === roleId;
        });

        if (recordIndex >= roleRecords.length) {
            await interaction.update({
                content: 'السجل المحدد غير موجود!',
                embeds: [],
                components: []
            });
            return;
        }

        const recordToDelete = roleRecords[recordIndex];

        // Find and remove the record from the main logs array
        const mainIndex = promoteLogs.findIndex(log => 
            log.timestamp === recordToDelete.timestamp && 
            log.type === recordToDelete.type &&
            JSON.stringify(log.data) === JSON.stringify(recordToDelete.data)
        );

        if (mainIndex !== -1) {
            promoteLogs.splice(mainIndex, 1);
            saveJson(promoteLogsPath, promoteLogs);
        }

        // تحديث القائمة بعد الحذف
        roleRecords = promoteLogs.filter(log => {
            if (!log.data) return false;

            if (log.type === 'BULK_PROMOTION') {
                return log.data.targetRoleId === roleId || log.data.sourceRoleId === roleId;
            } else if (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') {
                return log.data.roleId === roleId || log.data.role?.id === roleId;
            } else if (log.type === 'MULTI_PROMOTION_APPLIED') {
                return log.data.roleIds && log.data.roleIds.includes(roleId);
            }

            return log.data.roleId === roleId;
        });

        const successEmbed = colorManager.createEmbed()
            .setTitle('✅ تم حذف السجل')
            .setDescription('تم حذف السجل بنجاح من قاعدة البيانات')
            .addFields([
                { name: 'السجلات المتبقية', value: roleRecords.length.toString(), inline: true },
                { name: 'تم الحذف', value: 'نعم', inline: true }
            ])
            .setTimestamp();

        if (roleRecords.length === 0) {
            await interaction.update({
                embeds: [successEmbed],
                content: `✅ تم حذف السجل. لا توجد المزيد من السجلات للرول <@&${roleId}>`,
                components: []
            });
        } else {
            // العودة لقائمة السجلات
            const backButton = new ButtonBuilder()
                .setCustomId('promote_records_back')
                .setLabel('عودة لقائمة الرولات')
                .setStyle(ButtonStyle.Primary);

            const backRow = new ActionRowBuilder().addComponents(backButton);

            await interaction.update({
                embeds: [successEmbed],
                content: `✅ تم حذف السجل. المتبقي ${roleRecords.length} سجل للرول <@&${roleId}>`,
                components: [backRow]
            });
        }

    } catch (error) {
        console.error('خطأ في حذف السجل:', error);

        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ حدث خطأ أثناء حذف السجل.',
                    ephemeral: true
                });
            } else {
                await interaction.followUp({
                    content: '❌ حدث خطأ أثناء حذف السجل.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            console.error('خطأ في الرد على خطأ حذف السجل:', replyError);
        }
    }
}

async function handleDeleteAllRecords(interaction, roleId) {
    try {
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        // حذف جميع السجلات للرول المحدد
        const updatedLogs = promoteLogs.filter(log => {
            if (!log.data) return true;
            if (log.type === 'BULK_PROMOTION') {
                return !(log.data.targetRoleId === roleId || log.data.sourceRoleId === roleId);
            } else if (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') {
                return !(log.data.roleId === roleId || log.data.role?.id === roleId);
            }
            return log.data.roleId !== roleId;
        });

        const deletedCount = promoteLogs.length - updatedLogs.length;
        saveJson(promoteLogsPath, updatedLogs);

        const successEmbed = colorManager.createEmbed()
            .setTitle('تم حذف جميع السجلات')
            .setDescription(
                `تم حذف جميع سجلات الرول بنجاح\n\n` +
                `الرول: <@&${roleId}>\n` +
                `عدد السجلات المحذوفة: ${deletedCount}\n` +
                `تم الحذف بواسطة: <@${interaction.user.id}>`
            )
            .setTimestamp();

        await interaction.reply({
            embeds: [successEmbed],
            ephemeral: true
        });

        // تحديث الرسالة الأصلية
        await interaction.message.edit({
            content: `تم حذف جميع السجلات للرول <@&${roleId}>`,
            embeds: [],
            components: []
        });

    } catch (error) {
        console.error('خطأ في حذف جميع السجلات:', error);
        await interaction.reply({
            content: 'حدث خطأ أثناء حذف السجلات!',
            ephemeral: true
        });
    }
}

async function displayUserRecord(interaction, userId, currentPage, records) {
    const totalRecords = records.length;
    currentPage = Math.max(0, Math.min(currentPage, totalRecords - 1));
    const record = records[currentPage];

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const memberName = member ? member.displayName : 'العضو';

    const recordDate = new Date(record.timestamp || Date.now());
    const timestamp = Math.floor(recordDate.getTime() / 1000);
    const duration = record.duration || 'نهائي';
    const reason = record.reason || 'لم يتم تحديد سبب';
    const moderatorId = record.data?.byUserId || record.data?.moderatorId || 'غير معروف';

    let actionType = '';
    let rolesInfo = '';

    if (record.type === 'BULK_PROMOTION') {
        actionType = '👥 ترقية جماعية';
        const sourceRole = record.data?.sourceRoleName || 'غير محدد';
        const targetRole = record.roleName || 'غير محدد';
        rolesInfo = `من الرول: **${sourceRole}**\nإلى الرول: **${targetRole}**`;
    } else if (record.type === 'PROMOTION_APPLIED') {
        actionType = '⬆️ ترقية فردية';

        if (record.data?.addedRoles && record.data.addedRoles.length > 0) {
            const addedRoleNames = record.data.addedRoles.map(r => r.name || r).join('**, **');
            rolesInfo = `تمت إضافة: **${addedRoleNames}**`;
        } else {
            const currentRole = record.roleName || 'غير محدد';
            const previousRole = record.data?.previousRole?.name || 'بدون رول سابق';
            rolesInfo = `من: **${previousRole}**\nإلى: **${currentRole}**`;
        }

        if (record.data?.removedRoles && record.data.removedRoles.length > 0) {
            const removedRoleNames = record.data.removedRoles.map(r => r.name || r).join('**, **');
            rolesInfo += `\n\nتمت إزالة: **${removedRoleNames}**`;
        }
    } else if (record.type === 'PROMOTION_ENDED') {
        actionType = '⏰ انتهاء ترقية';
        const endedRole = record.roleName || 'غير محدد';
        rolesInfo = `انتهت مدة الرول: **${endedRole}**`;
    }

    let statusInfo = '';
    if (record.type === 'PROMOTION_APPLIED' && duration !== 'نهائي') {
        const endTime = record.data?.endTime;
        if (endTime) {
            const isExpired = Date.now() > endTime;
            statusInfo = isExpired ? '\n🔴 **الحالة:** منتهية' : '\n🟢 **الحالة:** نشطة';
        }
    }

    const embed = colorManager.createEmbed()
        .setTitle(`📋 سجل ترقية - ${memberName}`)
        .setDescription(
            `**رقم السجل:** ${currentPage + 1} من ${totalRecords}\n\n` +
            `${actionType}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📝 **تفاصيل الرولات:**\n${rolesInfo}\n\n` +
            `💬 **السبب:**\n${reason}\n\n` +
            `⏱️ **المدة:** ${duration}\n\n` +
            `📅 **التاريخ:** <t:${timestamp}:F>\n` +
            `⏰ **منذ:** <t:${timestamp}:R>\n\n` +
            `👤 **بواسطة:** <@${moderatorId}>` +
            statusInfo
        )
        .setThumbnail(member?.displayAvatarURL({ dynamic: true }) || interaction.guild.iconURL({ dynamic: true }))
        .setFooter({ text: `معرف السجل: ${record.timestamp}` })
        .setTimestamp();

    const navigationRow = new ActionRowBuilder();

    const prevButton = new ButtonBuilder()
        .setCustomId(`user_record_prev_${userId}_${currentPage}`)
        .setLabel('السابق')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0);

    const pageButton = new ButtonBuilder()
        .setCustomId(`user_record_page`)
        .setLabel(`${currentPage + 1} / ${totalRecords}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

    const nextButton = new ButtonBuilder()
        .setCustomId(`user_record_next_${userId}_${currentPage}`)
        .setLabel('التالي')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalRecords - 1);

    navigationRow.addComponents(prevButton, pageButton, nextButton);

    const manageRow = new ActionRowBuilder();

    const deleteRecordButton = new ButtonBuilder()
        .setCustomId(`delete_user_record_${userId}_${currentPage}`)
        .setLabel('حذف هذا السجل')
        .setStyle(ButtonStyle.Danger);

    const deleteAllButton = new ButtonBuilder()
        .setCustomId(`delete_all_user_records_${userId}`)
        .setLabel('حذف جميع السجلات')
        .setStyle(ButtonStyle.Danger);

    const backButton = new ButtonBuilder()
        .setCustomId('promote_user_records_back')
        .setLabel('العودة')
        .setStyle(ButtonStyle.Primary);

    manageRow.addComponents(deleteRecordButton, deleteAllButton, backButton);

    const updateMethod = interaction.replied || interaction.deferred ? 'editReply' : 'update';
    await interaction[updateMethod]({
        embeds: [embed],
        components: [navigationRow, manageRow]
    });
}

async function handleDeleteUserRecord(interaction, userId, recordIndex) {
    try {
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        const userRecords = promoteLogs.filter(log => {
            const targetUserId = log.data?.targetUserId || log.data?.userId;
            return targetUserId === userId;
        });

        if (recordIndex >= userRecords.length) {
            await interaction.update({
                content: 'السجل المحدد غير موجود!',
                embeds: [],
                components: []
            });
            return;
        }

        const recordToDelete = userRecords[recordIndex];
        const mainIndex = promoteLogs.findIndex(log => 
            log.timestamp === recordToDelete.timestamp && 
            JSON.stringify(log.data) === JSON.stringify(recordToDelete.data)
        );

        if (mainIndex !== -1) {
            promoteLogs.splice(mainIndex, 1);
            saveJson(promoteLogsPath, promoteLogs);
        }

        const successEmbed = colorManager.createEmbed()
            .setTitle('✅ تم حذف السجل')
            .setDescription('تم حذف السجل بنجاح')
            .addFields([
                { name: 'تم الحذف بواسطة', value: `<@${interaction.user.id}>`, inline: true }
            ])
            .setTimestamp();

        await interaction.update({
            embeds: [successEmbed],
            components: []
        });
    } catch (error) {
        console.error('خطأ في حذف سجل المستخدم:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء حذف السجل.',
            ephemeral: true
        });
    }
}

async function handleDeleteAllUserRecords(interaction, userId) {
    try {
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        const updatedLogs = promoteLogs.filter(log => {
            const targetUserId = log.data?.targetUserId || log.data?.userId;
            return targetUserId !== userId;
        });

        const deletedCount = promoteLogs.length - updatedLogs.length;
        saveJson(promoteLogsPath, updatedLogs);

        const successEmbed = colorManager.createEmbed()
            .setTitle('تم حذف جميع السجلات')
            .setDescription(
                `تم حذف جميع سجلات المستخدم بنجاح\n\n` +
                `المستخدم: <@${userId}>\n` +
                `عدد السجلات المحذوفة: ${deletedCount}\n` +
                `تم الحذف بواسطة: <@${interaction.user.id}>`
            )
            .setTimestamp();

        await interaction.update({
            embeds: [successEmbed],
            components: []
        });
    } catch (error) {
        console.error('خطأ في حذف جميع سجلات المستخدم:', error);
        await interaction.reply({
            content: 'حدث خطأ أثناء حذف السجلات!',
            ephemeral: true
        });
    }
}

// Enhanced user record navigation handlers
if (interaction.isButton() && customId.startsWith('enhanced_user_prev_')) {
    const parts = customId.split('_');
    const userId = parts[3];
    const currentPage = parseInt(parts[4]);
    await displayEnhancedUserRecords(interaction, userId, currentPage - 1);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_next_')) {
    const parts = customId.split('_');
    const userId = parts[3];
    const currentPage = parseInt(parts[4]);
    await displayEnhancedUserRecords(interaction, userId, currentPage + 1);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_export_')) {
    const userId = customId.split('_')[3];
    await handleExportUserRecords(interaction, userId);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_delete_')) {
    const userId = customId.split('_')[3];
    await handleDeleteAllUserRecordsEnhanced(interaction, userId);
    return;
}

async function handleExportUserRecords(interaction, userId) {
    try {
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const allLogs = readJson(promoteLogsPath, []);
        
        const userRecords = allLogs.filter(log => {
            const targetUserId = log.data?.targetUserId || log.data?.userId;
            return targetUserId === userId;
        }).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

        if (userRecords.length === 0) {
            await interaction.reply({
                content: 'لا توجد سجلات للتصدير.',
                ephemeral: true
            });
            return;
        }

        // Create formatted text export
        let exportContent = `سجلات ترقيات العضو: ${userId}\n`;
        exportContent += `عدد السجلات: ${userRecords.length}\n`;
        exportContent += `تاريخ الاستخراج: ${new Date().toLocaleString('ar-SA')}\n`;
        exportContent += '='.repeat(50) + '\n\n';

        userRecords.forEach((record, index) => {
            const data = record.data || {};
            const date = new Date(record.timestamp || Date.now());
            
            exportContent += `سجل #${index + 1}:\n`;
            exportContent += `التاريخ: ${date.toLocaleString('ar-SA')}\n`;
            exportContent += `النوع: ${record.type}\n`;
            
            if (record.type === 'PROMOTION_APPLIED') {
                exportContent += `العضو: ${data.targetUserId || data.userId}\n`;
                exportContent += `الدور: ${record.roleName || data.role?.name || 'غير محدد'}\n`;
                exportContent += `المدة: ${data.duration || 'دائمة'}\n`;
                exportContent += `السبب: ${data.reason || 'غير محدد'}\n`;
                exportContent += `المدير: ${data.byUserId || data.moderatorId || 'غير محدد'}\n`;
            } else if (record.type === 'BULK_PROMOTION') {
                exportContent += `من الدور: ${data.sourceRoleName || data.sourceRole?.name || 'غير محدد'}\n`;
                exportContent += `إلى الدور: ${data.targetRoleName || data.targetRole?.name || 'غير محدد'}\n`;
                exportContent += `عدد الأعضاء: ${data.successCount || data.successfulMembers?.length || 0}\n`;
                exportContent += `السبب: ${data.reason || 'غير محدد'}\n`;
                exportContent += `المدير: ${data.byUserId || data.moderatorId || 'غير محدد'}\n`;
            }
            
            exportContent += '-'.repeat(30) + '\n\n';
        });

        // Save to temporary file
        const exportFileName = `user_${userId}_promotions_${Date.now()}.txt`;
        const exportPath = path.join(__dirname, '..', 'exports', exportFileName);
        
        // Create exports directory if it doesn't exist
        const exportsDir = path.dirname(exportPath);
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }
        
        fs.writeFileSync(exportPath, exportContent, 'utf8');

        await interaction.reply({
            content: `✅ تم تصدير السجلات بنجاح! الملف: ${exportFileName}`,
            files: [exportPath],
            ephemeral: true
        });

        // Clean up file after sending
        setTimeout(() => {
            try {
                fs.unlinkSync(exportPath);
            } catch (error) {
                console.error('Error cleaning up export file:', error);
            }
        }, 60000); // Delete after 1 minute

    } catch (error) {
        console.error('Error exporting user records:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء تصدير السجلات.',
            ephemeral: true
        });
    }
}

async function handleDeleteAllUserRecordsEnhanced(interaction, userId) {
    try {
        // Confirmation first
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_delete_user_${userId}`)
            .setLabel('تأكيد الحذف')
            .setStyle(ButtonStyle.Danger);
        
        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_delete_user')
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.reply({
            content: `⚠️ هل أنت متأكد من حذف جميع سجلات ترقيات هذا العضو؟`,
            components: [row],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error in delete confirmation:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء معالجة طلب الحذف.',
            ephemeral: true
        });
    }
}

// Enhanced user record navigation handlers
if (interaction.isButton() && customId.startsWith('enhanced_user_prev_')) {
    const parts = customId.split('_');
    const userId = parts[3];
    const currentPage = parseInt(parts[4]);
    await displayEnhancedUserRecords(interaction, userId, currentPage - 1);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_next_')) {
    const parts = customId.split('_');
    const userId = parts[3];
    const currentPage = parseInt(parts[4]);
    await displayEnhancedUserRecords(interaction, userId, currentPage + 1);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_export_')) {
    const userId = customId.split('_')[3];
    await handleExportUserRecords(interaction, userId);
    return;
}

if (interaction.isButton() && customId.startsWith('enhanced_user_delete_')) {
    const userId = customId.split('_')[3];
    await handleDeleteAllUserRecordsEnhanced(interaction, userId);
    return;
}

async function handleExportUserRecords(interaction, userId) {
    try {
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const allLogs = readJson(promoteLogsPath, []);
        
        const userRecords = allLogs.filter(log => {
            const targetUserId = log.data?.targetUserId || log.data?.userId;
            return targetUserId === userId;
        }).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

        if (userRecords.length === 0) {
            await interaction.reply({
                content: 'لا توجد سجلات للتصدير.',
                ephemeral: true
            });
            return;
        }

        // Create formatted text export
        let exportContent = `سجلات ترقيات العضو: ${userId}\n`;
        exportContent += `عدد السجلات: ${userRecords.length}\n`;
        exportContent += `تاريخ الاستخراج: ${new Date().toLocaleString('ar-SA')}\n`;
        exportContent += '='.repeat(50) + '\n\n';

        userRecords.forEach((record, index) => {
            const data = record.data || {};
            const date = new Date(record.timestamp || Date.now());
            
            exportContent += `سجل #${index + 1}:\n`;
            exportContent += `التاريخ: ${date.toLocaleString('ar-SA')}\n`;
            exportContent += `النوع: ${record.type}\n`;
            
            if (record.type === 'PROMOTION_APPLIED') {
                exportContent += `العضو: ${data.targetUserId || data.userId}\n`;
                exportContent += `الدور: ${record.roleName || data.role?.name || 'غير محدد'}\n`;
                exportContent += `المدة: ${data.duration || 'دائمة'}\n`;
                exportContent += `السبب: ${data.reason || 'غير محدد'}\n`;
                exportContent += `المدير: ${data.byUserId || data.moderatorId || 'غير محدد'}\n`;
            } else if (record.type === 'BULK_PROMOTION') {
                exportContent += `من الدور: ${data.sourceRoleName || data.sourceRole?.name || 'غير محدد'}\n`;
                exportContent += `إلى الدور: ${data.targetRoleName || data.targetRole?.name || 'غير محدد'}\n`;
                exportContent += `عدد الأعضاء: ${data.successCount || data.successfulMembers?.length || 0} عضو\n`;
                exportContent += `السبب: ${data.reason || 'غير محدد'}\n`;
                exportContent += `المدير: ${data.byUserId || data.moderatorId || 'غير محدد'}\n`;
            }
            
            exportContent += '-'.repeat(30) + '\n\n';
        });

        // Save to temporary file
        const exportFileName = `user_${userId}_promotions_${Date.now()}.txt`;
        const exportPath = path.join(__dirname, '..', 'exports', exportFileName);
        
        // Create exports directory if it doesn't exist
        const exportsDir = path.dirname(exportPath);
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }
        
        fs.writeFileSync(exportPath, exportContent, 'utf8');

        await interaction.reply({
            content: `✅ تم تصدير السجلات بنجاح! الملف: ${exportFileName}`,
            files: [exportPath],
            ephemeral: true
        });

        // Clean up file after sending
        setTimeout(() => {
            try {
                fs.unlinkSync(exportPath);
            } catch (error) {
                console.error('Error cleaning up export file:', error);
            }
        }, 60000); // Delete after 1 minute

    } catch (error) {
        console.error('Error exporting user records:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء تصدير السجلات.',
            ephemeral: true
        });
    }
}

async function handleDeleteAllUserRecordsEnhanced(interaction, userId) {
    try {
        // Confirmation first
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_delete_user_${userId}`)
            .setLabel('تأكيد الحذف')
            .setStyle(ButtonStyle.Danger);
        
        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_delete_user')
            .setLabel('إلغاء')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        await interaction.reply({
            content: `⚠️ هل أنت متأكد من حذف جميع سجلات ترقيات هذا العضو؟`,
            components: [row],
            ephemeral: true
        });

    } catch (error) {
        console.error('Error in delete confirmation:', error);
        await interaction.reply({
            content: '❌ حدث خطأ أثناء معالجة طلب الحذف.',
            ephemeral: true
        });
    }
}

module.exports = { name, execute, handleInteraction, handleDeleteSingleRecord, handleDeleteAllRecords };