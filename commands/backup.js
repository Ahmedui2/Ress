const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const backupsDir = path.join(__dirname, '..', 'backups');

if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

function readJSON(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return defaultValue;
    } catch (error) {
        console.error(`خطأ في قراءة ${filePath}:`, error);
        return defaultValue;
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`خطأ في حفظ ${filePath}:`, error);
        return false;
    }
}

const FILES_TO_BACKUP = [
    'points.json', 'responsibilities.json', 'logConfig.json', 'adminRoles.json',
    'botConfig.json', 'cooldowns.json', 'notifications.json', 'reports.json',
    'adminApplications.json', 'vacations.json', 'activePromotes.json',
    'activeWarns.json', 'promoteBans.json', 'promoteLogs.json',
    'promoteSettings.json', 'warnLogs.json', 'categories.json',
    'setrooms.json', 'blocked.json'
];

// نسخ احتياطي شامل للسيرفر
async function createBackup(guild, creatorId, backupName) {
    try {
        const timestamp = Date.now();
        const backupData = {
            guildId: guild.id,
            guildName: guild.name,
            createdBy: creatorId,
            createdAt: timestamp,
            name: backupName || `backup_${timestamp}`,
            version: '2.0',
            data: {
                files: {},
                roles: [],
                categories: [],
                channels: [],
                emojis: [],
                stickers: [],
                messages: {}
            },
            stats: {
                roles: 0,
                channels: 0,
                categories: 0,
                textChannels: 0,
                voiceChannels: 0,
                files: 0,
                emojis: 0,
                stickers: 0,
                messages: 0,
                totalMessages: 0
            }
        };

        // نسخ جميع الملفات
        for (const fileName of FILES_TO_BACKUP) {
            const filePath = path.join(dataDir, fileName);
            if (fs.existsSync(filePath)) {
                const fileData = readJSON(filePath, null);
                if (fileData !== null) {
                    backupData.data.files[fileName] = fileData;
                    backupData.stats.files++;
                }
            }
        }

        // نسخ الرولات بالتفصيل (مع الترتيب)
        const roles = Array.from(guild.roles.cache.values())
            .filter(role => !role.managed && role.id !== guild.id)
            .sort((a, b) => b.position - a.position);

        for (const role of roles) {
            backupData.data.roles.push({
                id: role.id,
                name: role.name,
                color: role.color,
                position: role.position,
                permissions: role.permissions.bitfield.toString(),
                hoist: role.hoist,
                mentionable: role.mentionable,
                icon: role.iconURL(),
                unicodeEmoji: role.unicodeEmoji
            });
            backupData.stats.roles++;
        }

        // نسخ الكاتوقريات والقنوات بالتفصيل والترتيب
        const categories = Array.from(guild.channels.cache.values())
            .filter(ch => ch.type === ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position);

        for (const category of categories) {
            const categoryData = {
                id: category.id,
                name: category.name,
                position: category.position,
                permissionOverwrites: [],
                channels: []
            };

            // نسخ صلاحيات الكاتوقري
            for (const [id, overwrite] of category.permissionOverwrites.cache) {
                categoryData.permissionOverwrites.push({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: overwrite.allow.bitfield.toString(),
                    deny: overwrite.deny.bitfield.toString()
                });
            }

            // نسخ القنوات داخل الكاتوقري
            const channelsInCategory = Array.from(guild.channels.cache.values())
                .filter(ch => ch.parentId === category.id)
                .sort((a, b) => a.position - b.position);

            for (const channel of channelsInCategory) {
                const channelData = {
                    id: channel.id,
                    name: channel.name,
                    type: channel.type,
                    position: channel.position,
                    topic: channel.topic || null,
                    nsfw: channel.nsfw || false,
                    rateLimitPerUser: channel.rateLimitPerUser || 0,
                    bitrate: channel.bitrate || null,
                    userLimit: channel.userLimit || null,
                    permissionOverwrites: []
                };

                // نسخ صلاحيات القناة
                for (const [id, overwrite] of channel.permissionOverwrites.cache) {
                    channelData.permissionOverwrites.push({
                        id: overwrite.id,
                        type: overwrite.type,
                        allow: overwrite.allow.bitfield.toString(),
                        deny: overwrite.deny.bitfield.toString()
                    });
                }

                // نسخ آخر 200 رسالة من القناة النصية (على دفعتين)
                if (channel.type === ChannelType.GuildText) {
                    try {
                        const allMessages = [];
                        
                        // جلب أول 100 رسالة
                        const firstBatch = await channel.messages.fetch({ limit: 100 });
                        allMessages.push(...firstBatch.values());
                        
                        // جلب ثاني 100 رسالة إذا كانت الدفعة الأولى ممتلئة
                        if (firstBatch.size === 100) {
                            const lastMessageId = firstBatch.last().id;
                            const secondBatch = await channel.messages.fetch({ limit: 100, before: lastMessageId });
                            allMessages.push(...secondBatch.values());
                        }
                        
                        backupData.data.messages[channel.id] = allMessages.map(msg => ({
                            id: msg.id,
                            author: { id: msg.author.id, username: msg.author.username, tag: msg.author.tag, avatar: msg.author.avatarURL() },
                            content: msg.content,
                            timestamp: msg.createdTimestamp,
                            attachments: msg.attachments.map(att => ({ url: att.url, name: att.name, contentType: att.contentType })),
                            embeds: msg.embeds.map(emb => emb.toJSON())
                        })).reverse(); // Reverse to maintain chronological order
                        
                        backupData.stats.messages += allMessages.length;
                        backupData.stats.totalMessages += allMessages.length;
                    } catch (error) {
                        console.error(`فشل نسخ رسائل القناة ${channel.name}:`, error);
                        backupData.stats.messages = backupData.stats.messages || 0;
                        backupData.stats.totalMessages = backupData.stats.totalMessages || 0;
                    }
                }

                categoryData.channels.push(channelData);

                if (channel.type === ChannelType.GuildText) {
                    backupData.stats.textChannels++;
                } else if (channel.type === ChannelType.GuildVoice) {
                    backupData.stats.voiceChannels++;
                }
                backupData.stats.channels++;
            }

            backupData.data.categories.push(categoryData);
            backupData.stats.categories++;
        }

        // نسخ القنوات خارج الكاتوقريات
        const channelsWithoutCategory = Array.from(guild.channels.cache.values())
            .filter(ch => !ch.parentId && ch.type !== ChannelType.GuildCategory)
            .sort((a, b) => a.position - b.position);

        for (const channel of channelsWithoutCategory) {
            const channelData = {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                topic: channel.topic || null,
                nsfw: channel.nsfw || false,
                rateLimitPerUser: channel.rateLimitPerUser || 0,
                bitrate: channel.bitrate || null,
                userLimit: channel.userLimit || null,
                permissionOverwrites: [],
                parentId: null
            };

            for (const [id, overwrite] of channel.permissionOverwrites.cache) {
                channelData.permissionOverwrites.push({
                    id: overwrite.id,
                    type: overwrite.type,
                    allow: overwrite.allow.bitfield.toString(),
                    deny: overwrite.deny.bitfield.toString()
                });
            }

            // نسخ آخر 200 رسالة من القناة النصية (على دفعتين)
            if (channel.type === ChannelType.GuildText) {
                try {
                    const allMessages = [];
                    
                    // جلب أول 100 رسالة
                    const firstBatch = await channel.messages.fetch({ limit: 100 });
                    allMessages.push(...firstBatch.values());
                    
                    // جلب ثاني 100 رسالة إذا كانت الدفعة الأولى ممتلئة
                    if (firstBatch.size === 100) {
                        const lastMessageId = firstBatch.last().id;
                        const secondBatch = await channel.messages.fetch({ limit: 100, before: lastMessageId });
                        allMessages.push(...secondBatch.values());
                    }
                    
                    backupData.data.messages[channel.id] = allMessages.map(msg => ({
                        id: msg.id,
                        author: { id: msg.author.id, username: msg.author.username, tag: msg.author.tag, avatar: msg.author.avatarURL() },
                        content: msg.content,
                        timestamp: msg.createdTimestamp,
                        attachments: msg.attachments.map(att => ({ url: att.url, name: att.name, contentType: att.contentType })),
                        embeds: msg.embeds.map(emb => emb.toJSON())
                    })).reverse(); // Reverse to maintain chronological order
                    
                    backupData.stats.messages += allMessages.length;
                    backupData.stats.totalMessages += allMessages.length;
                } catch (error) {
                    console.error(`فشل نسخ رسائل القناة ${channel.name}:`, error);
                    backupData.stats.messages = backupData.stats.messages || 0;
                    backupData.stats.totalMessages = backupData.stats.totalMessages || 0;
                }
            }

            backupData.data.channels.push(channelData);

            if (channel.type === ChannelType.GuildText) {
                backupData.stats.textChannels++;
            } else if (channel.type === ChannelType.GuildVoice) {
                backupData.stats.voiceChannels++;
            }
            backupData.stats.channels++;
        }

        // نسخ الإيموجيات
        for (const emoji of guild.emojis.cache.values()) {
            backupData.data.emojis.push({
                id: emoji.id,
                name: emoji.name,
                url: emoji.url,
                animated: emoji.animated,
                roles: emoji.roles.cache.map(r => r.id)
            });
            backupData.stats.emojis++;
        }

        // نسخ الملصقات
        try {
            await guild.stickers.fetch();
            for (const sticker of guild.stickers.cache.values()) {
                backupData.data.stickers.push({
                    id: sticker.id,
                    name: sticker.name,
                    description: sticker.description,
                    tags: sticker.tags,
                    url: sticker.url
                });
                backupData.stats.stickers++;
            }
        } catch (err) {
            console.error('خطأ في نسخ الستيكرز:', err);
        }

        // نسخ معلومات السيرفر
        backupData.data.serverInfo = {
            name: guild.name,
            icon: guild.iconURL({ size: 1024 }),
            banner: guild.bannerURL({ size: 1024 }),
            splash: guild.splashURL({ size: 1024 }),
            description: guild.description,
            verificationLevel: guild.verificationLevel,
            defaultMessageNotifications: guild.defaultMessageNotifications,
            explicitContentFilter: guild.explicitContentFilter,
            afkChannelId: guild.afkChannelId,
            afkTimeout: guild.afkTimeout,
            systemChannelId: guild.systemChannelId,
            premiumTier: guild.premiumTier
        };

        const backupFileName = `${guild.id}_${backupName || timestamp}.json`;
        const backupFilePath = path.join(backupsDir, backupFileName);

        if (saveJSON(backupFilePath, backupData)) {
            return {
                success: true,
                fileName: backupFileName,
                filePath: backupFilePath,
                data: backupData
            };
        }

        return { success: false, error: 'فشل في حفظ النسخة' };
    } catch (error) {
        console.error('خطأ في إنشاء النسخة:', error);
        return { success: false, error: error.message };
    }
}

