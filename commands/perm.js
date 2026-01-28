const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// Load the central interaction router.  This router allows commands to
// register handlers for specific customId prefixes and routes incoming
// component interactions to the appropriate handler.  By integrating with
// this router, we avoid modifying the main bot file to handle our
// interactions.
const interactionRouter = require('../utils/interactionRouter.js');

const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');

// File name for this command
const name = 'perm';

// Load admin roles from persistent storage.  This command should only
// be usable by bot owners or server administrators defined in the
// adminRoles.json file.  Reuse logic from the adminroles command to
// read the file.  If the file does not exist or cannot be parsed,
// return an empty array.
function loadAdminRoles() {
  try {
    const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
    if (fs.existsSync(adminRolesPath)) {
      const data = fs.readFileSync(adminRolesPath, 'utf8');
      const adminRoles = JSON.parse(data);
      return Array.isArray(adminRoles) ? adminRoles : [];
    }
    return [];
  } catch (error) {
    console.error('Error reading adminRoles:', error);
    return [];
  }
}

/**
 * Build a select menu for common permissions.  The values correspond to the
 * keys on PermissionsBitField.Flags.  Users can select one or more of
 * these options to allow for the target roles.  The labels and
 * descriptions are provided in English to make them clearer.
 */
function buildPermissionSelectMenu() {
  const options = [
    {
      label: 'View Channel',
      description: 'Allows the role to view channels',
      value: 'ViewChannel'
    },
    {
      label: 'Send Messages',
      description: 'Allows the role to send messages',
      value: 'SendMessages'
    },
    {
      label: 'Read Message History',
      description: 'Allows the role to read channel history',
      value: 'ReadMessageHistory'
    },
    {
      label: 'Manage Messages',
      description: 'Allows the role to manage messages',
      value: 'ManageMessages'
    },
    {
      label: 'Connect (Voice)',
      description: 'Allows the role to join voice channels',
      value: 'Connect'
    },
    {
      label: 'Speak (Voice)',
      description: 'Allows the role to speak in voice channels',
      value: 'Speak'
    },
    {
      label: 'Manage Channels',
      description: 'Allows the role to create/delete/modify channels',
      value: 'ManageChannels'
    },
    {
      label: 'Manage Roles',
      description: 'Allows the role to manage other roles',
      value: 'ManageRoles'
    },
    {
      label: 'Use External Emojis',
      description: 'Allows the role to use external emojis',
      value: 'UseExternalEmojis'
    },
    {
      label: 'Use Embedded Activities',
      description: 'Allows the role to use voice embedded activities',
      value: 'UseEmbeddedActivities'
    },
    // Additional permissions for more flexibility
    {
      label: 'Add Reactions',
      description: 'Allows the role to add reactions to messages',
      value: 'AddReactions'
    },
    {
      label: 'Attach Files',
      description: 'Allows the role to attach files',
      value: 'AttachFiles'
    },
    {
      label: 'Embed Links',
      description: 'Allows the role to embed links in messages',
      value: 'EmbedLinks'
    },
    {
      label: 'Use Application Commands',
      description: 'Allows the role to use slash commands',
      value: 'UseApplicationCommands'
    },
    {
      label: 'Mention Everyone',
      description: 'Allows the role to mention @everyone and @here',
      value: 'MentionEveryone'
    },
    {
      label: 'Manage Webhooks',
      description: 'Allows the role to create, edit, and delete webhooks',
      value: 'ManageWebhooks'
    },
    {
      label: 'Manage Events',
      description: 'Allows the role to manage guild scheduled events',
      value: 'ManageEvents'
    },
    {
      label: 'Kick Members',
      description: 'Allows the role to kick members',
      value: 'KickMembers'
    },
    {
      label: 'Ban Members',
      description: 'Allows the role to ban members',
      value: 'BanMembers'
    },
    {
      label: 'Moderate Members',
      description: 'Allows the role to timeout members',
      value: 'ModerateMembers'
    },
    {
      label: 'Manage Threads',
      description: 'Allows the role to manage threads',
      value: 'ManageThreads'
    },
    {
      label: 'Send Messages In Threads',
      description: 'Allows the role to send messages in threads',
      value: 'SendMessagesInThreads'
    }
  ];

  return new StringSelectMenuBuilder()
    .setCustomId('perm_select_permissions')
    .setPlaceholder('اختر الصلاحيات المسموح بها')
    .addOptions(options)
    .setMinValues(1)
    .setMaxValues(options.length);
}

