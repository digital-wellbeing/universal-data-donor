import JSZip from 'jszip';

// Expected path in Google Takeout
const PLAYTIME_PATH_JSON = 'Takeout/Google Play Games Services/Global/Playtime.json';
const PLAYTIME_PATH_HTML = 'Takeout/Google Play Games Services/Global/Playtime.html';

/**
 * Format duration from seconds and nanoseconds to readable string
 * @param {number} seconds - Duration in seconds
 * @param {number} nanos - Additional nanoseconds
 * @returns {string} Formatted duration (e.g., "20 minutes 21 seconds")
 */
const formatDuration = (seconds, nanos = 0) => {
  const totalSeconds = Math.floor(seconds + (nanos / 1000000000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);

  return parts.join(' ');
};

/**
 * Format timestamp in milliseconds to readable date string
 * @param {number} timestampMillis - Timestamp in milliseconds since epoch
 * @returns {string} Formatted date string
 */
const formatTimestamp = (timestampMillis) => {
  if (!timestampMillis) return '';

  const date = new Date(timestampMillis);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });
};

/**
 * Format date object to readable string
 * @param {Object} dateObj - Object with month, day, year properties
 * @returns {string} Formatted date (e.g., "Sep 30, 2025")
 */
const formatDate = (dateObj) => {
  if (!dateObj) return '';

  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  return `${monthNames[dateObj.month - 1]} ${dateObj.day}, ${dateObj.year}`;
};

/**
 * Format ISO 8601 timestamp to readable string
 * @param {string} isoString - ISO 8601 timestamp (e.g., "2015-07-06T07:13:22Z")
 * @returns {string} Formatted timestamp
 */
const formatISOTimestamp = (isoString) => {
  if (!isoString) return '';

  try {
    const date = new Date(isoString);
    // Check if date is valid
    if (isNaN(date.getTime())) return '';

    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  } catch (error) {
    return '';
  }
};

/**
 * Parse Activity.json for a single game
 * @param {string} jsonContent - JSON file content
 * @returns {Object} Activity data { timeFirstPlayed, timeLastPlayed }
 */
const parseActivityJson = (jsonContent) => {
  try {
    const data = JSON.parse(jsonContent);
    return {
      timeFirstPlayed: data.time_first_played ? formatISOTimestamp(data.time_first_played) : '',
      timeLastPlayed: data.time_last_played ? formatISOTimestamp(data.time_last_played) : ''
    };
  } catch (error) {
    return { timeFirstPlayed: '', timeLastPlayed: '' };
  }
};

/**
 * Parse Activity.html for a single game
 * @param {string} htmlContent - HTML file content
 * @returns {Object} Activity data { timeFirstPlayed, timeLastPlayed }
 */
const parseActivityHtml = (htmlContent) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  const table = doc.querySelector('table.mdl-data-table');

  let timeFirstPlayed = '';
  let timeLastPlayed = '';

  if (table) {
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        const field = cells[0].textContent.trim();
        const value = cells[1].textContent.trim();

        if (field === 'Time First Played') {
          timeFirstPlayed = formatISOTimestamp(value);
        } else if (field === 'Time Last Played') {
          timeLastPlayed = formatISOTimestamp(value);
        }
      }
    });
  }

  return { timeFirstPlayed, timeLastPlayed };
};

/**
 * Crawl all games in Games folder and extract activity data
 * @param {JSZip} zip - JSZip instance
 * @returns {Promise<Array>} Array of game activity records
 */
