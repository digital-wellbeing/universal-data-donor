const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Google Play Games implementation...\n');

const checks = [];

// Check if all files exist
const filesToCheck = [
  { path: 'public/config-playstation.json', desc: 'PlayStation config' },
  { path: 'public/config-android.json', desc: 'Android config' },
  { path: 'public/android-logo.svg', desc: 'Android logo' },
  { path: 'src/parsers/androidParser.js', desc: 'Android parser' },
  { path: 'src/validators/androidValidator.js', desc: 'Android validator' },
  { path: 'src/utils/parserFactory.js', desc: 'Parser factory' },
  { path: 'src/utils/validatorFactory.js', desc: 'Validator factory' },
  { path: 'src/ConfigContext.js', desc: 'Config context' },
];

console.log('📁 File existence checks:');
filesToCheck.forEach(({ path: filePath, desc }) => {
  const fullPath = path.join(__dirname, '..', filePath);
  const exists = fs.existsSync(fullPath);
  checks.push({ check: desc, passed: exists });
  console.log(`  ${exists ? '✅' : '❌'} ${desc}: ${filePath}`);
});

// Check if androidParser is registered in parserFactory
console.log('\n🔧 Configuration checks:');

const parserFactory = fs.readFileSync(path.join(__dirname, '../src/utils/parserFactory.js'), 'utf8');
const hasAndroidParser = parserFactory.includes('androidParser');
checks.push({ check: 'androidParser registered', passed: hasAndroidParser });
console.log(`  ${hasAndroidParser ? '✅' : '❌'} androidParser registered in parserFactory`);

const validatorFactory = fs.readFileSync(path.join(__dirname, '../src/utils/validatorFactory.js'), 'utf8');
const hasAndroidValidator = validatorFactory.includes('androidValidator');
checks.push({ check: 'androidValidator registered', passed: hasAndroidValidator });
console.log(`  ${hasAndroidValidator ? '✅' : '❌'} androidValidator registered in validatorFactory`);

const configContext = fs.readFileSync(path.join(__dirname, '../src/ConfigContext.js'), 'utf8');
const hasUrlParam = configContext.includes('URLSearchParams') && configContext.includes('platform');
checks.push({ check: 'URL parameter detection', passed: hasUrlParam });
console.log(`  ${hasUrlParam ? '✅' : '❌'} URL parameter detection in ConfigContext`);

const hasValidPlatforms = configContext.includes('android') && configContext.includes('playstation');
checks.push({ check: 'Valid platforms defined', passed: hasValidPlatforms });
console.log(`  ${hasValidPlatforms ? '✅' : '❌'} Valid platforms (android, playstation) defined`);

// Check Android config content
console.log('\n⚙️  Android config verification:');
try {
  const androidConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/config-android.json'), 'utf8'));

  const hasCorrectParser = androidConfig.general?.parser === 'androidParser';
  checks.push({ check: 'Android config uses androidParser', passed: hasCorrectParser });
  console.log(`  ${hasCorrectParser ? '✅' : '❌'} Uses androidParser: ${androidConfig.general?.parser}`);

  const hasCorrectValidator = androidConfig.general?.validator === 'androidValidator';
  checks.push({ check: 'Android config uses androidValidator', passed: hasCorrectValidator });
  console.log(`  ${hasCorrectValidator ? '✅' : '❌'} Uses androidValidator: ${androidConfig.general?.validator}`);

  const hasZipExtension = androidConfig.general?.fileExtensions?.includes('.zip');
  checks.push({ check: 'Android config accepts .zip files', passed: hasZipExtension });
  console.log(`  ${hasZipExtension ? '✅' : '❌'} Accepts .zip files: ${JSON.stringify(androidConfig.general?.fileExtensions)}`);

  const hasPlatformName = androidConfig.general?.platform === 'Google Play Games';
  checks.push({ check: 'Platform name is Google Play Games', passed: hasPlatformName });
  console.log(`  ${hasPlatformName ? '✅' : '❌'} Platform name: ${androidConfig.general?.platform}`);
} catch (error) {
  console.log(`  ❌ Error reading Android config: ${error.message}`);
  checks.push({ check: 'Android config valid JSON', passed: false });
}

// Check PlayStation config still exists
console.log('\n⚙️  PlayStation config verification:');
try {
  const psConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/config-playstation.json'), 'utf8'));

  const hasCorrectParser = psConfig.general?.parser === 'playstationParser';
  checks.push({ check: 'PlayStation config uses playstationParser', passed: hasCorrectParser });
  console.log(`  ${hasCorrectParser ? '✅' : '❌'} Uses playstationParser: ${psConfig.general?.parser}`);

  const hasCorrectValidator = psConfig.general?.validator === 'playstationValidator';
  checks.push({ check: 'PlayStation config uses playstationValidator', passed: hasCorrectValidator });
  console.log(`  ${hasCorrectValidator ? '✅' : '❌'} Uses playstationValidator: ${psConfig.general?.validator}`);
} catch (error) {
  console.log(`  ❌ Error reading PlayStation config: ${error.message}`);
  checks.push({ check: 'PlayStation config valid JSON', passed: false });
}

// Check package.json for jszip
console.log('\n📦 Dependencies:');
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const hasJsZip = packageJson.dependencies?.jszip !== undefined;
  checks.push({ check: 'jszip installed', passed: hasJsZip });
  console.log(`  ${hasJsZip ? '✅' : '❌'} jszip installed: ${packageJson.dependencies?.jszip || 'NOT FOUND'}`);
} catch (error) {
  console.log(`  ❌ Error reading package.json: ${error.message}`);
}

// Check test files exist
console.log('\n🧪 Test files:');
const testFiles = [
  'tests/takeout-20251119T102258Z-3-001_json.zip',
  'tests/takeout-20251118T141053Z-3-001_html.zip',
];

testFiles.forEach(filePath => {
  const fullPath = path.join(__dirname, '..', filePath);
  const exists = fs.existsSync(fullPath);
  const size = exists ? (fs.statSync(fullPath).size / 1024).toFixed(2) + ' KB' : 'N/A';
  console.log(`  ${exists ? '✅' : '❌'} ${path.basename(filePath)} ${exists ? `(${size})` : ''}`);
});

// Summary
console.log('\n' + '='.repeat(60));
const passed = checks.filter(c => c.passed).length;
const total = checks.length;
const allPassed = passed === total;

console.log(`📊 Summary: ${passed}/${total} checks passed`);
if (allPassed) {
  console.log('✅ All verification checks passed! Implementation looks good.');
  console.log('\n🚀 Ready to test:');
  console.log('   1. Run: npm start');
  console.log('   2. Open: http://localhost:3000?platform=android');
  console.log('   3. Upload: tests/takeout-20251119T102258Z-3-001_json.zip');
} else {
  console.log(`❌ ${total - passed} check(s) failed. Review the output above.`);
}
console.log('='.repeat(60));
