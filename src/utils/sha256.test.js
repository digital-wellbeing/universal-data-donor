import { createHash } from 'crypto';
import sha256Hex from './sha256';

test.each(['', 'abc', 'udd|12345678-9abc-4def-8000-000000000001', 'é'.repeat(100), 'x'.repeat(1000)])(
  'matches node crypto for %#',
  (input) => {
    expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  },
);
