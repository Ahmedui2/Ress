const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { logEvent } = require('../utils/logs_system.js');
const { checkCooldown, startCooldown } = require('./cooldown.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');

const name = 'setup';

// Function to update all setup menus when responsibilities change
function updateAllSetupMenus(client) {
  if (client.setupMenuUpdaters) {
    client.setupMenuUpdaters.forEach(async (updateFunction, messageId) => {
      try {
        await updateFunction();
      } catch (error) {
        console.error(`Failed to update setup menu ${messageId}:`, error);
        // Remove broken updater
        client.setupMenuUpdaters.delete(messageId);
      }
    });
  }
}

// Export the update function for use in other commands
module.exports.updateAllSetupMenus = updateAllSetupMenus;

// Helper function for safe replies
async function safeReply(interaction, content, options = {}) {
  try {
    if (!interaction || !interaction.isRepliable()) {
      console.log('لا يمكن الرد على التفاعل - غير صالح أو منتهي الصلاحية');
      return false;
    }

    // التحقق من عمر التفاعل
    const now = Date.now();
    const interactionAge = now - interaction.createdTimestamp;
    if (interactionAge > 14 * 60 * 1000) {
      console.log('تفاعل منتهي الصلاحية - تم تجاهله');
      return false;
    }

    const replyOptions = {
      content: content || '',
      ephemeral: true,
      ...options
    };

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(replyOptions);
      return true;
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(replyOptions);
      return true;
    } else {
      console.log('التفاعل تم الرد عليه مسبقاً أو في حالة غير صالحة');
      return false;
    }
  } catch (error) {
    const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001, 40061];
    if (!ignoredCodes.includes(error.code)) {
      console.error('خطأ في الرد الآمن:', error);
    }
    return false;
  }
}

