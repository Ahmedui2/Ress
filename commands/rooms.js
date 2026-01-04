const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

const name = 'rooms';
const roomConfigPath = path.join(__dirname, '..', 'data', 'roomConfig.json');

// دالة لتحميل إعدادات الرومات
function loadRoomConfig() {
    try {
        if (fs.existsSync(roomConfigPath)) {
            return JSON.parse(fs.readFileSync(roomConfigPath, 'utf8'));
        }
        return {};
    } catch (error) {
        console.error('خطأ في تحميل roomConfig:', error);
        return {};
    }
}

// دالة لحفظ إعدادات الرومات
function saveRoomConfig(config) {
    try {
        fs.writeFileSync(roomConfigPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('خطأ في حفظ roomConfig:', error);
        return false;
    }
}

async function execute(message, args, { client, BOT_OWNERS }) {
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    const subCommand = args[0]?.toLowerCase();

    // أمر تحديد الكاتوقري: rooms sub ctg <category_id/mention>
    if (subCommand === 'sub' && args[1]?.toLowerCase() === 'ctg') {
        if (!BOT_OWNERS.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.react('❌');
        }

        const categoryId = args[2]?.replace(/[<#>]/g, '');
        if (!categoryId) {
            return message.reply('**الرجاء تحديد ID الكاتوقري أو منشن الكاتوقري**');
        }

        const category = message.guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            return message.reply('**الرجاء التأكد من أن الـ ID يخص كاتوقري صحيح**');
        }

        const config = loadRoomConfig();
        if (!config[message.guild.id]) config[message.guild.id] = {};
        config[message.guild.id].roomsCategoryId = categoryId;
        saveRoomConfig(config);

        return message.reply(`**✅ تم تحديد كاتوقري الرومات الخاصة بنجاح: \`${category.name}\`**`);
    }

    // عرض قائمة الرومات
    const config = loadRoomConfig();
    const guildConfig = config[message.guild.id];
    const categoryId = guildConfig?.roomsCategoryId;

    if (!categoryId) {
        return message.reply('**الرجاء تحديد كاتوقري الرومات أولاً باستخدام الأمر:**\n`rooms sub ctg <ID>`');
    }

    const category = message.guild.channels.cache.get(categoryId);
    if (!category) {
        return message.reply('**الكاتوقري المحدد غير موجود، الرجاء إعادة ضبطه.**');
    }

    const rooms = category.children.cache.filter(c => c.type === ChannelType.GuildVoice);
    
    if (rooms.size === 0) {
        return message.reply('**لا توجد رومات في الكاتوقري المحدد حالياً.**');
    }

    const embed = colorManager.createEmbed()
        .setTitle('**نظام الرومات الخاصة**')
        .setDescription('**اختر طريقة عرض الرومات:**')
        .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rooms_list_names').setLabel('عرض بالأسماء').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('rooms_list_numbers').setLabel('عرض بالأرقام').setStyle(ButtonStyle.Secondary)
    );

    const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

    const filter = i => i.user.id === message.author.id;
    const collector = sentMessage.createMessageComponentCollector({ filter, time: 60000 });

    collector.on('collect', async i => {
        const displayType = i.customId === 'rooms_list_names' ? 'names' : 'numbers';
        
        let description = `**قائمة الرومات في كاتوقري: ${category.name}**\n\n`;
        let index = 1;

        rooms.forEach(room => {
            const owner = room.permissionOverwrites.cache.find(ov => ov.type === 1 && ov.allow.has(PermissionFlagsBits.ManageChannels));
            const ownerMention = owner ? `<@${owner.id}>` : '`لا يوجد مالك`';
            
            if (displayType === 'names') {
                description += `**${index}- ${room.name}** | المالك: ${ownerMention}\n`;
            } else {
                description += `**${index}- <#${room.id}>** | المالك: ${ownerMention}\n`;
            }
            index++;
        });

        const listEmbed = colorManager.createEmbed()
            .setTitle('**قائمة الرومات وأصحابها**')
            .setDescription(description)
            .setFooter({ text: `By Ahmed.`, iconURL: message.guild.iconURL({ dynamic: true }) });

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('request_room').setLabel('طلب روم متاح').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('room_controls').setLabel('لوحة التحكم').setStyle(ButtonStyle.Secondary)
        );

        await i.update({ embeds: [listEmbed], components: [controlRow] });
    });

    // معالجة طلبات الرومات والتحكم (يتم التعامل معها عبر Interaction Create في البوت عادةً، 
    // ولكن سنضيف معالج هنا للتبسيط أو كجزء من الكوليكتور)
    const interactionCollector = message.channel.createMessageComponentCollector({ time: 300000 });

    interactionCollector.on('collect', async i => {
        if (i.customId === 'request_room') {
            // البحث عن روم ليس له مالك
            const availableRoom = rooms.find(room => {
                const hasOwner = room.permissionOverwrites.cache.some(ov => ov.type === 1 && ov.allow.has(PermissionFlagsBits.ManageChannels));
                return !hasOwner;
            });

            if (!availableRoom) {
                return i.reply({ content: '**عذراً، لا توجد رومات متاحة حالياً.**', ephemeral: true });
            }

            // إرسال طلب للأونرز
            const requestEmbed = colorManager.createEmbed()
                .setTitle('**طلب تملك روم**')
                .addFields(
                    { name: '**المستخدم:**', value: `${i.user} (${i.user.id})` },
                    { name: '**الروم المطلوب:**', value: `${availableRoom.name} (${availableRoom.id})` }
                )
                .setTimestamp();

            const approveRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_room_${i.user.id}_${availableRoom.id}`).setLabel('قبول').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`deny_room_${i.user.id}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
            );

            // إرسال الطلب لقناة الطلبات (إذا كانت محددة) أو للأونرز
            const requestsChannelId = guildConfig?.requestsChannelId;
            const requestsChannel = requestsChannelId ? message.guild.channels.cache.get(requestsChannelId) : null;

            if (requestsChannel) {
                await requestsChannel.send({ content: BOT_OWNERS.map(id => `<@${id}>`).join(' '), embeds: [requestEmbed], components: [approveRow] });
                await i.reply({ content: '**تم إرسال طلبك للإدارة بنجاح.**', ephemeral: true });
            } else {
                await i.reply({ content: '**قناة الطلبات غير محددة، يرجى التواصل مع الإدارة.**', ephemeral: true });
            }
        }

        if (i.customId === 'room_controls') {
            // التحقق إذا كان المستخدم يملك روماً
            const userRoom = rooms.find(room => room.permissionOverwrites.cache.has(i.user.id) && room.permissionOverwrites.cache.get(i.user.id).allow.has(PermissionFlagsBits.ManageChannels));

            if (!userRoom) {
                return i.reply({ content: '**أنت لا تملك روماً للتحكم به.**', ephemeral: true });
            }

            const controlEmbed = colorManager.createEmbed()
                .setTitle('**لوحة تحكم الروم الخاص**')
                .setDescription(`**الروم:** <#${userRoom.id}>\n**تحكم في صلاحيات رومك من الأزرار أدناه:**`)
                .setFooter({ text: 'By Ahmed.' });

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`room_lock_${userRoom.id}`).setLabel('قفل').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`room_unlock_${userRoom.id}`).setLabel('فتح').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`room_hide_${userRoom.id}`).setLabel('إخفاء').setEmoji('👻').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`room_show_${userRoom.id}`).setLabel('إظهار').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`room_transfer_${userRoom.id}`).setLabel('نقل ملكية').setEmoji('👑').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`room_kick_${userRoom.id}`).setLabel('طرد').setEmoji('🚫').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`room_pull_${userRoom.id}`).setLabel('سحب').setEmoji('🎣').setStyle(ButtonStyle.Primary)
            );

            await i.reply({ embeds: [controlEmbed], components: [row1, row2], ephemeral: true });
        }

        // معالجة أزرار التحكم (هنا نحتاج لمعالجة التفاعلات بشكل أوسع)
        if (i.customId.startsWith('room_')) {
            const [ , action, roomId] = i.customId.split('_');
            const room = message.guild.channels.cache.get(roomId);
            if (!room) return;

            // التحقق من الملكية مرة أخرى للأمان
            const isOwner = room.permissionOverwrites.cache.has(i.user.id) && room.permissionOverwrites.cache.get(i.user.id).allow.has(PermissionFlagsBits.ManageChannels);
            if (!isOwner) return i.reply({ content: '**لا تملك صلاحية التحكم بهذا الروم.**', ephemeral: true });

            switch (action) {
                case 'lock':
                    await room.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: false });
                    await i.reply({ content: '**🔒 تم قفل الروم بنجاح.**', ephemeral: true });
                    break;
                case 'unlock':
                    await room.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: true });
                    await i.reply({ content: '**🔓 تم فتح الروم بنجاح.**', ephemeral: true });
                    break;
                case 'hide':
                    await room.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: false });
                    await i.reply({ content: '**👻 تم إخفاء الروم بنجاح.**', ephemeral: true });
                    break;
                case 'show':
                    await room.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: true });
                    await i.reply({ content: '**👁️ تم إظهار الروم بنجاح.**', ephemeral: true });
                    break;
                case 'kick':
                    await i.reply({ content: '**منشن الشخص المراد طرده في الشات (لديك 15 ثانية):**', ephemeral: true });
                    const kickFilter = m => m.author.id === i.user.id && m.mentions.members.first();
                    const kickCollector = message.channel.createMessageCollector({ filter: kickFilter, time: 15000, max: 1 });
                    kickCollector.on('collect', async m => {
                        const target = m.mentions.members.first();
                        if (target.voice.channelId === room.id) {
                            await target.voice.disconnect();
                            await m.reply(`**✅ تم طرد ${target} من الروم.**`);
                        } else {
                            await m.reply('**هذا الشخص ليس في رومك حالياً.**');
                        }
                    });
                    break;
                // يمكن إضافة باقي العمليات (سحب، نقل ملكية) بنفس الطريقة
            }
        }

        // معالجة القبول والرفض من قبل الأونرز
        if (i.customId.startsWith('approve_room_')) {
            if (!BOT_OWNERS.includes(i.user.id)) return i.reply({ content: '**هذا الزر للأونرز فقط.**', ephemeral: true });
            
            const [ , , userId, roomId] = i.customId.split('_');
            const targetRoom = message.guild.channels.cache.get(roomId);
            const targetUser = await message.guild.members.fetch(userId);

            if (targetRoom && targetUser) {
                await targetRoom.permissionOverwrites.edit(targetUser, {
                    ManageChannels: true,
                    Connect: true,
                    Speak: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true,
                    ViewChannel: true
                });
                await i.update({ content: `**✅ تم قبول طلب ${targetUser} لتملك الروم ${targetRoom.name}**`, components: [] });
                await targetUser.send(`**✅ تم قبول طلبك لتملك الروم: ${targetRoom.name}**`).catch(() => {});
            }
        }
    });
}

module.exports = {
    name,
    execute
};
