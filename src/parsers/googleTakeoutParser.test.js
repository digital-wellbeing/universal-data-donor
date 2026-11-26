import parseGoogleTakeout from './googleTakeoutParser';
import validateGoogleTakeout from '../validators/googleTakeoutValidator';
import {
  htmlEntry, page, at, makeFile, playGamesFiles,
} from './__fixtures__/takeoutBuilders';

// Reference time: the window start is 2026-05-20 for the default 6 months.
const NOW = new Date('2026-11-20T12:00:00Z');
const opts = (extra = {}) => ({ now: NOW, ...extra });

const YT = 'Takeout/YouTube and YouTube Music/history/';
const FIT = 'Takeout/Fit/';
const GH = 'Takeout/Google Health/Physical Activity_GoogleData/';
const csv = (header, rows) => [header, ...rows].join('\n') + '\n';
const session = (iso, minutes = 30) => JSON.stringify({
  fitnessActivity: 'walking',
  startTime: iso,
  endTime: new Date(Date.parse(iso) + minutes * 60000).toISOString(),
  duration: `${minutes * 60}s`,
  aggregate: [{ metricName: 'com.google.step_count.delta', intValue: 3000 }],
});

// Zip 1: YouTube only (two recent days, two events from January that fall outside the window).
const youtubeZip = () => makeFile({
  [`${YT}watch-history.html`]: page([
    htmlEntry({ stamp: at(19, '10:00:00 AM') }),
    htmlEntry({ stamp: at(19, '9:00:00 AM') }),
    htmlEntry({ stamp: at(20, '9:00:00 AM', 'GMT', 'Jan', 2026) }),
    htmlEntry({ stamp: at(10, '9:00:00 AM', 'GMT', 'Jan', 2026) }),
  ]),
  [`${YT}search-history.html`]: page([htmlEntry({ verb: 'Searched for', stamp: at(19, '8:00:00 AM') })]),
});

// Zip 2 parts: Fit + Google Health, each with one recent and one old day/session.
const fitFiles = {
  [`${FIT}Daily activity metrics/Daily activity metrics.csv`]: csv(
    'Date,Move Minutes count,Calories (kcal),Distance (m),Step count',
    ['2026-11-01,30,2000,5000,8000', '2026-03-01,20,1800,3000,4000'],
  ),
  [`${FIT}All Sessions/2026-10-05T10_00_00.000Z_Walking.json`]: session('2026-10-05T10:00:00.000Z'),
  [`${FIT}All Sessions/2025-01-01T10_00_00.000Z_Walking.json`]: session('2025-01-01T10:00:00.000Z'),
};
const healthFiles = {
  [`${GH}Steps/steps_2026-11-01.csv`]: csv('timestamp,steps,data source', [
    '2026-11-01T09:00:00.000Z,4000,Google Health App',
    '2026-11-02T09:00:00.000Z,2500,Google Health App',
  ]),
  [`${GH}Steps/steps_2025-01-01.csv`]: csv('timestamp,steps,data source', ['2025-01-02T09:00:00.000Z,1000,Google Health App']),
};

// Play Games: synthetic files (real exports hold personal data, so none is committed).
const loadPlayGamesFiles = async () => playGamesFiles();

const healthZip = () => makeFile({ ...fitFiles, ...healthFiles });
const moviesFiles = {
  'Takeout/Google Play Movies & TV/Watchlist.json': JSON.stringify({ items: [{ title: 'Synthetic Film', added_time: 'Nov 2, 2026, 4:32:51 AM GMT' }] }),
};
const everythingZip = async () => makeFile({ ...fitFiles, ...healthFiles, ...moviesFiles, ...(await loadPlayGamesFiles()) });
const rows = (result, table) => (result.data[table] || []);

