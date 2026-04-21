/**
 * store.js — Persistent storage for multiple users.
 * Stores map of chatId -> userSettings (pincode, check time, etc.)
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const DEFAULT_USER_SETTINGS = {
  pincode: process.env.DEFAULT_PINCODE || "452009",
  checkTime: process.env.DEFAULT_CHECK_TIME || "09:00",
  lastChecked: null,
  enabled: true,
  freebieAlerts: true,      // Notify when freebie/bundle products come in stock
  newProductAlerts: true,   // Notify when Amul launches brand-new products
  freebieNotifiedAt: null,  // Cooldown tracker for freebie alerts
  secondaryPincodes: [],    // Up to 2 backup pincodes
};

/**
 * Ensure the data directory and users file exist.
 */
function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}

/**
 * Get all users and their settings.
 */
function getAllUsers() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const data = JSON.parse(raw);
    return data.users || {};
  } catch {
    return {};
  }
}

/**
 * Get settings for a specific user.
 */
function getUserConfig(chatId) {
  const users = getAllUsers();
  const idStr = String(chatId);
  
  if (!users[idStr]) {
    // New user — use defaults from .env
    return { 
      ...DEFAULT_USER_SETTINGS,
      pincode: process.env.DEFAULT_PINCODE || "452009",
      checkTime: process.env.DEFAULT_CHECK_TIME || "08:00"
    };
  }
  
  return { ...DEFAULT_USER_SETTINGS, ...users[idStr] };
}

/**
 * Update settings for a specific user.
 */
function updateUserConfig(chatId, updates) {
  const users = getAllUsers();
  const idStr = String(chatId);
  
  const current = users[idStr] || { ...DEFAULT_USER_SETTINGS };
  users[idStr] = { ...current, ...updates };
  
  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  return users[idStr];
}

/**
 * Get list of all chat IDs.
 */
function getChatIds() {
  return Object.keys(getAllUsers());
}

module.exports = { getUserConfig, updateUserConfig, getAllUsers, getChatIds };

// ─── Tracked Products ─────────────────────────────────────────────────────────

/**
 * Add a keyword to a user's tracked products list.
 * Returns false if already tracking this keyword.
 */
function addTrackedProduct(chatId, keyword) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]) users[idStr] = { ...DEFAULT_USER_SETTINGS };
  if (!users[idStr].trackedProducts) users[idStr].trackedProducts = [];

  const kw = keyword.toLowerCase().trim();
  if (users[idStr].trackedProducts.some((p) => p.keyword === kw)) return false;

  users[idStr].trackedProducts.push({
    keyword: kw,
    addedAt: new Date().toISOString(),
    notifiedAt: null,
    lastStatus: "unknown",
  });

  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  return true;
}

/**
 * Remove a keyword from a user's tracked products.
 * Returns false if not found.
 */
function removeTrackedProduct(chatId, keyword) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]?.trackedProducts) return false;

  const kw = keyword.toLowerCase().trim();
  const before = users[idStr].trackedProducts.length;
  users[idStr].trackedProducts = users[idStr].trackedProducts.filter(
    (p) => p.keyword !== kw
  );
  if (users[idStr].trackedProducts.length === before) return false;

  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  return true;
}

/**
 * Remove all tracked products for a user.
 */
function clearAllTracked(chatId) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]) return;
  users[idStr].trackedProducts = [];
  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

/**
 * Update fields on a specific tracked product entry.
 */
function updateTrackedEntry(chatId, keyword, updates) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]?.trackedProducts) return;

  const kw = keyword.toLowerCase().trim();
  const entry = users[idStr].trackedProducts.find((p) => p.keyword === kw);
  if (entry) Object.assign(entry, updates);

  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

// ─── Secondary Pincodes ───────────────────────────────────────────────────────

/**
 * Add a secondary pincode for a user. Max 2 allowed.
 * Returns true if added, false if duplicate, 'limit' if at max.
 */
function addSecondaryPincode(chatId, pincode) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]) users[idStr] = { ...DEFAULT_USER_SETTINGS };
  if (!users[idStr].secondaryPincodes) users[idStr].secondaryPincodes = [];

  if (users[idStr].secondaryPincodes.includes(pincode)) return false;
  if (users[idStr].secondaryPincodes.length >= 2) return "limit";

  users[idStr].secondaryPincodes.push(pincode);
  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  return true;
}

/**
 * Remove a secondary pincode. Returns true if removed, false if not found.
 */
function removeSecondaryPincode(chatId, pincode) {
  const users = getAllUsers();
  const idStr = String(chatId);
  if (!users[idStr]?.secondaryPincodes) return false;

  const before = users[idStr].secondaryPincodes.length;
  users[idStr].secondaryPincodes = users[idStr].secondaryPincodes.filter(
    (p) => p !== pincode
  );
  if (users[idStr].secondaryPincodes.length === before) return false;

  ensureStorage();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  return true;
}

module.exports = {
  getUserConfig,
  updateUserConfig,
  getAllUsers,
  getChatIds,
  addTrackedProduct,
  removeTrackedProduct,
  clearAllTracked,
  updateTrackedEntry,
  addSecondaryPincode,
  removeSecondaryPincode,
};