/**
 * Create a ChannelSelectMenuBuilder allowing the user to pick channels to
 * exclude.  By default the menu shows both text and voice channels and
 * allows multiple selections.  If there are hundreds of channels the
 * built‑in search can help the user filter the list.
 */
function buildExcludeChannelMenu() {
  return new ChannelSelectMenuBuilder()
    .setCustomId('perm_exclude_channels')
    .setPlaceholder('اختر الرومات لاستثنائها (يمكن البحث)')
    .setMinValues(0)
    .setMaxValues(25) // Discord allows up to 25 selections
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildVoice]);
}

/**
 * Build a select menu allowing the user to choose whether they want to
 * add (grant) permissions or remove (revoke) them.  This menu appears
 * at the beginning of the interaction flow, immediately after roles
 * and channels have been parsed.  The choice is stored in the
 * session under the `action` property.
 */
function buildActionSelectMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId('perm_action_select')
    .setPlaceholder('اختر العملية (إضافة أو إزالة)')
    .addOptions(
      {
        label: 'إضافة صلاحيات',
        description: 'منح الصلاحيات المحددة للرولات المستهدفة',
        value: 'add'
      },
      {
        label: 'إزالة صلاحيات',
        description: 'إلغاء الصلاحيات المحددة من الرولات المستهدفة',
        value: 'remove'
      }
    )
    .setMinValues(1)
    .setMaxValues(1);
}

/**
 * Helper to verify whether a member has permission to run this command.  A user
 * can run the command if they are a bot owner, the guild owner, or have
 * one of the roles listed in adminRoles.json.  Returns true if allowed.
 */
function hasPermissionToRun(message, BOT_OWNERS) {
  // Bot owners always allowed
  const owners = Array.isArray(BOT_OWNERS) ? BOT_OWNERS : [];
  if (owners.includes(message.author.id)) return true;
  // Guild owner allowed
  if (message.guild && message.guild.ownerId === message.author.id) return true;
  // Only bot or guild owners are allowed; other roles are not permitted
  return false;
}

/**
 * Ensure we have a storage area on the client object for our temporary
 * permission sessions.  Each session stores context (roles, channels, perms,
 * etc.) between the initial command invocation and subsequent component
 * interactions.  The key is the user id who invoked the command.
 */
function getSessionStore(client) {
  if (!client.permSessions) {
    client.permSessions = new Map();
  }
  return client.permSessions;
}

/**
 * Initialize the interaction router for the perm command.  This function
 * registers the perm handler with the router and attaches a single
 * interactionCreate listener on the client that delegates to the router.
 * It ensures the initialization occurs only once per client to avoid
 * duplicate listeners.  Without modifying the main bot file, this
 * approach allows our command to independently handle its component
 * interactions.
 *
 * @param {Client} client The Discord client instance
 */
function initRouter(client) {
  // Register our handler with the router only once
  if (!client._permRouterInitialized) {
    // Register the perm prefix handler.  The router will call our
    // handleInteraction with the client context when any interaction's
    // customId starts with 'perm_'.
    interactionRouter.register('perm_', async (interaction, clientInstance) => {
      // Wrap in try/catch to avoid unhandled rejections
      try {
        await handleInteraction(interaction, { client: clientInstance });
      } catch (err) {
        console.error('Error in perm router handler:', err);
      }
    });

    client._permRouterInitialized = true;
  }
  // Attach a single global interaction listener if not already attached.
  // The listener delegates all interactions to the router, which then
  // forwards to registered handlers based on the customId prefix.
  if (!client._interactionRouterListenerAdded) {
    client.on('interactionCreate', async (interaction) => {
      try {
        // Use the shared router to dispatch.  Passing the client allows
        // handlers to access context if needed.
        await interactionRouter.route(interaction, client);
      } catch (err) {
        console.error('Error routing interaction:', err);
      }
    });
    client._interactionRouterListenerAdded = true;
  }
}

