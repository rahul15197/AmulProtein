/**
 * bot.js — Telegram bot.
 * 
 * bot to track Amul protein availability.
 */

require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { checkAvailability, formatReport } = require("./scraper");
const {
  getUserConfig,
  updateUserConfig,
  addTrackedProduct,
  removeTrackedProduct,
  clearAllTracked,
  addSecondaryPincode,
  removeSecondaryPincode,
} = require("./store");
const { generateUserReport } = require("./export");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "716436790";

if (!BOT_TOKEN) {
  console.error("[Bot] ERROR: TELEGRAM_BOT_TOKEN is not set.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log("[Bot] Telegram bot started.");

// ─── Menu and State ──────────────────────────────────────────────────────────

/**
 * Build the reply keyboard from a config object.
 * Backward-compatible: also accepts a plain boolean for 'enabled'.
 */
function getMenu(config) {
  const enabled = typeof config === "boolean" ? config : config?.enabled !== false;
  const freebieAlerts = typeof config === "boolean" ? true : config?.freebieAlerts !== false;
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Check Now" }, { text: "📋 Status" }],
        [{ text: "📍 My Pincodes" }, { text: "⏰ Set Time" }],
        [{ text: "📦 Track Product" }, { text: "🗑️ Untrack" }],
        [
          { text: freebieAlerts ? "🎁 Freebie/Coupon: ON" : "🎁 Freebie/Coupon: OFF" },
          { text: enabled ? "🔔 Report: ON" : "🔕 Report: OFF" },
        ],
        [{ text: "📖 Full Guide" }, { text: "❓ Help" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}


// States: AWAITING_PRIMARY_PINCODE | AWAITING_SECONDARY_PINCODE | AWAITING_TIME | AWAITING_TRACK | AWAITING_UNTRACK | null
const userStates = {};


// ─── Utils ────────────────────────────────────────────────────────────────────

async function sendMessage(chatId, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...options,
    });
  } catch (err) {
    console.error(`[Bot] Failed to send message to ${chatId}:`, err.message);
  }
}

async function sendHelp(chatId) {
  const config = getUserConfig(chatId);
  const statusEmoji = config.enabled ? "🔔 ON" : "🔕 OFF";
  const freebieEmoji = config.freebieAlerts !== false ? "🎁 ON" : "🔕 OFF";
  const newProdEmoji = config.newProductAlerts !== false ? "🆕 ON" : "🔕 OFF";
  const tracked = config.trackedProducts || [];
  const trackedStr = tracked.length
    ? tracked.map((p) => `  • <code>${p.keyword}</code>`).join("\n")
    : "  <i>None yet!</i>";
  const secondary = config.secondaryPincodes || [];
  const secondaryStr = secondary.length
    ? secondary.map((p) => `<code>${p}</code>`).join(", ")
    : "<i>None set</i>";

  const text =
    `<b>🤖 How can I help you today?</b>\n\n` +
    `I'm your personal Amul Protein scout! I scan the store so you don't have to. Here's what I do:\n\n` +
    `✨ <b>Power Features:</b>\n` +
    `• 🏆 <b>Best Value Finder:</b> I'll highlight the items with the best bang for buck with a 👑.\n` +
    `• 🎁 <b>Freebie/Coupon Alerts:</b> Turn on to get notified about limited-edition bundles, free shaker deals, and active coupons.\n` +
    `• 📍 <b>Smart Backup:</b> Set secondary pincodes! If your primary location is out of stock, I'll automatically check your backups.\n` +
    `• 🆕 <b>Fresh Drops:</b> I'll let you know the second Amul launches a brand new protein product.\n\n` +
    `🎮 <b>Quick Guide:</b>\n` +
    `1. <b>My Pincodes:</b> Manage where you want me to look.\n` +
    `2. <b>Set Time:</b> Pick when you want your daily overview of stock (IST).\n` +
    `3. <b>Track Product:</b> Tell me a product or keyword (like 'whey' or 'shake') and I'll notify you the moment it hits the shelf.\n` +
    `4. <b>Check Now:</b> Want a live report? Just tap the button!\n\n` +
    `<b>⚙️ Your Current Setup:</b>\n` +
    `📍 Primary: <code>${config.pincode}</code> | Backups: ${secondaryStr}\n` +
    `🔔 Daily Report: <b>${statusEmoji}</b> at <b>${config.checkTime} IST</b>\n` +
    `🎁 Promos & Coupons: <b>${freebieEmoji}</b>\n` +
    `🆕 New Drops Alert: <b>${newProdEmoji}</b>\n` +
    `📦 Tracked Products:\n${trackedStr}\n\n` +
    `<b>Relax, I got you covered!</b>\n\n` +
    `<i>Created with ❤️ by <a href="tg://user?id=716436790">Rahul Maheshwari</a></i>`;

  await sendMessage(chatId, text, getMenu(config));
}

/**
 * Parse a time string in 12h or 24h format.
 * Handles: "8am", "8AM", "6   PM", "2:30pm", "14:30", "9:05 AM"
 * Returns "HH:MM" string, or null if invalid.
 */
function parseTime(input) {
  // Collapse all whitespace between parts, then uppercase
  const str = input.trim().replace(/\s+/g, " ").toUpperCase();

  // 12h format: optional minutes, any amount of space, AM/PM (no space also ok via collapse)
  // Matches: "8AM", "8 AM", "8:30AM", "8:30 AM", "12:59 PM"
  const match12 = str.match(/^(\d{1,2})(?::(\d{2}))? ?(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2] || "0", 10);
    const period = match12[3];
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (period === "AM") {
      if (h === 12) h = 0; // 12 AM = midnight
    } else {
      if (h !== 12) h += 12; // 12 PM stays 12
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 24h format: "14:30", "08:00", "0:00", "23:59"
  const match24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return null; // anything else is invalid
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

async function runCheckAndReport(chatId) {
  const config = getUserConfig(chatId);
  const menu = getMenu(config.enabled);

  // Animation frames cycling through search emojis
  const frames = [
    "🔍 Searching for protein stock...",
    "🔎 Searching for protein stock...",
    "🔍 Searching for protein stock...",
    "🔎 Searching for protein stock...",
  ];
  const dots = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  let frameIdx = 0;
  let dotIdx = 0;

  // Send the initial loading message
  let loadingMsg;
  try {
    loadingMsg = await bot.sendMessage(
      chatId,
      `${frames[0]}\n${dots[0]} Checking pincode <code>${config.pincode}</code>...`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error(`[Bot] Failed to send loading message:`, err.message);
    return;
  }

  // Animate the loading message every 400ms
  const animInterval = setInterval(async () => {
    frameIdx = (frameIdx + 1) % frames.length;
    dotIdx = (dotIdx + 1) % dots.length;
    try {
      await bot.editMessageText(
        `${frames[frameIdx]}\n${dots[dotIdx]} Checking pincode <code>${config.pincode}</code>...`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: "HTML",
        }
      );
    } catch (_) {
      // Ignore edit errors (message may have been deleted, etc.)
    }
  }, 500);

  try {
    const result = await checkAvailability(config.pincode);
    updateUserConfig(chatId, { lastChecked: new Date().toISOString() });
    const report = formatReport(result);

    clearInterval(animInterval);

    // Replace loading message with final result
    try {
      await bot.editMessageText(`✅ Stock check complete!`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
      });
    } catch (_) {}

    await sendMessage(chatId, report, menu);
  } catch (err) {
    clearInterval(animInterval);
    try {
      await bot.editMessageText(`❌ Check failed.`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
      });
    } catch (_) {}
    await sendMessage(chatId, `❌ Error: <code>${err.message}</code>`, menu);
  }
}

// ─── Command Handlers ────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const config = getUserConfig(chatId);
  updateUserConfig(chatId, { enabled: true });

  await sendMessage(
    chatId,
    `🤝 <b>Glad to have you here!</b>\n\n` +
      `I'm ready to help you snag those Amul Protein products before they sell out. I'll stay on the lookout 24/7! 🫡\n\n` +
      `📍 <b>Current Pincode:</b> <code>${config.pincode}</code>\n` +
      `⏰ <b>Daily briefing:</b> <b>${config.checkTime} IST</b>\n\n` +
      `Check out the menu below to customize your alerts!`,
    getMenu({ enabled: true, freebieAlerts: true })
  );
  await sendHelp(chatId);
});

