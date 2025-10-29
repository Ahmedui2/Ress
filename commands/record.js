const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const colorManager = require('../utils/colorManager');
const { isUserBlocked } = require('./block.js');
const voiceRecorder = require('../utils/voiceRecorder');
const fileUploader = require('../utils/fileUploader');
const fs = require('fs');
const path = require('path');

const activeSessions = new Map();
const audioPlayers = new Map();

function loadConfig() {
  const { loadConfig } = require('./recorder-setup');
  return loadConfig();
}

function saveConfig(config) {
  const { saveConfig } = require('./recorder-setup');
  return saveConfig(config);
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) {
    const blockedEmbed = colorManager.createEmbed()
      .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
      .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
    await message.channel.send({ embeds: [blockedEmbed] });
    return;
  }

  const config = loadConfig();
  if (!config) {
    const errorEmbed = colorManager.createEmbed()
      .setDescription('**❌ حدث خطأ في تحميل الإعدادات\nيرجى استخدام أمر recorder-setup أولاً**');
    await message.channel.send({ embeds: [errorEmbed] });
    return;
  }

  if (activeSessions.has(message.author.id)) {
    const alreadyRecordingEmbed = colorManager.createEmbed()
      .setDescription('**❌ لديك تسجيل نشط بالفعل! لا يمكن تسجيل أكثر من تسجيل واحد في نفس الوقت**');
    await message.channel.send({ embeds: [alreadyRecordingEmbed] });
    return;
  }

  if (config.cooldowns[message.author.id]) {
    const cooldownEnd = config.cooldowns[message.author.id];
    const now = Date.now();
    
    if (now < cooldownEnd) {
      const remainingMinutes = Math.ceil((cooldownEnd - now) / 60000);
      const cooldownEmbed = colorManager.createEmbed()
        .setDescription(`**⏱️ يجب عليك الانتظار ${remainingMinutes} دقيقة قبل استخدام الأمر مرة أخرى**`);
      await message.channel.send({ embeds: [cooldownEmbed] });
      return;
    } else {
      delete config.cooldowns[message.author.id];
      saveConfig(config);
    }
  }

  const embed = colorManager.createEmbed()
    .setTitle('🎙️ نظام التسجيل الصوتي')
    .setDescription('**اضغط على الزر أدناه لبدء التسجيل**')
    .setFooter({ text: 'اضغط على الزر للتسجيل' });

  if (config.embedImage) {
    embed.setImage(config.embedImage);
  }

  const recordButton = new ButtonBuilder()
    .setCustomId(`record_start_${message.author.id}`)
    .setLabel('تسجيل')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🎙️');

  const row = new ActionRowBuilder().addComponents(recordButton);

  const msg = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({ 
    filter: (i) => i.customId === `record_start_${message.author.id}` && i.user.id === message.author.id,
    time: 300000,
    max: 1
  });

  collector.on('collect', async (interaction) => {
    await handleRecordStart(interaction, message.author, config, client);
  });

  collector.on('end', (collected, reason) => {
    if (reason === 'time') {
      const disabledButton = ButtonBuilder.from(recordButton).setDisabled(true);
      const disabledRow = new ActionRowBuilder().addComponents(disabledButton);
      msg.edit({ components: [disabledRow] }).catch(console.error);
    }
  });
}

