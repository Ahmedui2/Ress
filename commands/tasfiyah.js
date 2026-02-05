const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const { isChannelBlocked } = require('./chatblock.js');
const { getDatabase } = require('../utils/database.js');
const promoteManager = require('../utils/promoteManager');
const moment = require('moment-timezone');

const name = 'تصفيه';

const interactiveRolesPath = path.join(__dirname, '..', 'data', 'interactiveRoles.json');
const adminApplicationsPath = path.join(__dirname, '..', 'data', 'adminApplications.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

function loadSettings() {
    try {
        if (fs.existsSync(interactiveRolesPath)) {
            const data = JSON.parse(fs.readFileSync(interactiveRolesPath, 'utf8'));
            if (!data.settings) {
                data.settings = { approvers: [], interactiveRoles: [], requestChannel: null, exceptions: [] };
            }
            return data;
        }
    } catch (error) {
        console.error('Error loading interactive roles settings:', error);
    }
    return {
        settings: { approvers: [], interactiveRoles: [], requestChannel: null, exceptions: [] },
        pendingRequests: {},
        cooldowns: {},
        exceptionCooldowns: {},
        pendingExceptionRequests: {}
    };
}

function getBotOwners() {
    const botConfigPath = path.join(__dirname, '..', 'data', 'botConfig.json');
    let BOT_OWNERS = global.BOT_OWNERS || [];
    if (BOT_OWNERS.length === 0) {
        try {
            if (fs.existsSync(botConfigPath)) {
                const botConfig = JSON.parse(fs.readFileSync(botConfigPath, 'utf8'));
                BOT_OWNERS = botConfig.owners || [];
            }
        } catch (e) {}
    }
    return BOT_OWNERS;
}

function hasPermission(member, settings) {
    const isGuildOwner = member.guild.ownerId === member.id;
    const BOT_OWNERS = getBotOwners();
    const approverRoles = Array.isArray(settings?.settings?.approvers) ? settings.settings.approvers : [];
    const hasApproverRole = approverRoles.length > 0
        ? member.roles.cache.some((role) => approverRoles.includes(role.id))
        : false;
    return isGuildOwner || BOT_OWNERS.includes(member.id) || hasApproverRole;
}

function loadAdminApplicationSettings() {
    try {
        if (fs.existsSync(adminApplicationsPath)) {
            const data = fs.readFileSync(adminApplicationsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('خطأ في قراءة إعدادات التقديم الإداري:', error);
    }
    return {
        settings: {
            approvers: { type: "roles", list: [] }
        }
    };
}

function canUseAdminFilter(member, settings) {
    const BOT_OWNERS = getBotOwners();
    const isBotOwner = BOT_OWNERS.includes(member.id);
    const isGuildOwner = member.guild.ownerId === member.id;
    if (isBotOwner || isGuildOwner) return true;
    const approvers = settings?.settings?.approvers;
    if (!approvers) return false;

    if (approvers.type === 'owners') {
        return isBotOwner;
    }

    if (approvers.type === 'roles') {
        return member.roles.cache.some(role => approvers.list.includes(role.id));
    }

    if (approvers.type === 'responsibility') {
        try {
            if (fs.existsSync(responsibilitiesPath)) {
                const responsibilitiesData = JSON.parse(fs.readFileSync(responsibilitiesPath, 'utf8'));
                const targetResp = approvers.list[0];
                if (responsibilitiesData[targetResp] && responsibilitiesData[targetResp].responsibles) {
                    return responsibilitiesData[targetResp].responsibles.includes(member.id);
                }
            }
        } catch (error) {
            console.error('خطأ في فحص المسؤوليات:', error);
        }
        return false;
    }

    return false;
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return '0';

    const totalSeconds = Math.floor(milliseconds / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);

    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.length > 0 ? parts.join(' and ') : 'أقل من دقيقة';
}

function getLiveVoiceDuration(userId, fromTimestamp) {
    if (global.client && global.client.voiceSessions && global.client.voiceSessions.has(userId)) {
        const session = global.client.voiceSessions.get(userId);
        if (session && !session.isAFK) {
            const liveStart = session.lastTrackedTime || session.startTime || session.sessionStartTime;
            const effectiveStart = Math.max(liveStart, fromTimestamp || 0);
            return Math.max(0, Date.now() - effectiveStart);
        }
    }
    return 0;
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(mapper));
        results.push(...batchResults);
    }
    return results;
}

function formatEta(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0s';
    const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function buildProgressBar(done, total, size = 12) {
    if (!total) return '⬜'.repeat(size);
    const filled = Math.min(size, Math.max(0, Math.round((done / total) * size)));
    return `${'🟩'.repeat(filled)}${'⬜'.repeat(size - filled)}`;
}

function formatPercent(done, total) {
    if (!total) return '0%';
    return `${Math.min(100, Math.max(0, Math.round((done / total) * 100)))}%`;
}

function chunkLines(lines, maxLength = 3800) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return ['لا يوجد'];
    }
    const chunks = [];
    let current = '';
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > maxLength) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : ['لا يوجد'];
}

