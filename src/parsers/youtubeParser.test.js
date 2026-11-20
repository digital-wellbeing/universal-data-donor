import parseYouTubeFile, { parseTakeoutTimestamp } from './youtubeParser';
import {
  NNBSP, htmlEntry, page, at, makeFile,
} from './__fixtures__/takeoutBuilders';

const DIR = 'Takeout/YouTube and YouTube Music/history/';

// The reader hands stored entries to the parser in 4 MiB chunks.
const READ_CHUNK = 4 * 1024 * 1024;

// Newest first, as Google writes them.
const watchEntries = [
  htmlEntry({ title: 'D', stamp: at(19, '11:00:00 AM') }),
  htmlEntry({ title: 'C', stamp: at(19, '9:35:00 AM') }),
  htmlEntry({ title: 'Ad', stamp: at(19, '9:20:00 AM'), ad: true }),
  htmlEntry({ title: 'B', stamp: at(19, '9:10:00 AM') }),
  htmlEntry({ product: 'YouTube Music', title: 'Song', stamp: at(19, '9:05:00 AM') }),
  htmlEntry({ title: 'A', stamp: at(19, '9:00:00 AM') }),
];
const searchEntries = [
  htmlEntry({ verb: 'Searched for', title: 'secret query two', stamp: at(20, '8:00:00 AM') }),
  htmlEntry({ verb: 'Searched for', title: 'secret query one', stamp: at(19, '8:50:00 AM') }),
];
const htmlZip = (extra = {}) => makeFile({
  [`${DIR}watch-history.html`]: page(watchEntries),
  [`${DIR}search-history.html`]: page(searchEntries),
  ...extra,
});

describe('parseTakeoutTimestamp', () => {
  test('reads the English format with U+202F before AM/PM', () => {
    const t = parseTakeoutTimestamp(`Nov 19, 2026, 9:08:08${NNBSP}AM GMT`);
    expect(t.ms).toBe(Date.UTC(2026, 10, 19, 9, 8, 8));
    expect(t.dateKey).toBe('2026-11-19');
    expect(t.offsetMin).toBe(0);
    expect(t.tzAssumed).toBe(false);
  });

  test('converts regional abbreviations and keeps the exported local date', () => {
    const t = parseTakeoutTimestamp(`Feb 13, 2024, 12:30:00${NNBSP}AM EET`);
    expect(t.dateKey).toBe('2024-02-13'); // local date as printed
    expect(t.ms).toBe(Date.UTC(2024, 1, 12, 22, 30, 0)); // 2 h behind UTC
    expect(t.offsetMin).toBe(120);
  });

  test.each([
    ['Nov 19, 2026, 9:00:00 PM GMT+5:30', 330, Date.UTC(2026, 10, 19, 15, 30)],
    ['Nov 19, 2026, 9:00:00 PM GMT-8', -480, Date.UTC(2026, 10, 20, 5, 0)],
    ['Nov 19, 2026, 9:00:00 PM PST', -480, Date.UTC(2026, 10, 20, 5, 0)],
    ['Nov 19, 2026, 21:00:00 UTC', 0, Date.UTC(2026, 10, 19, 21, 0)],
    ['November 19, 2026, 12:00:00 AM GMT', 0, Date.UTC(2026, 10, 19, 0, 0)],
    ['November 19, 2026, 12:00:00 PM GMT', 0, Date.UTC(2026, 10, 19, 12, 0)],
  ])('handles %s', (text, offsetMin, ms) => {
    const t = parseTakeoutTimestamp(text);
    expect(t.offsetMin).toBe(offsetMin);
    expect(t.ms).toBe(ms);
  });

  test('assumes UTC and flags ambiguous or unknown abbreviations', () => {
    const t = parseTakeoutTimestamp('Nov 19, 2026, 9:00:00 AM IST');
    expect(t.tzAssumed).toBe(true);
    expect(t.tz).toBe('IST');
    expect(t.ms).toBe(Date.UTC(2026, 10, 19, 9, 0, 0));
  });

  test('uses the last date in the text so a title containing a date cannot win', () => {
    const t = parseTakeoutTimestamp('Watched Best of Jan 1, 2020, 1:00:00 AM GMT Channel Nov 19, 2026, 9:00:00 AM GMT');
    expect(t.dateKey).toBe('2026-11-19');
  });

  test.each(['', 'no date here', 'Foo 19, 2026, 9:00:00 AM GMT', null])('returns null for %p', (text) => {
    expect(parseTakeoutTimestamp(text)).toBeNull();
  });
});

