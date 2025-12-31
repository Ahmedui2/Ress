const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const { createPaginatedResponsibilityArray, handlePaginationInteraction } = require('../utils/responsibilityPagination.js');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const moment = require('moment-timezone');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const name = 'streak';

const dbPath = path.join(__dirname, '..', 'database', 'streak.db');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

let db = null;
const warnedGuilds = new Set();

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        db = new sqlite3.Database(dbPath, async (err) => {
            if (err) {
                console.error('خطأ في فتح قاعدة بيانات streak:', err);
                return reject(err);
            }

            try {
                // إعداد PRAGMA
                await runQuery('PRAGMA journal_mode=WAL');
                await runQuery('PRAGMA synchronous=NORMAL');

                // إنشاء الجداول بالترتيب مع الانتظار
                await runQuery(`CREATE TABLE IF NOT EXISTS streak_settings (
                    guild_id TEXT PRIMARY KEY,
                    approver_type TEXT,
                    approver_targets TEXT,
                    locked_channel_id TEXT,
                    divider_image_url TEXT,
                    reaction_emojis TEXT
                )`);

                await runQuery(`CREATE TABLE IF NOT EXISTS streak_users (
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    current_streak INTEGER DEFAULT 0,
                    longest_streak INTEGER DEFAULT 0,
                    last_post_date TEXT,
                    total_posts INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT 1,
                    PRIMARY KEY (guild_id, user_id)
                )`);

                await runQuery(`CREATE TABLE IF NOT EXISTS streak_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    message_id TEXT,
                    post_date TEXT NOT NULL,
                    streak_count INTEGER,
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                )`);

                await runQuery(`CREATE TABLE IF NOT EXISTS streak_restore_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    previous_streak INTEGER,
                    request_message TEXT,
                    status TEXT DEFAULT 'pending',
                    approver_id TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    resolved_at INTEGER
                )`);

                await runQuery(`CREATE TABLE IF NOT EXISTS streak_dividers (
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    message_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    user_message_ids TEXT
                )`);

                // إنشاء الفهارس
                await runQuery(`CREATE INDEX IF NOT EXISTS idx_streak_users_guild ON streak_users(guild_id)`);
                await runQuery(`CREATE INDEX IF NOT EXISTS idx_streak_history_guild_user ON streak_history(guild_id, user_id)`);
                await runQuery(`CREATE INDEX IF NOT EXISTS idx_streak_restore_status ON streak_restore_requests(status)`);

                console.log('تم تهيئة قاعدة بيانات Streak بنجاح');
                resolve();
            } catch (error) {
                console.error('خطأ في تهيئة جداول Streak:', error);
                reject(error);
            }
        });
    });
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function readJsonFile(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`خطأ في قراءة ${filePath}:`, error);
    }
    return defaultData;
}

async function getSettings(guildId) {
    const row = await getQuery('SELECT * FROM streak_settings WHERE guild_id = ?', [guildId]);
    if (!row) return null;
    
    return {
        approverType: row.approver_type,
        approverTargets: row.approver_targets ? JSON.parse(row.approver_targets) : [],
        lockedChannelId: row.locked_channel_id,
        dividerImageUrl: row.divider_image_url,
        reactionEmojis: row.reaction_emojis ? JSON.parse(row.reaction_emojis) : []
    };
}

async function saveSettings(guildId, settings) {
    const exists = await getQuery('SELECT guild_id FROM streak_settings WHERE guild_id = ?', [guildId]);
    
    if (exists) {
        await runQuery(`UPDATE streak_settings SET 
            approver_type = ?,
            approver_targets = ?,
            locked_channel_id = ?,
            divider_image_url = ?,
            reaction_emojis = ?
            WHERE guild_id = ?`, [
            settings.approverType || null,
            settings.approverTargets ? JSON.stringify(settings.approverTargets) : null,
            settings.lockedChannelId || null,
            settings.dividerImageUrl || null,
            settings.reactionEmojis ? JSON.stringify(settings.reactionEmojis) : null,
            guildId
        ]);
    } else {
        await runQuery(`INSERT INTO streak_settings (guild_id, approver_type, approver_targets, locked_channel_id, divider_image_url, reaction_emojis)
            VALUES (?, ?, ?, ?, ?, ?)`, [
            guildId,
            settings.approverType || null,
            settings.approverTargets ? JSON.stringify(settings.approverTargets) : null,
            settings.lockedChannelId || null,
            settings.dividerImageUrl || null,
            settings.reactionEmojis ? JSON.stringify(settings.reactionEmojis) : null
        ]);
    }
}