async function handleRecordStart(interaction, user, config, client) {
  const member = await interaction.guild.members.fetch(user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ 
      content: '**❌ يجب أن تكون في قناة صوتية لاستخدام هذا الأمر**', 
      flags: 64 
    });
    return;
  }

  if (voiceRecorder.isRecording(voiceChannel.id)) {
    await interaction.reply({ 
      content: '**❌ يوجد تسجيل نشط بالفعل في هذه القناة**', 
      flags: 64 
    });
    return;
  }

  if (activeSessions.has(user.id)) {
    await interaction.reply({ 
      content: '**❌ لديك تسجيل نشط بالفعل! لا يمكن تسجيل أكثر من تسجيل واحد في نفس الوقت**', 
      flags: 64 
    });
    return;
  }

  const progressEmbed = colorManager.createEmbed()
    .setDescription('**🎙️ يبدأ التسجيل...**\n\n⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ 0%');

  const endButton = new ButtonBuilder()
    .setCustomId(`record_end_${user.id}`)
    .setLabel('إنهاء')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⏹️');

  const abuseButton = new ButtonBuilder()
    .setCustomId(`record_abuse_${user.id}`)
    .setLabel('تم السب')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⚠️');

  const row = new ActionRowBuilder().addComponents(endButton, abuseButton);

  await interaction.reply({ embeds: [progressEmbed], components: [row], flags: 64 });

  try {
    const recordingId = await voiceRecorder.startRecording(voiceChannel, user.id);
    
    const session = {
      recordingId,
      userId: user.id,
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      startTime: Date.now(),
      maxDuration: config.recordingDurationMinutes * 60000,
      progressMessage: await interaction.fetchReply(),
      abuseTimes: []
    };

    activeSessions.set(user.id, session);

    const progressInterval = setInterval(async () => {
      if (!activeSessions.has(user.id)) {
        clearInterval(progressInterval);
        return;
      }

      const elapsed = Date.now() - session.startTime;
      const percentage = Math.min((elapsed / session.maxDuration) * 100, 100);
      const bars = Math.floor(percentage / 10);
      const progressBar = '🟩'.repeat(bars) + '⬜'.repeat(10 - bars);

      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      const updatedEmbed = colorManager.createEmbed()
        .setDescription(`**🎙️ جاري التسجيل...**\n\n${progressBar} ${Math.floor(percentage)}%\n⏱️ ${timeStr}`);

      try {
        await session.progressMessage.edit({ embeds: [updatedEmbed], components: [row] });
      } catch (error) {
        clearInterval(progressInterval);
      }

      if (elapsed >= session.maxDuration) {
        clearInterval(progressInterval);
        await handleRecordEnd(session, config, client, true);
      }
    }, 2000);

    session.progressInterval = progressInterval;

    const buttonCollector = session.progressMessage.createMessageComponentCollector({
      filter: (i) => i.user.id === user.id,
      time: session.maxDuration
    });

    buttonCollector.on('collect', async (btnInteraction) => {
      if (btnInteraction.customId === `record_end_${user.id}`) {
        clearInterval(session.progressInterval);
        await btnInteraction.deferUpdate();
        await handleRecordEnd(session, config, client, false);
        buttonCollector.stop();
      } else if (btnInteraction.customId === `record_abuse_${user.id}`) {
        const abuseTime = voiceRecorder.markAbuseTime(session.recordingId);
        session.abuseTimes.push(abuseTime);
        await btnInteraction.reply({ 
          content: `✅ تم تسجيل وقت السب (${Math.floor(abuseTime / 1000)} ثانية من البداية)`, 
          flags: 64 
        });
      }
    });

  } catch (error) {
    console.error('خطأ في بدء التسجيل:', error);
    activeSessions.delete(user.id);
    await interaction.editReply({ 
      content: `**❌ حدث خطأ أثناء بدء التسجيل**\n\`\`\`${error.message}\`\`\``, 
      components: [] 
    });
  }
}

