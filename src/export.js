/**
 * export.js — Excel report generator for users.
 */

const ExcelJS = require("exceljs");
const { getAllUsers } = require("./store");

/**
 * Generate an Excel file buffer containing all users and their configuration.
 * @returns {Promise<Buffer>} The file buffer
 */
async function generateUserReport() {
  const users = getAllUsers();
  
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amul Protein Bot";
  workbook.lastModifiedBy = "Amul Protein Bot";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Users");

  // Define columns
  sheet.columns = [
    { header: "Chat ID", key: "chatId", width: 15 },
    { header: "Primary Pincode", key: "pincode", width: 15 },
    { header: "Secondary Pincodes", key: "secondaryPincodes", width: 25 },
    { header: "Check Time (IST)", key: "checkTime", width: 18 },
    { header: "Report ON", key: "enabled", width: 12 },
    { header: "Freebie Alerts", key: "freebieAlerts", width: 15 },
    { header: "New Product Alerts", key: "newProductAlerts", width: 18 },
    { header: "Tracked Products", key: "trackedProducts", width: 45 },
    { header: "Last Checked", key: "lastChecked", width: 20 },
  ];

  // Style the header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };

  // Add data rows
  for (const [chatId, config] of Object.entries(users)) {
    const trackedList = (config.trackedProducts || [])
      .map((p) => p.keyword)
      .join(", ");
    
    const secondaryStr = (config.secondaryPincodes || []).join(", ");
    
    let lastCheckedStr = "Never";
    if (config.lastChecked) {
      lastCheckedStr = new Date(config.lastChecked).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "short",
        timeStyle: "short",
      });
    }

    sheet.addRow({
      chatId: chatId,
      pincode: config.pincode,
      secondaryPincodes: secondaryStr,
      checkTime: config.checkTime,
      enabled: config.enabled ? "Yes" : "No",
      freebieAlerts: config.freebieAlerts !== false ? "Yes" : "No",
      newProductAlerts: config.newProductAlerts !== false ? "Yes" : "No",
      trackedProducts: trackedList,
      lastChecked: lastCheckedStr,
    });
  }

  // Freeze the top row
  sheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  // Return generated buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = { generateUserReport };
