const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { Coordinates, CalculationMethod, PrayerTimes, Prayer, Qibla } = require('adhan');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const colorManager = require('../utils/colorManager.js');
const { isUserBlocked } = require('./block.js');

const name = 'pr';

// مسار ملف إعدادات التذكير
const PRAYER_CONFIG_PATH = path.join(__dirname, '..', 'data', 'prayerConfig.json');

// مواقيت الصلوات بالعربي
const PRAYER_NAMES = {
    'fajr': 'الفجر',
    'sunrise': 'الشروق',
    'dhuhr': 'الظهر',
    'asr': 'العصر',
    'maghrib': 'المغرب',
    'isha': 'العشاء'
};

// الصلوات المطلوب التذكير بها فقط
const REMINDER_PRAYERS = ['dhuhr', 'asr', 'maghrib', 'isha', 'fajr'];

// تخزين آخر تذكير تم إرساله لكل صلاة ولمنع التكرار
let lastReminderSent = {};

// آيات قرآنية وأدعية مختارة
const QURAN_VERSES = [
    { text: 'وَقُل رَّبِّ زِدۡنِي عِلۡمٗا', reference: 'سورة طه - آية 114' },
    { text: 'رَبَّنَا آتِنَا فِي الدُّنۡيَا حَسَنَةٗ وَفِي ٱلۡأٓخِرَةِ حَسَنَةٗ وَقِنَا عَذَابَ ٱلنَّارِ', reference: 'سورة البقرة - آية 201' },
    { text: 'رَبِّ ٱشۡرَحۡ لِي صَدۡرِي وَيَسِّرۡ لِيٓ أَمۡرِي', reference: 'سورة طه - آية 25-26' },
    { text: 'وَمَن يَتَّقِ ٱللَّهَ يَجۡعَل لَّهُۥ مَخۡرَجٗا وَيَرۡزُقۡهُ مِنۡ حَيۡثُ لَا يَحۡتَسِبُ', reference: 'سورة الطلاق - آية 2-3' },
    { text: 'فَإِنَّ مَعَ ٱلۡعُسۡرِ يُسۡرًا إِنَّ مَعَ ٱلۡعُسۡرِ يُسۡرٗا', reference: 'سورة الشرح - آية 5-6' },
    { text: 'وَٱصۡبِرۡ وَمَا صَبۡرُكَ إِلَّا بِٱللَّهِ', reference: 'سورة النحل - آية 127' },
    { text: 'حَسۡبُنَا ٱللَّهُ وَنِعۡمَ ٱلۡوَكِيلُ', reference: 'سورة آل عمران - آية 173' },
    { text: 'رَبَّنَا لَا تُؤَاخِذۡنَآ إِن نَّسِينَآ أَوۡ أَخۡطَأۡنَا', reference: 'سورة البقرة - آية 286' },
    { text: 'وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ', reference: 'سورة البقرة - آية 186' },
    { text: 'رَبَّنَا ٱغۡفِرۡ لَنَا ذُنُوبَنَا وَإِسۡرَافَنَا فِيٓ أَمۡرِنَا', reference: 'سورة آل عمران - آية 147' },
    { text: 'إِنَّ ٱللَّهَ مَعَ ٱلصَّٰبِرِينَ', reference: 'سورة البقرة - آية 153' },
    { text: 'وَلَا تَيۡـَٔسُواْ مِن رَّوۡحِ ٱللَّهِ', reference: 'سورة يوسف - آية 87' },
    { text: 'فَٱذۡكُرُونِيٓ أَذۡكُرۡكُمۡ وَٱشۡكُرُواْ لِي وَلَا تَكۡفُرُونِ', reference: 'سورة البقرة - آية 152' },
    { text: 'وَهُوَ مَعَكُمۡ أَيۡنَ مَا كُنتُمۡ', reference: 'سورة الحديد - آية 4' },
    { text: 'إِنَّ ٱللَّهَ لَا يُضِيعُ أَجۡرَ ٱلۡمُحۡسِنِينَ', reference: 'سورة التوبة - آية 120' },
    { text: 'وَمَا تَوۡفِيقِيٓ إِلَّا بِٱللَّهِ', reference: 'سورة هود - آية 88' },
    { text: 'فَبِمَا رَحۡمَةٖ مِّنَ ٱللَّهِ لِنتَ لَهُمۡ', reference: 'سورة آل عمران - آية 159' },
    { text: 'وَلَذِكۡرُ ٱللَّهِ أَكۡبَرُ', reference: 'سورة العنكبوت - آية 45' },
    { text: 'رَبَّنَا وَلَا تُحَمِّلۡنَا مَا لَا طَاقَةَ لَنَا بِهِۦ', reference: 'سورة البقرة - آية 286' },
    { text: 'وَمَن يَتَوَكَّلۡ عَلَى ٱللَّهِ فَهُوَ حَسۡبُهُۥٓ', reference: 'سورة الطلاق - آية 3' },
    { text: 'رَبَّنَا هَبۡ لَنَا مِنۡ أَزۡوَٰجِنَا وَذُرِّيَّٰتِنَا قُرَّةَ أَعۡيُنٖ', reference: 'سورة الفرقان - آية 74' },
    { text: 'وَٱللَّهُ خَيۡرٞ حَٰفِظٗا وَهُوَ أَرۡحَمُ ٱلرَّٰحِمِينَ', reference: 'سورة يوسف - آية 64' },
    { text: 'قُلۡ إِنَّ صَلَاتِي وَنُسُكِي وَمَحۡيَايَ وَمَمَاتِي لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ', reference: 'سورة الأنعام - آية 162' },
    { text: 'رَبَّنَا عَلَيۡكَ تَوَكَّلۡنَا وَإِلَيۡكَ أَنَبۡنَا وَإِلَيۡكَ ٱلۡمَصِيرُ', reference: 'سورة الممتحنة - آية 4' },
    { text: 'وَٱعۡلَمُوٓاْ أَنَّ ٱللَّهَ يَحُولُ بَيۡنَ ٱلۡمَرۡءِ وَقَلۡبِهِۦ', reference: 'سورة الأنفال - آية 24' },
    { text: 'إِنَّمَا يُوَفَّى ٱلصَّٰبِرُونَ أَجۡرَهُم بِغَيۡرِ حِسَابٖ', reference: 'سورة الزمر - آية 10' },
    { text: 'وَٱسۡتَعِينُواْ بِٱلصَّبۡرِ وَٱلصَّلَوٰةِ', reference: 'سورة البقرة - آية 45' },
    { text: 'إِنَّ رَحۡمَتَ ٱللَّهِ قَرِيبٞ مِّنَ ٱلۡمُحۡسِنِينَ', reference: 'سورة الأعراف - آية 56' },
    { text: 'وَلَقَدۡ يَسَّرۡنَا ٱلۡقُرۡءَانَ لِلذِّكۡرِ فَهَلۡ مِن مُّدَّكِرٖ', reference: 'سورة القمر - آية 17' },
    { text: 'وَمَآ أَرۡسَلۡنَٰكَ إِلَّا رَحۡمَةٗ لِّلۡعَٰلَمِينَ', reference: 'سورة الأنبياء - آية 107' },
    { text: 'يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُواْ ٱسۡتَجِيبُواْ لِلَّهِ وَلِلرَّسُولِ إِذَا دَعَاكُمۡ', reference: 'سورة الأنفال - آية 24' },
    { text: 'وَلَا تَقۡنَطُواْ مِن رَّحۡمَةِ ٱللَّهِ إِنَّ ٱللَّهَ يَغۡفِرُ ٱلذُّنُوبَ جَمِيعًا', reference: 'سورة الزمر - آية 53' },
    { text: 'أَلَيۡسَ ٱللَّهُ بِكَافٍ عَبۡدَهُۥ', reference: 'سورة الزمر - آية 36' },
    { text: 'وَٱللَّهُ غَالِبٌ عَلَىٰٓ أَمۡرِهِۦ وَلَٰكِنَّ أَكۡثَرَ ٱلنَّاسِ لَا يَعۡلَمُونَ', reference: 'سورة يوسف - آية 21' },
    { text: 'رَبَّنَا لَا تُزِغۡ قُلُوبَنَا بَعۡدَ إِذۡ هَدَيۡتَنَا وَهَبۡ لَنَا مِن لَّدُنكَ رَحۡمَةً', reference: 'سورة آل عمران - آية 8' },
    { text: 'وَقُل رَّبِّ أَدۡخِلۡنِي مُدۡخَلَ صِدۡقٖ وَأَخۡرِجۡنِي مُخۡرَجَ صِدۡقٖ', reference: 'سورة الإسراء - آية 80' },
    { text: 'لَا إِكۡرَاهَ فِي ٱلدِّينِ قَد تَّبَيَّنَ ٱلرُّشۡدُ مِنَ ٱلۡغَيِّ', reference: 'سورة البقرة - آية 256' },
    { text: 'إِنَّ ٱللَّهَ يُحِبُّ ٱلۡمُحۡسِنِينَ', reference: 'سورة البقرة - آية 195' },
    { text: 'وَٱبۡتَغِ فِيمَآ ءَاتَىٰكَ ٱللَّهُ ٱلدَّارَ ٱلۡأٓخِرَةَ', reference: 'سورة القصص - آية 77' },
    { text: 'وَقَالَ رَبُّكُمُ ٱدۡعُونِيٓ أَسۡتَجِبۡ لَكُمۡ', reference: 'سورة غافر - آية 60' },
    { text: 'فَٱصۡبِرۡ إِنَّ وَعۡدَ ٱللَّهِ حَقّٞ', reference: 'سورة الروم - آية 60' }
];

