/**
 * index.js — Multi-user Amul Protein Tracker entry point.
 */

require("dotenv").config();

const { bot, runCheckAndReport } = require("./bot");
const { startScheduler, startTrackingScheduler } = require("./scheduler");

console.log("=".repeat(50));
console.log("  Amul Protein Stock Tracker");
console.log("=".repeat(50));

// ── Daily report scheduler ────────────────────────────────────────────────────
// Fires at each user's configured check time (IST).
startScheduler(async (chatId) => {
  await runCheckAndReport(chatId);
});

// ── Product tracking scheduler ────────────────────────────────────────────────
startTrackingScheduler({
  // 1. Keyword found in stock at primary pincode
  onKeywordFound: async (chatId, keyword, products, pincode) => {
    const lines = products
      .map(
        (p) =>
          `  • ${p.name}${p.uspLabel ? ` (${p.uspLabel})` : ""}${p.inventoryQty > 0 ? ` — ${p.inventoryQty} left` : ""}`
      )
      .join("\n");

    await bot.sendMessage(
      chatId,
      `🚨 <b>Stock Alert!</b>\n\n` +
        `Your tracked keyword "<b>${keyword}</b>" is now <b>IN STOCK</b> 🟢\n` +
        `📍 Pincode: <code>${pincode}</code>\n\n` +
        `${lines}\n\n` +
        `Tap "🔍 Check Now" for the full report.`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  },

  // 2. Keyword in stock at a secondary pincode (out of stock at primary)
  onKeywordFoundSecondary: async (
    chatId,
    keyword,
    products,
    secondaryPincode,
    primaryPincode
  ) => {
    const lines = products.map((p) => `  • ${p.name}`).join("\n");

    await bot.sendMessage(
      chatId,
      `🔔 <b>Secondary Pincode Alert!</b>\n\n` +
        `"<b>${keyword}</b>" is:\n` +
        `🔴 Out of Stock at primary (<code>${primaryPincode}</code>)\n` +
        `🟢 <b>IN STOCK at <code>${secondaryPincode}</code>!</b>\n\n` +
        `${lines}`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  },

  // 3. Freebie / bundle product in stock
  onFreebieFound: async (chatId, freebieProducts, pincode) => {
    const lines = freebieProducts.map((p) => `  🎁 ${p.name} — ${p.price}`).join("\n");

    await bot.sendMessage(
      chatId,
      `🎁 <b>Freebie Alert!</b>\n\n` +
        `A bundle or freebie deal is back in stock for pincode <code>${pincode}</code>!\n\n` +
        `${lines}\n\n` +
        `Tap "🔍 Check Now" to see the full report and grab it before it sells out!`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  },

  // 4. Brand new product launch
  onNewProducts: async (chatId, newProducts) => {
    const lines = newProducts
      .map((p) => `  🆕 <b>${p.name}</b>${p.price && p.price !== "N/A" ? ` — ${p.price}` : ""}`)
      .join("\n");

    await bot.sendMessage(
      chatId,
      `🆕 <b>New Product Launch!</b>\n\n` +
        `Amul just added new protein product(s):\n\n` +
        `${lines}\n\n` +
        `Tap "🔍 Check Now" to check availability in your area.`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  },
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n[App] Shutting down gracefully...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[App] Received SIGTERM, shutting down...");
  bot.stopPolling();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[App] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[App] Unhandled rejection:", reason);
});

console.log("[App] Bot is running.");
