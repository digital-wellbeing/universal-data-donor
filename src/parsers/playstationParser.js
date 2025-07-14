import ExcelJS from 'exceljs';

const SHEETS_TO_PARSE = [
  '"Account Device"',
  '"Gameplay Online"',
  '"No of Friends"',
  '"PS Now"',
  '"Ps Stars Campaigns"',
  '"Ps Stars Collectibles"',
  '"Ps Stars Enrollments"',
  '"Ps Stars Points History"',
  '"PS VR"',
  '"Subscription"',
  '"Transaction Detail"'
];

const COLUMN_CONFIG = {
  '"Account Device"': ['Console Id', 'Name', 'Console Type', 'Account Id'],
  '"Gameplay Online"': ['Name', 'Date Of Play', 'Session Duration', 'Total Session'],
  '"No of Friends"': ['Friends in Current Month'],
  '"Ps Stars Campaigns"': ['Campaign Name', 'Status', 'Registration Date', 'Completion Date'],
  '"Ps Stars Collectibles"': ['Collectible Name', 'Rarity', 'Earned Date'],
  '"Ps Stars Enrollments"': ['Enrollment Status'],
  '"Ps Stars Points History"': ['Points', 'Point Type', 'Point Usage', 'Point Expiration Date', 'Transaction Datetime', 'Transaction Id', 'Product Name', 'Campaign Name'],
  '"Transaction Detail"': ['Transaction Date', 'Game Name', 'Product Name', 'Content Type', 'Platform', 'Transaction Id', 'Transaction Type', 'Order Id', 'Order Quantity', 'Final Price', 'Currency Code']
};

const findSheet = (workbook, sheetName) => {
  const sheet = workbook.getWorksheet(sheetName);
  if (sheet) {
    return sheet;
  }
  const foundSheet = workbook.worksheets.find(worksheet => worksheet.name.trim().toLowerCase() === sheetName.trim().toLowerCase());
  return foundSheet;
}

// Helper function to check if a row looks like a table header
const isLikelyTableHeader = (rowValues) => {
  if (!rowValues || rowValues.length < 2) return false;
  
  // Filter out empty values and get non-empty cells
  const nonEmptyValues = rowValues.filter(v => v && v.toString().trim() !== '');
  
  // Must have at least 2 non-empty values to be considered a header
  if (nonEmptyValues.length < 2) return false;
  
  // Check if values look like column headers (short, descriptive text)
  const likelyHeaders = nonEmptyValues.filter(v => {
    const str = v.toString().trim();
    // Headers are typically short (< 50 chars) and don't contain long sentences
    return str.length > 0 && str.length < 50 && !str.includes('If data is found') && !str.includes('the below table shows');
  });
  
  // At least 70% of non-empty values should look like headers
  return likelyHeaders.length >= Math.max(2, Math.floor(nonEmptyValues.length * 0.7));
};

// Helper function to check if there's actual tabular data after a potential header row
const hasTabularDataAfterRow = (worksheet, headerRowIndex) => {
  let dataRowsFound = 0;
  let totalRowsChecked = 0;
  const maxRowsToCheck = 10; // Check up to 10 rows after the header
  
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex && totalRowsChecked < maxRowsToCheck) {
      totalRowsChecked++;
      const rowValues = row.values.map(v => (v && v.richText ? v.richText.map(t => t.text).join('') : v) || '');
      const nonEmptyValues = rowValues.filter(v => v && v.toString().trim() !== '');
      
      // If we find a row with multiple non-empty values, it's likely data
      if (nonEmptyValues.length >= 2) {
        dataRowsFound++;
      }
    }
  });
  
  // Consider it tabular data if we found at least 1 data row
  return dataRowsFound > 0;
};

const processSheetWithColumns = (worksheet, columnsToExtract) => {
  if (!worksheet) {
    return [];
  }

  const jsonData = [];
  let headerRowIndex = -1;
  const headerMapping = {};

  // Find header row and mapping
  worksheet.eachRow((row, rowNumber) => {
    const rowValues = row.values.map(v => (v && v.richText ? v.richText.map(t => t.text).join('') : v) || '');
    if (headerRowIndex === -1) {
      let foundHeaders = 0;
      for (const col of columnsToExtract) {
        const colIndex = rowValues.findIndex(header => header && typeof header === 'string' && header.trim() === col.trim());
        if (colIndex !== -1) {
          headerMapping[col] = colIndex;
          foundHeaders++;
        }
      }
      if (foundHeaders / columnsToExtract.length > 0.5) { // If more than half of the headers are found, consider it the header row
        headerRowIndex = rowNumber;
      }
    }
  });

  if (headerRowIndex === -1) {
    console.warn(`Could not find header row for sheet ${worksheet.name}`);
    return [];
  }

  // Process data rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex) {
      const rowData = {};
      let hasValue = false;
      for (const col of columnsToExtract) {
        const colIndex = headerMapping[col];
        if (colIndex !== undefined) {
          const cellValue = row.values[colIndex];
          rowData[col] = cellValue;
          if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
            hasValue = true;
          }
        }
      }
      if (hasValue) {
        rowData.selected = true;
        jsonData.push(rowData);
      }
    }
  });

  return jsonData;
};