function buildDetailEmbeds(title, lines, thumbnail) {
    const chunks = chunkLines(lines);
    return chunks.map((chunk, index) => colorManager.createEmbed()
        .setTitle(chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title)
        .setDescription(chunk || 'لا يوجد')
        .setThumbnail(thumbnail)
        .setTimestamp());
}

function formatFailureReason(error) {
    if (!error) return 'سبب غير معروف.';
    const message = typeof error === 'string' ? error : error.message || 'سبب غير معروف.';
    return message.toString().slice(0, 200);
}

function formatRoleMentions(roleIds, guild) {
    if (!Array.isArray(roleIds) || roleIds.length === 0) {
        return 'لا يوجد';
    }
    return roleIds.map((roleId) => {
        const role = guild.roles.cache.get(roleId);
        return role ? `<@&${roleId}> (${role.name})` : roleId;
    }).join('، ');
}

module.exports = {
    name,
    description: 'تصفية الرولات التفاعلية حسب النشاط الشهري',
    async execute(message, args, { client }) {
        if (isChannelBlocked(message.channel.id)) {
            return;
        }

        if (isUserBlocked(message.author.id)) {
            const blockedEmbed = colorManager.createEmbed()
                .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            await message.channel.send({ embeds: [blockedEmbed] });
            return;
        }

        const isAdminMode = args?.[0]?.toLowerCase() === 'admin';
        if (isAdminMode) {
            const adminSettings = loadAdminApplicationSettings();
            const adminRoles = promoteManager.getAdminRoles()
                .filter((roleId) => message.guild.roles.cache.has(roleId));

            if (!canUseAdminFilter(message.member, adminSettings)) {
                await message.reply('**❌ لا تملك صلاحية لاستخدام تصفية الإدارة.**');
                return;
            }

            if (adminRoles.length === 0) {
                await message.reply('**❌ لا توجد رولات إدارية محددة في Adminroles.**');
                return;
            }

            await startAdminTypeSelection(message, client, adminRoles);
            return;
        }

        const settings = loadSettings();
        if (!hasPermission(message.member, settings)) {
            await message.reply('**❌ لا تملك صلاحية لاستخدام هذا الأمر.**');
            return;
        }
        const interactiveRoleIds = Array.isArray(settings.settings.interactiveRoles)
            ? settings.settings.interactiveRoles.filter((roleId) => message.guild.roles.cache.has(roleId))
            : [];

        if (interactiveRoleIds.length === 0) {
            await message.reply('**❌ لا توجد رولات تفاعلية محددة في setactive.**');
            return;
        }

        await startRoleSelection(message, client, interactiveRoleIds, settings, {
            logChannelId: settings?.settings?.requestChannel,
            resultTitle: 'Active roles',
            dmDetailsText: 'تم تصفيتك وازاله رولك التفاعلي.'
        });
    }
};