async function execute(message, args, { client, BOT_OWNERS }) {
  try {
    // Ensure our router and interaction listener are set up on this client.
    initRouter(client);
    // Block check: users who are blocked cannot use commands.
    if (isUserBlocked(message.author.id)) {
      const blockedEmbed = colorManager.createEmbed()
        .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
        .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
      await message.channel.send({ embeds: [blockedEmbed] });
      return;
    }

    // Permission check: only owners or admin roles can run this command.
    if (!hasPermissionToRun(message, BOT_OWNERS)) {
      await message.react('❌');
      return;
    }

    // Extract mentioned roles and channels from the message.  In addition to
    // mentions, parse bare IDs and determine whether they represent roles
    // or channels.  Unknown IDs will be reported back to the user.
    const mentionedRoles = message.mentions.roles;
    const mentionedChannelsCollection = message.mentions.channels;
    let rolesToEdit = mentionedRoles ? Array.from(mentionedRoles.values()) : [];
    let mentionedChannels = mentionedChannelsCollection ? Array.from(mentionedChannelsCollection.values()) : [];
    // Regex to match potential Discord IDs in the message content
    const idMatches = message.content.match(/\b\d{17,19}\b/g) || [];
    const unknownIds = [];
    for (const id of idMatches) {
      // Skip if already captured via mentions
      if (rolesToEdit.some(role => role.id === id) || mentionedChannels.some(ch => ch.id === id)) {
        continue;
      }
      try {
        // Try fetching role by ID
        const role = await message.guild.roles.fetch(id).catch(() => null);
        if (role) {
          rolesToEdit.push(role);
          continue;
        }
      } catch (_) {}
      try {
        // Try fetching channel by ID
        const channel = await message.guild.channels.fetch(id).catch(() => null);
        if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice)) {
          mentionedChannels.push(channel);
          continue;
        }
      } catch (_) {}
      // If not found as role or channel, record as unknown
      if (!unknownIds.includes(id)) unknownIds.push(id);
    }
    // If no roles were provided via mention or ID, abort with message
    if (!rolesToEdit || rolesToEdit.length === 0) {
      const embed = colorManager.createEmbed()
        .setDescription('❌ **يجب منشن رول أو إضافة ID صحيح للرول لاستخدام هذا الأمر**');
      await message.channel.send({ embeds: [embed] });
      return;
    }
    // Send summary embed listing detected roles, channels and unknown IDs (if any)
    const summaryFields = [];
    // Roles field
    if (rolesToEdit.length > 0) {
      const rolesStr = rolesToEdit.map(r => `<@&${r.id}>`).join('\n');
      summaryFields.push({ name: 'الرولات', value: rolesStr, inline: false });
    }
    // Channels field
    if (mentionedChannels.length > 0) {
      const channelsStr = mentionedChannels.map(c => `<#${c.id}>`).join('\n');
      summaryFields.push({ name: 'الرومات', value: channelsStr, inline: false });
    }
    // Unknown IDs field
    if (unknownIds.length > 0) {
      const idsStr = unknownIds.join(', ');
      summaryFields.push({ name: 'IDs غير معروفة', value: idsStr, inline: false });
    }
    if (summaryFields.length > 0) {
      const summaryEmbed = colorManager.createEmbed()
        .setTitle('معالجة الـ IDs')
        .setDescription('**تم تحديد العناصر التالية من الرسالة:**')
        .addFields(summaryFields);
      await message.channel.send({ embeds: [summaryEmbed] });
    }

    // Prepare session and store it on the client.  Use the message author
    // id as the key so interactions from other users won’t interfere.
    const sessionStore = getSessionStore(client);
    // Destroy any existing session for this user to avoid stale data
    sessionStore.delete(message.author.id);
    const session = {
      userId: message.author.id,
      guildId: message.guild.id,
      roles: rolesToEdit.map(role => role.id),
      specifiedChannels: mentionedChannels.map(ch => ch.id),
      selectedPermissions: [],
      excludedChannels: [],
      action: null // Will be set to 'add' or 'remove' after user selection
    };
    sessionStore.set(message.author.id, session);

    // Ask the user whether they want to add or remove permissions.  We
    // defer to handleInteraction() to process the selection.
    const actionEmbed = colorManager.createEmbed()
      .setTitle('اختيار العملية')
      .setDescription('**هل تريد إضافة (منح) الصلاحيات أم إزالة (سحب) الصلاحيات؟**')
      .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400390888416608286/download__3_-removebg-preview.png?ex=688d1fe5&is=688bce65&hm=55055a587668561ce27baf0665663f801e14662d4bf849351564a563b1e53b41&');
    const actionMenu = buildActionSelectMenu();
    const actionRow = new ActionRowBuilder().addComponents(actionMenu);
    await message.channel.send({ embeds: [actionEmbed], components: [actionRow] });
  } catch (error) {
    console.error('Error executing perm command:', error);
    // Fail quietly to avoid crashing.  Inform the user if possible.
    try {
      await message.channel.send('❌ **حدث خطأ أثناء تنفيذ الأمر!**');
    } catch (_) {
      // ignore
    }
  }
}