describe('parseGoogleTakeout', () => {
  test('merges every service from several zips under source-labelled tables', async () => {
    const result = await parseGoogleTakeout([await youtubeZip(), await everythingZip()], undefined, opts({ windowMonths: 0 }));
    expect(Object.keys(result.data).sort()).toEqual([
      'Google Fit - Activity Sessions',
      'Google Fit - Daily Activity',
      'Google Health - Daily Activity',
      'Play Games - Daily Playtime',
      'Play Games - Game Activity',
      'Play Movies & TV - Watchlist',
      'YouTube - Daily Activity',
      'YouTube - Viewing Sessions',
    ]);
    expect(result.metadata.services.sort()).toEqual(['Google Fit', 'Google Health', 'Play Games', 'Play Movies & TV', 'YouTube']);
  });

  test('drops rows older than the window and counts them per table', async () => {
    const result = await parseGoogleTakeout([await youtubeZip(), await everythingZip()], undefined, opts());
    expect(rows(result, 'Google Fit - Daily Activity')).toHaveLength(1);
    expect(rows(result, 'Google Fit - Activity Sessions')).toHaveLength(1);
    expect(rows(result, 'Google Health - Daily Activity').map((r) => r.Date)).toEqual(['2026-11-01', '2026-11-02']);
    expect(rows(result, 'YouTube - Daily Activity').map((r) => r.Date)).toEqual(['2026-11-19']);
    expect(rows(result, 'YouTube - Viewing Sessions')).toHaveLength(2); // 09:00 and 10:00 are 60 min apart, default gap is 30
  });

  test('reports what was dropped so the donor can see it', async () => {
    const result = await parseGoogleTakeout([await youtubeZip(), await everythingZip()], undefined, opts());
    const { window } = result.metadata;
    expect(window.months).toBe(6);
    expect(window.cutoff).toBe('2026-05-20');
    expect(window.droppedRowCounts['Google Fit - Daily Activity']).toBe(1);
    expect(window.droppedRowCounts['Google Fit - Activity Sessions']).toBe(1);
    expect(window.droppedRowCounts['Google Health - Daily Activity']).toBe(1);
    expect(window.droppedRowCounts['YouTube - Daily Activity']).toBe(2);
    expect(window.totalDropped).toBe(Object.values(window.droppedRowCounts).reduce((a, b) => a + b, 0));
  });

  test('drops Play Games data from 2025 under a 6-month window but keeps it under 24 months', async () => {
    const all = await parseGoogleTakeout(await everythingZip(), undefined, opts({ windowMonths: 0 }));
    const total = rows(all, 'Play Games - Daily Playtime').length;
    expect(total).toBeGreaterThan(0);

    const six = await parseGoogleTakeout(await everythingZip(), undefined, opts({ windowMonths: 6 }));
    expect(rows(six, 'Play Games - Daily Playtime')).toHaveLength(0);
    expect(six.metadata.window.droppedRowCounts['Play Games - Daily Playtime']).toBe(total);

    const twentyFour = await parseGoogleTakeout(await everythingZip(), undefined, opts({ windowMonths: 24 }));
    expect(rows(twentyFour, 'Play Games - Daily Playtime')).toHaveLength(total);
  });

  test('accepts a single File as well as an array, in any order', async () => {
    const single = await parseGoogleTakeout(await healthZip(), undefined, opts());
    expect(Object.keys(single.data).sort()).toEqual(['Google Fit - Activity Sessions', 'Google Fit - Daily Activity', 'Google Health - Daily Activity']);

    const ab = await parseGoogleTakeout([await youtubeZip(), await healthZip()], undefined, opts());
    const ba = await parseGoogleTakeout([await healthZip(), await youtubeZip()], undefined, opts());
    expect(Object.keys(ab.data).sort()).toEqual(Object.keys(ba.data).sort());
    expect(rows(ab, 'YouTube - Daily Activity')).toEqual(rows(ba, 'YouTube - Daily Activity'));
  });

  test('does not report a service as broken just because another zip holds it', async () => {
    const result = await parseGoogleTakeout(await youtubeZip(), undefined, opts());
    expect(result.parsingErrors.tablesNotParsed).toEqual([]);
    expect(result.parsingErrors.sheetsNotFound).toEqual(['Google Fit', 'Google Health', 'Play Games', 'Play Movies & TV']);
  });

  test('merges the same table when a service is split across zips, oldest first', async () => {
    const partA = await makeFile({ [`${FIT}All Sessions/2026-10-05T10_00_00.000Z_Walking.json`]: session('2026-10-05T10:00:00.000Z') });
    const partB = await makeFile({ [`${FIT}All Sessions/2026-09-01T10_00_00.000Z_Walking.json`]: session('2026-09-01T10:00:00.000Z') });
    const result = await parseGoogleTakeout([partA, partB], undefined, opts());
    const sessions = rows(result, 'Google Fit - Activity Sessions');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]._timestamp).toBeLessThan(sessions[1]._timestamp);
  });

  test('passes the YouTube session gap through as a parameter', async () => {
    const byDefault = await parseGoogleTakeout(await youtubeZip(), undefined, opts());
    const wide = await parseGoogleTakeout(await youtubeZip(), undefined, opts({ youtubeSessionGapMinutes: 120 }));
    expect(rows(byDefault, 'YouTube - Viewing Sessions')).toHaveLength(2);
    expect(rows(wide, 'YouTube - Viewing Sessions')).toHaveLength(1);
  });

  test('keeps going when one file is not a zip', async () => {
    const notZip = new File(['definitely not a zip'], 'notes.zip', { type: 'application/zip' });
    const result = await parseGoogleTakeout([notZip, await youtubeZip()], undefined, opts());
    expect(rows(result, 'YouTube - Daily Activity')).toHaveLength(1);
    expect(result.parsingErrors.tablesNotParsed.some((e) => /ZIP/i.test(e.reason))).toBe(true);
  });

  test('explains when everything found is older than the window', async () => {
    const result = await parseGoogleTakeout(await makeFile(await loadPlayGamesFiles()), undefined, opts());
    expect(result.data).toEqual({});
    const note = result.parsingErrors.tablesNotParsed.find((e) => /window/i.test(e.sheetName));
    expect(note.reason).toMatch(/2026-05-20/);
    expect(validateGoogleTakeout(result).valid).toBe(false);
  });

  test('reports progress from 0 up to 1', async () => {
    const seen = [];
    await parseGoogleTakeout([await youtubeZip(), await healthZip()], (f) => seen.push(f), opts());
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBe(1);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  });

  test('a donor with no Takeout data gets a clear, empty result', async () => {
    const result = await parseGoogleTakeout(await makeFile({ 'Takeout/Mail/mbox.txt': 'x' }), undefined, opts());
    expect(result.data).toEqual({});
    expect(result.parsingErrors.sheetsNotFound).toEqual(['Google Fit', 'Google Health', 'Play Games', 'Play Movies & TV', 'YouTube']);
    expect(validateGoogleTakeout(result).valid).toBe(false);
  });
});