async function hasPermission(userId, guildId, guild, botOwners) {
    const settings = await getSettings(guildId);
    if (!settings || !settings.approverType) return false;

    if (settings.approverType === 'owners') {
        return botOwners.includes(userId);
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    if (settings.approverType === 'role') {
        const userRoles = member.roles.cache.map(role => role.id);
        return settings.approverTargets.some(roleId => userRoles.includes(roleId));
    }

    if (settings.approverType === 'responsibility') {
        const responsibilities = readJsonFile(responsibilitiesPath, {});
        for (const respName of settings.approverTargets) {
            const respData = responsibilities[respName];
            if (respData && respData.responsibles && respData.responsibles.includes(userId)) {
                return true;
            }
        }
    }

    return false;
}

function getTimeUntilMidnight() {
    const now = moment().tz('Asia/Riyadh');
    const midnight = moment().tz('Asia/Riyadh').endOf('day');
    const duration = moment.duration(midnight.diff(now));
    
    const hours = Math.floor(duration.asHours());
    const minutes = duration.minutes();
    const seconds = duration.seconds();
    
    return `**${hours}h , ${minutes}m , ${seconds}s**`;
}

function createStatusEmbed(settings = {}) {
    let approverDisplay = 'غير محدد';
    if (settings.approverType === 'owners') {
        approverDisplay = 'Owners Only';
    } else if (settings.approverType === 'role' && settings.approverTargets && settings.approverTargets.length > 0) {
        approverDisplay = settings.approverTargets.map(id => `<@&${id}>`).join(', ');
    } else if (settings.approverType === 'responsibility' && settings.approverTargets && settings.approverTargets.length > 0) {
        approverDisplay = `أعضاء المسؤولية : ${settings.approverTargets.join(', ')}`;
    }

    let lockedChannelDisplay = settings.lockedChannelId ? `<#${settings.lockedChannelId}>` : 'غير محدد';
    let dividerDisplay = settings.dividerImageUrl ? 'تم التحديد' : 'غير محدد';
    let emojisDisplay = settings.reactionEmojis && settings.reactionEmojis.length > 0 
        ? settings.reactionEmojis.join(' ') 
        : 'غير محدد';

    return colorManager.createEmbed()
        .setTitle('**Streak Sys**')
        .setDescription('نظام الستريكات لمسؤولين اللوكيت')
        .addFields(
            { name: '**المسؤولين**', value: approverDisplay, inline: false },
            { name: '**روم اللوكيت**', value: lockedChannelDisplay, inline: false },
            { name: '**صورة الخط **', value: dividerDisplay, inline: false },
            { name: '**الإيموجيات للرياكت**', value: emojisDisplay, inline: false }
        )
        .setFooter({ text: 'Streak System' });
}

function createMainButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('streak_set_approvers')
                .setLabel('تحديد المسؤولين')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('streak_set_channel')
                .setLabel('تحديد روم اللوكيت')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('streak_set_divider')
                .setLabel('تحديد الخط')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('streak_set_emojis')
                .setLabel('تحديد الإيموجيات')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createBackButton() {
    return new ButtonBuilder()
        .setCustomId('streak_back_to_main')
        .setLabel('Back')
        .setStyle(ButtonStyle.Primary);
}

async function getUserStreak(guildId, userId) {
    return await getQuery('SELECT * FROM streak_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

async function updateUserStreak(guildId, userId, currentStreak, totalPosts) {
    const existing = await getUserStreak(guildId, userId);
    const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
    
    if (existing) {
        const longestStreak = Math.max(existing.longest_streak, currentStreak);
        await runQuery(`UPDATE streak_users SET 
            current_streak = ?,
            longest_streak = ?,
            last_post_date = ?,
            total_posts = ?
            WHERE guild_id = ? AND user_id = ?`, 
            [currentStreak, longestStreak, today, totalPosts, guildId, userId]);
    } else {
        await runQuery(`INSERT INTO streak_users 
            (guild_id, user_id, current_streak, longest_streak, last_post_date, total_posts)
            VALUES (?, ?, ?, ?, ?, ?)`, 
            [guildId, userId, currentStreak, currentStreak, today, totalPosts]);
    }
}

async function recordStreakHistory(guildId, userId, messageId, streakCount) {
    const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
    await runQuery(`INSERT INTO streak_history (guild_id, user_id, message_id, post_date, streak_count)
        VALUES (?, ?, ?, ?, ?)`, [guildId, userId, messageId, today, streakCount]);
}

async function createRestoreRequest(guildId, userId, previousStreak) {
    await runQuery(`INSERT INTO streak_restore_requests (guild_id, user_id, previous_streak)
        VALUES (?, ?, ?)`, [guildId, userId, previousStreak]);
}

async function sendStreakWarnings(client) {
    try {
        const allUsers = await allQuery('SELECT * FROM streak_users WHERE is_active = 1 AND current_streak > 0');
        const now = moment().tz('Asia/Riyadh');
        const today = now.format('YYYY-MM-DD');

        console.log(`⚠️ فحص ${allUsers.length} مستخدم لإرسال تحذيرات - التاريخ: ${today} - الوقت: ${now.format('HH:mm:ss')}`);

        for (const userStreak of allUsers) {
            if (!userStreak.last_post_date) continue;

            const isActiveToday = userStreak.last_post_date === today;
            
            if (!isActiveToday) {
                const user = await client.users.fetch(userStreak.user_id).catch(() => null);
                if (user) {
                    const settings = await getSettings(userStreak.guild_id);
                    const channelMention = settings && settings.lockedChannelId ? `<#${settings.lockedChannelId}>` : 'روم اللوكيت';
                    
                    try {
                        await user.send({
                            embeds: [colorManager.createEmbed()
                                .setTitle('Streak Warn')
                                .setDescription(`سوف تخسر سلسلة الـ Streak الخاصة بك **${userStreak.current_streak}** <:emoji_64:1442587807150243932> يوم عند منتصف الليل!\n\n**أرسل صورة في ${channelMention} خلال الساعة القادمة للحفاظ على الـ Streak!**`)
                                .addFields([
                                    { name: ' الوقت المتبقي', value: getTimeUntilMidnight(), inline: true },
                                    { name: 'Your Streak', value: `${userStreak.current_streak} <:emoji_61:1442587727387427009>`, inline: true }
                                ])
                                .setColor('#FFFFFF')
                                .setFooter({ text: 'Streak System ' })]
                        });
                        console.log(`⚠️ تم إرسال تحذير للمستخدم ${userStreak.user_id}`);
                    } catch (dmErr) {
                        console.log(`❌ لا يمكن إرسال DM للمستخدم ${userStreak.user_id}`);
                    }
                }
            }
        }
        
        console.log(`✅ اكتمل إرسال التحذيرات عند ${now.format('HH:mm:ss')}`);
    } catch (error) {
        console.error('❌ خطأ في إرسال تحذيرات الـ Streaks:', error);
    }
}

async function checkStreakExpiration(client) {
    try {
        const allUsers = await allQuery('SELECT * FROM streak_users WHERE is_active = 1 AND current_streak > 0');
        const now = moment().tz('Asia/Riyadh');
        const today = now.format('YYYY-MM-DD');
        const yesterday = now.clone().subtract(1, 'days').format('YYYY-MM-DD');

        console.log(`🔍 فحص ${allUsers.length} مستخدم نشط - التاريخ: ${today} - الوقت: ${now.format('HH:mm:ss')}`);

        for (const userStreak of allUsers) {
            if (!userStreak.last_post_date) {
                console.log(`⚠️ المستخدم ${userStreak.user_id} ليس لديه تاريخ آخر منشور - تخطي`);
                continue;
            }

            const daysSincePost = moment(today).diff(moment(userStreak.last_post_date), 'days');
            
            console.log(`📊 المستخدم ${userStreak.user_id}: آخر منشور=${userStreak.last_post_date}, أيام مضت=${daysSincePost}, streak=${userStreak.current_streak}`);

            // إذا مر يوم أو أكثر بدون نشر - إنهاء الـ Streak
            // المستخدم يجب أن ينشر يومياً قبل منتصف الليل
            if (daysSincePost >= 1) {
                console.log(`💔 إنهاء Streak للمستخدم ${userStreak.user_id} - ${userStreak.current_streak} يوم - عدد الأيام المنقضية: ${daysSincePost}`);
                
                await runQuery('UPDATE streak_users SET current_streak = 0 WHERE guild_id = ? AND user_id = ?', 
                    [userStreak.guild_id, userStreak.user_id]);

                const user = await client.users.fetch(userStreak.user_id).catch(() => null);
                if (user) {
                    const restoreButton = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`streak_request_restore_${userStreak.guild_id}`)
                                .setLabel('طلب استعادة الـ Streak')
                                .setStyle(ButtonStyle.Primary)
                        );

                    try {
                        await user.send({
                            embeds: [colorManager.createEmbed()
                                .setTitle('Streak Ended')
                                .setDescription(`لقد خسرت سلسلة الـ Streak التي دامت **${userStreak.current_streak}** <:emoji_61:1442587727387427009>.\n\n**السبب :** لم تقم بإرسال صورة خلال يوم\n\n**يمكنك طلب استعادة الـ Streak من المسؤولين**`)
                                .addFields([
                                    { name: 'Last Pic', value: userStreak.last_post_date, inline: true },
                                    { name: 'Time to end', value: now.format('YYYY-MM-DD HH:mm:ss'), inline: true }
                                ])
                                
                                .setFooter({ text: 'Streak System ' })],
                            components: [restoreButton]
                        });
                        console.log(`✅ تم إرسال إشعار خسارة Streak للمستخدم ${userStreak.user_id}`);
                    } catch (dmErr) {
                        console.log(`❌ لا يمكن إرسال DM للمستخدم ${userStreak.user_id}`);
                    }
                }
            }
        }
        
        console.log(`✅ اكتمل فحص انتهاء الـ Streaks عند ${now.format('HH:mm:ss')}`);
    } catch (error) {
        console.error('❌ خطأ في فحص انتهاء الـ Streaks:', error);
    }
}

const messageCollectors = new Map();
const lastPosterByChannel = new Map();

async function handleLockedRoomMessage(message, client, botOwners) {
    if (message.author.bot) return;

    // التأكد من تهيئة قاعدة البيانات
    if (!db) {
        console.log('⚠️ قاعدة البيانات غير مهيأة، محاولة التهيئة...');
        try {
            await initializeDatabase();
        } catch (error) {
            console.error('❌ فشل في تهيئة قاعدة البيانات:', error);
            return;
        }
    }

    const guildId = message.guild.id;
    const settings = await getSettings(guildId);
    
    
    
    if (!settings) {
        if (!warnedGuilds.has(guildId)) {
            warnedGuilds.add(guildId);
            console.log(`⚠️ لا توجد إعدادات Streak للسيرفر ${guildId} (هذا التحذير يظهر مرة واحدة فقط)`);
        }
        return;
    }
    
    if (!settings.lockedChannelId) {
        console.log(`⚠️ لم يتم تحديد روم اللوكيت بعد`);
        return;
    }
    
    if (message.channel.id !== settings.lockedChannelId) {
        
        return;
    }
    
    console.log(`✅ الرسالة في روم اللوكيت - فحص المحتوى...`);

    const hasAllowedMedia = message.attachments.some(att => {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv'];
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
        
        if (att.contentType) {
            if (att.contentType.startsWith('image/')) return true;
            if (att.contentType.startsWith('video/')) return true;
            if (att.contentType.startsWith('audio/')) return true;
        }
        
        const fileName = att.name.toLowerCase();
        if (imageExtensions.some(ext => fileName.endsWith(ext))) return true;
        if (videoExtensions.some(ext => fileName.endsWith(ext))) return true;
        if (audioExtensions.some(ext => fileName.endsWith(ext))) return true;
        
        return false;
    });

    const isAdmin = await hasPermission(message.author.id, guildId, message.guild, botOwners);
    
    // إذا كانت الرسالة تحتوي على صورة أو فيديو أو صوت - مسموح من الجميع
    if (hasAllowedMedia) {
        console.log(`✅ الرسالة تحتوي على ميديا من ${message.author.username} - مسموح`);
    }
    // إذا كانت نص فقط (بدون ميديا)
    else {
        // إذا لم يكن من المسؤولين - حذف الرسالة
        if (!isAdmin) {
            try {
                await message.delete();
                console.log(`🗑️ تم حذف رسالة نصية من ${message.author.username} - ليس من المسؤولين`);
            } catch (error) {
                console.error(`❌ فشل في حذف رسالة ${message.author.username}:`, error);
            }
            return;
        }
        // المسؤول يكتب نص فقط - مسموح
        else {
            console.log(`✅ المسؤول ${message.author.username} كتب رسالة نصية - مسموح`);
            return;
        }
    }

    if (hasAllowedMedia) {
        console.log(`✅ تم اكتشاف ميديا في رسالة ${message.author.username}`);
        
        const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
        const userStreak = await getUserStreak(guildId, message.author.id);

        // إضافة التفاعلات أولاً (حتى لو نشر اليوم)
        console.log(`🔍 فحص التفاعلات - عدد الإيموجيات: ${settings.reactionEmojis?.length || 0}`);
        
        if (settings.reactionEmojis && settings.reactionEmojis.length > 0) {
            console.log(`📋 الإيموجيات المحددة: ${JSON.stringify(settings.reactionEmojis)}`);
            for (const emoji of settings.reactionEmojis) {
                try {
                    await message.react(emoji);
                    console.log(`✅ تم التفاعل بـ ${emoji} على رسالة ${message.author.username}`);
                } catch (err) {
                    console.error(`❌ فشل التفاعل بـ ${emoji}:`, err.message);
                }
            }
        } else {
            console.log('⚠️ لا توجد إيموجيات محددة للتفاعل');
        }

        // إنشاء خط فاصل جديد لكل صورة (حتى من نفس الشخص)
        lastPosterByChannel.set(message.channel.id, message.author.id);
        console.log(`➕ إنشاء خط فاصل جديد للصورة من ${message.author.username}`);
        await createDivider(message.channel, message.author, settings, guildId, [message.id]);

        // فحص هل تم النشر اليوم
        if (userStreak && userStreak.last_post_date === today) {
            console.log(`ℹ️ المستخدم ${message.author.username} نشر بالفعل اليوم - تحديث إحصائيات فقط`);
            await updateUserStreak(guildId, message.author.id, userStreak.current_streak, (userStreak.total_posts || 0) + 1);
            return;
        }

        let newStreakCount = 1;
        let shouldResetStreak = false;

        if (userStreak) {
            const lastPostDate = userStreak.last_post_date;
            const daysSinceLastPost = moment(today).diff(moment(lastPostDate), 'days');
            
            if (daysSinceLastPost === 1) {
                newStreakCount = userStreak.current_streak + 1;
            } else if (daysSinceLastPost > 1) {
                newStreakCount = 1;
                shouldResetStreak = true;
            } else {
                newStreakCount = userStreak.current_streak;
            }
        }

        await updateUserStreak(guildId, message.author.id, newStreakCount, (userStreak?.total_posts || 0) + 1);
        await recordStreakHistory(guildId, message.author.id, message.id, newStreakCount);

        // إلغاء طلبات الاستعادة المعلقة إذا بدأ المستخدم ستريك جديداً
        if (newStreakCount > 0) {
            await runQuery(
                'UPDATE streak_restore_requests SET status = "cancelled", resolved_at = strftime("%s", "now") WHERE guild_id = ? AND user_id = ? AND status = "pending"',
                [guildId, message.author.id]
            );
        }

        console.log(`🔥 تحديث الستريك لـ ${message.author.username}: ${newStreakCount}`);

        try {
            let dmEmbed = colorManager.createEmbed()
                .setTitle('** Streak Update**')
                .setDescription(`الـ Streak الخاص بك : **${newStreakCount}** <:emoji_64:1442587807150243932>\n\n**حافظ على السلسلة بإرسال صورة يومياً قبل منتصف الليل**`)
                .addFields([
                    { name: 'Your Streak ', value: `**${newStreakCount}**<:emoji_61:1442587727387427009>`, inline: true },
                    { name: 'Until New day', value: getTimeUntilMidnight(), inline: true }
                ])
                .setFooter({ text: 'Streak System' });

            if (shouldResetStreak && userStreak) {
                dmEmbed.setColor('#FFFFFF')
                    .setDescription(`تم إعادة تعيين الـ Streak\n\n**السبب :** لم تنشر في اليوم السابق\n**الستريك السابق :** ${userStreak.current_streak} <:emoji_63:1442587778964525077>`);
            }

            await message.author.send({ embeds: [dmEmbed] }).catch(() => {});
        } catch (dmErr) {
            console.log(`لا يمكن إرسال DM للمستخدم ${message.author.id}`);
        }
    }
}

async function createDivider(channel, user, settings, guildId, userMessageIds = []) {
    if (!settings || !settings.dividerImageUrl) {
        console.log('⚠️ لا يوجد رابط صورة للخط الفاصل في الإعدادات');
        return;
    }

    console.log(`🖼️ إنشاء خط فاصل للمستخدم ${user.username} - رابط: ${settings.dividerImageUrl}`);

    const deleteButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`streak_delete_${user.id}`)
                .setLabel('Delete Pic')
.setEmoji('<:emoji_64:1442587855447654522>')
                .setStyle(ButtonStyle.Secondary)
        );

    try {
        // محاولة تحميل الصورة كـ attachment
        const axios = require('axios');
        let dividerMsg;
        
        try {
            // تحميل الصورة من الرابط
            const response = await axios.get(settings.dividerImageUrl, { 
                responseType: 'arraybuffer',
                timeout: 10000 
            });
            
            const buffer = Buffer.from(response.data, 'binary');
            const extension = settings.dividerImageUrl.split('.').pop().split('?')[0] || 'png';
            const filename = `divider.${extension}`;
            
            const attachment = new AttachmentBuilder(buffer, { name: filename });
            
            // إرسال الصورة كـ attachment مع الزر
            dividerMsg = await channel.send({ 
                files: [attachment],
                components: [deleteButton]
            });
            
            console.log(`✅ تم إرسال الخط الفاصل كـ attachment - معرف الرسالة: ${dividerMsg.id}`);
        } catch (downloadError) {
            console.log(`⚠️ فشل تحميل الصورة كـ attachment، استخدام الرابط المباشر:`, downloadError.message);
            
            // Fallback: إرسال الرابط مباشرة (الطريقة القديمة)
            dividerMsg = await channel.send({ 
                content: settings.dividerImageUrl,
                components: [deleteButton]
            });
            
            console.log(`✅ تم إرسال الخط الفاصل كرابط - معرف الرسالة: ${dividerMsg.id}`);
        }
        
        await runQuery(`INSERT INTO streak_dividers (guild_id, channel_id, message_id, user_id, user_message_ids)
            VALUES (?, ?, ?, ?, ?)`, 
            [guildId, channel.id, dividerMsg.id, user.id, JSON.stringify(userMessageIds)]);
        
        console.log(`✅ تم حفظ الخط الفاصل في قاعدة البيانات`);
    } catch (error) {
        console.error('❌ خطأ في إنشاء الخط الفاصل:', error);
        console.error('تفاصيل الخطأ:', error.message);
        console.error('الإعدادات:', JSON.stringify(settings));
    }
}

