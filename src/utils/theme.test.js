import {
  DEFAULT_THEME, readThemeName, getThemeName, resetThemeName, sanitizeTheme, loadTheme, applyTheme, buildMuiTheme,
} from './theme';

const surrey = { name: 'S', colors: { primary: '#25384A', accent: '#F1B53D', headerBackground: '#25384A' } };

describe('readThemeName', () => {
  test('reads a plain lowercase name', () => expect(readThemeName('?theme=Surrey')).toBe('surrey'));
  test('null when absent', () => expect(readThemeName('')).toBeNull());
  test.each(['../x', 'a b', '<b>', 'a'.repeat(33), ''])('rejects %p', (v) => {
    expect(readThemeName(`?theme=${encodeURIComponent(v)}`)).toBeNull();
  });
});

describe('getThemeName', () => {
  afterEach(() => { resetThemeName(); window.history.pushState({}, '', '/'); });
  test('falls back to the default theme', () => expect(getThemeName()).toBe(DEFAULT_THEME));
  test('is captured once, so navigation cannot lose it', () => {
    window.history.pushState({}, '', '/?theme=default');
    expect(getThemeName()).toBe('default');
    window.history.pushState({}, '', '/upload');
    expect(getThemeName()).toBe('default');
  });
});

describe('sanitizeTheme', () => {
  test('keeps valid hex colours only', () => {
    const t = sanitizeTheme({ name: 'x', colors: { primary: '#abcdef', accent: 'red', link: 'url(x)', headerText: '#12345', bogus: '#000000' } });
    expect(t.colors).toEqual({ primary: '#abcdef' });
  });
  test('survives junk input', () => {
    expect(sanitizeTheme(null).colors).toEqual({});
    expect(sanitizeTheme({ colors: 'x' }).colors).toEqual({});
  });
});

describe('loadTheme', () => {
  afterEach(() => { delete global.fetch; });
  test('returns the sanitised theme', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => surrey });
    expect((await loadTheme('surrey')).colors.primary).toBe('#25384A');
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/themes\/surrey\.json$/);
  });
  test('null for a missing file, a bad name or a fetch error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    expect(await loadTheme('nope')).toBeNull();
    expect(await loadTheme('../etc')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('x'));
    expect(await loadTheme('surrey')).toBeNull();
  });
});

describe('applyTheme / buildMuiTheme', () => {
  test('sets CSS variables and the browser theme colour', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    applyTheme(surrey);
    expect(document.documentElement.style.getPropertyValue('--ud-primary')).toBe('#25384A');
    expect(document.documentElement.style.getPropertyValue('--ud-accent')).toBe('#F1B53D');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#25384A');
  });
  test('MUI primary follows the theme', () => {
    expect(buildMuiTheme(surrey).palette.primary.main).toBe('#25384A');
  });
});