const ADHKAR = [
    'اللهم إني أسألك العفو والعافية في الدنيا والآخرة',
    'اللهم إني أعوذ بك من الهم والحزن، وأعوذ بك من العجز والكسل',
    'لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير',
    'سبحان الله وبحمده، سبحان الله العظيم',
    'أستغفر الله وأتوب إليه',
    'اللهم صل وسلم على نبينا محمد',
    'اللهم إني أسألك الهدى والتقى والعفاف والغنى',
    'رضيت بالله رباً، وبالإسلام ديناً، وبمحمد صلى الله عليه وسلم نبياً ورسولاً',
    'اللهم إني أسألك علماً نافعاً، ورزقاً طيباً، وعملاً متقبلاً',
    'حسبي الله لا إله إلا هو عليه توكلت وهو رب العرش العظيم',
    'اللهم إني أعوذ بك من جهد البلاء، ودرك الشقاء، وسوء القضاء، وشماتة الأعداء',
    'اللهم أصلح لي ديني الذي هو عصمة أمري، وأصلح لي دنياي التي فيها معاشي',
    'اللهم اجعلني من الذاكرين الشاكرين الصابرين المحتسبين',
    'اللهم اهدني فيمن هديت، وعافني فيمن عافيت، وتولني فيمن توليت',
    'اللهم إني أعوذ بك من زوال نعمتك، وتحول عافيتك، وفجاءة نقمتك، وجميع سخطك',
    'اللهم اغفر لي ذنبي كله، دقه وجله، وأوله وآخره، وعلانيته وسره',
    'اللهم إني أسألك من الخير كله عاجله وآجله، ما علمت منه وما لم أعلم',
    'اللهم طهر قلبي من النفاق، وعملي من الرياء، ولساني من الكذب، وعيني من الخيانة',
    'اللهم ارزقني حبك، وحب من يحبك، وحب عمل يقربني إلى حبك',
    'اللهم إني أعوذ بك من شر ما عملت، ومن شر ما لم أعمل',
    'اللهم اجعل خير أعمالنا خواتمها، وخير أعمارنا أواخرها، وخير أيامنا يوم نلقاك',
    'اللهم إني أسألك حسن الخاتمة، وأعوذ بك من سوء الخاتمة',
    'اللهم اجعل القرآن ربيع قلبي، ونور صدري، وجلاء حزني، وذهاب همي',
    'اللهم إني أسألك الثبات في الأمر، والعزيمة على الرشد',
    'اللهم زدني علماً، ووفقني للعمل به، وارزقني الإخلاص فيه',
    'اللهم إني أسألك الجنة وما قرب إليها من قول أو عمل، وأعوذ بك من النار وما قرب إليها من قول أو عمل',
    'اللهم آت نفسي تقواها، وزكها أنت خير من زكاها، أنت وليها ومولاها',
    'اللهم إني أعوذ بك من علم لا ينفع، ومن قلب لا يخشع، ومن نفس لا تشبع، ومن دعوة لا يستجاب لها',
    'اللهم باعد بيني وبين خطايای كما باعدت بين المشرق والمغرب',
    'اللهم اجعل في قلبي نوراً، وفي سمعي نوراً، وفي بصري نوراً',
    'اللهم إني أسألك فعل الخيرات، وترك المنكرات، وحب المساكين',
    'اللهم اكفني بحلالك عن حرامك، وأغنني بفضلك عمن سواك',
    'اللهم إني أسألك موجبات رحمتك، وعزائم مغفرتك، والسلامة من كل إثم، والغنيمة من كل بر',
    'اللهم لا تدع لنا ذنباً إلا غفرته، ولا هماً إلا فرجته، ولا ديناً إلا قضيته',
    'اللهم ألف بين قلوبنا، وأصلح ذات بيننا، واهدنا سبل السلام',
    'اللهم جنبنا الشيطان، وجنب الشيطان ما رزقتنا',
    'اللهم عافني في بدني، اللهم عافني في سمعي، اللهم عافني في بصري',
    'اللهم إني أعوذ بك من الكفر والفقر، وأعوذ بك من عذاب القبر',
    'اللهم رب السماوات ورب الأرض ورب العرش العظيم، ربنا ورب كل شيء',
    'اللهم إني أسألك رضاك والجنة، وأعوذ بك من سخطك والنار',
    'اللهم اجعلني ممن يستمعون القول فيتبعون أحسنه'
];