async function startAdminTypeSelection(message, client, adminRoleIds) {
    const typeEmbed = colorManager.createEmbed()
        .setTitle('تصفيه الإدارة')
        .setDescription('**اختار نوع الرتب الادارية للتصفية (حرف أو ظواهر).**')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setTimestamp();

    const typeMenu = new StringSelectMenuBuilder()
        .setCustomId('tasfiyah_admin_select_type')
        .setPlaceholder('اختر النوع...')
        .setMinValues(1)
        .setMaxValues(2)
        .addOptions([
            { label: 'رتب الحرف (Rank)', value: 'rank', description: 'التعامل مع رولات (A , B , C ...)' },
            { label: 'رتب ظاهرية (Visual)', value: 'visual', description: 'التعامل مع رولات الأسماء والظواهر' }
        ]);

    const sentMessage = await message.channel.send({
        embeds: [typeEmbed],
        components: [new ActionRowBuilder().addComponents(typeMenu)]
    });

    const filter = (interaction) => interaction.user.id === message.author.id && interaction.message.id === sentMessage.id;
    const collector = sentMessage.createMessageComponentCollector({ filter, time: 5 * 60 * 1000 });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId !== 'tasfiyah_admin_select_type') return;

            const selectedTypes = interaction.values;
            const selectedBothTypes = selectedTypes.includes('rank') && selectedTypes.includes('visual');
            const filteredAdminRoles = adminRoleIds.filter((roleId) => {
                const role = message.guild.roles.cache.get(roleId);
                if (!role) return false;
                if (selectedBothTypes) return true;
                const isRankType = selectedTypes.includes('rank');
                return (role.name.length <= 3) === isRankType;
            });

            if (filteredAdminRoles.length === 0) {
                await interaction.update({
                    content: '**❌ لا توجد رولات إدارية مطابقة لهذا النوع.**',
                    embeds: [],
                    components: []
                });
                collector.stop('empty');
                return;
            }

            collector.stop('selected');
            await interaction.update({ content: '**⏳ انتظر للمعالجة...**', embeds: [], components: [] });
            const promoteSettings = promoteManager.getSettings();

            if (selectedBothTypes) {
                await startMemberSelection(sentMessage, message, client, adminRoleIds, {
                    logChannelId: promoteSettings?.logChannel,
                    logTitle: 'Admin filter log',
                    removeAllAdminRoles: true,
                    allAdminRoleIds: adminRoleIds,
                    resultTitle: 'Admin roles',
                    dmDetailsText: 'تم تصفيتك وازاله رولك الاداري.'
                });
                return;
            }

            await startRoleSelection(message, client, filteredAdminRoles, null, {
                title: 'Admin Roles',
                description: '**اختر الرولات الادارية التي تريد تصفيتها **',
                logChannelId: promoteSettings?.logChannel,
                logTitle: 'Admin filter log',
                removeAllAdminRoles: false,
                allAdminRoleIds: adminRoleIds,
                resultTitle: 'Admin roles',
                dmDetailsText: 'تم تصفيتك وازاله رولك الاداري.'
            });
        } catch (error) {
            console.error('Error in tasfiyah admin type collector:', error);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'selected' || reason === 'empty') return;
        sentMessage.edit({ components: [] }).catch(() => {});
    });
}

