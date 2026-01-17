const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    EmbedBuilder, 
    MessageFlags 
} = require('discord.js');
const { dbManager } = require('../utils/database.js');
const colorManager = require('../utils/colorManager.js');

module.exports = {
    name: 'مسؤوليه',
    description: 'إدارة مسؤوليات عضو (للأونرز فقط)',
    aliases: ['مسؤولية'],
    async execute(message, args) {
        try {
            // التحقق من الصلاحيات - الاونرز فقط
            const botConfig = global.botConfig || { owners: [] };
            const BOT_OWNERS_ENV = process.env.BOT_OWNERS ? process.env.BOT_OWNERS.split(',') : [];
            const allOwners = [...new Set([...BOT_OWNERS_ENV, ...(botConfig.owners || []), ...(global.BOT_OWNERS || [])])];
            
            const isOwner = allOwners.includes(message.author.id);
            
            if (!isOwner) {
                return message.react('❌');
            }

            const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
            if (!target) {
                return message.reply({ content: '**يرجى منشن عضو أو وضع الأيدي الخاص به بشكل صحيح.**' });
            }

            const embed = colorManager.createEmbed()
                .setTitle('**إدارة مسؤوليات العضو**')
                .setDescription(`**العضو المستهدف:** ${target}\n **الأيدي :** \`${target.id}\`\n\n**الرجاء اختيار الإجراء المطلوب  :**`)
                .setThumbnail(target.user.displayAvatarURL())
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`resp_add_${target.id}`)
                        .setLabel('إضافة مسؤولية')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('➕'),
                    new ButtonBuilder()
                        .setCustomId(`resp_remove_${target.id}`)
                        .setLabel('إزالة مسؤولية')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('➖')
                );

            const msg = await message.reply({ embeds: [embed], components: [row] });

            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 60000
            });

            collector.on('collect', async i => {
                try {
                    const [action, type, targetId] = i.customId.split('_');
                    if (action !== 'resp') return;

                    const member = i.guild.members.cache.get(targetId);
                    if (!member) {
                        return i.update({ content: '❌ **تعذر العثور على العضو في السيرفر حالياً.**', embeds: [], components: [] });
                    }

                    const allResps = await dbManager.getResponsibilities();
                    if (!allResps || Object.keys(allResps).length === 0) {
                        return i.update({ content: '⚠️ **لا توجد أي مسؤوليات معرفة في النظام حالياً.**', embeds: [], components: [] });
                    }

                    const respNames = Object.keys(allResps);

                    if (type === 'add') {
                        const availableResps = respNames.filter(name => !allResps[name].responsibles.includes(targetId));
                        if (availableResps.length === 0) {
                            return i.update({ content: '❌ **هذا العضو يمتلك جميع المسؤوليات المتاحة بالفعل.**', embeds: [], components: [] });
                        }

                        const select = new StringSelectMenuBuilder()
                            .setCustomId(`confirm_add_${targetId}`)
                            .setPlaceholder(' اختر المسؤوليات المراد إضافتها')
                            .setMinValues(1)
                            .setMaxValues(Math.min(availableResps.length, 25))
                            .addOptions(availableResps.slice(0, 25).map(name => ({ 
                                label: name, 
                                value: name,
                                description: `إضافة مسؤولية ${name}`
                            })));

                        await i.update({ 
                            content: ' **الرجاء اختيار المسؤوليات المراد منحها للعضو :**', 
                            components: [new ActionRowBuilder().addComponents(select)],
                            embeds: []
                        });
                    } else if (type === 'remove') {
                        const currentResps = respNames.filter(name => allResps[name].responsibles.includes(targetId));
                        if (currentResps.length === 0) {
                            return i.update({ content: '❌ **هذا العضو لا يملك أي مسؤوليات لإزالتها.**', embeds: [], components: [] });
                        }

                        const select = new StringSelectMenuBuilder()
                            .setCustomId(`confirm_remove_${targetId}`)
                            .setPlaceholder(' اختر المسؤوليات المراد إزالتها')
                            .setMinValues(1)
                            .setMaxValues(Math.min(currentResps.length, 25))
                            .addOptions(currentResps.slice(0, 25).map(name => ({ 
                                label: name, 
                                value: name,
                                description: `إزالة مسؤولية ${name}`
                            })));

                        await i.update({ 
                            content: '**الرجاء اختيار المسؤوليات المراد سحبها من العضو :**', 
                            components: [new ActionRowBuilder().addComponents(select)],
                            embeds: []
                        });
                    }
                } catch (error) {
                    console.error('Error in interaction:', error);
                    await i.followUp({ content: '❌ **حدث خطأ غير متوقع أثناء معالجة الطلب.**', flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    msg.edit({ components: [] }).catch(() => {});
                }
            });

            const interactionCollector = message.channel.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id && i.isStringSelectMenu() && i.customId.startsWith('confirm_'),
                time: 120000
            });

            interactionCollector.on('collect', async i => {
                try {
                    const [action, type, targetId] = i.customId.split('_');
                    const selectedResps = i.values;
                    const member = i.guild.members.cache.get(targetId);
                    
                    if (!member) {
                        return i.update({ content: '❌ **فشل التحديث: العضو غادر السيرفر.**', components: [], embeds: [] });
                    }

                    await i.deferUpdate();

                    const allResps = await dbManager.getResponsibilities();
                    const addedResps = [];
                    const removedResps = [];
                    const errors = [];

                    for (const respName of selectedResps) {
                        const config = allResps[respName];
                        if (!config) continue;
                        
                        // رولات المسؤولية من ملف الإعدادات (دعم رول واحد أو قائمة رولات)
                        const roleIds = [];
                        if (config.roleId) roleIds.push(config.roleId);
                        if (Array.isArray(config.roles)) {
                            config.roles.forEach(r => {
                                if (r && !roleIds.includes(r)) roleIds.push(r);
                            });
                        }

                        try {
                            if (type === 'add') {
                                if (!config.responsibles.includes(targetId)) {
                                    config.responsibles.push(targetId);
                                    const success = await dbManager.updateResponsibility(respName, config);
                                    if (success) {
                                        addedResps.push(`**${respName}**`);
                                        
                                        for (const rId of roleIds) {
                                            try {
                                                const guildRole = await i.guild.roles.fetch(rId);
                                                if (guildRole) {
                                                    await member.roles.add(guildRole).catch(err => {
                                                        console.error(`Failed to add role ${rId}:`, err);
                                                        errors.push(`فشل إضافة الرول لمسؤولية **${respName}** (تأكد من ترتيب رتبة البوت)`);
                                                    });
                                                }
                                            } catch (roleErr) {
                                                console.error(`Role fetch error for ${rId}:`, roleErr);
                                            }
                                        }
                                    }
                                }
                            } else if (type === 'remove') {
                                const idx = config.responsibles.indexOf(targetId);
                                if (idx > -1) {
                                    config.responsibles.splice(idx, 1);
                                    const success = await dbManager.updateResponsibility(respName, config);
                                    if (success) {
                                        removedResps.push(`**${respName}**`);
                                        
                                        for (const rId of roleIds) {
                                            // التأكد أن العضو لا يملك مسؤولية أخرى تستخدم نفس الرول
                                            const stillNeedsRole = Object.values(allResps).some(r => {
                                                const rIds = [];
                                                if (r.roleId) rIds.push(r.roleId);
                                                if (Array.isArray(r.roles)) r.roles.forEach(rid => rIds.push(rid));
                                                return rIds.includes(rId) && r.responsibles.includes(targetId);
                                            });

                                            if (!stillNeedsRole) {
                                                try {
                                                    const guildRole = await i.guild.roles.fetch(rId);
                                                    if (guildRole) {
                                                        await member.roles.remove(guildRole).catch(err => {
                                                            console.error(`Failed to remove role ${rId}:`, err);
                                                            errors.push(`فشل إزالة الرول لمسؤولية **${respName}** (تأكد من ترتيب رتبة البوت)`);
                                                        });
                                                    }
                                                } catch (roleErr) {
                                                    console.error(`Role fetch error for ${rId}:`, roleErr);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`Error processing ${respName}:`, err);
                            errors.push(`خطأ في معالجة **${respName}**`);
                        }
                    }

                    let responseContent = '';
                    if (type === 'add') {
                        responseContent = addedResps.length > 0 
                            ? `✅ **تم بنجاح منح المسؤوليات التالية للعضو :** ${addedResps.join('  ,  ')}`
                            : `⚠️ **لم يتم إضافة أي مسؤوليات جديدة.**`;
                        
                        if (addedResps.length > 0) {
                            try {
                                const addEmbed = colorManager.createEmbed()
                                    .setTitle(' Added')
                                    .setDescription(`تم منحك المسؤوليات التالية : ${addedResps.join(' , ')}\nمن المسؤول : <@${i.user.id}>`)
                                    .setFooter({ text: i.guild.name })
                                    .setTimestamp();
                                await member.send({ embeds: [addEmbed] }).catch(() => {});
                            } catch (e) {}
                        }
                    } else {
                        responseContent = removedResps.length > 0 
                            ? `✅ **تم بنجاح سحب المسؤوليات التالية من العضو :** ${removedResps.join('  ,  ')}`
                            : `⚠️ **لم يتم إزالة أي مسؤوليات.**`;

                        if (removedResps.length > 0) {
                            try {
                                const removeEmbed = colorManager.createEmbed()
                                    .setTitle('⚠️Removed')
                                    .setDescription(`تم ازالتك من المسؤوليات : ${removedResps.join(' , ')}\nمن المسؤول : <@${i.user.id}>`)
                                    .setFooter({ text: i.guild.name })
                                    .setTimestamp();
                                await member.send({ embeds: [removeEmbed] }).catch(() => {});
                            } catch (e) {}
                        }
                    }

                    if (errors.length > 0) {
                        responseContent += `\n\n⚠️ **تنبيهات:**\n- ${errors.join('\n- ')}`;
                    }

                    await i.editReply({
                        content: `${responseContent}\n **العضو :** <@${targetId}>`,
                        components: [],
                        embeds: []
                    });
                    interactionCollector.stop();
                } catch (error) {
                    console.error('Error in select menu interaction:', error);
                    await i.followUp({ content: '❌ **حدث خطأ أثناء تنفيذ العملية النهائية.**', flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            });

        } catch (error) {
            console.error('Main command error:', error);
            message.reply({ content: '❌ **حدث خطأ فني أثناء تنفيذ الأمر. يرجى مراجعة سجلات البوت.**' }).catch(() => {});
        }
    }
};
