const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('./colorManager');

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

// --- Helper Functions ---
function readJson(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultData;
}

function saveVacations(data) {
    try {
        fs.writeFileSync(vacationsPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing vacations.json:', error);
        return false;
    }
}

// --- Public Functions ---

function getSettings() {
    const vacations = readJson(vacationsPath, { settings: {} });
    return vacations.settings || {};
}

function isUserOnVacation(userId) {
    const vacations = readJson(vacationsPath);
    return !!vacations.active?.[userId];
}

async function approveVacation(interaction, userId, approverId) {
    const vacations = readJson(vacationsPath);
    const request = vacations.pending?.[userId];

    if (!request) {
        return { success: false, message: 'No pending vacation request found for this user.' };
    }

    // التحقق من أن الطلب لم يتم معالجته مسبقاً
    if (request.processed) {
        return { success: false, message: 'This request has already been processed.' };
    }

    // وضع علامة المعالجة لمنع النقر المتكرر
    request.processed = true;
    saveVacations(vacations);

    const guild = interaction.guild;
    if (!guild) return { success: false, message: 'Interaction did not originate from a guild.' };

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { success: false, message: 'User not found in the guild.' };

    const adminRoles = readJson(adminRolesPath, []);
    const rolesToRemove = member.roles.cache.filter(role => adminRoles.includes(role.id));
    const removedRoleIds = rolesToRemove.map(role => role.id);

    try {
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove);
        }
    } catch (error) {
        console.error(`Failed to remove roles from ${member.user.tag}:`, error);
        return { success: false, message: 'Failed to remove user roles. Check bot permissions.' };
    }

    const activeVacation = { ...request, status: 'active', approvedBy: approverId, approvedAt: new Date().toISOString(), removedRoles: removedRoleIds };
    
    if (!vacations.active) {
        vacations.active = {};
    }
    
    vacations.active[userId] = activeVacation;
    delete vacations.pending[userId];
    saveVacations(vacations);

    return { success: true, vacation: activeVacation };
}

// دالة لحساب مدة الإجازة
function calculateVacationDuration(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
}

