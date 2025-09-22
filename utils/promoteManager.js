const fs = require('fs');
const path = require('path');
// EmbedBuilder now handled by colorManager
const colorManager = require('./colorManager');
const ms = require('ms');

// File paths
const promoteSettingsPath = path.join(__dirname, '..', 'data', 'promoteSettings.json');
const activePromotesPath = path.join(__dirname, '..', 'data', 'activePromotes.json');
const promoteLogsPath = path.join(__dirname, '..', 'data', 'promoteLogs.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
const leftMembersPromotesPath = path.join(__dirname, '..', 'data', 'leftMembersPromotes.json');
const promoteBansPath = path.join(__dirname, '..', 'data', 'promoteBans.json');

// Utility functions
function readJson(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultValue;
}

// عداد للعمليات المتعلقة بالملفات لتجنب race conditions
const fileLocks = new Map();

function writeJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // كتابة إلى ملف مؤقت أولاً
        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));

        // استبدال الملف الأصلي (atomic operation)
        fs.renameSync(tempPath, filePath);

        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

class PromoteManager {
    constructor() {
        this.client = null;
        this.database = null;
        this.ensureDataFiles();
        // قائمة تجاهل مؤقتة للرولات المُضافة تلقائياً
        this.autoPromoteIgnoreList = new Map();
        // قائمة تتبع الترقيات التي يقوم بها البوت (لمنع التداخل مع نظام الحماية)
        this.botPromotionTracking = new Set();
    }

    // Initialize with Discord client and database
    init(client, database = null) {
        this.client = client;
        this.database = database;
        this.startExpirationChecker(client);
        this.startBanMonitoring();
        // بدء مهام الصيانة فور التهيئة
        setTimeout(() => this.startMaintenanceTasks(), 5000); // تأخير 5 ثوانٍ
    }

    ensureDataFiles() {
        // Create default settings file
        if (!fs.existsSync(promoteSettingsPath)) {
            const defaultSettings = {
                menuChannel: null,
                logChannel: null,
                allowedUsers: {
                    type: null, // 'owners', 'roles', 'responsibility'
                    targets: []
                }
            };
            writeJson(promoteSettingsPath, defaultSettings);
        }

        // Create active promotes file
        if (!fs.existsSync(activePromotesPath)) {
            writeJson(activePromotesPath, {});
        }

        // Create logs file
        if (!fs.existsSync(promoteLogsPath)) {
            writeJson(promoteLogsPath, []);
        }

        // Create left members promotes file
        if (!fs.existsSync(leftMembersPromotesPath)) {
            writeJson(leftMembersPromotesPath, {});
        }

        // Create promote bans file
        if (!fs.existsSync(promoteBansPath)) {
            writeJson(promoteBansPath, {});
        }
    }

    // Settings Management
    getSettings() {
        return readJson(promoteSettingsPath, {
            menuChannel: null,
            logChannel: null,
            allowedUsers: {
                type: null,
                targets: []
            }
        });
    }

    updateSettings(newSettings) {
        return writeJson(promoteSettingsPath, newSettings);
    }

    // Permission Checking
    async hasPermission(interaction, botOwners) {
        const settings = this.getSettings();
        const userId = interaction.user.id;

        // Bot owners always have permission
        if (botOwners.includes(userId)) return true;

        // Check configured permissions
        if (!settings.allowedUsers.type) return false;

        switch (settings.allowedUsers.type) {
            case 'owners':
                return botOwners.includes(userId);

            case 'roles':
                const userRoles = interaction.member.roles.cache.map(role => role.id);
                return settings.allowedUsers.targets.some(roleId => userRoles.includes(roleId));

            case 'responsibility':
                const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
                const responsibilities = readJson(responsibilitiesPath, {});

                for (const respName of settings.allowedUsers.targets) {
                    const respData = responsibilities[respName];
                    if (respData && respData.responsibles && respData.responsibles.includes(userId)) {
                        return true;
                    }
                }
                return false;
        }

        return false;
    }

    // Admin Roles Validation
    getAdminRoles() {
        return readJson(adminRolesPath, []);
    }

    isAdminRole(roleId) {
        const adminRoles = this.getAdminRoles();
        return adminRoles.includes(roleId);
    }

    // Role Hierarchy Validation for Promotions
    async validateRoleHierarchy(guild, targetUserId, roleId, promoterUserId) {
        try {
            const targetMember = await guild.members.fetch(targetUserId);
            const promoterMember = await guild.members.fetch(promoterUserId);
            const role = await guild.roles.fetch(roleId);

            if (!targetMember || !promoterMember || !role) {
                return { valid: false, error: 'لا يمكن العثور على العضو أو الرول' };
            }

            // Get highest roles
            const targetHighestRole = targetMember.roles.highest;
            const promoterHighestRole = promoterMember.roles.highest;

            // Role to be added should be higher than target's current highest role
            if (role.position <= targetHighestRole.position) {
                return { 
                    valid: false, 
                    error: `الرول المحدد (**${role.name}**) يجب أن يكون أعلى من أعلى رول للعضو (**${targetHighestRole.name}**)` 
                };
            }

            // Role to be added should be lower than promoter's highest role
            if (role.position >= promoterHighestRole.position) {
                return { 
                    valid: false, 
                    error: `لا يمكنك ترقية شخص إلى رول (**${role.name}**) أعلى من أو مساوي لرولك الأعلى (**${promoterHighestRole.name}**)` 
                };
            }

            return { valid: true };

        } catch (error) {
            console.error('Error validating role hierarchy:', error);
            return { valid: false, error: 'حدث خطأ في فحص الصلاحيات' };
        }
    }

