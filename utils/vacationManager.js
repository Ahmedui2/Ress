const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('./colorManager');

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');

// --- Helper Functions ---
function readJson(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultData;
}

function saveVacations(data) {
    try {
        fs.writeFileSync(vacationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing vacations.json:', error);
        return false;
    }
}

// --- Public Functions ---

function getSettings() {
    const vacations = readJson(vacationsPath, { settings: {} });
    return vacations.settings;
}

function isUserOnVacation(userId) {
    const vacations = readJson(vacationsPath);
    return !!vacations.active?.[userId];
}

async function approveVacation(client, userId, approverId) {
    const vacations = readJson(vacationsPath);
    const request = vacations.pending?.[userId];

    if (!request) {
        return { success: false, message: 'No pending vacation request found for this user.' };
    }

    const guild = client.guilds.cache.first();
    if (!guild) return { success: false, message: 'Bot is not in a guild.' };

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { success: false, message: 'User not found in the guild.' };

    // --- Role Management ---
    const adminRoles = readJson(adminRolesPath, []);
    const rolesToRemove = member.roles.cache.filter(role => adminRoles.includes(role.id));
    const removedRoleIds = rolesToRemove.map(role => role.id);

    try {
        await member.roles.remove(rolesToRemove);
    } catch (error) {
        console.error(`Failed to remove roles from ${member.user.tag}:`, error);
        return { success: false, message: 'Failed to remove user roles. Check bot permissions.' };
    }

    // --- Update Vacation Data ---
    const activeVacation = {
        ...request,
        status: 'active',
        approvedBy: approverId,
        approvedAt: new Date().toISOString(),
        removedRoles: removedRoleIds // Store the roles that were removed
    };

    vacations.active[userId] = activeVacation;
    delete vacations.pending[userId];
    saveVacations(vacations);

    return { success: true, vacation: activeVacation };
}

async function endVacation(client, userId, reason = 'Vacation period has ended.') {
    const vacations = readJson(vacationsPath);
    const vacation = vacations.active?.[userId];

    if (!vacation) {
        return { success: false, message: 'No active vacation found for this user.' };
    }

    const guild = client.guilds.cache.first();
    if (!guild) return { success: false, message: 'Bot is not in a guild.' };

    const member = await guild.members.fetch(userId).catch(() => null);

    // --- Role Management ---
    if (member && vacation.removedRoles && vacation.removedRoles.length > 0) {
        try {
            await member.roles.add(vacation.removedRoles);
        } catch (error) {
            console.error(`Failed to re-add roles to ${member.user.tag}:`, error);
            // Don't stop the process, but log the error. Maybe DM the user/owner.
        }
    }

    // --- Update Vacation Data ---
    delete vacations.active[userId];
    saveVacations(vacations);

    // --- Send DM Notification ---
    try {
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setTitle('Vacation Ended')
            .setColor(colorManager.getColor('ended') || '#FFA500')
            .setDescription(`Your vacation has ended. Welcome back!`)
            .addFields(
                { name: 'Reason for Ending', value: reason },
                { name: 'Roles Restored', value: vacation.removedRoles.map(id => `<@&${id}>`).join(', ') || 'None' }
            )
            .setTimestamp();
        await user.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Failed to send vacation end DM to ${userId}:`, error);
    }

    return { success: true, vacation };
}


async function checkVacations(client) {
    const vacations = readJson(vacationsPath);
    if (!vacations.active) return;

    const now = Date.now();
    let endedCount = 0;

    for (const userId in vacations.active) {
        const vacation = vacations.active[userId];
        const endDate = new Date(vacation.endDate).getTime();

        if (now >= endDate) {
            console.log(`Vacation for user ${userId} has expired. Ending it now.`);
            await endVacation(client, userId);
            endedCount++;
        }
    }
    if (endedCount > 0) {
        console.log(`Ended ${endedCount} expired vacation(s).`);
    }
}


const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

async function getApprovers(guild, settings, botOwners) {
    const approverIds = new Set();
    if (settings.approverType === 'owners') {
        botOwners.forEach(id => approverIds.add(id));
    } else if (settings.approverType === 'role') {
        for (const roleId of settings.approverTargets) {
            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (role) {
                role.members.forEach(m => approverIds.add(m.id));
            }
        }
    } else if (settings.approverType === 'responsibility') {
        const responsibilities = readJson(responsibilitiesPath);
        for (const respName of settings.approverTargets) {
            const respData = responsibilities[respName];
            if (respData && respData.responsibles) {
                respData.responsibles.forEach(id => approverIds.add(id));
            }
        }
    }

    // Fetch user objects from IDs
    const approvers = [];
    for (const id of approverIds) {
        const user = await guild.client.users.fetch(id).catch(() => null);
        if (user) approvers.push(user);
    }
    return approvers;
}

module.exports = {
    getSettings,
    isUserOnVacation,
    approveVacation,
    endVacation,
    checkVacations,
    getApprovers,
    saveVacations, // Export for use in other commands if needed
    readJson // More generic name
};
