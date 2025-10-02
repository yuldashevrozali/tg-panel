// bot.js
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN || "8353914054:AAHZTX0AtM2X2FE12Of5R5Y3XgdS-W6Yr2I";
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "7341387002");
const PAYMENT_CARD = process.env.PAYMENT_CARD || "9860 1601 2612 3175";
const API_KEY = process.env.API_KEY || "SXsxOaOyOf8vftA36NvT5M6KBNqJNIQw"; // 🔑 API key (seensms.uz uchun)

if (!BOT_TOKEN || !ADMIN_ID) {
  console.error("Iltimos BOT_TOKEN va ADMIN_ID o'rnatilganiga ishonch hosil qiling.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const session = {};

const DBPATH = path.join(__dirname, "db.json");
function loadDB() {
  if (!fs.existsSync(DBPATH)) {
    fs.writeFileSync(DBPATH, JSON.stringify({ users: {}, pending: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DBPATH));
}
function saveDB(db) {
  fs.writeFileSync(DBPATH, JSON.stringify(db, null, 2));
}
function ensureUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = { balance: 0, phone: null };
  }
}

// API dan xizmatlarni olish
async function getServices() {
  try {
    const resp = await axios.post("https://seensms.uz/api/v1", {
      key: API_KEY,
      action: "services"
    });
    return resp.data || [];
  } catch (err) {
    console.error("Xizmatlarni olishda xatolik:", err);
    return [];
  }
}

// Majburiy kanallar
const REQUIRED_CHANNELS = ["@yuldashev_smm_news", "@frontend_uzbekcha"];

// A'zolikni tekshirish
async function checkMembership(ctx, channels) {
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      if (member.status === 'left' || member.status === 'kicked') {
        return false;
      }
    } catch (err) {
      console.error("A'zolik tekshirishda xatolik:", err);
      return false;
    }
  }
  return true;
}

// Kanalga azo bo'lishni so'rash
function showJoinChannels(ctx) {
  const keyboard = {
    inline_keyboard: [
      [{ text: "📢 SMM News kanaliga azo bo'lish", url: "https://t.me/yuldashev_smm_news" }],
      [{ text: "💻 Frontend kanaliga azo bo'lish", url: "https://t.me/frontend_uzbekcha" }],
      [{ text: "✅ Men azo bo'ldim", callback_data: "check_membership" }]
    ]
  };

  ctx.reply(
    "Iltimos quyidagi kanallarimizga azo bo'lsangizgina botni ishlatishingiz mumkin:\n\n📢 @yuldashev_smm_news\n💻 @frontend_uzbekcha\n\nAzo bo'lgach, '✅ Men azo bo'ldim' tugmasini bosing.",
    { reply_markup: keyboard }
  );
}

// Asosiy menyu
function mainMenu() {
  return Markup.keyboard([
    ["📊 Hisobim", "💳 Pul kiritish"],
    ["🛠 Xizmatlar", "👨‍💻 Admin bilan bog‘lanish"],
  ]).resize();
}

// /start
bot.start(async (ctx) => {
  const db = loadDB();
  ensureUser(db, ctx.from.id);
  saveDB(db);

  if (!db.users[ctx.from.id].phone) {
    return ctx.reply(
      "Assalomu alaykum! Botdan foydalanish uchun telefon raqamingizni yuboring 👇",
      Markup.keyboard([Markup.button.contactRequest("📱 Telefon raqamimni ulashish")]).resize()
    );
  } else {
    const isMember = await checkMembership(ctx, REQUIRED_CHANNELS);
    if (!isMember) {
      return showJoinChannels(ctx);
    } else {
      return ctx.reply("Asosiy menyu:", mainMenu());
    }
  }
});

// Telefon raqam
bot.on("contact", async (ctx) => {
  const db = loadDB();
  ensureUser(db, ctx.from.id);
  db.users[ctx.from.id].phone = ctx.message.contact.phone_number;
  saveDB(db);

  const isMember = await checkMembership(ctx, REQUIRED_CHANNELS);
  if (!isMember) {
    return showJoinChannels(ctx);
  } else {
    return ctx.reply("Rahmat! Siz ro‘yxatdan o‘tdingiz ✅", mainMenu());
  }
});