const processSheetWithAllColumns = (worksheet) => {
  if (!worksheet) {
    return [];
  }

  const jsonData = [];
  let headers = [];
  let headerRowIndex = -1;

  // Find header row with improved logic
  worksheet.eachRow((row, rowNumber) => {
    if (headerRowIndex === -1) {
      const rowValues = row.values.map(v => (v && v.richText ? v.richText.map(t => t.text).join('') : v) || '');
      
      // Check if this row looks like a table header
      if (isLikelyTableHeader(rowValues)) {
        // Check if there's actual tabular data after this row
        if (hasTabularDataAfterRow(worksheet, rowNumber)) {
          headerRowIndex = rowNumber;
          headers = rowValues;
        }
      }
    }
  });

  // If no proper table structure found, return empty array
  if (headerRowIndex === -1) {
    console.warn(`No table structure found for sheet ${worksheet.name}`);
    return [];
  }

  // Process data rows
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > headerRowIndex) {
      const rowData = {};
      let hasValue = false;
      
      row.values.forEach((value, index) => {
        if (headers[index] && headers[index].toString().trim() !== '') {
          rowData[headers[index]] = value;
          if (value !== null && value !== undefined && value !== '') {
            hasValue = true;
          }
        }
      });
      
      if (hasValue) {
        rowData.selected = true;
        jsonData.push(rowData);
      }
    }
  });

  return jsonData;
};


const parseWorkbook = async (workbook) => {
  const parsedData = {};
  const parsingErrors = {
    sheetsNotFound: [],
    tablesNotParsed: []
  };

  for (const sheetName of SHEETS_TO_PARSE) {
    const worksheet = findSheet(workbook, sheetName);
    const columns = COLUMN_CONFIG[sheetName];

    if (worksheet) {
      if (columns) {
        const result = processSheetWithColumns(worksheet, columns);
        parsedData[sheetName] = result;
        
        // Check if parsing failed (empty result due to no header row found)
        if (result.length === 0) {
          // Check if the sheet actually has data but couldn't be parsed
          let hasAnyData = false;
          worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 20) { // Check first 20 rows for any data
              const rowValues = row.values.filter(v => v && v.toString().trim() !== '');
              if (rowValues.length > 0) {
                hasAnyData = true;
              }
            }
          });
          
          if (hasAnyData) {
            parsingErrors.tablesNotParsed.push({
              sheetName: sheetName,
              reason: 'Could not find expected header row',
              expectedColumns: columns
            });
          }
        }
      } else {
        const result = processSheetWithAllColumns(worksheet);
        parsedData[sheetName] = result;
        
        // Check if parsing failed (empty result due to no table structure found)
        if (result.length === 0) {
          // Check if the sheet actually has data but couldn't be parsed
          let hasAnyData = false;
          worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= 20) { // Check first 20 rows for any data
              const rowValues = row.values.filter(v => v && v.toString().trim() !== '');
              if (rowValues.length > 0) {
                hasAnyData = true;
              }
            }
          });
          
          if (hasAnyData) {
            parsingErrors.tablesNotParsed.push({
              sheetName: sheetName,
              reason: 'No table structure found',
              expectedColumns: null
            });
          }
        }
      }
    } else {
      console.warn(`Sheet "${sheetName}" not found.`);
      parsedData[sheetName] = [];
      parsingErrors.sheetsNotFound.push(sheetName);
    }
  }
  
  return {
    data: parsedData,
    parsingErrors: parsingErrors
  };
};

export const parsePlaystationFile = (fileOrPath) => {
  return new Promise(async (resolve, reject) => {
    const workbook = new ExcelJS.Workbook();
    try {
      if (typeof fileOrPath === 'string') {
        await workbook.xlsx.readFile(fileOrPath);
        resolve(parseWorkbook(workbook));
      } else {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const buffer = e.target.result;
            await workbook.xlsx.load(buffer);
            resolve(parseWorkbook(workbook));
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = (error) => {
          reject(error);
        };
        reader.readAsArrayBuffer(fileOrPath);
      }
    } catch (error) {
      reject(error);
    }
  });
};

export const filterData = (parsedData, filters) => {
  const filteredData = {};
  for (const sheetName in parsedData) {
    if (filters[sheetName]) {
      filteredData[sheetName] = parsedData[sheetName].filter(row => {
        // Implement filtering logic based on filters
        // This is a placeholder
        return true;
      });
    }
  }
  return filteredData;
};