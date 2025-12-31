const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment-timezone');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'discord_bot.db');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.cache = new Map();
        this.updateTimeouts = new Map();
    }

    async initialize() {
        try {
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(dbPath);

            // Performance optimizations
            const pragmas = [
                'PRAGMA journal_mode=WAL',
                'PRAGMA synchronous=NORMAL',
                'PRAGMA cache_size=-64000',
                'PRAGMA temp_store=MEMORY',
                'PRAGMA busy_timeout=5000'
            ];
            for (const pragma of pragmas) await this.run(pragma);

            await this.createTables();
            this.isInitialized = true;
            console.log('✅ SQLite Database Initialized');
        } catch (error) {
            console.error('❌ Database Init Error:', error);
            throw error;
        }
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS responsibilities (
                name TEXT PRIMARY KEY,
                description TEXT,
                responsibles TEXT,
                "order" INTEGER,
                roles TEXT,
                ment_prefix TEXT,
                ment_shortcut TEXT,
                ment_admin_only INTEGER
            )`,
            `CREATE TABLE IF NOT EXISTS points (
                resp_name TEXT,
                user_id TEXT,
                points INTEGER DEFAULT 0,
                PRIMARY KEY (resp_name, user_id)
            )`,
            `CREATE TABLE IF NOT EXISTS user_stats (
                user_id TEXT PRIMARY KEY,
                total_voice_time INTEGER DEFAULT 0,
                total_messages INTEGER DEFAULT 0,
                total_reactions INTEGER DEFAULT 0,
                voice_level INTEGER DEFAULT 0,
                chat_level INTEGER DEFAULT 0
            )`
        ];
        for (const sql of tables) await this.run(sql);
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Responsibility methods with Caching
    async getResponsibilities() {
        if (this.cache.has('responsibilities')) return this.cache.get('responsibilities');
        const rows = await this.all('SELECT * FROM responsibilities ORDER BY "order" ASC');
        const data = {};
        for (const row of rows) {
            data[row.name] = {
                description: row.description,
                responsibles: JSON.parse(row.responsibles || '[]'),
                order: row.order,
                roles: JSON.parse(row.roles || '[]'),
                mentPrefix: row.ment_prefix,
                mentShortcut: row.ment_shortcut,
                mentAdminOnly: row.ment_admin_only === 1
            };
        }
        this.cache.set('responsibilities', data);
        return data;
    }

    async updateResponsibility(name, data) {
        await this.run(`
            INSERT INTO responsibilities (name, description, responsibles, "order", roles, ment_prefix, ment_shortcut, ment_admin_only)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                description=excluded.description,
                responsibles=excluded.responsibles,
                "order"=excluded."order",
                roles=excluded.roles,
                ment_prefix=excluded.ment_prefix,
                ment_shortcut=excluded.ment_shortcut,
                ment_admin_only=excluded.ment_admin_only
        `, [
            name, data.description, JSON.stringify(data.responsibles || []),
            data.order, JSON.stringify(data.roles || []),
            data.mentPrefix, data.mentShortcut, data.mentAdminOnly ? 1 : 0
        ]);
        this.cache.delete('responsibilities');
    }

    async addPoint(respName, userId) {
        await this.run(`
            INSERT INTO points (resp_name, user_id, points)
            VALUES (?, ?, 1)
            ON CONFLICT(resp_name, user_id) DO UPDATE SET points = points + 1
        `, [respName, userId]);
    }
}

const dbManager = new DatabaseManager();
module.exports = { dbManager };
