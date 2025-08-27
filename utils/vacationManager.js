const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('./colorManager'); // Assuming you have a color manager

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');

// Helper function to read the vacations file
function readVacations() {
    try {
        if (fs.existsSync(vacationsPath)) {
            const data = fs.readFileSync(vacationsPath, 'utf8');
            // Ensure the structure is valid
            const parsed = JSON.parse(data);
            return {
                settings: parsed.settings || {},
                pending: parsed.pending || {},
                active: parsed.active || {},
            };
        }
        return { settings: {}, pending: {}, active: {} };
    } catch (error) {
        console.error('Error reading vacations.json:', error);
        return { settings: {}, pending: {}, active: {} };
    }
}

// Helper function to write to the vacations file
function writeVacations(data) {
    try {
        fs.writeFileSync(vacationsPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing to vacations.json:', error);
    }
}

// Check if a user is currently on an active vacation
function isUserOnVacation(userId) {
    const vacations = readVacations();
    return !!vacations.active[userId];
}

// Get all pending vacation requests
function getPendingVacations() {
    const vacations = readVacations();
    return vacations.pending;
}

// Get all active vacations
function getActiveVacations() {
    const vacations = readVacations();
    return vacations.active;
}


// Approve a pending vacation request
function approveVacation(userId, approverId) {
    const vacations = readVacations();
    const request = vacations.pending[userId];

    if (!request) {
        return { success: false, message: 'No pending vacation request found for this user.' };
    }

    // Move from pending to active
    vacations.active[userId] = {
        ...request,
        status: 'active',
        approvedBy: approverId,
        approvedAt: new Date().toISOString(),
    };
    delete vacations.pending[userId];

    writeVacations(vacations);
    return { success: true, vacation: vacations.active[userId] };
}

// Reject a pending vacation request
function rejectVacation(userId, rejecterId, reason = 'No reason provided.') {
    const vacations = readVacations();
    const request = vacations.pending[userId];

    if (!request) {
        return { success: false, message: 'No pending vacation request found for this user.' };
    }

    // Just remove it from pending
    delete vacations.pending[userId];
    writeVacations(vacations);

    // Return the rejected request details for notification purposes
    return { success: true, vacation: { ...request, rejectedBy: rejecterId, reason } };
}

// End an active vacation (either manually or automatically)
async function endVacation(client, userId, reason = 'Vacation period has ended.') {
    const vacations = readVacations();
    const vacation = vacations.active[userId];

    if (!vacation) {
        return { success: false, message: 'No active vacation found for this user.' };
    }

    // Remove from active
    delete vacations.active[userId];
    writeVacations(vacations);

    // Send DM notification to the user
    try {
        const user = await client.users.fetch(userId);
        const embed = new EmbedBuilder()
            .setTitle('Vacation Ended')
            .setColor(colorManager.getColor('ended') || '#FFA500') // Orange for ended
            .setDescription(`Your vacation has ended. Welcome back!`)
            .addFields(
                { name: 'Reason for Ending', value: reason },
                { name: 'Original Start Date', value: new Date(vacation.startDate).toLocaleDateString() },
                { name: 'Original End Date', value: new Date(vacation.endDate).toLocaleDateString() }
            )
            .setTimestamp();
        await user.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Failed to send vacation end DM to ${userId}:`, error);
    }

    return { success: true, vacation };
}

// Periodically check for vacations that should end
async function checkVacations(client) {
    console.log('Checking for expired vacations...');
    const vacations = readVacations();
    const now = new Date();
    let endedCount = 0;

    for (const userId in vacations.active) {
        const vacation = vacations.active[userId];
        const endDate = new Date(vacation.endDate);

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


module.exports = {
    isUserOnVacation,
    getPendingVacations,
    getActiveVacations,
    approveVacation,
    rejectVacation,
    endVacation,
    checkVacations,
    readVacations,
    writeVacations,
};