async function handleDividerDelete(interaction, client, botOwners) {
    const guildId = interaction.guild.id;
    const isAdmin = await hasPermission(interaction.user.id, guildId, interaction.guild, botOwners);

    if (!isAdmin) {
        return interaction.reply({ content: '**تبي تحذف صور الناس؟ باند**', flags: 64 });
    }

    const userId = interaction.customId.split('_')[2];

    const modal = new ModalBuilder()
        .setCustomId(`streak_delete_reason_${userId}_${interaction.message.id}`)
        .setTitle('Reason');

    const reasonInput = new TextInputBuilder()
        .setCustomId('delete_reason')
        .setLabel('ما هو سبب حذف الصور؟')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal);
}

async function handleDeleteReasonModal(interaction, client) {
    const [, , , userId, dividerMessageId] = interaction.customId.split('_');
    const reason = interaction.fields.getTextInputValue('delete_reason');

    const divider = await getQuery('SELECT * FROM streak_dividers WHERE message_id = ?', [dividerMessageId]);
    
    if (!divider) {
        return interaction.reply({ content: '**لم يتم العثور على معلومات الخط الفاصل**', flags: 64 });
    }

    const userMessageIds = JSON.parse(divider.user_message_ids || '[]');

    // حذف الصورة المرتبطة بهذا الخط الفاصل فقط
    for (const msgId of userMessageIds) {
        try {
            const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (msg) await msg.delete();
        } catch (err) {
            console.error(`فشل حذف الرسالة ${msgId}:`, err.message);
        }
    }

    // حذف الخط الفاصل
    try {
        const dividerMessage = await interaction.channel.messages.fetch(dividerMessageId).catch(() => null);
        if (dividerMessage) await dividerMessage.delete();
    } catch (err) {
        console.error('فشل حذف الخط الفاصل:', err.message);
    }

    await runQuery('DELETE FROM streak_dividers WHERE message_id = ?', [dividerMessageId]);

    // تأجيل الرد إذا كان هناك تأخير في الحذف لضمان بقاء التفاعل صالحاً
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        try {
            await user.send({
                embeds: [colorManager.createEmbed()
                    .setTitle('** من المسؤولين : تم حذف صورتك من روم اللوكيت**')
                    .setDescription(`**السبب :** ${reason}`)
                    
                    .setFooter({ text: 'Streak System' })]
            });
        } catch (dmErr) {
            console.log(`لا يمكن إرسال DM للمستخدم ${userId}`);
        }
    }

    if (interaction.deferred) {
        await interaction.editReply({ content: '**تم حذف الصورة وإرسال السبب للعضو**' });
    } else {
        await interaction.reply({ content: '**تم حذف الصورة وإرسال السبب للعضو**', flags: 64 });
    }
}