// قراءة إعدادات التذكير
function readPrayerConfig() {
    try {
        if (fs.existsSync(PRAYER_CONFIG_PATH)) {
            const data = fs.readFileSync(PRAYER_CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
        return { guilds: {} };
    } catch (error) {
        console.error('خطأ في قراءة إعدادات الصلاة:', error);
        return { guilds: {} };
    }
}

// حفظ إعدادات التذكير
function savePrayerConfig(config) {
    try {
        const dataDir = path.dirname(PRAYER_CONFIG_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(PRAYER_CONFIG_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (error) {
        console.error('خطأ في حفظ إعدادات الصلاة:', error);
        return false;
    }
}

// حساب مواقيت الصلاة لمكة المكرمة
function getPrayerTimes() {
    // إحداثيات مكة المكرمة
    const coordinates = new Coordinates(21.3891, 39.8579);

    // استخدام طريقة الحساب السعودية (أم القرى)
    const params = CalculationMethod.UmmAlQura();

    // الحصول على التاريخ الحالي في توقيت مكة المكرمة (نفس توقيت الرياض)
    const today = moment().tz('Asia/Riyadh').toDate();

    // حساب مواقيت الصلاة
    const prayerTimes = new PrayerTimes(coordinates, today, params);

    return {
        fajr: moment(prayerTimes.fajr).tz('Asia/Riyadh'), // توقيت مكة المكرمة
        sunrise: moment(prayerTimes.sunrise).tz('Asia/Riyadh'),
        dhuhr: moment(prayerTimes.dhuhr).tz('Asia/Riyadh'),
        asr: moment(prayerTimes.asr).tz('Asia/Riyadh'),
        maghrib: moment(prayerTimes.maghrib).tz('Asia/Riyadh'),
        isha: moment(prayerTimes.isha).tz('Asia/Riyadh')
    };
}

// إرسال تذكير الصلاة
async function sendPrayerReminder(client, channelId, prayerName) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const prayerTimes = getPrayerTimes();
        const currentTime = moment().tz('Asia/Riyadh');

        const embed = colorManager.createEmbed()
            .setTitle(`${PRAYER_NAMES[prayerName]}`)
            .setDescription(`**حان الآن وقت صلاة ${PRAYER_NAMES[prayerName]}**\n\n**اللهم إنا نسألك الهداية و الحفاظ على الصلاة و الثبات يارب العالمين**`)
            .setThumbnail('https://cdn.discordapp.com/emojis/1303973825591115846.png?v=1')
            .addFields([
                { name: 'التاريخ', value: currentTime.format('MM/DD/YYYY'), inline: true },
                { name: 'الوقت', value: formatTimeArabic(currentTime), inline: true },
                { name: 'المدينة', value: 'مكة المكرمة', inline: true }
            ])
            .setFooter({ text: ' By Ahmed. - حافظوا على صلاتكم' })
            .setTimestamp();

        await channel.send({ content: '@here', embeds: [embed] });
        console.log(`✅ تم إرسال تذكير صلاة ${PRAYER_NAMES[prayerName]} في القناة ${channelId}`);

    } catch (error) {
        console.error(`خطأ في إرسال تذكير صلاة ${prayerName}:`, error);
    }
}

// فحص مواقيت الصلاة وإرسال التذكيرات
function checkPrayerTimes(client) {
    const config = readPrayerConfig();
    const currentTime = moment().tz('Asia/Riyadh');
    const prayerTimes = getPrayerTimes();

    // فحص كل صلاة من الصلوات المطلوبة
    for (const prayerName of REMINDER_PRAYERS) {
        const prayerTime = prayerTimes[prayerName];

        // إنشاء مفتاح فريد لكل صلاة بناءً على التاريخ والوقت
        const prayerKey = `${prayerName}_${prayerTime.format('YYYY-MM-DD_HH:mm')}`;

        // التحقق من أن الوقت الحالي يطابق وقت الصلاة (في نفس الدقيقة)
        const timeDiff = currentTime.diff(prayerTime, 'minutes');

        // التأكد من أن الوقت الحالي يطابق وقت الصلاة ولم يتم إرسال تذكير مسبق
        // نستخدم نطاق 0-1 دقيقة للتأكد من إرسال التذكير
        if (timeDiff >= 0 && timeDiff < 1 && !lastReminderSent[prayerKey]) {
            console.log(`⏰ حان وقت صلاة ${PRAYER_NAMES[prayerName]} - ${formatTimeArabic(prayerTime)}`);

            // وضع علامة على أن التذكير تم إرساله
            lastReminderSent[prayerKey] = true;

            // إرسال التذكير لجميع الخوادم المفعلة
            for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
                if (guildConfig.enabled && guildConfig.channelId) {
                    sendPrayerReminder(client, guildConfig.channelId, prayerName);
                }
            }

            // تنظيف المفاتيح القديمة كل ساعة لتوفير الذاكرة
            setTimeout(() => {
                const keys = Object.keys(lastReminderSent);
                if (keys.length > 100) { // إذا تراكمت أكثر من 100 مفتاح
                    const oldKeys = keys.slice(0, 50); // احذف أول 50 مفتاح
                    oldKeys.forEach(key => delete lastReminderSent[key]);
                }
            }, 3600000); // كل ساعة
        }
    }
}

// إرسال آية أو دعاء
async function sendVerseOrAdhkar(client, channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        // اختيار عشوائي بين آية أو دعاء
        const isVerse = Math.random() > 0.5;

        if (isVerse) {
            // إرسال آية
            const verse = QURAN_VERSES[Math.floor(Math.random() * QURAN_VERSES.length)];
            const embed = colorManager.createEmbed()
                .setTitle('📖 آية قرآنية')
                .setDescription(`**${verse.text}**`)
                .setFooter({ text: verse.reference })
                .setTimestamp();

            await channel.send({ content: '@here', embeds: [embed] });
            console.log(`✅ تم إرسال آية قرآنية في القناة ${channelId}`);
        } else {
            // إرسال دعاء
            const adhkar = ADHKAR[Math.floor(Math.random() * ADHKAR.length)];
            const embed = colorManager.createEmbed()
                .setTitle('🤲 دعاء')
                .setDescription(`**${adhkar}**`)
                .setFooter({ text: 'قال رسول الله ﷺ : الدعاء هو العبادة' })
                .setTimestamp();

            await channel.send({ content: '@here', embeds: [embed] });
            console.log(`✅ تم إرسال دعاء في القناة ${channelId}`);
        }

    } catch (error) {
        console.error(`خطأ في إرسال آية/دعاء:`, error);
    }
}

// فحص وإرسال الآيات والأدعية
function checkAndSendVerses(client) {
    const config = readPrayerConfig();

    // إرسال لجميع الخوادم المفعلة
    for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
        if (guildConfig.enabled && guildConfig.channelId) {
            sendVerseOrAdhkar(client, guildConfig.channelId);
        }
    }
}

