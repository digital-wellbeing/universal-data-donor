import { parsePlaystationFile } from './playstationParser';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writePlaystationFixture } from './__fixtures__/playstationBuilders';

// Synthetic workbook, built per run: real PlayStation exports hold personal data.
let fixtureDir;
let fixturePath;
beforeAll(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-fixture-'));
  fixturePath = await writePlaystationFixture(fixtureDir);
});
afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('playstationParser', () => {
  it('should parse the PlayStation file successfully', async () => {
    const filePath = fixturePath;
    const parseResult = await parsePlaystationFile(filePath);

    // Test that the parser returns an object with parsed data and parsing errors
    expect(typeof parseResult).toBe('object');
    expect(parseResult).not.toBeNull();
    expect(parseResult).toHaveProperty('data');
    expect(parseResult).toHaveProperty('parsingErrors');
  });
});
