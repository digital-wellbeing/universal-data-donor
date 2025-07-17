import { parsePlaystationFile } from '../parsers/playstationParser';
import validatePlaystationData from './playstationValidator';
import path from 'path';

describe('playstationValidator', () => {
  it('should validate when at least one sheet has data', async () => {
    const filePath = path.resolve(__dirname, '../../tests/sonysample.xlsx');
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