async function startRoleSelection(message, client, roleIds, settings, options = {}) {
    const rolePages = chunkArray(roleIds, 25);
    let currentRolePage = 0;
    const selectedRolesByPage = new Map();
    const {
        title = 'Active Roles',
        description = '**اختر الرولات التفاعلية التي تريد تصفيتها **',
        logChannelId = settings?.settings?.requestChannel || null,
        logTitle = ' Active log',
        removeAllAdminRoles = false,
        allAdminRoleIds = null
    } = options;

    const buildRoleSelectionEmbed = () => {
        const selectedRoleIds = Array.from(selectedRolesByPage.values())
            .flatMap((set) => Array.from(set));
        const selectedMentions = selectedRoleIds.length > 0
            ? selectedRoleIds.map((id) => `<@&${id}>`).join('، ')
            : 'لا يوجد';

        return colorManager.createEmbed()
            .setTitle(title)
            .setDescription(description)
            .setThumbnail(message.guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '**الرولات المختارة**', value: selectedMentions, inline: false },
                { name: '**الصفحة**', value: `**${currentRolePage + 1} / ${rolePages.length}**`, inline: true },
            )
            .setTimestamp();
    };

    const buildRoleMenu = () => {
        const roleOptions = rolePages[currentRolePage].map((roleId) => {
            const role = message.guild.roles.cache.get(roleId);
            const pageSelected = selectedRolesByPage.get(currentRolePage) || new Set();
            return {
                label: role ? role.name.slice(0, 100) : roleId,
                value: roleId,
                description: role ? `ID: ${roleId}` : 'Role not found',
                default: pageSelected.has(roleId)
            };
        });

        return new StringSelectMenuBuilder()
            .setCustomId('tasfiyah_roles_select')
            .setPlaceholder('اختر الرولات...')
            .setMinValues(0)
            .setMaxValues(roleOptions.length || 1)
            .addOptions(roleOptions);
    };

    const buildRoleButtons = () => {
        const prevButton = new ButtonBuilder()
            .setCustomId('tasfiyah_roles_prev')
            .setEmoji('<:emoji_13:1429263136136888501>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentRolePage === 0);

        const nextButton = new ButtonBuilder()
            .setCustomId('tasfiyah_roles_next')
            .setEmoji('<:emoji_14:1429263186539974708>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentRolePage >= rolePages.length - 1);

        const confirmButton = new ButtonBuilder()
            .setCustomId('tasfiyah_roles_confirm')
            .setLabel('Done')
            .setEmoji('<:emoji_7:1465221394966253768>')
            .setStyle(ButtonStyle.Primary);

        const cancelButton = new ButtonBuilder()
            .setCustomId('tasfiyah_roles_cancel')
            .setLabel('Cancel')
            .setEmoji('<:emoji_7:1465221361839505622>')
            .setStyle(ButtonStyle.Danger);

        return new ActionRowBuilder().addComponents(prevButton, nextButton, confirmButton, cancelButton);
    };

    const roleMenuRow = new ActionRowBuilder().addComponents(buildRoleMenu());
    const roleButtonsRow = buildRoleButtons();

    const sentMessage = await message.channel.send({
        embeds: [buildRoleSelectionEmbed()],
        components: [roleMenuRow, roleButtonsRow]
    });

    const filter = (interaction) => interaction.user.id === message.author.id && interaction.message.id === sentMessage.id;
    const collector = sentMessage.createMessageComponentCollector({ filter, time: 10 * 60 * 1000 });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'tasfiyah_roles_select') {
                selectedRolesByPage.set(currentRolePage, new Set(interaction.values));
            } else if (interaction.customId === 'tasfiyah_roles_prev' && currentRolePage > 0) {
                currentRolePage -= 1;
            } else if (interaction.customId === 'tasfiyah_roles_next' && currentRolePage < rolePages.length - 1) {
                currentRolePage += 1;
            } else if (interaction.customId === 'tasfiyah_roles_cancel') {
                collector.stop('cancelled');
                await interaction.update({ content: '**تم إلغاء العملية.**', embeds: [], components: [] });
                return;
            } else if (interaction.customId === 'tasfiyah_roles_confirm') {
                const selectedRoleIds = Array.from(selectedRolesByPage.values())
                    .flatMap((set) => Array.from(set));

                if (selectedRoleIds.length === 0) {
                    await interaction.reply({ content: '**❌ يجب اختيار رول واحد على الأقل.**', ephemeral: true });
                    return;
                }

                collector.stop('confirmed');
                await interaction.update({ content: '**⏳ انتظر للمعالجة...**', embeds: [], components: [] });
                await startMemberSelection(sentMessage, message, client, selectedRoleIds, {
                    logChannelId,
                    logTitle,
                    removeAllAdminRoles,
                    allAdminRoleIds
                });
                return;
            }

            collector.resetTimer();
            const updatedMenuRow = new ActionRowBuilder().addComponents(buildRoleMenu());
            const updatedButtonsRow = buildRoleButtons();
            await interaction.update({
                embeds: [buildRoleSelectionEmbed()],
                components: [updatedMenuRow, updatedButtonsRow]
            });
        } catch (error) {
            console.error('Error in tasfiyah role collector:', error);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'confirmed' || reason === 'cancelled') return;
        sentMessage.edit({ components: [] }).catch(() => {});
    });
}

