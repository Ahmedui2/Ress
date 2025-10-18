const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');

const DATA_FILES = {
    categories: path.join(__dirname, '..', 'data', 'respCategories.json'),
    responsibilities: path.join(__dirname, '..', 'data', 'responsibilities.json')
};

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

async function updateRespEmbeds(client) {
    try {
        const respCommand = client.commands.get('resp');
        if (respCommand && respCommand.updateEmbedMessage) {
            await respCommand.updateEmbedMessage(client);
            console.log('✅ تم تحديث رسائل الإيمبد تلقائياً');
        }
    } catch (error) {
        console.error('خطأ في تحديث رسائل الإيمبد:', error);
    }
}

function createCategoriesListEmbed(categories) {
    const embed = colorManager.createEmbed()
        .setTitle('Categories List');
    
    if (Object.keys(categories).length === 0) {
        embed.setDescription('لا توجد أقسام محددة حالياً\n\nاستخدم الأزرار أدناه لإضافة قسم جديد');
    } else {
        let description = '**الأقسام الحالية:**\n\n';
        const sortedCategories = Object.entries(categories).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
        
        sortedCategories.forEach(([catName, catData], index) => {
            const respCount = catData.responsibilities ? catData.responsibilities.length : 0;
            description += `**${index + 1}.** ${catName}\n`;
            description += `   عدد المسؤوليات : ${respCount}\n\n`;
        });
        
        embed.setDescription(description);
    }
    
    return embed;
}

function createMainMenuButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('add_category')
                .setLabel('Add')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('edit_category')
                .setLabel('Edit')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('delete_category')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('manage_category_resps')
                .setLabel('responsibilities')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createCategorySelectMenu(categories, customId = 'select_category', placeholder = 'اختر قسماً...') {
    const sortedCategories = Object.entries(categories).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
    
    const options = sortedCategories.map(([catName, catData], index) => ({
        label: catName,
        value: catName,
        description: `${catData.responsibilities ? catData.responsibilities.length : 0} مسؤولية`,
        
    }));
    
    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(options.length > 0 ? options : [{ label: 'لا توجد أقسام', value: 'none', description: 'قم بإضافة قسم أولاً' }])
        .setDisabled(options.length === 0);
}