async function handleRestoreRequest(interaction, client, botOwners) {
    const guildId = interaction.customId.split('_')[3];
    const userId = interaction.user.id;

    const userStreak = await getUserStreak(guildId, userId);
    if (!userStreak || userStreak.current_streak > 0) {
        return interaction.reply({ content: '**لا يمكن طلب استعادة الـ Streak حالياً**', flags: 64 });
    }

    const existingRequest = await getQuery(
        'SELECT * FROM streak_restore_requests WHERE guild_id = ? AND user_id = ? AND status = ?',
        [guildId, userId, 'pending']
    );

    if (existingRequest) {
        return interaction.reply({ content: '**لديك طلب استعادة قيد الانتظار بالفعل**', flags: 64 });
    }

    await createRestoreRequest(guildId, userId, userStreak.longest_streak);

    const settings = await getSettings(guildId);
    const guild = await client.guilds.fetch(guildId);
    
    if (settings && settings.approverType) {
        const approvers = await getApprovers(settings, guild, botOwners);
        
        for (const approverId of approvers) {
            const approver = await client.users.fetch(approverId).catch(() => null);
            if (approver) {
                const approveButtons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`streak_approve_restore_${guildId}_${userId}`)
                            .setLabel('موافقة')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`streak_reject_restore_${guildId}_${userId}`)
                            .setLabel('رفض')
                            .setStyle(ButtonStyle.Danger)
                    );

                try {
                    await approver.send({
                        embeds: [colorManager.createEmbed()
                            .setTitle('**طلب استعادة Streak**')
                            .setDescription(`العضو <@${userId}> يطلب استعادة سلسلة الـ Streak.\n\n**السلسلة السابقة :** ${userStreak.longest_streak} <:emoji_60:1442587701474754760>`)
                            
                            .setFooter({ text: 'Streak System' })],
                        components: [approveButtons]
                    });
                } catch (dmErr) {
                    console.log(`لا يمكن إرسال DM للمعتمد ${approverId}`);
                }
            }
        }
    }

    await interaction.reply({ content: '**تم إرسال طلب استعادة الـ Streak للمسؤولين**', flags: 64 });
}