bot.onText(/\/export/, async (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== ADMIN_ID) {
    return; // Silently ignore non-admins
  }
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, "⏳ Generating Excel report...");
    const buffer = await generateUserReport();
    
    await bot.sendDocument(
      chatId,
      buffer,
      {},
      { filename: `amul_users_${new Date().toISOString().split("T")[0]}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  } catch (err) {
    console.error(`[Bot] Excel export failed:`, err.message);
    await sendMessage(chatId, `❌ Export failed: ${err.message}`);
  }
});

bot.onText(/\/help/, async (msg) => {
  await sendHelp(msg.chat.id);
});

bot.onText(/\/check/, async (msg) => {
  await runCheckAndReport(msg.chat.id);
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const config = getUserConfig(chatId);
  const lastCheckedStr = config.lastChecked
    ? new Date(config.lastChecked).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " IST"
    : "<i>Never</i>";

  const tracked = config.trackedProducts || [];
  const trackedStr = tracked.length
    ? tracked
        .map((p) => {
          const status =
            p.lastStatus === "in_stock" ? "🟢 In Stock" :
            p.lastStatus === "out_of_stock" ? "🔴 Sold Out" : "⚪ Unknown";
          return `  • <code>${p.keyword}</code> — ${status}`;
        })
        .join("\n")
    : "  <i>None yet</i>";
  const secondary = config.secondaryPincodes || [];
  const secondaryStr = secondary.length ? secondary.map((p) => `<code>${p}</code>`).join(", ") : "<i>None set</i>";

  await sendMessage(
    chatId,
    `📊 <b>Your Tracking Overview</b>\n\n` +
      `📍 <b>Primary Area:</b> <code>${config.pincode}</code>\n` +
      `🔄 <b>Backup Areas:</b> ${secondaryStr}\n` +
      `🔔 <b>Daily Briefing:</b> <b>${config.enabled ? "Enabled" : "Disabled"}</b> (${config.checkTime} IST)\n` +
      `🎁 <b>Promos & Coupons:</b> <b>${config.freebieAlerts !== false ? "ON" : "OFF"}</b>\n` +
      `🆕 <b>New Drops Alert:</b> <b>${config.newProductAlerts !== false ? "Watching" : "Paused"}</b>\n` +
      `🕐 <b>Last Checked:</b> ${lastCheckedStr}\n\n` +
      `📦 <b>Tracked Products:</b>\n${trackedStr}`,
    getMenu(config)
  );
});

// ─── Message Handler (Buttons & States) ──────────────────────────────────────

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith("/")) return;

  const text = msg.text.trim();

  // Button Handlers
  if (text === "🔍 Check Now") {
    return await runCheckAndReport(chatId);
  }
  if (text === "📋 Status") {
    const config = getUserConfig(chatId);
    const lastCheckedStr = config.lastChecked
      ? new Date(config.lastChecked).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        }) + " IST"
      : "Never";

    const tracked = config.trackedProducts || [];
    const trackedStr = tracked.length
      ? tracked
          .map((p) => {
            const status =
              p.lastStatus === "in_stock" ? "🟢 In Stock" :
              p.lastStatus === "out_of_stock" ? "🔴 Out of Stock" : "⚪ Unknown";
            return `  • <code>${p.keyword}</code> — ${status}`;
          })
          .join("\n")
      : "  None";
    const secondary = config.secondaryPincodes || [];
    const secondaryStr = secondary.length ? secondary.map((p) => `<code>${p}</code>`).join(", ") : "None";

    return await sendMessage(
      chatId,
      `<b>Current Configuration</b>\n\n` +
        `📍 Primary Pincode: <code>${config.pincode}</code>\n` +
        `📍 Secondary Pincodes: ${secondaryStr}\n` +
        `🔔 Daily Report: <b>${config.enabled ? "ON" : "OFF"}</b>\n` +
        `⏰ Scheduled Time: <b>${config.checkTime} IST</b>\n` +
        `🎁 <b>Promos & Coupons:</b> <b>${config.freebieAlerts !== false ? "ON" : "OFF"}</b>\n` +
        `🆕 New Drops Alert: <b>${config.newProductAlerts !== false ? "ON" : "OFF"}</b> <i>(auto)</i>\n` +
        `🕐 Last Checked: ${lastCheckedStr}\n\n` +
        `📦 <b>Tracked Products:</b>\n${trackedStr}`,
      getMenu(config)
    );
  }
  if (text === "🎁 Freebie/Coupon: ON" || text === "🎁 Freebie/Coupon: OFF" || text === "🎁 Freebie: ON" || text === "🎁 Freebie: OFF") {
    const config = getUserConfig(chatId);
    const newState = config.freebieAlerts === false ? true : false;
    updateUserConfig(chatId, { freebieAlerts: newState });
    const updatedConfig = getUserConfig(chatId);
    await sendMessage(
      chatId,
      newState
        ? `🎁 <b>Promo Alerts turned ON</b>\n\nI'll notify you when any high-value item (coupons, free-shakers, or bundles) come in stock for pincode <code>${config.pincode}</code>.`
        : `🔕 <b>Promo Alerts turned OFF</b>\n\nYou won't receive bundle/coupon alerts anymore.`,
      getMenu(updatedConfig)
    );
    return;
  }
  if (text === "🔔 Report: ON" || text === "🔕 Report: OFF") {
    const config = getUserConfig(chatId);
    const newState = !config.enabled;
    updateUserConfig(chatId, { enabled: newState });
    const updatedConfig = getUserConfig(chatId);
    if (newState) {
      await sendMessage(chatId,
        `🔔 <b>Daily briefing activated!</b>\n\n` +
        `I'll send you a full stock summary at <b>${config.checkTime} IST</b> every day for <code>${config.pincode}</code>.\n\n` +
        `<i>Need a different time? Just tap "⏰ Set Time".</i>`,
        getMenu(updatedConfig));
    } else {
      await sendMessage(chatId, `🔕 <b>Daily briefing paused.</b>\n\nI'll still alert you instantly for your tracked products!`, getMenu(updatedConfig));
    }
    return;
  }
  if (text === "📍 My Pincodes") {
    const config = getUserConfig(chatId);
    const secondary = config.secondaryPincodes || [];
    const rows = [
      [{ text: `🏠 Primary: ${config.pincode}`, callback_data: "pincode_change_primary" }],
    ];
    secondary.forEach((p) => {
      rows.push([{ text: `🗑️ Remove Backup ${p}`, callback_data: `pincode_remove_${p}` }]);
    });
    if (secondary.length < 2) {
      rows.push([{ text: "➕ Add Backup Pincode", callback_data: "pincode_add_secondary" }]);
    }
    return await bot.sendMessage(
      chatId,
      `📍 <b>Manage Your Pincodes</b>\n\n` +
        `🏠 <b>Primary:</b> <code>${config.pincode}</code>\n` +
        (secondary.length
          ? `🔄 <b>Backups:</b> ${secondary.map((p) => `<code>${p}</code>`).join(", ")}\n`
          : `🔄 <b>Backups:</b> <i>None set yet</i>\n`) +
        `\nI'll automatically check your backup areas if items are sold out at your primary location.`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows },
      }
    );
  }
  if (text === "📦 Track Product") {
    return await bot.sendMessage(
      chatId,
      "📦 <b>Track a Product</b>\n\nWhat do you want to track?",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎯 Specific Product", callback_data: "track_specific" },
              { text: "📂 By Category", callback_data: "track_category" },
            ],
          ],
        },
      }
    );
  }
  if (text === "🗑️ Untrack") {
    const config = getUserConfig(chatId);
    const tracked = config.trackedProducts || [];
    if (tracked.length === 0) {
      return await sendMessage(chatId, "⚠️ You have no tracked products.", getMenu(config.enabled));
    }
    const list = tracked.map((p) => `• <code>${p.keyword}</code>`).join("\n");
    userStates[chatId] = "AWAITING_UNTRACK";
    return await sendMessage(
      chatId,
      `🗑️ <b>Stop Tracking</b>\n\nCurrently tracking:\n${list}\n\nType a keyword to untrack, or type <code>all</code> to clear all:`,
      {
        reply_markup: {
          force_reply: true,
          keyboard: [[{ text: "❌ Cancel" }]],
          resize_keyboard: true,
        },
      }
    );
  }
  if (text === "📍 Set Pincode") {
    userStates[chatId] = "AWAITING_PINCODE";
    return await sendMessage(chatId, "📍 Enter your 6-digit Pincode:", {
      reply_markup: {
        force_reply: true,
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true
      }
    });
  }
  if (text === "⏰ Set Time") {
    userStates[chatId] = "AWAITING_TIME";
    return await sendMessage(chatId,
      "⏰ Enter report time (IST). Accepted formats:\n" +
      "• 24h: <code>14:30</code>\n" +
      "• 12h: <code>2:30 PM</code> or <code>9 AM</code>", {
      reply_markup: {
        force_reply: true,
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true
      }
    });
  }
  if (text === "❓ Help") {
    return await sendHelp(chatId);
  }
  if (text === "📖 Full Guide") {
    const guideUrl = process.env.GUIDE_URL || "https://github.com/Rahul-Maheshwari/Amul-Protein-Tracker"; // Replace this with your Oracle VM hosted document link
    return await bot.sendMessage(
      chatId,
      `📚 <b>The Ultimate Guide</b>\n\n` +
      `I have prepared an extremely detailed document explaining every single feature, including the Best Value Finder, Freebie Alerts, Multi-Pincode Fallbacks, and New Product Launch Detectors.\n\n` +
      `<b>Get in touch with my creator:</b>\n` +
      `📸 <a href="https://www.instagram.com/rahul.zeroone">Instagram</a>\n` +
      `💼 <a href="https://www.linkedin.com/in/rm15197/">LinkedIn</a>\n` +
      `📧 rahul.maheshmaheshwari@gmail.com\n\n` +
      `Click the button below to read the comprehensive online guide!`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🌐 Read Full Guide", url: guideUrl }],
          ],
        },
      }
    );
  }
  if (text === "❌ Cancel") {

    const config = getUserConfig(chatId);
    userStates[chatId] = null;
    return await sendMessage(chatId, "Cancelled.", getMenu(config));
  }

  // State Handlers
  const state = userStates[chatId];
  if (state === "AWAITING_PRIMARY_PINCODE") {
    if (!/^\d{6}$/.test(text)) {
      return await sendMessage(chatId, "❌ Invalid. Please enter a 6-digit pincode:");
    }
    const config = updateUserConfig(chatId, { pincode: text });
    userStates[chatId] = null;
    return await sendMessage(chatId, `📍 <b>Primary location set!</b>\n\nI'll now focus my search on <code>${text}</code>.`, getMenu(config));
  }

  if (state === "AWAITING_SECONDARY_PINCODE") {
    if (!/^\d{6}$/.test(text)) {
      return await sendMessage(chatId, "❌ Invalid. Please enter a 6-digit pincode:");
    }
    const result = addSecondaryPincode(chatId, text);
    const config = getUserConfig(chatId);
    userStates[chatId] = null;
    if (result === false)
      return await sendMessage(chatId, `⚠️ <code>${text}</code> is already in your secondary list.`, getMenu(config));
    if (result === "limit")
      return await sendMessage(chatId, `⚠️ You already have 2 secondary pincodes. Remove one first.`, getMenu(config));
    return await sendMessage(chatId, `➕ <b>Backup added!</b>\n\nI'll now check <code>${text}</code> as a secondary location if your primary is sold out.`, getMenu(config));
  }

  if (state === "AWAITING_TIME") {
    const parsed = parseTime(text);
    if (!parsed) {
      return await sendMessage(chatId,
        "❌ Invalid time. Try <code>9:30 AM</code>, <code>2 PM</code>, or <code>14:30</code>:");
    }
    const config = updateUserConfig(chatId, { checkTime: parsed });
    userStates[chatId] = null;
    return await sendMessage(chatId, `⏰ <b>Daily briefing scheduled!</b>\n\nI'll see you at <b>${parsed} IST</b> every day with a full report.`, getMenu(config));
  }

  if (state === "AWAITING_TRACK") {
    const keyword = text.toLowerCase().trim();
    if (keyword.length < 2) {
      return await sendMessage(chatId, "❌ Keyword too short. Enter at least 2 characters:");
    }
    const added = addTrackedProduct(chatId, keyword);
    const config = getUserConfig(chatId);
    userStates[chatId] = null;
    if (!added) {
      return await sendMessage(
        chatId,
        `⚠️ Already tracking <code>${keyword}</code>.`,
        getMenu(config.enabled)
      );
    }
    return await sendMessage(
      chatId,
      `🎯 <b>Tracking started!</b>\n\nI'm now hunting for <b>"${keyword}"</b> 24/7. I'll notify you the instant I find stock for <code>${config.pincode}</code> (or your backups!).`,
      getMenu(config)
    );
  }

  if (state === "AWAITING_UNTRACK") {
    const keyword = text.toLowerCase().trim();
    const config = getUserConfig(chatId);
    userStates[chatId] = null;
    if (keyword === "all") {
      clearAllTracked(chatId);
      return await sendMessage(chatId, `🗑️ <b>Tracking list cleared.</b>\n\nYour radar is now empty.`, getMenu(config));
    }
    const removed = removeTrackedProduct(chatId, keyword);
    if (!removed) {
      return await sendMessage(
        chatId,
        `❌ <code>${keyword}</code> was not in your tracked list.`,
        getMenu(config)
      );
    }
    return await sendMessage(
      chatId,
      `✅ <b>Stopped tracking "${keyword}".</b>`,
      getMenu(config)
    );
  }

  // Fallback — show menu
  await sendHelp(chatId);
});

