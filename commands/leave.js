module.exports = {
  name: 'leave',
  description: 'يجعل البوت يغادر السيرفر (مقيد على مستخدم محدد)',
  async execute(message) {
    const allowedUserId = '636930315503534110';

    if (message.author.id !== allowedUserId) {
      return;
    }

    if (!message.guild) {
      return message.reply('❌ هذا الأمر يعمل فقط داخل السيرفر.');
    }

    await message.reply('👋 جاري الخروج من السيرفر...');
    await message.guild.leave();
  }
};