async function getApprovers(settings, guild, botOwners) {
    const approvers = [];

    if (settings.approverType === 'owners') {
        return botOwners;
    }

    if (settings.approverType === 'role') {
        for (const roleId of settings.approverTargets) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                const members = role.members.map(m => m.user.id);
                approvers.push(...members);
            }
        }
    }

    if (settings.approverType === 'responsibility') {
        const responsibilities = readJsonFile(responsibilitiesPath, {});
        for (const respName of settings.approverTargets) {
            const respData = responsibilities[respName];
            if (respData && respData.responsibles) {
                approvers.push(...respData.responsibles);
            }
        }
    }

    return [...new Set(approvers)];
}

async function handleApproveRestore(interaction, client) {
    const [, , , guildId, userId] = interaction.customId.split('_');

    const request = await getQuery(
        'SELECT * FROM streak_restore_requests WHERE guild_id = ? AND user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1',
        [guildId, userId]
    );

    if (!request) {
        // التحقق مما إذا كان الطلب قد تم إلغاؤه تلقائياً
        const cancelledRequest = await getQuery(
            'SELECT * FROM streak_restore_requests WHERE guild_id = ? AND user_id = ? AND status = "cancelled" ORDER BY resolved_at DESC LIMIT 1',
            [guildId, userId]
        );
        
        if (cancelledRequest) {
            return interaction.reply({ content: '**تم إلغاء هذا الطلب تلقائياً لأن العضو بدأ سلسلة ستريك جديدة بالفعل**', flags: 64 });
        }
        
        return interaction.reply({ content: '**لا يوجد طلب استعادة قيد الانتظار لهذا المستخدم**', flags: 64 });
    }

    await runQuery('UPDATE streak_restore_requests SET status = ?, approver_id = ?, resolved_at = strftime("%s", "now") WHERE id = ?',
        ['approved', interaction.user.id, request.id]);

    await runQuery('UPDATE streak_users SET current_streak = ?, is_active = 1 WHERE guild_id = ? AND user_id = ?',
        [request.previous_streak, guildId, userId]);

    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        try {
            await user.send({
                embeds: [colorManager.createEmbed()
                    .setTitle('**تمت الموافقة على استعادة الـ Streak**')
                    .setDescription(`تم استعادة سلسلة الـ Streak الخاصة بك: **${request.previous_streak}** <:emoji_61:1442587727387427009>.\n\n**استمر في إرسال الصور يومياً**`)
                    .setColor('#FFFFFF')
                    .setFooter({ text: 'Streak System' })]
            });
        } catch (dmErr) {
            console.log(`لا يمكن إرسال DM للمستخدم ${userId}`);
        }
    }

    await interaction.update({ 
        embeds: [colorManager.createEmbed()
            .setTitle('**تمت الموافقة على الطلب**')
            .setDescription(`تمت الموافقة على استعادة الـ Streak للعضو <@${userId}>`)
            ],
        components: []
    });
}