// Hisobim
bot.hears("📊 Hisobim", (ctx) => {
  const db = loadDB();
  ensureUser(db, ctx.from.id);
  ctx.reply(`💰 Sizning balansingiz: ${db.users[ctx.from.id].balance} UZS`);
});

// 💳 Pul kiritish
bot.hears("💳 Pul kiritish", (ctx) => {
  session[ctx.from.id] = { state: "await_amount" };
  ctx.reply("💰 Nech pulga to‘ldirmoqchisiz? (masalan: 10000 yoki 25000)");
});

// Admin to‘lov tasdiqlash
bot.on("callback_query", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  const [action, pendingId] = data.split(":");

  if (action === "approve" || action === "reject") {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery("Faqat admin uchun.");

    const db = loadDB();
    const pending = db.pending[pendingId];
    if (!pending) return ctx.answerCbQuery("So‘rov topilmadi.");

    if (action === "approve") {
      ensureUser(db, pending.userId);
      db.users[pending.userId].balance += pending.amount;
      pending.status = "approved";
      saveDB(db);
      ctx.editMessageCaption(`✅ Tasdiqlandi!\n💵 ${pending.amount} UZS\n👤 ${pending.userId}`);
      await ctx.telegram.sendMessage(pending.userId, `🎉 To‘lovingiz tasdiqlandi!\nYangi balans: ${db.users[pending.userId].balance} UZS`);
    }

    if (action === "reject") {
      pending.status = "rejected";
      saveDB(db);
      ctx.editMessageCaption(`❌ Rad etildi!\n💵 ${pending.amount} UZS`);
      await ctx.telegram.sendMessage(pending.userId, "❌ To‘lovingiz rad etildi. Qaytadan urinib ko‘ring.");
    }
  } else {
    // Boshqa callback'lar uchun keyingi handler'ga o'tkazish
    return next();
  }
});

// Xizmatlar
bot.hears("🛠 Xizmatlar", async (ctx) => {
  const platforms = ["Telegram", "Instagram", "TikTok", "YouTube", "Twitter"];
  const keyboard = {
    inline_keyboard: platforms.map(p => [{
      text: `📱 ${p}`,
      callback_data: `platform:${p}`
    }])
  };

  ctx.reply("Xizmat turini tanlang:", { reply_markup: keyboard });
});

// Sub-kategoriyalar
const subCategories = [
  { name: "Obunachilar", keywords: ["follower", "subscriber", "obunachi"], hasTypes: true },
  { name: "Ko'rishlar", keywords: ["view", "prosmotr", "korish"], hasTypes: false },
  { name: "Layklar", keywords: ["like", "layk"], hasTypes: false },
  { name: "Izohlar", keywords: ["comment", "izoh"], hasTypes: false },
  { name: "Reaksiyalar", keywords: ["reaction", "reaksiya"], hasTypes: false },
  { name: "Boshqalar", keywords: [], hasTypes: false }
];

// Obunachi turlari
const followerTypes = ["Oddiy", "Premium", "Arzon", "Real", "Boshqalar"];

// Platform tanlash
bot.action(/^platform:(.+)$/, async (ctx) => {
  const platform = ctx.match[1];
  const keyboard = {
    inline_keyboard: [
      ...subCategories.map(sc => [{
        text: `📂 ${sc.name}`,
        callback_data: `subcategory:${platform}:${sc.name}`
      }]),
      [{ text: "🔙 Orqaga", callback_data: "back_to_platforms" }]
    ]
  };

  ctx.editMessageText(`${platform} uchun kategoriyani tanlang:`, { reply_markup: keyboard });
});

