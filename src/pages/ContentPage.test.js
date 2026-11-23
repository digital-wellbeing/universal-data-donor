import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentPage from './ContentPage';
import { ConfigContext } from '../ConfigContext';
import { sanitizeContent, loadContent, CONTENT_SLUGS } from '../utils/contentConfig';

const page = {
  title: 'Cookies and browser storage',
  intro: 'Intro text.',
  sections: [
    { heading: 'What we store', items: ['Cookies: none.'], paragraphs: ['Para.'], links: [{ label: 'Policy', href: 'https://www.surrey.ac.uk/cookies' }] },
  ],
};
afterEach(() => { delete global.fetch; });
const show = (content, slug = 'cookies') => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => content });
  return render(<ConfigContext.Provider value={null}><MemoryRouter><ContentPage slug={slug} /></MemoryRouter></ConfigContext.Provider>);
};

test('renders title, intro, sections with lists and external links', async () => {
  show(page);
  expect(await screen.findByRole('heading', { level: 1, name: 'Cookies and browser storage' })).toBeInTheDocument();
  expect(screen.getByText('Intro text.')).toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'What we store' });
  expect(within(section).getByText('Cookies: none.')).toBeInTheDocument();
  expect(within(section).getByRole('link', { name: 'Policy' })).toHaveAttribute('target', '_blank');
  expect(global.fetch.mock.calls[0][0]).toMatch(/content\/cookies\.json$/);
});

test('says so for an unknown slug without fetching anything', async () => {
  global.fetch = jest.fn();
  render(<ConfigContext.Provider value={null}><MemoryRouter><ContentPage slug="../secrets" /></MemoryRouter></ConfigContext.Provider>);
  expect(await screen.findByText(/no information to show/i)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

describe('sanitizeContent', () => {
  test('keeps http(s) and mailto links only', () => {
    const c = sanitizeContent({ title: 'T', intro: 'i', sections: [{ heading: 'H', links: [
      { label: 'a', href: 'javascript:alert(1)' }, { label: 'b', href: 'mailto:x@y.z' }, { label: 'c', href: 'https://c.example' }] }] });
    expect(c.sections[0].links.map((l) => l.label)).toEqual(['b', 'c']);
  });
  test('null without a title or content', () => {
    expect(sanitizeContent({})).toBeNull();
    expect(sanitizeContent({ title: 'T' })).toBeNull();
    expect(sanitizeContent(null)).toBeNull();
  });
  test('loadContent refuses slugs outside the whitelist', async () => {
    expect(await loadContent('config-googletakeout')).toBeNull();
  });
});

describe('the shipped statements', () => {
  test.each(CONTENT_SLUGS)('%s.json is valid and says what the code actually does', (slug) => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, `../../public/content/${slug}.json`), 'utf8'));
    expect(sanitizeContent(raw)).not.toBeNull();
  });

  test('the cookie statement names the one storage key the app really writes, and no cookies', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/content/cookies.json'), 'utf8'));
    const tour = fs.readFileSync(path.join(__dirname, '../components/filterTour.js'), 'utf8');
    const key = tour.match(/SEEN_KEY\s*=\s*'([^']+)'/)[1];
    expect(JSON.stringify(raw)).toContain(key);
    expect(JSON.stringify(raw)).toMatch(/Cookies: none/);
  });

  test('the cookie statement explains cookies that arrive from other surrey.ac.uk websites', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/content/cookies.json'), 'utf8'));
    const section = raw.sections.find((s) => /other University of Surrey websites/.test(s.heading));
    expect(section).toBeDefined();
    expect(section.paragraphs.join(' ')).toMatch(/did not set them, does not read or use them, and does not store them/);
  });
});