describe('parseYouTubeFile (HTML export)', () => {
  test('builds viewing sessions per product from watch events only', async () => {
    const { data } = await parseYouTubeFile(await htmlZip());
    const sessions = data['YouTube - Viewing Sessions'];
    expect(sessions.map((s) => [s.Product, s['Start Time'], s['End Time'], s['Span (min)'], s['Items Played']])).toEqual([
      ['YouTube', '2026-11-19 09:00:00', '2026-11-19 09:35:00', '35', '3'],
      ['YouTube Music', '2026-11-19 09:05:00', '2026-11-19 09:05:00', '0', '1'],
      ['YouTube', '2026-11-19 11:00:00', '2026-11-19 11:00:00', '0', '1'],
    ]);
    expect(sessions[0]['UTC Offset']).toBe('+00:00');
    expect(sessions[0]._timestamp).toBe(Date.UTC(2026, 10, 19, 9, 0, 0));
  });

  test('aggregates per day, counting searches but excluding ads', async () => {
    const { data } = await parseYouTubeFile(await htmlZip());
    const daily = data['YouTube - Daily Activity'];
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({
      Date: '2026-11-19', 'Videos Watched': '4', 'Music Tracks Played': '1', Searches: '1',
      'Viewing Sessions': '3', 'First Activity': '08:50:00', 'Last Activity': '11:00:00',
    });
    expect(daily[1]).toMatchObject({
      Date: '2026-11-20', 'Videos Watched': '0', 'Music Tracks Played': '0', Searches: '1',
      'Viewing Sessions': '0', 'First Activity': '08:00:00', 'Last Activity': '08:00:00',
    });
  });

  test('never emits titles, URLs, channels or search text', async () => {
    const result = await parseYouTubeFile(await htmlZip());
    const dump = JSON.stringify(result);
    ['SECRETID', 'Secret Channel', 'UCSECRET', 'secret query', 'youtube.com', 'Synthetic Title', '"Song"'].forEach((needle) => {
      expect(dump).not.toContain(needle);
    });
  });

  test('the session gap is a parameter', async () => {
    const { data } = await parseYouTubeFile(await htmlZip(), undefined, { sessionGapMinutes: 5 });
    const youtube = data['YouTube - Viewing Sessions'].filter((s) => s.Product === 'YouTube');
    expect(youtube.map((s) => s['Items Played'])).toEqual(['1', '1', '1', '1']); // A, B, C, D all > 5 min apart
  });

  test('counts a removed video (no link) as a watch event', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ verb: 'Watched a video that has been removed', stamp: at(19, '9:00:00 AM'), link: false })]),
    });
    const { data } = await parseYouTubeFile(file);
    expect(data['YouTube - Daily Activity'][0]['Videos Watched']).toBe('1');
  });

  test('keeps the exported local date and offset for non-GMT zones', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ stamp: `Feb 13, 2024, 12:30:00${NNBSP}AM EET` })]),
    });
    const { data } = await parseYouTubeFile(file);
    const [session] = data['YouTube - Viewing Sessions'];
    expect(session.Date).toBe('2024-02-13');
    expect(session['Start Time']).toBe('2024-02-13 00:30:00');
    expect(session['UTC Offset']).toBe('+02:00');
    expect(session._timestamp).toBe(Date.UTC(2024, 1, 12, 22, 30, 0));
  });

  test('reports an unrecognised timezone instead of failing', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ stamp: `Nov 19, 2026, 9:00:00${NNBSP}AM IST` })]),
    });
    const { data, parsingErrors } = await parseYouTubeFile(file);
    expect(data['YouTube - Daily Activity']).toHaveLength(1);
    expect(parsingErrors.tablesNotParsed.some((e) => /IST/.test(e.reason))).toBe(true);
  });

  test('flags a non-English export that it cannot classify', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ verb: 'Angesehen', stamp: at(19, '9:00:00 AM') })]),
    });
    const { data, parsingErrors } = await parseYouTubeFile(file);
    expect(data).toEqual({});
    expect(parsingErrors.tablesNotParsed.some((e) => /not recognised|another language/i.test(e.reason))).toBe(true);
  });

  const totalWatched = (data) => data['YouTube - Daily Activity'].reduce((n, d) => n + Number(d['Videos Watched']), 0);

  test('reads every entry across several streaming chunks', async () => {
    // ~5.6 MB stored uncompressed => the reader emits at least two chunks, cutting a block mid-way.
    const N = 7000;
    const entries = Array.from({ length: N }, (_, i) =>
      htmlEntry({ title: `T${i}`, stamp: at(1 + (i % 28), `${(i % 12) + 1}:${String(i % 60).padStart(2, '0')}:00 AM`) }));
    const file = await makeFile({ [`${DIR}watch-history.html`]: page(entries) }, 'STORE');
    expect(file.size).toBeGreaterThan(READ_CHUNK);
    const { data } = await parseYouTubeFile(file);
    expect(totalWatched(data)).toBe(N);
  });

  test('reads an entry whose start marker is split across two chunks', async () => {
    const prefix = '<html><body>';
    const filler = 'x'.repeat(READ_CHUNK - 10 - prefix.length); // first marker starts 10 chars before the boundary
    const entries = [1, 2, 3, 4, 5].map((n) => htmlEntry({ stamp: at(19, `9:0${n}:00 AM`) }));
    const file = await makeFile({ [`${DIR}watch-history.html`]: prefix + filler + entries.join('') }, 'STORE');
    const { data } = await parseYouTubeFile(file);
    expect(totalWatched(data)).toBe(5);
  });

  test('reports history files that are missing', async () => {
    const { data, parsingErrors } = await parseYouTubeFile(await makeFile({ 'Takeout/other.txt': 'x' }));
    expect(data).toEqual({});
    expect(parsingErrors.sheetsNotFound.length).toBeGreaterThan(0);
  });

  test('finds history under a localised folder name', async () => {
    const file = await makeFile({
      'Takeout/YouTube und YouTube Music/history/watch-history.html': page([htmlEntry({ stamp: at(19, '9:00:00 AM') })]),
    });
    const { data } = await parseYouTubeFile(file);
    expect(data['YouTube - Daily Activity']).toHaveLength(1);
  });
});