// Sub-kategoriya tanlash
bot.action(/^subcategory:(.+):(.+)$/, async (ctx) => {
  const [platform, subCatName] = ctx.match.slice(1);
  const subCat = subCategories.find(sc => sc.name === subCatName);
  if (!subCat) return ctx.answerCbQuery("Kategoriya topilmadi.");

  if (subCat.hasTypes) {
    // Obunachilar uchun turlarni ko'rsatish
    const keyboard = {
      inline_keyboard: [
        ...followerTypes.map(t => [{
          text: `👥 ${t} obunachilar`,
          callback_data: `type:${platform}:${subCatName}:${t}`
        }]),
        [{ text: "🔙 Orqaga", callback_data: `back_to_subcategory:${platform}:${subCatName}` }]
      ]
    };
    ctx.editMessageText(`${platform} - ${subCatName} turi:`, { reply_markup: keyboard });
  } else {
    // To'g'ridan-to'g'ri xizmatlarni ko'rsatish
    const services = await getServices();
    let filteredServices = services.filter(s =>
      s.category.toLowerCase().includes(platform.toLowerCase()) ||
      s.name.toLowerCase().includes(platform.toLowerCase())
    );

    if (subCat.keywords.length > 0) {
      filteredServices = filteredServices.filter(s =>
        subCat.keywords.some(k => s.name.toLowerCase().includes(k))
      );
    } else {
      const allKeywords = subCategories.flatMap(sc => sc.keywords);
      filteredServices = filteredServices.filter(s =>
        !allKeywords.some(k => s.name.toLowerCase().includes(k))
      );
    }

    if (filteredServices.length === 0) {
      return ctx.answerCbQuery("Bu kategoriyada xizmat yo'q.");
    }
  
    // Narx bo'yicha tartiblash (arzonidan qimmatiga)
    filteredServices.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
  
    await showSubCategoryServicesPage(ctx, 0, filteredServices, platform, subCatName);
  }
});

// Sub-kategoriya xizmatlari sahifalari
async function showSubCategoryServicesPage(ctx, page, services, platform, subCatName) {
  const perPage = 5;
  const start = page * perPage;
  const end = start + perPage;
  const pageServices = services.slice(start, end);
  const totalPages = Math.ceil(services.length / perPage);

  const keyboard = {
    inline_keyboard: [
      ...pageServices.map(s => [{
        text: `${s.name} - ${(parseFloat(s.rate) * 1.15).toFixed(2)} UZS (${s.min}-${s.max})`,
        callback_data: `service:${s.service}`
      }]),
      [
        page > 0 ? { text: "⬅️ Orqaga", callback_data: `subcat_page:${platform}:${subCatName}:${page - 1}` } : null,
        { text: `${page + 1}/${totalPages}`, callback_data: "noop" },
        end < services.length ? { text: "➡️ Keyingi", callback_data: `subcat_page:${platform}:${subCatName}:${page + 1}` } : null
      ].filter(Boolean),
      [{ text: "🔙 Orqaga", callback_data: `back_to_subcategory:${platform}:${subCatName}` }]
    ]
  };

  const text = `${platform} - ${subCatName} (sahifa ${page + 1}/${totalPages}):`;

  ctx.editMessageText(text, { reply_markup: keyboard });
}

// Tur tanlash (obunachilar uchun)
bot.action(/^type:(.+):(.+):(.+)$/, async (ctx) => {
  const [platform, subCatName, type] = ctx.match.slice(1);
  const subCat = subCategories.find(sc => sc.name === subCatName);
  if (!subCat) return ctx.answerCbQuery("Kategoriya topilmadi.");

  const services = await getServices();
  let filteredServices;
  if (type === "Boshqalar") {
    // Boshqalar uchun: follower keywords bor, lekin boshqa turlarga mos kelmaydiganlar
    const otherTypes = followerTypes.filter(t => t !== "Boshqalar");
    filteredServices = services.filter(s =>
      (s.category.toLowerCase().includes(platform.toLowerCase()) ||
       s.name.toLowerCase().includes(platform.toLowerCase())) &&
      subCat.keywords.some(k => s.name.toLowerCase().includes(k)) &&
      !otherTypes.some(t => s.name.toLowerCase().includes(t.toLowerCase()))
    );
  } else {
    filteredServices = services.filter(s =>
      (s.category.toLowerCase().includes(platform.toLowerCase()) ||
       s.name.toLowerCase().includes(platform.toLowerCase())) &&
      subCat.keywords.some(k => s.name.toLowerCase().includes(k)) &&
      s.name.toLowerCase().includes(type.toLowerCase())
    );
  }

  if (filteredServices.length === 0) {
    return ctx.answerCbQuery("Bu turda xizmat yo'q.");
  }

  // Narx bo'yicha tartiblash (arzonidan qimmatiga)
  filteredServices.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));

  await showTypeServicesPage(ctx, 0, filteredServices, platform, subCatName, type);
});

