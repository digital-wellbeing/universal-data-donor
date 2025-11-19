// Test script for Android parser
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the parser
const parserModule = await import('../src/parsers/androidParser.js');
const parseAndroidFile = parserModule.default;

// Import the validator
const validatorModule = await import('../src/validators/androidValidator.js');
const validateAndroidData = validatorModule.default;

console.log('🧪 Testing Android Parser with sample files\n');

// Test both sample files
const testFiles = [
  'takeout-20251119T102258Z-3-001_json.zip',
  'takeout-20251118T141053Z-3-001_html.zip'
];

for (const filename of testFiles) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 Testing: ${filename}`);
  console.log('='.repeat(60));

  try {
    const filePath = path.join(__dirname, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}`);
      continue;
    }

    // Read file as buffer
    const buffer = fs.readFileSync(filePath);
    const file = new File([buffer], filename, { type: 'application/zip' });

    // Parse the file
    console.log('⏳ Parsing file...');
    const parseResult = await parseAndroidFile(file);

    // Display results
    console.log('\n📊 Parse Result:');
    console.log('  Tables found:', Object.keys(parseResult.data).length);

    for (const [tableName, rows] of Object.entries(parseResult.data)) {
      console.log(`\n  📋 ${tableName}:`);
      console.log(`     Rows: ${rows.length}`);

      if (rows.length > 0) {
        console.log(`     Columns: ${Object.keys(rows[0]).join(', ')}`);
        console.log(`\n     Sample rows (first 3):`);
        rows.slice(0, 3).forEach((row, i) => {
          console.log(`     ${i + 1}.`, JSON.stringify(row, null, 2).split('\n').join('\n        '));
        });
      }
    }

    // Display parsing errors
    if (parseResult.parsingErrors) {
      console.log('\n⚠️  Parsing Errors:');
      if (parseResult.parsingErrors.sheetsNotFound?.length > 0) {
        console.log('  Sheets not found:', parseResult.parsingErrors.sheetsNotFound);
      }
      if (parseResult.parsingErrors.tablesNotParsed?.length > 0) {
        console.log('  Tables not parsed:');
        parseResult.parsingErrors.tablesNotParsed.forEach(err => {
          console.log(`    - ${err.sheetName}: ${err.reason}`);
        });
      }
      if (parseResult.parsingErrors.sheetsNotFound?.length === 0 &&
          parseResult.parsingErrors.tablesNotParsed?.length === 0) {
        console.log('  None ✅');
      }
    }

    // Validate the data
    console.log('\n🔍 Validation:');
    const validationResult = validateAndroidData(parseResult);

    if (validationResult.valid) {
      console.log('  ✅ VALID - Data is usable');
    } else {
      console.log(`  ❌ INVALID - ${validationResult.reason}`);
    }

  } catch (error) {
    console.log(`\n❌ Error testing ${filename}:`);
    console.log(`   ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('✅ Testing complete!');
console.log('='.repeat(60));