// استعادة انتقائية للنسخة
async function restoreBackup(backupFileName, guild, restoredBy, options) {
    try {
        const backupFilePath = path.join(backupsDir, backupFileName);
        if (!fs.existsSync(backupFilePath)) {
            return { success: false, error: 'ملف النسخة غير موجود' };
        }

        const backupData = readJSON(backupFilePath);
        if (!backupData || !backupData.data) {
            return { success: false, error: 'بيانات النسخة تالفة' };
        }

        const stats = {
            rolesDeleted: 0,
            rolesCreated: 0,
            categoriesDeleted: 0,
            categoriesCreated: 0,
            channelsDeleted: 0,
            channelsCreated: 0,
            filesRestored: 0,
            messagesRestored: 0,
            errors: []
        };

        // استعادة الملفات
        if (options.includes('files')) {
            for (const [fileName, fileData] of Object.entries(backupData.data.files)) {
                const filePath = path.join(dataDir, fileName);
                if (saveJSON(filePath, fileData)) {
                    stats.filesRestored++;
                } else {
                    stats.errors.push(`فشل في استعادة ${fileName}`);
                }
            }
        }

        // إنشاء خريطة الرولات (قبل أي عملية)
        const roleMap = new Map();
        
        // استعادة الرولات
        if (options.includes('roles')) {
            const currentRoles = guild.roles.cache.filter(r => !r.managed && r.id !== guild.id);
            stats.rolesDeleted = currentRoles.size;

            // حذف الرولات الحالية
            for (const role of currentRoles.values()) {
                try {
                    await role.delete('استعادة من النسخة الاحتياطية');
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (err) {
                    stats.errors.push(`فشل حذف رول: ${role.name}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            // إنشاء الرولات من النسخة بالترتيب الصحيح وبناء الخريطة
            for (const roleData of backupData.data.roles) {
                try {
                    const newRole = await guild.roles.create({
                        name: roleData.name,
                        color: roleData.color,
                        permissions: BigInt(roleData.permissions),
                        hoist: roleData.hoist,
                        mentionable: roleData.mentionable,
                        reason: 'استعادة من النسخة الاحتياطية'
                    });
                    
                    // إضافة إلى خريطة الرولات (ربط ID القديم بـ ID الجديد)
                    roleMap.set(roleData.id, newRole.id);
                    
                    stats.rolesCreated++;
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (err) {
                    stats.errors.push(`فشل إنشاء رول: ${roleData.name}`);
                }
            }
        } else {
            // إذا لم يتم اختيار استعادة الرولات، نبني الخريطة من الرولات الحالية
            for (const roleData of backupData.data.roles) {
                const existingRole = guild.roles.cache.find(r => r.name === roleData.name);
                if (existingRole) {
                    roleMap.set(roleData.id, existingRole.id);
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // استعادة الكاتوقريات والقنوات
        if (options.includes('channels') || options.includes('categories')) {
            const currentChannels = guild.channels.cache;
            stats.channelsDeleted = currentChannels.size;

            const currentCategories = currentChannels.filter(ch => ch.type === ChannelType.GuildCategory);
            stats.categoriesDeleted = currentCategories.size;

            // حذف القنوات والكاتوقريات الحالية
            for (const channel of currentChannels.values()) {
                try {
                    await channel.delete('استعادة من النسخة الاحتياطية');
                } catch (err) {
                    stats.errors.push(`فشل حذف قناة: ${channel.name}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            // إنشاء الكاتوقريات
            if (options.includes('categories')) {
                const categoryMap = new Map();

                for (const categoryData of backupData.data.categories) {
                    try {
                        const permissionOverwrites = categoryData.permissionOverwrites
                            .map(ow => {
                                const newRoleId = roleMap.get(ow.id);
                                if (!newRoleId && ow.type === 0) {
                                    return null; // تجاهل الرولات غير الموجودة
                                }
                                return {
                                    id: ow.type === 0 ? newRoleId : ow.id,
                                    allow: BigInt(ow.allow),
                                    deny: BigInt(ow.deny)
                                };
                            })
                            .filter(ow => ow !== null);

                        const newCategory = await guild.channels.create({
                            name: categoryData.name,
                            type: ChannelType.GuildCategory,
                            position: categoryData.position,
                            permissionOverwrites: permissionOverwrites,
                            reason: 'استعادة من النسخة الاحتياطية'
                        });

                        categoryMap.set(categoryData.id, newCategory.id);
                        stats.categoriesCreated++;

                        // إنشاء القنوات داخل الكاتوقري
                        if (options.includes('channels')) {
                            for (const channelData of categoryData.channels) {
                                try {
                                    const channelPermOverwrites = channelData.permissionOverwrites
                                        .map(ow => {
                                            const newRoleId = roleMap.get(ow.id);
                                            if (!newRoleId && ow.type === 0) {
                                                return null;
                                            }
                                            return {
                                                id: ow.type === 0 ? newRoleId : ow.id,
                                                allow: BigInt(ow.allow),
                                                deny: BigInt(ow.deny)
                                            };
                                        })
                                        .filter(ow => ow !== null);

                                    const channelOptions = {
                                        name: channelData.name,
                                        type: channelData.type,
                                        parent: newCategory.id,
                                        position: channelData.position,
                                        permissionOverwrites: channelPermOverwrites,
                                        reason: 'استعادة من النسخة الاحتياطية'
                                    };

                                    if (channelData.topic) channelOptions.topic = channelData.topic;
                                    if (channelData.nsfw !== undefined) channelOptions.nsfw = channelData.nsfw;
                                    if (channelData.rateLimitPerUser) channelOptions.rateLimitPerUser = channelData.rateLimitPerUser;
                                    if (channelData.bitrate) channelOptions.bitrate = channelData.bitrate;
                                    if (channelData.userLimit) channelOptions.userLimit = channelData.userLimit;

                                    await guild.channels.create(channelOptions);
                                    stats.channelsCreated++;
                                } catch (err) {
                                    stats.errors.push(`فشل إنشاء قناة: ${channelData.name}`);
                                }
                            }
                        }
                    } catch (err) {
                        stats.errors.push(`فشل إنشاء كاتوقري: ${categoryData.name}`);
                    }
                }
            }

            // إنشاء القنوات خارج الكاتوقريات
            if (options.includes('channels')) {
                for (const channelData of backupData.data.channels) {
                    try {
                        const channelPermOverwrites = channelData.permissionOverwrites
                            .map(ow => {
                                const newRoleId = roleMap.get(ow.id);
                                if (!newRoleId && ow.type === 0) {
                                    return null;
                                }
                                return {
                                    id: ow.type === 0 ? newRoleId : ow.id,
                                    allow: BigInt(ow.allow),
                                    deny: BigInt(ow.deny)
                                };
                            })
                            .filter(ow => ow !== null);

                        const channelOptions = {
                            name: channelData.name,
                            type: channelData.type,
                            position: channelData.position,
                            permissionOverwrites: channelPermOverwrites,
                            reason: 'استعادة من النسخة الاحتياطية'
                        };

                        if (channelData.topic) channelOptions.topic = channelData.topic;
                        if (channelData.nsfw !== undefined) channelOptions.nsfw = channelData.nsfw;
                        if (channelData.rateLimitPerUser) channelOptions.rateLimitPerUser = channelData.rateLimitPerUser;
                        if (channelData.bitrate) channelOptions.bitrate = channelData.bitrate;
                        if (channelData.userLimit) channelOptions.userLimit = channelData.userLimit;

                        await guild.channels.create(channelOptions);
                        stats.channelsCreated++;
                    } catch (err) {
                        stats.errors.push(`فشل إنشاء قناة: ${channelData.name}`);
                    }
                }
            }
        }

        // استعادة معلومات السيرفر
        if (options.includes('serverinfo') && backupData.data.serverInfo) {
            try {
                const updates = {};
                if (backupData.data.serverInfo.name) updates.name = backupData.data.serverInfo.name;
                if (backupData.data.serverInfo.description) updates.description = backupData.data.serverInfo.description;
                if (backupData.data.serverInfo.verificationLevel !== undefined) updates.verificationLevel = backupData.data.serverInfo.verificationLevel;
                if (backupData.data.serverInfo.defaultMessageNotifications !== undefined) updates.defaultMessageNotifications = backupData.data.serverInfo.defaultMessageNotifications;
                if (backupData.data.serverInfo.explicitContentFilter !== undefined) updates.explicitContentFilter = backupData.data.serverInfo.explicitContentFilter;

                await guild.edit(updates);

                // تحديث الصور
                if (backupData.data.serverInfo.icon) {
                    try {
                        await guild.setIcon(backupData.data.serverInfo.icon);
                    } catch (err) {
                        stats.errors.push('فشل تحديث أيقونة السيرفر');
                    }
                }

                if (backupData.data.serverInfo.banner) {
                    try {
                        await guild.setBanner(backupData.data.serverInfo.banner);
                    } catch (err) {
                        stats.errors.push('فشل تحديث بنر السيرفر');
                    }
                }
            } catch (err) {
                stats.errors.push(`فشل تحديث معلومات السيرفر: ${err.message}`);
            }
        }

        // استعادة الإيموجيز
        if (options.includes('emojis')) {
            // حذف الإيموجيز الحالية
            for (const emoji of guild.emojis.cache.values()) {
                try {
                    await emoji.delete('استعادة من النسخة الاحتياطية');
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (err) {
                    stats.errors.push(`فشل حذف إيموجي: ${emoji.name}`);
                }
            }

            // إنشاء الإيموجيز من النسخة
            for (const emojiData of backupData.data.emojis || []) {
                try {
                    await guild.emojis.create({
                        attachment: emojiData.url,
                        name: emojiData.name,
                        reason: 'استعادة من النسخة الاحتياطية'
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (err) {
                    stats.errors.push(`فشل إنشاء إيموجي: ${emojiData.name}`);
                }
            }
        }

        // استعادة الستيكرز
        if (options.includes('stickers')) {
            // حذف الستيكرز الحالية
            for (const sticker of guild.stickers.cache.values()) {
                try {
                    await sticker.delete('استعادة من النسخة الاحتياطية');
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (err) {
                    stats.errors.push(`فشل حذف ستيكر: ${sticker.name}`);
                }
            }

            // Discord API لا يسمح بإنشاء الستيكرز من البوتات بشكل مباشر
            // يمكن فقط حفظ معلوماتها للمراجعة
            stats.errors.push('⚠️ الستيكرز محفوظة في النسخة لكن لا يمكن استعادتها تلقائياً');
        }

        // الانتظار 5 دقائق قبل استعادة الرسائل
        if (options.includes('messages')) {
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 دقائق

            const allChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);
            
            for (const [oldChannelId, messages] of Object.entries(backupData.data.messages || {})) {
                // البحث عن القناة بالاسم (لأن الـ ID سيتغير)
                const channel = allChannels.find(ch => {
                    const backupChannel = backupData.data.categories
                        .flatMap(cat => cat.channels)
                        .concat(backupData.data.channels)
                        .find(c => c.id === oldChannelId);
                    return backupChannel && ch.name === backupChannel.name;
                });

                if (channel && messages && messages.length > 0) {
                    for (const messageData of messages) {
                        try {
                            const content = messageData.content || '';
                            const embeds = messageData.embeds || [];
                            
                            if (content || embeds.length > 0) {
                                await channel.send({
                                    content: content,
                                    embeds: embeds
                                });
                                stats.messagesRestored++;
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        } catch (error) {
                            stats.errors.push(`فشل إرسال رسالة في ${channel.name}`);
                        }
                    }
                }
            }
        }

        return {
            success: true,
            stats: stats,
            backupInfo: {
                createdBy: backupData.createdBy,
                createdAt: backupData.createdAt,
                name: backupData.name,
                guildName: backupData.guildName
            }
        };
    } catch (error) {
        console.error('خطأ في استعادة النسخة:', error);
        return { success: false, error: error.message };
    }
}

function getBackupsForGuild(guildId) {
    try {
        const backupFiles = fs.readdirSync(backupsDir).filter(file =>
            file.startsWith(guildId) && file.endsWith('.json')
        );

        return backupFiles.map(file => {
            const backupData = readJSON(path.join(backupsDir, file));
            return {
                fileName: file,
                name: backupData.name,
                createdBy: backupData.createdBy,
                createdAt: backupData.createdAt,
                stats: backupData.stats,
                guildName: backupData.guildName
            };
        }).sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
        console.error('خطأ في قراءة النسخ:', error);
        return [];
    }
}

// جلب جميع النسخ الاحتياطية المتوفرة
function getAllBackups() {
    try {
        const backupFiles = fs.readdirSync(backupsDir).filter(file =>
            file.endsWith('.json')
        );

        return backupFiles.map(file => {
            const backupData = readJSON(path.join(backupsDir, file));
            return {
                fileName: file,
                name: backupData.name,
                createdBy: backupData.createdBy,
                createdAt: backupData.createdAt,
                stats: backupData.stats,
                guildName: backupData.guildName,
                guildId: backupData.guildId
            };
        }).sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
        console.error('خطأ في قراءة النسخ:', error);
        return [];
    }
}

function deleteBackup(backupFileName) {
    try {
        const backupFilePath = path.join(backupsDir, backupFileName);
        if (fs.existsSync(backupFilePath)) {
            fs.unlinkSync(backupFilePath);
            return { success: true };
        }
        return { success: false, error: 'الملف غير موجود' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    name: 'backup',
    description: 'نظام النسخ الاحتياطي الشامل للسيرفر',

    async execute(message, args, { client, BOT_OWNERS }) {
        const isOwner = BOT_OWNERS.includes(message.author.id);
        const isServerOwner = message.guild.ownerId === message.author.id;

        if (!isOwner && !isServerOwner) {
            const errorEmbed = colorManager.createEmbed()
                .setDescription('❌ **هذا الأمر متاح للمالكين فقط**');
            return message.channel.send({ embeds: [errorEmbed] });
        }

        const mainEmbed = colorManager.createEmbed()
            .setTitle('🗄️ نظام النسخ الاحتياطي الشامل')
            .setDescription('**اختر العملية المطلوبة:**\n\n' +
                '**إنشاء** - نسخ احتياطي شامل (رولات، قنوات، كاتوقريات، ملفات، رسائل)\n' +
                '**تنفيذ** - استعادة انتقائية من نسخة احتياطية\n' +
                '**عرض** - عرض قائمة النسخ المتاحة\n\n' +
                '⚠️ **تحذير:** الاستعادة ستحذف البيانات الحالية المحددة!')
            .setThumbnail(client.user.displayAvatarURL());

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('backup_create')
                .setLabel('إنشاء نسخة')
                .setEmoji('📥')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('backup_restore')
                .setLabel('تنفيذ نسخة')
                .setEmoji('📤')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('backup_list')
                .setLabel('عرض النسخ')
                .setEmoji('📋')
                .setStyle(ButtonStyle.Secondary)
        );

        const msg = await message.channel.send({ embeds: [mainEmbed], components: [row] });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            time: 600000
        });

        collector.on('collect', async interaction => {
            if (interaction.customId === 'backup_create') {
                const modal = new ModalBuilder()
                    .setCustomId('backup_create_modal')
                    .setTitle('إنشاء نسخة احتياطية شاملة');

                const nameInput = new TextInputBuilder()
                    .setCustomId('backup_name')
                    .setLabel('اسم النسخة (اختياري)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('مثال: نسخة_قبل_التحديث');

                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                await interaction.showModal(modal);

            } else if (interaction.customId === 'backup_restore') {
                // جلب جميع النسخ الاحتياطية المتوفرة
                const allBackups = getAllBackups();

                if (allBackups.length === 0) {
                    return interaction.reply({
                        content: '❌ **لا توجد نسخ احتياطية متوفرة**',
                        ephemeral: true
                    });
                }

                const options = allBackups.map(backup => ({
                    label: backup.name,
                    description: `${backup.guildName || 'سيرفر'} | ${new Date(backup.createdAt).toLocaleString('ar-SA')}`,
                    value: backup.fileName
                })).slice(0, 25);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('backup_select_restore')
                    .setPlaceholder('اختر نسخة للاستعادة')
                    .addOptions(options);

                const selectEmbed = colorManager.createEmbed()
                    .setTitle('📤 اختر نسخة للاستعادة')
                    .setDescription(`**عدد النسخ المتوفرة:** ${allBackups.length}\n\n⚠️ سيتم عرض خيارات الاستعادة بعد الاختيار\n💡 يمكنك استرجاع نسخ من أي سيرفر`);

                await interaction.update({
                    embeds: [selectEmbed],
                    components: [new ActionRowBuilder().addComponents(selectMenu)]
                });

            } else if (interaction.customId === 'backup_list') {
                const backups = getAllBackups();

                if (backups.length === 0) {
                    return interaction.reply({
                        content: '❌ **لا توجد نسخ احتياطية**',
                        ephemeral: true
                    });
                }

                let listText = '';
                backups.forEach((backup, index) => {
                    listText += `**${index + 1}.** ${backup.name}\n`;
                    listText += `   🏰 ${backup.guildName || 'سيرفر غير معروف'}\n`;
                    listText += `   📅 ${new Date(backup.createdAt).toLocaleString('ar-SA')}\n`;
                    listText += `   👤 <@${backup.createdBy}>\n`;
                    listText += `   📊 ${backup.stats.roles} رول | ${backup.stats.categories} كاتوقري | ${backup.stats.channels} قناة | ${backup.stats.messages || 0} رسالة\n\n`;
                });

                const listEmbed = colorManager.createEmbed()
                    .setTitle('📋 قائمة النسخ الاحتياطية')
                    .setDescription(listText)
                    .setFooter({ text: `إجمالي: ${backups.length} نسخة | من جميع السيرفرات` });

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('backup_delete')
                        .setLabel('حذف نسخة')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('backup_back')
                        .setLabel('رجوع')
                        .setStyle(ButtonStyle.Secondary)
                );

                await interaction.update({ embeds: [listEmbed], components: [actionRow] });

            } else if (interaction.customId === 'backup_delete') {
                const backups = getAllBackups();
                const options = backups.map(backup => ({
                    label: backup.name,
                    description: `${backup.guildName || 'سيرفر'} | ${new Date(backup.createdAt).toLocaleString('ar-SA')}`,
                    value: backup.fileName
                })).slice(0, 25);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('backup_select_delete')
                    .setPlaceholder('اختر نسخة للحذف')
                    .addOptions(options);

                await interaction.update({
                    embeds: [colorManager.createEmbed().setTitle('🗑️ حذف نسخة احتياطية')],
                    components: [new ActionRowBuilder().addComponents(selectMenu)]
                });

            } else if (interaction.customId === 'backup_back') {
                await interaction.update({ embeds: [mainEmbed], components: [row] });

            } else if (interaction.customId === 'backup_select_restore') {
                const selectedFile = interaction.values[0];
                const backupData = readJSON(path.join(backupsDir, selectedFile));

                const optionsEmbed = colorManager.createEmbed()
                    .setTitle('📦 اختر العناصر للاستعادة')
                    .setDescription('**حدد ما تريد استعادته من النسخة:**\n\n' +
                        `**الملفات:** ${backupData.stats.files} ملف\n` +
                        `**الرولات:** ${backupData.stats.roles} رول\n` +
                        `**الكاتوقريات:** ${backupData.stats.categories} كاتوقري\n` +
                        `**القنوات:** ${backupData.stats.channels} قناة\n` +
                        `**الرسائل:** ${backupData.stats.messages} رسالة\n\n` +
                        '⚠️ **سيتم حذف العناصر الحالية المحددة واستبدالها**');

                const selectOptions = new StringSelectMenuBuilder()
                    .setCustomId(`backup_options_${selectedFile}`)
                    .setPlaceholder('اختر العناصر للاستعادة')
                    .setMinValues(1)
                    .setMaxValues(8)
                    .addOptions([
                        { label: 'معلومات السيرفر', value: 'serverinfo', description: 'الاسم، الصورة، البنر' },
                        { label: 'الملفات', value: 'files', description: `${backupData.stats.files} ملف` },
                        { label: 'الرولات', value: 'roles', description: `${backupData.stats.roles} رول` },
                        { label: 'الكاتوقريات', value: 'categories', description: `${backupData.stats.categories} كاتوقري` },
                        { label: 'القنوات', value: 'channels', description: `${backupData.stats.channels} قناة` },
                        { label: 'الإيموجيز', value: 'emojis', description: `${backupData.stats.emojis} إيموجي` },
                        { label: 'الستيكرز', value: 'stickers', description: `${backupData.stats.stickers} ستيكر` },
                        { label: 'الرسائل', value: 'messages', description: `${backupData.stats.messages || 0} رسالة` }
                    ]);

                await interaction.update({
                    embeds: [optionsEmbed],
                    components: [
                        new ActionRowBuilder().addComponents(selectOptions),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('backup_cancel')
                                .setLabel('إلغاء')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ]
                });

            } else if (interaction.customId.startsWith('backup_options_')) {
                const selectedFile = interaction.customId.replace('backup_options_', '');
                const selectedOptions = interaction.values;
                const backupData = readJSON(path.join(backupsDir, selectedFile));

                const currentGuild = message.guild;
                const currentRoles = currentGuild.roles.cache.filter(r => !r.managed && r.id !== currentGuild.id).size;
                const currentCategories = currentGuild.channels.cache.filter(ch => ch.type === ChannelType.GuildCategory).size;
                const currentChannels = currentGuild.channels.cache.size;

                let statsText = '**📊 إحصائيات الاستعادة:**\n\n';

                if (selectedOptions.includes('serverinfo')) {
                    statsText += `🏰 **معلومات السيرفر:** سيتم تحديث الاسم والصورة والبنر\n\n`;
                }
                if (selectedOptions.includes('files')) {
                    statsText += `📄 **الملفات:** سيتم استعادة ${backupData.stats.files} ملف\n\n`;
                }
                if (selectedOptions.includes('roles')) {
                    statsText += `👔 **الرولات:**\n- سيتم حذف: ${currentRoles} رول\n- سيتم إنشاء: ${backupData.stats.roles} رول\n\n`;
                }
                if (selectedOptions.includes('categories')) {
                    statsText += `📁 **الكاتوقريات:**\n- سيتم حذف: ${currentCategories} كاتوقري\n- سيتم إنشاء: ${backupData.stats.categories} كاتوقري\n\n`;
                }
                if (selectedOptions.includes('channels')) {
                    statsText += `📺 **القنوات:**\n- سيتم حذف: ${currentChannels} قناة\n- سيتم إنشاء: ${backupData.stats.channels} قناة\n\n`;
                }
                if (selectedOptions.includes('emojis')) {
                    statsText += `😀 **الإيموجيز:** سيتم إنشاء ${backupData.stats.emojis} إيموجي\n\n`;
                }
                if (selectedOptions.includes('stickers')) {
                    statsText += `🎨 **الستيكرز:** ${backupData.stats.stickers} ستيكر (معلومات فقط)\n\n`;
                }
                if (selectedOptions.includes('messages')) {
                    statsText += `💬 **الرسائل:** سيتم استعادة ${backupData.stats.messages || 0} رسالة (بعد 5 دقائق)\n\n`;
                }

                const confirmEmbed = colorManager.createEmbed()
                    .setTitle('⚠️ تأكيد الاستعادة')
                    .setDescription(statsText + '\n**هل أنت متأكد من المتابعة؟**');

                // حفظ البيانات مؤقتاً في Map لتجنب مشكلة طول customId
                const confirmId = `conf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                if (!global.backupConfirmData) global.backupConfirmData = new Map();
                global.backupConfirmData.set(confirmId, { fileName: selectedFile, options: selectedOptions });

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(confirmId)
                        .setLabel('تأكيد الاستعادة')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('backup_cancel')
                        .setLabel('إلغاء')
                        .setStyle(ButtonStyle.Secondary)
                );

                await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });

            } else if (interaction.customId.startsWith('conf_')) {
                // استرجاع البيانات من Map
                const confirmData = global.backupConfirmData?.get(interaction.customId);
                if (!confirmData) {
                    return interaction.reply({ content: '❌ انتهت صلاحية هذا الطلب، الرجاء المحاولة مرة أخرى', ephemeral: true });
                }

                const fileName = confirmData.fileName;
                const options = confirmData.options;
                
                // حذف البيانات بعد الاستخدام
                global.backupConfirmData.delete(interaction.customId);

                await interaction.deferUpdate();
                await interaction.editReply({
                    embeds: [colorManager.createEmbed().setDescription('⏳ **جاري الاستعادة... قد يستغرق هذا عدة دقائق**')],
                    components: []
                });

                const result = await restoreBackup(fileName, message.guild, interaction.user.id, options);

                if (result.success) {
                    let successText = '✅ **تم استعادة النسخة بنجاح!**\n\n';

                    if (options.includes('serverinfo')) successText += `🏰 تم تحديث معلومات السيرفر\n`;
                    if (options.includes('files')) successText += `📄 الملفات: ${result.stats.filesRestored}\n`;
                    if (options.includes('roles')) successText += `👔 الرولات: حذف ${result.stats.rolesDeleted} | إنشاء ${result.stats.rolesCreated}\n`;
                    if (options.includes('categories')) successText += `📁 الكاتوقريات: حذف ${result.stats.categoriesDeleted} | إنشاء ${result.stats.categoriesCreated}\n`;
                    if (options.includes('channels')) successText += `📺 القنوات: حذف ${result.stats.channelsDeleted} | إنشاء ${result.stats.channelsCreated}\n`;
                    if (options.includes('emojis')) successText += `😀 تم استعادة الإيموجيز\n`;
                    if (options.includes('stickers')) successText += `🎨 معلومات الستيكرز محفوظة\n`;
                    if (options.includes('messages')) successText += `💬 الرسائل: ${result.stats.messagesRestored} (تم الإرسال بعد 5 دقائق)\n`;

                    if (result.stats.errors.length > 0) {
                        successText += `\n⚠️ **تحذيرات:** ${result.stats.errors.slice(0, 5).join('\n')}`;
                        if (result.stats.errors.length > 5) {
                            successText += `\n... و ${result.stats.errors.length - 5} خطأ آخر`;
                        }
                    }

                    await interaction.editReply({ embeds: [colorManager.createEmbed().setDescription(successText)] });

                    logEvent(client, message.guild, {
                        type: 'BOT_SETTINGS',
                        title: 'استعادة نسخة احتياطية',
                        description: `تم استعادة: ${options.join(', ')}`,
                        user: interaction.user
                    });
                } else {
                    await interaction.editReply({
                        embeds: [colorManager.createEmbed().setDescription(`❌ **فشل:** ${result.error}`)]
                    });
                }

            } else if (interaction.customId === 'backup_select_delete') {
                const selectedFile = interaction.values[0];
                const result = deleteBackup(selectedFile);

                if (result.success) {
                    await interaction.update({
                        embeds: [colorManager.createEmbed().setDescription('✅ **تم حذف النسخة**')],
                        components: []
                    });
                    setTimeout(() => interaction.message.edit({ embeds: [mainEmbed], components: [row] }), 2000);
                } else {
                    await interaction.update({
                        embeds: [colorManager.createEmbed().setDescription(`❌ ${result.error}`)],
                        components: []
                    });
                }

            } else if (interaction.customId === 'backup_cancel') {
                await interaction.update({ embeds: [mainEmbed], components: [row] });
            }
        });

        client.on('interactionCreate', async interaction => {
            if (!interaction.isModalSubmit() || interaction.customId !== 'backup_create_modal') return;
            if (interaction.user.id !== message.author.id) return;

            await interaction.deferReply({ ephemeral: true });

            const backupName = interaction.fields.getTextInputValue('backup_name') || `backup_${Date.now()}`;
            await interaction.editReply({ embeds: [colorManager.createEmbed().setDescription('⏳ **جاري إنشاء النسخة...**')] });

            const result = await createBackup(message.guild, interaction.user.id, backupName);

            if (result.success) {
                const successEmbed = colorManager.createEmbed()
                    .setTitle('✅ تم إنشاء النسخة بنجاح')
                    .addFields([
                        { name: 'الاسم', value: result.data.name, inline: true },
                        { name: 'الملفات', value: result.data.stats.files.toString(), inline: true },
                        { name: 'الرولات', value: result.data.stats.roles.toString(), inline: true },
                        { name: 'الكاتوقريات', value: result.data.stats.categories.toString(), inline: true },
                        { name: 'القنوات', value: result.data.stats.channels.toString(), inline: true },
                        { name: 'الرسائل', value: (result.data.stats.messages || 0).toString(), inline: true },
                        { name: 'الحجم', value: `${(JSON.stringify(result.data).length / 1024).toFixed(2)} KB`, inline: true }
                    ]);

                await interaction.editReply({ embeds: [successEmbed] });

                logEvent(client, message.guild, {
                    type: 'BOT_SETTINGS',
                    title: 'إنشاء نسخة احتياطية شاملة',
                    description: result.data.name,
                    user: interaction.user
                });
            } else {
                await interaction.editReply({
                    embeds: [colorManager.createEmbed().setDescription(`❌ **فشل:** ${result.error}`)]
                });
            }
        });

        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => {});
        });
    }
};