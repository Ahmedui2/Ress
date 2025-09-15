const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const colorManager = require('./colorManager');

const vacationsPath = path.join(__dirname, '..', 'data', 'vacations.json');
const adminRolesPath = path.join(__dirname, '..', 'data', 'adminRoles.json');
const responsibilitiesPath = path.join(__dirname, '..', 'data', 'responsibilities.json');

// نظام حماية الرولات مشابه لنظام الداون
class VacationRoleProtection {
    constructor() {
        // قائمة تتبع الاستعادات التي يقوم بها البوت (لمنع التداخل مع نظام الحماية)
        this.botRestorationTracking = new Set();
        // قائمة مؤقتة لتجاهل الاستعادة التلقائية عند الإنهاء اليدوي
        this.autoRestoreIgnoreList = new Map();
    }

    // إضافة مفتاح لقائمة التجاهل المؤقت
    addToAutoRestoreIgnore(userId, roleId) {
        const key = `${userId}_${roleId}`;
        this.autoRestoreIgnoreList.set(key, Date.now());

        // إزالة من القائمة بعد 60 ثانية
        setTimeout(() => {
            this.autoRestoreIgnoreList.delete(key);
        }, 60000);

        console.log(`🛡️ تم إضافة ${key} لقائمة تجاهل استعادة الرولات المؤقت`);
    }

    // التحقق من وجود رول في قائمة التجاهل
    isInAutoRestoreIgnore(userId, roleId) {
        const key = `${userId}_${roleId}`;
        const timestamp = this.autoRestoreIgnoreList.get(key);

        if (!timestamp) return false;

        // إذا مر أكثر من 60 ثانية، احذف وارجع false
        if (Date.now() - timestamp > 60000) {
            this.autoRestoreIgnoreList.delete(key);
            return false;
        }

        return true;
    }

    // تسجيل عملية استعادة بواسطة البوت
    trackBotRestoration(guildId, userId, roleId) {
        const restorationKey = `${guildId}_${userId}_${roleId}`;
        this.botRestorationTracking.add(restorationKey);

        // إزالة المفتاح بعد 10 ثوانٍ
        setTimeout(() => {
            this.botRestorationTracking.delete(restorationKey);
        }, 10000);

        console.log(`🔧 تم تسجيل استعادة رول بواسطة البوت: ${restorationKey}`);
    }

    // التحقق من أن الاستعادة تتم بواسطة البوت
    isBotRestoration(guildId, userId, roleId) {
        const restorationKey = `${guildId}_${userId}_${roleId}`;
        return this.botRestorationTracking.has(restorationKey);
    }
}