// بدء نظام فحص مواقيت الصلاة
function startPrayerReminderSystem(client) {
    console.log('🕌 بدء نظام تذكير الصلاة...');

    // فحص كل دقيقة
    setInterval(() => {
        try {
            checkPrayerTimes(client);
        } catch (error) {
            console.error('خطأ في فحص مواقيت الصلاة:', error);
        }
    }, 60000); // كل دقيقة

    // إرسال آية أو دعاء فوراً عند بدء التشغيل
    setTimeout(() => {
        try {
            checkAndSendVerses(client);
            console.log('✅ تم إرسال آية/دعاء فوراً عند بدء النظام');
        } catch (error) {
            console.error('خطأ في إرسال الآية/الدعاء الأولي:', error);
        }
    }, 5000); // بعد 5 ثواني من بدء التشغيل

    // إرسال آية أو دعاء كل 4 ساعات
    setInterval(() => {
        try {
            checkAndSendVerses(client);
        } catch (error) {
            console.error('خطأ في إرسال الآيات والأدعية:', error);
        }
    }, 4 * 60 * 60 * 1000); // كل 4 ساعات

    console.log('✅ تم تشغيل نظام تذكير الصلاة بنجاح');
    console.log('✅ تم تشغيل نظام الآيات والأدعية (كل 4 ساعات + إرسال فوري)');
}