// Tur xizmatlari sahifalari
async function showTypeServicesPage(ctx, page, services, platform, subCatName, type) {
  const perPage = 5;
  const start = page * perPage;
  const end = start + perPage;
  const pageServices = services.slice(start, end);
  const totalPages = Math.ceil(services.length / perPage);

  const keyboard = {
    inline_keyboard: [
      ...pageServices.map(s => [{
        text: `${s.name} - ${(parseFloat(s.rate) * 1.15).toFixed(2)} UZS (${s.min}-${s.max})`,
        callback_data: `service:${s.service}`
      }]),
      [
        page > 0 ? { text: "⬅️ Orqaga", callback_data: `type_page:${platform}:${subCatName}:${type}:${page - 1}` } : null,
        { text: `${page + 1}/${totalPages}`, callback_data: "noop" },
        end < services.length ? { text: "➡️ Keyingi", callback_data: `type_page:${platform}:${subCatName}:${type}:${page + 1}` } : null
      ].filter(Boolean),
      [{ text: "🔙 Orqaga", callback_data: `back_to_types:${platform}:${subCatName}` }]
    ]
  };

  const text = `${platform} - ${subCatName} (${type}) (sahifa ${page + 1}/${totalPages}):`;

  ctx.editMessageText(text, { reply_markup: keyboard });
}

bot.action(/^type_page:(.+):(.+):(.+):(\d+)$/, async (ctx) => {
  const [platform, subCatName, type, pageStr] = ctx.match.slice(1);
  const page = parseInt(pageStr);
  const subCat = subCategories.find(sc => sc.name === subCatName);
  if (!subCat) return ctx.answerCbQuery("Kategoriya topilmadi.");

  const services = await getServices();
  let filteredServices;
  if (type === "Boshqalar") {
    // Boshqalar uchun: follower keywords bor, lekin boshqa turlarga mos kelmaydiganlar
    const otherTypes = followerTypes.filter(t => t !== "Boshqalar");
    filteredServices = services.filter(s =>
      (s.category.toLowerCase().includes(platform.toLowerCase()) ||
       s.name.toLowerCase().includes(platform.toLowerCase())) &&
      subCat.keywords.some(k => s.name.toLowerCase().includes(k)) &&
      !otherTypes.some(t => s.name.toLowerCase().includes(t.toLowerCase()))
    );
  } else {
    filteredServices = services.filter(s =>
      (s.category.toLowerCase().includes(platform.toLowerCase()) ||
       s.name.toLowerCase().includes(platform.toLowerCase())) &&
      subCat.keywords.some(k => s.name.toLowerCase().includes(k)) &&
      s.name.toLowerCase().includes(type.toLowerCase())
    );
  }

  // Narx bo'yicha tartiblash (arzonidan qimmatiga)
  filteredServices.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));

  await showTypeServicesPage(ctx, page, filteredServices, platform, subCatName, type);
});

bot.action(/^subcat_page:(.+):(.+):(\d+)$/, async (ctx) => {
  const [platform, subCatName, pageStr] = ctx.match.slice(1);
  const page = parseInt(pageStr);
  const subCat = subCategories.find(sc => sc.name === subCatName);
  if (!subCat) return ctx.answerCbQuery("Kategoriya topilmadi.");

  const services = await getServices();
  let filteredServices = services.filter(s =>
    s.category.toLowerCase().includes(platform.toLowerCase()) ||
    s.name.toLowerCase().includes(platform.toLowerCase())
  );

  if (subCat.keywords.length > 0) {
    filteredServices = filteredServices.filter(s =>
      subCat.keywords.some(k => s.name.toLowerCase().includes(k))
    );
  } else {
    const allKeywords = subCategories.flatMap(sc => sc.keywords);
    filteredServices = filteredServices.filter(s =>
      !allKeywords.some(k => s.name.toLowerCase().includes(k))
    );
  }

  // Narx bo'yicha tartiblash (arzonidan qimmatiga)
  filteredServices.sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));

  await showSubCategoryServicesPage(ctx, page, filteredServices, platform, subCatName);
});