describe('parseYouTubeFile (JSON export)', () => {
  const jsonZip = () => makeFile({
    [`${DIR}watch-history.json`]: JSON.stringify([
      { header: 'YouTube', title: 'Watched Secret Title', titleUrl: 'https://www.youtube.com/watch?v=SECRETID', subtitles: [{ name: 'Secret Channel' }], time: '2026-11-19T09:10:00.000Z', products: ['YouTube'] },
      { header: 'YouTube', title: 'Watched Ad Video', time: '2026-11-19T09:05:00.000Z', details: [{ name: 'From Google Ads' }], products: ['YouTube'] },
      { header: 'YouTube Music', title: 'Watched Song', time: '2026-11-19T09:02:00.000Z', products: ['YouTube'] },
      { header: 'YouTube', title: 'Watched Secret Title', time: '2026-11-19T09:00:00.000Z', products: ['YouTube'] },
    ]),
    [`${DIR}search-history.json`]: JSON.stringify([
      { header: 'YouTube', title: 'Searched for secret query', time: '2026-11-19T08:00:00.000Z', products: ['YouTube'] },
    ]),
  });

  test('produces the same tables from the JSON format', async () => {
    const { data } = await parseYouTubeFile(await jsonZip());
    expect(data['YouTube - Viewing Sessions'].map((s) => [s.Product, s['Items Played'], s['Span (min)']])).toEqual([
      ['YouTube', '2', '10'],
      ['YouTube Music', '1', '0'],
    ]);
    expect(data['YouTube - Daily Activity'][0]).toMatchObject({ 'Videos Watched': '2', 'Music Tracks Played': '1', Searches: '1' });
  });

  test('never emits content from the JSON format either', async () => {
    const dump = JSON.stringify(await parseYouTubeFile(await jsonZip()));
    ['SECRETID', 'Secret Channel', 'Secret Title', 'secret query'].forEach((n) => expect(dump).not.toContain(n));
  });

  test('prefers JSON when both formats are present', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.json`]: JSON.stringify([{ header: 'YouTube', title: 'Watched X', time: '2026-11-19T09:00:00.000Z' }]),
      [`${DIR}watch-history.html`]: page(watchEntries),
    });
    const { data } = await parseYouTubeFile(file);
    expect(data['YouTube - Daily Activity'][0]['Videos Watched']).toBe('1');
  });
});

describe('review fixes', () => {
  const dump = (r) => JSON.stringify(r);

  test('reads a day-first English (en-GB) export', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ stamp: `19 Nov 2026, 09:08:08${NNBSP}GMT` }), htmlEntry({ stamp: '19 Nov 2026, 22:30:00 GMT+2' })]),
    });
    const { data } = await parseYouTubeFile(file);
    expect(data['YouTube - Daily Activity'][0]).toMatchObject({ Date: '2026-11-19', 'Videos Watched': '2' });
    expect(parseTakeoutTimestamp('3 Jan 2025, 09:00:00 GMT').dateKey).toBe('2025-01-03');
  });

  test('a date inside the title can neither win nor leak into messages', async () => {
    const title = 'Stream VOD Jan 5, 2024, 10:00:00 PM Highlights';
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ title, stamp: at(19, '9:08:08 AM') })]),
    });
    const result = await parseYouTubeFile(file);
    expect(result.data['YouTube - Daily Activity'][0].Date).toBe('2026-11-19');
    expect(dump(result)).not.toMatch(/Highl|Stream VOD|2024/);
  });

  test('the timestamp must be the end of the entry, so trailing title text cannot be mistaken for a zone', () => {
    const t = parseTakeoutTimestamp('Watched Stream VOD Jan 5, 2024, 10:00:00 PM Nov 19, 2026, 9:08:08 AM GMT');
    expect(t.dateKey).toBe('2026-11-19');
    expect(t.tz).toBe('GMT');
    expect(parseTakeoutTimestamp('Watched x Jan 5, 2024, 10:00:00 PM Highlights')).toBeNull();
  });

  test('says so, without quoting content, when timestamps cannot be read', async () => {
    const file = await makeFile({
      [`${DIR}watch-history.html`]: page([htmlEntry({ title: 'private words', stamp: '19.11.2026 09:08:08' }), htmlEntry({ title: 'more private words', stamp: '20.11.2026 09:08:08' })]),
    });
    const result = await parseYouTubeFile(file);
    expect(result.data).toEqual({});
    const note = result.parsingErrors.tablesNotParsed.find((e) => /timestamp/i.test(e.reason));
    expect(note.reason).toMatch(/2/);
    expect(dump(result)).not.toMatch(/private/);
  });

  test('a corrupt JSON file reports a fixed message, never a fragment of its content', async () => {
    const file = await makeFile({ [`${DIR}watch-history.json`]: '[{"title":"a"}, Watched my secret holiday plans' });
    const result = await parseYouTubeFile(file);
    expect(result.parsingErrors.tablesNotParsed).toHaveLength(1);
    expect(dump(result)).not.toMatch(/secret|holiday/);
  });

  test('accepts several zips, so watch and search history in different parts merge into one day row', async () => {
    const watchPart = await makeFile({ [`${DIR}watch-history.html`]: page([htmlEntry({ stamp: at(19, '9:00:00 AM') })]) });
    const searchPart = await makeFile({ [`${DIR}search-history.html`]: page([htmlEntry({ verb: 'Searched for', stamp: at(19, '8:00:00 AM') })]) });
    const { data } = await parseYouTubeFile([watchPart, searchPart]);
    expect(data['YouTube - Daily Activity']).toHaveLength(1);
    expect(data['YouTube - Daily Activity'][0]).toMatchObject({ 'Videos Watched': '1', Searches: '1' });
  });
});
