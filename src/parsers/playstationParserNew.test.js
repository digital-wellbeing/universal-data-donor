import { parsePlaystationFile } from './playstationParser';
import path from 'path';

describe('playstationParser', () => {
  it('should parse the PlayStation file successfully', async () => {
    const filePath = path.resolve(__dirname, '../../tests/sonysample.xlsx');
    const parseResult = await parsePlaystationFile(filePath);

    // Test that the parser returns an object with parsed data and parsing errors
    expect(typeof parseResult).toBe('object');
    expect(parseResult).not.toBeNull();
    expect(parseResult).toHaveProperty('data');
    expect(parseResult).toHaveProperty('parsingErrors');
  });
});
