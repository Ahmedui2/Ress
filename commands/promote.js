;;const { ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');
const colorManager = require('../utils/colorManager');
const promoteManager = require('../utils/promoteManager');

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
                .setPlaceholder('اختر الرول المصدر للترقية...')
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

        // Filter admin roles that user doesn't already have and show higher roles only
        const memberHighestRole = member.roles.highest;
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

        const roleSelect = new StringSelectMenuBuilder()
            .setCustomId(`promote_role_${selectedUserId}`)
            .setPlaceholder('اختر الرول للترقية...')
            .addOptions(availableRoles);

        const roleRow = new ActionRowBuilder().addComponents(roleSelect);

        await interaction.reply({
            content: ` **اختر الرول لترقية العضو** <@${selectedUserId}>:`,
            components: [roleRow],
            ephemeral: true
        });
        return;
    }

    // Handle role selection for promotion
    if (interaction.isStringSelectMenu() && customId.startsWith('promote_role_')) {
        const userId = customId.split('_')[2];
        const roleId = interaction.values[0];

        // Create modal for duration and reason
        const modal = new ModalBuilder()
            .setCustomId(`promote_modal_${userId}_${roleId}`)
            .setTitle('تفاصيل الترقية');

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
            .setPlaceholder('اذكر سبب الترقية...');

        modal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );

        await interaction.showModal(modal);
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

        // Get promotion records from promoteLogs.json
        const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
        const promoteLogs = readJson(promoteLogsPath, []);

        const roleRecords = promoteLogs.filter(log => 
            log.data && log.data.roleId === selectedRoleId
        ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (roleRecords.length === 0) {
            await interaction.update({
                content: ` **الرول** <@&${selectedRoleId}> **ليس لديه أي سجلات ترقيات.**`,
                components: []
            });
            return;
        }

        // Create detailed embed with pagination
        const recordsPerPage = 5;
        let currentPage = 0;
        const totalPages = Math.ceil(roleRecords.length / recordsPerPage);

        function createRoleRecordsEmbed(page) {
            const start = page * recordsPerPage;
            const end = start + recordsPerPage;
            const pageRecords = roleRecords.slice(start, end);

            const embed = colorManager.createEmbed()
                .setTitle('Role Promotion Records')
                .setDescription(`**سجلات ترقيات الرول** <@&${selectedRoleId}>\n**الصفحة ${page + 1} من ${totalPages}** • **إجمالي السجلات: ${roleRecords.length}**`)
                .setTimestamp();

            pageRecords.forEach((record, index) => {
                const globalIndex = start + index + 1;

                // تحديد نوع الترقية والنص المناسب
                let actionText = '';
                if (record.type === 'BULK_PROMOTION') {
                    const sourceRoleName = record.data.sourceRoleName || 'غير محدد';
                    actionText = `تم ترقية جماعية من رول ${sourceRoleName} الى هذا الرول`;
                } else if (record.type === 'PROMOTION_APPLIED') {
                    const userName = record.data.targetUser?.username || `<@${record.data.targetUserId}>`;
                    const previousRoleName = record.data.previousRole?.name || 'لا يوجد رول';
                    actionText = `تم ترقية الشخص ${userName} الى هذا الرول من الرول ${previousRoleName}`;
                } else if (record.type === 'PROMOTION_ENDED') {
                    actionText = 'انتهت الترقية';
                } else {
                    actionText = 'إجراء غير معروف';
                }

                embed.addFields([
                    {
                        name: ` سجل رقم ${globalIndex}`,
                        value: `**الإجراء:** ${actionText}\n` +
                               `**العضو:** <@${record.data.targetUserId || record.data.userId}>\n` +
                               `**الرول:** <@&${record.data.roleId}>\n` +
                               `**المدة:** ${record.data.duration || 'نهائي'}\n` +
                               `**السبب:** ${record.data.reason || 'غير محدد'}\n` +
                               `**بواسطة:** <@${record.data.byUserId || record.data.moderatorId}>\n` +
                               `**التاريخ:** <t:${Math.floor(new Date(record.timestamp).getTime() / 1000)}:F>`,
                        inline: false
                    }
                ]);
            });

            return embed;
        }

        const embed = createRoleRecordsEmbed(currentPage);

        await interaction.update({
            embeds: [embed],
            content: '',
            components: []
        });
        return;
    }

    // Handle user selection for records
    if (interaction.isUserSelectMenu() && customId === 'promote_records_select_user') {
        const selectedUserId = interaction.values[0];

        const records = await promoteManager.getUserPromotionRecords(selectedUserId, interaction.guild.id);

        if (records.length === 0) {
            await interaction.reply({
                content: ` **العضو** <@${selectedUserId}> **ليس لديه أي سجلات ترقيات.**`,
                ephemeral: true
            });
            return;
        }

        const recordsEmbed = colorManager.createEmbed()
            .setTitle(' **سجلات الترقيات**')
            .setDescription(`سجلات ترقيات العضو <@${selectedUserId}>`)
            .addFields(records.slice(0, 25).map((record, index) => {
                // تحديد نوع الترقية والنص المناسب
                let actionDescription = '';
                if (record.type === 'BULK_PROMOTION') {
                    const sourceRoleName = record.data?.sourceRoleName || 'غير محدد';
                    const targetRoleName = record.roleName || `Role ID: ${record.roleId}`;
                    actionDescription = `تم ترقية جماعية من رول ${sourceRoleName} الى ${targetRoleName}`;
                } else if (record.type === 'PROMOTION_APPLIED') {
                    const previousRoleName = record.data?.previousRole?.name || 'لا يوجد رول';
                    const targetRoleName = record.roleName || `Role ID: ${record.roleId}`;
                    actionDescription = `تم ترقية الشخص الى ${targetRoleName} من الرول ${previousRoleName}`;
                } else {
                    actionDescription = record.roleName || `Role ID: ${record.roleId}`;
                }

                return {
                    name: `${index + 1}. ${actionDescription}`,
                    value: `**السبب:** ${record.reason}\n**المدة:** ${record.duration || 'نهائي'}\n**التاريخ:** <t:${Math.floor(new Date(record.timestamp).getTime() / 1000)}:F>`,
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

    // Handle user selection for banning
    if (interaction.isUserSelectMenu() && customId === 'promote_ban_select_user') {
        const selectedUserId = interaction.values[0];

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

                // إنشاء كائن إحصائيات للتقييم
                const memberStatObj = {
                    totalVoiceTime: voiceTime,
                    totalMessages: messages,
                    totalReactions: reactions,
                    totalVoiceJoins: voiceJoins,
                    activeDays: period === 'weekly' ? 7 : 30
                };

                // الحصول على تقييم العضو
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

        // حساب المتوسطات
        const avgVoiceMinutes = Math.round((totalVoiceTime / 60000) / membersWithRole.size);
        const avgMessages = Math.round(totalMessages / membersWithRole.size);
        const avgReactions = Math.round(totalReactions / membersWithRole.size);
        const avgVoiceJoins = Math.round(totalVoiceJoins / membersWithRole.size);

        // تصنيف الأعضاء حسب التقييم
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
            const bulkSourceRole = interaction.guild.roles.cache.get(sourceRoleId);
            const targetRole = interaction.guild.roles.cache.get(targetRoleId);

            if (!bulkSourceRole || !targetRole) {
                await interaction.reply({
                    content: ' **لم يتم العثور على أحد الرولات!**',
                    ephemeral: true
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

            // Process each member
            for (const [userId, member] of membersWithRole) {
                const banKey = `${userId}_${interaction.guild.id}`;

                // Check if banned
                if (promoteBans[banKey]) {
                    const banData = promoteBans[banKey];
                    const banEndTime = banData.endTime;

                    if (!banEndTime || banEndTime > Date.now()) {
                        bannedCount++;
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
                    results.push(`❌ ${member.displayName}: ${validation.error}`);
                    continue;
                }

                // Process promotion
                const result = await promoteManager.createPromotion(
                    interaction.guild,
                    context.client,
                    userId,
                    targetRoleId,
                    duration,
                    reason,
                    interaction.user.id
                );

                if (result.success) {
                    successCount++;
                    results.push(`✅ ${member.displayName}: تم ترقيته بنجاح`);

                    // Send DM notification
                    try {
                        const dmEmbed = colorManager.createEmbed()
                            .setTitle('** تم ترقيتك من رولك**')
                            .setDescription(`**تم ترقيتك من **${bulkSourceRole.name}** إلى **${targetRole.name}** ضمن ترقية للرول **`)
                            .addFields([
                                { name: '**الترقية**', value: `من: ${bulkSourceRole.name}\nإلى: **${targetRole.name}**`, inline: true },
                                { name: '**تمت الترقية بواسطة**', value: `${interaction.user.username}`, inline: true },
                                { name: '**المدة**', value: result.duration || 'نهائي', inline: true },
                                { name: '**السبب**', value: reason, inline: false },
                                { name: '**ينتهي في**', value: result.endTime ? `<t:${Math.floor(Number(result.endTime) / 1000)}:R>` : 'نهائي', inline: true }
                            ])
                            .setTimestamp()
                            .setFooter({ text: `سيرفرنا ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });

                        await member.send({ embeds: [dmEmbed] });
                    } catch (dmError) {
                        console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName} - قد تكون الرسائل الخاصة مغلقة`);
                    }
                } else {
                    failedCount++;
                    results.push(`❌ ${member.displayName}: ${result.error}`);
                }
            }

            // Collect mentions of successfully promoted members
            const promotedMembersMentions = [];
            for (const [userId, member] of membersWithRole) {
                if (results.some(result => result.includes(`✅ ${member.displayName}`))) {
                    promotedMembersMentions.push(`<@${userId}>`);
                }
            }

            // Create summary embed
            const summaryEmbed = colorManager.createEmbed()
                .setTitle(' **نتائج الترقية لرول**')
                .setDescription(`**تم ترقية أعضاء الرول من** <@&${sourceRoleId}> **إلى** <@&${targetRoleId}>\n\n` +
                    `**الإداريون المتأثرون:** ${promotedMembersMentions.slice(0, 10).join(' ')}\n` +
                    `${promotedMembersMentions.length > 10 ? `**وعدد إضافي: ${promotedMembersMentions.length - 10}**` : ''}`)
                .addFields([
                    { name: ' **تم بنجاح**', value: successCount.toString(), inline: true },
                    { name: ' **فشل**', value: failedCount.toString(), inline: true },
                    { name: ' **محظورين**', value: bannedCount.toString(), inline: true },
                    { name: ' **المدة**', value: duration === 'permanent' ? 'نهائي' : duration, inline: true },
                    { name: '**السبب**', value: String(reason), inline: false }
                ])
                .setTimestamp();

            if (results.length > 0) {
                const resultText = results.slice(0, 10).join('\n') + (results.length > 10 ? '\n**...والمزيد**' : '');
                summaryEmbed.addFields([
                    { name: ' تفاصيل النتائج', value: resultText, inline: false }
                ]);
            }

            await interaction.reply({ embeds: [summaryEmbed], ephemeral: true });

            // Log the bulk promotion
            promoteManager.logAction('BULK_PROMOTION', {
                sourceRoleId: bulkSourceRole.id,
                sourceRoleName: bulkSourceRole.name,
                targetRoleId: targetRole.id,
                targetRoleName: targetRole.name,
                moderatorId: interaction.user.id,
                duration: duration,
                reason: reason,
                successCount: successCount,
                failedCount: failedCount,
                bannedCount: bannedCount,
                guildId: interaction.guild.id,
                timestamp: Date.now()
            });

        } catch (error) {
            console.error('خطأ في معالجة الترقية الجماعية:', error);
            await interaction.reply({
                content: ' **حدث خطأ أثناء معالجة الترقية الجماعية!**',
                ephemeral: true
            });
        }
        return;
    }

    // Handle modal submission for promotion
    if (interaction.isModalSubmit() && customId.startsWith('promote_modal_')) {
        const [, , userId, roleId] = customId.split('_');
        const duration = interaction.fields.getTextInputValue('promote_duration');
        const reason = interaction.fields.getTextInputValue('promote_reason');

        try {
            const member = await interaction.guild.members.fetch(userId);
            const role = await interaction.guild.roles.fetch(roleId);

            if (!member || !role) {
                await interaction.reply({
                    content: ' **لم يتم العثور على العضو أو الرول!**',
                    ephemeral: true
                });
                return;
            }

            // Process the promotion
            const result = await promoteManager.createPromotion(
                interaction.guild,
                context.client,
                userId,
                roleId,
                duration,
                reason,
                interaction.user.id
            );

            if (result.success) {
                const successEmbed = colorManager.createEmbed()
                    .setTitle('Promotion Applied Successfully')
                    .setDescription(`تم ترقية العضو وإعطاؤه الرول كما هو مطلوب`)
                    .addFields([
                        { name: ' العضو', value: `<@${userId}>`, inline: true },
                        { name: ' الرول', value: `<@&${roleId}>`, inline: true },
                        { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                        { name: ' السبب', value: reason, inline: false },
                        { name: ' بواسطة', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'ينتهي في', value: result.endTime ? `<t:${Math.floor(Number(result.endTime) / 1000)}:R>` : 'نهائي', inline: true }
                    ])
                    .setTimestamp();

                await interaction.reply({ embeds: [successEmbed], ephemeral: true });

                // Send notification to the promoted member
                try {
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle('Role Promoted')
                        .setDescription(`تم ترقيتك وإعطاؤك رول **${role.name}** من قبل الإدارة.`)
                        .addFields([
                            { name: 'الرول الجديد', value: `${role.name}`, inline: true },
                            { name: ' تمت الترقية بواسطة', value: `${interaction.user.username}`, inline: true },
                            { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                            { name: ' السبب', value: reason, inline: false },
                            { name: 'ينتهي في', value: result.endTime ? `<t:${Math.floor(Number(result.endTime) / 1000)}:R>` : 'نهائي', inline: true }
                        ])
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName} - قد تكون الرسائل الخاصة مغلقة`);
                }

                // Log the action - استخدام الدالة الصحيحة
                promoteManager.logAction('PROMOTION_APPLIED', {
                    targetUserId: userId,
                    roleId: roleId,
                    guildId: interaction.guild.id,
                    duration: duration,
                    reason: reason,
                    byUserId: interaction.user.id,
                    endTime: result.endTime,
                    timestamp: Date.now()
                });

            } else {
                const errorEmbed = colorManager.createEmbed()
                    .setDescription(` **فشل في تطبيق الترقية:** ${result.error}`);

                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

        } catch (error) {
            console.error('خطأ في معالجة الترقية:', error);
            await interaction.reply({
                content: ' **حدث خطأ أثناء معالجة الترقية!**',
                ephemeral: true
            });
        }
        return;
    }

    // Handle modal submission for banning
    if (interaction.isModalSubmit() && customId.startsWith('promote_ban_modal_')) {
        const userId = customId.replace('promote_ban_modal_', '');
        const duration = interaction.fields.getTextInputValue('ban_duration');
        const reason = interaction.fields.getTextInputValue('ban_reason');

        const result = await promoteManager.banFromPromotions(
            userId,
            interaction.guild.id,
            duration,
            reason,
            interaction.user
        );

        if (result.success) {
            const successEmbed = colorManager.createEmbed()
                .setTitle('User Banned from Promotions')
                .setDescription(`تم حظر العضو من الترقيات بنجاح`)
                .addFields([
                    { name: ' العضو', value: `<@${userId}>`, inline: true },
                    { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                    { name: ' السبب', value: reason, inline: false },
                    { name: ' بواسطة', value: `<@${interaction.user.id}>`, inline: true },
                    { name: ' ينتهي في', value: result.endTime ? `<t:${Math.floor(Number(result.endTime) / 1000)}:R>` : 'نهائي', inline: true }
                ])
                .setTimestamp();

            await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        } else {
            await interaction.reply({
                content: ` **فشل في حظر العضو:** ${result.error}`,
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

module.exports = { name, execute, handleInteraction };