async function execute(message, args, { responsibilities, points, saveData, BOT_OWNERS, ADMIN_ROLES, client }) {
  // فحص البلوك أولاً
  if (isUserBlocked(message.author.id)) {
    const blockedEmbed = colorManager.createEmbed()
      .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
      .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

    await message.channel.send({ embeds: [blockedEmbed] });
    return;
  }

  // التحقق من الصلاحيات
  const member = await message.guild.members.fetch(message.author.id);
  const hasAdminRole = member.roles.cache.some(role => ADMIN_ROLES.includes(role.id));
  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

  if (!hasAdminRole && !isOwner) {
    await message.react('❌');
    return;
  }

  // Show image source selection buttons
  const serverBannerButton = new ButtonBuilder()
    .setCustomId('setup_use_server_banner')
    .setLabel('Use banner')
    .setStyle(ButtonStyle.Primary);

  const customImageButton = new ButtonBuilder()
    .setCustomId('setup_use_custom_image')
    .setLabel('New image')
    .setStyle(ButtonStyle.Secondary);

  const imageSourceRow = new ActionRowBuilder().addComponents(serverBannerButton, customImageButton);

  const initialEmbed = colorManager.createEmbed()
    .setTitle('**res setup**')
    .setDescription('**اختار بنر السيرفر او صوره خارجيه **')
    .setThumbnail('https://cdn.discordapp.com/attachments/1342455563669475383/1400716396878364764/f15a9fd853c65cb886e6c0e844770871-removebg-preview.png?ex=688da64d&is=688c54cd&hm=837bf456ddfa9aa2df9f195ccfd7c50c6bf12faf2e5283bde8eb98e0aa00240e&');

  const sentMessage = await message.channel.send({
    embeds: [initialEmbed],
    components: [imageSourceRow]
  });

  // Handle image source selection
  const imageSourceFilter = i => i.user.id === message.author.id && i.message.id === sentMessage.id;
  const imageSourceCollector = message.channel.createMessageComponentCollector({
    filter: imageSourceFilter,
    time: 300000
  });

  imageSourceCollector.on('collect', async interaction => {
    try {
      // التحقق من صلاحية التفاعل أولاً
      if (!interaction || !interaction.isRepliable()) {
        console.log('تفاعل غير صالح في اختيار مصدر الصورة');
        return;
      }

      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في اختيار مصدر الصورة');
        return;
      }

      if (interaction.customId === 'setup_use_server_banner') {
        // Use server banner
        let bannerUrl = null;
        try {
          const guild = message.guild;
          if (guild.banner) {
            bannerUrl = guild.bannerURL({ format: 'png', size: 1024 });
          }
        } catch (error) {
          console.error('Error fetching server banner:', error);
        }

        if (!bannerUrl) {
          return safeReply(interaction, '**لا يوجد بنر للسيرفر ! يرجى اختيار صورة أخرى.**');
        }

        // Ask for text to display with banner
        await safeReply(interaction, '**اكتب النص او ارسل__0__ لعدم وضع اي نصوص **');

        // Wait for text response
        const textFilter = m => m.author.id === message.author.id;
        const textCollector = message.channel.createMessageCollector({
          filter: textFilter,
          max: 1
        });

        textCollector.on('collect', async (msg) => {
          try {
            await msg.delete().catch(() => {});
            const customText = msg.content.trim();
            const displayText = customText === '0' ? null : customText;

            try {
              logEvent(client, message.guild, {
                type: 'SETUP_TEXT_INPUT',
                description: 'cp desc',
                user: { id: message.author.id },
                details: displayText || 'No desc'
              });
            } catch (logError) {
              console.error('Failed to log text input:', logError);
            }

            // Setup channel collector
            const channelFilter = m => m.author.id === message.author.id;
            const channelCollector = message.channel.createMessageCollector({
              filter: channelFilter,
              max: 1
            });

            channelCollector.on('collect', async (channelMsg) => {
              try {
                let targetChannel = null;

                // Check if it's a channel mention
                if (channelMsg.mentions.channels.size > 0) {
                  targetChannel = channelMsg.mentions.channels.first();
                } else {
                  // Try to get channel by ID
                  const channelId = channelMsg.content.trim();
                  try {
                    targetChannel = await message.guild.channels.fetch(channelId);
                  } catch (error) {
                    await channelMsg.reply('**لم يتم العثور على الروم ! يرجى المحاولة مرة أخرى.**');
                    return;
                  }
                }

                if (!targetChannel || !targetChannel.isTextBased()) {
                  await channelMsg.reply('**يرجى منشن روم او اي دي**');
                  return;
                }

                // Create a fake interaction object for consistency
                const fakeInteraction = {
                  user: msg.author,
                  reply: async (options) => channelMsg.reply(options),
                  update: async (options) => sentMessage.edit(options)
                };
                await handleImageSelection(fakeInteraction, bannerUrl, responsibilities, message, client, displayText, targetChannel);
              } catch (error) {
                console.error('Error in channel collector:', error);
              }
            });

            channelCollector.on('end', (collected) => {
              try {
                if (collected.size === 0) {
                  message.channel.send('**انتهت مهلة انتظار الروم.**');
                }
              } catch (error) {
                console.error('Error in channel collector end:', error);
              }
            });
          } catch (error) {
            console.error('Error in text collector:', error);
          }
        });

        textCollector.on('end', (collected) => {
          // Remove timeout handling since collector is persistent
        });

      } else if (interaction.customId === 'setup_use_custom_image') {
        // Request custom image
        await safeReply(interaction, '**يرجى إرفاق صورة أو إرسال رابط الصورة:**');

        // Wait for image from user
        const imageFilter = m => m.author.id === message.author.id;
        const imageCollector = message.channel.createMessageCollector({
          filter: imageFilter,
          max: 1
        });

        imageCollector.on('collect', async (msg) => {
          let imageUrl = null;

          if (msg.attachments.size > 0) {
            const attachment = msg.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
              imageUrl = attachment.url;
            } else {
              return msg.reply('**يرجى إرفاق صورة صالحة !**');
            }
          } else if (msg.content.trim()) {
            const url = msg.content.trim();
            if (url.startsWith('http://') || url.startsWith('https://')) {
              // Basic URL validation for images
              if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i) || url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net')) {
                imageUrl = url;
              } else {
                return msg.reply('**يرجى إرسال رابط صورة صالح !**');
              }
            } else {
              return msg.reply('**يرجى إرسال رابط صحيح أو إرفاق صورة !**');
            }
          } else {
            return msg.reply('**يرجى إرفاق صورة أو إرسال رابط !**');
          }

          if (imageUrl) {
            // Ask for text to display with image
            await msg.reply('**اكتب النص مع الصوره او ضع __0__ لعدم وضع نصوص**');

            // Wait for text response
            const textFilter = m => m.author.id === message.author.id;
            const textCollector = message.channel.createMessageCollector({
              filter: textFilter,
              max: 1
            });

            textCollector.on('collect', async (textMsg) => {
              const customText = textMsg.content.trim();
              const displayText = customText === '0' ? null : customText;

              // Ask for channel to send menu
              await textMsg.reply('**منشن الروم أو اكتب آي دي **');

              // Wait for channel response
              const channelFilter = m => m.author.id === message.author.id;
              const channelCollector = message.channel.createMessageCollector({
                filter: channelFilter,
                max: 1
              });

              channelCollector.on('collect', async (channelMsg) => {
                let targetChannel = null;

                // Check if it's a channel mention
                if (channelMsg.mentions.channels.size > 0) {
                  targetChannel = channelMsg.mentions.channels.first();
                } else {
                  // Try to get channel by ID
                  const channelId = channelMsg.content.trim();
                  try {
                    targetChannel = await message.guild.channels.fetch(channelId);
                  } catch (error) {
                    return channelMsg.reply('**لم يتم العثور على الروم ! يرجى المحاولة مرة أخرى.**');
                  }
                }

                if (!targetChannel || !targetChannel.isTextBased()) {
                  return channelMsg.reply('**يرجى منشن روم نصي صحيح **');
                }

                // Create a fake interaction object for consistency
                const fakeInteraction = {
                  user: msg.author,
                  reply: async (options) => channelMsg.reply(options),
                  update: async (options) => sentMessage.edit(options)
                };
                await handleImageSelection(fakeInteraction, imageUrl, responsibilities, message, client, displayText, targetChannel);
              });

              channelCollector.on('end', (collected) => {
                if (collected.size === 0) {
                  message.channel.send('**انتهت مهلة انتظار الروم.**');
                }
              });
            });

            textCollector.on('end', (collected) => {
              // Remove timeout handling since collector is persistent
            });
          }
        });

        imageCollector.on('end', (collected) => {
          // Remove timeout handling since collector is persistent
        });
      }
    } catch (error) {
      console.error('Error in image source selection:', error);
      await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
    }
  });

  imageSourceCollector.on('end', (collected) => {
    if (collected.size === 0) {
      console.log('انتهت مهلة اختيار مصدر الصورة');
    }
  });
}

