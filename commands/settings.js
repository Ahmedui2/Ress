const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logEvent } = require('../utils/logs_system.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');
const fs = require('fs');
const path = require('path');

const name = 'settings';

const activeCommandCollectors = new Map();

const responsibleRolesPath = path.join(__dirname, '..', 'data', 'responsibleRoles.json');

function loadResponsibleRoles() {
  try {
    if (fs.existsSync(responsibleRolesPath)) {
      const data = fs.readFileSync(responsibleRolesPath, 'utf8');
      const roles = JSON.parse(data);
      return Array.isArray(roles) ? roles : [];
    }
    return [];
  } catch (error) {
    console.error('خطأ في قراءة responsibleRoles:', error);
    return [];
  }
}

function saveResponsibleRoles(roles) {
  try {
    const finalRoles = Array.isArray(roles) ? roles : [];
    fs.writeFileSync(responsibleRolesPath, JSON.stringify(finalRoles, null, 2));
    console.log('✅ تم حفظ رولات المسؤولين في JSON');
    return true;
  } catch (error) {
    console.error('خطأ في حفظ responsibleRoles:', error);
    return false;
  }
}

async function execute(message, args, { responsibilities, client, scheduleSave, BOT_OWNERS }) {
  if (activeCommandCollectors.has(message.author.id)) {
    const oldCollector = activeCommandCollectors.get(message.author.id);
    oldCollector.stop('new_command');
  }

  // فحص البلوك أولاً
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

  // حفظ البيانات في الملف مباشرة
  async function saveResponsibilities() {
    try {
      const fs = require('fs');
      const path = require('path');
      const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

      if (!fs.existsSync(path.dirname(responsibilitiesPath))) {
        fs.mkdirSync(path.dirname(responsibilitiesPath), { recursive: true });
      }

      fs.writeFileSync(responsibilitiesPath, JSON.stringify(responsibilities, null, 2));
      console.log('✅ [SETTINGS] تم حفظ المسؤوليات بنجاح');

      // Update all setup menus
      try {
        const setupCommand = client.commands.get('setup');
        if (setupCommand && setupCommand.updateAllSetupMenus) {
          setupCommand.updateAllSetupMenus(client);
        }
      } catch (error) {
        console.error('خطأ في تحديث منيو السيتب:', error);
}
try {
        const respCommand = client.commands.get('resp');
        if (respCommand && respCommand.updateEmbedMessage) {
          await respCommand.updateEmbedMessage(client);
          console.log('✅ [SETTINGS] تم تحديث إيمبد Resp');
        }
      } catch (error) {
        console.error('خطأ في تحديث إيمبد Resp:', error);
      }

      return true;
    } catch (error) {
      console.error('❌ [SETTINGS] خطأ في حفظ المسؤوليات:', error.message);
      return false;
    }
  }

  // دالة لترتيب المسؤوليات حسب خاصية order أو أبجدياً
  function getOrderedResponsibilities() {
    const keys = Object.keys(responsibilities);
    
    // فرز حسب خاصية order إذا كانت موجودة، وإلا أبجدياً
    return keys.sort((a, b) => {
      const orderA = responsibilities[a].order ?? 999999;
      const orderB = responsibilities[b].order ?? 999999;
      
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      
      // إذا كان الترتيب متساوي، فرز أبجدياً
      return a.localeCompare(b, 'ar');
    });
  }
  
  // دالة لإعادة ترقيم المسؤوليات بعد التعديل
  function reorderResponsibilities() {
    const orderedKeys = getOrderedResponsibilities();
    orderedKeys.forEach((key, index) => {
      responsibilities[key].order = index;
    });
  }

  // دالة لإنشاء منيو مقسم إلى صفحات
  function createPaginatedMenu(page = 0) {
    const orderedKeys = getOrderedResponsibilities();
    const ITEMS_PER_PAGE = 24; // ترك مساحة لخيار "إضافة مسؤولية"
    const totalPages = Math.ceil(orderedKeys.length / ITEMS_PER_PAGE);
    
    // التأكد من أن رقم الصفحة صحيح
    if (page < 0) page = 0;
    if (page >= totalPages && totalPages > 0) page = totalPages - 1;
    
    const startIndex = page * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, orderedKeys.length);
    const pageKeys = orderedKeys.slice(startIndex, endIndex);
    
    const options = pageKeys.map(key => ({
      label: key,
      description: responsibilities[key].description ? responsibilities[key].description.substring(0, 50) : 'لا يوجد شرح',
      value: key
    }));

    // إضافة خيار إنشاء مسؤولية جديدة
    options.push({
      label: 'res add',
      description: 'إنشاء مسؤولية جديدة',
      value: 'add_new'
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('settings_select_responsibility')
      .setPlaceholder('اختر مسؤولية')
      .addOptions(options);

    const components = [new ActionRowBuilder().addComponents(selectMenu)];
    
    // إضافة أزرار التنقل إذا كان هناك أكثر من صفحة
    if (totalPages > 1) {
      const navButtons = [];
      
      if (page > 0) {
        navButtons.push(
          new ButtonBuilder()
            .setCustomId(`page_prev_${page}`)
            .setLabel('◀ السابق')
            .setStyle(ButtonStyle.Primary)
        );
      }
      
      navButtons.push(
        new ButtonBuilder()
          .setCustomId(`page_info_${page}`)
          .setLabel(`صفحة ${page + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      
      if (page < totalPages - 1) {
        navButtons.push(
          new ButtonBuilder()
            .setCustomId(`page_next_${page}`)
            .setLabel('التالي ▶')
            .setStyle(ButtonStyle.Primary)
        );
      }
      
      components.push(new ActionRowBuilder().addComponents(navButtons));
    }
    
    return { components, currentPage: page, totalPages };
  }

  // تتبع الصفحة الحالية لكل مستخدم
  const userPages = new Map();

  async function sendSettingsMenu(page = 0) {
    userPages.set(message.author.id, page);
    
    const embed = colorManager.createEmbed()
      .setTitle('**Res sys**')
      .setDescription('Choose res or edit it')
      .setFooter({ text: 'By Ahmed.' })
      .setThumbnail('https://cdn.discordapp.com/emojis/1186585722401063032.png?v=1');

    const menuData = createPaginatedMenu(page);
    
    return await message.channel.send({ embeds: [embed], components: menuData.components });
  }

  const sentMessage = await sendSettingsMenu();

  // Collector with a 5-minute timeout
  const filter = i => i.user.id === message.author.id;
  const collector = message.channel.createMessageComponentCollector({ filter, time: 300000 });

  activeCommandCollectors.set(message.author.id, collector);

  const refreshInterval = setInterval(async () => {
    try {
      await updateMainMenu();
    } catch (error) {
      console.error('خطأ في التحديث التلقائي:', error);
    }
  }, 60000);

  collector.on('end', (collected, reason) => {
    activeCommandCollectors.delete(message.author.id);
    console.log(`Settings collector for ${message.author.id} ended. Reason: ${reason}`);
    if (reason !== 'new_command') {
      sentMessage.edit({ content: '**انتهت صلاحية هذه القائمة.**', components: [] }).catch(() => {});
    }
  });

  async function updateMainMenu(page = null) {
    try {
      // استخدام الصفحة المحفوظة للمستخدم إذا لم يتم تحديد صفحة
      if (page === null) {
        page = userPages.get(message.author.id) || 0;
      } else {
        userPages.set(message.author.id, page);
      }
      
      const embed = colorManager.createEmbed()
        .setTitle('**Res sys**')
        .setDescription('Choose res or edit it')
        .setFooter({ text: 'By Ahmed.' })
        .setThumbnail('https://cdn.discordapp.com/emojis/1186585722401063032.png?v=1');

      const menuData = createPaginatedMenu(page);
      
      await sentMessage.edit({ embeds: [embed], components: menuData.components });
    } catch (error) {
      console.error('خطأ في تحديث المنيو الرئيسي:', error);
    }
  }

  // إدارة الـ collectors النشطة لكل مسؤولية
  const activeCollectors = new Map();

  async function generateManagementContent(responsibilityName) {
    const responsibility = responsibilities[responsibilityName];
    const responsiblesList = responsibility.responsibles || [];
    let responsiblesText = '';

    if (responsiblesList.length > 0) {
      for (let i = 0; i < responsiblesList.length; i++) {
        try {
          const member = await message.guild.members.fetch(responsiblesList[i]);
          responsiblesText += `**${i + 1}.** ${member.displayName || member.user.username} (<@${responsiblesList[i]}>)\n`;
        } catch (error) {
          responsiblesText += `**${i + 1}.** مستخدم محذوف (${responsiblesList[i]})\n`;
        }
      }
    } else {
      responsiblesText = '**لا يوجد مسؤولين معينين**';
    }

    const embed = colorManager.createEmbed()
      .setTitle(`**Manage resb : ${responsibilityName}**`)
      .setDescription(`**المسؤولون الحاليون :**\n${responsiblesText}\n\n**للاضافة منشن وللحذف حط رقم المسؤول وعند الانتهاء اكتب تم**`)
      .setFooter({ text: 'By Ahmed.' });

    const backButton = new ButtonBuilder()
      .setCustomId(`back_to_main_${responsibilityName}`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(backButton);
    return { embeds: [embed], components: [row] };
  }

  async function showResponsibleManagement(interaction, responsibilityName) {
    try {
      const responsibility = responsibilities[responsibilityName];
      if (!responsibility) {
        return await safeReply(interaction, '**المسؤولية غير موجودة!**');
      }

      const existingCollector = activeCollectors.get(responsibilityName);
      if (existingCollector) {
        existingCollector.stop('new_session');
        activeCollectors.delete(responsibilityName);
      }

      const content = await generateManagementContent(responsibilityName);
      
      // إضافة زر البحث بعد زر Back
      const searchButton = new ButtonBuilder()
        .setCustomId(`search_${responsibilityName}`)
        .setLabel('🔍 بحث وإضافة')
        .setStyle(ButtonStyle.Success);

      content.components[0].addComponents(searchButton);

      // We need to reply to the interaction first, then we can edit that reply later.
      if (!interaction.replied && !interaction.deferred) {
        await interaction.update(content);
      }

      const messageFilter = m => m.author.id === interaction.user.id && m.channel.id === message.channel.id;
      const messageCollector = message.channel.createMessageCollector({
        filter: messageFilter,
        time: 300000 // 5 minutes
      });

      activeCollectors.set(responsibilityName, messageCollector);

      // إضافة collector للأزرار في صفحة إدارة المسؤولين
      const buttonFilter = i => i.user.id === interaction.user.id && i.customId.startsWith('search_');
      const buttonCollector = message.channel.createMessageComponentCollector({ 
        filter: buttonFilter,
        time: 300000 
      });

      buttonCollector.on('collect', async (buttonInt) => {
        try {
          if (buttonInt.customId === `search_${responsibilityName}`) {
            // إظهار نافذة البحث عن الأعضاء
            const modal = new ModalBuilder()
              .setCustomId(`search_members_modal_${responsibilityName}`)
              .setTitle('بحث عن أعضاء');

            const searchInput = new TextInputBuilder()
              .setCustomId('search_query')
              .setLabel('اكتب اسم العضو للبحث')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: Ahmed, محمد, Ali');

            const actionRow = new ActionRowBuilder().addComponents(searchInput);
            modal.addComponents(actionRow);
            await buttonInt.showModal(modal);
          }
        } catch (error) {
          console.error('خطأ في معالج أزرار إدارة المسؤولين:', error);
        }
      });

      messageCollector.on('end', () => {
        buttonCollector.stop();
      });

      messageCollector.on('collect', async (msg) => {
        try {
          await msg.delete().catch(() => {});

          const content = msg.content.trim();
          const lowerContent = content.toLowerCase();

          if (lowerContent === 'تم' || lowerContent === 'done') {
            messageCollector.stop('user_done');
            await updateMainMenu();
            return;
          }

          if (/^\d+$/.test(content)) {
            const index = parseInt(content) - 1;
            const currentResponsibles = responsibility.responsibles || [];

            if (index >= 0 && index < currentResponsibles.length) {
              const removedUserId = currentResponsibles[index];

              let removedMember = null;
              try {
                removedMember = await message.guild.members.fetch(removedUserId);
              } catch (error) {
                console.log(`لا يمكن جلب معلومات المستخدم ${removedUserId}`);
              }

              responsibility.responsibles.splice(index, 1);
              await saveResponsibilities();

              // إزالة جميع رولات المسؤولية من المسؤول المحذوف
              if (removedMember && responsibility.roles && responsibility.roles.length > 0) {
                for (const roleId of responsibility.roles) {
                  try {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role && removedMember.roles.cache.has(roleId)) {
                      await removedMember.roles.remove(roleId);
                      console.log(`✅ تم إزالة رول ${role.name} من ${removedMember.displayName}`);
                    }
                  } catch (error) {
                    console.log(`لا يمكن إزالة رول ${roleId} من ${removedUserId}: ${error.message}`);
                  }
                }
              }

              if (removedMember) {
                try {
                  const removalEmbed = colorManager.createEmbed()
                    .setTitle('Deleted ')
                    .setDescription(`**تم إزالتك من مسؤولية: ${responsibilityName}**`)
                    .addFields([
                      { name: 'المسؤولية', value: responsibilityName, inline: true },
                      { name: 'السيرفر', value: message.guild.name, inline: true },
                      { name: 'تمت الإزالة بواسطة', value: interaction.user.tag, inline: true }
                    ])
                    .setTimestamp();

                  await removedMember.send({ embeds: [removalEmbed] });
                } catch (error) {
                  console.log(`لا يمكن إرسال رسالة للمستخدم ${removedUserId}: ${error.message}`);
                }
              }

              await safeFollowUp(interaction, `**✅ تم حذف المسؤول رقم ${content} بنجاح**`);

              logEvent(client, message.guild, {
                type: 'RESPONSIBILITY_MANAGEMENT',
                title: 'تم إزالة مسؤول',
                description: `تم إزالة ${removedMember ? removedMember.displayName : 'مستخدم'} من مسؤولية ${responsibilityName}`,
                user: interaction.user,
                fields: [
                  { name: 'المسؤولية', value: responsibilityName, inline: true },
                  { name: 'المسؤول المُزال', value: `<@${removedUserId}>`, inline: true }
                ]
              });

              // Regenerate and edit the message
              const newContent = await generateManagementContent(responsibilityName);
              await interaction.editReply(newContent);

            } else {
              await safeFollowUp(interaction, '**رقم غير صحيح. يرجى اختيار رقم من القائمة.**');
            }
          } else {
            let userId = null;

            if (msg.mentions.users.size > 0) {
              userId = msg.mentions.users.first().id;
            } else {
              const idMatch = content.match(/\d{17,19}/);
              if (idMatch) {
                userId = idMatch[0];
              }
            }

            if (userId) {
              try {
                const member = await message.guild.members.fetch(userId);
                const currentResponsibles = responsibility.responsibles || [];

                if (currentResponsibles.includes(userId)) {
                  await safeFollowUp(interaction, '**هذا المستخدم مسؤول بالفعل!**');
                } else {
                  responsibility.responsibles.push(userId);
                  await saveResponsibilities();

                  // إعطاء المسؤول جميع رولات المسؤولية تلقائياً
                  if (responsibility.roles && responsibility.roles.length > 0) {
                    for (const roleId of responsibility.roles) {
                      try {
                        const role = message.guild.roles.cache.get(roleId);
                        if (role && !member.roles.cache.has(roleId)) {
                          await member.roles.add(roleId);
                          console.log(`✅ تم إعطاء ${member.displayName} رول ${role.name}`);
                        }
                      } catch (error) {
                        console.log(`لا يمكن إضافة رول ${roleId} لـ ${userId}: ${error.message}`);
                      }
                    }
                  }

                  try {
                    const welcomeEmbed = colorManager.createEmbed()
                      .setTitle(' Resb')
                      .setDescription(`**تم تعيينك كمسؤول عن: ${responsibilityName}**`)
                      .addFields([
                        { name: 'المسؤولية', value: responsibilityName, inline: true },
                        { name: 'السيرفر', value: message.guild.name, inline: true },
                        { name: 'تم التعيين بواسطة', value: interaction.user.tag, inline: true }
                      ])
                      .setTimestamp();

                    await member.send({ embeds: [welcomeEmbed] });
                  } catch (error) {
                    console.log(`لا يمكن إرسال رسالة للمستخدم ${userId}: ${error.message}`);
                  }

                  await safeFollowUp(interaction, `**✅ تم إضافة ${member.displayName || member.user.username} كمسؤول**`);

                  logEvent(client, message.guild, {
                    type: 'RESPONSIBILITY_MANAGEMENT',
                    title: 'تم إضافة مسؤول جديد',
                    description: `تم إضافة ${member.displayName || member.user.username} كمسؤول عن ${responsibilityName}`,
                    user: interaction.user,
                    fields: [
                      { name: 'المسؤولية', value: responsibilityName, inline: true },
                      { name: 'المسؤول الجديد', value: `<@${userId}>`, inline: true }
                    ]
                  });

                  // Regenerate and edit the message
                  const newContent = await generateManagementContent(responsibilityName);
                  await interaction.editReply(newContent);
                }
              } catch (error) {
                await safeFollowUp(interaction, '**لم يتم العثور على المستخدم!**');
              }
            } else {
              await safeFollowUp(interaction, '**يرجى منشن المستخدم أو كتابة الآي دي الصحيح**');
            }
          }
        } catch (error) {
          console.error('خطأ في معالجة رسالة إدارة المسؤولين:', error);
          await safeFollowUp(interaction, '**حدث خطأ أثناء المعالجة**');
        }
      });

      messageCollector.on('end', (collected, reason) => {
        console.log(`انتهى collector إدارة المسؤولين للمسؤولية ${responsibilityName} - السبب: ${reason}`);
        activeCollectors.delete(responsibilityName);
        if (reason !== 'user_done' && reason !== 'new_session') {
            interaction.editReply({ content: '**انتهت مهلة هذا الإجراء.**', embeds:[], components: [] }).catch(()=>{});
        }
      });

    } catch (error) {
      console.error('خطأ في عرض إدارة المسؤولين:', error);
      await safeReply(interaction, '**حدث خطأ في عرض إدارة المسؤولين**');
    }
  }

  async function showRoleManagement(interaction, responsibilityName) {
    try {
      const responsibility = responsibilities[responsibilityName];
      if (!responsibility) {
        return await safeReply(interaction, '**المسؤولية غير موجودة!**');
      }

      // تهيئة حقل roles إن لم يكن موجوداً
      if (!responsibility.roles) {
        responsibility.roles = [];
      }

      const existingCollector = activeCollectors.get(`role_${responsibilityName}`);
      if (existingCollector) {
        existingCollector.stop('new_session');
        activeCollectors.delete(`role_${responsibilityName}`);
      }

      const rolesList = responsibility.roles || [];
      let rolesText = '';

      if (rolesList.length > 0) {
        for (let i = 0; i < rolesList.length; i++) {
          try {
            const role = message.guild.roles.cache.get(rolesList[i]);
            if (role) {
              rolesText += `**${i + 1}.** ${role.name} (<@&${rolesList[i]}>)\n`;
            } else {
              rolesText += `**${i + 1}.** رول محذوف (${rolesList[i]})\n`;
            }
          } catch (error) {
            rolesText += `**${i + 1}.** رول محذوف (${rolesList[i]})\n`;
          }
        }
      } else {
        rolesText = '**لا توجد رولات مضافة**';
      }

      const embed = colorManager.createEmbed()
        .setTitle(`**إدارة رولات: ${responsibilityName}**`)
        .setDescription(`**الرولات الحالية:**\n${rolesText}\n\n**للإضافة منشن رول أو اكتب الآي دي\nللحذف اكتب رقم الرول\nعند الانتهاء اكتب تم**`)
        .setFooter({ text: 'By Ahmed.' });

      const backButton = new ButtonBuilder()
        .setCustomId(`back_to_main_${responsibilityName}`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(backButton);
      
      await interaction.update({ embeds: [embed], components: [row] });

      const messageFilter = m => m.author.id === interaction.user.id && m.channel.id === message.channel.id;
      const messageCollector = message.channel.createMessageCollector({
        filter: messageFilter,
        time: 300000
      });

      activeCollectors.set(`role_${responsibilityName}`, messageCollector);

      messageCollector.on('collect', async (msg) => {
        try {
          await msg.delete().catch(() => {});

          const content = msg.content.trim();
          const lowerContent = content.toLowerCase();

          if (lowerContent === 'تم' || lowerContent === 'done') {
            messageCollector.stop('user_done');
            await updateMainMenu();
            return;
          }

          // التحقق من حذف رول بالرقم
          if (/^\d+$/.test(content)) {
            const index = parseInt(content) - 1;
            const currentRoles = responsibility.roles || [];

            if (index >= 0 && index < currentRoles.length) {
              const removedRoleId = currentRoles[index];
              const role = message.guild.roles.cache.get(removedRoleId);

              responsibility.roles.splice(index, 1);
              await saveResponsibilities();

              // إزالة الرول من جميع المسؤولين الحاليين
              let removedCount = 0;
              if (role) {
                for (const responsibleId of (responsibility.responsibles || [])) {
                  try {
                    const member = await message.guild.members.fetch(responsibleId);
                    if (member.roles.cache.has(removedRoleId)) {
                      await member.roles.remove(removedRoleId);
                      removedCount++;
                      console.log(`✅ تم إزالة رول ${role.name} من ${member.displayName}`);
                    }
                  } catch (error) {
                    console.log(`لا يمكن إزالة الرول من ${responsibleId}: ${error.message}`);
                  }
                }
              }

              await safeFollowUp(interaction, `**✅ تم حذف الرول رقم ${content} بنجاح**${removedCount > 0 ? `\n**تم إزالة الرول من ${removedCount} مسؤول**` : ''}`);

              logEvent(client, message.guild, {
                type: 'RESPONSIBILITY_MANAGEMENT',
                title: 'تم حذف رول من مسؤولية',
                description: `تم حذف رول ${role ? role.name : removedRoleId} من مسؤولية ${responsibilityName}${removedCount > 0 ? ` وإزالته من ${removedCount} مسؤول` : ''}`,
                user: interaction.user,
                fields: [
                  { name: 'المسؤولية', value: responsibilityName, inline: true },
                  { name: 'الرول المحذوف', value: role ? `<@&${removedRoleId}>` : removedRoleId, inline: true },
                  { name: 'تمت الإزالة من', value: `${removedCount} مسؤول`, inline: true }
                ]
              });

              // تحديث العرض
              await updateRoleDisplay();
            } else {
              await safeFollowUp(interaction, '**رقم غير صحيح. يرجى اختيار رقم من القائمة.**');
            }
          } else {
            // إضافة رول جديد
            let roleId = null;

            if (msg.mentions.roles.size > 0) {
              roleId = msg.mentions.roles.first().id;
            } else {
              const idMatch = content.match(/\d{17,19}/);
              if (idMatch) {
                roleId = idMatch[0];
              }
            }

            if (roleId) {
              try {
                const role = await message.guild.roles.fetch(roleId);
                if (!role) {
                  return await safeFollowUp(interaction, '**الرول غير موجود!**');
                }

                // التحقق من عدم وجود الرول في مسؤولية أخرى
                for (const [respName, resp] of Object.entries(responsibilities)) {
                  if (respName !== responsibilityName && resp.roles && resp.roles.includes(roleId)) {
                    return await safeFollowUp(interaction, `**⚠️ هذا الرول موجود بالفعل في مسؤولية: ${respName}**\n**لا يمكن استخدام نفس الرول في مسؤوليتين مختلفتين!**`);
                  }
                }

                const currentRoles = responsibility.roles || [];
                if (currentRoles.includes(roleId)) {
                  await safeFollowUp(interaction, '**هذا الرول موجود بالفعل!**');
                } else {
                  responsibility.roles.push(roleId);
                  await saveResponsibilities();

                  // إعطاء الرول لجميع المسؤولين الحاليين
                  for (const responsibleId of (responsibility.responsibles || [])) {
                    try {
                      const member = await message.guild.members.fetch(responsibleId);
                      if (!member.roles.cache.has(roleId)) {
                        await member.roles.add(roleId);
                      }
                    } catch (error) {
                      console.log(`لا يمكن إضافة الرول لـ ${responsibleId}: ${error.message}`);
                    }
                  }

                  await safeFollowUp(interaction, `**✅ تم إضافة الرول ${role.name} بنجاح**`);

                  logEvent(client, message.guild, {
                    type: 'RESPONSIBILITY_MANAGEMENT',
                    title: 'تم إضافة رول لمسؤولية',
                    description: `تم إضافة رول ${role.name} لمسؤولية ${responsibilityName}`,
                    user: interaction.user,
                    fields: [
                      { name: 'المسؤولية', value: responsibilityName, inline: true },
                      { name: 'الرول الجديد', value: `<@&${roleId}>`, inline: true }
                    ]
                  });

                  // تحديث العرض
                  await updateRoleDisplay();
                }
              } catch (error) {
                await safeFollowUp(interaction, '**لم يتم العثور على الرول!**');
              }
            } else {
              await safeFollowUp(interaction, '**يرجى منشن الرول أو كتابة الآي دي الصحيح**');
            }
          }

          async function updateRoleDisplay() {
            const rolesList = responsibility.roles || [];
            let rolesText = '';

            if (rolesList.length > 0) {
              for (let i = 0; i < rolesList.length; i++) {
                try {
                  const role = message.guild.roles.cache.get(rolesList[i]);
                  if (role) {
                    rolesText += `**${i + 1}.** ${role.name} (<@&${rolesList[i]}>)\n`;
                  } else {
                    rolesText += `**${i + 1}.** رول محذوف (${rolesList[i]})\n`;
                  }
                } catch (error) {
                  rolesText += `**${i + 1}.** رول محذوف (${rolesList[i]})\n`;
                }
              }
            } else {
              rolesText = '**لا توجد رولات مضافة**';
            }

            const embed = colorManager.createEmbed()
              .setTitle(`**إدارة رولات: ${responsibilityName}**`)
              .setDescription(`**الرولات الحالية:**\n${rolesText}\n\n**للإضافة منشن رول أو اكتب الآي دي\nللحذف اكتب رقم الرول\nعند الانتهاء اكتب تم**`)
              .setFooter({ text: 'By Ahmed.' });

            const backButton = new ButtonBuilder()
              .setCustomId(`back_to_main_${responsibilityName}`)
              .setLabel('Back')
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(backButton);
            
            await interaction.editReply({ embeds: [embed], components: [row] });
          }
        } catch (error) {
          console.error('خطأ في معالجة رسالة إدارة الرولات:', error);
          await safeFollowUp(interaction, '**حدث خطأ أثناء المعالجة**');
        }
      });

      messageCollector.on('end', (collected, reason) => {
        console.log(`انتهى collector إدارة الرولات للمسؤولية ${responsibilityName} - السبب: ${reason}`);
        activeCollectors.delete(`role_${responsibilityName}`);
        if (reason !== 'user_done' && reason !== 'new_session') {
          interaction.editReply({ content: '**انتهت مهلة هذا الإجراء.**', embeds: [], components: [] }).catch(() => {});
        }
      });

    } catch (error) {
      console.error('خطأ في عرض إدارة الرولات:', error);
      await safeReply(interaction, '**حدث خطأ في عرض إدارة الرولات**');
    }
  }

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
      if (!ignoredCodes.includes(error.code)) {
        console.error('خطأ في الرد الآمن:', error);
      }
      return false;
    }
  }

  async function safeFollowUp(interaction, content, options = {}) {
    try {
      const replyOptions = { content, ephemeral: true, ...options };
      await interaction.followUp(replyOptions);
      return true;
    } catch (error) {
      console.error('خطأ في المتابعة الآمنة:', error);
      return false;
    }
  }

  collector.on('collect', async interaction => {
    try {
      // معالجة التفاعلات

      // التحقق من صلاحية التفاعل مع معالجة محسنة
      if (!interaction || !interaction.isRepliable()) {
        console.log('تفاعل غير صالح في السيتنقس');
        return;
      }

      // التحقق من عمر التفاعل
      const now = Date.now();
      const interactionTime = interaction.createdTimestamp;
      const timeDiff = now - interactionTime;

      if (timeDiff > 14 * 60 * 1000) {
        console.log('تم تجاهل تفاعل منتهي الصلاحية في السيتنقس');
        return;
      }

      if (interaction.replied || interaction.deferred) {
        console.log('تم تجاهل تفاعل متكرر في السيتنقس');
        return;
      }

      // معالجة أزرار التنقل بين الصفحات
      if (interaction.customId && (interaction.customId.startsWith('page_prev_') || interaction.customId.startsWith('page_next_'))) {
        const currentPage = parseInt(interaction.customId.split('_')[2]);
        let newPage = currentPage;
        
        if (interaction.customId.startsWith('page_prev_')) {
          newPage = currentPage - 1;
        } else if (interaction.customId.startsWith('page_next_')) {
          newPage = currentPage + 1;
        }
        
        await updateMainMenu(newPage);
        await safeReply(interaction, `**تم الانتقال إلى الصفحة ${newPage + 1}**`);
        return;
      }
      
      if (interaction.customId === 'settings_select_responsibility') {
        const selected = interaction.values[0];

        if (selected === 'add_new') {
          const modal = new ModalBuilder()
            .setCustomId('add_responsibility_modal')
            .setTitle('**Add res**');

          const nameInput = new TextInputBuilder()
            .setCustomId('responsibility_name')
            .setLabel('Res name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('أدخل اسم المسؤولية');

          const descInput = new TextInputBuilder()
            .setCustomId('responsibility_desc')
            .setLabel('Res desc')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('أدخل شرح المسؤولية أو ضع لا');

          const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
          const secondActionRow = new ActionRowBuilder().addComponents(descInput);

          modal.addComponents(firstActionRow, secondActionRow);
          await interaction.showModal(modal);
        } else {
          const responsibility = responsibilities[selected];
          if (!responsibility) {
            await updateMainMenu();
            return await safeReply(interaction, '**المسؤولية غير موجودة!**');
          }

          const editButton = new ButtonBuilder()
            .setCustomId(`edit_${selected}`)
            .setLabel('edit desc')
            .setStyle(ButtonStyle.Primary);

          const renameButton = new ButtonBuilder()
            .setCustomId(`rename_${selected}`)
            .setLabel('rename')
            .setStyle(ButtonStyle.Primary);

          const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_${selected}`)
            .setLabel('delete')
            .setStyle(ButtonStyle.Danger);

          const manageButton = new ButtonBuilder()
            .setCustomId(`manage_${selected}`)
            .setLabel('manage')
            .setStyle(ButtonStyle.Secondary);

          const roleButton = new ButtonBuilder()
            .setCustomId(`role_${selected}`)
            .setLabel('role')
            .setStyle(ButtonStyle.Success);

          const orderedKeys = getOrderedResponsibilities();
          const currentIndex = orderedKeys.indexOf(selected);
          
          const backButton = new ButtonBuilder()
            .setCustomId('back_to_menu')
            .setLabel('main menu')
            .setStyle(ButtonStyle.Secondary);

          const buttonsRow1 = new ActionRowBuilder().addComponents(editButton, renameButton, deleteButton, manageButton, roleButton);
          
          // إنشاء select menu للترتيب (محدود بـ 25 عنصر)
          let positionOptions = orderedKeys.map((key, index) => ({
            label: `${index + 1}. ${key}`,
            value: index.toString(),
            default: index === currentIndex,
            description: index === currentIndex ? '(الموضع الحالي)' : `نقل إلى الموضع ${index + 1}`
          }));

          // إذا كان هناك أكثر من 25 مسؤولية، نحد الخيارات
          if (positionOptions.length > 25) {
            // نعرض 12 عنصر قبل العنصر الحالي و 12 بعده
            const start = Math.max(0, currentIndex - 12);
            const end = Math.min(orderedKeys.length, currentIndex + 13);
            positionOptions = positionOptions.slice(start, end);
          }

          const components = [buttonsRow1];
          
          if (positionOptions.length > 1) {
            const positionSelect = new StringSelectMenuBuilder()
              .setCustomId(`reorder_${selected}`)
              .setPlaceholder(' اختر الموضع الجديد للمسؤولية')
              .addOptions(positionOptions);
            const selectRow = new ActionRowBuilder().addComponents(positionSelect);
            components.push(selectRow);
          }

          const buttonsRow2 = new ActionRowBuilder().addComponents(backButton);
          components.push(buttonsRow2);

          const respList = responsibility.responsibles && responsibility.responsibles.length > 0
            ? responsibility.responsibles.map(r => `<@${r}>`).join(', ')
            : '**لا يوجد مسؤولين معينين**';

          const desc = responsibility.description && responsibility.description.toLowerCase() !== 'لا'
            ? responsibility.description
            : '**لا يوجد شرح**';

          const embedEdit = colorManager.createEmbed()
            .setTitle(`**تعديل المسؤولية : ${selected}**`)
            .setDescription(`**المسؤولون :** ${respList}\n**الشرح :** ${desc}\n**الترتيب :** ${currentIndex + 1} من ${orderedKeys.length}`);

          await interaction.update({ embeds: [embedEdit], components });
        }
      } else if (interaction.customId === 'back_to_menu' || interaction.customId.startsWith('back_to_main_')) {
        // إيقاف جميع الـ collectors النشطة عند العودة للقائمة الرئيسية
        for (const [respName, collector] of activeCollectors.entries()) {
          collector.stop('returning_to_main');
        }
        activeCollectors.clear();
        await updateMainMenu();
      } else if (interaction.isButton()) {
        const [action, responsibilityName] = interaction.customId.split('_');

        if (!responsibilityName || !responsibilities[responsibilityName]) {
          await updateMainMenu();
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }

        if (action === 'delete') {
          try {
            const deletedResponsibility = { ...responsibilities[responsibilityName] };
            delete responsibilities[responsibilityName];

            const saved = await saveResponsibilities();
            if (!saved) {
              await safeReply(interaction, '**فشل في حذف المسؤولية!**');
              return;
            }

            logEvent(client, message.guild, {
              type: 'RESPONSIBILITY_MANAGEMENT',
              title: 'Responsibility Deleted',
              description: `The responsibility "${responsibilityName}" has been deleted.`,
              user: message.author,
              fields: [
                { name: 'Description', value: deletedResponsibility.description || 'N/A' }
              ]
            });

            await safeReply(interaction, `**✅ تم حذف المسؤولية: ${responsibilityName}**`);

            setTimeout(async () => {
              await updateMainMenu();
            }, 1500);

          } catch (error) {
            console.error('خطأ في حذف المسؤولية:', error);
            await safeReply(interaction, '**حدث خطأ أثناء حذف المسؤولية**');
          }
        } else if (action === 'edit') {
          const modal = new ModalBuilder()
            .setCustomId(`edit_desc_modal_${responsibilityName}`)
            .setTitle(`**تعديل شرح المسؤولية: ${responsibilityName}**`);

          const descInput = new TextInputBuilder()
            .setCustomId('responsibility_desc')
            .setLabel('شرح المسؤولية (أرسل "لا" لعدم الشرح)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('أدخل شرح المسؤولية أو اتركه فارغ')
            .setValue(responsibilities[responsibilityName].description || '');

          const actionRow = new ActionRowBuilder().addComponents(descInput);
          modal.addComponents(actionRow);
          await interaction.showModal(modal);
        } else if (action === 'rename') {
          const modal = new ModalBuilder()
            .setCustomId(`rename_modal_${responsibilityName}`)
            .setTitle(`**تغيير اسم المسؤولية**`);

          const nameInput = new TextInputBuilder()
            .setCustomId('new_responsibility_name')
            .setLabel('الاسم الجديد للمسؤولية')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('أدخل الاسم الجديد')
            .setValue(responsibilityName);

          const actionRow = new ActionRowBuilder().addComponents(nameInput);
          modal.addComponents(actionRow);
          await interaction.showModal(modal);
        } else if (action === 'manage') {
          await showResponsibleManagement(interaction, responsibilityName);
        } else if (action === 'role') {
          await showRoleManagement(interaction, responsibilityName);
        } else if (action === 'search') {
          // إظهار نافذة البحث عن الأعضاء
          const modal = new ModalBuilder()
            .setCustomId(`search_members_modal_${responsibilityName}`)
            .setTitle('بحث عن أعضاء');

          const searchInput = new TextInputBuilder()
            .setCustomId('search_query')
            .setLabel('اكتب اسم العضو للبحث')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('مثال: Ahmed, محمد, Ali');

          const actionRow = new ActionRowBuilder().addComponents(searchInput);
          modal.addComponents(actionRow);
          await interaction.showModal(modal);
        }
      } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('reorder_')) {
        // معالجة إعادة الترتيب من select menu
        const responsibilityName = interaction.customId.replace('reorder_', '');
        const newPosition = parseInt(interaction.values[0]);
        
        if (!responsibilities[responsibilityName]) {
          await updateMainMenu();
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }
        
        const orderedKeys = getOrderedResponsibilities();
        const currentPosition = orderedKeys.indexOf(responsibilityName);
        
        if (currentPosition === newPosition) {
          return await safeReply(interaction, '**المسؤولية في نفس الموضع بالفعل!**');
        }
        
        // إزالة المسؤولية من موضعها الحالي
        orderedKeys.splice(currentPosition, 1);
        // إدراجها في الموضع الجديد
        orderedKeys.splice(newPosition, 0, responsibilityName);
        
        // إعادة ترقيم جميع المسؤوليات
        orderedKeys.forEach((key, index) => {
          responsibilities[key].order = index;
        });
        
        await saveResponsibilities();
        await safeReply(interaction, `**✅ تم نقل "${responsibilityName}" إلى الموضع ${newPosition + 1}**`);
        
        logEvent(client, message.guild, {
          type: 'RESPONSIBILITY_MANAGEMENT',
          title: 'تم إعادة ترتيب مسؤولية',
          description: `تم نقل "${responsibilityName}" من الموضع ${currentPosition + 1} إلى ${newPosition + 1}`,
          user: interaction.user,
          fields: [
            { name: 'المسؤولية', value: responsibilityName, inline: true },
            { name: 'الموضع القديم', value: (currentPosition + 1).toString(), inline: true },
            { name: 'الموضع الجديد', value: (newPosition + 1).toString(), inline: true }
          ]
        });
        
        // تحديث المنيو مباشرة بالمسؤوليات والمواقع الجديدة
        setTimeout(async () => {
          const responsibility = responsibilities[responsibilityName];
          if (!responsibility) {
            await updateMainMenu();
            return;
          }

          const editButton = new ButtonBuilder()
            .setCustomId(`edit_${responsibilityName}`)
            .setLabel('edit desc')
            .setStyle(ButtonStyle.Primary);

          const renameButton = new ButtonBuilder()
            .setCustomId(`rename_${responsibilityName}`)
            .setLabel('rename')
            .setStyle(ButtonStyle.Primary);

          const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_${responsibilityName}`)
            .setLabel('delete')
            .setStyle(ButtonStyle.Danger);

          const manageButton = new ButtonBuilder()
            .setCustomId(`manage_${responsibilityName}`)
            .setLabel('manage')
            .setStyle(ButtonStyle.Secondary);

          const roleButton = new ButtonBuilder()
            .setCustomId(`role_${responsibilityName}`)
            .setLabel('role')
            .setStyle(ButtonStyle.Success);

          const updatedOrderedKeys = getOrderedResponsibilities();
          const updatedIndex = updatedOrderedKeys.indexOf(responsibilityName);
          
          const backButton = new ButtonBuilder()
            .setCustomId('back_to_menu')
            .setLabel('main menu')
            .setStyle(ButtonStyle.Secondary);

          const buttonsRow1 = new ActionRowBuilder().addComponents(editButton, renameButton, deleteButton, manageButton, roleButton);
          
          // إنشاء select menu للترتيب بالمواقع المحدثة
          const positionOptions = updatedOrderedKeys.map((key, index) => ({
            label: `${index + 1}. ${key}`,
            value: index.toString(),
            default: index === updatedIndex,
            description: index === updatedIndex ? '(الموضع الحالي)' : `نقل إلى الموضع ${index + 1}`
          }));

          const positionSelect = new StringSelectMenuBuilder()
            .setCustomId(`reorder_${responsibilityName}`)
            .setPlaceholder('اختر الموضع الجديد للمسؤولية')
            .addOptions(positionOptions);

          const buttonsRow2 = new ActionRowBuilder().addComponents(backButton);
          const selectRow = new ActionRowBuilder().addComponents(positionSelect);

          const respList = responsibility.responsibles && responsibility.responsibles.length > 0
            ? responsibility.responsibles.map(r => `<@${r}>`).join(', ')
            : '**لا يوجد مسؤولين معينين**';

          const desc = responsibility.description && responsibility.description.toLowerCase() !== 'لا'
            ? responsibility.description
            : '**لا يوجد شرح**';

          const embedEdit = colorManager.createEmbed()
            .setTitle(`**تعديل المسؤولية : ${responsibilityName}**`)
            .setDescription(`**المسؤولون :** ${respList}\n**الشرح :** ${desc}\n**الترتيب :** ${updatedIndex + 1} من ${updatedOrderedKeys.length}`);

          await interaction.message.edit({ embeds: [embedEdit], components: [buttonsRow1, selectRow, buttonsRow2] });
        }, 1000);
      } else if (interaction.customId && interaction.customId.startsWith('settings_manage_')) {
            const action = interaction.customId.replace('settings_manage_', '');

            if (action === 'add') {
                // التأكد من وجود responsibilities
                if (!responsibilities) {
                    await interaction.reply({ content: '**خطأ في تحميل المسؤوليات!**', ephemeral: true });
                    return;
                }

                // إنشاء Select Menu لاختيار الأعضاء
                const members = await message.guild.members.fetch();
                const memberOptions = members
                    .filter(m => !m.user.bot)
                    .map(m => ({
                        label: m.displayName || m.user.username,
                        value: m.id
                    }))
                    .slice(0, 25);

                if (memberOptions.length === 0) {
                    await interaction.reply({ content: '**لا يوجد أعضاء متاحين!**', ephemeral: true });
                    return;
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('settings_select_members')
                    .setPlaceholder('اختر الأعضاء')
                    .addOptions(memberOptions)
                    .setMinValues(1)
                    .setMaxValues(Math.min(memberOptions.length, 25));

                const row = new ActionRowBuilder().addComponents(selectMenu);
                const embed = colorManager.createEmbed()
                    .setTitle('**إضافة مسؤولين**')
                    .setDescription('**اختر الأعضاء الذين تريد تعيينهم كمسؤولين**')
                    .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');

                await interaction.update({ embeds: [embed], components: [row] });
            } else if (action === 'owners') {
                // التحقق من أن المستخدم هو مالك السيرفر أو مالك البوت
                if (!BOT_OWNERS.includes(interaction.user.id) && message.guild.ownerId !== interaction.user.id) {
                    await interaction.reply({ content: '**ليس لديك صلاحية للوصول لهذا الخيار!**', ephemeral: true });
                    return;
                }

                // عرض خيارات إدارة المالكين
                const addButton = new ButtonBuilder()
                    .setCustomId('settings_owners_add')
                    .setLabel('إضافة مالك')
                    .setStyle(ButtonStyle.Success);

                const removeButton = new ButtonBuilder()
                    .setCustomId('settings_owners_remove')
                    .setLabel('إزالة مالك')
                    .setStyle(ButtonStyle.Danger);

                const listButton = new ButtonBuilder()
                    .setCustomId('settings_owners_list')
                    .setLabel('عرض المالكين')
                    .setStyle(ButtonStyle.Primary);

                const backButton = new ButtonBuilder()
                    .setCustomId('back_to_menu')
                    .setLabel('رجوع')
                    .setStyle(ButtonStyle.Secondary);

                const row = new ActionRowBuilder().addComponents(addButton, removeButton, listButton, backButton);
                const embed = colorManager.createEmbed()
                    .setTitle('**إدارة مالكي البوت**')
                    .setDescription('**اختر الإجراء المطلوب**')
                    .setThumbnail('https://cdn.discordapp.com/emojis/1186585722401063032.png?v=1');

                await interaction.update({ embeds: [embed], components: [row] });
            }
        } else if (interaction.customId === 'settings_select_members') {
            try {
                const selectedMembers = interaction.values;

                // البحث عن اسم المسؤولية من العنوان
                let responsibilityName = null;
                if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
                    const embedTitle = interaction.message.embeds[0].title;
                    if (embedTitle && embedTitle.includes(': ')) {
                        responsibilityName = embedTitle.split(': ')[1];
                    }
                }

                if (!responsibilityName) {
                    await interaction.reply({ content: '**خطأ في تحديد اسم المسؤولية!**', ephemeral: true });
                    return;
                }

                // التأكد من وجود responsibilities
                if (!responsibilities) {
                    responsibilities = {};
                }

                if (!responsibilities[responsibilityName]) {
                    responsibilities[responsibilityName] = {
                        description: 'لا يوجد وصف',
                        responsibles: []
                    };
                }

                responsibilities[responsibilityName].responsibles = selectedMembers;
                scheduleSave();

                const updatedEmbed = colorManager.createEmbed()
                    .setTitle(`تم تحديث المسؤولية: ${responsibilityName}`)
                    .setDescription(`**تم تعيين ${selectedMembers.length} عضو للمسؤولية**`)
                    .addFields([
                        { name: 'المسؤولون', value: selectedMembers.map(id => `<@${id}>`).join('\n') || 'لا يوجد', inline: false }
                    ])
                    .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400676711439273994/1320524603868712960.png?ex=688d8157&is=688c2fd7&hm=2f0fcafb0d4dd4fc905d6c5c350cfafe7d68e902b5668117f2e7903a62c8&');

                await interaction.update({ embeds: [updatedEmbed], components: [] });

                logEvent(client, interaction.guild, {
                    type: 'RESPONSIBILITY_MANAGEMENT',
                    title: 'Members Updated for Responsibility',
                    description: `Updated members for responsibility: **${responsibilityName}**`,
                    user: interaction.user,
                    fields: [
                        { name: 'Members Count', value: selectedMembers.length.toString(), inline: true },
                        { name: 'Members', value: selectedMembers.map(id => `<@${id}>`).join(', ') || 'None', inline: false }
                    ]
                });
            } catch (error) {
                console.error('خطأ في معالجة اختيار الأعضاء:', error);
                await safeReply(interaction, '**حدث خطأ أثناء تحديث المسؤولية.**');
            }
            return;
        } else if (interaction.customId.startsWith('add_searched_members_')) {
        const responsibilityName = interaction.customId.replace('add_searched_members_', '');
        const selectedMemberIds = interaction.values;

        if (!responsibilities[responsibilityName]) {
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }

        const currentResponsibles = responsibilities[responsibilityName].responsibles || [];
        let addedCount = 0;
        let alreadyExistsCount = 0;

        for (const memberId of selectedMemberIds) {
          if (!currentResponsibles.includes(memberId)) {
            currentResponsibles.push(memberId);
            addedCount++;

            // إرسال رسالة ترحيب للمسؤول الجديد
            try {
              const member = await message.guild.members.fetch(memberId);
              const welcomeEmbed = colorManager.createEmbed()
                .setTitle('Resb')
                .setDescription(`**تم تعيينك كمسؤول عن: ${responsibilityName}**`)
                .addFields([
                  { name: 'المسؤولية', value: responsibilityName, inline: true },
                  { name: 'السيرفر', value: message.guild.name, inline: true },
                  { name: 'تم التعيين بواسطة', value: interaction.user.tag, inline: true }
                ])
                .setTimestamp();

              await member.send({ embeds: [welcomeEmbed] });
            } catch (error) {
              console.log(`لا يمكن إرسال رسالة للمستخدم ${memberId}: ${error.message}`);
            }
          } else {
            alreadyExistsCount++;
          }
        }

        responsibilities[responsibilityName].responsibles = currentResponsibles;
        const saved = await saveResponsibilities();

        if (!saved) {
          return await safeReply(interaction, '**فشل في حفظ المسؤولين!**');
        }

        let resultMessage = '';
        if (addedCount > 0) {
          resultMessage += `**✅ تم إضافة ${addedCount} مسؤول بنجاح**\n`;
        }
        if (alreadyExistsCount > 0) {
          resultMessage += `**ℹ️ ${alreadyExistsCount} عضو مضاف بالفعل**`;
        }

        await safeReply(interaction, resultMessage || '**تم تحديث المسؤولين**');

        logEvent(client, message.guild, {
          type: 'RESPONSIBILITY_MANAGEMENT',
          title: 'تم إضافة مسؤولين جدد',
          description: `تم إضافة ${addedCount} مسؤول للمسؤولية: ${responsibilityName}`,
          user: interaction.user,
          fields: [
            { name: 'المسؤولية', value: responsibilityName, inline: true },
            { name: 'عدد المضافين', value: addedCount.toString(), inline: true }
          ]
        });
      }
    } catch (error) {
      console.error('خطأ في معالج إعدادات المسؤوليات:', error);
      await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
    }
  });

  // Handle modal submissions - استخدام once بدلاً من on لتجنب التكرار
  const modalHandler = async (interaction) => {
    try {
      if (!interaction.isModalSubmit()) return;
      if (interaction.user.id !== message.author.id) return;

      // معالج إضافة مسؤولية جديدة
      if (interaction.customId === 'add_responsibility_modal') {
        const name = interaction.fields.getTextInputValue('responsibility_name').trim();
        const desc = interaction.fields.getTextInputValue('responsibility_desc')?.trim() || '';

        if (!name) {
          await safeReply(interaction, '**يجب إدخال اسم المسؤولية!**');
          return;
        }

        // إعادة تحميل المسؤوليات من الملف للتأكد من البيانات الحديثة
        const fs = require('fs');
        const path = require('path');
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
        
        let currentResponsibilities = {};
        try {
          if (fs.existsSync(responsibilitiesPath)) {
            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
            currentResponsibilities = JSON.parse(data);
          }
        } catch (error) {
          console.error('خطأ في قراءة المسؤوليات:', error);
          currentResponsibilities = {};
        }

        // التحقق من وجود المسؤولية بشكل غير حساس لحالة الأحرف
        const existingResponsibility = Object.keys(currentResponsibilities).find(
          key => key.toLowerCase() === name.toLowerCase()
        );

        if (existingResponsibility) {
          await safeReply(interaction, `**المسؤولية "${existingResponsibility}" موجودة بالفعل!**\n**يرجى اختيار اسم آخر.**`);
          return;
        }

        // إضافة المسؤولية الجديدة للكائن المحمّل والكائن الرئيسي
        const maxOrder = Math.max(-1, ...Object.values(currentResponsibilities).map(r => r.order ?? -1));
        
        currentResponsibilities[name] = {
          description: (!desc || desc.toLowerCase() === 'لا') ? '' : desc,
          responsibles: [],
          order: maxOrder + 1
        };
        
        responsibilities[name] = currentResponsibilities[name];

        // حفظ الكائن الحديث بدلاً من القديم
        try {
          fs.writeFileSync(responsibilitiesPath, JSON.stringify(currentResponsibilities, null, 2));
          console.log('✅ [SETTINGS] تم حفظ المسؤولية الجديدة بنجاح');
        } catch (error) {
          console.error('❌ [SETTINGS] خطأ في حفظ المسؤولية:', error);
          return await safeReply(interaction, '**فشل في إنشاء المسؤولية!**');
        }
        
        // تحديث setup menus
        try {
          const setupCommand = client.commands.get('setup');
          if (setupCommand && setupCommand.updateAllSetupMenus) {
            setupCommand.updateAllSetupMenus(client);
          }
        } catch (error) {
          console.error('خطأ في تحديث منيو السيتب:', error);
        }

        logEvent(client, message.guild, {
          type: 'RESPONSIBILITY_MANAGEMENT',
          title: 'Responsibility Created',
          description: `A new responsibility "${name}" has been created.`,
          user: message.author,
          fields: [
            { name: 'Description', value: desc || 'N/A' }
          ]
        });

        await safeReply(interaction, `**✅ تم إنشاء المسؤولية: ${name}**\n\n**يمكنك الآن اختيارها من القائمة الرئيسية لإضافة المسؤولين**`);

        setTimeout(async () => {
          await updateMainMenu();
        }, 2000);

      } else if (interaction.customId.startsWith('edit_desc_modal_')) {
        const responsibilityName = interaction.customId.replace('edit_desc_modal_', '');
        const desc = interaction.fields.getTextInputValue('responsibility_desc').trim();

        if (!responsibilities[responsibilityName]) {
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }

        const oldDesc = responsibilities[responsibilityName].description;
        responsibilities[responsibilityName].description = (!desc || desc.toLowerCase() === 'لا') ? '' : desc;

        const saved = await saveResponsibilities();
        if (!saved) {
          return await safeReply(interaction, '**فشل في تعديل المسؤولية!**');
        }

        logEvent(client, message.guild, {
          type: 'RESPONSIBILITY_MANAGEMENT',
          title: 'Responsibility Description Updated',
          description: `The description for "${responsibilityName}" has been updated.`,
          user: message.author,
          fields: [
            { name: 'Old Description', value: oldDesc || 'N/A' },
            { name: 'New Description', value: responsibilities[responsibilityName].description || 'N/A' }
          ]
        });

        await safeReply(interaction, `**✅ تم تعديل شرح المسؤولية: ${responsibilityName}**`);

        setTimeout(async () => {
          await updateMainMenu();
        }, 1500);
      } else if (interaction.customId.startsWith('rename_modal_')) {
        const oldName = interaction.customId.replace('rename_modal_', '');
        const newName = interaction.fields.getTextInputValue('new_responsibility_name').trim();

        if (!newName) {
          await safeReply(interaction, '**يجب إدخال اسم جديد!**');
          return;
        }

        if (!responsibilities[oldName]) {
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }

        // إعادة تحميل المسؤوليات من الملف للتأكد من البيانات الحديثة
        const fs = require('fs');
        const path = require('path');
        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');
        
        let currentResponsibilities = {};
        try {
          if (fs.existsSync(responsibilitiesPath)) {
            const data = fs.readFileSync(responsibilitiesPath, 'utf8');
            currentResponsibilities = JSON.parse(data);
          }
        } catch (error) {
          console.error('خطأ في قراءة المسؤوليات:', error);
          currentResponsibilities = {};
        }

        // التحقق من أن الاسم الجديد غير موجود (ما لم يكن نفس الاسم القديم)
        const existingResponsibility = Object.keys(currentResponsibilities).find(
          key => key.toLowerCase() === newName.toLowerCase() && key !== oldName
        );

        if (existingResponsibility) {
          await safeReply(interaction, `**المسؤولية "${existingResponsibility}" موجودة بالفعل!**\n**يرجى اختيار اسم آخر.**`);
          return;
        }

        // نسخ البيانات القديمة
        const responsibilityData = { ...responsibilities[oldName] };
        
        // حذف المسؤولية القديمة
        delete responsibilities[oldName];
        
        // إضافة المسؤولية بالاسم الجديد
        responsibilities[newName] = responsibilityData;

        const saved = await saveResponsibilities();
        if (!saved) {
          // استرجاع التغيير في حالة الفشل
          responsibilities[oldName] = responsibilityData;
          delete responsibilities[newName];
          return await safeReply(interaction, '**فشل في تغيير اسم المسؤولية!**');
        }

        logEvent(client, message.guild, {
          type: 'RESPONSIBILITY_MANAGEMENT',
          title: 'Responsibility Renamed',
          description: `Responsibility "${oldName}" has been renamed to "${newName}".`,
          user: message.author,
          fields: [
            { name: 'Old Name', value: oldName },
            { name: 'New Name', value: newName }
          ]
        });

        await safeReply(interaction, `**✅ تم تغيير اسم المسؤولية من "${oldName}" إلى "${newName}"**`);

        setTimeout(async () => {
          await updateMainMenu();
        }, 1500);
      } else if (interaction.customId.startsWith('search_members_modal_')) {
        const responsibilityName = interaction.customId.replace('search_members_modal_', '');
        const searchQuery = interaction.fields.getTextInputValue('search_query').trim().toLowerCase();

        if (!searchQuery) {
          await safeReply(interaction, '**يجب إدخال نص للبحث!**');
          return;
        }

        if (!responsibilities[responsibilityName]) {
          return await safeReply(interaction, '**المسؤولية غير موجودة!**');
        }

        // البحث عن الأعضاء
        const allMembers = await message.guild.members.fetch();
        const matchedMembers = allMembers.filter(member => 
          !member.user.bot && (
            member.user.username.toLowerCase().includes(searchQuery) ||
            member.user.displayName?.toLowerCase().includes(searchQuery) ||
            member.displayName?.toLowerCase().includes(searchQuery) ||
            member.user.tag.toLowerCase().includes(searchQuery)
          )
        );

        if (matchedMembers.size === 0) {
          await safeReply(interaction, `**لم يتم العثور على أي أعضاء تطابق البحث: "${searchQuery}"**`);
          return;
        }

        // إنشاء Select Menu للأعضاء الذين تم العثور عليهم
        const memberOptions = matchedMembers.map(member => ({
          label: member.displayName || member.user.username,
          description: `@${member.user.username}`,
          value: member.id
        })).slice(0, 25); // Discord limit

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`add_searched_members_${responsibilityName}`)
          .setPlaceholder('اختر الأعضاء لإضافتهم')
          .setMinValues(1)
          .setMaxValues(Math.min(memberOptions.length, 25))
          .addOptions(memberOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = colorManager.createEmbed()
          .setTitle(`**نتائج البحث: ${matchedMembers.size} عضو**`)
          .setDescription(`**تم العثور على ${matchedMembers.size} عضو يطابق البحث "${searchQuery}"**\n\n**اختر الأعضاء الذين تريد إضافتهم للمسؤولية: ${responsibilityName}**`);

        await safeReply(interaction, '', { embeds: [embed], components: [row] });
      }
    } catch (error) {
      console.error('خطأ في معالج المودال:', error);
      await safeReply(interaction, '**حدث خطأ أثناء معالجة النموذج**');
    }
  };

  // إضافة المعالج
  client.on('interactionCreate', modalHandler);

  // إزالة المعالج عند انتهاء الـ collector
  collector.on('end', () => {
    client.removeListener('interactionCreate', modalHandler);
    clearInterval(refreshInterval);
  });
}

module.exports = { name, execute };
