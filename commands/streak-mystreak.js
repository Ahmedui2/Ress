
const colorManager = require('../utils/colorManager.js');
const moment = require('moment-timezone');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const name = 'ستريكي';

const dbPath = path.join(__dirname, '..', 'database', 'streak.db');
let db = null;

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
            console.log('✅ تم فتح قاعدة بيانات Streak في mystreak');
            
            // إنشاء الجداول إذا لم تكن موجودة
            try {
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
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
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
                    user_message_ids TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                )`);

                console.log('✅ تم التحقق من جداول Streak في mystreak');
                resolve();
            } catch (tableError) {
                console.error('❌ خطأ في إنشاء جداول Streak:', tableError);
                reject(tableError);
            }
        });
    });
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error('قاعدة البيانات غير مهيأة'));
        }
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!db) {
            return reject(new Error('قاعدة البيانات غير مهيأة'));
        }
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
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

async function getUserStreak(guildId, userId) {
    return await getQuery('SELECT * FROM streak_users WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
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

module.exports = {
    name,
    description: 'عرض معلومات الـ Streak الخاصة بك',
    
    async initialize(client) {
        await initializeDatabase();
        console.log('تم تهيئة أمر ستريكي');
    },

    async execute(message, args) {
        // تهيئة قاعدة البيانات إذا لم تكن مهيأة
        if (!db) {
            await initializeDatabase();
        }

        const guildId = message.guild.id;
        const userStreak = await getUserStreak(guildId, message.author.id);
        const settings = await getSettings(guildId);
        
        if (!userStreak) {
            const noStreakEmbed = colorManager.createEmbed()
                .setTitle(' معلومات الـ Streak')
                .setDescription('**.مابديت ستريكات بعد ، ارسل صورة باللوكت **')
                .addFields([
                    { name: 'Your Streak ', value: '**0**<:emoji_29:1432242213185650721>', inline: true },
                    { name: 'Status', value: '<:emoji_30:1432242238531960913>', inline: true },
                    { name: 'Time to end', value: getTimeUntilMidnight(), inline: false }
                ])
            
                .setFooter({ text: 'Streak it.' });
            
            return message.channel.send({ embeds: [noStreakEmbed] });
        }

        const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
        const isActiveToday = userStreak.last_post_date === today;
        const fireEmojis = '🔥'.repeat(Math.min(Math.floor(userStreak.current_streak / 5) + 1, 5));
        
        let statusText;
        let statusColor;
        if (isActiveToday) {
            statusText = '<:emoji_28:1432242139948908564>';
            statusColor = '#FFFFFF';
        } else {
            statusText = '<:emoji_29:1432242189869514753>';
            statusColor = '#FFFFFF';
        }

        const timeUntilMidnight = getTimeUntilMidnight();
        
        const streakEmbed = colorManager.createEmbed()
            .setTitle(` معلومات الـ Streak`)
                        .addFields([
                { name: 'Your Streak', value: `**${userStreak.current_streak}**<:emoji_29:1432242213185650721> `, inline: true },
                { name: 'Longest Streak', value: `**${userStreak.longest_streak}**<:emoji_29:1432242213185650721> `, inline: true },
                { name: 'Status', value: statusText, inline: false },
                { name: 'Last Pic', value: userStreak.last_post_date || 'لا يوجد', inline: true },
                { name: 'Total Pic', value: `**${userStreak.total_posts}**`, inline: true },
                { name: 'Time to New day', value: timeUntilMidnight, inline: false }
            ])
            .setColor(statusColor)
            .setFooter({ text: 'Keep it.' });
        
        return message.channel.send({ embeds: [streakEmbed] });
    }
};
