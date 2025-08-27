const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');

const name = 'set-vacation-role';
const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');

function readVacations() {
    try {
        if (fs.existsSync(vacationsPath)) {
            const data = fs.readFileSync(vacationsPath, 'utf8');
            return JSON.parse(data);
        }
        return { settings: {}, pending: {}, active: {} };
    } catch (error) {
        console.error('Error reading vacations.json:', error);
        return { settings: {}, pending: {}, active: {} };
    }
}

function saveVacations(data) {
    try {
        fs.writeFileSync(vacationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving vacations.json:', error);
        return false;
    }
}

async function execute(message, args, { BOT_OWNERS }) {
    // Owner only command
    if (!BOT_OWNERS.includes(message.author.id)) {
        return message.react('❌');
    }

    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);

    if (!role) {
        const usageEmbed = new EmbedBuilder()
            .setTitle('Set Vacation Approver Role')
            .setDescription('**Usage:** `set-vacation-role @role`')
            .setColor(colorManager.getColor());
        return message.channel.send({ embeds: [usageEmbed] });
    }

    const vacations = readVacations();

    // For Phase 1, we will set the role as the sole approver.
    // In Phase 2, this command will be replaced by the more complex `set-vacation` command.
    vacations.settings = {
        approverType: 'role',
        approverTarget: role.id,
        notificationType: 'dm', // Defaulting to DM for now
        notificationChannel: null
    };

    const success = saveVacations(vacations);

    if (success) {
        const successEmbed = new EmbedBuilder()
            .setTitle('Settings Updated')
            .setDescription(`✅ تم تحديد رتبة ${role} كمسؤولة عن الموافقة على الإجازات.`)
            .setColor(colorManager.getColor());
        await message.channel.send({ embeds: [successEmbed] });
    } else {
        const errorEmbed = new EmbedBuilder()
            .setTitle('Error')
            .setDescription('❌ حدث خطأ أثناء حفظ الإعدادات.')
            .setColor('#FF0000');
        await message.channel.send({ embeds: [errorEmbed] });
    }
}

module.exports = {
    name,
    execute
};
