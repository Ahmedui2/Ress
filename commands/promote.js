const { ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
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
            .setTitle('🎖️ Promote Management System')
            .setDescription('**استخدم القائمة أدناه لإدارة الترقيات والرولات الإدارية**\n\n' +
                          '• **ترقية الأعضاء:** منح رولات إدارية مؤقتة أو دائمة\n' +
                          '• **إدارة السجلات:** عرض تاريخ الترقيات والإحصائيات\n' +
                          '• **نظام الحظر:** منع أو السماح بترقية أعضاء معينين\n' +
                          '• **فحص النشاط:** تقييم مؤهلات الأعضاء للترقية')
            .addFields([
                { name: '🚀 ترقية شخص أو أكثر', value: 'ترقية عضو وإعطاؤه رول إداري لمدة محددة أو نهائياً', inline: false },
                { name: '📋 سجلات الترقيات', value: 'عرض تاريخ الترقيات لعضو معين', inline: false },
                { name: '🚫 حظر من الترقية', value: 'منع عضو من الحصول على ترقيات', inline: false },
                { name: '✅ فك الحظر', value: 'إزالة حظر الترقية عن عضو', inline: false },
                { name: '📊 فحص تفاعل الإدمن', value: 'فحص إحصائيات تفاعل الأعضاء قبل الترقية', inline: false }
            ])
            .setThumbnail(client?.user?.displayAvatarURL({ size: 256 }) || 'https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
            .setFooter({ text: `🎯 نظام الترقيات التفاعلي • آخر تحديث: ${new Date().toLocaleString('ar-SA')}` })
            .setTimestamp();

        const menuSelect = new StringSelectMenuBuilder()
            .setCustomId('promote_main_menu')
            .setPlaceholder('🎯 اختر الإجراء المطلوب...')
            .addOptions([
                {
                    label: '🚀 ترقية شخص أو أكثر',
                    value: 'promote_user_or_role',
                    description: 'ترقية عضو وإعطاؤه رول إداري لمدة محددة أو نهائياً',
                    emoji: '🚀'
                },
                {
                    label: '📋 سجلات الترقيات',
                    value: 'promotion_records',
                    description: 'عرض تاريخ الترقيات لعضو معين',
                    emoji: '📋'
                },
                {
                    label: '🚫 حظر من الترقية',
                    value: 'ban_from_promotion',
                    description: 'منع عضو من الحصول على ترقيات',
                    emoji: '🚫'
                },
                {
                    label: '✅ فك الحظر',
                    value: 'unban_promotion',
                    description: 'إزالة حظر الترقية عن عضو',
                    emoji: '✅'
                },
                {
                    label: '📊 فحص تفاعل الإدمن',
                    value: 'check_admin_activity',
                    description: 'فحص إحصائيات تفاعل الأعضاء قبل الترقية',
                    emoji: '📊'
                }
            ]);

        const settingsButton = new ButtonBuilder()
            .setCustomId('promote_settings_button')
            .setLabel('⚙️ الإعدادات')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚙️');

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
            .setDescription(' **هذا الأمر مخصص للمالكين فقط!**\n\n**للاستخدام العادي:** توجه للمنيو التفاعلي في القناة المحددة.');

        if (settings.menuChannel) {
            noPermEmbed.addFields([
                { name: ' قناة المنيو', value: `<#${settings.menuChannel}>`, inline: true }
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
                name: 'قناة السجلات',
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
                .setPlaceholder(' اختر قناة السجلات...')
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
                    .setTitle('⚠️ لا توجد مسؤوليات')
                    .setDescription('لا توجد مسؤوليات معرّفة في النظام!\n\nيرجى استخدام أمر `مسؤوليات` أولاً لإضافة مسؤوليات.')
                    .addFields([
                        { name: '💡 نصيحة', value: 'يمكنك اختيار "المالكين فقط" أو "رولات محددة" بدلاً من ذلك', inline: false }
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
            .setPlaceholder(' اختر قناة السجلات...')
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
            .setPlaceholder(' اختر قناة السجلات...')
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
            .setPlaceholder(' اختر قناة المنيو التفاعلي...')
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
                    { name: '✅ قناة السجلات', value: `<#${settings.logChannel}>`, inline: true },
                    { name: '✅ قناة المنيو', value: `<#${settings.menuChannel}>`, inline: true }
                ])
                .setThumbnail(client?.user?.displayAvatarURL())
                .setTimestamp();

            if (success) {
                completeEmbed.addFields([
                    { name: '🎉 الحالة', value: 'النظام جاهز للاستخدام! تم إرسال المنيو التفاعلي للقناة المحددة.', inline: false }
                ]);
                console.log('✅ تم إنشاء المنيو الدائم بنجاح');
            } else {
                completeEmbed.addFields([
                    { name: '⚠️ تحذير', value: 'تم الإعداد ولكن فشل في إرسال المنيو. يمكنك استخدام "إعادة إرسال المنيو" من الإعدادات.', inline: false }
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
                content: '⚠️ **لم يتم تحديد قناة المنيو! يرجى تعديل الإعدادات أولاً.**',
                ephemeral: true
            });
            return;
        }

        // التحقق من وجود القناة
        let targetChannel;
        try {
            targetChannel = await client.channels.fetch(settings.menuChannel);
            if (!targetChannel) {
                throw new Error('القناة غير موجودة');
            }
        } catch (channelError) {
            console.error('❌ خطأ في العثور على القناة:', channelError);
            await interaction.reply({
                content: '❌ **القناة المحددة للمنيو غير موجودة أو لا يمكن الوصول إليها!**',
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
                        `📍 **القناة:** <#${settings.menuChannel}>\n` +
                        `🕐 **الوقت:** <t:${Math.floor(Date.now() / 1000)}:F>`
            });
        } else {
            console.log('❌ فشل في إعادة إرسال المنيو');
            await interaction.editReply({
                content: '❌ **فشل في إعادة إرسال المنيو!**\n\n' +
                        '**الأسباب المحتملة:**\n' +
                        '• عدم وجود صلاحيات كافية للبوت في القناة\n' +
                        '• القناة محذوفة أو غير متاحة\n' +
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
            { name: ' قناة السجلات', value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', inline: true },
            { name: ' قناة المنيو', value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', inline: true },
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
            { name: ' الصلاحية', value: BOT_OWNERS.includes(interaction.user.id) ? 'مالك (الكل)' : 'محدودة', inline: true }
        ]);

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
            { name: ' تعديل الإعدادات', value: 'تغيير المعتمدين، القنوات، أو إعدادات أخرى', inline: false },
            { name: ' إعادة إرسال المنيو', value: 'إعادة إرسال المنيو التفاعلي للقناة المحددة', inline: false },
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
                label: 'تعديل قناة السجلات',
                value: 'edit_log_channel',
                description: 'تغيير قناة حفظ سجلات الترقيات'
            },
            {
                label: 'تعديل قناة المنيو',
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

        // Get database stats for all members
        const database = context.database;
        let statsText = '';
        let validMembers = 0;

        // Check bans and collect stats
        const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');
        const promoteBans = readJson(promoteBansPath, {});
        let bannedMembers = [];

        console.log(`بدء فحص ${membersWithRole.size} عضو في الرول ${sourceRole.name}`);

        for (const [userId, member] of membersWithRole) {
            const banKey = `${userId}_${interaction.guild.id}`;

            console.log(`فحص العضو: ${member.displayName} (${userId})`);

            // Check if banned
            if (promoteBans[banKey]) {
                const banData = promoteBans[banKey];
                const banEndTime = banData.endTime;

                if (!banEndTime || banEndTime > Date.now()) {
                    bannedMembers.push(`<@${userId}>`);
                    console.log(`العضو ${member.displayName} محظور من الترقيات`);
                    continue;
                }
            }

            // Get stats from database
            const databaseModule = require('../utils/database');
            let database = null;
            try {
                database = databaseModule.getDatabase();
            } catch (error) {
                console.log('قاعدة البيانات غير متاحة');
            }

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
                    statsText += `├─ 📅 **انضم:** ${joinedDate}\n`;
                    statsText += `├─ 💬 **الرسائل:** ${messages.toLocaleString()}\n`;
                    statsText += `├─ 🎤 **الصوت:** ${voiceMinutes.toLocaleString()} دقيقة\n`;
                    statsText += `└─ 🔗 **الانضمامات:** ${voiceJoins.toLocaleString()}\n\n`;
                    
                    validMembers++;
                } catch (dbError) {
                    console.error(`خطأ في قراءة إحصائيات العضو ${userId}:`, dbError);
                    statsText += `**${member.displayName}** <@${userId}>\n└─ ⚠️ بيانات غير متاحة\n\n`;
                    validMembers++;
                }
            } else {
                const joinedDate = member.joinedTimestamp ? 
                    `<t:${Math.floor(member.joinedTimestamp / 1000)}:d>` : 'غير معروف';
                statsText += `**${member.displayName}** <@${userId}>\n`;
                statsText += `├─ 📅 **انضم:** ${joinedDate}\n`;
                statsText += `└─ ⚠️ بيانات غير متاحة\n\n`;
                validMembers++;
            }
        }

        console.log(`تم فحص جميع الأعضاء: ${validMembers} مؤهل، ${bannedMembers.length} محظور`);

        // Create embed with stats
        const statsEmbed = colorManager.createEmbed()
            .setTitle('Bulk Promotion Preview')
            .setDescription(`**معاينة ترقية أعضاء الرول** <@&${sourceRoleId}>\n\n**الأعضاء المؤهلين للترقية:**\n${statsText}`)
            .addFields([
                { name: ' إجمالي الأعضاء', value: membersWithRole.size.toString(), inline: true },
                { name: ' مؤهلين للترقية', value: validMembers.toString(), inline: true },
                { name: ' محظورين', value: bannedMembers.length.toString(), inline: true }
            ]);

        if (bannedMembers.length > 0) {
            statsEmbed.addFields([
                { name: ' الأعضاء المحظورين', value: bannedMembers.slice(0, 10).join('\n') + (bannedMembers.length > 10 ? '\n**...والمزيد**' : ''), inline: false }
            ]);
        }

        if (validMembers === 0) {
            await interaction.update({
                embeds: [statsEmbed],
                content: ' **لا يوجد أعضاء مؤهلين للترقية!**',
                components: []
            });
            return;
        }

        // Show admin roles for selection - only higher roles
        const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
        const adminRoles = readJson(adminRolesPath, []);
        const sourceRole = interaction.guild.roles.cache.get(sourceRoleId);

        const availableTargetRoles = adminRoles.filter(roleId => {
            if (roleId === sourceRoleId) return false; // استبعاد نفس الرول
            const targetRole = interaction.guild.roles.cache.get(roleId);
            // إظهار الرولات الأعلى فقط (position أكبر)
            return targetRole && sourceRole && targetRole.position > sourceRole.position;
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
            .setLabel('المدة (مثل: 7d أو 12h أو permanent)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('7d, 12h, 30m, permanent');

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
            .setLabel('المدة (مثل: 7d أو 12h أو permanent)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('7d, 12h, 30m, permanent');

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
                const actionText = record.type === 'ROLE_PROMOTED' ? 'تمت الترقية' : 
                                 record.type === 'PROMOTION_ENDED' ? 'انتهت الترقية' : 'إجراء غير معروف';

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
            .setTitle('Promotion Records')
            .setDescription(`سجلات ترقيات العضو <@${selectedUserId}>`)
            .addFields(records.slice(0, 25).map((record, index) => ({
                name: `${index + 1}. ${record.roleName || `Role ID: ${record.roleId}`}`,
                value: `**السبب:** ${record.reason}\n**المدة:** ${record.duration || 'نهائي'}\n**التاريخ:** <t:${Math.floor(new Date(record.timestamp).getTime() / 1000)}:F>`,
                inline: false
            })))
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
            .setLabel('مدة الحظر (مثل: 30d أو permanent)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('30d, 7d, permanent');

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
        let statsText = '';
        let totalVoiceTime = 0;
        let totalMessages = 0;
        let totalVoiceJoins = 0;
        const memberStats = [];

        const weekAgo = period === 'weekly' ? Date.now() - (7 * 24 * 60 * 60 * 1000) : 0;

        for (const [userId, member] of membersWithRole) {
            if (database) {
                let userStats;
                if (period === 'weekly') {
                    // Get weekly stats
                    const weeklyData = await database.all(
                        `SELECT SUM(voice_time) as voice_time, SUM(messages) as messages, SUM(voice_joins) as voice_joins FROM daily_activity WHERE user_id = ? AND date >= ?`,
                        [userId, new Date(weekAgo).toDateString()]
                    );
                    userStats = weeklyData[0] || { voice_time: 0, messages: 0, voice_joins: 0 };
                } else {
                    // Get total stats
                    userStats = await database.get(
                        'SELECT total_voice_time as voice_time, total_messages as messages, total_voice_joins as voice_joins FROM user_totals WHERE user_id = ?',
                        [userId]
                    );
                }

                const voiceMinutes = userStats ? Math.floor((userStats.voice_time || 0) / 60000) : 0;
                const messages = userStats ? (userStats.messages || 0) : 0;
                const voiceJoins = userStats ? (userStats.voice_joins || 0) : 0;

                totalVoiceTime += voiceMinutes;
                totalMessages += messages;
                totalVoiceJoins += voiceJoins;

                memberStats.push({
                    member: member,
                    voiceMinutes: voiceMinutes,
                    messages: messages,
                    voiceJoins: voiceJoins,
                    score: (voiceMinutes * 0.1) + messages + (voiceJoins * 2) // Simple scoring
                });
            }
        }

        // Sort by activity score
        memberStats.sort((a, b) => b.score - a.score);

        // Create detailed embed
        const activityEmbed = colorManager.createEmbed()
            .setTitle('Role Activity Statistics')
            .setDescription(`**إحصائيات تفاعل أعضاء الرول** <@&${roleId}>
**الفترة:** ${period === 'weekly' ? 'أسبوعي (آخر 7 أيام)' : 'إجمالي (كل الوقت)'}`)
            .addFields([
                { name: ' إجمالي الأعضاء', value: membersWithRole.size.toString(), inline: true },
                { name: ' إجمالي وقت الصوت', value: `${totalVoiceTime} دقيقة`, inline: true },
                { name: ' إجمالي الرسائل', value: totalMessages.toString(), inline: true },
                { name: ' إجمالي انضمامات الصوت', value: totalVoiceJoins.toString(), inline: true },
                { name: ' متوسط وقت الصوت', value: `${Math.round(totalVoiceTime / membersWithRole.size)} دقيقة`, inline: true },
                { name: ' متوسط الرسائل', value: Math.round(totalMessages / membersWithRole.size).toString(), inline: true }
            ]);

        // Add top performers
        const topPerformers = memberStats.slice(0, 10).map((stat, index) => 
            `**${index + 1}.** ${stat.member.displayName}: **${stat.voiceMinutes}** دقيقة، **${stat.messages}** رسالة، **${stat.voiceJoins}** انضمام`
        ).join('\n');

        if (topPerformers) {
            activityEmbed.addFields([
                { name: ' أعلى 10 متفاعلين', value: topPerformers, inline: false }
            ]);
        }

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
        let userStats = { voice_time: 0, messages: 0, voice_joins: 0 };

        if (database) {
            if (period === 'weekly') {
                // Get weekly stats
                const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                const weeklyData = await database.all(
                    `SELECT SUM(voice_time) as voice_time, SUM(messages) as messages, SUM(voice_joins) as voice_joins FROM daily_activity WHERE user_id = ? AND date >= ?`,
                    [userId, new Date(weekAgo).toDateString()]
                );
                userStats = weeklyData[0] || { voice_time: 0, messages: 0, voice_joins: 0 };
            } else {
                // Get total stats
                const totalData = await database.get(
                    'SELECT total_voice_time as voice_time, total_messages as messages, total_voice_joins as voice_joins FROM user_totals WHERE user_id = ?',
                    [userId]
                );
                userStats = totalData || { voice_time: 0, messages: 0, voice_joins: 0 };
            }
        }

        const voiceMinutes = Math.floor((userStats.voice_time || 0) / 60000);
        const messages = userStats.messages || 0;
        const voiceJoins = userStats.voice_joins || 0;

        function getActivityRating(stats) {
            const score = (voiceMinutes * 0.1) + messages + (voiceJoins * 2);
            if (score >= 1000) return '🌟 ممتاز';
            if (score >= 500) return '⭐ جيد جداً';
            if (score >= 200) return '✨ جيد';
            if (score >= 50) return '💫 متوسط';
            return '⚪ ضعيف';
        }

        const activityEmbed = colorManager.createEmbed()
            .setTitle('Admin Activity Check')
            .setDescription(`**إحصائيات تفاعل العضو** <@${userId}>
**الفترة:** ${period === 'weekly' ? 'أسبوعي (آخر 7 أيام)' : 'إجمالي (كل الوقت)'}`)
            .addFields([
                { name: ' وقت الصوت', value: `${voiceMinutes} دقيقة`, inline: true },
                { name: ' إجمالي الرسائل', value: messages.toString(), inline: true },
                { name: ' انضمامات الصوت', value: voiceJoins.toString(), inline: true },
                { name: ' تقييم التفاعل', value: getActivityRating(userStats), inline: true },
                { name: ' الفترة المحددة', value: period === 'weekly' ? 'آخر 7 أيام' : 'كل الوقت', inline: true },
                { name: ' نقاط التفاعل', value: Math.round((voiceMinutes * 0.1) + messages + (voiceJoins * 2)).toString(), inline: true }
            ])
            .setTimestamp();

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
            const sourceRole = interaction.guild.roles.cache.get(sourceRoleId);
            const targetRole = interaction.guild.roles.cache.get(targetRoleId);

            if (!sourceRole || !targetRole) {
                await interaction.reply({
                    content: ' **لم يتم العثور على أحد الرولات!**',
                    ephemeral: true
                });
                return;
            }

            const membersWithRole = sourceRole.members;
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
                            .setTitle('Role Promoted')
                            .setDescription(`تم ترقيتك وإعطاؤك رول **${targetRole.name}** من قبل الإدارة.`)
                            .addFields([
                                { name: '🏷️ الرول الجديد', value: `${targetRole.name}`, inline: true },
                                { name: ' تمت الترقية بواسطة', value: `${interaction.user.username}`, inline: true },
                                { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                                { name: ' السبب', value: reason, inline: false },
                                { name: '📅 ينتهي في', value: result.endTime || 'نهائي', inline: false }
                            ])
                            .setTimestamp();

                        await member.send({ embeds: [dmEmbed] });
                    } catch (dmError) {
                        console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName} - قد تكون الرسائل الخاصة مغلقة`);
                    }
                } else {
                    failedCount++;
                    results.push(`❌ ${member.displayName}: ${result.error}`);
                }
            }

            // Create summary embed
            const summaryEmbed = colorManager.createEmbed()
                .setTitle('Bulk Promotion Results')
                .setDescription(`**نتائج الترقية الجماعية من رول** <@&${sourceRoleId}> **إلى** <@&${targetRoleId}>`)
                .addFields([
                    { name: ' تم بنجاح', value: successCount.toString(), inline: true },
                    { name: ' فشل', value: failedCount.toString(), inline: true },
                    { name: ' محظورين', value: bannedCount.toString(), inline: true },
                    { name: ' المدة', value: duration === 'permanent' ? 'نهائي' : duration, inline: true },
                    { name: ' السبب', value: reason, inline: false }
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
            await promoteManager.logPromotionAction(interaction.guild, {
                type: 'BULK_PROMOTION',
                sourceRole: sourceRole,
                targetRole: targetRole,
                moderator: interaction.user,
                duration: duration,
                reason: reason,
                successCount: successCount,
                failedCount: failedCount,
                bannedCount: bannedCount
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
                        { name: '🏷️ الرول', value: `<@&${roleId}>`, inline: true },
                        { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                        { name: ' السبب', value: reason, inline: false },
                        { name: ' بواسطة', value: `<@${interaction.user.id}>`, inline: true },
                        { name: '📅 ينتهي في', value: result.endTime || 'نهائي', inline: true }
                    ])
                    .setTimestamp();

                await interaction.reply({ embeds: [successEmbed], ephemeral: true });

                // Send notification to the promoted member
                try {
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle('Role Promoted')
                        .setDescription(`تم ترقيتك وإعطاؤك رول **${role.name}** من قبل الإدارة.`)
                        .addFields([
                            { name: '🏷️ الرول الجديد', value: `${role.name}`, inline: true },
                            { name: ' تمت الترقية بواسطة', value: `${interaction.user.username}`, inline: true },
                            { name: ' المدة', value: result.duration || 'نهائي', inline: true },
                            { name: ' السبب', value: reason, inline: false },
                            { name: '📅 ينتهي في', value: result.endTime || 'نهائي', inline: false }
                        ])
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName} - قد تكون الرسائل الخاصة مغلقة`);
                }

                // Log the action
                await promoteManager.logPromotionAction(interaction.guild, {
                    type: 'ROLE_PROMOTED',
                    user: member.user,
                    role: role,
                    moderator: interaction.user,
                    duration: duration,
                    reason: reason,
                    endTime: result.endTime
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
                    { name: '📅 ينتهي في', value: result.endTime || 'نهائي', inline: true }
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
            content: ' **تم تغيير قناة المنيو وإعادة إرسال المنيو بنجاح.**',
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

function getActivityRating(stats) {
    let score = 0;

    // Voice time scoring (max 40 points)
    const voiceHours = stats.totalVoiceTime / 3600;
    if (voiceHours >= 100) score += 40;
    else if (voiceHours >= 50) score += 30;
    else if (voiceHours >= 20) score += 20;
    else if (voiceHours >= 5) score += 10;

    // Message scoring (max 30 points)
    if (stats.totalMessages >= 1000) score += 30;
    else if (stats.totalMessages >= 500) score += 20;
    else if (stats.totalMessages >= 100) score += 15;
    else if (stats.totalMessages >= 50) score += 10;

    // Active days scoring (max 30 points)
    if (stats.activeDays >= 30) score += 30;
    else if (stats.activeDays >= 15) score += 20;
    else if (stats.activeDays >= 7) score += 15;
    else if (stats.activeDays >= 3) score += 10;

    if (score >= 80) return '**ممتاز** (مناسب للترقية)';
    else if (score >= 60) return '**جيد جداً** (مناسب للترقية)';
    else if (score >= 40) return '**جيد** (قد يحتاج مراجعة)';
    else if (score >= 20) return '**ضعيف** (غير مناسب للترقية)';
    else return '**ضعيف جداً** (غير مناسب للترقية)';
}

async function handleEditSettings(interaction, context) {
    const settingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
    const settings = readJson(settingsPath, {});

    const editEmbed = colorManager.createEmbed()
        .setTitle('Edit System Settings')
        .setDescription('اختر الإعداد الذي تريد تعديله')
        .addFields([
            { name: ' المعتمدين الحاليين', value: settings.allowedUsers?.type ? `${getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets?.length || 0})` : 'غير محدد', inline: true },
            { name: ' قناة السجلات', value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', inline: true },
            { name: ' قناة المنيو', value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', inline: true }
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
                label: 'تعديل قناة السجلات',
                value: 'edit_log_channel',
                description: 'تغيير قناة حفظ سجلات الترقيات'
            },
            {
                label: 'تعديل قناة المنيو',
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
        .setPlaceholder(' اختر قناة السجلات الجديدة...')
        .setChannelTypes([ChannelType.GuildText]);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.update({
        content: ' **اختر قناة السجلات الجديدة:**',
        components: [channelRow]
    });
}

async function handleEditMenuChannel(interaction, context) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('promote_edit_menu_channel_select')
        .setPlaceholder(' اختر قناة المنيو الجديدة...')
        .setChannelTypes([ChannelType.GuildText]);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    await interaction.update({
        content: ' **اختر قناة المنيو الجديدة:**',
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