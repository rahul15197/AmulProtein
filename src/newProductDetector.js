/**
 * newProductDetector.js — Detects genuinely new Amul protein products.
 *
 * Strategy:
 * - Maintains a persistent list of all product aliases seen before.
 * - On first run, seeds the known list without alerting (initialised: false → true).
 * - On subsequent runs, any alias NOT in the known list is a new product.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const KNOWN_FILE = path.join(DATA_DIR, "knownProducts.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KNOWN_FILE)) {
    fs.writeFileSync(
      KNOWN_FILE,
      JSON.stringify({ aliases: [], initialised: false }, null, 2)
    );
  }
}

function loadKnown() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(KNOWN_FILE, "utf8"));
  } catch {
    return { aliases: [], initialised: false };
  }
}

/**
 * Compare products against the known list.
 * On first call, seeds the list and returns [] (no alerts).
 * On subsequent calls, returns products that are truly new.
 * Always updates the known list with all current products.
 *
 * @param {Array} products - Array of product objects with .alias field.
 * @returns {Array} Newly seen products (empty on first run).
 */
function checkForNewProducts(products) {
  const data = loadKnown();
  const known = new Set(data.aliases || []);
  const isFirstRun = !data.initialised;

  const newProducts = [];
  if (!isFirstRun) {
    for (const p of products) {
      if (p.alias && !known.has(p.alias)) {
        newProducts.push(p);
      }
    }
  }

  // Update the known list with all current aliases
  const allAliases = products.filter((p) => p.alias).map((p) => p.alias);
  const updated = [...new Set([...known, ...allAliases])];

  ensureFile();
  fs.writeFileSync(
    KNOWN_FILE,
    JSON.stringify({ aliases: updated, initialised: true }, null, 2)
  );

  if (isFirstRun) {
    console.log(
      `[NewProduct] First run — seeded ${updated.length} known products.`
    );
  } else if (newProducts.length > 0) {
    console.log(
      `[NewProduct] Detected ${newProducts.length} new product(s): ${newProducts.map((p) => p.name).join(", ")}`
    );
  }

  return newProducts;
}

module.exports = { checkForNewProducts };
