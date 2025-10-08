const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment-timezone');

// ضبط بداية الأسبوع على السبت (حسب التقويم العربي)
moment.updateLocale('en', {
    week: {
        dow: 6, // السبت هو بداية الأسبوع (0=الأحد, 6=السبت)
        doy: 12 // أول أسبوع في السنة
    }
});

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
            )`,

            // جدول رسائل القنوات لتتبع أكثر قناة يكتب فيها المستخدم
            `CREATE TABLE IF NOT EXISTS message_channels (
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                channel_name TEXT NOT NULL,
                message_count INTEGER DEFAULT 0,
                last_message INTEGER,
                PRIMARY KEY (user_id, channel_id)
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
            'CREATE INDEX IF NOT EXISTS idx_user_totals_last_activity ON user_totals(last_activity)',
            'CREATE INDEX IF NOT EXISTS idx_message_channels_user_id ON message_channels(user_id)'
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
            const date = moment(startTime).tz('Asia/Riyadh').format('YYYY-MM-DD');

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

            // التأكد من وجود السجل أولاً
            await this.run(`
                INSERT OR IGNORE INTO user_totals (user_id, total_messages, total_voice_time, total_voice_joins, total_reactions)
                VALUES (?, 0, 0, 0, 0)
            `, [userId]);

            // تحديث القيم
            if (messages > 0) {
                await this.run(`UPDATE user_totals SET total_messages = total_messages + ?, last_activity = ? WHERE user_id = ?`, [messages, new Date().toISOString(), userId]);
            }
            if (voiceTime > 0) {
                await this.run(`UPDATE user_totals SET total_voice_time = total_voice_time + ?, last_activity = ? WHERE user_id = ?`, [voiceTime, new Date().toISOString(), userId]);
            }
            if (voiceJoins > 0) {
                await this.run(`UPDATE user_totals SET total_voice_joins = total_voice_joins + ?, last_activity = ? WHERE user_id = ?`, [voiceJoins, new Date().toISOString(), userId]);
            }
            if (reactions > 0) {
                // فحص حالة السجل قبل التحديث
                const beforeUpdate = await this.get(`SELECT total_reactions FROM user_totals WHERE user_id = ?`, [userId]);
                console.log(`📊 عدد التفاعلات قبل التحديث للمستخدم ${userId}: ${beforeUpdate ? beforeUpdate.total_reactions : 'سجل غير موجود'}`);

                // تحديث التفاعلات مع التحقق من النجاح
                const updateResult = await this.run(`UPDATE user_totals SET total_reactions = total_reactions + ?, last_activity = ? WHERE user_id = ?`, [reactions, new Date().toISOString(), userId]);

                console.log(`🔄 نتيجة تحديث التفاعلات للمستخدم ${userId}: تغييرات=${updateResult.changes}, معرف_آخر=${updateResult.id}`);

                if (updateResult.changes === 0) {
                    console.error(`⚠️ لم يتم تحديث أي سجل للمستخدم ${userId} - قد يكون السجل غير موجود`);

                    // محاولة إنشاء السجل إذا لم يكن موجوداً
                    try {
                        await this.run(`
                            INSERT INTO user_totals (user_id, total_reactions, total_messages, total_voice_time, total_voice_joins, first_seen, last_activity)
                            VALUES (?, ?, 0, 0, 0, strftime('%s', 'now'), ?)
                        `, [userId, reactions, new Date().toISOString()]);
                        console.log(`✅ تم إنشاء سجل جديد للمستخدم ${userId} مع ${reactions} تفاعل`);
                    } catch (insertError) {
                        console.error(`❌ فشل في إنشاء سجل جديد للمستخدم ${userId}:`, insertError);
                    }
                } else {
                    // التحقق من التحديث بجلب البيانات الحالية
                    const currentStats = await this.get(`
                        SELECT total_messages, total_voice_time, total_voice_joins, total_reactions 
                        FROM user_totals WHERE user_id = ?
                    `, [userId]);

                    if (currentStats) {
                        console.log(`✅ تم تحديث التفاعلات للمستخدم ${userId}: الإجمالي الآن=${currentStats.total_reactions}, تغييرات=${updateResult.changes}`);
                    } else {
                        console.error(`❌ فشل في جلب البيانات المحدثة للمستخدم ${userId}`);
                    }
                }
            }

            if (messages > 0 || voiceTime > 0 || voiceJoins > 0 || reactions > 0) {
                console.log(`📊 تم تحديث إجماليات المستخدم ${userId}: +${messages} رسائل, +${Math.round(voiceTime/1000)}s صوت, +${voiceJoins} انضمامات, +${reactions} تفاعلات`);
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
    async updateDailyActivity(date, userId, activity) {
        try {
            const { messages = 0, voiceTime = 0, voiceJoins = 0, reactions = 0 } = activity;

            // التأكد من وجود السجل أولاً
            await this.run(`
                INSERT OR IGNORE INTO daily_activity (date, user_id, messages, voice_time, voice_joins, reactions)
                VALUES (?, ?, 0, 0, 0, 0)
            `, [date, userId]);

            // تحديث القيم
            if (messages > 0) {
                await this.run(`UPDATE daily_activity SET messages = messages + ? WHERE date = ? AND user_id = ?`, [messages, date, userId]);
            }
            if (voiceTime > 0) {
                await this.run(`UPDATE daily_activity SET voice_time = voice_time + ? WHERE date = ? AND user_id = ?`, [voiceTime, date, userId]);
            }
            if (voiceJoins > 0) {
                await this.run(`UPDATE daily_activity SET voice_joins = voice_joins + ? WHERE date = ? AND user_id = ?`, [voiceJoins, date, userId]);
            }
            if (reactions > 0) {
                await this.run(`UPDATE daily_activity SET reactions = reactions + ? WHERE date = ? AND user_id = ?`, [reactions, date, userId]);
                console.log(`📅 تم تحديث ${reactions} تفاعل يومي للمستخدم ${userId} - التاريخ: ${date}`);
            }
        } catch (error) {
            console.error('خطأ في تحديث النشاط اليومي:', error);
            throw error;
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
            // حساب بداية الأسبوع (السبت) بتوقيت الرياض
            const now = moment().tz('Asia/Riyadh');
            const weekStart = now.clone().startOf('week');
            const weekStartString = weekStart.format('YYYY-MM-DD');

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
                weeklyActiveDays: weeklyActiveDays,
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

    // جلب النشاط الأسبوعي مع الرسائل والتفاعلات
    async getWeeklyStats(userId) {
        try {
            // حساب بداية الأسبوع (السبت) بتوقيت الرياض
            const now = moment().tz('Asia/Riyadh');
            const weekStart = now.clone().startOf('week'); // السبت في moment هو بداية الأسبوع
            const weekStartString = weekStart.format('YYYY-MM-DD');

            // جلب جلسات الفويس الأسبوعية
            const sessions = await this.all(`
                SELECT * FROM voice_sessions 
                WHERE user_id = ? AND start_time >= ?
                ORDER BY start_time DESC
            `, [userId, weekStart.valueOf()]);

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

            // جلب النشاط اليومي الأسبوعي (رسائل وتفاعلات)
            const dailyActivity = await this.all(`
                SELECT SUM(messages) as weeklyMessages, 
                       SUM(reactions) as weeklyReactions,
                       SUM(voice_joins) as weeklyVoiceJoins
                FROM daily_activity 
                WHERE user_id = ? AND date >= ?
            `, [userId, weekStartString]);

            const weeklyMessages = dailyActivity[0]?.weeklyMessages || 0;
            const weeklyReactions = dailyActivity[0]?.weeklyReactions || 0;
            const weeklyVoiceJoins = dailyActivity[0]?.weeklyVoiceJoins || 0;

            return {
                weeklyTime,
                weeklySessions: sessions.length,
                weeklyChannels,
                weeklyMessages,
                weeklyReactions,
                weeklyVoiceJoins
            };

        } catch (error) {
            console.error('❌ خطأ في جلب الإحصائيات الأسبوعية:', error);
            return { 
                weeklyTime: 0, 
                weeklySessions: 0, 
                weeklyChannels: {},
                weeklyMessages: 0,
                weeklyReactions: 0,
                weeklyVoiceJoins: 0
            };
        }
    }

    // جلب الرسائل الأسبوعية فقط
    async getWeeklyMessages(userId) {
        try {
            // حساب بداية الأسبوع (السبت) بتوقيت الرياض
            const now = moment().tz('Asia/Riyadh');
            const weekStart = now.clone().startOf('week');
            const weekStartString = weekStart.format('YYYY-MM-DD');

            const result = await this.get(`
                SELECT SUM(messages) as weeklyMessages
                FROM daily_activity 
                WHERE user_id = ? AND date >= ?
            `, [userId, weekStartString]);

            return result?.weeklyMessages || 0;
        } catch (error) {
            console.error('❌ خطأ في جلب الرسائل الأسبوعية:', error);
            return 0;
        }
    }

    // جلب التفاعلات الأسبوعية فقط
    async getWeeklyReactions(userId) {
        try {
            // حساب بداية الأسبوع (السبت) بتوقيت الرياض
            const now = moment().tz('Asia/Riyadh');
            const weekStart = now.clone().startOf('week');
            const weekStartString = weekStart.format('YYYY-MM-DD');

            const result = await this.get(`
                SELECT SUM(reactions) as weeklyReactions
                FROM daily_activity 
                WHERE user_id = ? AND date >= ?
            `, [userId, weekStartString]);

            return result?.weeklyReactions || 0;
        } catch (error) {
            console.error('❌ خطأ في جلب التفاعلات الأسبوعية:', error);
            return 0;
        }
    }

    // تحديث رسائل القناة
    async updateMessageChannel(userId, channelId, channelName) {
        try {
            await this.run(`
                INSERT INTO message_channels (user_id, channel_id, channel_name, message_count, last_message)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(user_id, channel_id) DO UPDATE SET
                    channel_name = excluded.channel_name,
                    message_count = message_count + 1,
                    last_message = excluded.last_message
            `, [userId, channelId, channelName, Date.now()]);
        } catch (error) {
            console.error('❌ خطأ في تحديث رسائل القناة:', error);
        }
    }

    // الحصول على أكثر قناة صوتية للمستخدم
    async getMostActiveVoiceChannel(userId, period = 'total') {
        try {
            let dateFilter = '';
            let params = [userId];

            if (period === 'daily') {
                const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
                dateFilter = 'AND date = ?';
                params.push(today);
            } else if (period === 'weekly') {
                // بداية الأسبوع (السبت) بتوقيت الرياض
                const now = moment().tz('Asia/Riyadh');
                const weekStart = now.clone().startOf('week').format('YYYY-MM-DD');
                dateFilter = 'AND date >= ?';
                params.push(weekStart);
            } else if (period === 'monthly') {
                // بداية الشهر الحالي بتوقيت الرياض
                const now = moment().tz('Asia/Riyadh');
                const monthStart = now.clone().startOf('month').format('YYYY-MM-DD');
                dateFilter = 'AND date >= ?';
                params.push(monthStart);
            }

            const result = await this.get(`
                SELECT channel_id, channel_name, SUM(duration) as total_time, COUNT(*) as session_count
                FROM voice_sessions
                WHERE user_id = ? ${dateFilter}
                GROUP BY channel_id
                ORDER BY total_time DESC
                LIMIT 1
            `, params);

            return result || { channel_id: null, channel_name: 'لا يوجد', total_time: 0, session_count: 0 };
        } catch (error) {
            console.error('❌ خطأ في جلب أكثر قناة صوتية:', error);
            return { channel_name: 'لا يوجد', total_time: 0, session_count: 0 };
        }
    }

    // الحصول على أكثر قناة رسائل للمستخدم
    async getMostActiveMessageChannel(userId) {
        try {
            const result = await this.get(`
                SELECT channel_id, channel_name, message_count
                FROM message_channels
                WHERE user_id = ?
                ORDER BY message_count DESC
                LIMIT 1
            `, [userId]);

            return result || { channel_id: null, channel_name: 'لا يوجد', message_count: 0 };
        } catch (error) {
            console.error('❌ خطأ في جلب أكثر قناة رسائل:', error);
            return { channel_id: null, channel_name: 'لا يوجد', message_count: 0 };
        }
    }

    // جلب الإحصائيات اليومية
    async getDailyStats(userId) {
        try {
            const today = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');

            const dailyActivity = await this.get(`
                SELECT voice_time, messages, reactions, voice_joins
                FROM daily_activity
                WHERE user_id = ? AND date = ?
            `, [userId, today]);

            const activeDays = await this.get(`
                SELECT COUNT(DISTINCT date) as count
                FROM daily_activity
                WHERE user_id = ? AND date = ?
                AND (voice_time > 0 OR messages > 0 OR reactions > 0 OR voice_joins > 0)
            `, [userId, today]);

            return {
                voiceTime: dailyActivity?.voice_time || 0,
                messages: dailyActivity?.messages || 0,
                reactions: dailyActivity?.reactions || 0,
                voiceJoins: dailyActivity?.voice_joins || 0,
                activeDays: activeDays?.count || 0
            };
        } catch (error) {
            console.error('❌ خطأ في جلب الإحصائيات اليومية:', error);
            return { voiceTime: 0, messages: 0, reactions: 0, voiceJoins: 0, activeDays: 0 };
        }
    }

    // جلب الإحصائيات الشهرية
    async getMonthlyStats(userId) {
        try {
            // حساب بداية الشهر الحالي بتوقيت الرياض
            const now = moment().tz('Asia/Riyadh');
            const monthStart = now.clone().startOf('month').format('YYYY-MM-DD');

            const monthlyActivity = await this.all(`
                SELECT SUM(voice_time) as voiceTime,
                       SUM(messages) as messages,
                       SUM(reactions) as reactions,
                       SUM(voice_joins) as voiceJoins
                FROM daily_activity
                WHERE user_id = ? AND date >= ?
            `, [userId, monthStart]);

            const activeDays = await this.get(`
                SELECT COUNT(DISTINCT date) as count
                FROM daily_activity
                WHERE user_id = ? AND date >= ?
                AND (voice_time > 0 OR messages > 0 OR reactions > 0 OR voice_joins > 0)
            `, [userId, monthStart]);

            return {
                voiceTime: monthlyActivity[0]?.voiceTime || 0,
                messages: monthlyActivity[0]?.messages || 0,
                reactions: monthlyActivity[0]?.reactions || 0,
                voiceJoins: monthlyActivity[0]?.voiceJoins || 0,
                activeDays: activeDays?.count || 0
            };
        } catch (error) {
            console.error('❌ خطأ في جلب الإحصائيات الشهرية:', error);
            return { voiceTime: 0, messages: 0, reactions: 0, voiceJoins: 0, activeDays: 0 };
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

    // تصفير جميع إحصائيات التفاعل (إجمالي وأسبوعي)
    async resetAllStats() {
        try {
            console.log('🔄 بدء تصفير جميع الإحصائيات...');
            
            // حذف جميع الجلسات الصوتية
            const sessionsResult = await this.run(`DELETE FROM voice_sessions`);
            
            // حذف جميع النشاطات اليومية
            const dailyResult = await this.run(`DELETE FROM daily_activity`);
            
            // إعادة تعيين إجماليات المستخدمين
            const totalsResult = await this.run(`
                UPDATE user_totals SET 
                    total_voice_time = 0,
                    total_sessions = 0,
                    total_messages = 0,
                    total_reactions = 0,
                    total_voice_joins = 0,
                    active_days = 0
            `);
            
            // إعادة تعيين إجماليات القنوات
            const channelResult = await this.run(`
                UPDATE channel_totals SET 
                    total_time = 0,
                    total_sessions = 0,
                    unique_users = 0
            `);
            
            // حذف مستخدمي القنوات
            const channelUsersResult = await this.run(`DELETE FROM channel_users`);

            const totalDeleted = (sessionsResult.changes || 0) + 
                                (dailyResult.changes || 0) + 
                                (channelUsersResult.changes || 0);
            const totalUpdated = (totalsResult.changes || 0) + 
                                (channelResult.changes || 0);

            console.log(`✅ تم تصفير الإحصائيات: حذف ${totalDeleted} سجل، تحديث ${totalUpdated} سجل`);
            
            return {
                success: true,
                deletedRecords: totalDeleted,
                updatedRecords: totalUpdated,
                details: {
                    voiceSessions: sessionsResult.changes || 0,
                    dailyActivity: dailyResult.changes || 0,
                    userTotals: totalsResult.changes || 0,
                    channelTotals: channelResult.changes || 0,
                    channelUsers: channelUsersResult.changes || 0
                }
            };

        } catch (error) {
            console.error('❌ خطأ في تصفير الإحصائيات:', error);
            return {
                success: false,
                error: error.message,
                deletedRecords: 0,
                updatedRecords: 0
            };
        }
    }

    // تصفير وقت الفويس لمستخدم معين
    async resetUserVoiceTime(userId) {
        try {
            await this.run(`
                UPDATE user_totals 
                SET total_voice_time = 0, total_sessions = 0, total_voice_joins = 0
                WHERE user_id = ?
            `, [userId]);

            await this.run(`UPDATE daily_activity SET voice_time = 0, voice_joins = 0 WHERE user_id = ?`, [userId]);
            await this.run(`DELETE FROM voice_sessions WHERE user_id = ?`, [userId]);
            
            console.log(`✅ تم تصفير وقت الفويس للمستخدم ${userId}`);
            return { success: true };
        } catch (error) {
            console.error('Error resetting user voice time:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير الرسائل لمستخدم معين
    async resetUserMessages(userId) {
        try {
            await this.run(`
                UPDATE user_totals 
                SET total_messages = 0
                WHERE user_id = ?
            `, [userId]);

            await this.run(`UPDATE daily_activity SET messages = 0 WHERE user_id = ?`, [userId]);
            await this.run(`DELETE FROM message_channels WHERE user_id = ?`, [userId]);
            
            console.log(`✅ تم تصفير الرسائل للمستخدم ${userId}`);
            return { success: true };
        } catch (error) {
            console.error('Error resetting user messages:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير التفاعلات لمستخدم معين
    async resetUserReactions(userId) {
        try {
            await this.run(`
                UPDATE user_totals 
                SET total_reactions = 0
                WHERE user_id = ?
            `, [userId]);

            await this.run(`UPDATE daily_activity SET reactions = 0 WHERE user_id = ?`, [userId]);
            
            console.log(`✅ تم تصفير التفاعلات للمستخدم ${userId}`);
            return { success: true };
        } catch (error) {
            console.error('Error resetting user reactions:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير جميع إحصائيات مستخدم معين
    async resetUserAllStats(userId) {
        try {
            await this.run(`DELETE FROM voice_sessions WHERE user_id = ?`, [userId]);
            await this.run(`DELETE FROM message_channels WHERE user_id = ?`, [userId]);
            await this.run(`DELETE FROM channel_users WHERE user_id = ?`, [userId]);
            await this.run(`DELETE FROM daily_activity WHERE user_id = ?`, [userId]);
            await this.run(`
                UPDATE user_totals 
                SET total_voice_time = 0, total_sessions = 0, total_messages = 0, 
                    total_reactions = 0, total_voice_joins = 0, active_days = 0
                WHERE user_id = ?
            `, [userId]);
            
            return { success: true };
        } catch (error) {
            console.error('Error resetting all user stats:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير وقت الفويس لجميع المستخدمين
    async resetAllVoiceTime() {
        try {
            await this.run(`UPDATE user_totals SET total_voice_time = 0, total_sessions = 0, total_voice_joins = 0`);
            await this.run(`UPDATE daily_activity SET voice_time = 0, voice_joins = 0`);
            await this.run(`DELETE FROM voice_sessions`);
            
            console.log('✅ تم تصفير وقت الفويس لجميع الأعضاء');
            return { success: true };
        } catch (error) {
            console.error('Error resetting all voice time:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير الرسائل لجميع المستخدمين
    async resetAllMessages() {
        try {
            await this.run(`UPDATE user_totals SET total_messages = 0`);
            await this.run(`UPDATE daily_activity SET messages = 0`);
            await this.run(`DELETE FROM message_channels`);
            
            console.log('✅ تم تصفير الرسائل لجميع الأعضاء');
            return { success: true };
        } catch (error) {
            console.error('Error resetting all messages:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير التفاعلات لجميع المستخدمين
    async resetAllReactions() {
        try {
            await this.run(`UPDATE user_totals SET total_reactions = 0`);
            await this.run(`UPDATE daily_activity SET reactions = 0`);
            
            console.log('✅ تم تصفير التفاعلات لجميع الأعضاء');
            return { success: true };
        } catch (error) {
            console.error('Error resetting all reactions:', error);
            return { success: false, error: error.message };
        }
    }

    // تصفير النشاط اليومي لجميع المستخدمين
    async resetAllActivity() {
        try {
            await this.run(`DELETE FROM daily_activity`);
            await this.run(`UPDATE user_totals SET active_days = 0`);
            
            console.log('✅ تم تصفير النشاط اليومي لجميع الأعضاء');
            return { success: true };
        } catch (error) {
            console.error('Error resetting all activity:', error);
            return { success: false, error: error.message };
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

// الوظائف التي سيتم تصديرها
async function initializeDatabase() {
    try {
        if (!dbManager.isInitialized) {
            await dbManager.initialize();
            console.log('✅ تم تهيئة قاعدة البيانات بنجاح');
        } else {
            console.log('✅ قاعدة البيانات مهيأة مسبقاً');
        }
        return dbManager;
    } catch (error) {
        console.error('❌ فشل في تهيئة قاعدة البيانات:', error);
        throw error;
    }
}

function getDatabase() {
    if (!dbManager.isInitialized) {
        console.log('⚠️ قاعدة البيانات غير مهيأة، محاولة التهيئة الآن...');
        // تهيئة متزامنة للحالات الطارئة
        try {
            const sqlite3 = require('sqlite3').verbose();
            const path = require('path');
            const dbPath = path.join(__dirname, '..', 'database', 'discord_bot.db');

            if (!dbManager.db) {
                dbManager.db = new sqlite3.Database(dbPath);
                dbManager.isInitialized = true;
                console.log('✅ تم تهيئة قاعدة البيانات بشكل طارئ');
            }
        } catch (error) {
            console.error('❌ فشل في التهيئة الطارئة:', error);
            throw new Error('Database not initialized and emergency initialization failed.');
        }
    }
    return dbManager;
}

// وظائف وهمية لتوضيح الهيكل، سيتم استبدالها بالوظائف الحقيقية
async function trackUserActivity(userId, activityType, amount) {
    console.log(`Tracking activity: User ${userId}, Type ${activityType}, Amount ${amount}`);
    // سيتم إضافة منطق التتبع الفعلي هنا
    // مثال:
    // const db = getDatabase();
    // await db.updateUserTotals(userId, { [activityType]: amount });
    return true;
}

async function getRealUserStats(userId) {
    console.log(`Fetching stats for user ${userId}`);
    // سيتم إضافة منطق جلب الإحصائيات الفعلي هنا
    // مثال:
    // const db = getDatabase();
    // return await db.getUserStats(userId);
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

module.exports = {
    getDatabase: getDatabase,
    initializeDatabase: initializeDatabase,
    trackUserActivity: trackUserActivity,
    getRealUserStats: getRealUserStats,
    saveVoiceSession: async (userId, channelId, channelName, duration, startTime, endTime) => {
        const db = getDatabase();
        return await db.saveVoiceSession(userId, channelId, channelName, duration, startTime, endTime);
    },
    resetAllStats: async () => {
        const db = getDatabase();
        return await db.resetAllStats();
    }
};