const parseGameActivities = async (zip) => {
  const gameActivities = [];
  const files = Object.keys(zip.files);

  // Find all game folders - look for Activity.html or Activity.json files
  // Pattern: Takeout/Google Play Games Services/Games/{GameTitle}/Activity.{html|json}
  const gamesPattern = /Takeout\/Google Play Games Services\/Games\/([^/]+)\/(Activity\.(html|json))$/i;

  // Group files by game to prefer JSON over HTML
  const gameFilesMap = new Map();

  files.forEach(filePath => {
    const match = filePath.match(gamesPattern);
    if (match) {
      const gameTitle = match[1];
      const fileExtension = match[3];

      if (!gameFilesMap.has(gameTitle)) {
        gameFilesMap.set(gameTitle, { path: filePath, extension: fileExtension });
      } else {
        // Prefer JSON over HTML
        const existing = gameFilesMap.get(gameTitle);
        if (fileExtension === 'json' && existing.extension === 'html') {
          gameFilesMap.set(gameTitle, { path: filePath, extension: fileExtension });
        }
      }
    }
  });

  // Parse each game's activity data
  for (const [gameTitle, fileInfo] of gameFilesMap) {
    try {
      const file = zip.file(fileInfo.path);
      if (!file) continue;

      const content = await file.async('string');

      let activityData;
      if (fileInfo.extension === 'html') {
        activityData = parseActivityHtml(content);
      } else {
        activityData = parseActivityJson(content);
      }

      // Only add if we got valid data
      if (activityData.timeFirstPlayed || activityData.timeLastPlayed) {
        gameActivities.push({
          'Game Title': gameTitle,
          'Time First Played': activityData.timeFirstPlayed,
          'Time Last Played': activityData.timeLastPlayed
        });
      }
    } catch (error) {
      // Log warning but continue processing other games
      console.warn(`Failed to parse activity for game ${gameTitle}:`, error);
    }
  }

  return gameActivities;
};

/**
 * Parse JSON format playtime file
 * @param {string} jsonContent - JSON file content
 * @returns {Array} Array of playtime records
 */
const parseJsonFormat = (jsonContent) => {
  const data = JSON.parse(jsonContent);
  const rows = [];

  if (!data.daily_playtimes || !Array.isArray(data.daily_playtimes)) {
    return rows;
  }

  data.daily_playtimes.forEach(dailyEntry => {
    const date = formatDate(dailyEntry.user_date);

    if (dailyEntry.fragments && Array.isArray(dailyEntry.fragments)) {
      dailyEntry.fragments.forEach(fragment => {
        rows.push({
          'Date': date,
          'Package Name': fragment.package_name || '',
          'Duration': formatDuration(
            fragment.play_duration?.seconds || 0,
            fragment.play_duration?.nanos || 0
          ),
          'First Session Start': formatTimestamp(fragment.start_time_millis),
          'Last Session End': formatTimestamp(fragment.last_session_end_time_millis),
          'Number of Sessions': fragment.num_sessions !== undefined ? fragment.num_sessions : ''
        });
      });
    }
  });

  return rows;
};

/**
 * Parse HTML format playtime file
 * @param {string} htmlContent - HTML file content
 * @returns {Array} Array of playtime records
 */
const parseHtmlFormat = (htmlContent) => {
  const rows = [];

  // Create a temporary DOM parser
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // Find all outer table rows (dates)
  const outerTable = doc.querySelector('table.mdl-data-table');
  if (!outerTable) {
    return rows;
  }

  const outerRows = outerTable.querySelectorAll('tr');

  outerRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) return;

    const date = cells[0].textContent.trim();
    const innerTableCell = cells[1];

    // Find inner table with game details
    const innerTable = innerTableCell.querySelector('table.mdl-data-table.inner-table');
    if (!innerTable) return;

    const innerRows = innerTable.querySelectorAll('tr');

    // Skip header row
    for (let i = 1; i < innerRows.length; i++) {
      const innerCells = innerRows[i].querySelectorAll('td');
      if (innerCells.length >= 5) {
        rows.push({
          'Date': date,
          'Package Name': innerCells[0].textContent.trim(),
          'Duration': innerCells[1].textContent.trim(),
          'First Session Start': innerCells[2].textContent.trim(),
          'Last Session End': innerCells[3].textContent.trim(),
          'Number of Sessions': innerCells[4].textContent.trim()
        });
      }
    }
  });

  return rows;
};

/**
 * Find a file in the ZIP archive, case-insensitive
 * @param {JSZip} zip - JSZip instance
 * @param {string} targetPath - Target file path
 * @returns {JSZip.JSZipObject|null} Found file or null
 */
