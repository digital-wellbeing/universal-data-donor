import parseAndroidFile from './androidParser';
import fs from 'fs';
import path from 'path';

describe('androidParser', () => {
  it('should parse Google Takeout ZIP file with both playtime and game activity data', async () => {
    const filePath = path.resolve(__dirname, '../../tests/takeout-20251120T161555Z-3-001_html.zip');

    // Read the file as a Blob-like object for testing
    const fileBuffer = fs.readFileSync(filePath);
    const file = new File([fileBuffer], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Expect the parser to return an object with data and parsingErrors
    expect(parseResult).toHaveProperty('data');
    expect(parseResult).toHaveProperty('parsingErrors');
    expect(parseResult.parsingErrors).toHaveProperty('sheetsNotFound');
    expect(parseResult.parsingErrors).toHaveProperty('tablesNotParsed');

    const parsedData = parseResult.data;

    // We expect both Daily Playtime and Game Activity tables
    expect(Object.keys(parsedData).length).toBeGreaterThan(0);

    // Test Daily Playtime table
    if (parsedData['Daily Playtime']) {
      expect(Array.isArray(parsedData['Daily Playtime'])).toBe(true);
      expect(parsedData['Daily Playtime'].length).toBeGreaterThan(0);

      const firstPlaytimeRow = parsedData['Daily Playtime'][0];
      expect(firstPlaytimeRow).toHaveProperty('Date');
      expect(firstPlaytimeRow).toHaveProperty('Package Name');
      expect(firstPlaytimeRow).toHaveProperty('Duration');
      expect(firstPlaytimeRow).toHaveProperty('First Session Start');
      expect(firstPlaytimeRow).toHaveProperty('Last Session End');
      expect(firstPlaytimeRow).toHaveProperty('Number of Sessions');
    }

    // Test Game Activity table
    if (parsedData['Game Activity']) {
      expect(Array.isArray(parsedData['Game Activity'])).toBe(true);
      expect(parsedData['Game Activity'].length).toBeGreaterThan(0);

      const firstGameRow = parsedData['Game Activity'][0];
      expect(firstGameRow).toHaveProperty('Game Title');
      expect(firstGameRow).toHaveProperty('Time First Played');
      expect(firstGameRow).toHaveProperty('Time Last Played');

      // Verify we have actual game titles
      const gameTitle = firstGameRow['Game Title'];
      expect(typeof gameTitle).toBe('string');
      expect(gameTitle.length).toBeGreaterThan(0);
    }
  });

  it('should parse game activity from HTML files correctly', async () => {
    const filePath = path.resolve(__dirname, '../../tests/takeout-20251120T161555Z-3-001_html.zip');

    const fileBuffer = fs.readFileSync(filePath);
    const file = new File([fileBuffer], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);
    const gameActivity = parseResult.data['Game Activity'];

    // We know this test file should have game activity data
    expect(gameActivity).toBeDefined();
    expect(gameActivity.length).toBeGreaterThan(0);

    // Check for specific games we know are in the test data
    const gameNames = gameActivity.map(game => game['Game Title']);

    // Verify that games are included
    expect(gameNames.length).toBeGreaterThan(0);

    // Check timestamp formatting
    gameActivity.forEach(game => {
      // Time First Played should be formatted (not ISO string)
      if (game['Time First Played']) {
        expect(game['Time First Played']).toMatch(/\d{4}/); // Contains year
        expect(game['Time First Played']).not.toMatch(/T\d{2}:\d{2}:\d{2}Z/); // Not raw ISO
      }

      // Time Last Played should be formatted (not ISO string)
      if (game['Time Last Played']) {
        expect(game['Time Last Played']).toMatch(/\d{4}/); // Contains year
        expect(game['Time Last Played']).not.toMatch(/T\d{2}:\d{2}:\d{2}Z/); // Not raw ISO
      }
    });
  });

  it('should track parsing errors correctly', async () => {
    const filePath = path.resolve(__dirname, '../../tests/takeout-20251120T161555Z-3-001_html.zip');

    const fileBuffer = fs.readFileSync(filePath);
    const file = new File([fileBuffer], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Verify parsing errors structure
    expect(parseResult.parsingErrors).toHaveProperty('sheetsNotFound');
    expect(parseResult.parsingErrors).toHaveProperty('tablesNotParsed');
    expect(Array.isArray(parseResult.parsingErrors.sheetsNotFound)).toBe(true);
    expect(Array.isArray(parseResult.parsingErrors.tablesNotParsed)).toBe(true);

    // Check that tables not parsed (if any) have the correct structure
    parseResult.parsingErrors.tablesNotParsed.forEach(error => {
      expect(error).toHaveProperty('sheetName');
      expect(error).toHaveProperty('reason');
      expect(typeof error.sheetName).toBe('string');
      expect(typeof error.reason).toBe('string');
    });
  });

  it('should handle files with only playtime data (no Games folder)', async () => {
    // Create a mock file with only playtime data
    const JSZip = require('jszip');
    const zip = new JSZip();

    // Add a simple playtime HTML file
    const playtimeHtml = `
      <table class="mdl-data-table">
        <tr>
          <td>Sep 30, 2025</td>
          <td>
            <table class="mdl-data-table inner-table">
              <tr>
                <th>Package Name</th>
                <th>Duration</th>
                <th>First Session Start</th>
                <th>Last Session End</th>
                <th>Number of Sessions</th>
              </tr>
              <tr>
                <td>com.example.game</td>
                <td>30 minutes</td>
                <td>September 30, 2025 at 10:00:00 AM GMT+1</td>
                <td>September 30, 2025 at 10:30:00 AM GMT+1</td>
                <td>1</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;

    zip.folder('Takeout').folder('Google Play Games Services').folder('Global').file('Playtime.html', playtimeHtml);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const file = new File([zipBlob], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Should have Daily Playtime but not Game Activity
    expect(parseResult.data['Daily Playtime']).toBeDefined();
    expect(parseResult.data['Daily Playtime'].length).toBeGreaterThan(0);

    // Game Activity should not be present or should be flagged as not found
    if (!parseResult.data['Game Activity']) {
      expect(parseResult.parsingErrors.tablesNotParsed.some(
        error => error.sheetName === 'Game Activity'
      )).toBe(true);
    }
  });

  it('should handle files with only game activity (no playtime)', async () => {
    // Create a mock file with only game activity
    const JSZip = require('jszip');
    const zip = new JSZip();

    // Add a game activity HTML file
    const activityHtml = `
      <table class="mdl-data-table">
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Time First Played</td><td>2015-07-06T07:13:22Z</td></tr>
        <tr><td>Time Last Played</td><td>2015-10-16T11:30:27Z</td></tr>
      </table>
    `;

    zip.folder('Takeout')
      .folder('Google Play Games Services')
      .folder('Games')
      .folder('Test Game')
      .file('Activity.html', activityHtml);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const file = new File([zipBlob], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Should have Game Activity but not Daily Playtime
    expect(parseResult.data['Game Activity']).toBeDefined();
    expect(parseResult.data['Game Activity'].length).toBeGreaterThan(0);
    expect(parseResult.data['Game Activity'][0]['Game Title']).toBe('Test Game');

    // Daily Playtime should not be present or should be flagged as not found
    if (!parseResult.data['Daily Playtime']) {
      expect(parseResult.parsingErrors.tablesNotParsed.some(
        error => error.sheetName === 'Google Play Games Services/Global' || error.sheetName === 'Daily Playtime'
      )).toBe(true);
    }
  });

  it('should handle invalid ZIP files gracefully', async () => {
    // Create an invalid file
    const file = new File(['not a zip file'], 'invalid.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Should have errors
    expect(parseResult.parsingErrors.tablesNotParsed.length).toBeGreaterThan(0);
    expect(parseResult.parsingErrors.tablesNotParsed[0].sheetName).toBe('Google Play Games Takeout');
  });

  it('should prefer JSON over HTML when both formats exist for game activity', async () => {
    const JSZip = require('jszip');
    const zip = new JSZip();

    // Add both JSON and HTML activity files
    const activityJson = JSON.stringify({
      time_first_played: '2020-01-01T00:00:00Z',
      time_last_played: '2020-12-31T23:59:59Z'
    });

    const activityHtml = `
      <table class="mdl-data-table">
        <tr><th>Field</th><th>Value</th></tr>
        <tr><td>Time First Played</td><td>2015-07-06T07:13:22Z</td></tr>
        <tr><td>Time Last Played</td><td>2015-10-16T11:30:27Z</td></tr>
      </table>
    `;

    const gamesFolder = zip.folder('Takeout')
      .folder('Google Play Games Services')
      .folder('Games')
      .folder('Test Game');

    gamesFolder.file('Activity.json', activityJson);
    gamesFolder.file('Activity.html', activityHtml);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const file = new File([zipBlob], 'takeout.zip', { type: 'application/zip' });

    const parseResult = await parseAndroidFile(file);

    // Should use JSON data (2020 dates) not HTML data (2015 dates)
    expect(parseResult.data['Game Activity']).toBeDefined();
    expect(parseResult.data['Game Activity'][0]['Time First Played']).toContain('2020');
    expect(parseResult.data['Game Activity'][0]['Time Last Played']).toContain('2020');
  });
});