// دالة لإرسال إشعار للإدارة عند انتهاء الإجازة
async function notifyAdminsVacationEnded(client, guild, vacation, userId, reason, rolesRestored) {
    try {
        const settings = getSettings();
        if (!settings.notificationMethod || !settings.approverType) {
            console.log('⚠️ إعدادات الإشعارات غير مكتملة، لن يتم إرسال إشعار للإدارة');
            return;
        }

        const user = await client.users.fetch(userId).catch(() => null);
        const duration = calculateVacationDuration(vacation.startDate, vacation.endDate);
        const actualEndDate = new Date();
        
        // حساب مدة الإجازة بدقة (أيام، ساعات، دقائق، ثواني)
        const startTime = new Date(vacation.startDate).getTime();
        const endTime = actualEndDate.getTime();
        const totalMs = endTime - startTime;
        
        const totalSeconds = Math.floor(totalMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        let durationText = '';
        if (days > 0) {
            durationText += `${days} يوم `;
        }
        if (hours > 0) {
            durationText += `${hours} ساعة `;
        }
        if (minutes > 0) {
            durationText += `${minutes} دقيقة `;
        }
        if (seconds > 0 || durationText === '') {
            durationText += `${seconds} ثانية`;
        }
        durationText = durationText.trim();
        
        const embed = colorManager.createEmbed()
            .setTitle('🏁 انتهت إجازة')
            .setColor(colorManager.getColor('ended') || '#FFA500')
            .setDescription(`**انتهت إجازة <@${userId}>**`)
            .addFields(
                { name: '📅 مدة الإجازة', value: durationText, inline: true },
                { name: '🔚 سبب الإنهاء', value: reason, inline: true },
                { name: '📋 الأدوار المستعادة', value: rolesRestored.map(id => `<@&${id}>`).join(', ') || 'لا توجد', inline: false },
                { name: '⏰ تاريخ البدء', value: new Date(vacation.startDate).toLocaleString('en-US', { 
                    timeZone: 'Asia/Riyadh',
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit'
                }), inline: true },
                { name: '⏰ تاريخ الانتهاء الأصلي', value: new Date(vacation.endDate).toLocaleString('en-US', { 
                    timeZone: 'Asia/Riyadh',
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit'
                }), inline: true },
                { name: '⏰ تاريخ الانتهاء الفعلي', value: actualEndDate.toLocaleString('en-US', { 
                    timeZone: 'Asia/Riyadh',
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit', 
                    hour: '2-digit', 
                    minute: '2-digit'
                }), inline: true }
            )
            .setTimestamp();

        if (user) {
            embed.setAuthor({
                name: user.tag,
                iconURL: user.displayAvatarURL()
            });
        }

        // إرسال الإشعار حسب طريقة الإشعار المحددة
        if (settings.notificationMethod === 'channel' && settings.notificationChannel) {
            const channel = await client.channels.fetch(settings.notificationChannel).catch(() => null);
            if (channel) {
                await channel.send({ embeds: [embed] });
                console.log(`✅ تم إرسال إشعار انتهاء إجازة ${userId} للقناة ${channel.name}`);
            }
        } else if (settings.notificationMethod === 'dm') {
            const approvers = await getApprovers(guild, settings, []);
            for (const approver of approvers) {
                await approver.send({ embeds: [embed] }).catch(e => 
                    console.log(`فشل في إرسال إشعار انتهاء إجازة لـ ${approver.tag}: ${e.message}`)
                );
            }
            console.log(`✅ تم إرسال إشعار انتهاء إجازة ${userId} للمعتمدين`);
        }
    } catch (error) {
        console.error('❌ خطأ في إرسال إشعار انتهاء الإجازة للإدارة:', error);
    }
}

async function endVacation(guild, client, userId, reason = 'انتهت فترة الإجازة.') {
    try {
        const vacations = readJson(vacationsPath);
        const vacation = vacations.active?.[userId];

        if (!vacation) {
            return { success: false, message: 'لا توجد إجازة نشطة لهذا المستخدم.' };
        }

        if (!guild) {
            return { success: false, message: 'لم يتم توفير سياق الخادم.' };
        }

        console.log(`🔧 بدء عملية إنهاء إجازة المستخدم ${userId}`);
        
        const member = await guild.members.fetch(userId).catch(() => {
            console.warn(`⚠️ لا يمكن العثور على العضو ${userId} في الخادم`);
            return null;
        });
        
        let rolesRestored = [];

        // استعادة الأدوار إذا كان العضو موجوداً
        if (member && vacation.removedRoles && vacation.removedRoles.length > 0) {
            console.log(`📋 جاري محاولة استعادة ${vacation.removedRoles.length} دور للمستخدم ${member.user.tag}`);
            
            try {
                // التحقق من وجود الأدوار قبل إضافتها
                const validRoles = [];
                const invalidRoles = [];
                
                for (const roleId of vacation.removedRoles) {
                    try {
                        const role = await guild.roles.fetch(roleId);
                        if (role && !member.roles.cache.has(roleId)) {
                            validRoles.push(roleId);
                        } else if (member.roles.cache.has(roleId)) {
                            console.log(`🔄 المستخدم ${member.user.tag} يمتلك الدور ${role.name} بالفعل`);
                            rolesRestored.push(roleId); // اعتبره مستعاداً
                        }
                    } catch (roleError) {
                        console.warn(`⚠️ الدور ${roleId} غير موجود أو لا يمكن الوصول إليه`);
                        invalidRoles.push(roleId);
                    }
                }
                
                if (validRoles.length > 0) {
                    await member.roles.add(validRoles);
                    rolesRestored.push(...validRoles);
                    console.log(`✅ تم استعادة ${validRoles.length} دور بنجاح للمستخدم ${member.user.tag}`);
                }
                
                if (invalidRoles.length > 0) {
                    console.warn(`⚠️ تم تجاهل ${invalidRoles.length} دور غير صالح`);
                }
                
            } catch (roleError) {
                console.error(`❌ فشل في إعادة إضافة الأدوار للمستخدم ${member?.user?.tag || userId}:`, roleError);
                // لا نتوقف هنا، نكمل عملية إنهاء الإجازة
            }
        } else if (!member) {
            console.log(`📋 العضو ${userId} غير موجود في الخادم، تم تخطي استعادة الأدوار`);
        } else {
            console.log(`📋 لا توجد أدوار لاستعادتها للمستخدم ${userId}`);
        }

        // إزالة من الإجازات النشطة والطلبات المعلقة للإنهاء
        delete vacations.active[userId];
        if (vacations.pendingTermination?.[userId]) {
            delete vacations.pendingTermination[userId];
        }
        
        const saveResult = saveVacations(vacations);
        if (!saveResult) {
            console.error('❌ فشل في حفظ ملف الإجازات بعد الإنهاء');
            return { success: false, message: 'فشل في حفظ البيانات' };
        }
        
        console.log(`💾 تم حفظ إنهاء إجازة المستخدم ${userId} في ملف JSON`);

        // إرسال رسالة للمستخدم
        try {
            const user = await client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle('انتهت الإجازة')
                .setColor(colorManager.getColor('ended') || '#FFA500')
                .setDescription(`**انتهت إجازتك. مرحباً بعودتك!**`)
                .addFields(
                    { name: '___سبب الإنهاء___', value: reason },
                    { name: '___الأدوار المستعادة___', value: rolesRestored.map(id => `<@&${id}>`).join(', ') || 'لا توجد' }
                )
                .setTimestamp();

            await user.send({ embeds: [embed] });
            console.log(`📧 تم إرسال رسالة انتهاء الإجازة للمستخدم ${user.tag}`);

        } catch (dmError) {
            console.error(`❌ فشل في إرسال رسالة انتهاء الإجازة للمستخدم ${userId}:`, dmError.message);
        }

        // إرسال إشعار للإدارة
        try {
            await notifyAdminsVacationEnded(client, guild, vacation, userId, reason, rolesRestored);
        } catch (notifyError) {
            console.error('❌ فشل في إرسال إشعار انتهاء الإجازة للإدارة:', notifyError);
        }

        console.log(`🎉 تم إنهاء إجازة المستخدم ${userId} بنجاح`);
        return { success: true, vacation, rolesRestored };
        
    } catch (error) {
        console.error(`💥 خطأ عام في إنهاء إجازة المستخدم ${userId}:`, error);
        return { success: false, message: `خطأ في إنهاء الإجازة: ${error.message}` };
    }
}

async function checkVacations(client) {
    try {
        const vacations = readJson(vacationsPath);
        
        // التحقق من وجود بيانات الإجازات النشطة
        if (!vacations.active || Object.keys(vacations.active).length === 0) {
            return; // لا توجد إجازات نشطة للفحص
        }

        const guild = client.guilds.cache.first();
        if (!guild) {
            console.error('❌ لا يمكن العثور على خادم للبوت');
            return;
        }

        const now = Date.now();
        const expiredUsers = [];
        
        // جمع المستخدمين الذين انتهت إجازاتهم
        for (const userId in vacations.active) {
            const vacation = vacations.active[userId];
            if (!vacation.endDate) {
                console.warn(`⚠️ إجازة المستخدم ${userId} لا تحتوي على تاريخ انتهاء`);
                continue;
            }
            
            const endDate = new Date(vacation.endDate).getTime();
            if (isNaN(endDate)) {
                console.warn(`⚠️ تاريخ انتهاء إجازة المستخدم ${userId} غير صالح: ${vacation.endDate}`);
                continue;
            }

            if (now >= endDate) {
                expiredUsers.push(userId);
            }
        }

        // معالجة الإجازات المنتهية
        if (expiredUsers.length > 0) {
            console.log(`🕒 تم العثور على ${expiredUsers.length} إجازة منتهية`);
            
            for (const userId of expiredUsers) {
                try {
                    console.log(`⏰ جاري إنهاء إجازة المستخدم ${userId}...`);
                    const result = await endVacation(guild, client, userId, 'انتهت فترة الإجازة تلقائياً');
                    
                    if (result.success) {
                        console.log(`✅ تم إنهاء إجازة المستخدم ${userId} تلقائياً بنجاح`);
                        console.log(`📋 تم استعادة ${result.rolesRestored.length} دور للمستخدم`);
                    } else {
                        console.error(`❌ فشل في إنهاء إجازة المستخدم ${userId}: ${result.message}`);
                    }
                } catch (error) {
                    console.error(`💥 خطأ في معالجة إنهاء إجازة المستخدم ${userId}:`, error);
                }
                
                // انتظار قصير بين العمليات لتجنب التحميل الزائد
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log('🔄 انتهت معالجة جميع الإجازات المنتهية');
        }
        
    } catch (error) {
        console.error('💥 خطأ عام في فحص الإجازات:', error);
    }
}

async function getApprovers(guild, settings, botOwners) {
    const approverIds = new Set();
    if (settings.approverType === 'owners') {
        botOwners.forEach(id => approverIds.add(id));
    } else if (settings.approverType === 'role') {
        for (const roleId of settings.approverTargets) {
            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (role) role.members.forEach(m => approverIds.add(m.id));
        }
    } else if (settings.approverType === 'responsibility') {
        const responsibilities = readJson(responsibilitiesPath);
        for (const respName of settings.approverTargets) {
            const respData = responsibilities[respName];
            if (respData?.responsibles && respData.responsibles.length > 0) {
                respData.responsibles.forEach(id => approverIds.add(id));
            }
        }
    }

    const approvers = [];
    for (const id of approverIds) {
        const user = await guild.client.users.fetch(id).catch(() => null);
        if (user) approvers.push(user);
    }
    return approvers;
}

module.exports = {
    getSettings,
    isUserOnVacation,
    approveVacation,
    endVacation,
    checkVacations,
    getApprovers,
    saveVacations,
    readJson,
    calculateVacationDuration,
    notifyAdminsVacationEnded
};