const roleProtection = new VacationRoleProtection();

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
    let actuallyRemovedRoleIds = [];

    try {
        if (rolesToRemove.size > 0) {
            console.log(`🔧 محاولة سحب ${rolesToRemove.size} دور إداري من المستخدم ${member.user.tag}`);
            console.log(`📋 الأدوار المراد سحبها: ${rolesToRemove.map(r => r.name).join(', ')}`);
            
            await member.roles.remove(rolesToRemove, 'سحب الأدوار الإدارية بسبب الإجازة');
            
            // تسجيل الأدوار التي تم سحبها فعلياً بعد العملية
            actuallyRemovedRoleIds = rolesToRemove.map(role => role.id);
            
            // التحقق المضاعف من أن الأدوار تم سحبها فعلياً
            const memberAfterRemoval = await guild.members.fetch(userId);
            const stillHasRoles = actuallyRemovedRoleIds.filter(roleId => memberAfterRemoval.roles.cache.has(roleId));
            
            if (stillHasRoles.length > 0) {
                console.warn(`⚠️ بعض الأدوار لم يتم سحبها: ${stillHasRoles.join(', ')}`);
                // إزالة الأدوار التي لم يتم سحبها من القائمة
                actuallyRemovedRoleIds = actuallyRemovedRoleIds.filter(roleId => !stillHasRoles.includes(roleId));
            }
            
            console.log(`✅ تأكيد نهائي: تم سحب ${actuallyRemovedRoleIds.length} دور بنجاح`);
            
            console.log(`✅ تم سحب ${actuallyRemovedRoleIds.length} دور بنجاح`);
            console.log(`📋 معرفات الأدوار المسحوبة: ${actuallyRemovedRoleIds.join(', ')}`);
        } else {
            console.log(`⚠️ لا توجد أدوار إدارية لسحبها من المستخدم ${member.user.tag}`);
        }
    } catch (error) {
        console.error(`Failed to remove roles from ${member.user.tag}:`, error);
        return { success: false, message: 'Failed to remove user roles. Check bot permissions.' };
    }

    const activeVacation = { ...request, status: 'active', approvedBy: approverId, approvedAt: new Date().toISOString(), removedRoles: actuallyRemovedRoleIds };
    
    if (!vacations.active) {
        vacations.active = {};
    }
    
    vacations.active[userId] = activeVacation;
    delete vacations.pending[userId];
    
    console.log(`💾 حفظ بيانات الإجازة للمستخدم ${userId}:`);
    console.log(`📋 الأدوار المحفوظة: ${actuallyRemovedRoleIds.length > 0 ? actuallyRemovedRoleIds.join(', ') : 'لا توجد'}`);
    console.log(`📅 تاريخ البدء: ${activeVacation.startDate}`);
    console.log(`📅 تاريخ الانتهاء: ${activeVacation.endDate}`);
    
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
        
        // محاولة جلب العضو بطرق متعددة
        let member = null;
        try {
            // المحاولة الأولى: جلب مباشر من الكاش
            member = guild.members.cache.get(userId);
            
            if (!member) {
                console.log(`🔍 العضو غير موجود في الكاش، محاولة جلب من API...`);
                // المحاولة الثانية: جلب من Discord API
                member = await guild.members.fetch(userId);
                console.log(`✅ تم العثور على العضو ${member.user.tag} من API`);
            } else {
                console.log(`✅ تم العثور على العضو ${member.user.tag} من الكاش`);
            }
        } catch (fetchError) {
            console.warn(`⚠️ لا يمكن العثور على العضو ${userId} في الخادم:`, fetchError.message);
            
            // محاولة أخيرة: جلب جميع الأعضاء وإعادة المحاولة
            try {
                console.log(`🔄 محاولة جلب جميع الأعضاء وإعادة البحث...`);
                await guild.members.fetch();
                member = guild.members.cache.get(userId);
                if (member) {
                    console.log(`✅ تم العثور على العضو ${member.user.tag} بعد جلب جميع الأعضاء`);
                }
            } catch (finalError) {
                console.error(`❌ فشل نهائي في العثور على العضو ${userId}:`, finalError.message);
            }
        }
        
        let rolesRestored = [];

        // فحص وجود البيانات المحفوظة للإجازة
        console.log(`📊 بيانات الإجازة للمستخدم ${userId}:`);
        console.log(`📋 إجمالي البيانات: ${JSON.stringify(vacation, null, 2)}`);
        console.log(`📋 الأدوار المحفوظة: ${vacation.removedRoles ? vacation.removedRoles.join(', ') : 'لا توجد'}`);
        console.log(`📋 عدد الأدوار المحفوظة: ${vacation.removedRoles ? vacation.removedRoles.length : 0}`);
        if (vacation.removedRoles && vacation.removedRoles.length > 0) {
            console.log(`📋 جاري محاولة استعادة ${vacation.removedRoles.length} دور للمستخدم ${userId}`);
            console.log(`📋 قائمة الأدوار المحفوظة للاستعادة: ${vacation.removedRoles.join(', ')}`);
            
            if (!member) {
                console.warn(`⚠️ العضو ${userId} غير موجود في الخادم، سيتم تسجيل الأدوار المفترض استعادتها فقط`);
                rolesRestored = [...vacation.removedRoles]; // تسجيل الأدوار للعرض
            } else {
                console.log(`👤 العضو موجود: ${member.user.tag}, بدء عملية الاستعادة الفعلية...`);
            }
            
            try {
                // التحقق من وجود الأدوار قبل إضافتها
                const validRoles = [];
                const invalidRoles = [];
                const alreadyHasRoles = [];
                
                for (const roleId of vacation.removedRoles) {
                    try {
                        // محاولة الحصول على الرول من الكاش أولاً
                        let role = guild.roles.cache.get(roleId);
                        
                        // إذا لم يكن في الكاش، حاول جلبه من الـ API
                        if (!role) {
                            try {
                                role = await guild.roles.fetch(roleId);
                            } catch (fetchError) {
                                console.warn(`⚠️ لا يمكن جلب الدور ${roleId} من API: ${fetchError.message}`);
                            }
                        }
                        
                        if (role) {
                            console.log(`✅ تم العثور على الدور: ${role.name} (${roleId})`);
                            
                            if (member) {
                                // العضو موجود - فحص ما إذا كان يملك الدور
                                if (!member.roles.cache.has(roleId)) {
                                    // تطبيق نظام الحماية: إضافة الرول لقائمة التجاهل
                                    roleProtection.addToAutoRestoreIgnore(member.id, roleId);
                                    
                                    // تسجيل أن البوت سيقوم بإعادة الرول
                                    roleProtection.trackBotRestoration(guild.id, member.id, roleId);
                                    
                                    validRoles.push(roleId);
                                    console.log(`✅ الدور ${role.name} (${roleId}) جاهز للاستعادة`);
                                } else {
                                    console.log(`🔄 المستخدم ${member.user.tag} يمتلك الدور ${role.name} بالفعل`);
                                    alreadyHasRoles.push(roleId);
                                    rolesRestored.push(roleId); // اعتبره مستعاداً
                                }
                            } else {
                                // العضو غير موجود - تسجيل الدور كمفترض للاستعادة
                                validRoles.push(roleId);
                                console.log(`📝 الدور ${role.name} (${roleId}) سيتم تسجيله كمستعاد (العضو غير موجود)`);
                            }
                        } else {
                            console.warn(`⚠️ الدور ${roleId} غير موجود في الخادم أو تم حذفه`);
                            invalidRoles.push(roleId);
                        }
                    } catch (roleError) {
                        console.warn(`⚠️ خطأ في معالجة الدور ${roleId}: ${roleError.message}`);
                        invalidRoles.push(roleId);
                    }
                }
                
                if (member && validRoles.length > 0) {
                    console.log(`🔄 جاري استعادة ${validRoles.length} دور للعضو الموجود...`);
                    await member.roles.add(validRoles, 'إعادة الأدوار بعد انتهاء الإجازة');
                    rolesRestored.push(...validRoles);
                    console.log(`✅ تم استعادة ${validRoles.length} دور بنجاح للمستخدم ${member.user.tag}`);
                } else if (!member && validRoles.length > 0) {
                    console.log(`📝 تم تسجيل ${validRoles.length} دور كمستعاد (العضو غير موجود في الخادم)`);
                    rolesRestored.push(...validRoles);
                } else if (!member) {
                    // إذا العضو غير موجود، أضف جميع الأدوار المحفوظة للعرض
                    rolesRestored.push(...vacation.removedRoles);
                    console.log(`📝 تم تسجيل جميع الأدوار المحفوظة كمستعادة (العضو غير موجود)`);
                } else {
                    console.log(`ℹ️ لا توجد أدوار صالحة للاستعادة`);
                }
                
                if (alreadyHasRoles.length > 0) {
                    console.log(`ℹ️ المستخدم يمتلك ${alreadyHasRoles.length} دور مسبقاً`);
                }
                
                if (invalidRoles.length > 0) {
                    console.warn(`⚠️ تم تجاهل ${invalidRoles.length} دور غير صالح: ${invalidRoles.join(', ')}`);
                }
                
                console.log(`📊 ملخص الاستعادة: ${rolesRestored.length} دور تم تسجيله كمستعاد من أصل ${vacation.removedRoles.length} دور محفوظ`);
                
            } catch (roleError) {
                console.error(`❌ فشل في إعادة إضافة الأدوار للمستخدم ${member?.user?.tag || userId}:`, roleError);
                // لا نتوقف هنا، نكمل عملية إنهاء الإجازة
            }
        } else {
            console.log(`📋 لا توجد أدوار محفوظة للاستعادة للمستخدم ${userId}`);
            console.log(`📊 حالة البيانات: removedRoles = ${vacation.removedRoles}, طول المصفوفة = ${vacation.removedRoles ? vacation.removedRoles.length : 'undefined'}`);
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
            
            // إعداد نص الأدوار المستعادة مع معالجة أفضل للأدوار المحذوفة
            let rolesText = 'لا توجد أدوار محفوظة';
            
            if (rolesRestored.length > 0) {
                // إزالة التكرارات من قائمة الأدوار المستعادة
                const uniqueRolesRestored = [...new Set(rolesRestored)];
                const roleTexts = [];
                
                for (const roleId of uniqueRolesRestored) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        roleTexts.push(`**${role.name}**`);
                    } else {
                        // عرض أفضل للأدوار المحذوفة
                        roleTexts.push(`🚫 رول محذوف (ID: ${roleId})`);
                    }
                }
                rolesText = roleTexts.join(', ');
            } else if (vacation.removedRoles && vacation.removedRoles.length > 0) {
                rolesText = `تم حفظ ${vacation.removedRoles.length} دور للاستعادة`;
                
                // إضافة تفاصيل الأدوار المحفوظة
                const roleDetails = [];
                for (const roleId of vacation.removedRoles) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        roleDetails.push(`**${role.name}**`);
                    } else {
                        roleDetails.push(`🚫 رول محذوف (ID: ${roleId})`);
                    }
                }
                rolesText = roleDetails.join(', ') || rolesText;
            }

            const embed = new EmbedBuilder()
                .setTitle('انتهت الإجازة')
                .setColor(colorManager.getColor('ended') || '#FFA500')
                .setDescription(`**انتهت إجازتك. مرحباً بعودتك!**`)
                .addFields(
                    { name: '___سبب الإنهاء___', value: reason },
                    { name: '___الأدوار المستعادة___', value: rolesText },
                    { name: '___تفاصيل الاستعادة___', value: `المحفوظة: ${vacation.removedRoles ? vacation.removedRoles.length : 0} | المستعادة: ${rolesRestored.length}` }
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

async function isUserAuthorizedApprover(userId, guild, settings, botOwners) {
    try {
        // التحقق من أن إعدادات الإجازات محددة
        if (!settings || !settings.approverType) {
            console.log(`⚠️ إعدادات الإجازات غير مكتملة للتحقق من صلاحية المستخدم ${userId}`);
            return false;
        }

        // التحقق من نوع المعتمد
        if (settings.approverType === 'owners') {
            const isOwner = botOwners.includes(userId);
            console.log(`🔍 فحص صلاحية المالك للمستخدم ${userId}: ${isOwner ? 'مُعتمد' : 'غير مُعتمد'}`);
            return isOwner;
        } 
        else if (settings.approverType === 'role') {
            if (!settings.approverTargets || settings.approverTargets.length === 0) {
                console.log('⚠️ لم يتم تحديد أدوار المعتمدين');
                return false;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                console.log(`⚠️ لا يمكن العثور على العضو ${userId} في الخادم`);
                return false;
            }

            const hasRequiredRole = settings.approverTargets.some(roleId => member.roles.cache.has(roleId));
            console.log(`🔍 فحص صلاحية الدور للمستخدم ${userId}: ${hasRequiredRole ? 'مُعتمد' : 'غير مُعتمد'}`);
            return hasRequiredRole;
        }
        else if (settings.approverType === 'responsibility') {
            if (!settings.approverTargets || settings.approverTargets.length === 0) {
                console.log('⚠️ لم يتم تحديد مسؤوليات المعتمدين');
                return false;
            }

            const responsibilities = readJson(responsibilitiesPath);
            for (const respName of settings.approverTargets) {
                const respData = responsibilities[respName];
                if (respData?.responsibles && respData.responsibles.includes(userId)) {
                    console.log(`🔍 فحص صلاحية المسؤولية للمستخدم ${userId}: مُعتمد (المسؤولية: ${respName})`);
                    return true;
                }
            }
            console.log(`🔍 فحص صلاحية المسؤولية للمستخدم ${userId}: غير مُعتمد`);
            return false;
        }

        console.log(`⚠️ نوع معتمد غير مدعوم: ${settings.approverType}`);
        return false;

    } catch (error) {
        console.error(`❌ خطأ في فحص صلاحية المستخدم ${userId}:`, error);
        return false;
    }
}

module.exports = {
    getSettings,
    isUserOnVacation,
    approveVacation,
    endVacation,
    checkVacations,
    getApprovers,
    isUserAuthorizedApprover,
    saveVacations,
    readJson,
    calculateVacationDuration,
    notifyAdminsVacationEnded,
    roleProtection
};