const findFileInZip = (zip, targetPath) => {
  const targetPathLower = targetPath.toLowerCase();

  // Extract the expected extension from targetPath
  const targetExtension = targetPath.toLowerCase().split('.').pop();

  // Try exact match first
  if (zip.file(targetPath)) {
    return zip.file(targetPath);
  }

  // Try case-insensitive match
  const files = Object.keys(zip.files);
  for (const fileName of files) {
    if (fileName.toLowerCase() === targetPathLower) {
      return zip.file(fileName);
    }
  }

  // Try to find by partial path (handle different folder nesting)
  // IMPORTANT: Also check the file extension to avoid returning wrong format
  for (const fileName of files) {
    const fileNameLower = fileName.toLowerCase();
    if (fileNameLower.includes('google play games services/global/playtime') &&
        fileNameLower.endsWith(`.${targetExtension}`)) {
      return zip.file(fileName);
    }
  }

  return null;
};

/**
 * Main parser function for Google Play Games Services data
 * @param {File} file - Uploaded ZIP file
 * @returns {Promise<Object>} Parsed data with structure: { data: {...}, parsingErrors: {...} }
 */
export default async function parseAndroidFile(file) {
  const data = {};
  const parsingErrors = {
    sheetsNotFound: [],
    tablesNotParsed: []
  };

  try {
    // Load ZIP file
    const zip = await JSZip.loadAsync(file);

    // Parse Daily Playtime (independent section)
    try {
      // Try to find Playtime file (JSON first, then HTML)
      let playtimeFile = findFileInZip(zip, PLAYTIME_PATH_JSON);
      let isJsonFormat = true;

      if (!playtimeFile) {
        playtimeFile = findFileInZip(zip, PLAYTIME_PATH_HTML);
        isJsonFormat = false;
      }

      if (!playtimeFile) {
        parsingErrors.sheetsNotFound.push('Playtime.json', 'Playtime.html');
        parsingErrors.tablesNotParsed.push({
          sheetName: 'Google Play Games Services/Global',
          reason: 'Could not find Playtime.json or Playtime.html in the expected location',
          expectedPath: 'Takeout/Google Play Games Services/Global/'
        });
      } else {
        // Extract file content
        const content = await playtimeFile.async('string');

        // Parse based on format
        let rows = [];
        try {
          if (isJsonFormat) {
            rows = parseJsonFormat(content);
          } else {
            rows = parseHtmlFormat(content);
          }
        } catch (parseError) {
          parsingErrors.tablesNotParsed.push({
            sheetName: 'Daily Playtime',
            reason: `Failed to parse ${isJsonFormat ? 'JSON' : 'HTML'} content: ${parseError.message}`,
            expectedFormat: isJsonFormat ? 'JSON' : 'HTML'
          });
        }

        // Store parsed data
        if (rows.length > 0) {
          data['Daily Playtime'] = rows;
        } else {
          parsingErrors.tablesNotParsed.push({
            sheetName: 'Daily Playtime',
            reason: 'No playtime data found in the file',
            expectedFormat: isJsonFormat ? 'JSON' : 'HTML'
          });
        }
      }
    } catch (playtimeError) {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Daily Playtime',
        reason: `Failed to parse playtime data: ${playtimeError.message}`,
        expectedPath: 'Takeout/Google Play Games Services/Global/'
      });
    }

    // Parse game activities from Games folder (independent section)
    try {
      const gameActivities = await parseGameActivities(zip);
      if (gameActivities.length > 0) {
        data['Game Activity'] = gameActivities;
      } else {
        parsingErrors.tablesNotParsed.push({
          sheetName: 'Game Activity',
          reason: 'No game activity files found in Games folder',
          expectedPath: 'Takeout/Google Play Games Services/Games/*/Activity.html or Activity.json'
        });
      }
    } catch (gameError) {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Game Activity',
        reason: `Failed to parse game activities: ${gameError.message}`,
        expectedPath: 'Takeout/Google Play Games Services/Games/'
      });
    }

  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Google Play Games Takeout',
      reason: `Failed to process ZIP file: ${error.message}`,
      expectedFormat: 'ZIP'
    });
  }

  return { data, parsingErrors };
}
