const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { logEvent } = require('../utils/logs_system.js');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');

const name = 'settings';

async function execute(message, args, { responsibilities, client, scheduleSave, BOT_OWNERS }) {
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

      return true;
    } catch (error) {
      console.error('❌ [SETTINGS] خطأ في حفظ المسؤوليات:', error.message);
      return false;
    }
  }

  async function sendSettingsMenu() {
    const embed = colorManager.createEmbed()
      .setTitle('**Res sys**')
      .setDescription('Choose res or edit it')
      .setFooter({ text: 'By Ahmed.' })
      .setThumbnail('https://cdn.discordapp.com/emojis/1186585722401063032.png?v=1');

    const options = Object.keys(responsibilities).map(key => ({
      label: key,
      description: responsibilities[key].description ? responsibilities[key].description.substring(0, 50) : 'لا يوجد شرح',
      value: key
    }));

    options.push({
      label: 'res add',
      description: 'إنشاء مسؤولية جديدة',
      value: 'add_new'
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('settings_select_responsibility')
      .setPlaceholder('اختر مسؤولية')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    return await message.channel.send({ embeds: [embed], components: [row] });
  }

  const sentMessage = await sendSettingsMenu();

  // Persistent collector that never ends
  const filter = i => i.user.id === message.author.id;
  const collector = message.channel.createMessageComponentCollector({ filter });

  // Auto-refresh every 60 seconds to keep alive
  const refreshInterval = setInterval(async () => {
    try {
      await updateMainMenu();
    } catch (error) {
      console.error('خطأ في التحديث التلقائي:', error);
    }
  }, 60000);

  async function updateMainMenu() {
    try {
      const embed = colorManager.createEmbed()
        .setTitle('**Res sys**')
        .setDescription('Choose res or edit it')
        .setFooter({ text: 'By Ahmed.' })
        .setThumbnail('https://cdn.discordapp.com/emojis/1186585722401063032.png?v=1');

      const options = Object.keys(responsibilities).map(key => ({
        label: key,
        description: responsibilities[key].description ? responsibilities[key].description.substring(0, 50) : 'لا يوجد شرح',
        value: key
      }));

      options.push({
        label: 'res add',
        description: 'إنشاء مسؤولية جديدة',
        value: 'add_new'
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('settings_select_responsibility')
        .setPlaceholder('اختر مسؤولية')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await sentMessage.edit({ embeds: [embed], components: [row] });
    } catch (error) {
      console.error('خطأ في تحديث المنيو الرئيسي:', error);
    }
  }

  // إدارة الـ collectors النشطة لكل مسؤولية
  const activeCollectors = new Map();

  async function showResponsibleManagement(interaction, responsibilityName) {
    try {
      const responsibility = responsibilities[responsibilityName];
      if (!responsibility) {
        return await safeReply(interaction, '**المسؤولية غير موجودة!**');
      }

      // إيقاف أي collector سابق لنفس المسؤولية
      const existingCollector = activeCollectors.get(responsibilityName);
      if (existingCollector) {
        existingCollector.stop('new_session');
        activeCollectors.delete(responsibilityName);
      }

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
        .setTitle(`**إدارة المسؤولين: ${responsibilityName}**`)
        .setDescription(`**المسؤولون الحاليون:**\n${responsiblesText}\n\n**للإضافة:** منشن المستخدم أو اكتب الآي دي\n**للحذف:** اكتب رقم المسؤول من القائمة أعلاه`)
        .setFooter({ text: 'اكتب رسالة للإضافة/الحذف أو اضغط "رجوع"' });

      const backButton = new ButtonBuilder()
        .setCustomId(`back_to_main_${responsibilityName}`)
        .setLabel('رجوع للقائمة الرئيسية')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(backButton);

      if (interaction.update) {
        await interaction.update({ embeds: [embed], components: [row] });
      } else {
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // Create message collector for managing responsibles
      const messageFilter = m => m.author.id === interaction.user.id && m.channel.id === message.channel.id;
      const messageCollector = message.channel.createMessageCollector({
        filter: messageFilter,
        time: 120000, // تقليل الوقت إلى دقيقتين
        max: 1 // السماح برسالة واحدة فقط
      });

      // حفظ الـ collector في الخريطة
      activeCollectors.set(responsibilityName, messageCollector);

      messageCollector.on('collect', async (msg) => {
        try {
          await msg.delete().catch(() => {});

          const content = msg.content.trim();

          // Check if it's a number (for removal)
          if (/^\d+$/.test(content)) {
            const index = parseInt(content) - 1;
            const currentResponsibles = responsibility.responsibles || [];
            
            if (index >= 0 && index < currentResponsibles.length) {
              const removedUserId = currentResponsibles[index];

              // جلب معلومات المستخدم المحذوف قبل الحذف
              let removedMember = null;
              try {
                removedMember = await message.guild.members.fetch(removedUserId);
              } catch (error) {
                console.log(`لا يمكن جلب معلومات المستخدم ${removedUserId}`);
              }

              responsibility.responsibles.splice(index, 1);
              await saveResponsibilities();

              // إرسال رسالة للمسؤول المحذوف
              if (removedMember) {
                try {
                  const removalEmbed = colorManager.createEmbed()
                    .setTitle('📢 تم إزالتك من المسؤولية')
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

              // تسجيل الحدث
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

              // إيقاف الـ collector الحالي وإعادة عرض القائمة
              messageCollector.stop('operation_completed');
              setTimeout(() => {
                showResponsibleManagement({ update: async (options) => sentMessage.edit(options) }, responsibilityName);
              }, 1500);
            } else {
              await safeFollowUp(interaction, '**رقم غير صحيح. يرجى اختيار رقم من القائمة.**');
              // إعادة عرض القائمة بعد الخطأ
              messageCollector.stop('invalid_input');
              setTimeout(() => {
                showResponsibleManagement({ update: async (options) => sentMessage.edit(options) }, responsibilityName);
              }, 2000);
            }
          } else {
            // Adding new responsible
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

                  // إرسال رسالة للمسؤول الجديد
                  try {
                    const welcomeEmbed = colorManager.createEmbed()
                      .setTitle('🎉 تم تعيينك كمسؤول!')
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

                  // تسجيل الحدث
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

                  // إيقاف الـ collector وإعادة عرض القائمة
                  messageCollector.stop('operation_completed');
                  setTimeout(() => {
                    showResponsibleManagement({ update: async (options) => sentMessage.edit(options) }, responsibilityName);
                  }, 1500);
                }
              } catch (error) {
                await safeFollowUp(interaction, '**لم يتم العثور على المستخدم!**');
                messageCollector.stop('invalid_user');
                setTimeout(() => {
                  showResponsibleManagement({ update: async (options) => sentMessage.edit(options) }, responsibilityName);
                }, 2000);
              }
            } else {
              await safeFollowUp(interaction, '**يرجى منشن المستخدم أو كتابة الآي دي الصحيح**');
              messageCollector.stop('invalid_format');
              setTimeout(() => {
                showResponsibleManagement({ update: async (options) => sentMessage.edit(options) }, responsibilityName);
              }, 2000);
            }
          }
        } catch (error) {
          console.error('خطأ في معالجة رسالة إدارة المسؤولين:', error);
          await safeFollowUp(interaction, '**حدث خطأ أثناء المعالجة**');
          messageCollector.stop('error');
        }
      });

      messageCollector.on('end', (collected, reason) => {
        console.log(`انتهى collector إدارة المسؤولين للمسؤولية ${responsibilityName} - السبب: ${reason}`);
        activeCollectors.delete(responsibilityName);
      });

    } catch (error) {
      console.error('خطأ في عرض إدارة المسؤولين:', error);
      await safeReply(interaction, '**حدث خطأ في عرض إدارة المسؤولين**');
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
            .setLabel('edit')
            .setStyle(ButtonStyle.Primary);

          const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_${selected}`)
            .setLabel('delete')
            .setStyle(ButtonStyle.Danger);

          const manageButton = new ButtonBuilder()
            .setCustomId(`manage_${selected}`)
            .setLabel('manage')
            .setStyle(ButtonStyle.Secondary);

          const backButton = new ButtonBuilder()
            .setCustomId('back_to_menu')
            .setLabel('main menu')
            .setStyle(ButtonStyle.Secondary);

          const buttonsRow = new ActionRowBuilder().addComponents(editButton, deleteButton, manageButton, backButton);

          const respList = responsibility.responsibles && responsibility.responsibles.length > 0
            ? responsibility.responsibles.map(r => `<@${r}>`).join(', ')
            : '**لا يوجد مسؤولين معينين**';

          const desc = responsibility.description && responsibility.description.toLowerCase() !== 'لا'
            ? responsibility.description
            : '**لا يوجد شرح**';

          const embedEdit = colorManager.createEmbed()
            .setTitle(`**تعديل المسؤولية: ${selected}**`)
            .setDescription(`**المسؤولون:** ${respList}\n**الشرح:** ${desc}`);

          await interaction.update({ embeds: [embedEdit], components: [buttonsRow] });
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
        } else if (action === 'manage') {
          await showResponsibleManagement(interaction, responsibilityName);
        }
      } else if (interaction.customId && interaction.customId.startsWith('settings_manage_')) {
            const action = interaction.customId.replace('settings_manage_', '');

            if (action === 'add') {
                // التأكد من وجود responsibilities
                if (!responsibilities) {
                    await interaction.reply({ content: '**خطأ في تحميل المسؤوليات!**', ephemeral: true });
                    return;
                }

                // إضافة مسؤولية جديدة
                const modal = new ModalBuilder()
                    .setCustomId('add_responsibility_modal')
                    .setTitle('إضافة مسؤولية جديدة');

                const nameInput = new TextInputBuilder()
                    .setCustomId('responsibility_name')
                    .setLabel('اسم المسؤولية')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(50);

                const descInput = new TextInputBuilder()
                    .setCustomId('responsibility_desc')
                    .setLabel('وصف المسؤولية')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(500);

                const nameRow = new ActionRowBuilder().addComponents(nameInput);
                const descRow = new ActionRowBuilder().addComponents(descInput);
                modal.addComponents(nameRow, descRow);

                await interaction.showModal(modal);
                return;
            } else if (action === 'edit' || action === 'delete') {
                // التأكد من وجود responsibilities
                if (!responsibilities || typeof responsibilities !== 'object') {
                    await interaction.reply({ content: '**خطأ في تحميل المسؤوليات!**', ephemeral: true });
                    return;
                }

                // إنشاء قائمة المسؤوليات
                const responsibilityKeys = Object.keys(responsibilities);
                if (responsibilityKeys.length === 0) {
                    await interaction.reply({ content: '**لا توجد مسؤوليات لإدارتها.**', ephemeral: true });
                    return;
                }

                const options = responsibilityKeys.map(key => {
                    const resp = responsibilities[key];
                    return {
                        label: key,
                        value: key,
                        description: (resp && resp.description) ? resp.description.substring(0, 100) : 'لا يوجد وصف'
                    };
                });

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`responsibility_${action}_select`)
                    .setPlaceholder(`اختر مسؤولية ${action === 'edit' ? 'للتعديل' : 'للحذف'}`)
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.reply({ content: `**اختر مسؤولية ${action === 'edit' ? 'للتعديل' : 'للحذف'}:**`, components: [row], ephemeral: true });
            }
      } else if (interaction.customId === 'select_members_for_responsibility') {
            try {
                const selectedMembers = interaction.values || [];

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
        }
    } catch (error) {
      console.error('خطأ في معالج إعدادات المسؤوليات:', error);
      await safeReply(interaction, '**حدث خطأ أثناء معالجة الطلب.**');
    }
  });

  // Handle modal submissions
  client.on('interactionCreate', async interaction => {
    try {
      if (!interaction.isModalSubmit()) return;
      if (interaction.user.id !== message.author.id) return;

      if (interaction.customId === 'add_responsibility_modal') {
        const name = interaction.fields.getTextInputValue('responsibility_name').trim();
        const desc = interaction.fields.getTextInputValue('responsibility_desc').trim();

        if (!name) {
          return await safeReply(interaction, '**يجب إدخال اسم المسؤولية!**');
        }

        if (responsibilities[name]) {
          return await safeReply(interaction, '**هذه المسؤولية موجودة بالفعل!**');
        }

        responsibilities[name] = {
          description: (!desc || desc.toLowerCase() === 'لا') ? '' : desc,
          responsibles: []
        };

        const saved = await saveResponsibilities();
        if (!saved) {
          return await safeReply(interaction, '**فشل في إنشاء المسؤولية!**');
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

        await safeReply(interaction, `**✅ تم إنشاء المسؤولية: ${name}**\n\n**الآن يمكنك إضافة المسؤولين:**\nمنشن الأعضاء أو اكتب الـ ID في رسالة عادية في هذه القناة\n**مثال:** \`@user1 @user2\` أو \`123456789 987654321\`\n\n**اكتب "تم" أو "done" عندما تنتهي من الإضافة**`);

        // Create message collector for adding responsibles after creation
        const messageFilter = m => m.author.id === interaction.user.id && m.channel.id === interaction.channel.id;
        const addResponsiblesCollector = message.channel.createMessageCollector({
          filter: messageFilter,
          time: 300000 // 5 minutes
        });

        addResponsiblesCollector.on('collect', async (msg) => {
          try {
            await msg.delete().catch(() => {});

            const content = msg.content.trim().toLowerCase();

            // إنهاء الإضافة
            if (content === 'تم' || content === 'done' || content === 'انتهى' || content === 'finish') {
              addResponsiblesCollector.stop();
              await interaction.followUp({
                content: `**✅ تم الانتهاء من إعداد المسؤولية: ${name}**`,
                ephemeral: true
              });
              setTimeout(async () => {
                await updateMainMenu();
              }, 1500);
              return;
            }

            // استخراج المعرفات والمنشنات
            const userIds = [];
            const mentions = msg.content.match(/<@!?(\d+)>/g);
            const rawIds = msg.content.match(/\b\d{17,19}\b/g);

            if (mentions) {
              mentions.forEach(mention => {
                const id = mention.replace(/[<@!>]/g, '');
                if (!userIds.includes(id)) userIds.push(id);
              });
            }

            if (rawIds) {
              rawIds.forEach(id => {
                if (!userIds.includes(id)) userIds.push(id);
              });
            }

            if (userIds.length === 0) {
              await interaction.followUp({
                content: '**يرجى منشن الأعضاء أو كتابة الـ ID بشكل صحيح**',
                ephemeral: true
              });
              return;
            }

            let addedCount = 0;
            let failedCount = 0;

            for (const userId of userIds) {
              try {
                const member = await message.guild.members.fetch(userId);

                if (!responsibilities[name].responsibles.includes(userId)) {
                  responsibilities[name].responsibles.push(userId);
                  addedCount++;

                  // إرسال رسالة ترحيب للمسؤول الجديد
                  try {
                    const welcomeEmbed = colorManager.createEmbed()
                      .setTitle('🎉 تم تعيينك كمسؤول!')
                      .setDescription(`**تم تعيينك كمسؤول عن: ${name}**`)
                      .addFields([
                        { name: 'المسؤولية', value: name, inline: true },
                        { name: 'السيرفر', value: message.guild.name, inline: true },
                        { name: 'تم التعيين بواسطة', value: interaction.user.tag, inline: true }
                      ])
                      .setTimestamp();

                    await member.send({ embeds: [welcomeEmbed] });
                  } catch (dmError) {
                    console.log(`لا يمكن إرسال رسالة للمستخدم ${userId}: ${dmError.message}`);
                  }

                  // تسجيل الحدث
                  logEvent(client, message.guild, {
                    type: 'RESPONSIBILITY_MANAGEMENT',
                    title: 'تم إضافة مسؤول جديد',
                    description: `تم إضافة مسؤول جديد للمسؤولية: ${name}`,
                    user: interaction.user,
                    fields: [
                      { name: 'المسؤولية', value: name, inline: true },
                      { name: 'المسؤول الجديد', value: `<@${userId}>`, inline: true }
                    ]
                  });
                }
              } catch (error) {
                failedCount++;
                console.log(`فشل في إضافة المستخدم ${userId}: ${error.message}`);
              }
            }

            const saved = await saveResponsibilities();
            if (!saved) {
              await interaction.followUp({
                content: '**فشل في حفظ المسؤولين!**',
                ephemeral: true
              });
              return;
            }

            let resultMessage = '';
            if (addedCount > 0) {
              resultMessage += `**✅ تم إضافة ${addedCount} مسؤول**\n`;
            }
            if (failedCount > 0) {
              resultMessage += `**❌ فشل في إضافة ${failedCount} مستخدم**\n`;
            }
            resultMessage += `**اكتب "تم" عندما تنتهي من الإضافة**`;

            await interaction.followUp({
              content: resultMessage,
              ephemeral: true
            });

          } catch (error) {
            console.error('خطأ في إضافة المسؤولين:', error);
            await interaction.followUp({
              content: '**حدث خطأ أثناء إضافة المسؤولين**',
              ephemeral: true
            });
          }
        });

        addResponsiblesCollector.on('end', () => {
          console.log('انتهى collector إضافة المسؤولين');
        });

        setTimeout(async () => {
          await updateMainMenu();
        }, 1500);

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
      }
    } catch (error) {
      console.error('خطأ في معالج المودال:', error);
      await safeReply(interaction, '**حدث خطأ أثناء معالجة النموذج**');
    }
  });

    // Clean up on process exit
  process.on('exit', () => {
    clearInterval(refreshInterval);
  });
}

module.exports = { name, execute };