describe('googleTakeoutValidator', () => {
  test('accepts a result with at least one non-empty table', () => {
    expect(validateGoogleTakeout({ data: { A: [{ x: 1 }] } }).valid).toBe(true);
  });

  test.each([undefined, {}, { data: {} }, { data: { A: [] } }])('rejects %p', (input) => {
    expect(validateGoogleTakeout(input).valid).toBe(false);
  });

  test('says when data existed but was all outside the window', () => {
    const verdict = validateGoogleTakeout({ data: {}, metadata: { window: { months: 6, totalDropped: 12 } } });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/6 months/);
  });
});

describe('review fixes (parseGoogleTakeout)', () => {
  const activityHtml = (first, last) => '<html><body><table class="mdl-data-table">'
    + `<tr><td>Time First Played</td><td>${first}</td></tr><tr><td>Time Last Played</td><td>${last}</td></tr></table></body></html>`;
  const gamesPath = (name) => `Takeout/Google Play Games Services/Games/${name}/Activity.html`;

  test('the same zip selected twice does not double the rows', async () => {
    // Fit and Health run once per zip, so a repeated part would double their rows without de-duplication.
    const once = await parseGoogleTakeout(await healthZip(), undefined, opts());
    const twice = await parseGoogleTakeout([await healthZip(), await healthZip()], undefined, opts());
    expect(rows(once, 'Google Fit - Daily Activity')).toHaveLength(1);
    expect(rows(twice, 'Google Fit - Daily Activity')).toHaveLength(1);
    expect(rows(twice, 'Google Health - Daily Activity')).toEqual(rows(once, 'Google Health - Daily Activity'));
    expect(rows(twice, 'Google Fit - Activity Sessions')).toHaveLength(1);
  });

  test('YouTube watch and search history split across two zips give one row per day', async () => {
    const watchPart = await makeFile({ [`${YT}watch-history.html`]: page([htmlEntry({ stamp: at(19, '9:00:00 AM') })]) }, 'DEFLATE', 'watch.zip');
    const searchPart = await makeFile({ [`${YT}search-history.html`]: page([htmlEntry({ verb: 'Searched for', stamp: at(19, '8:00:00 AM') })]) }, 'DEFLATE', 'search.zip');
    const result = await parseGoogleTakeout([watchPart, searchPart], undefined, opts());
    expect(rows(result, 'YouTube - Daily Activity')).toHaveLength(1);
  });

  test('rows with no usable date are dropped while a window is active (and kept when it is not)', async () => {
    const file = await makeFile({
      [`${FIT}Daily activity metrics/Daily activity metrics.csv`]: csv(
        'Date,Move Minutes count,Step count',
        ['2026-11-01,30,8000', 'not-a-date,20,4000'],
      ),
    });
    const windowed = await parseGoogleTakeout(file, undefined, opts());
    expect(rows(windowed, 'Google Fit - Daily Activity')).toHaveLength(1);
    expect(windowed.metadata.window.droppedRowCounts['Google Fit - Daily Activity']).toBe(1);
    expect(windowed.metadata.window.undatedRowCounts['Google Fit - Daily Activity']).toBe(1);

    const unwindowed = await parseGoogleTakeout(file, undefined, opts({ windowMonths: 0 }));
    expect(rows(unwindowed, 'Google Fit - Daily Activity')).toHaveLength(2);
  });

  test('a recent Last Played cannot carry an old First Played into the donation', async () => {
    const file = await makeFile({
      [gamesPath('Recent Game')]: activityHtml('2015-07-06T07:13:22Z', '2026-10-01T07:13:22Z'),
      [gamesPath('Newer Game')]: activityHtml('2026-08-01T07:13:22Z', '2026-10-02T07:13:22Z'),
      [gamesPath('Old Game')]: activityHtml('2015-07-06T07:13:22Z', '2016-01-01T07:13:22Z'),
    });
    const result = await parseGoogleTakeout(file, undefined, opts());
    const games = rows(result, 'Play Games - Game Activity');
    expect(games.map((g) => g['Game Title']).sort()).toEqual(['Newer Game', 'Recent Game']);
    const recent = games.find((g) => g['Game Title'] === 'Recent Game');
    expect(recent['Time First Played']).toBe('Before 2026-05-20');
    expect(JSON.stringify(result)).not.toMatch(/2015/);
    const newer = games.find((g) => g['Game Title'] === 'Newer Game');
    expect(newer['Time First Played']).toMatch(/2026/);
  });

  test('YouTube sessions and daily rows are windowed by the same printed day', async () => {
    // 00:30 EET on 20 May is 22:30 UTC on 19 May: the exact instant is before the cut-off, the printed day is not.
    const file = await makeFile({
      [`${YT}watch-history.html`]: page([htmlEntry({ stamp: 'May 20, 2026, 12:30:00 AM EET' })]),
    });
    const result = await parseGoogleTakeout(file, undefined, opts());
    expect(rows(result, 'YouTube - Daily Activity')).toHaveLength(1);
    expect(rows(result, 'YouTube - Viewing Sessions')).toHaveLength(1);
  });

  test('error messages never quote file content', async () => {
    const file = await makeFile({ [`${YT}watch-history.json`]: '[{"title":"x"}, Watched my secret plans' });
    const result = await parseGoogleTakeout(file, undefined, opts());
    expect(JSON.stringify(result.parsingErrors)).not.toMatch(/secret|plans/);
  });

  test('Play Games is read even when the zip also holds a large unrelated file', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    const file = await makeFile({ ...(await loadPlayGamesFiles()), 'Takeout/Fit/All Data/derived_big.json': big }, 'STORE');
    const result = await parseGoogleTakeout(file, undefined, opts({ windowMonths: 24 }));
    expect(rows(result, 'Play Games - Daily Playtime').length).toBeGreaterThan(0);
  });
});

