/**
 * scraper.js — Amul protein product availability checker.
 *
 * Strategy:
 * 1. Open the Amul protein browse page using Playwright
 * 2. If #locationWidgetModal is already open (site shows it on first visit), use it directly
 *    Otherwise click .pincode_wrap to open it
 * 3. Type pincode into #search, click first suggestion (a.searchitem-name)
 * 4. Wait for the page to reload with pincode-filtered inventory
 * 5. Intercept the API response that returns product JSON (ms.products endpoint)
 *    to get accurate stock data without fragile HTML parsing
 *
 * Confirmed selectors (from live page inspection):
 * - Pincode modal: #locationWidgetModal (may auto-open on first visit)
 * - Pincode input: #search
 * - Pincode suggestions: a.searchitem-name
 * - Products button: a.mobile-btn ("ADD" = in stock, "Notify Me" = out of stock)
 * - Product names: a.lh-sm
 */

require("dotenv").config();
const { chromium } = require("playwright");

const PROTEIN_URL = "https://shop.amul.com/en/browse/protein";
const TIMEOUT = 60000;

// ─── Pincode setup ────────────────────────────────────────────────────────────

/**
 * Set delivery pincode using the modal that appears on the site.
 * Handles both auto-opened modal (first visit) and manual trigger.
 */
async function setPincode(page, pincode) {
  try {
    console.log(`[Scraper] Setting pincode: ${pincode}...`);

    // Wait for either the modal to appear or the pincode trigger
    await page.waitForTimeout(3000);

    // Check if the location modal is already open
    const modalVisible = await page
      .locator("#locationWidgetModal")
      .isVisible()
      .catch(() => false);

    if (!modalVisible) {
      // Try to open it by clicking the pincode trigger
      const trigger = page.locator(".pincode_wrap").first();
      const triggerVisible = await trigger.isVisible().catch(() => false);
      if (triggerVisible) {
        await trigger.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }

    // Now type into the pincode search input
    const searchInput = page.locator("#search").first();
    await searchInput.waitFor({ state: "visible", timeout: 10000 });
    await searchInput.click();
    await searchInput.fill("");
    await searchInput.type(pincode, { delay: 80 });
    console.log(`[Scraper] Typed pincode "${pincode}"`);

    // Wait for location suggestions
    await page
      .waitForSelector("a.searchitem-name", { timeout: 8000 })
      .catch(() => {
        console.warn("[Scraper] No suggestions appeared — pressing Enter");
      });
    await page.waitForTimeout(600);

    // Click the first suggestion
    const firstSuggestion = page.locator("a.searchitem-name").first();
    const suggVisible = await firstSuggestion.isVisible().catch(() => false);
    if (suggVisible) {
      await firstSuggestion.click();
      console.log("[Scraper] Clicked first location suggestion.");
    } else {
      await searchInput.press("Enter");
    }

    // Wait for the pincode to be applied and inventory to load
    await page
      .waitForLoadState("networkidle", { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(4000);
    console.log("[Scraper] Pincode applied.");
  } catch (err) {
    console.warn(`[Scraper] Pincode setup issue: ${err.message}`);
  }
}

// ─── Product extraction ───────────────────────────────────────────────────────

/**
 * Scroll the page to load all products (handles lazy loading).
 */
async function scrollToLoadAll(page) {
  let previousHeight = 0;
  let retries = 0;

  while (retries < 8) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      retries++;
    } else {
      retries = 0;
    }
    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/**
 * Extract product cards from the page.
 * Uses .mobile-btn buttons as anchors to find each product card.
 */
async function extractProducts(page) {
  // Wait for product buttons to appear
  let productsLoaded = false;
  for (const sel of ["a.mobile-btn", ".mobile-btn", "a.lh-sm"]) {
    try {
      await page.waitForSelector(sel, { timeout: 12000 });
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`[Scraper] ${count} product elements found via: ${sel}`);
        productsLoaded = true;
        break;
      }
    } catch {
      // try next selector
    }
  }

  if (!productsLoaded) {
    console.warn("[Scraper] Products not found — page may be blocked.");
    return [];
  }

  // Scroll to load lazy-loaded products
  await scrollToLoadAll(page);
  await page.waitForTimeout(1000);

  // Extract from DOM
  const products = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Strategy: find each product's button, then walk up to the card container
    const allBtns = document.querySelectorAll("a.mobile-btn, button.mobile-btn");

    allBtns.forEach((btn) => {
      // The page has one button per product — "ADD" or "Notify Me"
      const btnText = (btn.textContent || "").trim().toLowerCase();
      const inStock =
        btnText.includes("add") ||
        (!btnText.includes("notify") && !btnText.includes("sold"));

      // Walk up to find the card wrapper
      let card = btn.parentElement;
      let depth = 0;
      let found = false;
      while (card && depth < 10) {
        const nameEl = card.querySelector(
          "a.lh-sm, a.fw-semibold, a[class*='product']"
        );
        if (nameEl) {
          found = true;

          const name = nameEl.textContent?.trim() || "";
          if (!name || name.length < 3) break;

          // Deduplicate
          const key = name.toLowerCase();
          if (seen.has(key)) break;
          seen.add(key);

          const url = nameEl.href || "";

          // Extract price
          const priceEl =
            card.querySelector("[class*='price']") ||
            card.querySelector("[class*='mrp']");
          let price = "N/A";
          if (priceEl) {
            price = priceEl.textContent.trim();
          } else {
            const match = (card.textContent || "").match(
              /MRP\s*₹\s*[\d,]+(\.\d+)?|₹\s*[\d,]+(\.\d+)?/
            );
            if (match) price = match[0];
          }

          // Clean up price text
          price = price.replace(/\s+/g, " ").trim();

          results.push({ name, price, inStock, url, btnText });
          break;
        }
        card = card.parentElement;
        depth++;
      }
    });

    return results;
  });

  console.log(`[Scraper] Extracted ${products.length} products.`);
  return products;
}