// ─── Inline Keyboard Callback Handler ──────────────────────────────────────────────────

const AMUL_CATEGORIES = [
  { label: "🥤 Shake",         kw: "shake"         },
  { label: "🧀 Paneer",        kw: "paneer"        },
  { label: "🥛 Lassi",         kw: "lassi"         },
  { label: "🧄 Whey",          kw: "whey"          },
  { label: "🍫 Chocolate",     kw: "chocolate"     },
  { label: "🦣 Greek Yogurt",  kw: "greek"         },
  { label: "🍺 Chaas",         kw: "chaas"         },
  { label: "🫘 Protein Bar",   kw: "protein bar"   },
  { label: "🤼 Dahi",          kw: "dahi"          },
  { label: "🥛 Milk",          kw: "milk"          },
];

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const config = getUserConfig(chatId);

  // Always answer the callback to remove the loading spinner on the button
  await bot.answerCallbackQuery(query.id);

  if (data === "track_specific") {
    userStates[chatId] = "AWAITING_TRACK";
    await bot.editMessageText(
      "🎯 <b>Track Specific Product</b>\n\n" +
        "Type the product name or a part of it:\n" +
        "Example: <code>Amul High Protein Blueberry Shake</code> or just <code>blueberry</code>\n\n" +
        "<i>The search is case-insensitive and partial matches work.</i>",
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      }
    );
    await sendMessage(chatId, "✏️ Type the product name:", {
      reply_markup: {
        force_reply: true,
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true,
      },
    });
    return;
  }

  if (data === "track_category") {
    // Build 2-column inline keyboard of categories + Custom option
    const rows = [];
    for (let i = 0; i < AMUL_CATEGORIES.length; i += 2) {
      const row = [
        { text: AMUL_CATEGORIES[i].label, callback_data: `track_cat_${AMUL_CATEGORIES[i].kw}` },
      ];
      if (AMUL_CATEGORIES[i + 1]) {
        row.push({
          text: AMUL_CATEGORIES[i + 1].label,
          callback_data: `track_cat_${AMUL_CATEGORIES[i + 1].kw}`,
        });
      }
      rows.push(row);
    }
    rows.push([{ text: "✏️ Custom Category", callback_data: "track_specific" }]);

    await bot.editMessageText(
      "📂 <b>Select a Category</b>\n\nChoose a product category to track:",
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows },
      }
    );
    return;
  }

  if (data.startsWith("track_cat_")) {
    const keyword = data.replace("track_cat_", "");
    const added = addTrackedProduct(chatId, keyword);
    const resultText = added
      ? `✅ Now tracking category <b>"${keyword}"</b> 📦\n\nI'll alert you when any matching product comes in stock for pincode <code>${config.pincode}</code>.`
      : `⚠️ Already tracking <b>"${keyword}"</b>.`;
    try {
      await bot.editMessageText(resultText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });
    } catch (_) {}
    await sendMessage(chatId, "📦 You can add more or check your tracked list via Status.", getMenu(config));
    return;
  }

  // ── Pincode management callbacks ─────────────────────────────────────────────
  if (data === "pincode_change_primary") {
    userStates[chatId] = "AWAITING_PRIMARY_PINCODE";
    try {
      await bot.editMessageText(
        `🟢 <b>Change Primary Pincode</b>\n\nCurrent: <code>${config.pincode}</code>\n\nType your new 6-digit pincode:`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
      );
    } catch (_) {}
    await sendMessage(chatId, "✏️ Type new primary pincode:", {
      reply_markup: { force_reply: true, keyboard: [[{ text: "❌ Cancel" }]], resize_keyboard: true }
    });
    return;
  }
  if (data === "pincode_add_secondary") {
    userStates[chatId] = "AWAITING_SECONDARY_PINCODE";
    try {
      await bot.editMessageText(
        `➕ <b>Add Secondary Pincode</b>\n\nType the 6-digit pincode to add as backup:\n<i>I'll check it when tracked products are sold out at your primary.</i>`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
      );
    } catch (_) {}
    await sendMessage(chatId, "✏️ Type secondary pincode:", {
      reply_markup: { force_reply: true, keyboard: [[{ text: "❌ Cancel" }]], resize_keyboard: true }
    });
    return;
  }
  if (data.startsWith("pincode_remove_")) {
    const pinToRemove = data.replace("pincode_remove_", "");
    const removed = removeSecondaryPincode(chatId, pinToRemove);
    const updatedConfig = getUserConfig(chatId);
    const secondary = updatedConfig.secondaryPincodes || [];
    const resultText = removed
      ? `✅ Removed secondary pincode <code>${pinToRemove}</code>.`
      : `⚠️ Pincode <code>${pinToRemove}</code> was not found.`;
    try {
      await bot.editMessageText(resultText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      });
    } catch (_) {}
    await sendMessage(
      chatId,
      `📍 Secondary Pincodes: ${secondary.length ? secondary.map((p) => `<code>${p}</code>`).join(", ") : "None"}`,
      getMenu(updatedConfig)
    );
    return;
  }
});

module.exports = { bot, runCheckAndReport };
