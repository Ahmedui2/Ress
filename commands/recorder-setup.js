const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager');
const { isUserBlocked } = require('./block.js');

const configPath = path.join(__dirname, '..', 'data', 'recorder-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
    return {
      embedImage: null,
      roomCreationImage: null,
      admins: { type: "roles", list: [] },
      cooldownMinutes: 30,
      recordingDurationMinutes: 10,
      reportChannel: null,
      activeRecordings: {},
      cooldowns: {}
    };
  } catch (error) {
    console.error('خطأ في قراءة إعدادات التسجيل:', error);
    return null;
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('خطأ في حفظ إعدادات التسجيل:', error);
    return false;
  }
}

async function execute(message, args, { client, BOT_OWNERS }) {
  if (isUserBlocked(message.author.id)) {
    const blockedEmbed = colorManager.createEmbed()
      .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
      .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));
    await message.channel.send({ embeds: [blockedEmbed] });
    return;
  }

  const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
  if (!isOwner) {
    await message.react('❌');
    return;
  }

  const config = loadConfig();
  if (!config) {
    const errorEmbed = colorManager.createEmbed()
      .setDescription('**❌ حدث خطأ في تحميل الإعدادات**');
    await message.channel.send({ embeds: [errorEmbed] });
    return;
  }

  const embed = createSetupEmbed(config, client);
  const menu = createSetupMenu();
  const row = new ActionRowBuilder().addComponents(menu);

  const msg = await message.channel.send({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({ 
    filter: (i) => i.user.id === message.author.id,
    time: 300000 
  });

  collector.on('collect', async (interaction) => {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId === 'recorder_setup_menu') {
        const value = interaction.values[0];

        switch (value) {
          case 'embed_image':
            await handleEmbedImage(interaction, config, client);
            break;
          case 'room_image':
            await handleRoomImage(interaction, config, client);
            break;
          case 'admins':
            await handleAdmins(interaction, config, client);
            break;
          case 'cooldown':
            await handleCooldown(interaction, config, client);
            break;
          case 'duration':
            await handleDuration(interaction, config, client);
            break;
          case 'report_channel':
            await handleReportChannel(interaction, config, client);
            break;
        }

        const updatedEmbed = createSetupEmbed(config, client);
        await msg.edit({ embeds: [updatedEmbed], components: [row] });
      }
    } catch (error) {
      console.error('خطأ في معالجة التفاعل:', error);
    }
  });

  collector.on('end', () => {
    const disabledRow = new ActionRowBuilder().addComponents(
      menu.setDisabled(true)
    );
    msg.edit({ components: [disabledRow] }).catch(console.error);
  });
}

function createSetupEmbed(config, client) {
  const embed = colorManager.createEmbed()
    .setTitle('⚙️ إعدادات نظام التسجيل الصوتي')
    .setDescription('**اختر من القائمة أدناه لتعديل الإعدادات:**')
    .addFields([
      {
        name: '🖼️ صورة الإيمبد',
        value: config.embedImage || '`لم يتم التحديد`',
        inline: false
      },
      {
        name: '🖼️ صورة إنشاء الروم',
        value: config.roomCreationImage || '`لم يتم التحديد`',
        inline: false
      },
      {
        name: '👥 المسؤولين',
        value: config.admins.list.length > 0 
          ? `النوع: ${config.admins.type === 'roles' ? 'رولات' : 'أعضاء'}\nالعدد: ${config.admins.list.length}`
          : '`لم يتم التحديد`',
        inline: true
      },
      {
        name: '⏱️ مدة الكولداون',
        value: `${config.cooldownMinutes} دقيقة`,
        inline: true
      },
      {
        name: '🎙️ مدة التسجيل',
        value: `${config.recordingDurationMinutes} دقيقة`,
        inline: true
      },
      {
        name: '📝 قناة التقارير',
        value: config.reportChannel ? `<#${config.reportChannel}>` : '`لم يتم التحديد`',
        inline: false
      }
    ])
    .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

  return embed;
}

function createSetupMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId('recorder_setup_menu')
    .setPlaceholder('اختر إعداداً لتعديله')
    .addOptions([
      {
        label: 'صورة الإيمبد',
        description: 'تحديد صورة الإيمبد لأمر التسجيل',
        value: 'embed_image',
        emoji: '🖼️'
      },
      {
        label: 'صورة إنشاء الروم',
        description: 'تحديد صورة تظهر عند إنشاء روم التسجيل',
        value: 'room_image',
        emoji: '🖼️'
      },
      {
        label: 'المسؤولين',
        description: 'تحديد المسؤولين الذين يرون الروم',
        value: 'admins',
        emoji: '👥'
      },
      {
        label: 'مدة الكولداون',
        description: 'تحديد مدة الكولداون بعد الطلب',
        value: 'cooldown',
        emoji: '⏱️'
      },
      {
        label: 'مدة التسجيل',
        description: 'تحديد مدة جلسة التسجيل القصوى',
        value: 'duration',
        emoji: '🎙️'
      },
      {
        label: 'قناة التقارير',
        description: 'تحديد قناة إرسال التقارير',
        value: 'report_channel',
        emoji: '📝'
      }
    ]);
}

async function handleEmbedImage(interaction, config, client) {
  const modal = new ModalBuilder()
    .setCustomId('recorder_embed_image_modal')
    .setTitle('صورة الإيمبد');

  const imageInput = new TextInputBuilder()
    .setCustomId('image_url')
    .setLabel('رابط الصورة')
    .setStyle(TextInputStyle.Short)
    .setValue(config.embedImage || '')
    .setPlaceholder('https://example.com/image.png')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(imageInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId === 'recorder_embed_image_modal' && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 120000 });
    const imageUrl = modalSubmit.fields.getTextInputValue('image_url');
    
    config.embedImage = imageUrl;
    saveConfig(config);

    await modalSubmit.reply({ content: '✅ تم حفظ صورة الإيمبد بنجاح', ephemeral: true });
  } catch (error) {
    console.error('خطأ في معالجة المودال:', error);
  }
}

async function handleRoomImage(interaction, config, client) {
  const modal = new ModalBuilder()
    .setCustomId('recorder_room_image_modal')
    .setTitle('صورة إنشاء الروم');

  const imageInput = new TextInputBuilder()
    .setCustomId('image_url')
    .setLabel('رابط الصورة')
    .setStyle(TextInputStyle.Short)
    .setValue(config.roomCreationImage || '')
    .setPlaceholder('https://example.com/image.png')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(imageInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId === 'recorder_room_image_modal' && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 120000 });
    const imageUrl = modalSubmit.fields.getTextInputValue('image_url');
    
    config.roomCreationImage = imageUrl;
    saveConfig(config);

    await modalSubmit.reply({ content: '✅ تم حفظ صورة إنشاء الروم بنجاح', ephemeral: true });
  } catch (error) {
    console.error('خطأ في معالجة المودال:', error);
  }
}

async function handleAdmins(interaction, config, client) {
  const typeMenu = new StringSelectMenuBuilder()
    .setCustomId('admin_type_select')
    .setPlaceholder('اختر نوع المسؤولين')
    .addOptions([
      {
        label: 'رولات',
        value: 'roles',
        description: 'تحديد رولات المسؤولين',
        emoji: '👥'
      },
      {
        label: 'أعضاء',
        value: 'members',
        description: 'تحديد أعضاء محددين',
        emoji: '👤'
      }
    ]);

  const row = new ActionRowBuilder().addComponents(typeMenu);

  await interaction.reply({ 
    content: '**اختر نوع المسؤولين:**', 
    components: [row], 
    ephemeral: true 
  });

  const typeCollector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.customId === 'admin_type_select' && i.user.id === interaction.user.id,
    time: 60000,
    max: 1
  });

  typeCollector.on('collect', async (typeInt) => {
    const type = typeInt.values[0];
    
    const modal = new ModalBuilder()
      .setCustomId('recorder_admins_modal')
      .setTitle(`تحديد ${type === 'roles' ? 'الرولات' : 'الأعضاء'}`);

    const idsInput = new TextInputBuilder()
      .setCustomId('admin_ids')
      .setLabel(`أدخل معرفات ${type === 'roles' ? 'الرولات' : 'الأعضاء'} (مفصولة بفواصل)`)
      .setStyle(TextInputStyle.Paragraph)
      .setValue(config.admins.list.join(', '))
      .setPlaceholder('123456789, 987654321')
      .setRequired(true);

    const modalRow = new ActionRowBuilder().addComponents(idsInput);
    modal.addComponents(modalRow);

    await typeInt.showModal(modal);

    const filter = (i) => i.customId === 'recorder_admins_modal' && i.user.id === interaction.user.id;
    
    try {
      const modalSubmit = await typeInt.awaitModalSubmit({ filter, time: 120000 });
      const idsText = modalSubmit.fields.getTextInputValue('admin_ids');
      const ids = idsText.split(',').map(id => id.trim()).filter(id => id);
      
      config.admins = { type, list: ids };
      saveConfig(config);

      await modalSubmit.reply({ 
        content: `✅ تم حفظ ${type === 'roles' ? 'الرولات' : 'الأعضاء'} بنجاح (${ids.length})`, 
        ephemeral: true 
      });
    } catch (error) {
      console.error('خطأ في معالجة المودال:', error);
    }
  });
}

