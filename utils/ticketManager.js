const { getDatabase } = require('./database');
const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

class TicketManager {
    constructor() {
        this.db = null;
        this.ticketCounter = 0;
    }

    async initialize() {
        this.db = getDatabase();
        await this.loadTicketCounter();
        console.log('✅ تم تهيئة مدير التذاكر بنجاح');
    }

    async loadTicketCounter() {
        try {
            const result = await this.db.get(`
                SELECT MAX(ticket_number) as max_number FROM tickets
            `);
            this.ticketCounter = result?.max_number || 0;
        } catch (error) {
            console.error('❌ خطأ في تحميل عداد التذاكر:', error);
            this.ticketCounter = 0;
        }
    }

    async getSetting(key, defaultValue = null) {
        try {
            const result = await this.db.get(`
                SELECT setting_value FROM ticket_settings WHERE setting_key = ?
            `, [key]);
            
            if (!result) return defaultValue;
            
            try {
                return JSON.parse(result.setting_value);
            } catch {
                return result.setting_value;
            }
        } catch (error) {
            console.error(`❌ خطأ في جلب الإعداد ${key}:`, error);
            return defaultValue;
        }
    }

    async setSetting(key, value) {
        try {
            const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
            
            await this.db.run(`
                INSERT INTO ticket_settings (setting_key, setting_value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
            `, [key, valueStr, Date.now()]);
            
            return true;
        } catch (error) {
            console.error(`❌ خطأ في حفظ الإعداد ${key}:`, error);
            return false;
        }
    }

    async getAllSettings() {
        try {
            const rows = await this.db.all(`
                SELECT setting_key, setting_value FROM ticket_settings
            `);
            
            const settings = {};
            for (const row of rows) {
                try {
                    settings[row.setting_key] = JSON.parse(row.setting_value);
                } catch {
                    settings[row.setting_key] = row.setting_value;
                }
            }
            
            return settings;
        } catch (error) {
            console.error('❌ خطأ في جلب جميع الإعدادات:', error);
            return {};
        }
    }

    async getSettings(guildId) {
        return await this.getAllSettings();
    }

    async updateSettings(guildId, updates) {
        try {
            for (const [key, value] of Object.entries(updates)) {
                await this.setSetting(key, value);
            }
            return true;
        } catch (error) {
            console.error('❌ خطأ في تحديث الإعدادات:', error);
            return false;
        }
    }

    async getActiveReasons(guildId) {
        try {
            const reasons = await this.db.all(`
                SELECT * FROM ticket_reasons ORDER BY created_at ASC
            `);
            
            const activeReasons = [];
            for (const reason of reasons) {
                if (reason.display_roles) {
                    try {
                        reason.display_roles = JSON.parse(reason.display_roles);
                    } catch {
                        reason.display_roles = [];
                    }
                }
                activeReasons.push(reason);
            }
            
            return activeReasons;
        } catch (error) {
            console.error('❌ خطأ في جلب الأسباب النشطة:', error);
            return [];
        }
    }

    async isUserBlocked(guildId, userId) {
        return await this.isUserBlocked(userId);
    }

    async getBlockInfo(guildId, userId) {
        try {
            const result = await this.db.get(`
                SELECT * FROM ticket_blocks WHERE user_id = ?
            `, [userId]);
            
            return result || null;
        } catch (error) {
            console.error('❌ خطأ في جلب معلومات البلوك:', error);
            return null;
        }
    }

    async getCooldownLeft(guildId, userId) {
        try {
            const cooldownCheck = await this.checkCooldown(userId, 'ticket_open');
            if (cooldownCheck.onCooldown) {
                return cooldownCheck.remaining * 1000; // تحويل إلى ميلي ثانية
            }
            return 0;
        } catch (error) {
            console.error('❌ خطأ في فحص الكولداون:', error);
            return 0;
        }
    }

    async canManageTicket(guildId, userId, reasonId) {
        try {
            // فحص إذا كان المستخدم إداري
            const adminRoles = await this.getAdminRoles();
            const guild = global.client ? global.client.guilds.cache.get(guildId) : null;
            
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    // فحص صلاحيات الإدارة
                    if (member.permissions.has('Administrator')) return true;
                    
                    // فحص رولات الإدارة
                    const hasAdminRole = adminRoles.some(roleData => 
                        member.roles.cache.has(roleData.role_id)
                    );
                    if (hasAdminRole) return true;
                }
            }

            // فحص المسؤولين
            const managers = await this.getManagers();
            const hasManagerPermission = managers.some(m => 
                m.manager_id === userId && 
                (m.responsibility === 'all_tickets' || m.responsibility === 'manage_points')
            );
            
