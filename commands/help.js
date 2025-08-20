
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const colorManager = require('../utils/colorManager.js');

module.exports = {
  name: 'help',
  description: 'Help commands',
  async execute(message, args, { responsibilities, points, saveData, BOT_OWNERS, ADMIN_ROLES, client }) {
    const member = await message.guild.members.fetch(message.author.id);
    const hasAdminRole = member.roles.cache.some(role => ADMIN_ROLES.includes(role.id));
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    const hasAdministrator = member.permissions.has('Administrator');

    // فحص الصلاحيات لعرض الأوامر المناسبة
    const canUseAdminCommands = hasAdminRole || isOwner || hasAdministrator;
    const canUseOwnerCommands = isOwner;

    // Load bot configuration to get current prefix
    const fs = require('fs');
    const path = require('path');
    const botConfigFile = path.join(__dirname, '..', 'data', 'botConfig.json');
    let PREFIX = '.'; // default prefix

    if (fs.existsSync(botConfigFile)) {
      try {
        const botConfig = JSON.parse(fs.readFileSync(botConfigFile, 'utf8'));
        PREFIX = botConfig.prefix || '.';
      } catch (error) {
        console.error('خطأ في قراءة البرفكس:', error);
      }
    }

    // ترتيب الأوامر حسب الأهمية والتحديثات الجديدة
    const commands = [
      {
        name: 'مسؤول',
        description: '**Res help**',
        usage: `${PREFIX}مسؤول [الرسالة]`,
        details: '**- يرسل طلب مساعدة للمسؤولين في مسؤولية معينة من الاداريين وتستطيع معرفة مسؤوليات الشخص بالامر ثم المنشن**'
      },
      {
        name: 'مسؤولياتي',
        description: '**My Responsibilities**',
        usage: `${PREFIX}مسؤولياتي`,
        details: '**- يعرض مسؤولياتك الشخصية مع إحصائيات تفصيلية عن أدائك ونشاطك**'
      },
      {
        name: 'help',
        description: '**Commands information**',
        usage: `${PREFIX}help`,
        details: '**- يعرض جميع الاوامر وتفاصيلها مع واجهة تفاعلية محسنة**'
      },
      {
        name: 'top',
        description: '**Top Points**',
        usage: `${PREFIX}top [اسم المسؤولية]`,
        details: '**- يعرض ترتيب الأعضاء حسب النقاط والمسؤوليات في الشهر - اليوم - الاسبوع - وتوب المسؤوليات المحددة**'
      },
      {
        name: 'stats',
        description: '**Res stats**',
        usage: `${PREFIX}stats [اسم المسؤولية]`,
        details: '**- يعرض إحصائيات شاملة عن المسؤوليات معينة وتفاعلهم مع تحليلات مفصلة**'
      },
      {
        name: 'call',
        description: '**Res call**',
        usage: `${PREFIX}call [اسم المسؤولية]`,
        details: '**- استدعاء مسؤول لمسؤولية محددة (للأونرز فقط)**'
      },
      {
        name: 'setup',
        description: '**Res Menu**',
        usage: `${PREFIX}setup`,
        details: '**- ينشئ منيو المسؤوليات في روم معين لتستخدمه الادارة لاستدعاء المسؤولين**'
      },
      {
        name: 'settings',
        description: '**Res Settings**',
        usage: `${PREFIX}settings`,
        details: '**- اضافة وازالة مسؤوليات وتعديل المسؤولين والشرح لكل مسؤولية مع واجهة محدثة**'
      },
      {
        name: 'vip',
        description: '**Bot Setup**',
        usage: `${PREFIX}vip`,
        details: '**- تغيير البرفكس والاسم والافتار والبنر واعادة تشغيل البوت مع إعدادات متقدمة**'
      },
      {
        name: 'reset',
        description: '**Reset Points**',
        usage: `${PREFIX}reset`,
        details: '**- يعيد تعيين نقاط لمسؤولية معينة او مسؤول معين او اعادة تعين شهرية - يومية - اسبوعية - وإدارة النقاط يدوياً**'
      },
      {
        name: 'owners',
        description: '**Owners Settings**',
        usage: `${PREFIX}owners`,
        details: '**- اضافة وازالة اونرز للبوت مع إدارة صلاحيات متقدمة**'
      },
      {
        name: 'adminroles',
        description: '**Admin setup**',
        usage: `${PREFIX}adminroles`,
        details: '**- يضيف أو يحذف رتب الإدارة المسموح لها لاستخدام أوامر الإدارة مثل: مسؤول والخ**'
      },
      {
        name: 'cooldown',
        description: '**Cooldown Setup**',
        usage: `${PREFIX}cooldown`,
        details: '**- يحدد فترات الانتظار لاستدعاء المسؤولين حسب الرغبة لعدم الازعاج وسبام الارسال**'
      },
      {
        name: 'log',
        description: '**Log Setup**',
        usage: `${PREFIX}log`,
        details: '**- تعيين اللوقز تلقائياً او تعيين حسب الرغبة بروم معين او تعطيلها مع نظام متقدم**'
      },
      {
        name: 'notifications',
        description: '**Notification Setup**',
        usage: `${PREFIX}notifications`,
        details: '**- نظام تنبيه وتذكير بالمسؤوليات الخاصة بالمسؤول وكذلك التنبيه اذا هناك طلب استدعاء ولم يتم استلامه**'
      },
      {
        name: 'block',
        description: '**Block System**',
        usage: `${PREFIX}block [منشن/آي دي]`,
        details: '**- نظام حظر المستخدمين من استخدام أوامر البوت مع إدارة قائمة الحظر**'
      },
      {
        name: 'blocklist',
        description: '**Block List**',
        usage: `${PREFIX}blocklist`,
        details: '**- عرض قائمة المستخدمين المحظورين مع إمكانية إلغاء الحظر**'
      }
    ];

    // فلترة الأوامر حسب الصلاحيات
     const menuOptions = commands.map(cmd => ({

      label: cmd.name,

      description: cmd.description.replace(/\*/g, ''),

      value: cmd.name

    }));

    const selectMenu = new StringSelectMenuBuilder()

      .setCustomId('help_command_select')

      .setPlaceholder('اختر أمراً لعرض تفاصيله...')

      .addOptions(menuOptions);

    const cancelButton = new ButtonBuilder()

      .setCustomId('help_cancel')

      .setLabel('إلغاء')

      .setStyle(ButtonStyle.Danger);

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder().addComponents(cancelButton);

    const sentMessage = await message.channel.send({ 

      components: [row1, row2] 

    });

    // إنشاء collector للتفاعلات

    const filter = i => i.user.id === message.author.id;

    const collector = message.channel.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async interaction => {

      try {

        // Check if interaction is still valid and not expired

        const now = Date.now();

        const interactionAge = now - interaction.createdTimestamp;

        

        if (interactionAge > 14 * 60 * 1000) { // 14 minutes

          console.log('تم تجاهل تفاعل منتهي الصلاحية');

          return;

        }

        if (!interaction || !interaction.isRepliable()) {

          console.log('تم تجاهل تفاعل غير صالح');

          return;

        }

        // Prevent duplicate responses

        if (interaction.replied || interaction.deferred) {

          console.log('تم تجاهل تفاعل تم الرد عليه مسبقاً');

          return;

        }

        

        if (interaction.customId === 'help_cancel') {

          try {

            await interaction.update({ 

              content: '**تم إلغاء قائمة المساعدة**', 

              embeds: [], 

              components: [] 

            });

            setTimeout(() => {

              interaction.message.delete().catch(() => {});

            }, 2000);

          } catch (error) {

            console.error('خطأ في إلغاء المساعدة:', error);

          }

          return;

        }

        if (interaction.customId === 'help_command_select') {

          const selectedCommand = interaction.values[0];

          const commandInfo = commands.find(cmd => cmd.name === selectedCommand);

          if (commandInfo) {

            const detailEmbed = colorManager.createEmbed()

              .setTitle(`**Command : ${commandInfo.name}**`)

              .setThumbnail('https://cdn.discordapp.com/attachments/1393840634149736508/1398096852456574996/images__2_-removebg-preview_2.png?ex=68841ea9&is=6882cd29&hm=0dd6d1378c1aa15cc1edb77c9bc67e46ec78ba811268d90ca90ed6c8121ae3f2&')

              .addFields(

                { name: '** - Description**', value: commandInfo.description, inline: false },

                { name: '** - Details**', value: commandInfo.details, inline: false }

              )

              .setFooter({ text: 'By Ahmed.' })

              .setTimestamp();

            await interaction.update({ 

              embeds: [detailEmbed], 

              components: [row1, row2] 

            });

          }

        }

      } catch (error) {

        console.error('خطأ في معالجة تفاعل المساعدة:', error);

        

        // Only try to respond if interaction is still valid and not responded to

        if (interaction && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {

          try {

            await interaction.reply({ 

              content: '**- حدث خطأ أثناء معالجة طلبك**', 

              flags: 64 // Use flags instead of ephemeral

            });

          } catch (replyError) {

            console.error('فشل في الرد على خطأ التفاعل:', replyError);

          }

        }

      }

    });

    collector.on('end', () => {

      // تعطيل المنيو بعد انتهاء الوقت

      const disabledRow1 = new ActionRowBuilder().addComponents(

        StringSelectMenuBuilder.from(selectMenu).setDisabled(true)

      );

      const disabledRow2 = new ActionRowBuilder().addComponents(

        ButtonBuilder.from(cancelButton).setDisabled(true)

      );

      sentMessage.edit({ components: [disabledRow1, disabledRow2] }).catch(() => {});

    });

  }

};
            
            
            