async function handleInteraction(interaction, context) {
  const { client } = context;
  try {
    // Ensure we only handle interactions that originate from this command.
    const customId = interaction.customId;
    if (!customId || !customId.startsWith('perm_')) return;

    // Retrieve the session associated with the user.
    const sessionStore = getSessionStore(client);
    const session = sessionStore.get(interaction.user.id);
    if (!session) {
      // No active session: ignore the interaction.
      return;
    }

    // Defer interactions to avoid expired responses.
    // Many of the operations below involve asynchronous tasks; deferring
    // prevents the interaction from timing out while we process the logic.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }

    if (customId === 'perm_action_select') {
      // User chose whether to add or remove permissions.  Save the action and
      // present the permission selection menu with an appropriate description.
      const selectedAction = (interaction.values && interaction.values[0]) || 'add';
      session.action = selectedAction;
      // Prepare the embed for selecting specific permissions.
      const isRemove = selectedAction === 'remove';
      const permEmbed = colorManager.createEmbed()
        .setTitle('اختيار الصلاحيات')
        .setDescription(
          isRemove
            ? '**اختر الصلاحيات التي تريد إزالتها من الرولات المحددة**'
            : '**اختر الصلاحيات التي تريد إضافتها للرولات المحددة**'
        )
        .setThumbnail(
          'https://cdn.discordapp.com/attachments/1373799493111386243/1400390888416608286/download__3_-removebg-preview.png?ex=688d1fe5&is=688bce65&hm=55055a587668561ce27baf0665663f801e14662d4bf849351564a563b1e53b41&'
        );
      const permMenu = buildPermissionSelectMenu();
      const permRow = new ActionRowBuilder().addComponents(permMenu);
      // After deferring the interaction, update the original message to display the
      // permission selection embed and menu.  Using interaction.message.edit
      // ensures we are editing the existing message rather than a nonexistent reply.
      await interaction.message.edit({ embeds: [permEmbed], components: [permRow] });
      return;
    }

    if (customId === 'perm_select_permissions') {
      // User selected permissions.  Save them and ask for channels to exclude if
      // the user did not specify channels in the initial message.
      const selected = interaction.values || [];
      session.selectedPermissions = selected;
      // If channels were specified in the command invocation, skip exclusion
      // and immediately proceed to applying permissions.
      if (session.specifiedChannels && session.specifiedChannels.length > 0) {
        await applyPermissions(interaction, session);
        sessionStore.delete(interaction.user.id);
        return;
      }
      // Otherwise, prompt the user to select channels to exclude.
      const excludeEmbed = colorManager.createEmbed()
        .setTitle('استثناء الرومات')
        .setDescription('**اختر الرومات التي لا تريد تطبيق الصلاحيات عليها.**\n**إذا لم ترغب في استثناء أي روم، اضغط تخطي.**');
      const channelMenu = buildExcludeChannelMenu();
      const skipButton = new ButtonBuilder()
        .setCustomId('perm_skip_exclude')
        .setLabel('تخطي')
        .setStyle(ButtonStyle.Secondary);
      const menuRow = new ActionRowBuilder().addComponents(channelMenu);
      const buttonRow = new ActionRowBuilder().addComponents(skipButton);
      // Update the original message to show channel exclusion options.  Use
      // interaction.message.edit because this is a component interaction.
      await interaction.message.edit({ embeds: [excludeEmbed], components: [menuRow, buttonRow] });
      return;
    }

    if (customId === 'perm_exclude_channels') {
      // Save excluded channels and apply permissions.
      const selectedChannels = interaction.values || [];
      session.excludedChannels = selectedChannels;
      await applyPermissions(interaction, session);
      sessionStore.delete(interaction.user.id);
      return;
    }

    if (customId === 'perm_skip_exclude') {
      // User chose to skip exclusion; proceed without excluded channels.
      session.excludedChannels = [];
      await applyPermissions(interaction, session);
      sessionStore.delete(interaction.user.id);
      return;
    }
  } catch (error) {
    console.error('Error handling perm interaction:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ **حدث خطأ أثناء معالجة التفاعل!**' });
      } else {
        await interaction.followUp({ content: '❌ **حدث خطأ أثناء معالجة التفاعل!**' });
      }
    } catch (_) {
      // ignore secondary errors
    }
  }
}

/**
 * Apply the selected permissions to the appropriate channels.  This helper
 * iterates through all guild channels (or specified channels) and sets
 * permission overwrites for each target role.  Only text and voice channels
 * are modified.  Excluded channels are skipped.  A summary is sent to
 * the interaction upon completion.
 */