async function handleRecordEnd(session, config, client, autoEnded) {
  try {
    const processingEmbed = colorManager.createEmbed()
      .setDescription('**⏳ جاري معالجة التسجيل...**');

    // محاولة تعديل الرسالة مع معالجة الخطأ
    try {
      await session.progressMessage.edit({ embeds: [processingEmbed], components: [] });
    } catch (editError) {
      // تجاهل أخطاء الرسالة المحذوفة
      if (editError.code !== 10008) {
        console.error('خطأ في تعديل رسالة التقدم:', editError);
      }
    }

    const recordingData = await voiceRecorder.stopRecording(session.recordingId);
    
    activeSessions.delete(session.userId);

    await showRecordingPreview(session, recordingData, config, client);

  } catch (error) {
    console.error('خطأ في إنهاء التسجيل:', error);
    activeSessions.delete(session.userId);
    
    // معالجة خاصة لحالة عدم وجود بيانات صوتية
    let errorMessage = `**❌ حدث خطأ أثناء معالجة التسجيل**\n\`\`\`${error.message}\`\`\``;
    
    if (error.message.includes('لا توجد بيانات صوتية للدمج') || error.message.includes('لم يتحدث أحد')) {
      errorMessage = '**❌ لا يوجد صوت مسجل**\nلم يتحدث أحد في القناة الصوتية أثناء التسجيل.\n\n💡 **نصيحة:** تأكد من التحدث في الميكروفون قبل إنهاء التسجيل';
    }
    
    // محاولة إرسال رسالة خطأ للمستخدم
    try {
      const errorEmbed = colorManager.createEmbed()
        .setDescription(errorMessage);
      
      await session.progressMessage.edit({ embeds: [errorEmbed], components: [] });
    } catch (finalError) {
      // إذا فشل حتى إرسال رسالة الخطأ، أرسل DM للمستخدم
      if (finalError.code === 10008) {
        try {
          const user = await client.users.fetch(session.userId);
          await user.send({ embeds: [colorManager.createEmbed().setDescription(errorMessage)] });
        } catch (dmError) {
          console.error('فشل في إرسال رسالة خاصة للمستخدم:', dmError);
        }
      }
    }
  }
}

async function showRecordingPreview(session, recordingData, config, client) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    const user = await client.users.fetch(session.userId);

    const durationSeconds = Math.floor(recordingData.duration / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;

    const previewEmbed = colorManager.createEmbed()
      .setTitle('🎙️ معاينة التسجيل')
      .setDescription('**تم الانتهاء من التسجيل! يمكنك الآن معاينته قبل الحفظ النهائي**')
      .addFields([
        { name: '⏱️ المدة', value: `${minutes}:${seconds.toString().padStart(2, '0')}`, inline: true },
        { name: '⚠️ أوقات السب', value: `${recordingData.abuseTimes.length}`, inline: true },
        { name: '📁 الحجم', value: fileUploader.formatFileSize(fs.statSync(recordingData.filePath).size), inline: true }
      ]);

    const saveButton = new ButtonBuilder()
      .setCustomId(`preview_save_${session.userId}`)
      .setLabel('حفظ')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const discardButton = new ButtonBuilder()
      .setCustomId(`preview_discard_${session.userId}`)
      .setLabel('حذف')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️');

    const playPreviewButton = new ButtonBuilder()
      .setCustomId(`preview_play_${session.userId}`)
      .setLabel('استماع')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️');

    const row = new ActionRowBuilder().addComponents(playPreviewButton, saveButton, discardButton);

    await session.progressMessage.edit({ embeds: [previewEmbed], components: [row] });

    const previewCollector = session.progressMessage.createMessageComponentCollector({
      filter: (i) => i.user.id === session.userId,
      time: 300000,
      max: 1
    });

    previewCollector.on('collect', async (interaction) => {
      if (interaction.customId === `preview_save_${session.userId}`) {
        await interaction.deferUpdate();
        await saveRecording(session, recordingData, config, client);
      } else if (interaction.customId === `preview_discard_${session.userId}`) {
        await interaction.deferUpdate();
        await discardRecording(session, recordingData);
      } else if (interaction.customId === `preview_play_${session.userId}`) {
        await handlePreviewPlay(interaction, session, recordingData);
      }
    });

    previewCollector.on('end', (collected, reason) => {
      if (reason === 'time') {
        discardRecording(session, recordingData);
        const timeoutEmbed = colorManager.createEmbed()
          .setDescription('**⏰ انتهى وقت المعاينة، تم حذف التسجيل**');
        session.progressMessage.edit({ embeds: [timeoutEmbed], components: [] }).catch(console.error);
      }
    });

  } catch (error) {
    console.error('خطأ في عرض المعاينة:', error);
    cleanupRecording(recordingData.filePath);
  }
}