async function handleRejectRestore(interaction, client) {
    const [, , , guildId, userId] = interaction.customId.split('_');

    const request = await getQuery(
        'SELECT * FROM streak_restore_requests WHERE guild_id = ? AND user_id = ? AND status = "pending" ORDER BY created_at DESC LIMIT 1',
        [guildId, userId]
    );

    if (!request) {
        // التحقق مما إذا كان الطلب قد تم إلغاؤه تلقائياً
        const cancelledRequest = await getQuery(
            'SELECT * FROM streak_restore_requests WHERE guild_id = ? AND user_id = ? AND status = "cancelled" ORDER BY resolved_at DESC LIMIT 1',
            [guildId, userId]
        );
        
        if (cancelledRequest) {
            return interaction.reply({ content: '**تم إلغاء هذا الطلب تلقائياً لأن العضو بدأ سلسلة ستريك جديدة بالفعل**', flags: 64 });
        }
        
        return interaction.reply({ content: '**لا يوجد طلب استعادة قيد الانتظار لهذا المستخدم**', flags: 64 });
    }

    await runQuery('UPDATE streak_restore_requests SET status = ?, approver_id = ?, resolved_at = strftime("%s", "now") WHERE id = ?',
        ['rejected', interaction.user.id, request.id]);

    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
        try {
            await user.send({
                embeds: [colorManager.createEmbed()
                    .setTitle('**تم رفض طلب استعادة الـ Streak**')
                    .setDescription(`تم رفض طلب استعادة الـ Streak من قبل المسؤولين.\n\n**يمكنك بدء سلسلة جديدة بإرسال صورة**`)
                    
                    .setFooter({ text: 'Streak System' })]
            });
        } catch (dmErr) {
            console.log(`لا يمكن إرسال DM للمستخدم ${userId}`);
        }
    }

    await interaction.update({ 
        embeds: [colorManager.createEmbed()
            .setTitle('**تم رفض الطلب**')
            .setDescription(`تم رفض طلب استعادة الـ Streak للعضو <@${userId}>`)
            .setColor('#FFFFFF')],
        components: []
    });
}

function startStreakScheduler(client) {
    // فحص انتهاء الـ Streaks عند منتصف الليل (12:00 AM) بتوقيت الرياض
    schedule.scheduleJob({ hour: 0, minute: 0, tz: 'Asia/Riyadh' }, async () => {
        console.log('⏰ منتصف الليل بتوقيت الرياض - تشغيل فحص انتهاء الـ Streaks...');
        await checkStreakExpiration(client);
    });

    // إضافة مهمة للتحذيرات عند الساعة 10 مساءً بتوقيت الرياض (قبل ساعتين من منتصف الليل)
    schedule.scheduleJob({ hour: 22, minute: 0, tz: 'Asia/Riyadh' }, async () => {
        console.log('⏰ الساعة 10 مساءً بتوقيت الرياض - إرسال تحذيرات الـ Streaks...');
        await sendStreakWarnings(client);
    });

    console.log('✅ تم تشغيل مجدول فحص الـ Streaks (يومياً عند منتصف الليل 12:00 AM بتوقيت الرياض)');
    console.log('✅ تم تشغيل مجدول التحذيرات (يومياً عند 10:00 PM بتوقيت الرياض)');
}

async function setupEmojiCollector(message, settings) {
    if (!settings.reactionEmojis || settings.reactionEmojis.length === 0) return;

    // تنظيف Collectors القديمة (أكثر من ساعة)
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    for (const [msgId, collectorData] of messageCollectors.entries()) {
        if (now - collectorData.timestamp > oneHour) {
            collectorData.collector.stop();
            messageCollectors.delete(msgId);
        }
    }

    const filter = (reaction, user) => {
        return !user.bot && settings.reactionEmojis.some(emoji => {
            const emojiIdMatch = emoji.match(/<a?:\w+:(\d+)>/);
            if (emojiIdMatch) {
                return reaction.emoji.id === emojiIdMatch[1];
            }
            return reaction.emoji.name === emoji;
        });
    };

    // Collector لمدة 24 ساعة بدلاً من للأبد
    const collector = message.createReactionCollector({ filter, time: 24 * 60 * 60 * 1000 });

    collector.on('collect', async (reaction, user) => {
        console.log(`تم التفاعل على رسالة ${message.id} من ${user.tag}`);
    });

    collector.on('end', () => {
        messageCollectors.delete(message.id);
    });

    messageCollectors.set(message.id, { collector, timestamp: now });
}

