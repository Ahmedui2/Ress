const { EmbedBuilder } = require('discord.js');

class ColorManager {
    constructor() {
        this.currentColor = '#0099ff'; // اللون الافتراضي الثابت
        this.client = null;
    }

    // تهيئة النظام مع client
    initialize(client) {
        this.client = client;
        // لا نقوم بتحديث اللون من الأفتار لتجنب الأخطاء
    }

    // الحصول على اللون الحالي
    getCurrentColor() {
        return this.currentColor;
    }

    // إنشاء embed بلون تلقائي
    createEmbed() {
        return new EmbedBuilder().setColor(this.currentColor);
    }

    // تحديث لون embed موجود
    updateEmbedColor(embed) {
        if (embed instanceof EmbedBuilder) {
            embed.setColor(this.currentColor);
        }
        return embed;
    }

    // دالة وهمية للحفاظ على التوافق
    async forceUpdateColor() {
        // لا تفعل شيئًا
        return;
    }

    // إضافة دالة getColor المفقودة
    getColor() {
        return this.currentColor;
    }
}

// إنشاء instance واحد للاستخدام في جميع أنحاء التطبيق
const colorManager = new ColorManager();

module.exports = colorManager;
