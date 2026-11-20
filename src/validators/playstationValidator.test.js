import { parsePlaystationFile } from '../parsers/playstationParser';
import validatePlaystationData from './playstationValidator';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writePlaystationFixture } from '../parsers/__fixtures__/playstationBuilders';

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

describe('playstationValidator', () => {
  it('should validate when at least one sheet has data', async () => {
    const filePath = fixturePath;
    const parseResult = await parsePlaystationFile(filePath);
    const validation = validatePlaystationData(parseResult);
    expect(validation.valid).toBe(true);
  });

  it('should fail validation when all sheets are empty', () => {
    const emptyResult = {
      data: {
        '"Account Device"': [],
        '"Gameplay Online"': []
      },
      parsingErrors: { sheetsNotFound: [], tablesNotParsed: [] }
    };
    const validation = validatePlaystationData(emptyResult);
    expect(validation.valid).toBe(false);
  });
});
