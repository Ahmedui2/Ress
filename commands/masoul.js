// masoul.js (refactor-in-place)
// يحافظ على نفس الواجهة والاعتمادات الخارجية
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const colorManager = require('../utils/colorManager.js');
const { logEvent } = require('../utils/logs_system.js');
const { checkCooldown, startCooldown } = require('./cooldown.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

// ===== إعدادات عامة =====
const DEBUG = false;
const dataDir = path.join(__dirname, '..', 'data');
const DATA_FILES = {
  points: path.join(dataDir, 'points.json'),
  botConfig: path.join(dataDir, 'botConfig.json')
};
const MAX_CONCURRENT_OPERATIONS = 5;
const CLAIM_ID_HARD_LIMIT = 95; // الهامش أقل من 100 تجنباً لأي زيادات عشوائية
const MODAL_TTL_MS = 10 * 60 * 1000; // 10 دقائق

// ===== أدوات JSON =====
function readJSONFile(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
    return defaultValue;
  } catch (error) {
    console.error(`خطأ في قراءة ${filePath}:`, error);
    return defaultValue;
  }
}
function writeJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`خطأ في كتابة ${filePath}:`, error);
    return false;
  }
}

// ===== إدارة المهام النشطة =====
let activeTasks = new Map();

function loadActiveTasks() {
  try {
    const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
    if (currentBotConfig.activeTasks) {
      const savedTasks = currentBotConfig.activeTasks;
      for (const [key, value] of Object.entries(savedTasks)) {
        activeTasks.set(key, value);
      }
      console.log(`✅ تم تحميل ${activeTasks.size} مهمة نشطة من JSON في masoul.js`);
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل المهام النشطة في masoul.js:', error);
  }
}
function saveActiveTasks() {
  try {
    const activeTasksObj = {};
    for (const [key, value] of activeTasks.entries()) {
      activeTasksObj[key] = value;
    }
    const currentBotConfig = readJSONFile(DATA_FILES.botConfig, {});
    currentBotConfig.activeTasks = activeTasksObj;
    writeJSONFile(DATA_FILES.botConfig, currentBotConfig);
    if (DEBUG) console.log(`💾 تم حفظ ${Object.keys(activeTasksObj).length} مهمة نشطة في JSON من masoul.js`);
  } catch (error) {
    console.error('❌ خطأ في حفظ المهام النشطة في masoul.js:', error);
  }
}
loadActiveTasks();

// ===== رد آمن موحّد =====
async function safeReply(interaction, content, options = {}) {
  try {
    if (!interaction || !interaction.isRepliable()) return false;
    const replyOptions = { content, ephemeral: true, ...options };

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(replyOptions);
    } else if (interaction.deferred) {
      await interaction.editReply(replyOptions);
    } else {
      await interaction.followUp(replyOptions);
    }
    return true;
  } catch (error) {
    const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001];
    if (!ignoredCodes.includes(error?.code)) console.error('خطأ في الرد الآمن:', error);
    return false;
  }
}

// ===== أدوات داخلية =====
function createCallEmbed(responsibilityName, reason, userId) {
  return colorManager.createEmbed()
    .setTitle('استدعاء مسؤول')
    .setDescription(`**تم استدعاؤك من قِبل أحد الإداريين**\n\n**المسؤولية:** ${responsibilityName}\n**السبب:** ${reason}\n**من قِبل:** <@${userId}>`)
    .setFooter({ text: ' By Ahmed.' })
    .setThumbnail('https://cdn.discordapp.com/emojis/1303973825591115846.png?v=1')
    .setTimestamp();
}

function loadAdminRolesOnce() {
  try {
    const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
    if (fs.existsSync(adminRolesPath)) {
      const data = fs.readFileSync(adminRolesPath, 'utf8');
      const adminRoles = JSON.parse(data);
      return Array.isArray(adminRoles) ? adminRoles : [];
    }
    return [];
  } catch (error) {
    console.error('خطأ في قراءة adminRoles:', error);
    return [];
  }
}

function ensureClientMaps(client) {
  if (!client.modalData) client.modalData = new Map();
}