bot.action("noop", (ctx) => ctx.answerCbQuery());

// A'zolikni tekshirish
bot.action("check_membership", async (ctx) => {
  const isMember = await checkMembership(ctx, REQUIRED_CHANNELS);
  if (isMember) {
    ctx.editMessageText("Rahmat! Endi botdan foydalanishingiz mumkin.");
    ctx.reply("Asosiy menyu:", mainMenu());
  } else {
    ctx.answerCbQuery("Siz hali barcha kanallarga azo bo'lmagansiz. Iltimos, azo bo'ling va qayta tekshiring.", { show_alert: true });
  }
});

// Orqaga tugmalari
bot.action("back_to_platforms", (ctx) => {
  const platforms = ["Telegram", "Instagram", "TikTok", "YouTube", "Twitter"];
  const keyboard = {
    inline_keyboard: platforms.map(p => [{
      text: `📱 ${p}`,
      callback_data: `platform:${p}`
    }])
  };

  ctx.editMessageText("Xizmat turini tanlang:", { reply_markup: keyboard });
});

bot.action(/^back_to_subcategory:(.+):(.+)$/, (ctx) => {
  const [platform, subCatName] = ctx.match.slice(1);
  const keyboard = {
    inline_keyboard: [
      ...subCategories.map(sc => [{
        text: `📂 ${sc.name}`,
        callback_data: `subcategory:${platform}:${sc.name}`
      }]),
      [{ text: "🔙 Orqaga", callback_data: "back_to_platforms" }]
    ]
  };

  ctx.editMessageText(`${platform} uchun kategoriyani tanlang:`, { reply_markup: keyboard });
});

bot.action(/^back_to_types:(.+):(.+)$/, (ctx) => {
  const [platform, subCatName] = ctx.match.slice(1);
  const keyboard = {
    inline_keyboard: followerTypes.map(t => [{
      text: `👥 ${t} obunachilar`,
      callback_data: `type:${platform}:${subCatName}:${t}`
    }])
  };

  // Orqaga tugmasini qo'shish
  keyboard.inline_keyboard.push([{ text: "🔙 Orqaga", callback_data: `back_to_subcategory:${platform}:${subCatName}` }]);

  ctx.editMessageText(`${platform} - ${subCatName} turi:`, { reply_markup: keyboard });
});

