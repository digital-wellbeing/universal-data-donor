import { parsePlaystationFile } from './playstationParser';
import path from 'path';

describe('playstationParser', () => {
  it('should parse the Playstation Excel file and extract the correct columns', async () => {
    const filePath = path.resolve(__dirname, '../../tests/sonysample.xlsx');
    const parseResult = await parsePlaystationFile(filePath);

    // Expect the parser to return an object with data and parsingErrors
    expect(parseResult).toHaveProperty('data');
    expect(parseResult).toHaveProperty('parsingErrors');
    expect(parseResult.parsingErrors).toHaveProperty('sheetsNotFound');
    expect(parseResult.parsingErrors).toHaveProperty('tablesNotParsed');

    const parsedData = parseResult.data;

    // We expect the parser to have found and processed some of the sheets
    expect(Object.keys(parsedData).length).toBeGreaterThan(0);

    // Check for specific sheets and their data
    const sheetTests = {
      '"Account Device"': {
        columns: ['Console Id', 'Name', 'Console Type', 'Account Id'],
      },
      '"Gameplay Online"': {
        columns: ['Name', 'Date Of Play', 'Session Duration', 'Total Session'],
      },
      '"No of Friends"': {
        columns: ['Friends in Current Month'],
      },
      '"Ps Stars Collectibles"': {
        columns: ['Collectible Name', 'Rarity', 'Earned Date'],
      },
      '"Ps Stars Enrollments"': {
        columns: ['Enrollment Status'],
      },
      '"Ps Stars Points History"': {
        columns: ['Points', 'Point Type', 'Point Usage', 'Point Expiration Date', 'Transaction Datetime', 'Transaction Id', 'Product Name', 'Campaign Name'],
      },
      '"Transaction Detail"': {
        columns: ['Transaction Date', 'Game Name', 'Product Name', 'Content Type', 'Platform', 'Transaction Id', 'Transaction Type', 'Order Id', 'Order Quantity', 'Final Price', 'Currency Code'],
      },
    };

    for (const sheetName in sheetTests) {
      if (sheetTests.hasOwnProperty(sheetName)) {
        const { columns } = sheetTests[sheetName];
        
        expect(parsedData).toHaveProperty(sheetName);
        expect(Array.isArray(parsedData[sheetName])).toBe(true);

        if (parsedData[sheetName].length > 0) {
          const firstRow = parsedData[sheetName][0];
          expect(firstRow).toHaveProperty('selected', true);
          for (const column of columns) {
            expect(firstRow).toHaveProperty(column);
          }
        }
      }
    }
  });

  it('should track parsing errors correctly', async () => {
    const filePath = path.resolve(__dirname, '../../tests/sonysample.xlsx');
    const parseResult = await parsePlaystationFile(filePath);

    // Verify parsing errors structure
    expect(parseResult.parsingErrors).toHaveProperty('sheetsNotFound');
    expect(parseResult.parsingErrors).toHaveProperty('tablesNotParsed');
    expect(Array.isArray(parseResult.parsingErrors.sheetsNotFound)).toBe(true);
    expect(Array.isArray(parseResult.parsingErrors.tablesNotParsed)).toBe(true);

    // Check that tables not parsed have the correct structure
    parseResult.parsingErrors.tablesNotParsed.forEach(error => {
      expect(error).toHaveProperty('sheetName');
      expect(error).toHaveProperty('reason');
      expect(error).toHaveProperty('expectedColumns');
      expect(typeof error.sheetName).toBe('string');
      expect(typeof error.reason).toBe('string');
    });
  });
});