            return hasManagerPermission;
        } catch (error) {
            console.error('❌ خطأ في فحص صلاحيات التذكرة:', error);
            return false;
        }
    }

    async getTicketById(ticketId) {
        try {
            return await this.db.get(`
                SELECT * FROM tickets WHERE ticket_id = ?
            `, [ticketId]);
        } catch (error) {
            console.error('❌ خطأ في جلب التذكرة:', error);
            return null;
        }
    }

    async updateTicketStatus(ticketId, status, closedBy = null) {
        try {
            if (status === 'closed' && closedBy) {
                await this.db.run(`
                    UPDATE tickets
                    SET status = ?, closed_at = ?, closed_by = ?
                    WHERE ticket_id = ?
                `, [status, Date.now(), closedBy, ticketId]);
            } else {
                await this.db.run(`
                    UPDATE tickets
                    SET status = ?
                    WHERE ticket_id = ?
                `, [status, ticketId]);
            }
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تحديث حالة التذكرة:', error);
            return false;
        }
    }

    async addReason(reasonData) {
        try {
            const reasonId = `reason_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            await this.db.run(`
                INSERT INTO ticket_reasons (
                    reason_id, reason_name, reason_emoji, reason_description,
                    category_id, acceptance_channel_id, ticket_name_format,
                    ticket_message, acceptance_message, role_to_give, display_roles
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                reasonId,
                reasonData.name,
                reasonData.emoji || '🎫',
                reasonData.description || '',
                reasonData.categoryId || null,
                reasonData.acceptanceChannelId || null,
                reasonData.ticketNameFormat || 't-user',
                reasonData.ticketMessage || null,
                reasonData.acceptanceMessage || null,
                reasonData.roleToGive || null,
                reasonData.displayRoles ? JSON.stringify(reasonData.displayRoles) : null
            ]);
            
            return reasonId;
        } catch (error) {
            console.error('❌ خطأ في إضافة السبب:', error);
            return null;
        }
    }

    async updateReason(reasonId, updates) {
        try {
            const fields = [];
            const values = [];
            
            if (updates.name !== undefined) {
                fields.push('reason_name = ?');
                values.push(updates.name);
            }
            if (updates.emoji !== undefined) {
                fields.push('reason_emoji = ?');
                values.push(updates.emoji);
            }
            if (updates.description !== undefined) {
                fields.push('reason_description = ?');
                values.push(updates.description);
            }
            if (updates.categoryId !== undefined) {
                fields.push('category_id = ?');
                values.push(updates.categoryId);
            }
            if (updates.acceptanceChannelId !== undefined) {
                fields.push('acceptance_channel_id = ?');
                values.push(updates.acceptanceChannelId);
            }
            if (updates.ticketNameFormat !== undefined) {
                fields.push('ticket_name_format = ?');
                values.push(updates.ticketNameFormat);
            }
            if (updates.ticketMessage !== undefined) {
                fields.push('ticket_message = ?');
                values.push(updates.ticketMessage);
            }
            if (updates.acceptanceMessage !== undefined) {
                fields.push('acceptance_message = ?');
                values.push(updates.acceptanceMessage);
            }
            if (updates.roleToGive !== undefined) {
                fields.push('role_to_give = ?');
                values.push(updates.roleToGive);
            }
            if (updates.displayRoles !== undefined) {
                fields.push('display_roles = ?');
                values.push(JSON.stringify(updates.displayRoles));
            }
            
            if (fields.length === 0) return false;
            
            fields.push('updated_at = ?');
            values.push(Date.now());
            values.push(reasonId);
            
            await this.db.run(`
                UPDATE ticket_reasons
                SET ${fields.join(', ')}
                WHERE reason_id = ?
            `, values);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تحديث السبب:', error);
            return false;
        }
    }

    async getReason(reasonId) {
        try {
            const reason = await this.db.get(`
                SELECT * FROM ticket_reasons WHERE reason_id = ?
            `, [reasonId]);
            
            if (reason && reason.display_roles) {
                try {
                    reason.display_roles = JSON.parse(reason.display_roles);
                } catch {
                    reason.display_roles = [];
                }
            }
            
            return reason;
        } catch (error) {
            console.error('❌ خطأ في جلب السبب:', error);
            return null;
        }
    }

    async getAllReasons() {
        try {
            const reasons = await this.db.all(`
                SELECT * FROM ticket_reasons ORDER BY created_at ASC
            `);
            
            for (const reason of reasons) {
                if (reason.display_roles) {
                    try {
                        reason.display_roles = JSON.parse(reason.display_roles);
                    } catch {
                        reason.display_roles = [];
                    }
                }
            }
            
            return reasons;
        } catch (error) {
            console.error('❌ خطأ في جلب جميع الأسباب:', error);
            return [];
        }
    }

    async deleteReason(reasonId) {
        try {
            await this.db.run(`
                DELETE FROM ticket_reasons WHERE reason_id = ?
            `, [reasonId]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في حذف السبب:', error);
            return false;
        }
    }

    async isUserBlocked(userId) {
        try {
            const result = await this.db.get(`
                SELECT * FROM ticket_blocks WHERE user_id = ?
            `, [userId]);
            
            return result !== undefined;
        } catch (error) {
            console.error('❌ خطأ في فحص البلوك:', error);
            return false;
        }
    }

    async blockUser(userId, blockedBy, reason = null) {
        try {
            await this.db.run(`
                INSERT INTO ticket_blocks (user_id, blocked_by, reason)
                VALUES (?, ?, ?)
            `, [userId, blockedBy, reason]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في حظر المستخدم:', error);
            return false;
        }
    }

    async unblockUser(userId) {
        try {
            await this.db.run(`
                DELETE FROM ticket_blocks WHERE user_id = ?
            `, [userId]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إلغاء حظر المستخدم:', error);
            return false;
        }
    }

    async getBlockedUsers() {
        try {
            return await this.db.all(`
                SELECT * FROM ticket_blocks ORDER BY blocked_at DESC
            `);
        } catch (error) {
            console.error('❌ خطأ في جلب قائمة المحظورين:', error);
            return [];
        }
    }

    async checkCooldown(userId, cooldownType) {
        try {
            const result = await this.db.get(`
                SELECT expires_at FROM ticket_cooldowns
                WHERE user_id = ? AND cooldown_type = ?
            `, [userId, cooldownType]);
            
            if (!result) return { onCooldown: false };
            
            const now = Date.now();
            if (result.expires_at > now) {
                const remaining = Math.ceil((result.expires_at - now) / 1000);
                return { onCooldown: true, remaining };
            }
            
            await this.db.run(`
                DELETE FROM ticket_cooldowns WHERE user_id = ? AND cooldown_type = ?
            `, [userId, cooldownType]);
            
            return { onCooldown: false };
        } catch (error) {
            console.error('❌ خطأ في فحص الكولداون:', error);
            return { onCooldown: false };
        }
    }

    async setCooldown(userId, cooldownType, duration) {
        try {
            const expiresAt = Date.now() + duration;
            
            await this.db.run(`
                INSERT INTO ticket_cooldowns (user_id, cooldown_type, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    cooldown_type = excluded.cooldown_type,
                    expires_at = excluded.expires_at
            `, [userId, cooldownType, expiresAt]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تعيين الكولداون:', error);
            return false;
        }
    }

    async addAdminRole(roleId, addedBy) {
        try {
            await this.db.run(`
                INSERT INTO ticket_admin_roles (role_id, added_by)
                VALUES (?, ?)
            `, [roleId, addedBy]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إضافة رول الإدارة:', error);
            return false;
        }
    }

    async removeAdminRole(roleId) {
        try {
            await this.db.run(`
                DELETE FROM ticket_admin_roles WHERE role_id = ?
            `, [roleId]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إزالة رول الإدارة:', error);
            return false;
        }
    }

    async getAdminRoles() {
        try {
            return await this.db.all(`
                SELECT * FROM ticket_admin_roles ORDER BY added_at ASC
            `);
        } catch (error) {
            console.error('❌ خطأ في جلب رولات الإدارة:', error);
            return [];
        }
    }

    async addManager(managerId, managerType, responsibility, addedBy) {
        try {
            await this.db.run(`
                INSERT INTO ticket_managers (manager_id, manager_type, responsibility, added_by)
                VALUES (?, ?, ?, ?)
            `, [managerId, managerType, responsibility, addedBy]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إضافة مسؤول:', error);
            return false;
        }
    }

    async removeManager(managerId, responsibility = null) {
        try {
            if (responsibility) {
                await this.db.run(`
                    DELETE FROM ticket_managers 
                    WHERE manager_id = ? AND responsibility = ?
                `, [managerId, responsibility]);
            } else {
                await this.db.run(`
                    DELETE FROM ticket_managers WHERE manager_id = ?
                `, [managerId]);
            }
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إزالة مسؤول:', error);
            return false;
        }
    }

    async getManagers() {
        try {
            return await this.db.all(`
                SELECT * FROM ticket_managers ORDER BY added_at ASC
            `);
        } catch (error) {
            console.error('❌ خطأ في جلب قائمة المسؤولين:', error);
            return [];
        }
    }

    async createTicket(guild, user, reason, staffId = null) {
        try {
            this.ticketCounter++;
            const ticketId = `ticket_${Date.now()}_${user.id}`;
            const ticketNumber = this.ticketCounter;
            
            const ticketNumbering = await this.getSetting('ticket_numbering', false);
            const channelName = ticketNumbering ? `t-${ticketNumber}` : `t-${user.username}`;
            
            const categoryId = reason?.category_id || await this.getSetting('default_category_id');
            
            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }
                ]
            });
            
            if (staffId) {
                await channel.permissionOverwrites.create(staffId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
            }
            
            const adminRoles = await this.getAdminRoles();
            for (const roleData of adminRoles) {
                try {
                    await channel.permissionOverwrites.create(roleData.role_id, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                } catch (err) {
                    console.error(`❌ خطأ في إضافة صلاحيات الرول ${roleData.role_id}:`, err);
                }
            }
            
            if (reason && reason.display_roles) {
                for (const roleId of reason.display_roles) {
                    try {
                        await channel.permissionOverwrites.create(roleId, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true
                        });
                    } catch (err) {
                        console.error(`❌ خطأ في إضافة صلاحيات الرول ${roleId}:`, err);
                    }
                }
            }
            
            await this.db.run(`
                INSERT INTO tickets (
                    ticket_id, ticket_number, channel_id, user_id, reason_id, 
                    staff_id, status, category_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                ticketId, ticketNumber, channel.id, user.id,
                reason?.reason_id || null, staffId, 'open', categoryId
            ]);
            
            return { ticketId, channel, ticketNumber };
        } catch (error) {
            console.error('❌ خطأ في إنشاء التذكرة:', error);
            return null;
        }
    }

    async getTicket(channelId) {
        try {
            return await this.db.get(`
                SELECT * FROM tickets WHERE channel_id = ?
            `, [channelId]);
        } catch (error) {
            console.error('❌ خطأ في جلب التذكرة:', error);
            return null;
        }
    }

    async getUserOpenTickets(guildId, userId) {
        try {
            return await this.db.all(`
                SELECT * FROM tickets 
                WHERE user_id = ? AND status IN ('open', 'pending')
            `, [userId]);
        } catch (error) {
            console.error('❌ خطأ في جلب التذاكر المفتوحة للمستخدم:', error);
            return [];
        }
    }

    async getNextTicketNumber(guildId) {
        try {
            this.ticketCounter++;
            return this.ticketCounter;
        } catch (error) {
            console.error('❌ خطأ في الحصول على رقم التذكرة:', error);
            return Date.now();
        }
    }

    async getReasonById(guildId, reasonId) {
        try {
            const reason = await this.db.get(`
                SELECT * FROM ticket_reasons WHERE reason_id = ?
            `, [reasonId]);
            
            if (reason && reason.display_roles) {
                try {
                    reason.display_roles = JSON.parse(reason.display_roles);
                } catch {
                    reason.display_roles = [];
                }
            }
            
            return reason;
        } catch (error) {
            console.error('❌ خطأ في جلب السبب:', error);
            return null;
        }
    }

    async addCooldown(guildId, userId, duration) {
        try {
            await this.setCooldown(userId, 'ticket_open', duration);
            return true;
        } catch (error) {
            console.error('❌ خطأ في إضافة الكولداون:', error);
            return false;
        }
    }

    async updateTicket(ticketId, updates) {
        try {
            const fields = [];
            const values = [];
            
            if (updates.status !== undefined) {
                fields.push('status = ?');
                values.push(updates.status);
            }
            if (updates.claimed_by !== undefined) {
                fields.push('claimed_by = ?');
                values.push(updates.claimed_by);
            }
            if (updates.user_id !== undefined) {
                fields.push('user_id = ?');
                values.push(updates.user_id);
            }
            
            if (fields.length === 0) return false;
            
            values.push(ticketId);
            
            await this.db.run(`
                UPDATE tickets
                SET ${fields.join(', ')}
                WHERE ticket_id = ?
            `, values);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تحديث التذكرة:', error);
            return false;
        }
    }

    async logAction(ticketId, userId, action, metadata = {}) {
        try {
            await this.db.run(`
                INSERT INTO ticket_logs (
                    ticket_id, user_id, action_type, metadata
                ) VALUES (?, ?, ?, ?)
            `, [ticketId, userId, action, JSON.stringify(metadata)]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تسجيل الإجراء:', error);
            return false;
        }
    }

    async addPoints(guildId, userId, points = 1) {
        return await this.givePoints(userId, points);
    }

    async addManagerPoints(guildId, userId, points = 1) {
        return await this.giveManagerPoints(userId, points);
    }

    async closeTicket(ticketId, closedBy) {
        try {
            await this.db.run(`
                UPDATE tickets
                SET status = 'closed', closed_at = ?, closed_by = ?
                WHERE ticket_id = ?
            `, [Date.now(), closedBy, ticketId]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إغلاق التذكرة:', error);
            return false;
        }
    }

    async givePoints(userId, points = 1) {
        try {
            await this.db.run(`
                INSERT INTO ticket_points (user_id, total_points, tickets_handled, last_point_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    total_points = total_points + ?,
                    tickets_handled = tickets_handled + 1,
                    last_point_at = ?,
                    updated_at = ?
            `, [userId, points, Date.now(), points, Date.now(), Date.now()]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إعطاء نقاط:', error);
            return false;
        }
    }

    async giveManagerPoints(userId, points = 1) {
        try {
            await this.db.run(`
                INSERT INTO ticket_manager_points (user_id, total_points, tickets_deleted, last_point_at)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    total_points = total_points + ?,
                    tickets_deleted = tickets_deleted + 1,
                    last_point_at = ?,
                    updated_at = ?
            `, [userId, points, Date.now(), points, Date.now(), Date.now()]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في إعطاء نقاط المسؤول:', error);
            return false;
        }
    }

    async getPoints() {
        try {
            return await this.db.all(`
                SELECT * FROM ticket_points ORDER BY total_points DESC
            `);
        } catch (error) {
            console.error('❌ خطأ في جلب النقاط:', error);
            return [];
        }
    }

    async getManagerPoints() {
        try {
            return await this.db.all(`
                SELECT * FROM ticket_manager_points ORDER BY total_points DESC
            `);
        } catch (error) {
            console.error('❌ خطأ في جلب نقاط المسؤولين:', error);
            return [];
        }
    }

    async resetPoints() {
        try {
            await this.db.run(`DELETE FROM ticket_points`);
            return true;
        } catch (error) {
            console.error('❌ خطأ في تصفير النقاط:', error);
            return false;
        }
    }

    async resetManagerPoints() {
        try {
            await this.db.run(`DELETE FROM ticket_manager_points`);
            return true;
        } catch (error) {
            console.error('❌ خطأ في تصفير نقاط المسؤولين:', error);
            return false;
        }
    }

    async createTranscript(channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const messagesArray = Array.from(messages.values()).reverse();
            
            let transcript = `Transcript for #${channel.name}\n`;
            transcript += `Created at: ${new Date().toISOString()}\n`;
            transcript += `${'='.repeat(50)}\n\n`;
            
            for (const msg of messagesArray) {
                const timestamp = msg.createdAt.toISOString();
                const author = msg.author.tag;
                const content = msg.content || '[No content]';
                
                transcript += `[${timestamp}] ${author}: ${content}\n`;
                
                if (msg.attachments.size > 0) {
                    msg.attachments.forEach(att => {
                        transcript += `  📎 Attachment: ${att.url}\n`;
                    });
                }
                
                transcript += '\n';
            }
            
            const transcriptsDir = path.join(__dirname, '..', 'transcripts');
            if (!fs.existsSync(transcriptsDir)) {
                fs.mkdirSync(transcriptsDir, { recursive: true });
            }
            
            const filename = `transcript_${channel.id}_${Date.now()}.txt`;
            const filepath = path.join(transcriptsDir, filename);
            
            fs.writeFileSync(filepath, transcript, 'utf8');
            
            return filepath;
        } catch (error) {
            console.error('❌ خطأ في إنشاء الترانسكريبت:', error);
            return null;
        }
    }

    async logTicket(ticketData) {
        try {
            await this.db.run(`
                INSERT INTO ticket_logs (
                    ticket_id, user_id, staff_id, reason_id, manager_id,
                    points_given, action_type, transcript_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                ticketData.ticketId,
                ticketData.userId,
                ticketData.staffId || null,
                ticketData.reasonId || null,
                ticketData.managerId || null,
                ticketData.pointsGiven || 0,
                ticketData.actionType || 'deleted',
                ticketData.transcriptPath || null
            ]);
            
            return true;
        } catch (error) {
            console.error('❌ خطأ في تسجيل اللوق:', error);
            return false;
        }
    }
}

const ticketManager = new TicketManager();

module.exports = {
    TicketManager,
    ticketManager
};