module.exports = {
    name,
    description: 'نظام Streak المتكامل لتتبع نشاط الأعضاء اليومي',
    
    async initialize(client) {
        await initializeDatabase();
        startStreakScheduler(client);
        console.log('تم تهيئة نظام Streak بنجاح');
    },

    async execute(message, args, { BOT_OWNERS }) {
        // التأكد من تهيئة قاعدة البيانات
        if (!db) {
            console.log('⚠️ قاعدة البيانات غير مهيأة، محاولة التهيئة...');
            try {
                await initializeDatabase();
            } catch (error) {
                console.error('❌ فشل في تهيئة قاعدة البيانات:', error);
                return message.reply('❌ حدث خطأ في تهيئة نظام Streak');
            }
        }

        const guildId = message.guild.id;

        // إذا كان المستخدم يطلب الستريك الخاص به أو ستريك شخص آخر
        if (args.length > 0 || !BOT_OWNERS.includes(message.author.id)) {
            const targetUser = message.mentions.users.first() || message.author;
            const userStreak = await getUserStreak(guildId, targetUser.id);
            
            if (!userStreak) {
                return message.reply(`**${targetUser.username} ليس لديه سلسلة ستريك حالياً**`);
            }

            const embed = colorManager.createEmbed()
                .setTitle(`**Streak: ${targetUser.username}**`)
                .addFields(
                    { name: '**الستريك الحالي**', value: `${userStreak.current_streak} <:emoji_61:1442587727387427009>`, inline: true },
                    { name: '**أطول ستريك**', value: `${userStreak.longest_streak} <:emoji_60:1442587701474754760>`, inline: true },
                    { name: '**إجمالي الصور**', value: `${userStreak.total_posts || 0} 🖼️`, inline: true }
                )
                .setFooter({ text: 'Streak System' });

            return message.reply({ embeds: [embed] });
        }

        const settings = await getSettings(guildId);
        const statusEmbed = createStatusEmbed(settings || {});
        const mainButtons = createMainButtons();

        await message.channel.send({ embeds: [statusEmbed], components: [mainButtons] });
    },

    async handleInteraction(interaction, context) {
        console.log(`🔍 معالجة تفاعل Streak: ${interaction.customId}`);
        
        const { client, BOT_OWNERS } = context;
        const customId = interaction.customId;
        
        // استخراج guildId من customId إذا كان التفاعل من DM
        let guildId = interaction.guild?.id;
        
        // للتفاعلات التي تأتي من DM (مثل طلب استعادة Streak)
        if (!guildId && customId.includes('_')) {
            const parts = customId.split('_');
            // محاولة استخراج guildId من آخر جزء من customId
            const potentialGuildId = parts[parts.length - 1];
            // التحقق من أن الجزء الأخير يبدو كـ guild ID (رقم طويل)
            if (potentialGuildId && /^\d{17,20}$/.test(potentialGuildId)) {
                guildId = potentialGuildId;
                console.log(`✅ تم استخراج guildId من customId: ${guildId}`);
            }
        }
        
        // التحقق من وجود guildId للتفاعلات التي تحتاج إليه
        const needsGuildId = !customId.startsWith('streak_request_restore_');
        if (!guildId && needsGuildId) {
            console.log(`❌ لا يوجد guildId في التفاعل: ${customId}`);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({
                    content: '❌ حدث خطأ في معالجة التفاعل',
                    flags: 64
                }).catch(() => {});
            }
            return;
        }
        
        // التأكد من تهيئة قاعدة البيانات
        if (!db) {
            console.log('⚠️ قاعدة البيانات غير مهيأة في handleInteraction');
            try {
                await initializeDatabase();
                console.log('✅ تم تهيئة قاعدة البيانات في handleInteraction');
            } catch (error) {
                console.error('❌ فشل في تهيئة قاعدة البيانات:', error);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({
                        content: '❌ حدث خطأ في تهيئة نظام Streak',
                        flags: 64
                    });
                }
                return;
            }
        }

        // معالجة Modal للسبب عند الحذف
        if (interaction.isModalSubmit() && customId.startsWith('streak_delete_reason_')) {
            return handleDeleteReasonModal(interaction, client);
        }
        
        // معالجة Modal للخط الفاصل
        if (interaction.isModalSubmit() && customId === 'streak_divider_modal') {
            const imageUrl = interaction.fields.getTextInputValue('divider_url');
            let settings = await getSettings(guildId) || {};
            settings.dividerImageUrl = imageUrl;
            await saveSettings(guildId, settings);
            
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            
            await interaction.deferUpdate();
            await interaction.message.edit({ content: null, embeds: [statusEmbed], components: [mainButtons] });
            return;
        }
        
        // معالجة Modal للإيموجيات
        if (interaction.isModalSubmit() && customId === 'streak_emojis_modal') {
            const emojisString = interaction.fields.getTextInputValue('emojis_list');
            const emojis = emojisString.trim().split(/\s+/);
            let settings = await getSettings(guildId) || {};
            settings.reactionEmojis = emojis;
            await saveSettings(guildId, settings);
            
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            
            await interaction.deferUpdate();
            await interaction.message.edit({ content: null, embeds: [statusEmbed], components: [mainButtons] });
            return;
        }

        if (customId.startsWith('streak_delete_')) {
            return handleDividerDelete(interaction, client, BOT_OWNERS);
        }

        if (customId.startsWith('streak_request_restore_')) {
            return handleRestoreRequest(interaction, client, BOT_OWNERS);
        }

        if (customId.startsWith('streak_approve_restore_')) {
            return handleApproveRestore(interaction, client);
        }

        if (customId.startsWith('streak_reject_restore_')) {
            return handleRejectRestore(interaction, client);
        }

        // التحقق من الصلاحيات لجميع التفاعلات ما عدا طلبات الاستعادة
        if (!customId.startsWith('streak_request_restore_') && 
            !customId.startsWith('streak_approve_restore_') && 
            !customId.startsWith('streak_reject_restore_')) {
            if (!BOT_OWNERS.includes(interaction.user.id)) {
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: '** يالليل لا تضغط **', flags: 64 });
                }
                return;
            }
        }

        let settings = await getSettings(guildId) || {};

        if (customId === 'streak_back_to_main') {
            settings = await getSettings(guildId) || {};
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            if (!interaction.replied && !interaction.deferred) {
                return interaction.update({ content: null, embeds: [statusEmbed], components: [mainButtons] });
            }
            return;
        }

        if (customId === 'streak_set_approvers') {
            const approverButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('streak_approver_owners').setLabel('المالكين').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('streak_approver_role').setLabel('رول').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('streak_approver_resp').setLabel('مسؤولية').setStyle(ButtonStyle.Success),
                    createBackButton()
                );
            return interaction.update({ content: '**اختر نوع المعتمدين:**', embeds: [], components: [approverButtons] });
        }

        if (customId === 'streak_approver_owners') {
            settings.approverType = 'owners';
            settings.approverTargets = [];
            await saveSettings(guildId, settings);
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            return interaction.update({ content: null, embeds: [statusEmbed], components: [mainButtons] });
        }

        if (customId === 'streak_approver_role') {
            const roleMenu = new RoleSelectMenuBuilder()
                .setCustomId('streak_role_select')
                .setPlaceholder('اختر الأدوار المعتمدة')
                .setMinValues(1)
                .setMaxValues(10);
            const menuRow = new ActionRowBuilder().addComponents(roleMenu);
            const backRow = new ActionRowBuilder().addComponents(createBackButton());
            return interaction.update({ content: '**اختر الأدوار:**', embeds: [], components: [menuRow, backRow] });
        }

        if (customId === 'streak_approver_resp') {
            const responsibilities = readJsonFile(responsibilitiesPath, {});
            const respNames = Object.keys(responsibilities);
            
            if (respNames.length === 0) {
                const statusEmbed = createStatusEmbed(settings);
                const mainButtons = createMainButtons();
                return interaction.update({ content: '**لا توجد مسؤوليات محددة**', embeds: [statusEmbed], components: [mainButtons] });
            }

            const pagination = createPaginatedResponsibilityArray(respNames, 0, 'streak_resp_select', 'اختر المسؤولية');
            const backRow = new ActionRowBuilder().addComponents(createBackButton());
            const allComponents = [...pagination.components, backRow];
            return interaction.update({ content: '**اختر المسؤولية:**', embeds: [], components: allComponents });
        }

        if (interaction.isRoleSelectMenu() && customId === 'streak_role_select') {
            settings.approverType = 'role';
            settings.approverTargets = interaction.values;
            await saveSettings(guildId, settings);
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            return interaction.update({ content: null, embeds: [statusEmbed], components: [mainButtons] });
        }

        if (interaction.isStringSelectMenu() && customId === 'streak_resp_select') {
            settings.approverType = 'responsibility';
            settings.approverTargets = interaction.values;
            await saveSettings(guildId, settings);
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            return interaction.update({ content: null, embeds: [statusEmbed], components: [mainButtons] });
        }

        if (customId === 'streak_set_channel') {
            const channelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('streak_channel_select')
                .setPlaceholder('اختر روم اللوكيت')
                .addChannelTypes(ChannelType.GuildText);
            const menuRow = new ActionRowBuilder().addComponents(channelMenu);
            const backRow = new ActionRowBuilder().addComponents(createBackButton());
            return interaction.update({ content: '**اختر روم اللوكيت:**', embeds: [], components: [menuRow, backRow] });
        }

        if (interaction.isChannelSelectMenu() && customId === 'streak_channel_select') {
            settings.lockedChannelId = interaction.values[0];
            await saveSettings(guildId, settings);
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            return interaction.update({ content: null, embeds: [statusEmbed], components: [mainButtons] });
        }

        if (customId === 'streak_set_divider') {
            const modal = new ModalBuilder()
                .setCustomId('streak_divider_modal')
                .setTitle('تحديد صورة الخط الفاصل');

            const urlInput = new TextInputBuilder()
                .setCustomId('divider_url')
                .setLabel('رابط صورة الخط الفاصل')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('https://example.com/image.png');

            modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
            return interaction.showModal(modal);
        }

        if (customId === 'streak_divider_modal') {
            const imageUrl = interaction.fields.getTextInputValue('divider_url');
            settings.dividerImageUrl = imageUrl;
            await saveSettings(guildId, settings);
            
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            
            await interaction.deferUpdate();
            await interaction.message.edit({ content: null, embeds: [statusEmbed], components: [mainButtons] });
            return;
        }

        if (customId === 'streak_set_emojis') {
            const modal = new ModalBuilder()
                .setCustomId('streak_emojis_modal')
                .setTitle('تحديد الإيموجيات');

            const emojisInput = new TextInputBuilder()
                .setCustomId('emojis_list')
                .setLabel('أرسل الإيموجيات (مفصولة بمسافة)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('لازم من السيرفر');

            modal.addComponents(new ActionRowBuilder().addComponents(emojisInput));
            return interaction.showModal(modal);
        }

        if (customId === 'streak_emojis_modal') {
            const emojisString = interaction.fields.getTextInputValue('emojis_list');
            const emojis = emojisString.trim().split(/\s+/);
            settings.reactionEmojis = emojis;
            await saveSettings(guildId, settings);
            
            const statusEmbed = createStatusEmbed(settings);
            const mainButtons = createMainButtons();
            
            await interaction.deferUpdate();
            await interaction.message.edit({ content: null, embeds: [statusEmbed], components: [mainButtons] });
            return;
        }
    },

    async handleMessage(message, client, botOwners) {
        await handleLockedRoomMessage(message, client, botOwners);
    },

    async handleMessageDelete(message, client) {
        try {
            // استخدام guildId و channelId بدلاً من guild و channel لدعم partial messages
            const guildId = message.guildId || message.guild?.id;
            const channelId = message.channelId || message.channel?.id;
            const messageId = message.id;
            
            // التحقق من وجود معلومات أساسية
            if (!guildId || !channelId || !messageId) {
                console.log(`⚠️ رسالة محذوفة بدون معلومات كافية`);
                return;
            }

            const settings = await getSettings(guildId);
            
            // التحقق من وجود إعدادات وروم لوكيت محدد
            if (!settings || !settings.lockedChannelId) return;
            
            // التحقق من أن الرسالة المحذوفة في روم اللوكيت
            if (channelId !== settings.lockedChannelId) return;

            console.log(`🗑️ تم حذف رسالة في روم اللوكيت - ID: ${messageId}`);

            // البحث عن الخط الفاصل المرتبط بهذه الرسالة
            const divider = await getQuery(
                'SELECT * FROM streak_dividers WHERE user_message_ids LIKE ?',
                [`%"${messageId}"%`]
            );

            if (divider) {
                console.log(`🎯 وجدنا خط فاصل مرتبط بالرسالة المحذوفة - Divider ID: ${divider.message_id}`);
                
                // حذف الخط الفاصل
                try {
                    const channel = await client.channels.fetch(divider.channel_id).catch(() => null);
                    if (channel) {
                        const dividerMessage = await channel.messages.fetch(divider.message_id).catch(() => null);
                        if (dividerMessage) {
                            await dividerMessage.delete();
                            console.log(`✅ تم حذف الخط الفاصل - ID: ${divider.message_id}`);
                        } else {
                            console.log(`⚠️ الخط الفاصل غير موجود في الكاش - ربما محذوف مسبقاً`);
                        }
                    }
                } catch (deleteError) {
                    console.error(`❌ فشل في حذف الخط الفاصل:`, deleteError.message);
                }

                // حذف السجل من قاعدة البيانات في جميع الأحوال
                await runQuery('DELETE FROM streak_dividers WHERE message_id = ?', [divider.message_id]);
                console.log(`🗄️ تم حذف سجل الخط الفاصل من قاعدة البيانات`);
            } else {
                console.log(`ℹ️ لم يتم العثور على خط فاصل مرتبط بالرسالة المحذوفة`);
            }
        } catch (error) {
            console.error('❌ خطأ في معالجة حذف رسالة Streak:', error);
        }
    }
};