module.exports = {
    name: 'ctg',
    description: 'إدارة أقسام المسؤوليات',
    
    async execute(message, args, context) {
        const { client } = context;
        
        const botConfig = readJSONFile(path.join(__dirname, '..', 'data', 'botConfig.json'), {});
        const BOT_OWNERS = botConfig.owners || [];
        const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;

        if (!isOwner) {
            await message.react('❌');
            return;
        }

        const categories = readJSONFile(DATA_FILES.categories, {});
        const embed = createCategoriesListEmbed(categories);
        const buttons = createMainMenuButtons();

        const msg = await message.channel.send({
            embeds: [embed],
            components: [buttons]
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            time: 300000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'add_category') {
                const modal = new ModalBuilder()
                    .setCustomId('add_category_modal')
                    .setTitle('إضافة قسم جديد');

                const nameInput = new TextInputBuilder()
                    .setCustomId('category_name')
                    .setLabel('اسم القسم')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('مثال: قسم الإدارة')
                    .setRequired(true)
                    .setMaxLength(100);

                const orderInput = new TextInputBuilder()
                    .setCustomId('category_order')
                    .setLabel('الترتيب (رقم)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('1')
                    .setRequired(false)
                    .setMaxLength(3);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput),
                    new ActionRowBuilder().addComponents(orderInput)
                );

                await interaction.showModal(modal);

            } else if (interaction.customId === 'edit_category') {
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                
                if (Object.keys(currentCategories).length === 0) {
                    await interaction.reply({
                        content: '❌ لا توجد أقسام للتعديل',
                        ephemeral: true
                    });
                    return;
                }

                const selectMenu = createCategorySelectMenu(currentCategories, 'select_category_to_edit', 'اختر قسماً للتعديل...');
                
                await interaction.reply({
                    content: '**اختر القسم الذي تريد تعديله:**',
                    components: [new ActionRowBuilder().addComponents(selectMenu)],
                    ephemeral: true
                });

            } else if (interaction.customId === 'delete_category') {
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                
                if (Object.keys(currentCategories).length === 0) {
                    await interaction.reply({
                        content: '❌ لا توجد أقسام للحذف',
                        ephemeral: true
                    });
                    return;
                }

                const selectMenu = createCategorySelectMenu(currentCategories, 'select_category_to_delete', 'اختر قسماً للحذف...');
                
                await interaction.reply({
                    content: '**اختر القسم الذي تريد حذفه:**',
                    components: [new ActionRowBuilder().addComponents(selectMenu)],
                    ephemeral: true
                });

            } else if (interaction.customId === 'manage_category_resps') {
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                
                if (Object.keys(currentCategories).length === 0) {
                    await interaction.reply({
                        content: '❌ لا توجد أقسام. قم بإضافة قسم أولاً',
                        ephemeral: true
                    });
                    return;
                }

                const selectMenu = createCategorySelectMenu(currentCategories, 'select_category_for_resps', 'اختر قسماً...');
                
                await interaction.reply({
                    content: '**اختر القسم لإدارة مسؤولياته:**',
                    components: [new ActionRowBuilder().addComponents(selectMenu)],
                    ephemeral: true
                });

            } else if (interaction.customId === 'select_category_to_edit') {
                const categoryName = interaction.values[0];
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                const categoryData = currentCategories[categoryName];

                const modal = new ModalBuilder()
                    .setCustomId(`edit_category_modal_${categoryName}`)
                    .setTitle('تعديل القسم');

                const nameInput = new TextInputBuilder()
                    .setCustomId('category_new_name')
                    .setLabel('الاسم الجديد للقسم')
                    .setStyle(TextInputStyle.Short)
                    .setValue(categoryName)
                    .setRequired(true)
                    .setMaxLength(100);

                const orderInput = new TextInputBuilder()
                    .setCustomId('category_new_order')
                    .setLabel('الترتيب الجديد (رقم)')
                    .setStyle(TextInputStyle.Short)
                    .setValue((categoryData.order || 0).toString())
                    .setRequired(false)
                    .setMaxLength(3);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(nameInput),
                    new ActionRowBuilder().addComponents(orderInput)
                );

                await interaction.showModal(modal);

            } else if (interaction.customId === 'select_category_to_delete') {
                const categoryName = interaction.values[0];
                
                const confirmRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_delete_${categoryName}`)
                            .setLabel('✅ تأكيد الحذف')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('cancel_delete')
                            .setLabel('❌ إلغاء')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.update({
                    content: `**⚠️ هل أنت متأكد من حذف القسم "${categoryName}"؟**\n\nسيتم حذف القسم فقط، المسؤوليات ستبقى موجودة.`,
                    components: [confirmRow]
                });

            } else if (interaction.customId.startsWith('confirm_delete_')) {
                const categoryName = interaction.customId.replace('confirm_delete_', '');
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                
                delete currentCategories[categoryName];
                writeJSONFile(DATA_FILES.categories, currentCategories);
                
                await interaction.update({
                    content: `✅ تم حذف القسم "${categoryName}" بنجاح`,
                    components: []
                });

                await updateRespEmbeds(client);

                const updatedEmbed = createCategoriesListEmbed(currentCategories);
                await msg.edit({ embeds: [updatedEmbed], components: [buttons] });

            } else if (interaction.customId === 'cancel_delete') {
                await interaction.update({
                    content: '❌ تم إلغاء الحذف',
                    components: []
                });

            } else if (interaction.customId === 'select_category_for_resps') {
                const categoryName = interaction.values[0];
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                const responsibilities = readJSONFile(DATA_FILES.responsibilities, {});
                const categoryData = currentCategories[categoryName] || { responsibilities: [] };
                
                const allRespNames = Object.keys(responsibilities);
                const currentRespNames = categoryData.responsibilities || [];

                if (allRespNames.length === 0) {
                    await interaction.update({
                        content: '❌ لا توجد مسؤوليات متاحة. يجب إنشاء مسؤوليات أولاً من خلال الأوامر الأخرى.',
                        components: []
                    });
                    return;
                }

                const options = allRespNames.map(respName => ({
                    label: respName,
                    value: respName,
                    description: currentRespNames.includes(respName) ? '✅ مضافة حالياً' : 'غير مضافة',
                    default: currentRespNames.includes(respName)
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`add_resps_to_category_${categoryName}`)
                    .setPlaceholder('اختر المسؤوليات لإضافتها...')
                    .setMinValues(0)
                    .setMaxValues(Math.min(options.length, 25))
                    .addOptions(options);

                const actionButtons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`save_category_resps_${categoryName}`)
                            .setLabel('Save')
                            .setStyle(ButtonStyle.Success)
                    );

                await interaction.update({
                    content: `**إدارة مسؤوليات القسم: ${categoryName}**\n\nاختر المسؤوليات التي تريد إضافتها لهذا القسم:`,
                    components: [new ActionRowBuilder().addComponents(selectMenu), actionButtons]
                });

            } else if (interaction.customId.startsWith('add_resps_to_category_')) {
                const categoryName = interaction.customId.replace('add_resps_to_category_', '');
                const selectedResps = interaction.values;
                
                const tempData = interaction.message.tempCategoryResps || {};
                tempData[categoryName] = selectedResps;
                interaction.message.tempCategoryResps = tempData;

                await interaction.deferUpdate();

            } else if (interaction.customId.startsWith('save_category_resps_')) {
                const categoryName = interaction.customId.replace('save_category_resps_', '');
                const selectedResps = interaction.message.tempCategoryResps?.[categoryName] || [];
                
                const currentCategories = readJSONFile(DATA_FILES.categories, {});
                
                if (!currentCategories[categoryName]) {
                    currentCategories[categoryName] = { order: 0, responsibilities: [] };
                }
                
                currentCategories[categoryName].responsibilities = selectedResps;
                writeJSONFile(DATA_FILES.categories, currentCategories);

                await interaction.update({
                    content: `✅ تم حفظ ${selectedResps.length} مسؤولية للقسم "${categoryName}"`,
                    components: []
                });

                await updateRespEmbeds(client);

                const updatedEmbed = createCategoriesListEmbed(currentCategories);
                await msg.edit({ embeds: [updatedEmbed], components: [buttons] });
            }
        });

        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => {});
        });
    },

    async handleModalSubmit(interaction, client) {
        if (interaction.customId === 'add_category_modal') {
            const categoryName = interaction.fields.getTextInputValue('category_name');
            const orderInput = interaction.fields.getTextInputValue('category_order');
            const order = orderInput ? parseInt(orderInput) : Object.keys(readJSONFile(DATA_FILES.categories, {})).length + 1;

            const categories = readJSONFile(DATA_FILES.categories, {});
            
            if (categories[categoryName]) {
                await interaction.reply({
                    content: `❌ القسم "${categoryName}" موجود بالفعل`,
                    ephemeral: true
                });
                return;
            }

            categories[categoryName] = {
                order: order,
                responsibilities: []
            };

            writeJSONFile(DATA_FILES.categories, categories);

            await interaction.reply({
                content: `✅ تم إضافة القسم "${categoryName}" بنجاح`,
                ephemeral: true
            });

            await updateRespEmbeds(client);

        } else if (interaction.customId.startsWith('edit_category_modal_')) {
            const oldCategoryName = interaction.customId.replace('edit_category_modal_', '');
            const newCategoryName = interaction.fields.getTextInputValue('category_new_name');
            const orderInput = interaction.fields.getTextInputValue('category_new_order');
            const newOrder = orderInput ? parseInt(orderInput) : 0;

            const categories = readJSONFile(DATA_FILES.categories, {});
            
            if (oldCategoryName !== newCategoryName && categories[newCategoryName]) {
                await interaction.reply({
                    content: `❌ القسم "${newCategoryName}" موجود بالفعل`,
                    ephemeral: true
                });
                return;
            }

            const categoryData = categories[oldCategoryName];
            delete categories[oldCategoryName];
            
            categories[newCategoryName] = {
                order: newOrder,
                responsibilities: categoryData.responsibilities || []
            };

            writeJSONFile(DATA_FILES.categories, categories);

            await interaction.reply({
                content: `✅ تم تعديل القسم بنجاح`,
                ephemeral: true
            });

            await updateRespEmbeds(client);
        }
    }
};