async function handlePreviewPlay(interaction, session, recordingData) {
  const member = await interaction.guild.members.fetch(session.userId);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ 
      content: '**❌ يجب أن تكون في قناة صوتية للاستماع للتسجيل**', 
      flags: 64 
    });
    return;
  }

  await interaction.reply({ 
    content: '**🎵 جاري تشغيل المعاينة...**', 
    flags: 64 
  });

  try {
    const { joinVoiceChannel } = require('@discordjs/voice');
    
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    const player = createAudioPlayer();
    const resource = createAudioResource(recordingData.filePath);

    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      connection.destroy();
    });

    player.on('error', error => {
      console.error('خطأ في المشغل:', error);
      connection.destroy();
    });

    setTimeout(() => {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
    }, 60000);

  } catch (error) {
    console.error('خطأ في تشغيل المعاينة:', error);
    await interaction.editReply({ content: '**❌ حدث خطأ أثناء التشغيل**' });
  }
}

async function saveRecording(session, recordingData, config, client) {
  try {
    const savingEmbed = colorManager.createEmbed()
      .setDescription('**⏳ جاري حفظ التسجيل وإنشاء الروم...**');
    await session.progressMessage.edit({ embeds: [savingEmbed], components: [] });

    config.cooldowns[session.userId] = Date.now() + (config.cooldownMinutes * 60000);
    saveConfig(config);

    const guild = client.guilds.cache.get(session.guildId);
    const user = await client.users.fetch(session.userId);

    const categoryName = `تسجيل-${user.username}`;
    let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === categoryName);

    if (!category) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: session.userId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]
      });

      if (config.admins.type === 'roles') {
        for (const roleId of config.admins.list) {
          await category.permissionOverwrites.create(roleId, {
            ViewChannel: true,
            SendMessages: true,
            ManageChannels: true
          }).catch(console.error);
        }
      } else {
        for (const memberId of config.admins.list) {
          await category.permissionOverwrites.create(memberId, {
            ViewChannel: true,
            SendMessages: true,
            ManageChannels: true
          }).catch(console.error);
        }
      }
    }

    const recordingChannel = await guild.channels.create({
      name: `recording-${Date.now()}`,
      type: ChannelType.GuildText,
      parent: category.id
    });

    const durationSeconds = Math.floor(recordingData.duration / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;

    const roomEmbed = colorManager.createEmbed()
      .setTitle('🎙️ تسجيل صوتي جديد')
      .setDescription(`**تم إنشاء تسجيل جديد**\n\n**المستخدم:** <@${session.userId}>\n**المدة:** ${minutes}:${seconds.toString().padStart(2, '0')}\n**أوقات السب:** ${recordingData.abuseTimes.length}`)
      .setTimestamp();

    if (config.roomCreationImage) {
      roomEmbed.setImage(config.roomCreationImage);
    }

    // لا نحتاج رفع الملف، فقط نحتفظ به للتشغيل المباشر
    const fileStats = fs.statSync(recordingData.filePath);
    roomEmbed.addFields([
      {
        name: '💿 طريقة الاستماع',
        value: '**اضغط زر "تشغيل" للاستماع المباشر في القناة الصوتية**',
        inline: false
      }
    ]);

    const playButton = new ButtonBuilder()
      .setCustomId(`play_${recordingChannel.id}`)
      .setLabel('تشغيل')
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️');

    const pauseButton = new ButtonBuilder()
      .setCustomId(`pause_${recordingChannel.id}`)
      .setLabel('إيقاف مؤقت')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏸️')
      .setDisabled(true);

    const stopButton = new ButtonBuilder()
      .setCustomId(`stop_${recordingChannel.id}`)
      .setLabel('إيقاف')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️')
      .setDisabled(true);

    const skipButton = new ButtonBuilder()
      .setCustomId(`skip_${recordingChannel.id}`)
      .setLabel('تقديم 10 ث')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏩')
      .setDisabled(true);

    const abuseJumpButton = new ButtonBuilder()
      .setCustomId(`abuse_jump_${recordingChannel.id}`)
      .setLabel('سب')
      .setStyle(ButtonStyle.Warning)
      .setEmoji('⚠️')
      .setDisabled(recordingData.abuseTimes.length === 0);

    const addButton = new ButtonBuilder()
      .setCustomId(`add_member_${recordingChannel.id}`)
      .setLabel('إضافة')
      .setStyle(ButtonStyle.Success)
      .setEmoji('➕');

    const removeButton = new ButtonBuilder()
      .setCustomId(`remove_member_${recordingChannel.id}`)
      .setLabel('إزالة')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('➖');

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${recordingChannel.id}`)
      .setLabel('إغلاق')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const row1 = new ActionRowBuilder().addComponents(playButton, pauseButton, stopButton, skipButton, abuseJumpButton);
    const row2 = new ActionRowBuilder().addComponents(addButton, removeButton, closeButton);

    const messageOptions = { 
      embeds: [roomEmbed], 
      components: [row1, row2]
    };

    // لا نرسل الملف، فقط الإيمبد والأزرار للتشغيل المباشر
    const recordingMessage = await recordingChannel.send(messageOptions);

    audioPlayers.set(recordingChannel.id, {
      filePath: recordingData.filePath,
      abuseTimes: recordingData.abuseTimes,
      userId: session.userId,
      messageId: recordingMessage.id,
      player: null,
      connection: null,
      isPlaying: false,
      isPaused: false,
      currentAbuseIndex: 0,
      lastPlayTime: Date.now()
    });

    // حذف الملف تلقائياً بعد 30 دقيقة من عدم الاستخدام
    setTimeout(() => {
      const playerData = audioPlayers.get(recordingChannel.id);
      if (playerData && !playerData.isPlaying) {
        const timeSinceLastPlay = Date.now() - playerData.lastPlayTime;
        // إذا لم يتم التشغيل خلال 30 دقيقة، احذف الملف
        if (timeSinceLastPlay >= 30 * 60 * 1000) {
          cleanupRecording(recordingData.filePath);
          console.log(`🗑️ تم حذف التسجيل تلقائياً بعد 30 دقيقة من عدم الاستخدام`);
        }
      }
    }, 30 * 60 * 1000);

    setupRecordingHandlers(client, recordingChannel.id, recordingMessage);

    const successEmbed = colorManager.createEmbed()
      .setDescription(`**✅ تم حفظ التسجيل بنجاح في ${recordingChannel}**`);
    await session.progressMessage.edit({ embeds: [successEmbed], components: [] });

  } catch (error) {
    console.error('خطأ في حفظ التسجيل:', error);
    cleanupRecording(recordingData.filePath);
    
    const errorEmbed = colorManager.createEmbed()
      .setDescription(`**❌ حدث خطأ أثناء حفظ التسجيل**\n\`\`\`${error.message}\`\`\``);
    await session.progressMessage.edit({ embeds: [errorEmbed], components: [] });
  }
}

