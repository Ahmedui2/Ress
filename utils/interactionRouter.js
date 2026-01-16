/**
 * نظام توجيه التفاعلات المركزي (Interaction Router)
 * يهدف هذا الملف ليكون النقطة الوحيدة لاستقبال التفاعلات وتوزيعها على الأنظمة
 */

class InteractionRouter {
    constructor() {
        this.handlers = new Map();
    }

    /**
     * تسجيل معالج لنظام معين
     * @param {string} prefix البادئة (مثل 'vac_', 'report_')
     * @param {Function} handlerFunction الدالة المعالجة
     */
    register(prefix, handlerFunction) {
        this.handlers.set(prefix, handlerFunction);
        console.log(`[InteractionRouter] تم تسجيل نظام: ${prefix}`);
    }

    /**
     * توجيه التفاعل للمعالج المناسب
     */
    async route(interaction, client) {
        if (!interaction.customId) return;

        for (const [prefix, handler] of this.handlers) {
            if (interaction.customId.startsWith(prefix)) {
                try {
                    return await handler(interaction, client);
                } catch (error) {
                    console.error(`[InteractionRouter] خطأ في ${prefix}:`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة التفاعل.', ephemeral: true }).catch(() => {});
                    }
                    return;
                }
            }
        }
    }
}

module.exports = new InteractionRouter();