    // Bot Permissions Validation
    async validateBotPermissionsOnly(guild, roleId) {
        try {
            const botMember = await guild.members.fetch(this.client.user.id);
            const role = await guild.roles.fetch(roleId);

            if (!role) {
                return { valid: false, error: 'الرول غير موجود' };
            }

            // Check if bot has permission to manage roles
            if (!botMember.permissions.has('ManageRoles')) {
                return { valid: false, error: 'البوت لا يملك صلاحية إدارة الرولات' };
            }

            // Check role hierarchy for bot
            if (role.position >= botMember.roles.highest.position) {
                return { 
                    valid: false, 
                    error: `الرول (**${role.name}**) أعلى من رول البوت - لا يمكن إدارته` 
                };
            }

            return { valid: true };

        } catch (error) {
            console.error('Error validating bot permissions:', error);
            return { valid: false, error: 'حدث خطأ في فحص صلاحيات البوت' };
        }
    }

    // Get interaction statistics from database
    async getUserInteractionStats(userId) {
        let database = this.database;
        
        // Try to get database if not available
        if (!database) {
            try {
                const databaseModule = require('./database');
                database = databaseModule.getDatabase();
            } catch (error) {
                console.log('قاعدة البيانات غير متاحة للإحصائيات');
            }
        }

        if (!database) {
            return {
                totalVoiceTime: 0,
                totalMessages: 0,
                totalReactions: 0,
                totalSessions: 0,
                activeDays: 0
            };
        }

        try {
            const userStats = await database.get(`
                SELECT total_voice_time, total_messages, total_reactions, 
                       total_sessions, active_days
                FROM user_totals 
                WHERE user_id = ?
            `, [userId]);

            return {
                totalVoiceTime: userStats?.total_voice_time || 0,
                totalMessages: userStats?.total_messages || 0,
                totalReactions: userStats?.total_reactions || 0,
                totalSessions: userStats?.total_sessions || 0,
                activeDays: userStats?.active_days || 0
            };
        } catch (error) {
            console.error('Error getting user interaction stats:', error);
            return {
                totalVoiceTime: 0,
                totalMessages: 0,
                totalReactions: 0,
                totalSessions: 0,
                activeDays: 0
            };
        }
    }

