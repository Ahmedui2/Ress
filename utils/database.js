const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// إنشاء مجلد قاعدة البيانات
const dbPath = path.join(__dirname, '..', 'database', 'discord_bot.db');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    // تهيئة قاعدة البيانات
    async initialize() {
        try {
            // إنشاء مجلد قاعدة البيانات إذا لم يكن موجوداً
            const fs = require('fs');
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(dbPath);

            // تهيئة الجداول
            await this.createTables();

            // إنشاء الفهارس للأداء
            await this.createIndexes();

            this.isInitialized = true;
            console.log('✅ تم تهيئة قاعدة البيانات بنجاح');
        } catch (error) {
            console.error('❌ خطأ في تهيئة قاعدة البيانات:', error);
            throw error;
        }
    }

    // إنشاء الجداول
    async createTables() {
        const tables = [
            // جدول الجلسات الصوتية
            `CREATE TABLE IF NOT EXISTS voice_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                channel_name TEXT NOT NULL,
                duration INTEGER NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            // جدول إجماليات المستخدمين
            `CREATE TABLE IF NOT EXISTS user_totals (
                user_id TEXT PRIMARY KEY,
                total_voice_time INTEGER DEFAULT 0,
                total_sessions INTEGER DEFAULT 0,
                total_messages INTEGER DEFAULT 0,
                total_reactions INTEGER DEFAULT 0,
                total_voice_joins INTEGER DEFAULT 0,
                first_seen INTEGER,
                last_activity INTEGER,
                active_days INTEGER DEFAULT 0,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            // جدول إجماليات القنوات
            `CREATE TABLE IF NOT EXISTS channel_totals (
                channel_id TEXT PRIMARY KEY,
                channel_name TEXT NOT NULL,
                total_time INTEGER DEFAULT 0,
                total_sessions INTEGER DEFAULT 0,
                unique_users INTEGER DEFAULT 0,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            // جدول النشاط اليومي
            `CREATE TABLE IF NOT EXISTS daily_activity (
                date TEXT NOT NULL,
                user_id TEXT NOT NULL,
                voice_time INTEGER DEFAULT 0,
                messages INTEGER DEFAULT 0,
                reactions INTEGER DEFAULT 0,
                voice_joins INTEGER DEFAULT 0,
                PRIMARY KEY (date, user_id)
            )`,

            // جدول المستخدمين الفريدين لكل قناة (بدلاً من Set)
            `CREATE TABLE IF NOT EXISTS channel_users (
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                first_joined INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (channel_id, user_id)
            )`
        ];

        for (const sql of tables) {
            await this.run(sql);
        }
    }

    // إنشاء الفهارس للأداء
    async createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_voice_sessions_user_id ON voice_sessions(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_voice_sessions_channel_id ON voice_sessions(channel_id)',
            'CREATE INDEX IF NOT EXISTS idx_voice_sessions_date ON voice_sessions(date)',
            'CREATE INDEX IF NOT EXISTS idx_voice_sessions_start_time ON voice_sessions(start_time)',
            'CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON daily_activity(date)',
            'CREATE INDEX IF NOT EXISTS idx_daily_activity_user_id ON daily_activity(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_channel_users_channel_id ON channel_users(channel_id)',
            'CREATE INDEX IF NOT EXISTS idx_user_totals_last_activity ON user_totals(last_activity)'
        ];

        for (const sql of indexes) {
            await this.run(sql);
        }
    }

    // تنفيذ استعلام
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('خطأ في تنفيذ الاستعلام:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // جلب سجل واحد
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('خطأ في جلب السجل:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // جلب عدة سجلات
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('خطأ في جلب السجلات:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // حفظ جلسة صوتية
    async saveVoiceSession(userId, channelId, channelName, duration, startTime, endTime) {
        try {
            const sessionId = `${userId}_${startTime}_${Math.random().toString(36).substr(2, 9)}`;
            const date = new Date(startTime).toDateString();

            // حفظ الجلسة
            await this.run(`
                INSERT INTO voice_sessions 
                (session_id, user_id, channel_id, channel_name, duration, start_time, end_time, date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [sessionId, userId, channelId, channelName, duration, startTime, endTime, date]);

            // تحديث إجماليات المستخدم
            await this.updateUserTotals(userId, { voiceTime: duration, sessions: 1 });

            // تحديث إجماليات القناة
            await this.updateChannelTotals(channelId, channelName, duration, userId);

            // تحديث النشاط اليومي
            await this.updateDailyActivity(date, userId, { voiceTime: duration });

            console.log(`💾 تم حفظ جلسة صوتية: ${Math.round(duration/1000)}s للمستخدم ${userId} في ${channelName}`);
            return sessionId;

        } catch (error) {
            console.error('❌ خطأ في حفظ الجلسة الصوتية:', error);
            return null;
        }
    }

    // تحديث إجماليات المستخدم
    async updateUserTotals(userId, updates) {
        try {
            const { messages = 0, voiceTime = 0, voiceJoins = 0, reactions = 0 } = updates;

            await this.db.run(`
                INSERT OR REPLACE INTO user_totals (
                    user_id, total_messages, total_voice_time, total_voice_joins, total_reactions, last_activity
                ) VALUES (
                    ?, 
                    COALESCE((SELECT total_messages FROM user_totals WHERE user_id = ?), 0) + ?,
                    COALESCE((SELECT total_voice_time FROM user_totals WHERE user_id = ?), 0) + ?,
                    COALESCE((SELECT total_voice_joins FROM user_totals WHERE user_id = ?), 0) + ?,
                    COALESCE((SELECT total_reactions FROM user_totals WHERE user_id = ?), 0) + ?,
                    datetime('now')
                )
            `, [userId, userId, messages, userId, voiceTime, userId, voiceJoins, userId, reactions]);

            console.log(`📊 تم تحديث إجماليات المستخدم ${userId}: +${messages} رسائل, +${voiceTime}ms صوت, +${voiceJoins} انضمامات, +${reactions} تفاعلات`);

            // عرض الإجماليات الحالية للتأكد
            const currentStats = await this.db.get(`
                SELECT total_messages, total_voice_time, total_voice_joins, total_reactions 
                FROM user_totals WHERE user_id = ?
            `, [userId]);

            if (currentStats && reactions > 0) {
                console.log(`✅ الإجماليات الحالية للمستخدم ${userId}: رسائل=${currentStats.total_messages}, تفاعلات=${currentStats.total_reactions}`);
            }
        } catch (error) {
            console.error('خطأ في تحديث إجماليات المستخدم:', error);
            throw error;
        }
    }

    // تحديث إجماليات القناة
    async updateChannelTotals(channelId, channelName, duration, userId) {
        try {
            // تحديث أو إنشاء إجماليات القناة
            await this.run(`
                INSERT INTO channel_totals (channel_id, channel_name, total_time, total_sessions, unique_users)
                VALUES (?, ?, ?, 1, 1)
                ON CONFLICT(channel_id) DO UPDATE SET
                    channel_name = excluded.channel_name,
                    total_time = total_time + excluded.total_time,
                    total_sessions = total_sessions + 1,
                    updated_at = strftime('%s', 'now')
            `, [channelId, channelName, duration]);

            // إضافة المستخدم إلى قائمة مستخدمي القناة
            await this.run(`
                INSERT OR IGNORE INTO channel_users (channel_id, user_id)
                VALUES (?, ?)
            `, [channelId, userId]);

            // تحديث عدد المستخدمين الفريدين
            const uniqueCount = await this.get(`
                SELECT COUNT(*) as count FROM channel_users WHERE channel_id = ?
            `, [channelId]);

            await this.run(`
                UPDATE channel_totals 
                SET unique_users = ?
                WHERE channel_id = ?
            `, [uniqueCount.count, channelId]);

        } catch (error) {
            console.error('❌ خطأ في تحديث إجماليات القناة:', error);
        }
    }

    // تحديث النشاط اليومي
    async updateDailyActivity(date, userId, updates) {
        try {
            await this.run(`
                INSERT INTO daily_activity (date, user_id, voice_time, messages, reactions, voice_joins)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(date, user_id) DO UPDATE SET
                    voice_time = voice_time + excluded.voice_time,
                    messages = messages + excluded.messages,
                    reactions = reactions + excluded.reactions,
                    voice_joins = voice_joins + excluded.voice_joins
            `, [
                date, 
                userId, 
                updates.voiceTime || 0,
                updates.messages || 0,
                updates.reactions || 0,
                updates.voiceJoins || 0
            ]);
        } catch (error) {
            console.error('❌ خطأ في تحديث النشاط اليومي:', error);
        }
    }

    // حساب أيام النشاط الفعلية من قاعدة البيانات
    async getActiveDaysCount(userId, daysBack = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysBack);
            const cutoffDateString = cutoffDate.toISOString().split('T')[0];

            const result = await this.get(`
                SELECT COUNT(DISTINCT date) as activeDays
                FROM daily_activity 
                WHERE user_id = ? 
                AND date >= ?
                AND (voice_time > 0 OR messages > 0 OR reactions > 0 OR voice_joins > 0)
            `, [userId, cutoffDateString]);

            return result ? result.activeDays : 0;
        } catch (error) {
            console.error('❌ خطأ في حساب أيام النشاط:', error);
            return 0;
        }
    }

    // حساب أيام النشاط الأسبوعية
    async getWeeklyActiveDays(userId) {
        try {
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            const weekStartString = oneWeekAgo.toISOString().split('T')[0];

            const result = await this.get(`
                SELECT COUNT(DISTINCT date) as weeklyActiveDays
                FROM daily_activity 
                WHERE user_id = ? 
                AND date >= ?
                AND (voice_time > 0 OR messages > 0 OR reactions > 0 OR voice_joins > 0)
            `, [userId, weekStartString]);

            return result ? result.weeklyActiveDays : 0;
        } catch (error) {
            console.error('❌ خطأ في حساب أيام النشاط الأسبوعية:', error);
            return 0;
        }
    }

    // جلب إحصائيات المستخدم
    async getUserStats(userId) {
        try {
            const user = await this.get('SELECT * FROM user_totals WHERE user_id = ?', [userId]);

            if (!user) {
                console.log(`📊 إنشاء سجل جديد للمستخدم ${userId}`);
                return {
                    totalVoiceTime: 0,
                    totalSessions: 0,
                    totalMessages: 0,
                    totalReactions: 0,
                    totalVoiceJoins: 0,
                    firstSeen: null,
                    lastActivity: null,
                    activeDays: 0,
                    weeklyActiveDays: 0
                };
            }

            // حساب أيام النشاط الفعلية
            const activeDays = await this.getActiveDaysCount(userId, 30);
            const weeklyActiveDays = await this.getWeeklyActiveDays(userId);

            console.log(`📊 بيانات المستخدم ${userId}:`, {
                voiceTime: user.total_voice_time,
                messages: user.total_messages,
                activeDays: activeDays,
                weeklyActiveDays: weeklyActiveDays
                reactions: user.total_reactions,
                voiceJoins: user.total_voice_joins
            });

            return {
                totalVoiceTime: user.total_voice_time || 0,
                totalSessions: user.total_sessions || 0,
                totalMessages: user.total_messages || 0,
                totalReactions: user.total_reactions || 0,
                totalVoiceJoins: user.total_voice_joins || 0,
                firstSeen: user.first_seen,
                lastActivity: user.last_activity
            };

        } catch (error) {
            console.error('❌ خطأ في جلب إحصائيات المستخدم:', error);
            return null;
        }
    }

    // جلب النشاط الأسبوعي
    async getWeeklyStats(userId) {
        try {
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);

            const sessions = await this.all(`
                SELECT * FROM voice_sessions 
                WHERE user_id = ? AND start_time >= ?
                ORDER BY start_time DESC
            `, [userId, weekStart.getTime()]);

            let weeklyTime = 0;
            const weeklyChannels = {};

            sessions.forEach(session => {
                weeklyTime += session.duration;

                if (!weeklyChannels[session.channel_id]) {
                    weeklyChannels[session.channel_id] = {
                        channelName: session.channel_name,
                        totalTime: 0,
                        sessionsCount: 0
                    };
                }

                weeklyChannels[session.channel_id].totalTime += session.duration;
                weeklyChannels[session.channel_id].sessionsCount += 1;
            });

            return {
                weeklyTime,
                weeklySessions: sessions.length,
                weeklyChannels
            };

        } catch (error) {
            console.error('❌ خطأ في جلب الإحصائيات الأسبوعية:', error);
            return { weeklyTime: 0, weeklySessions: 0, weeklyChannels: {} };
        }
    }

    // تنظيف البيانات القديمة
    async cleanupOldData(daysToKeep = 60) {
        try {
            const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

            const result = await this.run(`
                DELETE FROM voice_sessions WHERE start_time < ?
            `, [cutoffTime]);

            console.log(`🧹 تم حذف ${result.changes} جلسة قديمة`);
            return result.changes;

        } catch (error) {
            console.error('❌ خطأ في تنظيف البيانات القديمة:', error);
            return 0;
        }
    }

    // إغلاق الاتصال
    close() {
        if (this.db) {
            this.db.close();
            console.log('✅ تم إغلاق اتصال قاعدة البيانات');
        }
    }
}

// إنشاء مثيل واحد فقط
const dbManager = new DatabaseManager();

module.exports = dbManager;