// ─── API interception method ──────────────────────────────────────────────────

/**
 * Use Playwright to open the page and intercept the API response
 * that the site itself makes for product data. This is more reliable
 * than HTML parsing since we use the site's own data.
 *
 * @param {string} pincode
 * @returns {Promise<Array>} products
 */
async function fetchViaInterception(page, pincode) {
  let interceptedProducts = null;

  // Set up network interception for the products API
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("ms.products") ||
      url.includes("/api/1/entity/ms.products")
    ) {
      try {
        const json = await response.json();
        if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          console.log(
            `[Scraper] Intercepted API: ${json.data.length} products`
          );
          interceptedProducts = json.data.map((p) => ({
            name: p.name || "Unknown",
            price: p.mrp
              ? `MRP ₹${p.mrp}`
              : p.price
              ? `₹${p.price}`
              : "N/A",
            inStock:
              p.available === true && Number(p.inventory_quantity || 0) >= 0,
            inventoryQty: Number(p.inventory_quantity || 0),
            url: p.alias
              ? `https://shop.amul.com/en/product/${p.alias}`
              : PROTEIN_URL,
          }));
        }
      } catch {
        // Not JSON or error — ignore
      }
    }
  });

  return new Promise((resolve) => {
    // Give the page 5 seconds after pincode is set to fire the API call
    setTimeout(() => resolve(interceptedProducts), 5000);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Check product availability for a given pincode.
 * @param {string} pincode
 * @returns {Promise<{products, scrapedAt, pincode, method, error?}>}
 */
async function checkAvailability(pincode) {
  const scrapedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  console.log(`\n[Scraper] ===== Starting check for pincode: ${pincode} =====`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      extraHTTPHeaders: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });

    const page = await context.newPage();

    // Mask automation fingerprints
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      window.chrome = { runtime: {} };
    });

    // Set up API interception promise BEFORE navigating
    let interceptedProducts = null;
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("ms.products") && url.includes("protein")) {
        try {
          const json = await response.json();
          if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
            console.log(
              `[Scraper] 🎯 Intercepted API response: ${json.data.length} products`
            );
            const FREEBIE_KW = ["free shaker", "gift pack", "gift", "bundle", "combo", "coupon"];
            interceptedProducts = json.data.map((p) => {
              const nameLower = (p.name || "").toLowerCase();
              const tags = Array.isArray(p.tags)
                ? p.tags.map((t) => ((t.title || t) + "").toLowerCase())
                : [];

              // Calculate USP (Price per Unit) manually if not provided
              const priceVal = Number(p.price) || Number(p.mrp) || 0;
              const weightVal = Number(p.metafields?.weight) || 0;
              let finalUsp = Number(p.usp) || 0;
              if (!finalUsp && priceVal > 0 && weightVal > 0) {
                finalUsp = priceVal / weightVal;
              }
              const uom = p.metafields?.uom || "";
              const finalUspLabel = p.usp_label || (finalUsp > 0 ? `₹${finalUsp.toFixed(2)}${uom ? "/" + uom : ""}` : null);

              return {
                name: p.name || "Unknown",
                alias: p.alias || null,
                price: p.mrp
                  ? `MRP ₹${p.mrp}`
                  : p.price
                  ? `₹${p.price}`
                  : "N/A",
                mrpRaw: Number(p.mrp) || null,
                usp: finalUsp || null,
                uspLabel: finalUspLabel || null,
                inStock:
                  p.available === true ||
                  Number(p.inventory_quantity || 0) > 0,
                inventoryQty: Number(p.inventory_quantity || 0),
                url: p.alias
                  ? `https://shop.amul.com/en/product/${p.alias}`
                  : PROTEIN_URL,
                tags,
                isFreebie: FREEBIE_KW.some((kw) => nameLower.includes(kw)),
                isNew: tags.some((t) => t.includes("new")),
                isBestseller: tags.some((t) => t.includes("bestseller")),
              };
            });
          }
        } catch {
          // ignore non-JSON
        }
      }
    });

    console.log("[Scraper] Navigating to protein page...");
    await page.goto(PROTEIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT,
    });

    // Wait for initial load and API calls
    await page.waitForTimeout(5000);

    // Set the pincode
    await setPincode(page, pincode);

    // Wait for the post-pincode API call
    await page.waitForTimeout(5000);

    // Use intercepted API data if available (most reliable)
    if (interceptedProducts && interceptedProducts.length > 0) {
      console.log(
        `[Scraper] Using intercepted API data: ${interceptedProducts.length} products.`
      );
      await browser.close();
      return {
        products: interceptedProducts,
        scrapedAt,
        pincode,
        method: "api-intercepted",
      };
    }

    // Fall back to HTML extraction
    console.log("[Scraper] No API data intercepted — using HTML extraction...");
    const products = await extractProducts(page);

    await browser.close();

    return {
      products,
      scrapedAt,
      pincode,
      method: "html",
    };
  } catch (err) {
    console.error(`[Scraper] Error: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { products: [], scrapedAt, pincode, method: "failed", error: err.message };
  }
}

/**
 * Format results as HTML string for Telegram.
 * Shows USP labels, crowns best-value item, marks freebies and new launches.
 */
function formatReport(result) {
  const { products, scrapedAt, pincode, method, error } = result;

  let msg = `🛒 <b>Amul Protein Stock Report</b>\n`;
  msg += `📍 Pincode: <code>${pincode}</code>\n`;
  msg += `📅 ${scrapedAt} IST\n\n`;

  if (error) {
    msg += `⚠️ <b>Error during check:</b>\n<code>${error}</code>\n\n`;
    msg += `Please check manually:\n<a href="https://shop.amul.com/en/browse/protein">shop.amul.com/en/browse/protein</a>\n`;
    return msg;
  }

  if (products.length === 0) {
    msg += `⚠️ No products found. The website may have changed or blocked the request.\n\n`;
    msg += `Check manually: <a href="https://shop.amul.com/en/browse/protein">shop.amul.com</a>\n`;
    return msg;
  }

  const inStock = products.filter((p) => p.inStock);
  const outOfStock = products.filter((p) => !p.inStock);

  // Find the best-value in-stock item (lowest USP)
  const withUsp = inStock.filter((p) => p.usp && p.usp > 0);
  const bestValue =
    withUsp.length > 0
      ? withUsp.reduce((best, p) => (p.usp < best.usp ? p : best), withUsp[0])
      : null;

  if (inStock.length > 0) {
    msg += `✅ <b>Available (${inStock.length})</b>\n`;
    inStock.forEach((p) => {
      const isBest = bestValue && p.name === bestValue.name;
      const prefix = isBest ? "👑" : "•";
      let line = `  ${prefix} `;
      if (p.isFreebie) line += "🎁 ";
      if (p.isNew) line += "🆕 ";
      line += p.name;
      if (p.price && p.price !== "N/A") line += ` — ${p.price}`;
      if (p.uspLabel) line += ` <i>(${p.uspLabel})</i>`;
      if (p.inventoryQty && p.inventoryQty > 0)
        line += ` (${p.inventoryQty} left)`;
      msg += line + "\n";
    });
    if (bestValue && bestValue.uspLabel) {
      msg += `\n👑 <b>Best Value:</b> ${bestValue.name} at ${bestValue.uspLabel}\n`;
    }
    msg += "\n";
  }

  if (outOfStock.length > 0) {
    msg += `❌ <b>Out of Stock (${outOfStock.length})</b>\n`;
    outOfStock.forEach((p) => {
      let line = `  • `;
      if (p.isFreebie) line += "🎁 ";
      line += p.name;
      if (p.price && p.price !== "N/A") line += ` — ${p.price}`;
      msg += line + "\n";
    });
    msg += "\n";
  }

  msg += `📊 <b>Summary:</b> ${inStock.length} available, ${outOfStock.length} out of stock\n`;
  msg += `🔗 <a href="https://shop.amul.com/en/browse/protein">View on Amul Shop</a>`;

  return msg;
}

// ── Direct execution ──────────────────────────────────────────────────────────
if (require.main === module) {
  const pincode = process.argv[2] || process.env.DEFAULT_PINCODE || "400001";
  checkAvailability(pincode).then((result) => {
    console.log("\n" + "=".repeat(60));
    const clean = formatReport(result).replace(/<[^>]+>/g, "");
    console.log(clean);
    if (result.products.length > 0) {
      console.log("\nRaw product data:");
      result.products.forEach((p) =>
        console.log(
          `  ${p.inStock ? "✓" : "✗"} ${p.name} | ${p.price} | qty: ${p.inventoryQty ?? "N/A"}`
        )
      );
    }
    console.log("=".repeat(60));
    process.exit(0);
  });
}

module.exports = { checkAvailability, formatReport };