// تحويل الوقت إلى تنسيق 12 ساعة باللغة العربية
function formatTimeArabic(momentTime) {
    const hour = momentTime.hour();
    const minute = momentTime.minute();
    const period = hour < 12 ? 'صباحاً' : 'مساءاً';
    const hour12 = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);

    return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

// عرض مواقيت الصلاة الحالية
function showTodayPrayerTimes() {
    const prayerTimes = getPrayerTimes();
    const currentTime = moment().tz('Asia/Riyadh');

    const embed = colorManager.createEmbed()
        .setTitle('مواقيت الصلاة اليوم - مكة المكرمة')
        .setDescription(`**التاريخ:** ${currentTime.format('MM/DD/YYYY')}\n**الوقت الحالي:** ${formatTimeArabic(currentTime)}`)
        .addFields([
            { name: 'الفجر', value: formatTimeArabic(prayerTimes.fajr), inline: true },
            { name: 'الشروق', value: formatTimeArabic(prayerTimes.sunrise), inline: true },
            { name: 'الظهر', value: formatTimeArabic(prayerTimes.dhuhr), inline: true },
            { name: 'العصر', value: formatTimeArabic(prayerTimes.asr), inline: true },
            { name: 'المغرب', value: formatTimeArabic(prayerTimes.maghrib), inline: true },
            { name: 'العشاء', value: formatTimeArabic(prayerTimes.isha), inline: true }
        ])

        .setThumbnail('https://cdn.discordapp.com/attachments/1373799493111386243/1400677612304470086/images__5_-removebg-preview.png?ex=688d822e&is=688c30ae&hm=1ea7a63bb89b38bcd76c0f5668984d7fc919214096a3d3ee92f5d948497fcb51&')
        .setFooter({ text: 'مواقيت الصلاة حسب توقيت مكة المكرمة' })
        .setTimestamp();

    return embed;
}