/** تقليم customId إذا تجاوز الحد حتى لا يفشل */
function buildClaimCustomId(responsibilityName, timestamp, requesterId, originalChannelId, originalMessageId) {
  let cid = `claim_task_${responsibilityName}_${timestamp}_${requesterId}_${originalChannelId}_${originalMessageId}`;
  if (cid.length > CLAIM_ID_HARD_LIMIT) {
    // نسقط messageId أولاً (أقل شيء يؤثر)
    cid = `claim_task_${responsibilityName}_${timestamp}_${requesterId}_${originalChannelId}_unknown`;
    if (cid.length > CLAIM_ID_HARD_LIMIT) {
      // نسقط أيضًا channelId كحل أخير
      cid = `claim_task_${responsibilityName}_${timestamp}_${requesterId}_unknown_unknown`;
    }
  }
  return cid;
}

// ===== معالج زر الاستلام =====
async function handleClaimButton(interaction, context) {
  const { client, responsibilities, points, scheduleSave, reportsConfig } = context;
  try {
    if (!interaction || !interaction.isRepliable()) return;

    // منع التكرار
    if (interaction.replied || interaction.deferred) return;

    const parts = interaction.customId.split('_');
    if (parts.length < 4) {
      return safeReply(interaction, '**خطأ في معرف المهمة!**');
    }

    const responsibilityName = parts[2];
    const timestamp = parts[3];
    const requesterId = parts[4] || '0';
    const originalChannelId = parts[5] || null;
    const originalMessageId = parts[6] || 'unknown';
    const taskId = `${responsibilityName}_${timestamp}`;

    if (!responsibilities[responsibilityName]) {
      const errorEmbed = colorManager.createEmbed()
        .setDescription('**حاول مرة اخرى او انتظر دقيقه**')
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400667127089856522/1224078115479883816.png?ex=688d786a&is=688c26ea&hm=690357effa104ec0a7e2f728ed55058d79d7a50475dcf981a7e0e6ded68d2c97&');
      return safeReply(interaction, '', { embeds: [errorEmbed] });
    }

    if (activeTasks.has(taskId)) {
      const claimedBy = activeTasks.get(taskId);
      const claimedEmbed = colorManager.createEmbed()
        .setDescription(`**تم استلام هذه المهمة من قبل ${claimedBy}**`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');
      return safeReply(interaction, '', { embeds: [claimedEmbed] });
    }

    const guild = interaction.guild || client.guilds.cache.first();
    let displayName = interaction.user.username;

    // Extract the reason from the original embed
    let reason = 'غير محدد';
    try {
        const originalEmbed = interaction.message.embeds[0];
        if (originalEmbed && originalEmbed.description) {
            const reasonLine = originalEmbed.description.split('\n').find(line => line.includes('**السبب:**'));
            if (reasonLine) {
                reason = reasonLine.replace('**السبب:**', '').trim();
            }
        }
    } catch (e) {
        console.error("Could not parse reason from embed:", e);
    }

    try {
      if (guild) {
        const member = await guild.members.fetch(interaction.user.id);
        displayName = member.displayName || member.user.displayName || member.user.username;
      }
    } catch { /* ignore */ }

    // CRITICAL: Check if task is already active before proceeding
    if (activeTasks.has(taskId)) {
      const claimedBy = activeTasks.get(taskId);
      const claimedEmbed = colorManager.createEmbed()
        .setDescription(`**تم استلام هذه المهمة من قبل ${claimedBy}**`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');
      return safeReply(interaction, '', { embeds: [claimedEmbed] });
    }

    // Mark task as active immediately to prevent race conditions
    activeTasks.set(taskId, displayName);
    saveActiveTasks();

    // Cancel reminder if it exists
    const notificationsCommand = client.commands.get('notifications');
    if (notificationsCommand?.cancelTaskTracking) {
      notificationsCommand.cancelTaskTracking(taskId);
    }

    // --- NEW REPORTING LOGIC ---
    const isReportRequired = reportsConfig && reportsConfig.enabled && Array.isArray(reportsConfig.requiredFor) && reportsConfig.requiredFor.includes(responsibilityName);

    if (isReportRequired) {
        const reportId = `${interaction.user.id}_${Date.now()}`;
        client.pendingReports.set(reportId, {
            claimerId: interaction.user.id,
            displayName: displayName,
            responsibilityName,
            requesterId,
            timestamp,
            reason: reason, // Store the reason
            originalChannelId: originalChannelId,
            originalMessageId: originalMessageId,
            createdAt: Date.now() // Add timestamp for reminder tracking
        });
        scheduleSave(); // Save the pending report state

        // Award point now if points-on-report is disabled
        if (!reportsConfig.pointsOnReport) {
            if (!points[responsibilityName]) points[responsibilityName] = {};
            if (!points[responsibilityName][interaction.user.id]) points[responsibilityName][interaction.user.id] = {};
            if (typeof points[responsibilityName][interaction.user.id] === 'number') {
                const oldPoints = points[responsibilityName][interaction.user.id];
                points[responsibilityName][interaction.user.id] = { [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints };
            }
            if (!points[responsibilityName][interaction.user.id][timestamp]) {
                points[responsibilityName][interaction.user.id][timestamp] = 0;
            }
            points[responsibilityName][interaction.user.id][timestamp] += 1;
            scheduleSave();
        }

        const reportEmbed = colorManager.createEmbed()
            .setTitle('تم استلام المهمة بنجاح')
            .setDescription(`**هذه المهمة تتطلب تقريراً بعد الإنتهاء منها.**\n\n**السبب:** ${reason}\n\nيرجى الضغط على الزر أدناه لكتابة التقرير.`)
            .setFooter({text: 'By Ahmed.'});

        const writeReportButton = new ButtonBuilder()
            .setCustomId(`report_write_${reportId}`)
            .setLabel('كتابة التقرير')
            .setStyle(ButtonStyle.Success);

        const components = [writeReportButton];
        if (originalChannelId) {
            let url;
            if (originalMessageId && originalMessageId !== 'unknown') {
                url = `https://discord.com/channels/${interaction.guildId}/${originalChannelId}/${originalMessageId}`;
            } else {
                url = `https://discord.com/channels/${interaction.guildId}/${originalChannelId}`;
            }
            components.push(new ButtonBuilder().setLabel('الوصول للرساله').setStyle(ButtonStyle.Link).setURL(url));
        }

        const row = new ActionRowBuilder().addComponents(components);

        await interaction.update({ embeds: [reportEmbed], components: [row] });

    } else {
        // --- ORIGINAL LOGIC for tasks NOT requiring a report ---
        // Award points immediately
        if (!points[responsibilityName]) points[responsibilityName] = {};
        if (!points[responsibilityName][interaction.user.id]) points[responsibilityName][interaction.user.id] = {};
        if (typeof points[responsibilityName][interaction.user.id] === 'number') {
          const oldPoints = points[responsibilityName][interaction.user.id];
          points[responsibilityName][interaction.user.id] = {
            [Date.now() - (35 * 24 * 60 * 60 * 1000)]: oldPoints
          };
        }
        if (!points[responsibilityName][interaction.user.id][timestamp]) {
          points[responsibilityName][interaction.user.id][timestamp] = 0;
        }
        points[responsibilityName][interaction.user.id][timestamp] += 1;
        scheduleSave();

        // زر رابط الرسالة (إن أمكن)
        const finalChannelId = originalChannelId || interaction.channelId;
        const finalMessageId = originalMessageId !== 'unknown' ? originalMessageId : null;
        const guildId = interaction.guild?.id || interaction.guildId || guild?.id;

        let claimedButtonRow = null;
        if (guildId && finalChannelId) {
            let url;
            if (finalMessageId && /^\d{17,19}$/.test(finalMessageId)) {
              url = `https://discord.com/channels/${guildId}/${finalChannelId}/${finalMessageId}`;
            } else {
              url = `https://discord.com/channels/${guildId}/${finalChannelId}`;
            }
            const goBtn = new ButtonBuilder().setLabel('الوصول للرساله').setStyle(ButtonStyle.Link).setURL(url);
            claimedButtonRow = new ActionRowBuilder().addComponents(goBtn);
        }

        const claimedEmbed = colorManager.createEmbed()
          .setDescription(`**✅ تم استلام المهمة من قبل <@${interaction.user.id}> (${displayName})**\n\n**السبب:** ${reason}`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');

        await interaction.update({ embeds: [claimedEmbed], components: claimedButtonRow ? [claimedButtonRow] : [] });

        // تنبيه الطالب
        try {
          const requester = await client.users.fetch(requesterId);
          const requesterSuccessEmbed = colorManager.createEmbed()
            .setDescription(`**✅ تم استلام طلب خاص لمسؤول الـ${responsibilityName} وهو <@${interaction.user.id}> (${displayName})**`)
            .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');

          const dmPayload = { embeds: [requesterSuccessEmbed] };
          if (claimedButtonRow) dmPayload.components = [claimedButtonRow];
          await requester.send(dmPayload);
        } catch (e) {
          if (DEBUG) console.log('تعذر إرسال DM للطالب:', e?.message);
        }

        // Log
        logEvent(client, guild, {
          type: 'TASK_LOGS',
          title: 'Task Claimed',
          description: `Responsibility: **${responsibilityName}**`,
          user: interaction.user,
          fields: [
            { name: 'Claimed By', value: `<@${interaction.user.id}> (${displayName})`, inline: true },
            { name: 'Requester', value: `<@${requesterId}>`, inline: true },
            { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }
          ]
        });
    }
  } catch (error) {
    console.error('خطأ في معالجة زر الاستلام:', error);
    await safeReply(interaction, '**حدث خطأ أثناء استلام المهمة.**');
  }
}

const name = 'مسؤول';

async function execute(message, args, { responsibilities, points, scheduleSave, BOT_OWNERS, ADMIN_ROLES, client }) {
  // بلوك
  if (isUserBlocked(message.author.id)) {
    const blockedEmbed = colorManager.createEmbed()
      .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
      .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
    await message.channel.send({ embeds: [blockedEmbed] });
    return;
  }

  const activeOperations = new Set();
  async function manageConcurrentOperation(operationId, operation) {
    if (activeOperations.size >= MAX_CONCURRENT_OPERATIONS) {
      throw new Error('تم الوصول للحد الأقصى من العمليات المتزامنة');
    }
    activeOperations.add(operationId);
    try {
      return await operation();
    } finally {
      activeOperations.delete(operationId);
    }
  }
  async function handleInteractionError(interaction, error) {
    console.error('Error in interaction handler:', error);
    const ignored = [10008, 40060, 10062, 10003, 50013, 50001];
    if (!ignored.includes(error?.code)) await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
  }

  // اختصار: مسؤوليات
  if (args[0] === 'مسؤوليات') {
    await handleResponsibilitiesCommand(message, args.slice(1), responsibilities, client, BOT_OWNERS);
    return;
  }

  // منشن مباشر = عرض مسؤولياته
  if (message.mentions.users.size > 0) {
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    if (!isOwner) { await message.react('❌'); return; }
    const targetUser = message.mentions.users.first();
    await showUserResponsibilities(message, targetUser, responsibilities, client);
    return;
  }

  // صلاحيات
  const CURRENT_ADMIN_ROLES = loadAdminRolesOnce();
  const member = await message.guild.members.fetch(message.author.id);
  const hasAdminRole = member.roles.cache.some(role => CURRENT_ADMIN_ROLES.includes(role.id));
  const hasAdministrator = member.permissions.has('Administrator');
  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

  if (!hasAdminRole && !isOwner && !hasAdministrator) {
    await message.react('❌');
    return;
  }

  // قائمة المسؤوليات
  const options = Object.keys(responsibilities).map(key => ({ label: key, value: key }));
  if (options.length === 0) {
    const errorEmbed = colorManager.createEmbed()
      .setDescription('**لا توجد مسؤوليات معرفة حتى الآن.**')
      .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400390888416608286/download__3_-removebg-preview.png?ex=688d1fe5&is=688bce65&hm=55055a587668561ce27baf0665663f801e14662d4bf849351564a563b1e53b41&');
    return message.channel.send({ embeds: [errorEmbed] });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('masoul_select_responsibility')
    .setPlaceholder('اختر مسؤولية')
    .addOptions(options);

  const cancelButton = new ButtonBuilder()
    .setCustomId('cancel_masoul_menu')
    .setLabel('cancel')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);
  const buttonRow = new ActionRowBuilder().addComponents(cancelButton);

  const sentMessage = await message.channel.send({
    content: '**اختر مسؤولية من القائمة:**',
    components: [selectRow, buttonRow]
  });

  const filter = i => i.user.id === message.author.id && i.message.id === sentMessage.id;
  const collector = message.channel.createMessageComponentCollector({ filter, time: 60000 });

  collector.on('collect', async interaction => {
    try {
      if (!interaction || !interaction.isRepliable()) return;
      if (interaction.replied || interaction.deferred) return;

      if (interaction.customId === 'cancel_masoul_menu') {
        collector.stop('cancelled');
        await interaction.update({ content: '**تم كنسلت القائمة.**', embeds: [], components: [] });
        return;
      }

      if (interaction.customId === 'masoul_select_responsibility') {
        const selected = interaction.values[0];
        const responsibility = responsibilities[selected];
        if (!responsibility) {
          return interaction.reply({ content: '**المسؤولية غير موجودة!**', ephemeral: true });
        }

        // بناء الأزرار
        const buttons = [];
        if (responsibility.responsibles?.length > 0) {
          const responsibilityName = selected;
          const responsibles = responsibility.responsibles;
          const maxButtons = 20; // نترك مساحة لزر "الكل" والإلغاء في صف مستقل
          const responsibleCount = Math.min(responsibles.length, maxButtons - 1);

          for (let i = 0; i < responsibleCount; i++) {
            try {
              const user = await client.users.fetch(responsibles[i]);
              let displayName = user.username;
              try {
                const member = await message.guild.members.fetch(responsibles[i]);
                displayName = member.displayName || member.nickname || user.username;
              } catch { /* ignore */ }
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`masoul_contact_${responsibilityName}_${responsibles[i]}_${Date.now()}`)
                  .setLabel(`${displayName.substring(0, 20)}`)
                  .setStyle(ButtonStyle.Primary)
              );
            } catch {
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`masoul_contact_${responsibilityName}_${responsibles[i]}_${Date.now()}`)
                  .setLabel(`مسؤول ${i + 1}`)
                  .setStyle(ButtonStyle.Primary)
              );
            }
          }

          if (buttons.length > 0) {
            buttons.push(
              new ButtonBuilder()
                .setCustomId(`masoul_contact_${responsibilityName}_all_${Date.now()}`)
                .setLabel('الكل')
                .setStyle(ButtonStyle.Success)
            );
          }
        }

        // صفوف الأزرار (5 كحد أقصى)
        const rows = [];
        for (let i = 0; i < buttons.length && rows.length < 4; i += 5) {
          const slice = buttons.slice(i, i + 5);
          if (slice.length > 0) rows.push(new ActionRowBuilder().addComponents(slice));
        }

        // صف إلغاء مستقل
        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cancel_masoul_menu').setLabel('cancel').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        const desc = responsibility.description || '**No desc.**';
        const contactEmbed = colorManager.createEmbed()
          .setTitle('** Call resb **')
          .setDescription(`**Res :** __${selected}___\n**Desc :** **${desc}**`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400658571925917707/1303973825591115846.png?ex=688d7072&is=688c1ef2&hm=b7426eb45bc266fb56bd7db0095d9ee331bfcbe8d3a13d95a7b735c185662aaf&');

        await interaction.reply({
          embeds: [contactEmbed],
          components: [...rows, cancelRow],
          ephemeral: true
        });

        // تحديث القائمة الرئيسية بعد ثانيتين
        setTimeout(async () => {
          try {
            const newOptions = Object.keys(responsibilities).map(key => ({ label: key, value: key }));
            const newSelectMenu = new StringSelectMenuBuilder()
              .setCustomId('masoul_select_responsibility')
              .setPlaceholder('اختر مسؤولية')
              .addOptions(newOptions);
            const newRow = new ActionRowBuilder().addComponents(newSelectMenu);
            await sentMessage.edit({ content: '**اختر مسؤولية من القائمة:**', components: [newRow, buttonRow] });
          } catch (error) {
            if (DEBUG) console.error('Failed to update menu:', error);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('خطأ في معالج المودال:', error);
      await handleInteractionError(interaction, error);
    }
  });

  // كولكتور أزرار التواصل + الإلغاء
  const buttonCollector = message.channel.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id && (i.customId.startsWith('masoul_contact_') || i.customId === 'cancel_masoul_menu'),
    time: 600000
  });

  buttonCollector.on('collect', async interaction => {
    const operationId = `masoul_${interaction.user.id}_${Date.now()}`;
    try {
      await manageConcurrentOperation(operationId, async () => {
        if (!interaction || !interaction.isRepliable()) return;
        if (interaction.replied || interaction.deferred) return;

        if (interaction.customId === 'cancel_masoul_menu') {
          try {
            await interaction.update({ content: '**تم إلغاء العملية.**', embeds: [], components: [] });
          } catch (error) {
            if (DEBUG) console.error('خطأ في معالجة زر الإلغاء:', error);
          }
          return;
        }

        const parts = interaction.customId.split('_');
        const responsibilityName = parts[2];
        const target = parts[3]; // userId or 'all'

        // كولداون
        const cooldownTime = checkCooldown(interaction, responsibilityName);
        if (cooldownTime > 0) {
          return interaction.reply({
            content: `**لقد استخدمت هذا الأمر مؤخرًا. يرجى الانتظار ${Math.ceil(cooldownTime / 1000)} ثانية أخرى.**`,
            ephemeral: true
          });
        }
        startCooldown(interaction.user.id, responsibilityName);

        // ربط الرسالة الأصلية
        const originalChannelId = message.channelId;
        const originalMessageId = message.id;

        // مودال السبب
        const shortId = Date.now().toString().slice(-8);
        const modal = new ModalBuilder().setCustomId(`masoul_modal_${shortId}`).setTitle('سبب الطلب');
        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('اكتب سبب طلب المساعدة')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('مثال: أحتاج مساعدة في حل مشكلة تقنية')
          .setMaxLength(1000);
        const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(reasonRow);

        ensureClientMaps(client);
        client.modalData.set(shortId, {
          responsibilityName,
          target,
          userId: interaction.user.id,
          timestamp: Date.now(),
          originalChannelId,
          originalMessageId,
          _expires: Date.now() + MODAL_TTL_MS
        });

        // تنظيف تلقائي بعد انتهاء المهلة
        setTimeout(() => {
          const data = client.modalData.get(shortId);
          if (data && Date.now() > data._expires) client.modalData.delete(shortId);
        }, MODAL_TTL_MS + 1000);

        await interaction.showModal(modal);

        // Log
        logEvent(client, interaction.guild, {
          type: 'TASK_LOGS',
          title: 'Contacting Responsible Member',
          description: `**اداري يتواصل مع مسؤول "__${responsibilityName}__"**`,
          user: interaction.user,
          fields: [{ name: '**الهدف**', value: target === 'all' ? '**الكل**' : `<@${target}>` }]
        });
      });
    } catch (error) {
      console.error('خطأ في معالج الأزرار:', error);
      const ignored = [10008, 40060, 10062, 10003, 50013, 50001];
      if (ignored.includes(error?.code)) return;
      await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
    }
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time') {
      const disabledSelectRow = new ActionRowBuilder().addComponents(
        StringSelectMenuBuilder.from(selectMenu).setDisabled(true)
      );
      const disabledButtonRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(cancelButton).setDisabled(true)
      );
      sentMessage.edit({ components: [disabledSelectRow, disabledButtonRow] }).catch(() => {});
    }
  });
}

async function handleResponsibilitiesCommand(message, args, responsibilities, client, BOT_OWNERS) {
  const CURRENT_ADMIN_ROLES = loadAdminRolesOnce();
  const member = await message.guild.members.fetch(message.author.id);
  const hasAdminRole = member.roles.cache.some(role => CURRENT_ADMIN_ROLES.includes(role.id));
  const hasAdministrator = member.permissions.has('Administrator');
  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

  if (!hasAdminRole && !isOwner && !hasAdministrator) {
    await message.react('❌');
    return;
  }

  if (args.length === 0) {
    const helpEmbed = colorManager.createEmbed()
      .setTitle('مسؤوليات Command')
      .setDescription('**استخدم الأمر لفحص مسؤوليات شخص معين**')
      .addFields([
        { name: '**الاستخدام**', value: '**`مسؤوليات @user`**', inline: false },
        { name: '**مثال**', value: '**`مسؤوليات @احمد`**', inline: false }
      ])
      .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400637278900191312/images__7_-removebg-preview.png?ex=688d5c9d&is=688c0b1d&hm=8d5c6d761dcf9bda65af44b9de09a2817cbc273f061eb1e39cc8ac20de37cfc0&');
    await message.channel.send({ embeds: [helpEmbed] });
    return;
  }

  let targetUser = null;
  if (message.mentions.users.size > 0) {
    targetUser = message.mentions.users.first();
  } else {
    const userId = args[0].replace(/[<@!>]/g, '');
    try {
      targetUser = await client.users.fetch(userId);
    } catch {
      const errorEmbed = colorManager.createEmbed()
        .setDescription('**لم يتم العثور على المستخدم. تأكد من منشنته أو كتابة ايديه صحيح.**')
        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400390888416608286/download__3_-removebg-preview.png?ex=688d1fe5&is=688bce65&hm=55055a587668561ce27baf0665663f801e14662d4bf849351564a563b1e53b41&');
      await message.channel.send({ embeds: [errorEmbed] });
      return;
    }
  }

  await showUserResponsibilities(message, targetUser, responsibilities, client);
}

async function showUserResponsibilities(message, targetUser, responsibilities, client) {
  const userResponsibilities = [];
  for (const [respName, respData] of Object.entries(responsibilities)) {
    if (respData.responsibles && respData.responsibles.includes(targetUser.id)) {
      userResponsibilities.push({ name: respName });
    }
  }

  if (userResponsibilities.length === 0) {
    const noRespEmbed = colorManager.createEmbed()
      .setDescription(`**${targetUser.username} ليس لديه أي مسؤوليات**`)
      .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400390144795738175/download__2_-removebg-preview.png?ex=688d1f34&is=688bcdb4&hm=40da8d91a92062c95eb9d48f307697ec0010860aca64dd3f8c3c045f3c2aa13a&');
    await message.channel.send({ embeds: [noRespEmbed] });
  } else {
    let responsibilitiesList = '';
    userResponsibilities.forEach((resp, index) => {
      responsibilitiesList += `**${index + 1}.** ${resp.name}\n`;
    });

    const respEmbed = colorManager.createEmbed()
      .setTitle(`مسؤوليات ${targetUser.username}`)
      .setDescription(responsibilitiesList)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .addFields([
        { name: 'Total Res', value: `${userResponsibilities.length}`, inline: true },
        { name: 'User', value: `<@${targetUser.id}>`, inline: true }
      ])
      .setFooter({ text: 'By Ahmed.' })
      .setTimestamp();

    await message.channel.send({ embeds: [respEmbed] });
  }
}

// ===== نقطة دخول التفاعلات =====
async function handleInteraction(interaction, context) {
  const { client, responsibilities, points, scheduleSave, reportsConfig } = context;
  try {
    if (interaction.isButton() && interaction.customId.startsWith('claim_task_')) {
      await handleClaimButton(interaction, context);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('masoul_modal_')) {
      const shortId = interaction.customId.replace('masoul_modal_', '');
      const modalData = client.modalData?.get(shortId);
      if (!modalData) {
        return interaction.reply({ content: '**انتهت صلاحية هذا النموذج. حاول مرة أخرى.**', ephemeral: true });
      }

      const { responsibilityName, target, userId, timestamp, originalChannelId, originalMessageId } = modalData;

      if (interaction.replied || interaction.deferred) return;

      const reason = interaction.fields.getTextInputValue('reason').trim() || 'لا يوجد سبب محدد';
      if (!responsibilities[responsibilityName]) {
        return interaction.reply({ content: '**المسؤولية غير موجودة!**', ephemeral: true });
      }

      const responsibility = responsibilities[responsibilityName];
      const responsibles = responsibility.responsibles || [];
      if (responsibles.length === 0) {
        return interaction.reply({ content: '**لا يوجد مسؤولين معينين لهذه المسؤولية.**', ephemeral: true });
      }

      const embed = createCallEmbed(responsibilityName, reason, userId);

      const claimCustomId = buildClaimCustomId(
        responsibilityName,
        timestamp,
        userId,
        originalChannelId,
        originalMessageId || 'unknown'
      );

      const claimButton = new ButtonBuilder().setCustomId(claimCustomId).setLabel('Claim').setStyle(ButtonStyle.Success);

      const guildId = interaction.guildId;
      let goToMessageButton = null;
      if (guildId && originalChannelId) {
        let messageUrl;
        if (originalMessageId && originalMessageId !== 'unknown' && /^\d{17,19}$/.test(originalMessageId)) {
            messageUrl = `https://discord.com/channels/${guildId}/${originalChannelId}/${originalMessageId}`;
        } else {
            messageUrl = `https://discord.com/channels/${guildId}/${originalChannelId}`;
        }
        goToMessageButton = new ButtonBuilder().setLabel('الوصول للرساله').setStyle(ButtonStyle.Link).setURL(messageUrl);
      }

      const buttonRow = new ActionRowBuilder().addComponents(
        claimButton,
        ...(goToMessageButton ? [goToMessageButton] : [])
      );

      if (target === 'all') {
        let sentCount = 0, failedCount = 0;
        for (const uid of responsibles) {
          try {
            const user = await client.users.fetch(uid);
            await user.send({ embeds: [embed], components: [buttonRow] });
            sentCount++;
          } catch {
            failedCount++;
          }
        }

        const taskId = `${responsibilityName}_${timestamp}`;
        const notificationsCommand = client.commands.get('notifications');
        if (notificationsCommand?.trackTask) {
          notificationsCommand.trackTask(taskId, responsibilityName, responsibles, client);
        }

        let replyMessage = `**تم إرسال الطلب لـ ${sentCount} من المسؤولين.**`;
        if (failedCount > 0) replyMessage += `\n**فشل الإرسال لـ ${failedCount} مسؤول (رسائل خاصة مغلقة).**`;
        await interaction.reply({ content: replyMessage, ephemeral: true });
      } else {
        try {
          const user = await client.users.fetch(target);
          let displayName = user.username;
          try {
            const member = await interaction.guild.members.fetch(target);
            displayName = member.displayName || member.nickname || user.username;
          } catch { /* ignore */ }

          await user.send({ embeds: [embed], components: [buttonRow] });

          const taskId = `${responsibilityName}_${timestamp}`;
          const notificationsCommand = client.commands.get('notifications');
          if (notificationsCommand?.trackTask) {
            notificationsCommand.trackTask(taskId, responsibilityName, [target], client);
          }

          await interaction.reply({ content: `**تم إرسال طلب خاص لمسؤول ${displayName}.**`, ephemeral: true });
        } catch (error) {
          let errorMessage = '**فشل في إرسال الرسالة الخاصة.**';
          if (error?.code === 50007) errorMessage = '**لا يمكن إرسال رسالة خاصة للمستخدم. الرسائل الخاصة مغلقة.**';
          else if (error?.code === 10013) errorMessage = '**المستخدم غير موجود أو غير متاح.**';
          else if (error?.code === 50001) errorMessage = '**البوت لا يملك صلاحية لإرسال رسائل خاصة.**';
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }

      logEvent(client, interaction.guild, {
        type: 'TASK_LOGS',
        title: 'Task Requested',
        description: `Responsibility: **${responsibilityName}**`,
        user: interaction.user,
        fields: [
          { name: 'Reason', value: reason, inline: false },
          { name: 'Target', value: target === 'all' ? 'All' : `<@${target}>`, inline: true }
        ]
      });

      client.modalData?.delete(shortId);
      return;
    }
  } catch (error) {
    console.error('خطأ في معالج التفاعلات:', error);
    await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
  }
}

module.exports = {
  name,
  execute,
  loadActiveTasks,
  saveActiveTasks,
  handleInteraction,
  activeTasks
};
