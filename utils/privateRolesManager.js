const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment-timezone');
const { getDatabase } = require('./database.js');

class PrivateRolesManager {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            const dbManager = getDatabase();
            if (!dbManager || !dbManager.db) {
                throw new Error('قاعدة البيانات الرئيسية غير متاحة');
            }
            this.db = dbManager.db;
            await this.createTables();
            await this.createIndexes();
            this.isInitialized = true;
            console.log('✅ تم تهيئة نظام الرولات الخاصة بنجاح');
        } catch (error) {
            console.error('❌ خطأ في تهيئة نظام الرولات الخاصة:', error);
            throw error;
        }
    }

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

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS private_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_id TEXT UNIQUE NOT NULL,
                role_name TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                deputy_id TEXT,
                member_limit INTEGER DEFAULT 5,
                icon_url TEXT,
                color TEXT,
                total_points INTEGER DEFAULT 0,
                is_deleted INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                added_by TEXT NOT NULL,
                joined_at INTEGER DEFAULT (strftime('%s', 'now')),
                UNIQUE(role_id, user_id)
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_managers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT UNIQUE NOT NULL,
                added_by TEXT NOT NULL,
                added_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                permission_name TEXT UNIQUE NOT NULL,
                permission_value TEXT NOT NULL,
                is_enabled INTEGER DEFAULT 1
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                requester_id TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                deputy_id TEXT,
                role_name TEXT NOT NULL,
                member_limit INTEGER DEFAULT 5,
                status TEXT DEFAULT 'pending',
                reviewed_by TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                reviewed_at INTEGER
            )`,

            `CREATE TABLE IF NOT EXISTS private_role_points_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_id TEXT NOT NULL,
                points INTEGER NOT NULL,
                recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`
        ];

        for (const sql of tables) {
            await this.run(sql);
        }
    }

    async createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_private_roles_owner ON private_roles(owner_id)',
            'CREATE INDEX IF NOT EXISTS idx_private_roles_deputy ON private_roles(deputy_id)',
            'CREATE INDEX IF NOT EXISTS idx_private_role_members_role ON private_role_members(role_id)',
            'CREATE INDEX IF NOT EXISTS idx_private_role_members_user ON private_role_members(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_private_role_requests_status ON private_role_requests(status)',
            'CREATE INDEX IF NOT EXISTS idx_private_role_points_history_role ON private_role_points_history(role_id)'
        ];

        for (const sql of indexes) {
            await this.run(sql);
        }
    }

    async createRole(roleId, roleName, ownerId, deputyId = null, memberLimit = 5) {
        try {
            await this.run(`
                INSERT INTO private_roles (role_id, role_name, owner_id, deputy_id, member_limit)
                VALUES (?, ?, ?, ?, ?)
            `, [roleId, roleName, ownerId, deputyId, memberLimit]);

            await this.addMember(roleId, ownerId, ownerId);
            if (deputyId) {
                await this.addMember(roleId, deputyId, ownerId);
            }

            return { success: true, roleId };
        } catch (error) {
            console.error('❌ خطأ في إنشاء الرول الخاص:', error);
            return { success: false, error: error.message };
        }
    }

    async getRole(roleId) {
        return await this.get('SELECT * FROM private_roles WHERE role_id = ? AND is_deleted = 0', [roleId]);
    }

    async getRoleByOwner(ownerId) {
        return await this.get('SELECT * FROM private_roles WHERE owner_id = ? AND is_deleted = 0', [ownerId]);
    }

    async getAllRoles() {
        return await this.all('SELECT * FROM private_roles WHERE is_deleted = 0 ORDER BY created_at DESC');
    }

    async getDeletedRoles() {
        return await this.all('SELECT * FROM private_roles WHERE is_deleted = 1 ORDER BY updated_at DESC');
    }

    async updateRole(roleId, updates) {
        try {
            const fields = [];
            const values = [];

            if (updates.roleName !== undefined) {
                fields.push('role_name = ?');
                values.push(updates.roleName);
            }
            if (updates.deputyId !== undefined) {
                fields.push('deputy_id = ?');
                values.push(updates.deputyId);
            }
            if (updates.memberLimit !== undefined) {
                fields.push('member_limit = ?');
                values.push(updates.memberLimit);
            }
            if (updates.iconUrl !== undefined) {
                fields.push('icon_url = ?');
                values.push(updates.iconUrl);
            }
            if (updates.color !== undefined) {
                fields.push('color = ?');
                values.push(updates.color);
            }
            if (updates.totalPoints !== undefined) {
                fields.push('total_points = ?');
                values.push(updates.totalPoints);
            }

            if (fields.length === 0) return { success: true };

            fields.push("updated_at = strftime('%s', 'now')");
            values.push(roleId);

            await this.run(`
                UPDATE private_roles 
                SET ${fields.join(', ')}
                WHERE role_id = ?
            `, values);

            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تحديث الرول:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteRole(roleId, permanent = false) {
        try {
            if (permanent) {
                await this.run('DELETE FROM private_role_members WHERE role_id = ?', [roleId]);
                await this.run('DELETE FROM private_roles WHERE role_id = ?', [roleId]);
            } else {
                await this.run("UPDATE private_roles SET is_deleted = 1, updated_at = strftime('%s', 'now') WHERE role_id = ?", [roleId]);
            }
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في حذف الرول:', error);
            return { success: false, error: error.message };
        }
    }

    async restoreRole(roleId) {
        try {
            await this.run("UPDATE private_roles SET is_deleted = 0, updated_at = strftime('%s', 'now') WHERE role_id = ?", [roleId]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في استعادة الرول:', error);
            return { success: false, error: error.message };
        }
    }

    async addMember(roleId, userId, addedBy) {
        try {
            const role = await this.getRole(roleId);
            if (!role) return { success: false, error: 'الرول غير موجود' };

            const memberCount = await this.getMemberCount(roleId);
            if (memberCount >= role.member_limit) {
                return { success: false, error: 'تم الوصول للحد الأقصى من الأعضاء' };
            }

            await this.run(`
                INSERT OR REPLACE INTO private_role_members (role_id, user_id, added_by, joined_at)
                VALUES (?, ?, ?, strftime('%s', 'now'))
            `, [roleId, userId, addedBy]);

            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في إضافة العضو:', error);
            return { success: false, error: error.message };
        }
    }

    async removeMember(roleId, userId) {
        try {
            const role = await this.getRole(roleId);
            if (!role) return { success: false, error: 'الرول غير موجود' };

            if (userId === role.owner_id) {
                return { success: false, error: 'لا يمكن إزالة المالك من الرول' };
            }

            await this.run('DELETE FROM private_role_members WHERE role_id = ? AND user_id = ?', [roleId, userId]);

            if (userId === role.deputy_id) {
                await this.run('UPDATE private_roles SET deputy_id = NULL WHERE role_id = ?', [roleId]);
            }

            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في إزالة العضو:', error);
            return { success: false, error: error.message };
        }
    }

    async getMembers(roleId) {
        return await this.all(`
            SELECT prm.*, pr.owner_id, pr.deputy_id
            FROM private_role_members prm
            JOIN private_roles pr ON prm.role_id = pr.role_id
            WHERE prm.role_id = ? AND pr.is_deleted = 0
            ORDER BY prm.joined_at ASC
        `, [roleId]);
    }

    async getMemberCount(roleId) {
        const result = await this.get('SELECT COUNT(*) as count FROM private_role_members WHERE role_id = ?', [roleId]);
        return result ? result.count : 0;
    }

    async isMember(roleId, userId) {
        const result = await this.get('SELECT * FROM private_role_members WHERE role_id = ? AND user_id = ?', [roleId, userId]);
        return !!result;
    }

    async isOwnerOrDeputy(roleId, userId) {
        const role = await this.getRole(roleId);
        if (!role) return false;
        return role.owner_id === userId || role.deputy_id === userId;
    }

    async addManager(userId, addedBy) {
        try {
            await this.run(`
                INSERT OR REPLACE INTO private_role_managers (user_id, added_by, added_at)
                VALUES (?, ?, strftime('%s', 'now'))
            `, [userId, addedBy]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في إضافة المسؤول:', error);
            return { success: false, error: error.message };
        }
    }

    async removeManager(userId) {
        try {
            await this.run('DELETE FROM private_role_managers WHERE user_id = ?', [userId]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في إزالة المسؤول:', error);
            return { success: false, error: error.message };
        }
    }

    async getManagers() {
        return await this.all('SELECT * FROM private_role_managers ORDER BY added_at DESC');
    }

    async isManager(userId) {
        const result = await this.get('SELECT * FROM private_role_managers WHERE user_id = ?', [userId]);
        return !!result;
    }

    async setSetting(key, value) {
        try {
            await this.run(`
                INSERT OR REPLACE INTO private_role_settings (setting_key, setting_value, updated_at)
                VALUES (?, ?, strftime('%s', 'now'))
            `, [key, value]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في حفظ الإعداد:', error);
            return { success: false, error: error.message };
        }
    }

    async getSetting(key) {
        const result = await this.get('SELECT setting_value FROM private_role_settings WHERE setting_key = ?', [key]);
        return result ? result.setting_value : null;
    }

    async getAllSettings() {
        return await this.all('SELECT * FROM private_role_settings');
    }

    async setPermission(permissionName, permissionValue, isEnabled = true) {
        try {
            await this.run(`
                INSERT OR REPLACE INTO private_role_permissions (permission_name, permission_value, is_enabled)
                VALUES (?, ?, ?)
            `, [permissionName, permissionValue, isEnabled ? 1 : 0]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في حفظ الصلاحية:', error);
            return { success: false, error: error.message };
        }
    }

    async getPermissions() {
        return await this.all('SELECT * FROM private_role_permissions WHERE is_enabled = 1');
    }

    async createRequest(requesterId, ownerId, deputyId, roleName, memberLimit) {
        try {
            const result = await this.run(`
                INSERT INTO private_role_requests (requester_id, owner_id, deputy_id, role_name, member_limit)
                VALUES (?, ?, ?, ?, ?)
            `, [requesterId, ownerId, deputyId, roleName, memberLimit]);
            return { success: true, requestId: result.id };
        } catch (error) {
            console.error('❌ خطأ في إنشاء الطلب:', error);
            return { success: false, error: error.message };
        }
    }

    async getRequest(requestId) {
        return await this.get('SELECT * FROM private_role_requests WHERE id = ?', [requestId]);
    }

    async getPendingRequests() {
        return await this.all("SELECT * FROM private_role_requests WHERE status = 'pending' ORDER BY created_at DESC");
    }

    async updateRequestStatus(requestId, status, reviewedBy) {
        try {
            await this.run(`
                UPDATE private_role_requests 
                SET status = ?, reviewed_by = ?, reviewed_at = strftime('%s', 'now')
                WHERE id = ?
            `, [status, reviewedBy, requestId]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تحديث حالة الطلب:', error);
            return { success: false, error: error.message };
        }
    }

    async calculateRolePoints(roleId, dbManager) {
        try {
            const members = await this.getMembers(roleId);
            if (!members || members.length === 0) return 0;

            let totalPoints = 0;

            for (const member of members) {
                const userStats = await dbManager.getUserStats(member.user_id);
                if (userStats) {
                    const voiceXP = Math.floor((userStats.totalVoiceTime || 0) / (5 * 60 * 1000));
                    const chatXP = Math.floor((userStats.totalMessages || 0) / 10);
                    totalPoints += voiceXP + chatXP;
                }
            }

            await this.updateRole(roleId, { totalPoints });
            return totalPoints;
        } catch (error) {
            console.error('❌ خطأ في حساب نقاط الرول:', error);
            return 0;
        }
    }

    async getTopRoles(limit = 10, dbManager) {
        try {
            const roles = await this.getAllRoles();
            
            for (const role of roles) {
                await this.calculateRolePoints(role.role_id, dbManager);
            }

            const updatedRoles = await this.all(`
                SELECT * FROM private_roles 
                WHERE is_deleted = 0 
                ORDER BY total_points DESC 
                LIMIT ?
            `, [limit]);

            return updatedRoles;
        } catch (error) {
            console.error('❌ خطأ في جلب توب الرولات:', error);
            return [];
        }
    }

    async resetRolePoints(roleId = null) {
        try {
            if (roleId) {
                await this.run('UPDATE private_roles SET total_points = 0 WHERE role_id = ?', [roleId]);
            } else {
                await this.run('UPDATE private_roles SET total_points = 0');
            }
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تصفير النقاط:', error);
            return { success: false, error: error.message };
        }
    }

    async recordPoints(roleId, points) {
        try {
            await this.run(`
                INSERT INTO private_role_points_history (role_id, points)
                VALUES (?, ?)
            `, [roleId, points]);
            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تسجيل النقاط:', error);
            return { success: false, error: error.message };
        }
    }

    async getUserRoles(userId) {
        return await this.all(`
            SELECT pr.* FROM private_roles pr
            JOIN private_role_members prm ON pr.role_id = prm.role_id
            WHERE prm.user_id = ? AND pr.is_deleted = 0
        `, [userId]);
    }

    async getOwnedRole(userId) {
        return await this.get('SELECT * FROM private_roles WHERE owner_id = ? AND is_deleted = 0', [userId]);
    }

    async changeOwner(roleId, newOwnerId) {
        try {
            const role = await this.getRole(roleId);
            if (!role) return { success: false, error: 'الرول غير موجود' };

            await this.run('UPDATE private_roles SET owner_id = ? WHERE role_id = ?', [newOwnerId, roleId]);
            
            await this.addMember(roleId, newOwnerId, role.owner_id);

            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تغيير المالك:', error);
            return { success: false, error: error.message };
        }
    }

    async changeDeputy(roleId, newDeputyId, changedBy) {
        try {
            const role = await this.getRole(roleId);
            if (!role) return { success: false, error: 'الرول غير موجود' };

            if (role.owner_id !== changedBy && role.deputy_id !== changedBy) {
                return { success: false, error: 'ليس لديك صلاحية لتغيير النائب' };
            }

            await this.run('UPDATE private_roles SET deputy_id = ? WHERE role_id = ?', [newDeputyId, roleId]);
            
            if (newDeputyId) {
                await this.addMember(roleId, newDeputyId, changedBy);
            }

            return { success: true };
        } catch (error) {
            console.error('❌ خطأ في تغيير النائب:', error);
            return { success: false, error: error.message };
        }
    }
}

let privateRolesManagerInstance = null;

function getPrivateRolesManager() {
    if (!privateRolesManagerInstance) {
        privateRolesManagerInstance = new PrivateRolesManager();
    }
    return privateRolesManagerInstance;
}

async function initializePrivateRolesManager() {
    const manager = getPrivateRolesManager();
    await manager.initialize();
    return manager;
}

module.exports = {
    PrivateRolesManager,
    getPrivateRolesManager,
    initializePrivateRolesManager
};