async function discardRecording(session, recordingData) {
  cleanupRecording(recordingData.filePath);
  
  const discardEmbed = colorManager.createEmbed()
    .setDescription('**🗑️ تم حذف التسجيل**');
  await session.progressMessage.edit({ embeds: [discardEmbed], components: [] });
}

function cleanupRecording(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ تم حذف الملف: ${filePath}`);
    }

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.mp3');
    
    fs.readdir(dir, (err, files) => {
      if (err) return;
      
      files.forEach(file => {
        if (file.startsWith(baseName)) {
          const fullPath = path.join(dir, file);
          fs.unlink(fullPath, (err) => {
            if (!err) {
              console.log(`🗑️ تم حذف الملف المرتبط: ${file}`);
            }
          });
        }
      });
    });
  } catch (error) {
    console.error('خطأ في حذف التسجيل:', error);
  }
}

function setupRecordingHandlers(client, channelId, recordingMessage) {
  const handler = async (interaction) => {
    if (!interaction.isButton() || interaction.channelId !== channelId) return;
    
    const playerData = audioPlayers.get(channelId);
    if (!playerData) return;

    try {
      if (interaction.customId === `play_${channelId}`) {
        await handlePlay(interaction, channelId, playerData, recordingMessage);
      } else if (interaction.customId === `pause_${channelId}`) {
        await handlePause(interaction, channelId, playerData, recordingMessage);
      } else if (interaction.customId === `stop_${channelId}`) {
        await handleStop(interaction, channelId, playerData, recordingMessage);
      } else if (interaction.customId === `skip_${channelId}`) {
        await handleSkip(interaction, channelId, playerData);
      } else if (interaction.customId === `abuse_jump_${channelId}`) {
        await handleAbuseJump(interaction, channelId, playerData, recordingMessage);
      } else if (interaction.customId === `add_member_${channelId}`) {
        await handleAddMember(interaction, channelId);
      } else if (interaction.customId === `remove_member_${channelId}`) {
        await handleRemoveMember(interaction, channelId);
      } else if (interaction.customId === `close_${channelId}`) {
        await handleClose(interaction, channelId, playerData, client);
        client.off('interactionCreate', handler);
      }
    } catch (error) {
      console.error('خطأ في معالجة التفاعل:', error);
    }
  };

  client.on('interactionCreate', handler);
}

async function handlePlay(interaction, channelId, playerData, recordingMessage) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ 
      content: '**❌ يجب أن تكون في قناة صوتية للتشغيل**', 
      flags: 64 
    });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  try {
    const { joinVoiceChannel } = require('@discordjs/voice');

    if (!playerData.connection || playerData.connection.state.status === VoiceConnectionStatus.Destroyed) {
      playerData.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
    }

    if (!playerData.player) {
      playerData.player = createAudioPlayer();
      playerData.connection.subscribe(playerData.player);

      playerData.player.on('error', error => {
        console.error('خطأ في المشغل:', error);
        playerData.player = null;
        if (playerData.connection) {
          playerData.connection.destroy();
          playerData.connection = null;
        }
      });

      playerData.player.on(AudioPlayerStatus.Idle, () => {
        playerData.isPlaying = false;
        playerData.isPaused = false;
        updatePlayerButtons(recordingMessage, playerData, channelId);
      });
    }

    if (playerData.isPaused) {
      playerData.player.unpause();
      playerData.isPaused = false;
    } else {
      const resource = createAudioResource(playerData.filePath);
      playerData.player.play(resource);
    }

    playerData.isPlaying = true;
    playerData.lastPlayTime = Date.now(); // تحديث وقت آخر تشغيل

    await updatePlayerButtons(recordingMessage, playerData, channelId);
    await interaction.editReply({ content: '**▶️ بدأ التشغيل**' });

  } catch (error) {
    console.error('خطأ في التشغيل:', error);
    await interaction.editReply({ content: `**❌ حدث خطأ: ${error.message}**` });
  }
}

async function handlePause(interaction, channelId, playerData, recordingMessage) {
  if (!playerData.player || !playerData.isPlaying) {
    await interaction.reply({ content: '**❌ لا يوجد تشغيل نشط**', flags: 64 });
    return;
  }

  playerData.player.pause();
  playerData.isPaused = true;

  await updatePlayerButtons(recordingMessage, playerData, channelId);
  await interaction.reply({ content: '**⏸️ تم إيقاف التشغيل مؤقتاً**', flags: 64 });
}

async function handleStop(interaction, channelId, playerData, recordingMessage) {
  if (playerData.player) {
    playerData.player.stop();
    playerData.player = null;
  }

  if (playerData.connection) {
    playerData.connection.destroy();
    playerData.connection = null;
  }

  playerData.isPlaying = false;
  playerData.isPaused = false;

  await updatePlayerButtons(recordingMessage, playerData, channelId);
  await interaction.reply({ content: '**⏹️ تم إيقاف التشغيل**', flags: 64 });
}

async function handleSkip(interaction, channelId, playerData) {
  await interaction.reply({ content: '**⏩ التقديم غير مدعوم حالياً في MP3 streams**', flags: 64 });
}

async function handleAbuseJump(interaction, channelId, playerData, recordingMessage) {
  if (!playerData.abuseTimes || playerData.abuseTimes.length === 0) {
    await interaction.reply({ content: '**❌ لا توجد أوقات سب مسجلة**', flags: 64 });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ 
      content: '**❌ يجب أن تكون في قناة صوتية للانتقال لوقت السب**', 
      flags: 64 
    });
    return;
  }

  const abuseTime = playerData.abuseTimes[playerData.currentAbuseIndex];
  const seconds = Math.floor(abuseTime / 1000);
  
  playerData.currentAbuseIndex = (playerData.currentAbuseIndex + 1) % playerData.abuseTimes.length;

  await interaction.reply({ 
    content: `**⚠️ وقت السب المسجل: ${seconds} ثانية من البداية**\n*ملاحظة: الانتقال المباشر غير مدعوم في MP3 streams*`, 
    flags: 64 
  });
}

async function updatePlayerButtons(message, playerData, channelId) {
  try {
    const playButton = new ButtonBuilder()
      .setCustomId(`play_${channelId}`)
      .setLabel('تشغيل')
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️')
      .setDisabled(playerData.isPlaying && !playerData.isPaused);

    const pauseButton = new ButtonBuilder()
      .setCustomId(`pause_${channelId}`)
      .setLabel('إيقاف مؤقت')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏸️')
      .setDisabled(!playerData.isPlaying || playerData.isPaused);

    const stopButton = new ButtonBuilder()
      .setCustomId(`stop_${channelId}`)
      .setLabel('إيقاف')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⏹️')
      .setDisabled(!playerData.isPlaying && !playerData.isPaused);

    const skipButton = new ButtonBuilder()
      .setCustomId(`skip_${channelId}`)
      .setLabel('تقديم 10 ث')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏩')
      .setDisabled(true);

    const abuseJumpButton = new ButtonBuilder()
      .setCustomId(`abuse_jump_${channelId}`)
      .setLabel('سب')
      .setStyle(ButtonStyle.Warning)
      .setEmoji('⚠️')
      .setDisabled(!playerData.abuseTimes || playerData.abuseTimes.length === 0);

    const addButton = new ButtonBuilder()
      .setCustomId(`add_member_${channelId}`)
      .setLabel('إضافة')
      .setStyle(ButtonStyle.Success)
      .setEmoji('➕');

    const removeButton = new ButtonBuilder()
      .setCustomId(`remove_member_${channelId}`)
      .setLabel('إزالة')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('➖');

    const closeButton = new ButtonBuilder()
      .setCustomId(`close_${channelId}`)
      .setLabel('إغلاق')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const row1 = new ActionRowBuilder().addComponents(playButton, pauseButton, stopButton, skipButton, abuseJumpButton);
    const row2 = new ActionRowBuilder().addComponents(addButton, removeButton, closeButton);

    await message.edit({ components: [row1, row2] });
  } catch (error) {
    // تجاهل أخطاء الرسائل المحذوفة بصمت
    if (error.code !== 10008) {
      console.error('خطأ في تحديث الأزرار:', error);
    }
  }
}

async function handleAddMember(interaction, channelId) {
  const modal = new ModalBuilder()
    .setCustomId(`add_member_modal_${channelId}_${Date.now()}`)
    .setTitle('إضافة عضو');

  const memberInput = new TextInputBuilder()
    .setCustomId('member_id')
    .setLabel('معرف العضو أو منشن')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('123456789')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(memberInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId.startsWith(`add_member_modal_${channelId}`) && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 60000 });
    let memberId = modalSubmit.fields.getTextInputValue('member_id').replace(/[<@!>]/g, '');
    
    const channel = interaction.guild.channels.cache.get(channelId);
    await channel.permissionOverwrites.create(memberId, {
      ViewChannel: true,
      SendMessages: true
    });

    await modalSubmit.reply({ content: `✅ تمت إضافة <@${memberId}> للقناة`, flags: 64 });
  } catch (error) {
    console.error('خطأ في إضافة عضو:', error);
  }
}

async function handleRemoveMember(interaction, channelId) {
  const modal = new ModalBuilder()
    .setCustomId(`remove_member_modal_${channelId}_${Date.now()}`)
    .setTitle('إزالة عضو');

  const memberInput = new TextInputBuilder()
    .setCustomId('member_id')
    .setLabel('معرف العضو أو منشن')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('123456789')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(memberInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId.startsWith(`remove_member_modal_${channelId}`) && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 60000 });
    let memberId = modalSubmit.fields.getTextInputValue('member_id').replace(/[<@!>]/g, '');
    
    const channel = interaction.guild.channels.cache.get(channelId);
    await channel.permissionOverwrites.delete(memberId);

    await modalSubmit.reply({ content: `✅ تمت إزالة <@${memberId}> من القناة`, flags: 64 });
  } catch (error) {
    console.error('خطأ في إزالة عضو:', error);
  }
}

async function handleClose(interaction, channelId, playerData, client) {
  const modal = new ModalBuilder()
    .setCustomId(`close_report_modal_${channelId}_${Date.now()}`)
    .setTitle('تقرير الإغلاق');

  const reportInput = new TextInputBuilder()
    .setCustomId('report_text')
    .setLabel('ماذا حدث؟ هل صدق العضو؟')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('اكتب التقرير هنا...')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(reportInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId.startsWith(`close_report_modal_${channelId}`) && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 300000 });
    const reportText = modalSubmit.fields.getTextInputValue('report_text');
    
    const config = loadConfig();
    if (config.reportChannel) {
      const reportChannel = interaction.guild.channels.cache.get(config.reportChannel);
      if (reportChannel) {
        const reportEmbed = colorManager.createEmbed()
          .setTitle('📝 تقرير تسجيل')
          .setDescription(reportText)
          .addFields([
            { name: 'المستخدم', value: `<@${playerData.userId}>`, inline: true },
            { name: 'المسؤول', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'القناة', value: `<#${channelId}>`, inline: true }
          ])
          .setTimestamp();

        await reportChannel.send({ embeds: [reportEmbed] });
      }
    }

    if (playerData.player) {
      playerData.player.stop();
    }
    if (playerData.connection) {
      playerData.connection.destroy();
    }

    const deleteButton = new ButtonBuilder()
      .setCustomId(`delete_channel_${channelId}_${Date.now()}`)
      .setLabel('حذف')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️');

    const keepButton = new ButtonBuilder()
      .setCustomId(`keep_channel_${channelId}_${Date.now()}`)
      .setLabel('إبقاء')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📌');

    const actionRow = new ActionRowBuilder().addComponents(deleteButton, keepButton);

    await modalSubmit.reply({ 
      content: '**اختر الإجراء:**', 
      components: [actionRow], 
      ephemeral: false
    });

    const channel = interaction.guild.channels.cache.get(channelId);
    const buttonCollector = channel.createMessageComponentCollector({ time: 300000 });

    buttonCollector.on('collect', async (btnInt) => {
      if (btnInt.customId.startsWith(`delete_channel_${channelId}`)) {
        await btnInt.reply({ content: '🗑️ جاري حذف القناة والملفات...', flags: 64 });
        
        // إيقاف التشغيل إن كان نشطاً
        if (playerData.player) {
          playerData.player.stop();
        }
        if (playerData.connection) {
          playerData.connection.destroy();
        }
        
        // حذف الملف فوراً
        cleanupRecording(playerData.filePath);
        audioPlayers.delete(channelId);
        
        setTimeout(async () => {
          await channel.delete();
        }, 2000);
        
        buttonCollector.stop();
      } else if (btnInt.customId.startsWith(`keep_channel_${channelId}`)) {
        await channel.permissionOverwrites.delete(playerData.userId);
        
        const keepButton = new ButtonBuilder()
          .setCustomId(`final_delete_${channelId}_${Date.now()}`)
          .setLabel('حذف')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️');

        const finalRow = new ActionRowBuilder().addComponents(keepButton);

        await btnInt.update({ 
          content: '✅ تم إخفاء القناة عن العضو', 
          components: [finalRow]
        });

        const finalCollector = channel.createMessageComponentCollector({ time: 600000 });

        finalCollector.on('collect', async (finalInt) => {
          if (finalInt.customId.startsWith(`final_delete_${channelId}`)) {
            await finalInt.reply({ content: '🗑️ جاري حذف القناة والملفات...', flags: 64 });
            
            cleanupRecording(playerData.filePath);
            audioPlayers.delete(channelId);
            
            setTimeout(async () => {
              await channel.delete();
            }, 2000);
            
            finalCollector.stop();
          }
        });

        buttonCollector.stop();
      }
    });

  } catch (error) {
    console.error('خطأ في معالجة الإغلاق:', error);
  }
}

module.exports = {
  name: 'record',
  description: 'بدء تسجيل صوتي',
  execute
};