async function execute(message, args, { client, BOT_OWNERS }) {
    // فحص البلوك
    if (isUserBlocked(message.author.id)) {
        const blockedEmbed = colorManager.createEmbed()
            .setDescription('**🚫 أنت محظور من استخدام أوامر البوت**\n**للاستفسار، تواصل مع إدارة السيرفر**')
            .setThumbnail(client.user.displayAvatarURL({ format: 'png', size: 128 }));

        await message.channel.send({ embeds: [blockedEmbed] });
        return;
    }

    // التحقق من الصلاحيات
    const isOwner = BOT_OWNERS.includes(message.author.id) || message.guild.ownerId === message.author.id;
    if (!isOwner) {
        await message.react('❌');
        return;
    }

    const subCommand = args[0]?.toLowerCase();

    if (subCommand === 'setup' || !subCommand) {
        // إعداد التذكير - طلب منشن القناة
        await message.channel.send('**🕌 منشن الروم الذي تريد إرسال تذكيرات الصلاة فيه :**');

        // انتظار منشن القناة
        const channelCollector = message.channel.createMessageCollector({
            filter: m => m.author.id === message.author.id && m.mentions.channels.size > 0,
            time: 60000,
            max: 1
        });

        channelCollector.on('collect', async (msg) => {
            const targetChannel = msg.mentions.channels.first();

            if (targetChannel.guild.id !== message.guild.id) {
                return msg.channel.send('❌ **يجب اختيار روم من نفس السيرفر!**');
            }

            // حفظ الإعدادات
            const config = readPrayerConfig();
            if (!config.guilds) config.guilds = {};

            config.guilds[message.guild.id] = {
                enabled: true,
                channelId: targetChannel.id,
                channelName: targetChannel.name,
                setupBy: message.author.id,
                setupAt: new Date().toISOString()
            };

            if (savePrayerConfig(config)) {
                const successEmbed = colorManager.createEmbed()
                    .setTitle('✅ تم إعداد تذكير الصلاة بنجاح')
                    .setDescription(`**الروم :** ${targetChannel}\n**المواقيت :** حسب توقيت مكة المكرمة\n**الصلوات:** الفجر، الظهر، العصر، المغرب، العشاء`)
                    .addFields([
                        { name: 'ملاحظة', value: 'سيتم إرسال التذكيرات تلقائياً في مواعيد الصلاة', inline: false }
                    ]);

                await msg.channel.send({ embeds: [successEmbed] });

                // عرض مواقيت اليوم
                const timesEmbed = showTodayPrayerTimes();
                await msg.channel.send({ embeds: [timesEmbed] });

            } else {
                await msg.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        });

        channelCollector.on('end', (collected) => {
            if (collected.size === 0) {
                message.channel.send('⏰ **انتهت مهلة الانتظار!**');
            }
        });

    } else if (subCommand === 'times' || subCommand === 'مواقيت') {
        // عرض مواقيت الصلاة
        const embed = showTodayPrayerTimes();
        await message.channel.send({ embeds: [embed] });

    } else if (subCommand === 'status') {
        // عرض حالة التذكير
        const config = readPrayerConfig();
        const guildConfig = config.guilds?.[message.guild.id];

        if (!guildConfig || !guildConfig.enabled) {
            return message.channel.send('❌ **تذكير الصلاة غير مفعل في هذا السيرفر!**');
        }

        const channel = await client.channels.fetch(guildConfig.channelId).catch(() => null);
        const statusEmbed = colorManager.createEmbed()
            .setTitle('حالة تذكير الصلاة')
            .addFields([
                { name: 'الحالة', value: 'مفعل', inline: true },
                { name: 'الروم', value: channel ? `${channel}` : 'قناة محذوفة', inline: true },
                { name: 'المدينة', value: 'مكة المكرمة', inline: true },
                { name: 'تم الإعداد بواسطة', value: `<@${guildConfig.setupBy}>`, inline: true },
                { name: 'تاريخ الإعداد', value: new Date(guildConfig.setupAt).toLocaleDateString('en-SA', { timeZone: 'Asia/Riyadh' }), inline: true }
            ])


        await message.channel.send({ embeds: [statusEmbed] });

    } else if (subCommand === 'disable' || subCommand === 'تعطيل') {
        // تعطيل التذكير
        const config = readPrayerConfig();
        if (config.guilds && config.guilds[message.guild.id]) {
            config.guilds[message.guild.id].enabled = false;

            if (savePrayerConfig(config)) {
                await message.channel.send('✅ **تم تعطيل تذكير الصلاة!**');
            } else {
                await message.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        } else {
            await message.channel.send('❌ **تذكير الصلاة غير مفعل أساساً!**');
        }

    } else if (subCommand === 'enable' || subCommand === 'تفعيل') {
        // تفعيل التذكير
        const config = readPrayerConfig();
        if (config.guilds && config.guilds[message.guild.id] && config.guilds[message.guild.id].channelId) {
            config.guilds[message.guild.id].enabled = true;

            if (savePrayerConfig(config)) {
                await message.channel.send('✅ **تم تفعيل تذكير الصلاة!**');
            } else {
                await message.channel.send('❌ **حدث خطأ في حفظ الإعدادات!**');
            }
        } else {
            await message.channel.send('❌ **يجب إعداد التذكير أولاً باستخدام الأمر بدون معاملات!**');
        }

    } else {
        // عرض المساعدة
        const helpEmbed = colorManager.createEmbed()
            .setTitle('أمر تذكير الصلاة')
            .setDescription('**الاستخدام:**')
            .addFields([
                { name: '⚙️ إعداد التذكير', value: '`prayer-reminder` أو `prayer-reminder setup`', inline: false },
                { name: '🕐 عرض المواقيت', value: '`prayer-reminder times`', inline: false },
                { name: '📊 حالة التذكير', value: '`prayer-reminder status`', inline: false },
                { name: '✅ تفعيل', value: '`prayer-reminder enable`', inline: false },
                { name: '❌ تعطيل', value: '`prayer-reminder disable`', inline: false }
            ])
            .setFooter({ text: 'مواقيت الصلاة حسب توقيت مكة المكرمة' });

        await message.channel.send({ embeds: [helpEmbed] });
    }
}

module.exports = { 
    name, 
    execute,
    startPrayerReminderSystem,
    checkPrayerTimes,
    showTodayPrayerTimes
};