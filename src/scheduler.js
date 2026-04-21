/**
 * scheduler.js — Multi-user daily check scheduler + product tracking.
 *
 * Has two separate schedulers:
 * 1. startScheduler()        — Daily report at each user's scheduled time.
 * 2. startTrackingScheduler() — Per-minute tracker for keywords, freebies,
 *                               secondary pincodes, and new product launches.
 */

const cron = require("node-cron");
const {
  getAllUsers,
  updateUserConfig,
  updateTrackedEntry,
} = require("./store");
const { checkAvailability } = require("./scraper");
const { checkForNewProducts } = require("./newProductDetector");

let activeTask = null;
let reportDelegate = null;

// ─── Daily Report Scheduler ───────────────────────────────────────────────────

/**
 * Start the global minute-by-minute tick.
 * Fires reportDelegate(chatId) for each user whose checkTime matches current IST.
 */
function startScheduler(onReportRequired) {
  reportDelegate = onReportRequired;

  console.log(`[Scheduler] Starting universal minute-by-minute tick (IST)...`);

  if (activeTask) activeTask.stop();

  activeTask = cron.schedule(
    "* * * * *",
    async () => {
      const now = new Date();
      const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);

      const hh = String(istTime.getUTCHours()).padStart(2, "0");
      const mm = String(istTime.getUTCMinutes()).padStart(2, "0");
      const currentTime = `${hh}:${mm}`;

      const users = getAllUsers();
      for (const chatId of Object.keys(users)) {
        const user = users[chatId];
        if (user.enabled && user.checkTime === currentTime) {
          console.log(
            `[Scheduler] Triggering report for user ${chatId} at ${currentTime} IST`
          );
          try {
            await reportDelegate(chatId);
          } catch (err) {
            console.error(
              `[Scheduler] Error sending report to ${chatId}:`,
              err.message
            );
          }
        }
      }
    },
    { timezone: "UTC" }
  );
}

function reschedule() {
  return true; // Dynamic — picks up from store next tick
}

function stopScheduler() {
  if (activeTask) {
    activeTask.stop();
    activeTask = null;
  }
}

// ─── Product Tracking Scheduler ───────────────────────────────────────────────

const trackingInProgress = new Set();

/**
 * Start the per-minute product tracking scheduler.
 *
 * @param {Object} callbacks
 *   onKeywordFound(chatId, keyword, products, pincode)     — keyword in stock
 *   onKeywordFoundSecondary(chatId, keyword, products, secondaryPincode) — stock at secondary
 *   onFreebieFound(chatId, freebieProducts, pincode)       — freebie in stock
 *   onNewProducts(chatId, newProducts)                     — brand new launch
 */