async function startMemberSelection(sentMessage, message, client, selectedRoleIds, options = {}) {
    const dbManager = getDatabase();
    if (!dbManager || !dbManager.isInitialized) {
        await sentMessage.edit({ content: '**❌ قاعدة البيانات غير متاحة.**', embeds: [], components: [] });
        return;
    }

    const loadingEmbed = colorManager.createEmbed()
        .setTitle('⏳ **تجهيز بيانات التفاعل**')
        .setDescription('**جاري جمع بيانات الأعضاء، الرجاء الانتظار...**')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setTimestamp();

    await sentMessage.edit({ content: null, embeds: [loadingEmbed], components: [] });

    const membersMap = new Map();
    for (const roleId of selectedRoleIds) {
        const role = message.guild.roles.cache.get(roleId);
        if (!role) continue;
        for (const member of role.members.values()) {
            if (member.user.bot) continue;
            membersMap.set(member.id, member);
        }
    }

    const members = Array.from(membersMap.values());
    if (members.length === 0) {
        await sentMessage.edit({ content: '**❌ لا يوجد أعضاء بهذه الرولات.**', embeds: [], components: [] });
        return;
    }

    const now = moment().tz('Asia/Riyadh');
    const monthStart = now.clone().startOf('month').valueOf();

    const concurrencyLimit = members.length >= 200 ? 20 : members.length >= 80 ? 15 : 10;
    let processed = 0;
    const startedAt = Date.now();
    const memberStats = await mapWithConcurrency(members, concurrencyLimit, async (member) => {
        const stats = await dbManager.getMonthlyStats(member.id);
        const liveDuration = getLiveVoiceDuration(member.id, monthStart);
        const voiceTime = (stats.voiceTime || 0) + liveDuration;
        const messages = stats.messages || 0;
        processed += 1;

        if (processed % 15 === 0 || processed === members.length) {
            const elapsed = Date.now() - startedAt;
            const avgPerItem = elapsed / processed;
            const remaining = Math.max(0, members.length - processed);
            const eta = avgPerItem * remaining;
            const bar = buildProgressBar(processed, members.length, 14);
            const progressEmbed = colorManager.createEmbed()
                .setTitle('⏳ **تجهيز بيانات التفاعل**')
                .setDescription(`**تمت معالجة ${processed} / ${members.length} عضو (${formatPercent(processed, members.length)})**\n${bar}\n**⏱️ الوقت المتبقي :** ${formatEta(eta)}`)
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .setTimestamp();
            sentMessage.edit({ embeds: [progressEmbed] }).catch(() => {});
        }

        return {
            member,
            voiceTime,
            messages,
            score: Math.floor(voiceTime / 60000) + messages
        };
    });

    const cleanedStats = memberStats.filter((stat) => stat && stat.member);
    cleanedStats.sort((a, b) => b.score - a.score);

    if (cleanedStats.length === 0) {
        await sentMessage.edit({ content: '**❌ لا يوجد نشاط لهذا الرول.**', embeds: [], components: [] });
        return;
    }

    const pageSize = 10;
    const totalPages = Math.ceil(cleanedStats.length / pageSize);
    let currentPage = 0;
    const selectedMembersByPage = new Map();

    const buildMembersEmbed = () => {
        const start = currentPage * pageSize;
        const pageData = cleanedStats.slice(start, start + pageSize);
        const description = pageData.map((stat, idx) => {
            const rank = start + idx + 1;
            const voiceTimeFormatted = formatDuration(stat.voiceTime);
            return `**#${rank}** - <@${stat.member.id}>\n**<:emoji_85:1442986413510627530> :** ${voiceTimeFormatted} | **<:emoji_85:1442986444712054954> :** **${stat.messages}**`;
        }).join('\n\n');

        const selectedCount = Array.from(selectedMembersByPage.values())
            .reduce((count, set) => count + set.size, 0);

        return colorManager.createEmbed()
            .setTitle('Active roles')
            .setDescription(description || '**لا يوجد بيانات**')
            .setThumbnail(message.guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '**المختارون للتصفية**', value: `**${selectedCount}**`, inline: true },
                { name: '**الصفحة**', value: `**${currentPage + 1} / ${totalPages}**`, inline: true },
                { name: '**أساس "الأقل نشاط"**', value: '**الفرز حسب مجموع (دقائق الفويس + عدد الرسائل) للشهر الحالي. زر الأقل نشاط يختار من لديهم 0 في أحدهما من كل الصفحات.**', inline: false },
                { name: '**تنبيه**', value: '**اختيار الكل يكون للصفحه الحاليه مو كل الصفحات.**', inline: false }
            )
            .setTimestamp();
    };

    const buildMembersMenu = () => {
        const start = currentPage * pageSize;
        const pageData = cleanedStats.slice(start, start + pageSize);
        const pageSelected = selectedMembersByPage.get(currentPage) || new Set();
        const options = pageData.map((stat) => ({
            label: stat.member.displayName.slice(0, 100),
            value: stat.member.id,
            description: `Voice: ${formatDuration(stat.voiceTime)} | Chat: ${stat.messages}`,
            default: pageSelected.has(stat.member.id)
        }));

        return new StringSelectMenuBuilder()
            .setCustomId('tasfiyah_members_select')
            .setPlaceholder('اختر الأعضاء للتصفية...')
            .setMinValues(0)
            .setMaxValues(options.length || 1)
            .addOptions(options);
    };

    const buildMembersButtons = () => {
        const selectAllButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_select_all')
            .setLabel('تحديد الكل')
            .setStyle(ButtonStyle.Secondary);

        const clearAllButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_clear_all')
            .setLabel('إزالة الكل')
            .setStyle(ButtonStyle.Secondary);

        const selectLowestButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_select_lowest')
            .setLabel('الأقل نشاط')
            .setStyle(ButtonStyle.Secondary);

        const prevButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_prev')
               .setEmoji('<:emoji_13:1429263136136888501>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0);

        const nextButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_next')
                 .setEmoji('<:emoji_14:1429263186539974708>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1);

        const applyButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_apply')
            .setLabel('Confirm')
             .setEmoji('<:emoji_7:1465221394966253768>')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('tasfiyah_members_cancel')
            .setLabel('Cancel')
              .setEmoji('<:emoji_7:1465221361839505622>')
            .setStyle(ButtonStyle.Danger);

        return [
            new ActionRowBuilder().addComponents(selectAllButton, clearAllButton, selectLowestButton),
            new ActionRowBuilder().addComponents(prevButton, nextButton, applyButton, cancelButton)
        ];
    };

    await sentMessage.edit({
        embeds: [buildMembersEmbed()],
        components: [new ActionRowBuilder().addComponents(buildMembersMenu()), ...buildMembersButtons()]
    });

    const filter = (interaction) => interaction.user.id === message.author.id && interaction.message.id === sentMessage.id;
    const collector = sentMessage.createMessageComponentCollector({ filter, time: 10 * 60 * 1000 });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId === 'tasfiyah_members_select') {
                selectedMembersByPage.set(currentPage, new Set(interaction.values));
            } else if (interaction.customId === 'tasfiyah_members_select_all') {
                const start = currentPage * pageSize;
                const pageData = cleanedStats.slice(start, start + pageSize);
                selectedMembersByPage.set(currentPage, new Set(pageData.map((stat) => stat.member.id)));
            } else if (interaction.customId === 'tasfiyah_members_clear_all') {
                selectedMembersByPage.set(currentPage, new Set());
            } else if (interaction.customId === 'tasfiyah_members_select_lowest') {
                selectedMembersByPage.clear();
                for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
                    const start = pageIndex * pageSize;
                    const pageData = cleanedStats.slice(start, start + pageSize);
                    const zeroActivity = pageData.filter((stat) => stat.voiceTime === 0 || stat.messages === 0);
                    selectedMembersByPage.set(pageIndex, new Set(zeroActivity.map((stat) => stat.member.id)));
                }
            } else if (interaction.customId === 'tasfiyah_members_prev' && currentPage > 0) {
                currentPage -= 1;
            } else if (interaction.customId === 'tasfiyah_members_next' && currentPage < totalPages - 1) {
                currentPage += 1;
            } else if (interaction.customId === 'tasfiyah_members_cancel') {
                collector.stop('cancelled');
                await interaction.update({ content: '**تم إلغاء العملية.**', embeds: [], components: [] });
                return;
            } else if (interaction.customId === 'tasfiyah_members_apply') {
                const selectedMemberIds = Array.from(selectedMembersByPage.values())
                    .flatMap((set) => Array.from(set));

                if (selectedMemberIds.length === 0) {
                    await interaction.reply({ content: '**❌ يجب اختيار عضو واحد على الأقل.**', ephemeral: true });
                    return;
                }

                collector.stop('apply');
                await interaction.update({ content: '**⏳ جاري تنفيذ التصفية...**', embeds: [], components: [] });
                await applyRoleRemoval(sentMessage, message, selectedMemberIds, selectedRoleIds, options);
                return;
            }

            collector.resetTimer();
            await interaction.update({
                embeds: [buildMembersEmbed()],
                components: [new ActionRowBuilder().addComponents(buildMembersMenu()), ...buildMembersButtons()]
            });
        } catch (error) {
            console.error('Error in tasfiyah members collector:', error);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'apply' || reason === 'cancelled') return;
        sentMessage.edit({ components: [] }).catch(() => {});
    });
}