    // Promotion Operations
    async createPromotion(guild, client, targetUserId, roleId, duration, reason, byUserId) {
        try {
            // Validate admin role
            if (!this.isAdminRole(roleId)) {
                return { success: false, error: 'الرول المحدد ليس من الرولات الإدارية' };
            }

            // التحقق من صلاحيات البوت فقط
            const botValidation = await this.validateBotPermissionsOnly(guild, roleId);
            if (!botValidation.valid) {
                return { success: false, error: botValidation.error };
            }

            // فحص هرمية الرولات للترقية
            const hierarchyValidation = await this.validateRoleHierarchy(guild, targetUserId, roleId, byUserId);
            if (!hierarchyValidation.valid) {
                return { success: false, error: hierarchyValidation.error };
            }

            // Get target member
            const targetMember = await guild.members.fetch(targetUserId);
            if (!targetMember) {
                return { success: false, error: 'العضو غير موجود' };
            }

            // Get role
            const role = await guild.roles.fetch(roleId);
            if (!role) {
                return { success: false, error: 'الرول غير موجود' };
            }

            // Check if member already has the role
            if (targetMember.roles.cache.has(roleId)) {
                return { success: false, error: 'العضو يملك هذا الرول بالفعل' };
            }

            // Check if user is banned from promotions
            const promoteBans = readJson(promoteBansPath, {});
            const banKey = `${targetUserId}_${guild.id}`;
            if (promoteBans[banKey]) {
                const banData = promoteBans[banKey];
                const banEndTime = banData.endTime;
                
                if (!banEndTime || banEndTime > Date.now()) {
                    const banEndText = banEndTime ? 
                        `<t:${Math.floor(banEndTime / 1000)}:R>` : 
                        'نهائي';
                    return { 
                        success: false, 
                        error: `العضو محظور من الترقيات. ينتهي الحظر: ${banEndText}` 
                    };
                }
            }

            // Get user interaction statistics
            const userStats = await this.getUserInteractionStats(targetUserId);

            // Add the role with error handling
            try {
                await targetMember.roles.add(roleId, `ترقية بواسطة ${await guild.members.fetch(byUserId).then(m => m.displayName).catch(() => 'غير معروف')}: ${reason}`);
            } catch (roleError) {
                console.error('Error adding role:', roleError);
                return { success: false, error: 'فشل في إضافة الرول - تحقق من صلاحيات البوت' };
            }

            // Calculate end time
            let endTime = null;
            if (duration && duration !== 'permanent') {
                const durationMs = ms(duration);
                if (!durationMs) {
                    return { success: false, error: 'صيغة المدة غير صحيحة' };
                }
                endTime = Date.now() + durationMs;
            }

            // Create promotion record
            const promoteId = `${targetUserId}_${roleId}_${Date.now()}`;
            const promoteRecord = {
                id: promoteId,
                userId: targetUserId,
                roleId: roleId,
                guildId: guild.id,
                reason: reason,
                byUserId: byUserId,
                startTime: Date.now(),
                endTime: endTime,
                duration: duration,
                status: 'active',
                userStats: userStats
            };

            // Save to active promotes
            const activePromotes = readJson(activePromotesPath, {});
            activePromotes[promoteId] = promoteRecord;
            writeJson(activePromotesPath, activePromotes);

            // Log the action
            this.logAction('PROMOTION_APPLIED', {
                targetUserId,
                roleId,
                duration,
                reason,
                byUserId,
                userStats,
                timestamp: Date.now()
            });

            // Send log message
            await this.sendLogMessage(guild, client, 'PROMOTION_APPLIED', {
                targetUser: targetMember.user,
                role: role,
                duration: duration || 'نهائي',
                reason,
                byUser: await client.users.fetch(byUserId),
                userStats
            });

            // Send private message to promoted user
            try {
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('**تهانينا! تم ترقيتك**')
                    .setDescription(`تم ترقيتك في خادم **${guild.name}** وحصلت على رول جديد!`)
                    .addFields([
                        { name: '**الرول الجديد**', value: `${role.name}`, inline: true },
                        { name: '**المدة**', value: duration || 'نهائي', inline: true },
                        { name: '**السبب**', value: reason, inline: false },
                        { name: '**بواسطة**', value: `<@${byUserId}>`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ])
                    .setThumbnail(targetMember.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                await targetMember.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`لا يمكن إرسال رسالة خاصة إلى ${targetMember.displayName}`);
            }

            return { 
                success: true, 
                promoteId: promoteId,
                duration: duration,
                endTime: endTime
            };

        } catch (error) {
            console.error('Error creating promotion:', error);
            return { success: false, error: 'حدث خطأ أثناء تطبيق الترقية' };
        }
    }

    async endPromotion(guild, client, promoteId, reason = 'انتهاء المدة المحددة') {
        try {
            const activePromotes = readJson(activePromotesPath, {});
            const promoteRecord = activePromotes[promoteId];

            if (!promoteRecord) {
                return { success: false, error: 'الترقية غير موجودة' };
            }

            // Get member and role
            const member = await guild.members.fetch(promoteRecord.userId);
            const role = await guild.roles.fetch(promoteRecord.roleId);

            if (member && role) {
                // إضافة الرول لقائمة التجاهل قبل سحبه (للإنهاء اليدوي)
                this.addToAutoPromoteIgnore(promoteRecord.userId, promoteRecord.roleId);

                // تسجيل أن البوت سيقوم بسحب الرول (لمنع تداخل نظام الحماية)
                const removalKey = `${guild.id}_${promoteRecord.userId}_${promoteRecord.roleId}`;
                this.botPromotionTracking.add(removalKey);

                // إزالة المفتاح بعد 10 ثوانٍ
                setTimeout(() => {
                    this.botPromotionTracking.delete(removalKey);
                }, 10000);

                // Remove role
                await member.roles.remove(promoteRecord.roleId, `انتهاء ترقية مؤقتة: ${reason}`);

                // Send log message
                await this.sendLogMessage(guild, client, 'PROMOTION_ENDED', {
                    targetUser: member.user,
                    role: role,
                    reason,
                    originalReason: promoteRecord.reason,
                    duration: promoteRecord.duration || 'نهائي',
                    byUser: await client.users.fetch(promoteRecord.byUserId)
                });

                // Send private message to user
                try {
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle('**انتهت مدة الترقية**')
                        .setDescription(`انتهت مدة ترقيتك في خادم **${guild.name}**`)
                        .addFields([
                            { name: '**الرول المُزال**', value: `${role.name}`, inline: true },
                            { name: '**سبب الإنهاء**', value: reason, inline: true },
                            { name: '**المدة الأصلية**', value: promoteRecord.duration || 'نهائي', inline: true },
                            { name: '**السبب الأصلي**', value: promoteRecord.reason, inline: false },
                            { name: '**وقت الإنهاء**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                        ])
                        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName}`);
                }
            }

            // Remove from active promotes
            delete activePromotes[promoteId];
            writeJson(activePromotesPath, activePromotes);

            // Log the action
            this.logAction('PROMOTION_ENDED', {
                targetUserId: promoteRecord.userId,
                roleId: promoteRecord.roleId,
                reason,
                originalReason: promoteRecord.reason,
                duration: promoteRecord.duration,
                byUserId: promoteRecord.byUserId,
                timestamp: Date.now()
            });

            return { success: true };

        } catch (error) {
            console.error('Error ending promotion:', error);
            return { success: false, error: 'حدث خطأ أثناء إنهاء الترقية' };
        }
    }

    async modifyPromotionDuration(guild, client, promoteId, newDuration, modifiedBy) {
        try {
            const activePromotes = readJson(activePromotesPath, {});
            const promoteRecord = activePromotes[promoteId];

            if (!promoteRecord) {
                return { success: false, error: 'الترقية غير موجودة' };
            }

            const oldDuration = promoteRecord.duration || 'نهائي';

            // Calculate new end time
            let newEndTime = null;
            if (newDuration && newDuration !== 'permanent') {
                const durationMs = ms(newDuration);
                if (!durationMs) {
                    return { success: false, error: 'صيغة المدة غير صحيحة' };
                }
                newEndTime = Date.now() + durationMs;
            }

            // Update the record
            promoteRecord.duration = newDuration;
            promoteRecord.endTime = newEndTime;
            promoteRecord.modifiedBy = modifiedBy;
            promoteRecord.modifiedAt = Date.now();

            activePromotes[promoteId] = promoteRecord;
            writeJson(activePromotesPath, activePromotes);

            // Log the modification
            this.logAction('PROMOTION_MODIFIED', {
                targetUserId: promoteRecord.userId,
                roleId: promoteRecord.roleId,
                oldDuration,
                newDuration,
                modifiedBy,
                timestamp: Date.now()
            });

            // Send log message
            const member = await guild.members.fetch(promoteRecord.userId);
            const role = await guild.roles.fetch(promoteRecord.roleId);
            await this.sendLogMessage(guild, client, 'PROMOTION_MODIFIED', {
                targetUser: member.user,
                role: role,
                oldDuration,
                newDuration: newDuration || 'نهائي',
                modifiedBy: await client.users.fetch(modifiedBy)
            });

            return { success: true };

        } catch (error) {
            console.error('Error modifying promotion duration:', error);
            return { success: false, error: 'حدث خطأ أثناء تعديل المدة' };
        }
    }

    // Promotion Ban System
    async addPromotionBan(guild, client, targetUserId, duration, reason, byUserId) {
        try {
            const member = await guild.members.fetch(targetUserId);
            if (!member) {
                return { success: false, error: 'العضو غير موجود' };
            }

            // Calculate end time
            let endTime = null;
            if (duration && duration !== 'permanent') {
                const durationMs = ms(duration);
                if (!durationMs) {
                    return { success: false, error: 'صيغة المدة غير صحيحة' };
                }
                endTime = Date.now() + durationMs;
            }

            // Create ban record
            const banKey = `${targetUserId}_${guild.id}`;
            const banRecord = {
                userId: targetUserId,
                guildId: guild.id,
                reason: reason,
                byUserId: byUserId,
                startTime: Date.now(),
                endTime: endTime,
                duration: duration
            };

            // Save ban
            const promoteBans = readJson(promoteBansPath, {});
            promoteBans[banKey] = banRecord;
            writeJson(promoteBansPath, promoteBans);

            // Log the action
            this.logAction('PROMOTION_BAN_ADDED', {
                targetUserId,
                duration,
                reason,
                byUserId,
                timestamp: Date.now()
            });

            // Send log message
            await this.sendLogMessage(guild, client, 'PROMOTION_BAN_ADDED', {
                targetUser: member.user,
                duration: duration || 'نهائي',
                reason,
                byUser: await client.users.fetch(byUserId)
            });

            // Send private message to banned user
            try {
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('**تم حظرك من الترقيات**')
                    .setDescription(`تم حظرك من الحصول على ترقيات في خادم **${guild.name}**`)
                    .addFields([
                        { name: '**المدة**', value: duration || 'نهائي', inline: true },
                        { name: '**السبب**', value: reason, inline: false },
                        { name: '**بواسطة**', value: `<@${byUserId}>`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ])
                    .setThumbnail(member.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                if (endTime) {
                    dmEmbed.addFields([
                        { name: '**ينتهي الحظر**', value: `<t:${Math.floor(endTime / 1000)}:F>`, inline: true }
                    ]);
                }

                await member.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName}`);
            }

            return { success: true, endTime };

        } catch (error) {
            console.error('Error adding promotion ban:', error);
            return { success: false, error: 'حدث خطأ أثناء إضافة الحظر' };
        }
    }

    async removePromotionBan(guild, client, targetUserId, reason, byUserId) {
        try {
            const member = await guild.members.fetch(targetUserId);
            if (!member) {
                return { success: false, error: 'العضو غير موجود' };
            }

            const banKey = `${targetUserId}_${guild.id}`;
            const promoteBans = readJson(promoteBansPath, {});

            if (!promoteBans[banKey]) {
                return { success: false, error: 'العضو غير محظور من الترقيات' };
            }

            // Remove ban
            delete promoteBans[banKey];
            writeJson(promoteBansPath, promoteBans);

            // Log the action
            this.logAction('PROMOTION_BAN_REMOVED', {
                targetUserId,
                reason,
                byUserId,
                timestamp: Date.now()
            });

            // Send log message
            await this.sendLogMessage(guild, client, 'PROMOTION_BAN_REMOVED', {
                targetUser: member.user,
                reason,
                byUser: await client.users.fetch(byUserId)
            });

            // Send private message to unbanned user
            try {
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('**تم إلغاء حظرك من الترقيات**')
                    .setDescription(`تم إلغاء حظرك من الترقيات في خادم **${guild.name}**`)
                    .addFields([
                        { name: '**السبب**', value: reason, inline: false },
                        { name: '**بواسطة**', value: `<@${byUserId}>`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ])
                    .setThumbnail(member.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName}`);
            }

            return { success: true };

        } catch (error) {
            console.error('Error removing promotion ban:', error);
            return { success: false, error: 'حدث خطأ أثناء إلغاء الحظر' };
        }
    }

    // Start ban monitoring system (every 10 seconds)
    startBanMonitoring() {
        setInterval(async () => {
            try {
                const expiredBans = this.getExpiredBans();
                for (const expiredBan of expiredBans) {
                    await this.processExpiredBan(expiredBan);
                }
            } catch (error) {
                console.error('Error in ban monitoring:', error);
            }
        }, 10000); // Check every 10 seconds
    }

    getExpiredBans() {
        const promoteBans = readJson(promoteBansPath, {});
        const now = Date.now();

        return Object.entries(promoteBans)
            .filter(([_, ban]) => ban.endTime && ban.endTime <= now)
            .map(([banKey, ban]) => ({ banKey, ...ban }));
    }

    async processExpiredBan(expiredBan) {
        try {
            if (!this.client) return;

            const guild = await this.client.guilds.fetch(expiredBan.guildId).catch(() => null);
            if (!guild) return;

            const member = await guild.members.fetch(expiredBan.userId).catch(() => null);

            // Remove expired ban
            const promoteBans = readJson(promoteBansPath, {});
            delete promoteBans[expiredBan.banKey];
            writeJson(promoteBansPath, promoteBans);

            // Log automatic unban
            this.logAction('PROMOTION_BAN_EXPIRED', {
                targetUserId: expiredBan.userId,
                originalReason: expiredBan.reason,
                originalDuration: expiredBan.duration,
                timestamp: Date.now()
            });

            // Send log message
            const settings = this.getSettings();
            if (settings.logChannel) {
                const logChannel = await this.client.channels.fetch(settings.logChannel).catch(() => null);
                if (logChannel) {
                    const embed = colorManager.createEmbed()
                        .setTitle('**انتهى حظر الترقيات تلقائياً**')
                        .setDescription('انتهت مدة حظر عضو من الترقيات')
                        .addFields([
                            { name: '**العضو**', value: `<@${expiredBan.userId}>`, inline: true },
                            { name: '**وقت الانتهاء**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                            { name: '**السبب الأصلي**', value: expiredBan.reason || 'غير محدد', inline: false },
                            { name: '**المدة الأصلية**', value: expiredBan.duration || 'نهائي', inline: true },
                            { name: '**تم الحظر بواسطة**', value: `<@${expiredBan.byUserId}>`, inline: true }
                        ])
                        .setTimestamp();

                    await logChannel.send({ embeds: [embed] });
                }
            }

            // Send private message if member still in server
            if (member) {
                try {
                    const dmEmbed = colorManager.createEmbed()
                        .setTitle('**انتهى حظرك من الترقيات**')
                        .setDescription(`انتهت مدة حظرك من الترقيات في خادم **${guild.name}**`)
                        .addFields([
                            { name: '**وقت الانتهاء**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                            { name: '**يمكنك الآن**', value: 'الحصول على ترقيات مرة أخرى', inline: true }
                        ])
                        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة انتهاء الحظر إلى ${member.displayName}`);
                }
            }

            console.log(`انتهى حظر الترقيات تلقائياً للعضو: ${expiredBan.userId}`);

        } catch (error) {
            console.error('Error processing expired ban:', error);
        }
    }

    // Data Retrieval
    getActivePromotes() {
        return readJson(activePromotesPath, {});
    }

    getUserPromotes(userId) {
        const activePromotes = this.getActivePromotes();
        return Object.values(activePromotes).filter(promote => promote.userId === userId);
    }

    getUserPromoteHistory(userId) {
        const logs = readJson(promoteLogsPath, []);
        return logs.filter(log => 
            (log.type === 'PROMOTION_APPLIED' || log.type === 'PROMOTION_ENDED') && 
            log.data.targetUserId === userId
        );
    }

    getPromotionBans() {
        return readJson(promoteBansPath, {});
    }

    isUserBanned(userId, guildId) {
        const promoteBans = this.getPromotionBans();
        const banKey = `${userId}_${guildId}`;
        const banData = promoteBans[banKey];
        
        if (!banData) return false;
        
        // Check if ban is still active
        if (banData.endTime && banData.endTime <= Date.now()) {
            return false;
        }
        
        return true;
    }

    getExpiredPromotes() {
        const activePromotes = this.getActivePromotes();
        const now = Date.now();

        return Object.entries(activePromotes)
            .filter(([_, promote]) => promote.endTime && promote.endTime <= now)
            .map(([promoteId, promote]) => ({ promoteId, ...promote }));
    }

    // Logging
    logAction(type, data) {
        const logs = readJson(promoteLogsPath, []);
        logs.push({
            type,
            data,
            timestamp: Date.now()
        });

        // Keep only last 1000 logs
        if (logs.length > 1000) {
            logs.splice(0, logs.length - 1000);
        }

        writeJson(promoteLogsPath, logs);
    }

    async sendLogMessage(guild, client, type, data) {
        const settings = this.getSettings();
        if (!settings.logChannel) return;

        try {
            const channel = await guild.channels.fetch(settings.logChannel);
            if (!channel) return;

            const embed = this.createLogEmbed(type, data);
            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending log message:', error);
        }
    }

    createLogEmbed(type, data) {
        const embed = colorManager.createEmbed()
            .setTimestamp();

        // إضافة أفتار البوت إذا كان متاحاً
        if (this.client && this.client.user) {
            embed.setThumbnail(this.client.user.displayAvatarURL({ dynamic: true, size: 256 }));
        }

        switch (type) {
            case 'PROMOTION_APPLIED':
                embed.setTitle('**تم تطبيق ترقية**')
                    .setDescription(`تم إضافة رول لـ: <@${data.targetUser.id}>`)
                    .addFields([
                        { name: '**العضو**', value: `<@${data.targetUser.id}>`, inline: true },
                        { name: '**الرول**', value: `${data.role}`, inline: true },
                        { name: '**المدة**', value: data.duration, inline: true },
                        { name: '**السبب**', value: data.reason, inline: false },
                        { name: '**بواسطة**', value: `<@${data.byUser.id}>`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);

                // إضافة إحصائيات التفاعل إذا كانت متاحة
                if (data.userStats) {
                    const voiceTimeHours = Math.round(data.userStats.totalVoiceTime / 3600000);
                    embed.addFields([
                        { name: '**إحصائيات العضو**', value: 
                            `الوقت الصوتي: ${voiceTimeHours} ساعة\n` +
                            `الرسائل: ${data.userStats.totalMessages}\n` +
                            `التفاعلات: ${data.userStats.totalReactions}\n` +
                            `الأيام النشطة: ${data.userStats.activeDays}`, 
                            inline: false 
                        }
                    ]);
                }
                break;

            case 'PROMOTION_ENDED':
                embed.setTitle('**تم إنهاء ترقية**')
                    .addFields([
                        { name: '**العضو**', value: `${data.targetUser}`, inline: true },
                        { name: '**الرول**', value: `${data.role}`, inline: true },
                        { name: '**المدة الأصلية**', value: data.duration, inline: true },
                        { name: '**السبب الأصلي**', value: data.originalReason, inline: false },
                        { name: '**سبب الإنهاء**', value: data.reason, inline: false },
                        { name: '**الترقية كانت بواسطة**', value: `${data.byUser}`, inline: true },
                        { name: '**تاريخ الإنهاء**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;

            case 'PROMOTION_MODIFIED':
                embed.setTitle('**تم تعديل مدة الترقية**')
                    .addFields([
                        { name: '**العضو**', value: `${data.targetUser}`, inline: true },
                        { name: '**الرول**', value: `${data.role}`, inline: true },
                        { name: '**المدة القديمة**', value: data.oldDuration, inline: true },
                        { name: '**المدة الجديدة**', value: data.newDuration, inline: true },
                        { name: '**تم التعديل بواسطة**', value: `${data.modifiedBy}`, inline: true },
                        { name: '**وقت التعديل**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;

            case 'PROMOTION_BAN_ADDED':
                embed.setTitle('**تم حظر عضو من الترقيات**')
                    .addFields([
                        { name: '**العضو**', value: `${data.targetUser}`, inline: true },
                        { name: '**المدة**', value: data.duration, inline: true },
                        { name: '**السبب**', value: data.reason, inline: false },
                        { name: '**بواسطة**', value: `${data.byUser}`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;

            case 'PROMOTION_BAN_REMOVED':
                embed.setTitle('**تم إلغاء حظر عضو من الترقيات**')
                    .addFields([
                        { name: '**العضو**', value: `${data.targetUser}`, inline: true },
                        { name: '**السبب**', value: data.reason, inline: false },
                        { name: '**بواسطة**', value: `${data.byUser}`, inline: true },
                        { name: '**التاريخ**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;
        }

        return embed;
    }

    // Auto expiration checker with notification
    startExpirationChecker(client) {
        this.client = client; // Store client reference
        setInterval(async () => {
            try {
                const expiredPromotes = this.getExpiredPromotes();
                for (const expiredPromote of expiredPromotes) {
                    await this.processExpiredPromotion(expiredPromote);
                }
            } catch (error) {
                console.error('Error in promotion expiration checker:', error);
            }
        }, 60000); // Check every minute
    }

    // Process expired promotion with notification and role removal
    async processExpiredPromotion(expiredPromote) {
        try {
            if (!this.client) return;

            const guild = await this.client.guilds.fetch(expiredPromote.guildId).catch(() => null);
            if (!guild) return;

            const member = await guild.members.fetch(expiredPromote.userId).catch(() => null);
            const role = await guild.roles.fetch(expiredPromote.roleId).catch(() => null);

            // التعامل مع العضو غير الموجود في السيرفر
            if (!member) {
                await this.handleExpiredPromotionForLeftMember(expiredPromote, guild, role);
                this.removeActivePromotion(expiredPromote.id);
                return;
            }

            if (!role) {
                this.removeActivePromotion(expiredPromote.id);
                return;
            }

            // إضافة الرول لقائمة التجاهل قبل سحبه تلقائياً
            this.addToAutoPromoteIgnore(member.id, role.id);

            // تسجيل أن البوت سيقوم بسحب الرول (لمنع تداخل نظام الحماية)
            const removalKey = `${member.guild.id}_${member.id}_${role.id}`;
            this.botPromotionTracking.add(removalKey);

            // إزالة المفتاح بعد 10 ثوانٍ
            setTimeout(() => {
                this.botPromotionTracking.delete(removalKey);
            }, 10000);

            // Remove the temporary role
            await member.roles.remove(role, 'انتهاء مدة الترقية المؤقتة');

            // Notify the user via DM
            try {
                const dmEmbed = colorManager.createEmbed()
                    .setTitle('**انتهت مدة الترقية**')
                    .setDescription(`انتهت مدة ترقيتك في خادم **${guild.name}**`)
                    .addFields([
                        { name: '**الرول المُزال**', value: `${role.name}`, inline: true },
                        { name: '**وقت الانتهاء**', value: `<t:${this.formatTimestamp(Date.now()).unix}:f>`, inline: true },
                        { name: '**السبب الأصلي**', value: expiredPromote.reason || 'غير محدد', inline: false }
                    ])
                    .setThumbnail(member.displayAvatarURL({ dynamic: true }));

                await member.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`لا يمكن إرسال رسالة خاصة إلى ${member.displayName}`);
            }

            // Log the removal
            const settings = this.getSettings();
            if (settings.logChannel && this.client) {
                const logChannel = await this.client.channels.fetch(settings.logChannel).catch(() => null);
                if (logChannel) {
                    const logEmbed = colorManager.createEmbed()
                        .setTitle('**انتهت مدة الترقية - تم الإزالة التلقائية**')
                        .setDescription(`تم سحب الرول تلقائياً بعد انتهاء المدة المحددة`)
                        .addFields([
                            { name: '**العضو**', value: `<@${member.id}>`, inline: true },
                            { name: '**الرول المُزال**', value: `<@&${role.id}>`, inline: true },
                            { name: '**وقت الإزالة**', value: `<t:${this.formatTimestamp(Date.now()).unix}:f>`, inline: true },
                            { name: '**السبب الأصلي**', value: expiredPromote.reason || 'غير محدد', inline: false },
                            { name: '**كانت الترقية بواسطة**', value: `<@${expiredPromote.byUserId || 'غير معروف'}>`, inline: true },
                            { name: '**نوع الإجراء**', value: 'إزالة تلقائية', inline: true }
                        ])
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            // Remove from active promotes
            this.removeActivePromotion(expiredPromote.id);

        } catch (error) {
            console.error('Error processing expired promotion:', error);
        }
    }

    // Utility functions
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const unix = Math.floor(timestamp / 1000);
        return {
            date: date.toLocaleString('ar-SA'),
            unix: unix
        };
    }

    addToAutoPromoteIgnore(userId, roleId) {
        const key = `${userId}_${roleId}`;
        this.autoPromoteIgnoreList.set(key, Date.now());
        
        // إزالة من القائمة بعد 30 ثانية
        setTimeout(() => {
            this.autoPromoteIgnoreList.delete(key);
        }, 30000);
    }

    // Display functions for commands
    createActivePromotesEmbed(activePromotes) {
        const embed = colorManager.createEmbed()
            .setTitle('**الترقيات النشطة**')
            .setTimestamp();

        if (Object.keys(activePromotes).length === 0) {
            embed.setDescription('لا توجد ترقيات نشطة حالياً');
            return embed;
        }

        const promotes = Object.values(activePromotes);
        const totalPromotes = promotes.length;
        const temporaryPromotes = promotes.filter(p => p.endTime).length;
        const permanentPromotes = promotes.filter(p => !p.endTime).length;

        embed.setDescription(`**إجمالي الترقيات النشطة:** ${totalPromotes}\n**مؤقتة:** ${temporaryPromotes} | **دائمة:** ${permanentPromotes}`);

        // Display first 10 promotes
        for (let i = 0; i < Math.min(promotes.length, 10); i++) {
            const promote = promotes[i];
            const endTimeText = promote.endTime ? 
                `<t:${Math.floor(promote.endTime / 1000)}:R>` : 
                'دائمة';

            embed.addFields([{
                name: `**ترقية ${i + 1}**`,
                value: `**العضو:** <@${promote.userId}>\n**الرول:** <@&${promote.roleId}>\n**تنتهي:** ${endTimeText}\n**السبب:** ${promote.reason}`,
                inline: true
            }]);
        }

        if (promotes.length > 10) {
            embed.addFields([{
                name: '**ملاحظة**',
                value: `يتم عرض أول 10 ترقيات فقط من أصل ${promotes.length}`,
                inline: false
            }]);
        }

        return embed;
    }

    createSettingsEmbed() {
        const settings = this.getSettings();
        const embed = colorManager.createEmbed()
            .setTitle('**إعدادات نظام الترقيات**')
            .setTimestamp();

        // إضافة أفتار البوت
        if (this.client && this.client.user) {
            embed.setThumbnail(this.client.user.displayAvatarURL({ dynamic: true, size: 256 }));
        }

        embed.addFields([
            { 
                name: '**قناة القائمة**', 
                value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', 
                inline: true 
            },
            { 
                name: '**قناة السجلات**', 
                value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', 
                inline: true 
            },
            { 
                name: '**نوع الصلاحية**', 
                value: settings.allowedUsers.type || 'غير محدد', 
                inline: true 
            }
        ]);

        let allowedText = 'غير محدد';
        if (settings.allowedUsers.type === 'roles' && settings.allowedUsers.targets.length > 0) {
            allowedText = settings.allowedUsers.targets.map(roleId => `<@&${roleId}>`).join('\n');
        } else if (settings.allowedUsers.type === 'responsibility' && settings.allowedUsers.targets.length > 0) {
            allowedText = settings.allowedUsers.targets.join('\n');
        } else if (settings.allowedUsers.type === 'owners') {
            allowedText = 'مالكي البوت فقط';
        }

        embed.addFields([
            { 
                name: '**المصرح لهم**', 
                value: allowedText, 
                inline: false 
            }
        ]);

        return embed;
    }

    // Remove active promotion from storage
    removeActivePromotion(promoteId) {
        try {
            const activePromotes = this.getActivePromotes();
            if (activePromotes[promoteId]) {
                delete activePromotes[promoteId];
                writeJson(activePromotesPath, activePromotes);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error removing active promotion:', error);
            return false;
        }
    }

    // فحص إذا كان البوت في عملية ترقية (لمنع التداخل)
    isBotPromoting(guildId, userId, roleId) {
        const promotionKey = `${guildId}_${userId}_${roleId}`;
        return this.botPromotionTracking.has(promotionKey);
    }

    // Start maintenance tasks
    startMaintenanceTasks() {
        // تنظيف قائمة التجاهل كل 5 دقائق
        setInterval(() => {
            const now = Date.now();
            for (const [key, timestamp] of this.autoPromoteIgnoreList.entries()) {
                if (now - timestamp > 60000) { // 1 minute
                    this.autoPromoteIgnoreList.delete(key);
                }
            }
        }, 300000); // 5 minutes
    }

    // Member leave/join handlers for promotions
    async handleMemberLeave(member) {
        try {
            const activePromotes = readJson(activePromotesPath, {});
            const leftMembersPromotes = readJson(leftMembersPromotesPath, {});
            const userPromotes = [];

            // البحث عن الترقيات النشطة للعضو
            for (const [promoteId, promoteData] of Object.entries(activePromotes)) {
                if (promoteData.userId === member.id && promoteData.guildId === member.guild.id) {
                    userPromotes.push({ promoteId, ...promoteData });
                }
            }

            if (userPromotes.length > 0) {
                // حفظ بيانات العضو المنسحب
                const memberKey = `${member.id}_${member.guild.id}`;
                leftMembersPromotes[memberKey] = {
                    userId: member.id,
                    guildId: member.guild.id,
                    username: member.user.username,
                    displayName: member.displayName,
                    leftAt: Date.now(),
                    promotes: userPromotes
                };

                writeJson(leftMembersPromotesPath, leftMembersPromotes);

                // تسجيل انسحاب
                const settings = this.getSettings();
                if (settings.logChannel) {
                    try {
                        const logChannel = await member.guild.channels.fetch(settings.logChannel);
                        if (logChannel) {
                            const embed = colorManager.createEmbed()
                                .setTitle('**عضو عليه ترقية قد انسحب**')
                                .setDescription(`قام عضو عليه ترقية بالانسحاب - تم حفظ بياناته للحماية`)
                                .addFields([
                                    { name: '**العضو**', value: `<@${member.id}>`, inline: true },
                                    { name: '**وقت الانسحاب**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                                    { name: '**عدد الترقيات**', value: userPromotes.length.toString(), inline: true }
                                ])
                                .setColor('#ff9500')
                                .setTimestamp();

                            // إضافة تفاصيل الترقيات
                            let promotesList = '';
                            for (let i = 0; i < Math.min(userPromotes.length, 5); i++) {
                                const promoteData = userPromotes[i];
                                const role = await member.guild.roles.fetch(promoteData.roleId).catch(() => null);
                                const roleName = role ? role.name : `Role ID: ${promoteData.roleId}`;
                                const endTime = promoteData.endTime ? `<t:${Math.floor(promoteData.endTime / 1000)}:R>` : 'نهائي';
                                promotesList += `• **${roleName}** - ينتهي: ${endTime}\n`;
                            }

                            if (userPromotes.length > 5) {
                                promotesList += `• **+${userPromotes.length - 5} ترقية إضافية**\n`;
                            }

                            embed.addFields([{ name: '**الترقيات المحفوظة**', value: promotesList || 'لا توجد', inline: false }]);

                            await logChannel.send({ embeds: [embed] });
                        }
                    } catch (error) {
                        console.error('خطأ في إرسال لوق الانسحاب:', error);
                    }
                }

                console.log(`تم حفظ ${userPromotes.length} ترقية للعضو المنسحب: ${member.displayName}`);
            }

        } catch (error) {
            console.error('خطأ في معالجة انسحاب العضو:', error);
        }
    }

    async handleMemberJoin(member) {
        try {
            const leftMembersPromotes = readJson(leftMembersPromotesPath, {});
            const memberKey = `${member.id}_${member.guild.id}`;
            const memberData = leftMembersPromotes[memberKey];

            if (memberData && memberData.promotes && memberData.promotes.length > 0) {
                const activePromotes = readJson(activePromotesPath, {});
                let restoredPromotes = 0;
                const failedPromotes = [];

                for (const promoteData of memberData.promotes) {
                    try {
                        // فحص إذا كانت الترقية منتهية الصلاحية
                        if (promoteData.endTime && promoteData.endTime <= Date.now()) {
                            failedPromotes.push({
                                reason: 'انتهت المدة أثناء الغياب',
                                roleId: promoteData.roleId
                            });
                            continue;
                        }

                        // التحقق من وجود الرول
                        const role = await member.guild.roles.fetch(promoteData.roleId).catch(() => null);
                        if (!role) {
                            failedPromotes.push({
                                reason: 'الرول غير موجود',
                                roleId: promoteData.roleId
                            });
                            continue;
                        }

                        // التحقق من أن العضو لا يملك الرول
                        if (!member.roles.cache.has(promoteData.roleId)) {
                            // إضافة الرول مرة أخرى
                            await member.roles.add(promoteData.roleId, `إعادة تطبيق ترقية بعد العودة: ${promoteData.reason}`);
                        }

                        // إعادة إضافة الترقية للقائمة النشطة
                        const newPromoteId = `${member.id}_${promoteData.roleId}_${Date.now()}`;
                        const restoredPromote = {
                            ...promoteData,
                            id: newPromoteId,
                            restoredAfterLeave: true,
                            restoredAt: Date.now(),
                            originalLeftAt: memberData.leftAt
                        };

                        activePromotes[newPromoteId] = restoredPromote;
                        restoredPromotes++;

                    } catch (error) {
                        console.error(`خطأ في إعادة تطبيق ترقية:`, error);
                        failedPromotes.push({
                            reason: error.message || 'خطأ غير معروف',
                            roleId: promoteData.roleId
                        });
                    }
                }

                // حفظ التغييرات
                if (restoredPromotes > 0) {
                    writeJson(activePromotesPath, activePromotes);
                }

                // حذف بيانات العضو المنسحب
                delete leftMembersPromotes[memberKey];
                writeJson(leftMembersPromotesPath, leftMembersPromotes);

                // تسجيل العودة
                const settings = this.getSettings();
                if (settings.logChannel) {
                    try {
                        const logChannel = await member.guild.channels.fetch(settings.logChannel);
                        if (logChannel) {
                            const embed = colorManager.createEmbed()
                                .setTitle('**عاد عضو عليه ترقية**')
                                .setDescription(`عاد عضو عليه ترقية وتم إعادة تطبيق الترقيات`)
                                .addFields([
                                    { name: '**العضو**', value: `<@${member.id}>`, inline: true },
                                    { name: '**وقت العودة**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                                    { name: '**تم استعادتها**', value: restoredPromotes.toString(), inline: true }
                                ])
                                .setColor('#00ff00')
                                .setTimestamp();

                            if (failedPromotes.length > 0) {
                                embed.addFields([{ 
                                    name: '**فشل في استعادتها**', 
                                    value: failedPromotes.length.toString(), 
                                    inline: true 
                                }]);
                            }

                            const timeSinceLeft = Date.now() - memberData.leftAt;
                            const timeLeftText = timeSinceLeft > 3600000 ? 
                                `${Math.floor(timeSinceLeft / 3600000)} ساعة` : 
                                `${Math.floor(timeSinceLeft / 60000)} دقيقة`;

                            embed.addFields([{ 
                                name: '**فترة الغياب**', 
                                value: timeLeftText, 
                                inline: true 
                            }]);

                            await logChannel.send({ embeds: [embed] });
                        }
                    } catch (error) {
                        console.error('خطأ في إرسال لوق العودة:', error);
                    }
                }

                console.log(`تم إعادة تطبيق ${restoredPromotes} ترقية للعضو العائد: ${member.displayName}`);
            }

        } catch (error) {
            console.error('خطأ في معالجة عودة العضو:', error);
        }
    }

    // معالجة انتهاء الترقية لعضو خارج السيرفر
    async handleExpiredPromotionForLeftMember(expiredPromote, guild, role) {
        try {
            const settings = this.getSettings();
            if (!settings.logChannel) return;

            const logChannel = await guild.channels.fetch(settings.logChannel).catch(() => null);
            if (!logChannel) return;

            // إنشاء embed للعضو الخارج
            const embed = colorManager.createEmbed()
                .setTitle('**انتهت مدة الترقية - عضو خارج السيرفر**')
                .setDescription(`انتهت مدة الترقية لعضو غير موجود في السيرفر`)
                .addFields([
                    { name: '**العضو**', value: `<@${expiredPromote.userId}>`, inline: true },
                    { name: '**الحالة**', value: 'خارج السيرفر', inline: true },
                    { name: '**وقت الانتهاء**', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                ])
                .setColor('#ffa500')
                .setTimestamp();

            if (role) {
                embed.addFields([
                    { name: '**الرول المنتهي**', value: `<@&${role.id}>`, inline: true },
                    { name: '**السبب الأصلي**', value: expiredPromote.reason || 'غير محدد', inline: false }
                ]);
            } else {
                embed.addFields([
                    { name: '**الرول المنتهي**', value: `Role ID: ${expiredPromote.roleId}`, inline: true },
                    { name: '**السبب الأصلي**', value: expiredPromote.reason || 'غير محدد', inline: false }
                ]);
            }

            // إضافة معلومات إضافية
            const byUser = await this.client.users.fetch(expiredPromote.byUserId).catch(() => null);
            if (byUser) {
                embed.addFields([{ name: '**تم تطبيقها بواسطة**', value: `<@${byUser.id}>`, inline: true }]);
            }

            const startTime = expiredPromote.startTime || Date.now();
            embed.addFields([{ name: '**تاريخ التطبيق**', value: `<t:${Math.floor(startTime / 1000)}:F>`, inline: true }]);

            // إضافة ملاحظة هامة
            embed.addFields([{ 
                name: '**ملاحظة هامة**', 
                value: 'إذا عاد هذا العضو للسيرفر، لن تعود الترقية تلقائياً', 
                inline: false 
            }]);

            await logChannel.send({ embeds: [embed] });

            console.log(`انتهت مدة ترقية لعضو خارج السيرفر: ${expiredPromote.userId}`);

        } catch (error) {
            console.error('خطأ في معالجة انتهاء ترقية عضو خارج:', error);
        }
    }
}

module.exports = new PromoteManager();