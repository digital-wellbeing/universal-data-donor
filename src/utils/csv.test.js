import { forEachCsvRow, forEachCsvRecord, createCsvRecordStream } from './csv';

const rows = (text, delim) => {
  const out = [];
  forEachCsvRow(text, (r) => { out.push(r); }, delim);
  return out;
};

describe('forEachCsvRow', () => {
  test('quotes, escaped quotes, embedded commas and newlines', () => {
    expect(rows('a,"b,c","say ""hi""","multi\nline"\n1,2,3,4\n')).toEqual([
      ['a', 'b,c', 'say "hi"', 'multi\nline'],
      ['1', '2', '3', '4'],
    ]);
  });

  test('BOM, CRLF, bare CR, trailing comma, blank lines, no final newline', () => {
    expect(rows('﻿h1,h2\r\nx,y,\r\n\rp,q')).toEqual([['h1', 'h2'], ['x', 'y', ''], ['p', 'q']]);
  });

  test('custom delimiter and early stop', () => {
    expect(rows('a;b\nc;d', ';')).toEqual([['a', 'b'], ['c', 'd']]);
    const seen = [];
    forEachCsvRow('1\n2\n3\n', (r) => { seen.push(r[0]); return r[0] !== '2' ? undefined : false; });
    expect(seen).toEqual(['1', '2']);
  });
});

test('forEachCsvRecord skips metadata lines and maps by header', () => {
  const recs = [];
  forEachCsvRecord('com.samsung.x,6305105,7\nday_time,count\n1700000000000,5,\n', (r) => { recs.push(r); }, { skipLines: 1 });
  expect(recs).toEqual([{ day_time: '1700000000000', count: '5' }]);
});

describe('createCsvRecordStream', () => {
  const TEXT = '﻿meta,1,2\nh1;h2\n"a;b";2\n"multi\nline";4\nx;y\r\nlast;row';
  const collect = (size) => {
    const recs = [];
    const s = createCsvRecordStream((r) => recs.push(r), {
      detect: (l1) => ({ skipLines: l1.startsWith('meta') ? 1 : 0, delimiter: ';' }),
    });
    for (let i = 0; i < TEXT.length; i += size) s.push(TEXT.slice(i, i + size));
    s.end();
    return recs;
  };

  test.each([1, 2, 5, 13, 1000])('same records for chunk size %i', (size) => {
    expect(collect(size)).toEqual([
      { h1: 'a;b', h2: '2' }, { h1: 'multi\nline', h2: '4' }, { h1: 'x', h2: 'y' }, { h1: 'last', h2: 'row' },
    ]);
  });
});