// Xizmat tanlash
bot.action(/^service:(\d+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  const services = await getServices();
  const service = services.find(s => s.service == serviceId);

  if (!service) {
    return ctx.answerCbQuery("Xizmat topilmadi.");
  }

  ctx.answerCbQuery();
  ctx.reply(
    `🛒 ${service.name}\n\n💵 Narx: ${(parseFloat(service.rate) * 1.15).toFixed(2)} UZS per 1000 units\n📦 Min: ${service.min}, Max: ${service.max}\n\nLink va miqdorni kiriting.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 Buyurtma berish", callback_data: `buy:${serviceId}` }]
        ]
      }
    }
  );
});

// Buyurtma berish
bot.action(/^buy:(\d+)$/, async (ctx) => {
  const serviceId = ctx.match[1];
  const services = await getServices();
  const service = services.find(s => s.service == serviceId);

  if (!service) {
    return ctx.answerCbQuery("Xizmat topilmadi.");
  }

  ctx.answerCbQuery();
  session[ctx.from.id] = { state: "await_quantity", serviceId: parseInt(serviceId), service };
  ctx.reply(`📦 ${service.name} uchun nechta kerak? (Min: ${service.min}, Max: ${service.max})`);
});

// Admin bilan bog‘lanish
bot.hears("👨‍💻 Admin bilan bog‘lanish", (ctx) => {
  ctx.reply("Admin: @yuldashev_frontend");
});

// Statistika
bot.command('statistic', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply("Bu buyruq faqat admin uchun.");

  const db = loadDB();
  const userCount = Object.keys(db.users).length;
  const orderCount = Object.keys(db.orders || {}).length;

  ctx.reply(`📊 Bot statistikasi:\n\n👥 Ro'yxatdan o'tgan foydalanuvchilar: ${userCount}\n📦 Jami buyurtmalar: ${orderCount}`);
});

// Pul kiritish jarayoni (summani va chekni qabul qilish)
bot.on("message", async (ctx) => {
  const uid = ctx.from.id;
  const s = session[uid];

  // Summani kiritish
  if (s && s.state === "await_amount" && ctx.message.text) {
    const amount = parseInt(ctx.message.text.trim());
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply("❌ Iltimos faqat musbat son kiriting.");
    }
    s.amount = amount;
    s.state = "await_receipt";
    return ctx.reply(
      `✅ Siz ${amount} UZS to‘ldirishni tanladingiz.\n\nQuyidagi karta raqamiga pul o‘tkazing:\n${PAYMENT_CARD}\n\nSo‘ng to‘lov chekini shu yerga yuboring 📷`
    );
  }

  // Chekni qabul qilish
  if (s && s.state === "await_receipt") {
    if (ctx.message.photo || ctx.message.document) {
      let fileId;
      if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      } else {
        fileId = ctx.message.document.file_id;
      }

      const db = loadDB();
      ensureUser(db, uid);
      const pendingId = `p_${Date.now()}_${uid}`;
      db.pending[pendingId] = {
        id: pendingId,
        userId: uid,
        amount: s.amount,
        fileId,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      saveDB(db);

      // Adminga yuborish
      const caption = `🔔 *Yangi to‘lov so‘rovi*\n\n🆔 ID: ${pendingId}\n👤 User: ${ctx.from.id}\n💵 ${s.amount} UZS\n⏰ ${db.pending[pendingId].created_at}`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("✅ Tasdiqlash", `approve:${pendingId}`), Markup.button.callback("❌ Rad etish", `reject:${pendingId}`)]
      ]);
      await ctx.telegram.sendPhoto(ADMIN_ID, fileId, { caption, parse_mode: "Markdown", ...buttons });
      ctx.reply("📩 Chek adminga yuborildi. Tasdiqlashni kuting ⏳.", mainMenu());
      delete session[uid];
    } else {
      return ctx.reply("❌ Iltimos, to‘lov chekini yuboring.");
    }
  }

  // Xizmatlarda son va link kiritish
  if (s && s.state === "await_quantity" && ctx.message.text) {
    const qty = parseInt(ctx.message.text.trim());
    if (isNaN(qty) || qty < s.service.min || qty > s.service.max) {
      return ctx.reply(`❌ Miqdor ${s.service.min} va ${s.service.max} orasida bo‘lishi kerak.`);
    }
    s.qty = qty;
    s.price = Math.ceil((qty / 1000) * parseFloat(s.service.rate) * 1.15);
    s.state = "await_link";
    return ctx.reply(`🔗 Endi link yuboring.\n\n💵 Narx: ${s.price} UZS (15% ustama bilan)`);
  }

  if (s && s.state === "await_link" && ctx.message.text) {
    const link = ctx.message.text.trim();
    s.link = link;

    const db = loadDB();
    ensureUser(db, uid);

    if (db.users[uid].balance < s.price) {
      delete session[uid];
      return ctx.reply("❌ Balansingiz yetarli emas. Pul to‘ldiring.");
    }

    // API ga so‘rov
    try {
      const resp = await axios.post("https://seensms.uz/api/v1", {
        key: API_KEY,
        action: "add",
        service: s.serviceId,
        link: link,
        quantity: s.qty,
      });

      db.users[uid].balance -= s.price;
      saveDB(db);

      ctx.reply(
        `✅ Buyurtma qabul qilindi!\n🆔 Order ID: ${resp.data.order || "?"}\n📦 Miqdor: ${s.qty}\n💵 Narx: ${s.price} UZS (15% ustama bilan)\n🔗 Link: ${link}`
      );
    } catch (err) {
      ctx.reply("❌ Buyurtma berishda xatolik yuz berdi. Keyinroq urinib ko‘ring.");
    }
    delete session[uid];
  }
});

bot.launch();

