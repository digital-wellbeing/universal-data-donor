import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

/**
 * Synthetic PlayStation "Download your data" workbook for tests. It mirrors the
 * structure the parser expects (sheet names with literal quotes, a header row
 * with the real column names, rows below) but holds no real data: real exports
 * contain account, wallet and transaction details, so none is committed.
 */

const SHEETS = {
  '"Account Device"': {
    columns: ['Console Id', 'Name', 'Console Type', 'Account Id'],
    rows: [['console-0001', 'Synthetic Console', 'PS5', 'account-0001']],
  },
  '"Gameplay Online"': {
    columns: ['Name', 'Date Of Play', 'Session Duration', 'Total Session'],
    rows: [
      ['Synthetic Game A', '2025-01-02', '01:30:00', 3],
      ['Synthetic Game B', '2025-01-03', '00:45:00', 1],
    ],
  },
  '"No of Friends"': {
    columns: ['Account Id', 'Friends in Current Month'],
    rows: [['account-0001', 12]],
  },
  '"Ps Stars Collectibles"': {
    columns: ['Collectible Name', 'Rarity', 'Earned Date'],
    rows: [['Synthetic Collectible', 'Common', '2025-01-04']],
  },
  '"Ps Stars Enrollments"': {
    columns: ['Account Id', 'Enrollment Status'],
    rows: [['account-0001', 'Active']],
  },
  '"Ps Stars Points History"': {
    columns: ['Points', 'Point Type', 'Point Usage', 'Point Expiration Date', 'Transaction Datetime', 'Transaction Id', 'Product Name', 'Campaign Name'],
    rows: [[100, 'Earned', 'N/A', '2026-01-01', '2025-01-05 10:00:00', 'txn-0001', 'Synthetic Product', 'Synthetic Campaign']],
  },
  '"Transaction Detail"': {
    columns: ['Transaction Date', 'Game Name', 'Product Name', 'Content Type', 'Platform', 'Transaction Id', 'Transaction Type', 'Order Id', 'Order Quantity', 'Final Price', 'Currency Code'],
    rows: [['2025-01-06', 'Synthetic Game A', 'Synthetic Add-on', 'Add-on', 'PS5', 'txn-0002', 'Purchase', 'order-0001', 1, 9.99, 'EUR']],
  },
};

/** Build the workbook in memory. */
export const buildPlaystationWorkbook = () => {
  const workbook = new ExcelJS.Workbook();
  Object.entries(SHEETS).forEach(([name, { columns, rows }]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(columns);
    rows.forEach((row) => sheet.addRow(row));
  });
  return workbook;
};

/**
 * Write the workbook into `dir` and return its path.
 * @param {string} dir
 * @returns {Promise<string>}
 */
export const writePlaystationFixture = async (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'playstation-synthetic.xlsx');
  await buildPlaystationWorkbook().xlsx.writeFile(filePath);
  return filePath;
};
