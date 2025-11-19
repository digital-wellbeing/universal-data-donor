const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

console.log('🧪 Testing Android Parser Logic\n');

// Test date formatting
function formatDate(dateObj) {
  if (!dateObj) return '';
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[dateObj.month - 1]} ${dateObj.day}, ${dateObj.year}`;
}

// Test duration formatting
function formatDuration(seconds, nanos = 0) {
  const totalSeconds = Math.floor(seconds + (nanos / 1000000000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

// Test timestamp formatting
function formatTimestamp(timestampMillis) {
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
}

// Test JSON parsing
function parseJsonFormat(jsonContent) {
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
}

async function testFile(filename) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 Testing: ${filename}`);
  console.log('='.repeat(60));

  const filePath = path.join(__dirname, filename);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ File not found: ${filePath}`);
    return;
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);

    console.log('📂 ZIP contents:');
    Object.keys(zip.files).forEach(name => {
      console.log(`   ${name}`);
    });

    // Find Playtime file
    let playtimeFile = null;
    let isJsonFormat = false;
    let foundPath = '';

    for (const fileName of Object.keys(zip.files)) {
      const lowerName = fileName.toLowerCase();
      if (lowerName.includes('google play games services/global/playtime')) {
        playtimeFile = zip.files[fileName];
        foundPath = fileName;
        isJsonFormat = lowerName.endsWith('.json');
        break;
      }
    }

    if (!playtimeFile) {
      console.log('\n❌ Could not find Playtime file in ZIP');
      return;
    }

    console.log(`\n✅ Found: ${foundPath}`);
    console.log(`   Format: ${isJsonFormat ? 'JSON' : 'HTML'}`);

    const content = await playtimeFile.async('string');
    console.log(`   Size: ${content.length} bytes`);

    if (isJsonFormat) {
      console.log('\n⏳ Parsing JSON format...');
      const rows = parseJsonFormat(content);

      console.log(`\n✅ Parsed ${rows.length} playtime records`);

      if (rows.length > 0) {
        console.log('\n📊 Sample records (first 3):');
        rows.slice(0, 3).forEach((row, i) => {
          console.log(`\n   Record ${i + 1}:`);
          Object.entries(row).forEach(([key, value]) => {
            console.log(`     ${key}: ${value}`);
          });
        });

        // Validation
        console.log('\n🔍 Validation:');
        const hasData = rows.length > 0;
        console.log(`   ${hasData ? '✅' : '❌'} Data exists: ${rows.length} rows`);

        const hasRequiredFields = rows.every(row =>
          row['Date'] && row['Package Name'] && row['Duration']
        );
        console.log(`   ${hasRequiredFields ? '✅' : '❌'} All required fields present`);

        console.log('\n📈 Summary:');
        const uniqueDates = [...new Set(rows.map(r => r['Date']))];
        const uniquePackages = [...new Set(rows.map(r => r['Package Name']))];
        console.log(`   Unique dates: ${uniqueDates.length}`);
        console.log(`   Unique packages: ${uniquePackages.length}`);
        console.log(`   Total sessions: ${rows.reduce((sum, r) => sum + (parseInt(r['Number of Sessions']) || 0), 0)}`);
      }
    } else {
      console.log('\n⚠️  HTML format detected (would parse in browser with DOMParser)');
      console.log('   Content preview:');
      console.log('   ' + content.substring(0, 200).replace(/\n/g, '\n   ') + '...');
    }

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }
}

async function runTests() {
  await testFile('takeout-20251119T102258Z-3-001_json.zip');
  await testFile('takeout-20251118T141053Z-3-001_html.zip');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Testing complete!');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