function startTrackingScheduler(callbacks) {
  const {
    onKeywordFound,
    onKeywordFoundSecondary,
    onFreebieFound,
    onNewProducts,
  } = callbacks;

  console.log("[Tracker] Starting per-minute product tracker...");

  cron.schedule(
    "* * * * *",
    async () => {
      const users = getAllUsers();

      // We only run the new-product check once per minute across all users
      // (use the first user's scrape result to seed it)
      let newProductsCheckedThisMinute = false;
      let pendingNewProducts = [];

      for (const [chatId, user] of Object.entries(users)) {
        const tracked = user.trackedProducts || [];
        const freebieAlerts = user.freebieAlerts !== false;

        // Skip users with nothing to track
        if (tracked.length === 0 && !freebieAlerts) continue;
        if (trackingInProgress.has(chatId)) continue;

        trackingInProgress.add(chatId);

        try {
          // ── Primary pincode check ──────────────────────────────────────────
          const result = await checkAvailability(user.pincode);
          const products = result.products || [];

          // ── New product detection (once per minute, first successful scrape) ─
          if (!newProductsCheckedThisMinute && products.length > 0) {
            newProductsCheckedThisMinute = true;
            pendingNewProducts = checkForNewProducts(products);
          }

          // ── Tracked keyword checks ─────────────────────────────────────────
          const outAtPrimary = []; // keywords OOS at primary — check secondaries

          for (const entry of tracked) {
            const matches = products.filter((p) =>
              p.name.toLowerCase().includes(entry.keyword)
            );
            const anyInStock = matches.some((p) => p.inStock);
            const wasInStock = entry.lastStatus === "in_stock";

            const cooldownMs = 60 * 60 * 1000; // 1 hour
            const cooldownExpired =
              !entry.notifiedAt ||
              Date.now() - new Date(entry.notifiedAt).getTime() > cooldownMs;

            if (anyInStock && (!wasInStock || cooldownExpired)) {
              await onKeywordFound(
                chatId,
                entry.keyword,
                matches.filter((p) => p.inStock),
                user.pincode
              );
              updateTrackedEntry(chatId, entry.keyword, {
                notifiedAt: new Date().toISOString(),
                lastStatus: "in_stock",
              });
            } else if (!anyInStock) {
              if (wasInStock) {
                updateTrackedEntry(chatId, entry.keyword, {
                  lastStatus: "out_of_stock",
                });
              } else {
                // Still OOS — track for secondary pincode fallback
              }
              outAtPrimary.push(entry.keyword);
            } else {
              // Still in stock within cooldown — silently update
              updateTrackedEntry(chatId, entry.keyword, {
                lastStatus: "in_stock",
              });
            }
          }

          // ── Secondary pincode fallback ─────────────────────────────────────
          const secondaryPincodes = user.secondaryPincodes || [];
          if (outAtPrimary.length > 0 && secondaryPincodes.length > 0) {
            for (const secPin of secondaryPincodes) {
              try {
                const secResult = await checkAvailability(secPin);
                const secProducts = secResult.products || [];

                for (const keyword of outAtPrimary) {
                  const matches = secProducts.filter(
                    (p) => p.name.toLowerCase().includes(keyword) && p.inStock
                  );
                  if (matches.length > 0) {
                    await onKeywordFoundSecondary(
                      chatId,
                      keyword,
                      matches,
                      secPin,
                      user.pincode
                    );
                  }
                }
              } catch (err) {
                console.error(
                  `[Tracker] Secondary pincode ${secPin} error:`,
                  err.message
                );
              }
            }
          }

          // ── Freebie / bundle alert ─────────────────────────────────────────
          if (freebieAlerts) {
            const freebies = products.filter((p) => p.isFreebie && p.inStock);
            if (freebies.length > 0) {
              const cooldownMs = 60 * 60 * 1000;
              const notifiedAt = user.freebieNotifiedAt;
              const cooldownExpired =
                !notifiedAt ||
                Date.now() - new Date(notifiedAt).getTime() > cooldownMs;

              if (cooldownExpired) {
                await onFreebieFound(chatId, freebies, user.pincode);
                updateUserConfig(chatId, {
                  freebieNotifiedAt: new Date().toISOString(),
                });
              }
            }
          }
        } catch (err) {
          console.error(
            `[Tracker] Error checking tracked products for ${chatId}:`,
            err.message
          );
        } finally {
          trackingInProgress.delete(chatId);
        }
      }

      // ── Broadcast new product launches ────────────────────────────────────
      if (pendingNewProducts.length > 0) {
        const allUsers = getAllUsers();
        for (const [chatId, user] of Object.entries(allUsers)) {
          if (user.newProductAlerts !== false) {
            try {
              await onNewProducts(chatId, pendingNewProducts);
            } catch (err) {
              console.error(
                `[Tracker] Error sending new product alert to ${chatId}:`,
                err.message
              );
            }
          }
        }
      }
    },
    { timezone: "UTC" }
  );
}

module.exports = {
  startScheduler,
  reschedule,
  stopScheduler,
  startTrackingScheduler,
};