describe('parseGoogleTakeout with excludeVitals', () => {
  const point = (value) => ({
    fitValue: [{ value: { fpVal: value } }],
    startTimeNanos: Date.parse('2026-11-01T09:00:00Z') * 1e6,
    endTimeNanos: Date.parse('2026-11-01T09:00:00Z') * 1e6,
  });
  const stream = (type) => [`${FIT}All Data/derived_${type}_com.google.android.gms_merged.json`,
    JSON.stringify({ 'Data Points': [point(61)] })];
  const vitalsZip = () => makeFile(Object.fromEntries([
    [`${FIT}Daily activity metrics/Daily activity metrics.csv`, csv(
      'Date,Heart Minutes,Average heart rate (bpm),Max heart rate (bpm),Average oxygen saturation (%),Average weight (kg),Step count',
      ['2026-11-01,12,70,120,97,60,8000'],
    )],
    [`${FIT}All Sessions/2026-10-05T10_00_00.000Z_Walking.json`, JSON.stringify({
      fitnessActivity: 'walking', startTime: '2026-10-05T10:00:00.000Z', endTime: '2026-10-05T10:30:00.000Z', duration: '1800s',
      aggregate: [{ metricName: 'com.google.heart_rate.summary', floatValue: 90 },
        { metricName: 'com.google.step_count.delta', intValue: 3000 }],
    })],
    stream('com.google.heart_rate.bpm'),
    stream('com.google.step_count.delta'),
    [`${GH}Steps/steps_2026-11-01.csv`, csv('timestamp,steps,data source', ['2026-11-01T09:00:00.000Z,4000,App'])],
    ['Takeout/Google Health/Global Export Data/resting_heart_rate-2026-11-01.json', JSON.stringify([
      { dateTime: '11/01/26 00:00:00', value: { date: '11/01/26', value: 58 } },
    ])],
  ]));
  const columns = (result) => Object.values(result.data).flatMap((table) => table.flatMap(Object.keys));

  test('donates no heart, blood, breathing or body fields and keeps the activity ones', async () => {
    const result = await parseGoogleTakeout(await vitalsZip(), undefined, opts({ excludeVitals: true }));
    expect(Object.keys(result.data)).not.toContain('Google Fit - Raw Heart Rate');
    expect(Object.keys(result.data)).toContain('Google Fit - Raw Steps');
    expect(columns(result).filter((c) => /heart rate|\bHR\b|HRV|bpm|brpm|oxygen|SpO2|Respiratory|weight/i.test(c))).toEqual([]);
    expect(columns(result)).toEqual(expect.arrayContaining(['Heart Minutes', 'Step count', 'Steps']));
  });

  test('without the option they are still read, so other studies are unchanged', async () => {
    const result = await parseGoogleTakeout(await vitalsZip(), undefined, opts());
    expect(Object.keys(result.data)).toContain('Google Fit - Raw Heart Rate');
    expect(columns(result)).toEqual(expect.arrayContaining(['Average heart rate (bpm)', 'Resting HR (bpm)']));
  });
});