async function handleImageSelection(interaction, imageUrl, responsibilities, message, client, customText = null, targetChannel = null) {
  try {
    // Build select menu options from responsibilities
    function buildMenuOptions() {
      const options = Object.keys(responsibilities).map(key => ({
        label: key,
        value: key
      }));

      if (options.length === 0) {
        options.push({
          label: 'No res',
          value: 'no_responsibilities',
          description: 'يرجى إضافة مسؤوليات أولاً'
        });
      }

      return options;
    }

    function createSelectMenu() {
      return new StringSelectMenuBuilder()
        .setCustomId('setup_select_responsibility')
        .setPlaceholder('اختر مسؤولية')
        .addOptions(buildMenuOptions());
    }

    const embed = colorManager.createEmbed()
      .setImage(imageUrl);

    // Add custom text if provided
    if (customText) {
      embed.setDescription(`**${customText}**`);
    }

    const row = new ActionRowBuilder().addComponents(createSelectMenu());
    let sentMessage;

    // Send to target channel if specified, otherwise reply normally
    if (targetChannel) {
      try {
        sentMessage = await targetChannel.send({ embeds: [embed], components: [row] });
        console.log(`📤 تم إرسال منيو السيتب الجديد إلى ${targetChannel.name} (${sentMessage.id})`);
        await interaction.reply({ content: `**تم إرسال المنيو إلى ${targetChannel} (ID: ${sentMessage.id})**`, flags: 64 });
      } catch (error) {
        console.error('Failed to send to target channel:', error);
        await interaction.reply({ content: '**فشل في إرسال المنيو للروم المحدد!**', flags: 64 });
        return;
      }
    } else {
      if (interaction.update) {
        sentMessage = await interaction.update({ embeds: [embed], components: [row] });
      } else {
        sentMessage = await interaction.reply({ embeds: [embed], components: [row] });
      }
      console.log(`📤 تم إنشاء منيو السيتب الجديد (${sentMessage.id})`);
    }

    // Store the image URL for later use
    if (!client.setupImageData) {
      client.setupImageData = new Map();
    }
    client.setupImageData.set(sentMessage.id, imageUrl);

    // Function to update menu with current responsibilities
    async function updateMenu() {
      try {
        const newRow = new ActionRowBuilder().addComponents(createSelectMenu());
        if (sentMessage && sentMessage.edit) {
          await sentMessage.edit({ embeds: [embed], components: [newRow] });
        }
      } catch (error) {
        console.error('Failed to update menu:', error);
      }
    }

    // Function to update menu immediately
    async function updateMenuImmediately() {
      try {
        // Reload responsibilities from file to get latest data
        const fs = require('fs');
        const path = require('path');
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

        let currentResponsibilities = {};
        try {
          const data = fs.readFileSync(responsibilitiesPath, 'utf8');
          currentResponsibilities = JSON.parse(data);
        } catch (error) {
          console.log('No responsibilities file found, using empty object');
        }

        // Update the buildMenuOptions function to use current data
        function buildCurrentMenuOptions() {
          const options = Object.keys(currentResponsibilities).map(key => ({
            label: key,
            value: key
          }));

          if (options.length === 0) {
            options.push({
              label: 'No res',
              value: 'no_responsibilities',
              description: 'يرجى إضافة مسؤوليات أولاً'
            });
          }

          return options;
        }

        function createCurrentSelectMenu() {
          return new StringSelectMenuBuilder()
            .setCustomId('setup_select_responsibility')
            .setPlaceholder('اختر مسؤولية')
            .addOptions(buildCurrentMenuOptions());
        }

        const newRow = new ActionRowBuilder().addComponents(createCurrentSelectMenu());
        if (sentMessage && sentMessage.edit) {
          await sentMessage.edit({ embeds: [embed], components: [newRow] });
        }
      } catch (error) {
        console.error('Failed to update menu immediately:', error);
      }
    }

    // Store updater function globally for external updates
    if (!client.setupMenuUpdaters) {
      client.setupMenuUpdaters = new Map();
    }
    client.setupMenuUpdaters.set(sentMessage.id, updateMenuImmediately);

    // Create persistent global collector for setup interactions
    if (!client.setupCollectors) {
      client.setupCollectors = new Map();
    }

    // تنظيف جميع collectors السيتب القديمة في هذه القناة
    const currentChannel = targetChannel || message.channel;
    const collectorsToRemove = [];

    for (const [key, collectorData] of client.setupCollectors.entries()) {
      if (collectorData.channelId === currentChannel.id) {
        console.log(`🧹 إيقاف collector قديم: ${key}`);
        try {
          collectorData.collector.stop();
          if (collectorData.interval) {
            clearInterval(collectorData.interval);
          }
          collectorsToRemove.push(key);
        } catch (error) {
          console.error(`خطأ في إيقاف collector: ${error}`);
          collectorsToRemove.push(key);
        }
      }
    }

    // حذف collectors المتوقفة
    collectorsToRemove.forEach(key => {
      client.setupCollectors.delete(key);
    });

    console.log(`✅ تم تنظيف ${collectorsToRemove.length} collector قديم`);

    // Store collector for this specific message
    const collectorKey = `${sentMessage.id}_${targetChannel ? targetChannel.id : message.channel.id}`;

    // Create new persistent collector using the channel where message was sent
    const messageChannel = targetChannel || message.channel;
    const filter = i => {
      const isCorrectCustomId = i.customId === 'setup_select_responsibility';
      const isCorrectMessage = i.message.id === sentMessage.id;
      const isCorrectChannel = i.channelId === (targetChannel || message.channel).id;

      console.log(`🔍 Collector Filter - CustomId: ${i.customId}, MessageId: ${i.message.id}, Expected: ${sentMessage.id}, Channel: ${i.channelId}`);

      if (isCorrectCustomId && !isCorrectMessage) {
        console.log(`⚠️ تم تجاهل تفاعل من منيو مختلف: ${i.message.id}`);
        return false;
      }

      return isCorrectCustomId && isCorrectMessage && isCorrectChannel;
    };
    const collector = messageChannel.createMessageComponentCollector({ filter }); // Persistent - no timeout

    console.log(`✅ تم إنشاء collector للرسالة ${sentMessage.id} في القناة ${messageChannel.id}`);

    // Auto-refresh every 5 seconds to keep alive and update menu
    const refreshInterval = setInterval(async () => {
      try {
        await updateMenuImmediately();
        console.log('🔄 تم تحديث منيو السيتب تلقائياً');
      } catch (error) {
        console.error('خطأ في التحديث التلقائي للسيتب:', error);
      }
    }, 5000);

    // Store collector and interval
    client.setupCollectors.set(collectorKey, {
      collector: collector,
      interval: refreshInterval,
      messageId: sentMessage.id,
      channelId: targetChannel ? targetChannel.id : message.channel.id
    });

		// تم إزالة زر الإلغاء

		collector.on('collect', async interaction => {
      try {
        console.log(`🔍 معالجة تفاعل في collector: ${interaction.customId}`);
        console.log(`📨 Message ID: ${interaction.message.id}, Expected: ${sentMessage.id}`);

        // فحص البلوك قبل معالجة تفاعلات السيتب
        if (isUserBlocked(interaction.user.id)) {
          try {
            const blockedEmbed = colorManager.createEmbed()
              .setDescription('**🚫 أنت محظور من استخدام السيتب والأوامر**\n**للاستفسار، تواصل مع إدارة السيرفر**')
              .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({ embeds: [blockedEmbed], ephemeral: true });
            }
          } catch (error) {
            console.error('Error sending blocked setup message:', error);
          }
          return;
        }

        // إضافة فحص إضافي للتأكد من أن هذا التفاعل يخص هذا المنيو تحديداً
        if (interaction.message.id !== sentMessage.id) {
          console.log('تم تجاهل تفاعل من منيو مختلف');
          return;
        }

        // التحقق الشامل من صلاحية التفاعل
        if (!interaction || !interaction.isRepliable()) {
          console.log('تفاعل غير صالح في السيتب');
          return;
        }

        // التحقق من عمر التفاعل
        const now = Date.now();
        const interactionTime = interaction.createdTimestamp;
        const timeDiff = now - interactionTime;

        if (timeDiff > 14 * 60 * 1000) {
          console.log('تم تجاهل تفاعل منتهي الصلاحية في السيتب');
          return;
        }

        // منع التفاعلات المتكررة
        if (interaction.replied || interaction.deferred) {
          console.log('تم تجاهل تفاعل متكرر في السيتب');
          return;
        }

        const selected = interaction.values[0];
        console.log(`✅ تم اختيار المسؤولية: ${selected}`);

        // Update menu immediately when responsibility is selected
        try {
          await updateMenuImmediately();
          console.log('✅ تم تحديث المنيو بعد الاختيار');
        } catch (updateError) {
          console.error('خطأ في تحديث المنيو:', updateError);
        }

        if (selected === 'no_responsibilities') {
          return interaction.reply({
            content: '**لا توجد مسؤوليات معرفة حتى الآن. يرجى إضافة مسؤوليات أولاً.**',
            flags: 64
          });
        }

        // Reload current responsibilities data directly from file
        const fs = require('fs');
        const path = require('path');
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

        let currentResponsibilities = {};
        try {
          const data = fs.readFileSync(responsibilitiesPath, 'utf8');
          currentResponsibilities = JSON.parse(data);
        } catch (error) {
          console.error('Failed to load responsibilities:', error);
          return interaction.reply({ content: '**خطأ في تحميل المسؤوليات!**', flags: 64 });
        }

        const responsibility = currentResponsibilities[selected];
        if (!responsibility) {
          // Update menu after failed selection
          await updateMenuImmediately();
          return interaction.reply({ content: '**المسؤولية غير موجودة!**', flags: 64 });
        }

        const desc = responsibility.description && responsibility.description.toLowerCase() !== 'لا'
          ? responsibility.description
          : '**No desc**';

        // Build buttons for each responsible with their nicknames
        const buttons = [];
        const responsiblesList = [];

        if (responsibility.responsibles && responsibility.responsibles.length > 0) {
          for (let i = 0; i < responsibility.responsibles.length; i++) {
            const userId = responsibility.responsibles[i];
            try {
              const guild = interaction.guild || message.guild;
              const member = await guild.members.fetch(userId);
              const displayName = member.displayName || member.user.username;
              responsiblesList.push(`${i + 1}. ${displayName}`);
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`setup_contact_${selected}_${userId}_${interaction.message.id}`)
                  .setLabel(`${i + 1}`)
                  .setStyle(ButtonStyle.Primary)
              );
            } catch (error) {
              console.error(`Failed to fetch member ${userId}:`, error);
              responsiblesList.push(`${i + 1}. User ${userId}`);
              buttons.push(
                new ButtonBuilder()
                  .setCustomId(`setup_contact_${selected}_${userId}_${interaction.message.id}`)
                  .setLabel(`${i + 1}`)
                  .setStyle(ButtonStyle.Primary)
              );
            }
          }
        }

        if (buttons.length > 0) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`setup_contact_${selected}_all_${interaction.message.id}`)
              .setLabel('الكل')
              .setStyle(ButtonStyle.Success)
          );
        }

        // Create embed for the responsibility details with buttons
        const responseEmbed = colorManager.createEmbed()
          .setTitle(`استدعاء مسؤولي: ${selected}`)
          .setDescription(`**الشرح :** *${desc}*\n\n**المسؤولين المتاحين :**\n*${responsiblesList.join('\n')}*\n\n**اختر من تريد استدعائه:**`)
          .setThumbnail('https://cdn.discordapp.com/emojis/1303973825591115846.png?v=1');

        const actionRows = [];
        for (let i = 0; i < buttons.length; i += 5) {
          actionRows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        if (buttons.length === 0) {
          console.log('❌ لا يوجد مسؤولين للمسؤولية');
          return interaction.reply({
            content: `**المسؤولية :** __${selected}__\n**الشرح :** *${desc}*\n**لا يوجد مسؤولين معينين لهذه المسؤولية !**`,
            flags: 64
          });
        }

        console.log(`✅ إرسال إيمبد مع ${buttons.length} أزرار`);
        await interaction.reply({
          embeds: [responseEmbed],
          components: actionRows,
          flags: 64
        });

        // Handle button clicks for contacting responsibles - persistent
        const buttonCollector = (targetChannel || message.channel).createMessageComponentCollector({
          filter: i => i.customId.startsWith('setup_contact_') && i.user.id === interaction.user.id
        });

        buttonCollector.on('collect', async buttonInteraction => {
          try {
            console.log(`🔘 تم الضغط على زر: ${buttonInteraction.customId}`);

            // التحقق من حالة التفاعل أولاً
            if (buttonInteraction.replied || buttonInteraction.deferred) {
              console.log('تم تجاهل تفاعل متكرر في أزرار السيتب');
              return;
            }

            // فحص البلوك قبل معالجة أزرار السيتب
            if (isUserBlocked(buttonInteraction.user.id)) {
              try {
                const blockedEmbed = colorManager.createEmbed()
                  .setDescription('**🚫 أنت محظور من استخدام السيتب والأوامر**\n**للاستفسار، تواصل مع إدارة السيرفر**')
                  .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

                return await safeReply(buttonInteraction, '', { embeds: [blockedEmbed] });
              } catch (error) {
                console.error('Error sending blocked button message:', error);
                return;
              }
            }

            // التحقق من صلاحية التفاعل
            if (!buttonInteraction || !buttonInteraction.isRepliable()) {
              console.log('تفاعل غير صالح في أزرار السيتب');
              return;
            }

            const parts = buttonInteraction.customId.split('_');
            if (parts.length < 5) {
              console.error('خطأ في تحليل customId:', buttonInteraction.customId);
              return await safeReply(buttonInteraction, '**خطأ في معرف الزر!**');
            }

            const responsibilityName = parts[2];
            const target = parts[3]; // userId or 'all'
            const setupMessageId = parts[4];

            console.log(`📋 المسؤولية: ${responsibilityName}, الهدف: ${target}, رسالة السيتب: ${setupMessageId}`);

            // Check cooldown before showing modal
            const cooldownTime = checkCooldown(buttonInteraction.user.id, responsibilityName);
            if (cooldownTime > 0) {
              return await safeReply(buttonInteraction, `**لقد استخدمت هذا الأمر مؤخرًا. يرجى الانتظار ${Math.ceil(cooldownTime / 1000)} ثانية أخرى.**`);
            }

            // Show modal to enter reason only
            const modal = new ModalBuilder()
              .setCustomId(`setup_reason_modal_${responsibilityName}_${target}_${setupMessageId}_${Date.now()}`)
              .setTitle('call reason');

            const reasonInput = new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Reason')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setPlaceholder('اكتب سبب الحاجة للمسؤول...')
              .setMaxLength(1000);

            const reasonRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(reasonRow);

            console.log('📝 إظهار نموذج السبب');
            
            // التحقق مرة أخيرة قبل إظهار المودال
            if (!buttonInteraction.replied && !buttonInteraction.deferred) {
              await buttonInteraction.showModal(modal);
            } else {
              console.log('تم منع إظهار المودال - التفاعل تم الرد عليه مسبقاً');
            }

          } catch (error) {
            console.error('Error in button collector:', error);
            // تجاهل أخطاء التفاعلات المنتهية الصلاحية
            const ignoredCodes = [10008, 40060, 10062, 10003, 50013, 50001];
            if (!ignoredCodes.includes(error.code)) {
              await safeReply(buttonInteraction, '**حدث خطأ أثناء معالجة الطلب.**');
            }
          }
        });

		// Set a timeout to delete the message after 10 minutes if no action is taken
        const deleteTimeout = setTimeout(async () => {
          try {
            await interaction.deleteReply().catch(() => {});
            console.log('تم حذف رسالة الاستدعاء بعد انتهاء الوقت المحدد');
            
            // Update the main setup menu
            try {
              await updateMenuImmediately();
              console.log('تم تحديث المنيو الرئيسي بعد حذف رسالة الاستدعاء');
            } catch (error) {
              console.error('خطأ في تحديث المنيو الرئيسي:', error);
            }
          } catch (error) {
            console.error('خطأ في حذف رسالة الاستدعاء:', error);
          }
        }, 10 * 60 * 1000); // 10 دقائق

        buttonCollector.on('collect', async (buttonInteraction) => {
          // Clear the delete timeout when any button is clicked
          clearTimeout(deleteTimeout);
        });

        buttonCollector.on('end', async (collected, reason) => {
          try {
            console.log(`Button collector ended: ${reason}`);
            
            // Clear the timeout if collector ends for any reason
            clearTimeout(deleteTimeout);

            // Only delete message if collector ended due to timeout or manual stop
            if (reason === 'time' || reason === 'manual') {
              try {
                await interaction.deleteReply().catch(() => {});
                console.log('تم حذف رسالة الاستدعاء');
              } catch (error) {
                console.error('خطأ في حذف رسالة الاستدعاء:', error);
              }

              // Update the main setup menu immediately
              try {
                await updateMenuImmediately();
                console.log('تم تحديث المنيو الرئيسي بعد انتهاء كولكتر الأزرار');
              } catch (error) {
                console.error('خطأ في تحديث المنيو الرئيسي:', error);
              }
            }
          } catch (error) {
            console.error('خطأ في إنهاء button collector:', error);
          }
        });

      } catch (error) {
        console.error('Error in responsibility selection:', error);
        try {
          await interaction.reply({
            content: '**حدث خطأ أثناء معالجة الطلب.**',
            flags: 64
          });
        } catch (replyError) {
          console.error('Failed to send error reply:', replyError);
        }
      }
    });

    // تم إزالة معالج زر الإلغاء

    // Handle collector end with advanced recreation system
    collector.on('end', async (collected, reason) => {
      console.log(`⚠️ Setup collector ended for ${collectorKey}: ${reason}`);

      try {
        // Always recreate the collector if it ends unexpectedly
        console.log('🔄 بدء إعادة إنشاء collector السيتب...');

        // Wait a moment before recreating
        setTimeout(async () => {
          try {
            // Check if the message still exists
            let messageExists = true;
            try {
              await messageChannel.messages.fetch(sentMessage.id);
            } catch (error) {
              console.log('⚠️ الرسالة الأصلية لم تعد موجودة - إنشاء رسالة جديدة');
              messageExists = false;
            }

            if (!messageExists) {
              // Recreate the entire setup menu
              try {
                console.log('🔄 إعادة إنشاء منيو السيتب بالكامل...');
                
                // Delete the old collector data
                if (client.setupCollectors.has(collectorKey)) {
                  const oldCollectorData = client.setupCollectors.get(collectorKey);
                  if (oldCollectorData.interval) {
                    clearInterval(oldCollectorData.interval);
                  }
                  client.setupCollectors.delete(collectorKey);
                }

                // Create new menu
                const newEmbed = colorManager.createEmbed()
                  .setImage(imageUrl);
                
                if (customText) {
                  newEmbed.setDescription(`**${customText}**`);
                }

                function createNewSelectMenu() {
                  // Reload responsibilities from file
                  const fs = require('fs');
                  const path = require('path');
                  const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
                  
                  let currentResponsibilities = {};
                  try {
                    const data = fs.readFileSync(responsibilitiesPath, 'utf8');
                    currentResponsibilities = JSON.parse(data);
                  } catch (error) {
                    console.log('No responsibilities file found, using empty object');
                  }

                  const options = Object.keys(currentResponsibilities).map(key => ({
                    label: key,
                    value: key
                  }));

                  if (options.length === 0) {
                    options.push({
                      label: 'No res',
                      value: 'no_responsibilities',
                      description: 'يرجى إضافة مسؤوليات أولاً'
                    });
                  }

                  return new StringSelectMenuBuilder()
                    .setCustomId('setup_select_responsibility')
                    .setPlaceholder('اختر مسؤولية')
                    .addOptions(options);
                }

                const newRow = new ActionRowBuilder().addComponents(createNewSelectMenu());
                const newSentMessage = await messageChannel.send({ embeds: [newEmbed], components: [newRow] });
                
                console.log(`✅ تم إنشاء منيو سيتب جديد: ${newSentMessage.id}`);
                
                // Update the reference
                sentMessage = newSentMessage;
                
                // Update the collector key
                const newCollectorKey = `${newSentMessage.id}_${messageChannel.id}`;
                
                // Remove the old updater and add new one
                if (client.setupMenuUpdaters) {
                  client.setupMenuUpdaters.delete(sentMessage.id);
                  client.setupMenuUpdaters.set(newSentMessage.id, updateMenuImmediately);
                }

              } catch (recreateError) {
                console.error('❌ فشل في إعادة إنشاء منيو السيتب:', recreateError);
                return;
              }
            }

            // Create new collector
            const newCollector = messageChannel.createMessageComponentCollector({ filter });

            // Copy all event listeners from the original collector
            const originalCollectListener = collector.listeners('collect')[0];
            if (originalCollectListener) {
              newCollector.on('collect', originalCollectListener);
            }

            // Add the end listener recursively
            newCollector.on('end', collector.listeners('end')[0]);

            // Create new refresh interval
            const newRefreshInterval = setInterval(async () => {
              try {
                await updateMenuImmediately();
                console.log('🔄 تم تحديث منيو السيتب المُعاد إنشاؤه تلقائياً');
              } catch (error) {
                console.error('خطأ في التحديث التلقائي للسيتب المُعاد إنشاؤه:', error);
              }
            }, 5000);

            // Update stored collector
            if (client.setupCollectors.has(collectorKey)) {
              const collectorData = client.setupCollectors.get(collectorKey);
              if (collectorData.interval) {
                clearInterval(collectorData.interval);
              }
              collectorData.collector = newCollector;
              collectorData.interval = newRefreshInterval;
              console.log('✅ تم تحديث collector السيتب المحفوظ');
            } else {
              // Create new collector data
              client.setupCollectors.set(collectorKey, {
                collector: newCollector,
                interval: newRefreshInterval,
                messageId: sentMessage.id,
                channelId: messageChannel.id
              });
              console.log('✅ تم إنشاء collector سيتب جديد');
            }

          } catch (error) {
            console.error('❌ فشل في إعادة إنشاء collector السيتب:', error);
          }
        }, 2000); // انتظار ثانيتين قبل إعادة الإنشاء

      } catch (error) {
        console.error('خطأ في معالج إنهاء collector السيتب:', error);
      }
    });

  } catch (error) {
    console.error('Error in handleImageSelection:', error);
    try {
      await interaction.reply({
        content: '**حدث خطأ أثناء معالجة الصورة.**',
        flags: 64
      });
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
}

module.exports = { name, execute, updateAllSetupMenus };