async function handleCooldown(interaction, config, client) {
  const modal = new ModalBuilder()
    .setCustomId('recorder_cooldown_modal')
    .setTitle('مدة الكولداون');

  const minutesInput = new TextInputBuilder()
    .setCustomId('cooldown_minutes')
    .setLabel('أدخل مدة الكولداون بالدقائق')
    .setStyle(TextInputStyle.Short)
    .setValue(config.cooldownMinutes.toString())
    .setPlaceholder('30')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(minutesInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId === 'recorder_cooldown_modal' && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 120000 });
    const minutes = parseInt(modalSubmit.fields.getTextInputValue('cooldown_minutes'));
    
    if (isNaN(minutes) || minutes < 1) {
      await modalSubmit.reply({ content: '❌ يرجى إدخال رقم صحيح', ephemeral: true });
      return;
    }
    
    config.cooldownMinutes = minutes;
    saveConfig(config);

    await modalSubmit.reply({ content: `✅ تم حفظ مدة الكولداون: ${minutes} دقيقة`, ephemeral: true });
  } catch (error) {
    console.error('خطأ في معالجة المودال:', error);
  }
}

async function handleDuration(interaction, config, client) {
  const modal = new ModalBuilder()
    .setCustomId('recorder_duration_modal')
    .setTitle('مدة التسجيل');

  const minutesInput = new TextInputBuilder()
    .setCustomId('duration_minutes')
    .setLabel('أدخل مدة التسجيل القصوى بالدقائق')
    .setStyle(TextInputStyle.Short)
    .setValue(config.recordingDurationMinutes.toString())
    .setPlaceholder('10')
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(minutesInput);
  modal.addComponents(row);

  await interaction.showModal(modal);

  const filter = (i) => i.customId === 'recorder_duration_modal' && i.user.id === interaction.user.id;
  
  try {
    const modalSubmit = await interaction.awaitModalSubmit({ filter, time: 120000 });
    const minutes = parseInt(modalSubmit.fields.getTextInputValue('duration_minutes'));
    
    if (isNaN(minutes) || minutes < 1) {
      await modalSubmit.reply({ content: '❌ يرجى إدخال رقم صحيح', ephemeral: true });
      return;
    }
    
    config.recordingDurationMinutes = minutes;
    saveConfig(config);

    await modalSubmit.reply({ content: `✅ تم حفظ مدة التسجيل: ${minutes} دقيقة`, ephemeral: true });
  } catch (error) {
    console.error('خطأ في معالجة المودال:', error);
  }
}

async function handleReportChannel(interaction, config, client) {
  const channelMenu = new StringSelectMenuBuilder()
    .setCustomId('report_channel_select')
    .setPlaceholder('اختر قناة التقارير')
    .addOptions(
      interaction.guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText)
        .map(ch => ({
          label: ch.name,
          value: ch.id,
          description: `#${ch.name}`
        }))
        .slice(0, 25)
    );

  const row = new ActionRowBuilder().addComponents(channelMenu);

  await interaction.reply({ 
    content: '**اختر قناة التقارير:**', 
    components: [row], 
    ephemeral: true 
  });

  const channelCollector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.customId === 'report_channel_select' && i.user.id === interaction.user.id,
    time: 60000,
    max: 1
  });

  channelCollector.on('collect', async (channelInt) => {
    const channelId = channelInt.values[0];
    
    config.reportChannel = channelId;
    saveConfig(config);

    await channelInt.update({ 
      content: `✅ تم حفظ قناة التقارير: <#${channelId}>`, 
      components: [] 
    });
  });
}

module.exports = {
  name: 'recorder-setup',
  description: 'إعداد نظام التسجيل الصوتي',
  execute,
  loadConfig,
  saveConfig
};