async function applyPermissions(interaction, session) {
  try {
    const guild = await interaction.client.guilds.fetch(session.guildId);
    if (!guild) {
      // If the guild cannot be fetched, update the existing message with an error
        // Update the original message with an error if the guild cannot be fetched.
        await interaction.message.edit({ content: '❌ **لم يتم العثور على السيرفر.**', embeds: [], components: [] });
        return;
    }

    // Determine which channels to modify.  If the user specified channels
    // explicitly in the command invocation, use those.  Otherwise, include
    // all text and voice channels in the guild.
    let channelsToModify;
    if (session.specifiedChannels && session.specifiedChannels.length > 0) {
      channelsToModify = session.specifiedChannels
        .map(id => guild.channels.cache.get(id))
        .filter(ch => ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice));
    } else {
      channelsToModify = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice).map(ch => ch);
    }
    // Remove excluded channels
    if (session.excludedChannels && session.excludedChannels.length > 0) {
      channelsToModify = channelsToModify.filter(ch => !session.excludedChannels.includes(ch.id));
    }
    // Build permission object from selected permission strings.  For add
    // operations we set the flag to true to grant; for remove operations
    // we set it to false to deny/revoke.
    const permObject = {};
    const isRemove = session.action === 'remove';
    for (const perm of session.selectedPermissions) {
      permObject[perm] = isRemove ? false : true;
    }
    // Track counts for reporting
    let updatedChannels = 0;
    let errors = 0;

    // Concurrency control: process channels in parallel with a limit
    const CONCURRENCY_LIMIT = 5;
    let index = 0;
    const tasks = channelsToModify.map(channel => async () => {
      let channelUpdated = false;
      for (const roleId of session.roles) {
        try {
          // Check existing overwrite for this role
          const overwrite = channel.permissionOverwrites.resolve(roleId);
          let skipUpdate = true;
          if (overwrite) {
            // Determine whether we need to update based on action
            for (const perm of session.selectedPermissions) {
              const flag = PermissionsBitField.Flags[perm];
              const hasAllow = overwrite.allow.has(flag);
              if (isRemove) {
                // For remove: update if any selected permission is currently allowed
                if (hasAllow) {
                  skipUpdate = false;
                  break;
                }
              } else {
                // For add: update if any selected permission is not currently allowed
                if (!hasAllow) {
                  skipUpdate = false;
                  break;
                }
              }
            }
          } else {
            // No overwrite exists, always update to create allow/deny
            skipUpdate = false;
          }
          if (skipUpdate) {
            continue;
          }
          await channel.permissionOverwrites.edit(roleId, permObject);
          channelUpdated = true;
        } catch (err) {
          errors++;
          console.error(`Failed to update permissions for ${channel.name} on role ${roleId}:`, err);
        }
      }
      if (channelUpdated) {
        updatedChannels++;
      }
    });
    async function worker() {
      while (true) {
        const current = index++;
        if (current >= tasks.length) break;
        const task = tasks[current];
        await task();
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, tasks.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    // Prepare a summary message
    const rolesMention = session.roles.map(id => `<@&${id}>`).join(', ');
    const permsList = session.selectedPermissions.map(p => `• ${p}`).join('\n');
    const channelCount = updatedChannels;
    const excludedCount = session.excludedChannels ? session.excludedChannels.length : 0;
    const actionFieldName = session.action === 'remove' ? '**الصلاحيات المزالة**' : '**الصلاحيات المضافة**';
    const summaryEmbed = colorManager.createEmbed()
      .setTitle('تم تطبيق الصلاحيات')
      .setDescription(`**تم تحديث صلاحيات ${rolesMention} بنجاح**`)
      .addFields(
        { name: actionFieldName, value: permsList || '—', inline: false },
        { name: '**عدد الرومات المعدلة**', value: `${channelCount}`, inline: true },
        { name: '**عدد الرومات المستثناة**', value: `${excludedCount}`, inline: true },
        { name: '**أخطاء أثناء التحديث**', value: `${errors}`, inline: true }
      )
      .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400645490118234132/download__8_-removebg-preview.png?ex=688d6443&is=688c12c3&hm=217945651e6a5f649ede7719b4572da60d009a8aa461a507b72e2f82ea59a4cd&');
    // Update the original message with the summary.  This replaces the previous
    // embed and removes interactive components.  Avoid using a hidden
    // follow-up message so the result is visible to all users.
    // Update the original message with the summary.  Using message.edit avoids
    // sending a separate hidden message or reply.
    await interaction.message.edit({ embeds: [summaryEmbed], components: [] });
  } catch (error) {
    console.error('Error applying permissions:', error);
    try {
      await interaction.message.edit({ content: '❌ **حدث خطأ أثناء تطبيق الصلاحيات!**', embeds: [], components: [] });
    } catch (_) {
      // ignore
    }
  }
}

module.exports = { name, execute, handleInteraction };