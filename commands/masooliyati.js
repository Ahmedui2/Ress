
const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

const colorManager = require('../utils/colorManager.js');

const { isUserBlocked } = require('./block.js');

const fs = require('fs');

const path = require('path');

module.exports = {

    name: 'مسؤولياتي',

    aliases: ['مسؤولياتي', 'مسؤولتي'],

    description: 'تقديم شخص للحصول على صلاحيات إدارية',

    async execute(message, args, { responsibilities, client, BOT_OWNERS, ADMIN_ROLES }) {

        // فحص البلوك أولاً

        if (isUserBlocked(message.author.id)) {

            const blockedEmbed = colorManager.createEmbed()

                .setDescription('**أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')

                .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

            await message.channel.send({ embeds: [blockedEmbed] });

            return;

        }

        const member = await message.guild.members.fetch(message.author.id);

        const hasAdminRole = ADMIN_ROLES && ADMIN_ROLES.length > 0 && member.roles.cache.some(role => ADMIN_ROLES.includes(role.id));

        const hasAdministrator = member.permissions.has('Administrator');

        const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

        if (!hasAdminRole && !isOwner && !hasAdministrator) {

            await message.react('❌');

            return;

        }

        // التحقق من وجود منشن

        let targetUser = message.mentions.users.first() || message.author;

        let userId = targetUser.id;

        // تحميل المسؤوليات الحديثة من الملف مباشرة

        const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

        const categoriesPath = path.join(__dirname, '..', 'data', 'respCategories.json');

        let currentResponsibilities = {};

        let categories = {};

        try {

            if (fs.existsSync(responsibilitiesPath)) {

                const data = fs.readFileSync(responsibilitiesPath, 'utf8');

                currentResponsibilities = JSON.parse(data);

            }

        } catch (error) {

            console.error('خطأ في قراءة المسؤوليات:', error);

            currentResponsibilities = responsibilities || {};

        }

        try {

            if (fs.existsSync(categoriesPath)) {

                const data = fs.readFileSync(categoriesPath, 'utf8');

                categories = JSON.parse(data);

            }

        } catch (error) {

            console.error('خطأ في قراءة الأقسام:', error);

            categories = {};

        }

        // دالة للبحث عن قسم المسؤولية

        function findCategoryForResp(respName) {

            for (const [catName, catData] of Object.entries(categories)) {

                if (catData.responsibilities && catData.responsibilities.includes(respName)) {

                    return catName;

                }

            }

            return null;

        }

        // البحث عن مسؤوليات المستخدم المحدد

        const userResponsibilities = [];

        for (const [respName, respData] of Object.entries(currentResponsibilities)) {

            if (respData.responsibles && respData.responsibles.includes(userId)) {

                const otherResponsibles = respData.responsibles.filter(id => id !== userId);

                const category = findCategoryForResp(respName);

                userResponsibilities.push({

                    name: respName,

                    description: respData.description || 'لا يوجد وصف',

                    otherResponsiblesCount: otherResponsibles.length,

                    category: category

                });

            }

        }

        // إنشاء الرد

        if (userResponsibilities.length === 0) {

            const displayName = targetUser.displayName || targetUser.username;

            const noRespEmbed = colorManager.createEmbed()

                .setTitle(`مسؤوليات ${displayName}`)

                .setDescription(userId === message.author.id ?

                    '**ليس لديك أي مسؤوليات معينة حتى الآن.**' :

                    `**${displayName} ليس لديه أي مسؤوليات معينة حتى الآن.**`)

                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }));

            await message.channel.send({ embeds: [noRespEmbed] });

        } else {

            // فحص إذا كانت جميع المسؤوليات من نفس القسم

            const categories = userResponsibilities.map(r => r.category).filter(c => c !== null);

            const uniqueCategories = [...new Set(categories)];

            const allSameCategory = uniqueCategories.length === 1 && categories.length === userResponsibilities.length;

            let responsibilitiesList;

            let descriptionText = userId === message.author.id ? '** Your Res :**\n\n' : `**Res ${targetUser.displayName || targetUser.username}:**\n\n`;

            

            if (allSameCategory) {

                // جميع المسؤوليات من نفس القسم - عرض مميز

                descriptionText += `<:emoji_4:1428973990315167814>  **Category : ${uniqueCategories[0]}**\n\n`;

                responsibilitiesList = userResponsibilities.map((resp, index) => 

                    `**${index + 1}.** ${resp.name}`

                ).join('\n');

            } else {

                // مسؤوليات من أقسام مختلفة أو بعضها بدون قسم

                responsibilitiesList = userResponsibilities.map((resp, index) => {

                    let line = `**${index + 1}.** ${resp.name}`;

                    if (resp.category) {

                        line += `\n   <:emoji_4:1428973990315167814>  Category : ${resp.category}`;

                    }

                    return line;

                }).join('\n\n');

            }

            const displayName = targetUser.displayName || targetUser.username;

            const respEmbed = colorManager.createEmbed()

                .setTitle(`Res : ${displayName}`)

                .setDescription(descriptionText + responsibilitiesList)

                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))

                .addFields([

                    { name: 'All Res', value: `${userResponsibilities.length}`, inline: true },

                    { name: 'Person', value: `<@${userId}>`, inline: true }

                ])

                .setFooter({ text: 'By Ahmed.' })

                .setTimestamp();

            const selectMenu = new StringSelectMenuBuilder()

                .setCustomId('masooliyati_select_desc')

                .setPlaceholder('اختر مسؤولية لعرض شرحها')

                .addOptions(userResponsibilities.map(resp => ({

                    label: resp.name.substring(0, 100),

                    value: resp.name,

                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const sentMessage = await message.channel.send({ embeds: [respEmbed], components: [row] });

            const filter = (interaction) =>

                interaction.customId === 'masooliyati_select_desc' &&

                interaction.user.id === message.author.id;

            const collector = sentMessage.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async (interaction) => {

                const selectedRespName = interaction.values[0];

                const selectedResp = userResponsibilities.find(r => r.name === selectedRespName);

                if (selectedResp) {

                    const desc = selectedResp.description || 'لا يوجد وصف لهذه المسؤولية.';

                    await interaction.reply({

                        content: `**شرح مسؤولية "${selectedRespName}" :**\n${desc}`,

                        ephemeral: true

                    });

                }

            });

            collector.on('end', () => {

                const disabledRow = new ActionRowBuilder().addComponents(

                    StringSelectMenuBuilder.from(selectMenu).setDisabled(true)

                );

                sentMessage.edit({ components: [disabledRow] }).catch(() => {});

            });

        }

    }

};