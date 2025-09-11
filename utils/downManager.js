const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('./colorManager');
const ms = require('ms');

// File paths
const downSettingsPath = path.join(__dirname, '..', 'data', 'downSettings.json');
const activeDownsPath = path.join(__dirname, '..', 'data', 'activeDowns.json');
const downLogsPath = path.join(__dirname, '..', 'data', 'downLogs.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

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

function writeJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

class DownManager {
    constructor() {
        this.ensureDataFiles();
        this.startExpirationChecker();
    }

    ensureDataFiles() {
        // Create default settings file
        if (!fs.existsSync(downSettingsPath)) {
            const defaultSettings = {
                menuChannel: null,
                logChannel: null,
                allowedUsers: {
                    type: null, // 'owners', 'roles', 'responsibility'
                    targets: []
                }
            };
            writeJson(downSettingsPath, defaultSettings);
        }

        // Create active downs file
        if (!fs.existsSync(activeDownsPath)) {
            writeJson(activeDownsPath, {});
        }

        // Create logs file
        if (!fs.existsSync(downLogsPath)) {
            writeJson(downLogsPath, []);
        }
    }

    // Settings Management
    getSettings() {
        return readJson(downSettingsPath, {
            menuChannel: null,
            logChannel: null,
            allowedUsers: {
                type: null,
                targets: []
            }
        });
    }

    updateSettings(newSettings) {
        return writeJson(downSettingsPath, newSettings);
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

    // Down Operations
    async createDown(guild, client, targetUserId, roleId, duration, reason, byUserId) {
        try {
            // Validate admin role
            if (!this.isAdminRole(roleId)) {
                return { success: false, error: 'الرول المحدد ليس من الرولات الإدارية' };
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

            // Check if member has the role
            if (!targetMember.roles.cache.has(roleId)) {
                return { success: false, error: 'العضو لا يملك هذا الرول' };
            }

            // Remove the role
            await targetMember.roles.remove(roleId);

            // Calculate end time
            let endTime = null;
            if (duration && duration !== 'permanent') {
                const durationMs = ms(duration);
                if (!durationMs) {
                    return { success: false, error: 'صيغة المدة غير صحيحة' };
                }
                endTime = Date.now() + durationMs;
            }

            // Create down record
            const downId = `${targetUserId}_${roleId}_${Date.now()}`;
            const downRecord = {
                id: downId,
                userId: targetUserId,
                roleId: roleId,
                reason: reason,
                byUserId: byUserId,
                startTime: Date.now(),
                endTime: endTime,
                duration: duration,
                status: 'active'
            };

            // Save to active downs
            const activeDowns = readJson(activeDownsPath, {});
            activeDowns[downId] = downRecord;
            writeJson(activeDownsPath, activeDowns);

            // Log the action
            this.logAction('DOWN_APPLIED', {
                targetUserId,
                roleId,
                duration,
                reason,
                byUserId,
                timestamp: Date.now()
            });

            // Send log message
            await this.sendLogMessage(guild, client, 'DOWN_APPLIED', {
                targetUser: targetMember.user,
                role: role,
                duration: duration || 'نهائي',
                reason,
                byUser: await client.users.fetch(byUserId)
            });

            return { success: true, downId };

        } catch (error) {
            console.error('Error creating down:', error);
            return { success: false, error: 'حدث خطأ أثناء تطبيق الداون' };
        }
    }

    async endDown(guild, client, downId, reason = 'انتهاء المدة المحددة') {
        try {
            const activeDowns = readJson(activeDownsPath, {});
            const downRecord = activeDowns[downId];

            if (!downRecord) {
                return { success: false, error: 'الداون غير موجود' };
            }

            // Get member and role
            const member = await guild.members.fetch(downRecord.userId);
            const role = await guild.roles.fetch(downRecord.roleId);

            if (member && role) {
                // Add role back
                await member.roles.add(downRecord.roleId);

                // Send log message
                await this.sendLogMessage(guild, client, 'DOWN_ENDED', {
                    targetUser: member.user,
                    role: role,
                    reason,
                    originalReason: downRecord.reason,
                    duration: downRecord.duration || 'نهائي',
                    byUser: await client.users.fetch(downRecord.byUserId)
                });
            }

            // Remove from active downs
            delete activeDowns[downId];
            writeJson(activeDownsPath, activeDowns);

            // Log the action
            this.logAction('DOWN_ENDED', {
                targetUserId: downRecord.userId,
                roleId: downRecord.roleId,
                reason,
                originalReason: downRecord.reason,
                duration: downRecord.duration,
                byUserId: downRecord.byUserId,
                timestamp: Date.now()
            });

            return { success: true };

        } catch (error) {
            console.error('Error ending down:', error);
            return { success: false, error: 'حدث خطأ أثناء إنهاء الداون' };
        }
    }

    async modifyDownDuration(guild, client, downId, newDuration, modifiedBy) {
        try {
            const activeDowns = readJson(activeDownsPath, {});
            const downRecord = activeDowns[downId];

            if (!downRecord) {
                return { success: false, error: 'الداون غير موجود' };
            }

            const oldDuration = downRecord.duration || 'نهائي';

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
            downRecord.duration = newDuration;
            downRecord.endTime = newEndTime;
            downRecord.modifiedBy = modifiedBy;
            downRecord.modifiedAt = Date.now();

            activeDowns[downId] = downRecord;
            writeJson(activeDownsPath, activeDowns);

            // Log the modification
            this.logAction('DOWN_MODIFIED', {
                targetUserId: downRecord.userId,
                roleId: downRecord.roleId,
                oldDuration,
                newDuration,
                modifiedBy,
                timestamp: Date.now()
            });

            // Send log message
            const member = await guild.members.fetch(downRecord.userId);
            const role = await guild.roles.fetch(downRecord.roleId);
            await this.sendLogMessage(guild, client, 'DOWN_MODIFIED', {
                targetUser: member.user,
                role: role,
                oldDuration,
                newDuration: newDuration || 'نهائي',
                modifiedBy: await client.users.fetch(modifiedBy)
            });

            return { success: true };

        } catch (error) {
            console.error('Error modifying down duration:', error);
            return { success: false, error: 'حدث خطأ أثناء تعديل المدة' };
        }
    }

    // Data Retrieval
    getActiveDowns() {
        return readJson(activeDownsPath, {});
    }

    getUserDowns(userId) {
        const activeDowns = this.getActiveDowns();
        return Object.values(activeDowns).filter(down => down.userId === userId);
    }

    getUserDownHistory(userId) {
        const logs = readJson(downLogsPath, []);
        return logs.filter(log => 
            (log.type === 'DOWN_APPLIED' || log.type === 'DOWN_ENDED') && 
            log.data.targetUserId === userId
        );
    }

    getExpiredDowns() {
        const activeDowns = this.getActiveDowns();
        const now = Date.now();
        
        return Object.entries(activeDowns)
            .filter(([_, down]) => down.endTime && down.endTime <= now)
            .map(([downId, down]) => ({ downId, ...down }));
    }

    // Logging
    logAction(type, data) {
        const logs = readJson(downLogsPath, []);
        logs.push({
            type,
            data,
            timestamp: Date.now()
        });

        // Keep only last 1000 logs
        if (logs.length > 1000) {
            logs.splice(0, logs.length - 1000);
        }

        writeJson(downLogsPath, logs);
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
        const embed = new EmbedBuilder()
            .setColor(colorManager.getColor() || '#ff6b6b')
            .setTimestamp();

        switch (type) {
            case 'DOWN_APPLIED':
                embed.setTitle('🔻 تم تطبيق داون')
                    .addFields([
                        { name: 'العضو', value: `${data.targetUser}`, inline: true },
                        { name: 'الرول', value: `${data.role}`, inline: true },
                        { name: 'المدة', value: data.duration, inline: true },
                        { name: 'السبب', value: data.reason, inline: false },
                        { name: 'بواسطة', value: `${data.byUser}`, inline: true },
                        { name: 'التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;

            case 'DOWN_ENDED':
                embed.setTitle('🔺 تم إنهاء داون')
                    .setColor('#00ff00')
                    .addFields([
                        { name: 'العضو', value: `${data.targetUser}`, inline: true },
                        { name: 'الرول', value: `${data.role}`, inline: true },
                        { name: 'المدة الأصلية', value: data.duration, inline: true },
                        { name: 'السبب الأصلي', value: data.originalReason, inline: false },
                        { name: 'سبب الإنهاء', value: data.reason, inline: false },
                        { name: 'الداون كان بواسطة', value: `${data.byUser}`, inline: true },
                        { name: 'تاريخ الإنهاء', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;

            case 'DOWN_MODIFIED':
                embed.setTitle('✏️ تم تعديل مدة الداون')
                    .setColor('#ffaa00')
                    .addFields([
                        { name: 'العضو', value: `${data.targetUser}`, inline: true },
                        { name: 'الرول', value: `${data.role}`, inline: true },
                        { name: 'المدة القديمة', value: data.oldDuration, inline: true },
                        { name: 'المدة الجديدة', value: data.newDuration, inline: true },
                        { name: 'تم التعديل بواسطة', value: `${data.modifiedBy}`, inline: true },
                        { name: 'وقت التعديل', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    ]);
                break;
        }

        return embed;
    }

    // Auto expiration checker
    startExpirationChecker() {
        setInterval(async () => {
            try {
                const expiredDowns = this.getExpiredDowns();
                for (const expiredDown of expiredDowns) {
                    // This will be called from bot.js with proper guild and client
                    console.log(`⏰ داون منتهي الصلاحية: ${expiredDown.downId}`);
                }
            } catch (error) {
                console.error('Error in down expiration checker:', error);
            }
        }, 60000); // Check every minute
    }

    // Menu helpers
    createStatusEmbed() {
        const settings = this.getSettings();
        const activeDowns = Object.keys(this.getActiveDowns()).length;
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ إعدادات نظام الداون')
            .setColor(colorManager.getColor() || '#0099ff')
            .addFields([
                { 
                    name: '📋 روم المنيو', 
                    value: settings.menuChannel ? `<#${settings.menuChannel}>` : 'غير محدد', 
                    inline: true 
                },
                { 
                    name: '📝 روم السجلات', 
                    value: settings.logChannel ? `<#${settings.logChannel}>` : 'غير محدد', 
                    inline: true 
                },
                { 
                    name: '👥 المصرح لهم', 
                    value: settings.allowedUsers.type ? 
                        `${this.getPermissionTypeText(settings.allowedUsers.type)} (${settings.allowedUsers.targets.length})` : 
                        'غير محدد', 
                    inline: true 
                },
                { 
                    name: '📊 الداونات النشطة', 
                    value: `${activeDowns}`, 
                    inline: true 
                }
            ])
            .setTimestamp();

        return embed;
    }

    getPermissionTypeText(type) {
        switch (type) {
            case 'owners': return 'المالكين';
            case 'roles': return 'رولات محددة';
            case 'responsibility': return 'مسؤوليات محددة';
            default: return 'غير محدد';
        }
    }
}

module.exports = new DownManager();