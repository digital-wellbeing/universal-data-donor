import {
  cleanValue, readStudyInfo, describeStudyInfo, insertStudyInfo, getStudyInfo, resetStudyInfo,
} from './studyInfo';

describe('readStudyInfo', () => {
  test('reads study and ethics from the query string', () => {
    expect(readStudyInfo('?platform=googletakeout&study=Screen%20Time%20Study&ethics=ETH-2026-001'))
      .toEqual({ study: 'Screen Time Study', ethics: 'ETH-2026-001' });
  });
  test('each one is optional', () => {
    expect(readStudyInfo('?study=Only')).toEqual({ study: 'Only', ethics: null });
    expect(readStudyInfo('?ethics=E1')).toEqual({ study: null, ethics: 'E1' });
  });
  test.each(['', '?platform=garmin', '?study=&ethics=%20%20', undefined])('is null for %p', (search) => {
    expect(readStudyInfo(search)).toBeNull();
  });
});

describe('cleanValue', () => {
  test('collapses whitespace and strips control and bidi characters', () => {
    expect(cleanValue('  A \n\t B‮ C\u0000 ')).toBe('A B C');
  });
  test('limits the length', () => {
    expect(cleanValue('x'.repeat(500))).toHaveLength(120);
  });
  test('leaves markup as plain text for React to escape', () => {
    expect(cleanValue('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('insertStudyInfo', () => {
  const info = { study: 'Screen Time Study', ethics: 'ETH-1' };
  test('goes in parentheses after "our study"', () => {
    expect(insertStudyInfo('donating data to our study. We ask', info))
      .toBe('donating data to our study (Screen Time Study; ethics approval: ETH-1). We ask');
  });
  test('handles "our Playstation study"', () => {
    expect(insertStudyInfo('to our Playstation study. The', { study: null, ethics: 'E1' }))
      .toBe('to our Playstation study (ethics approval: E1). The');
  });
  test('goes at the end when the wording has no such phrase', () => {
    expect(insertStudyInfo('Plain intro.', { study: 'S', ethics: null })).toBe('Plain intro. (S)');
  });
  test('changes nothing without details', () => {
    expect(insertStudyInfo('to our study.', null)).toBe('to our study.');
    expect(describeStudyInfo(null)).toBe('');
  });
});

describe('getStudyInfo', () => {
  afterEach(resetStudyInfo);
  test('remembers the first read, even after the query string is gone', () => {
    window.history.pushState({}, '', '/?study=First');
    expect(getStudyInfo()).toEqual({ study: 'First', ethics: null });
    window.history.pushState({}, '', '/upload');
    expect(getStudyInfo()).toEqual({ study: 'First', ethics: null });
    window.history.pushState({}, '', '/');
  });
});