async function applyRoleRemoval(sentMessage, message, selectedMemberIds, selectedRoleIds, options = {}) {
    const totalMembers = selectedMemberIds.length;
    let successCount = 0;
    let failedCount = 0;
    const successMemberIds = [];
    const failedMembers = [];
    const logChannelId = options.logChannelId || null;
    const logTitle = options.logTitle || ' Active log';
    const removeAllAdminRoles = options.removeAllAdminRoles || false;
    const allAdminRoleIds = Array.isArray(options.allAdminRoleIds) ? options.allAdminRoleIds : [];
    const resultTitle = options.resultTitle || 'Active roles';
    const dmDetailsText = options.dmDetailsText || 'تم تصفيتك وازاله رولك التفاعلي.';

    const progressEmbed = colorManager.createEmbed()
        .setTitle('Procces')
        .setDescription(`**جاري إزالة الرولات... 0 / ${totalMembers}**`)
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setTimestamp();

    await sentMessage.edit({ embeds: [progressEmbed], components: [] });

    let processed = 0;
    const startedAt = Date.now();
    for (const memberId of selectedMemberIds) {
        let member;
        try {
            member = await message.guild.members.fetch(memberId);
        } catch (error) {
            console.error(`Error fetching member ${memberId}:`, error);
            failedCount += 1;
            failedMembers.push({ memberId, reason: 'تعذر جلب العضو.' });
            continue;
        }

        const roleSource = removeAllAdminRoles ? allAdminRoleIds : selectedRoleIds;
        const rolesToRemove = roleSource.filter((roleId) => member.roles.cache.has(roleId));

        if (rolesToRemove.length === 0) {
            failedCount += 1;
            failedMembers.push({ memberId, reason: 'لا يملك الرولات المحددة للإزالة.' });
            continue;
        }

        try {
            await member.roles.remove(rolesToRemove, 'Tasfiyah roles filter');
            successCount += 1;
            successMemberIds.push(memberId);
            const dmEmbed = colorManager.createEmbed()
                .setTitle(resultTitle)
                .addFields(
                    { name: 'Details', value: dmDetailsText, inline: false },
                    { name: 'Roles', value: formatRoleMentions(rolesToRemove, message.guild), inline: false }
                )
                .setTimestamp();
            await member.send({ embeds: [dmEmbed] }).catch(() => {});
        } catch (error) {
            console.error(`Error removing roles from ${memberId}:`, error);
            failedCount += 1;
            failedMembers.push({ memberId, reason: formatFailureReason(error) });
        }

        processed += 1;
        if (processed % 5 === 0 || processed === totalMembers) {
            const elapsed = Date.now() - startedAt;
            const avgPerItem = elapsed / processed;
            const remaining = Math.max(0, totalMembers - processed);
            const eta = avgPerItem * remaining;
            const bar = buildProgressBar(processed, totalMembers, 14);
            const updateEmbed = colorManager.createEmbed()
                .setTitle('🧹 **تنفيذ التصفية**')
                .setDescription(`**جاري إزالة الرولات... ${processed} / ${totalMembers} (${formatPercent(processed, totalMembers)})**\n${bar}\n**⏱️ الوقت المتبقي:** ${formatEta(eta)}`)
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .setTimestamp();
            await sentMessage.edit({ embeds: [updateEmbed], components: [] });
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const resultEmbed = colorManager.createEmbed()
        .setTitle('✅ Done')
        .setDescription('**تم الانتهاء من تنفيذ التصفية.**')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .addFields(
            { name: '**عدد الأعضاء المتصفيين**', value: `**${totalMembers}**`, inline: true },
            { name: '**نجاح**', value: `**${successCount}**`, inline: true },
            { name: '**فشل**', value: `**${failedCount}**`, inline: true }
        )
        .setTimestamp();

    await sentMessage.edit({ embeds: [resultEmbed], components: [] });

    const thumbnail = message.guild.iconURL({ dynamic: true });
    const successLines = successMemberIds.map((id) => `<@${id}>`);
    const failureLines = failedMembers.map((item) => `<@${item.memberId}> — ${item.reason}`);
    const detailEmbeds = [
        ...buildDetailEmbeds('✅ الأعضاء الذين تم تصفيتهم', successLines, thumbnail),
        ...buildDetailEmbeds('❌ الأعضاء الذين فشلوا', failureLines, thumbnail)
    ];

    for (const embed of detailEmbeds) {
        await message.channel.send({ embeds: [embed] });
    }

    if (logChannelId) {
        const logChannel = message.guild.channels.cache.get(logChannelId);
        if (logChannel) {
            const roleIdsForLog = removeAllAdminRoles ? allAdminRoleIds : selectedRoleIds;
            const roleMentions = formatRoleMentions(roleIdsForLog, message.guild);
            const logEmbed = colorManager.createEmbed()
                .setTitle(logTitle)
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '**المنفذ**', value: `<@${message.author.id}>`, inline: true },
                    { name: '**الرولات**', value: roleMentions, inline: false },
                    { name: '**عدد الأعضاء**', value: `**${totalMembers}**`, inline: true },
                    { name: '**نجاح**', value: `**${successCount}**`, inline: true },
                    { name: '**فشل**', value: `**${failedCount}**`, inline: true }
                )
                .setTimestamp();
            logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            for (const embed of detailEmbeds) {
                logChannel.send({ embeds: [embed] }).catch(() => {});
            }
        }
    }
}
