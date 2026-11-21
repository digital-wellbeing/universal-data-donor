import parsePlayMovies, { parseStamp } from './playMoviesParser';
import parseGoogleTakeout from './googleTakeoutParser';
import { makeFile, NNBSP } from './__fixtures__/takeoutBuilders';

// Layouts are modelled on a community description (items[].title / added_time) and on the
// bare `[]` that real empty exports hold; no real data is committed.
const DIR = 'Takeout/Google Play Movies & TV/';
const NOW = new Date('2026-11-20T12:00:00Z');
const watchlist = {
  items: [
    { title: 'Synthetic Film One', added_time: `Nov 2, 2026, 4:32:51${NNBSP}AM GMT` },
    { title: 'Synthetic Film Two (2021)', added_time: `Jan 5, 2026, 9:00:00${NNBSP}PM GMT` },
    { title: 'Unknown Item' },
  ],
};

describe('parseStamp', () => {
  test.each([
    [`Apr 28, 2023, 4:32:51${NNBSP}AM GMT`, Date.UTC(2023, 3, 28, 4, 32, 51)],
    ['Apr 28, 2023, 12:05:00 PM GMT', Date.UTC(2023, 3, 28, 12, 5, 0)],
    ['Apr 28, 2023, 12:05:00 AM GMT', Date.UTC(2023, 3, 28, 0, 5, 0)],
    ['2023-04-28T10:00:00.000Z', Date.UTC(2023, 3, 28, 10)],
    [1682676771000, 1682676771000],
    [1682676771, 1682676771000],
    ['28 Apr 2023', Date.UTC(2023, 3, 28)],
  ])('%p', (input, expected) => expect(parseStamp(input)).toBe(expected));

  test.each(['', 'nonsense', null, undefined, {}])('rejects %p', (input) => expect(parseStamp(input)).toBeNull());
});

describe('parsePlayMovies', () => {
  test('reads title and time from an {items} watchlist and drops placeholders', async () => {
    const file = await makeFile({ [`${DIR}Watchlist.json`]: JSON.stringify(watchlist) });
    const { data, parsingErrors } = await parsePlayMovies(file);
    expect(data.Watchlist).toEqual([
      { Title: 'Synthetic Film Two (2021)', 'Date Added': `Jan 5, 2026, 9:00:00${NNBSP}PM GMT`, _timestamp: Date.UTC(2026, 0, 5, 21) },
      { Title: 'Synthetic Film One', 'Date Added': `Nov 2, 2026, 4:32:51${NNBSP}AM GMT`, _timestamp: Date.UTC(2026, 10, 2, 4, 32, 51) },
    ]);
    expect(parsingErrors.tablesNotParsed).toEqual([]);
  });

  test('accepts a bare array and reads a viewing-history file under another name', async () => {
    const file = await makeFile({
      [`${DIR}Watchlist.json`]: JSON.stringify([{ title: 'A', added_time: '2026-11-01T10:00:00Z' }]),
      [`${DIR}Viewing History.json`]: JSON.stringify([{ title: 'B', watched_time: '2026-11-03T20:00:00Z' }]),
    });
    const { data } = await parsePlayMovies(file);
    expect(data.Watchlist).toHaveLength(1);
    expect(data['Viewing History'][0]).toMatchObject({ Title: 'B', 'Date Watched': '2026-11-03T20:00:00Z' });
  });

  test('empty exports ([]) give no rows and no error', async () => {
    const file = await makeFile({ [`${DIR}Watchlist.json`]: '[]', [`${DIR}Ratings.json`]: '[]' });
    const result = await parsePlayMovies(file);
    expect(result.data).toEqual({});
    expect(result.parsingErrors.tablesNotParsed).toEqual([]);
  });

  test('never opens ratings, purchases or other files', async () => {
    const file = await makeFile({
      [`${DIR}Ratings.json`]: '{ not json', [`${DIR}Purchases.json`]: '{ not json',
      [`${DIR}Watchlist.json`]: JSON.stringify([{ title: 'A', added_time: '2026-11-01' }]),
    });
    const { data, parsingErrors } = await parsePlayMovies(file);
    expect(data.Watchlist).toHaveLength(1);
    expect(parsingErrors.tablesNotParsed).toEqual([]);
  });

  test('reports entries it cannot recognise, without quoting the file', async () => {
    const file = await makeFile({ [`${DIR}Watchlist.json`]: JSON.stringify([{ foo: 'SECRET' }]), [`${DIR}Viewing History.json`]: '{ SECRET' });
    const { data, parsingErrors } = await parsePlayMovies(file);
    expect(data).toEqual({});
    expect(parsingErrors.tablesNotParsed).toHaveLength(2);
    expect(JSON.stringify(parsingErrors)).not.toMatch(/SECRET/);
  });
});

describe('parseGoogleTakeout with Play Movies & TV', () => {
  test('labels the tables and keeps only rows inside the window', async () => {
    const file = await makeFile({ [`${DIR}Watchlist.json`]: JSON.stringify(watchlist) });
    const result = await parseGoogleTakeout(file, undefined, { now: NOW });
    expect(Object.keys(result.data)).toEqual(['Play Movies & TV - Watchlist']);
    expect(result.data['Play Movies & TV - Watchlist'].map((r) => r.Title)).toEqual(['Synthetic Film One']);
    expect(result.metadata.services).toContain('Play Movies & TV');
    expect(result.metadata.window.droppedRowCounts['Play Movies & TV - Watchlist']).toBe(1);
  });
});
