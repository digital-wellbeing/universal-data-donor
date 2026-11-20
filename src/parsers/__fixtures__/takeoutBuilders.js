import JSZip from 'jszip';

/**
 * Builders for synthetic Google Takeout fixtures. They mirror the structure of
 * real exports (outer-cell blocks, U+202F before AM/PM, tz abbreviations) but
 * contain no real data: real exports hold personal information, so none is
 * committed.
 */

export const NNBSP = ' ';

/** One HTML history entry, shaped like Google's `watch-history.html`. */
export const htmlEntry = ({
  product = 'YouTube', verb = 'Watched', title = 'Synthetic Title', stamp, ad = false, link = true,
}) =>
  '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid">'
  + `<div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">${product}<br></p></div>`
  + '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">'
  + (link
    ? `${verb} <a href="https://www.youtube.com/watch?v=SECRETID">${title}</a><br>`
      + '<a href="https://www.youtube.com/channel/UCSECRET">Secret Channel</a><br>'
    : `${verb}<br>`)
  + `${stamp}</div>`
  + '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div>'
  + `<div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;${product}<br>`
  + `${ad ? '<b>Details:</b><br>&emsp;From Google Ads<br>' : ''}</div></div></div>`;

/** Wrap entries in a minimal page. */
export const page = (entries) =>
  `<html><head><style>.outer-cell{margin:0}</style></head><body><div class="mdl-grid">${entries.join('')}</div></body></html>`;

/** A timestamp as Google prints it, e.g. `at(19, '9:00:00 AM')` for 19 Nov 2026 GMT. */
export const at = (day, time, tz = 'GMT', month = 'Nov', year = 2026) => `${month} ${day}, ${year}, ${time}${NNBSP}${tz}`;

/** Build a zip File from a `{path: content}` map. */
export const makeFile = async (files, compression = 'DEFLATE', name = 'takeout.zip') => {
  const zip = new JSZip();
  Object.entries(files).forEach(([path, content]) => zip.file(path, content));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression });
  return new File([bytes], name, { type: 'application/zip' });
};

/**
 * Synthetic Google Play Games Services files (HTML) as a `{path: content}` map.
 * Playtime is dated Sep-Oct 2025 and the games' activity 2015-2016, so a 2026
 * window drops all of it while a 24-month window keeps the playtime.
 */
export const playGamesFiles = () => {
  const header = '<tr><th>Package Name</th><th>Duration</th><th>First Session Start</th><th>Last Session End</th><th>Number of Sessions</th></tr>';
  const day = (label, long, pkg) => `<tr><td>${label}</td><td><table class="mdl-data-table inner-table">${header}`
    + `<tr><td>${pkg}</td><td>30 minutes</td><td>${long} at 10:00:00 AM GMT+1</td><td>${long} at 10:30:00 AM GMT+1</td><td>1</td></tr></table></td></tr>`;
  const activity = (first, last) => '<table class="mdl-data-table"><tr><th>Field</th><th>Value</th></tr>'
    + `<tr><td>Time First Played</td><td>${first}</td></tr><tr><td>Time Last Played</td><td>${last}</td></tr></table>`;
  const root = 'Takeout/Google Play Games Services';
  return {
    [`${root}/Global/Playtime.html`]: '<table class="mdl-data-table">'
      + day('Sep 30, 2025', 'September 30, 2025', 'com.example.one')
      + day('Oct 1, 2025', 'October 1, 2025', 'com.example.two')
      + day('Oct 2, 2025', 'October 2, 2025', 'com.example.one')
      + '</table>',
    [`${root}/Games/Synthetic Game One/Activity.html`]: activity('2015-07-06T07:13:22Z', '2015-10-16T11:30:27Z'),
    [`${root}/Games/Synthetic Game Two/Activity.html`]: activity('2016-01-02T08:00:00Z', '2016-02-03T09:30:00Z'),
  };
};
