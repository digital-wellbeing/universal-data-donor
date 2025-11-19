const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom');

console.log('🧪 Testing HTML Parser Logic\n');

function parseHtmlFormat(htmlContent) {
  const rows = [];

  // Use JSDOM instead of browser's DOMParser
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;

  // Find all outer table rows (dates)
  const outerTable = doc.querySelector('table.mdl-data-table');
  if (!outerTable) {
    console.log('   ⚠️  No table found with class mdl-data-table');
    return rows;
  }

  const outerRows = outerTable.querySelectorAll('tr');
  console.log(`   Found ${outerRows.length} outer rows`);

  outerRows.forEach((row, idx) => {
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
}

async function testHtmlFile(filename) {
  console.log(`${'='.repeat(60)}`);
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

    // Find Playtime HTML file
    let playtimeFile = null;
    let foundPath = '';

    for (const fileName of Object.keys(zip.files)) {
      const lowerName = fileName.toLowerCase();
      if (lowerName.includes('google play games services/global/playtime.html')) {
        playtimeFile = zip.files[fileName];
        foundPath = fileName;
        break;
      }
    }

    if (!playtimeFile) {
      console.log('❌ Could not find Playtime.html in ZIP');
      return;
    }

    console.log(`✅ Found: ${foundPath}\n`);

    const content = await playtimeFile.async('string');
    console.log('⏳ Parsing HTML format...');

    const rows = parseHtmlFormat(content);

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
      console.log(`   Packages: ${uniquePackages.join(', ')}`);
    }

  } catch (error) {
    console.log(`\n❌ Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }
}

async function runTest() {
  await testHtmlFile('takeout-20251118T141053Z-3-001_html.zip');

  console.log('\n' + '='.repeat(60));
  console.log('✅ HTML parser testing complete!');
  console.log('='.repeat(60));
}

runTest().catch(console.error);
