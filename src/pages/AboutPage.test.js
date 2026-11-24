import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AboutPage from './AboutPage';
import { ConfigContext } from '../ConfigContext';
import { sanitizeAbout } from '../utils/aboutConfig';

const about = {
  title: 'About this tool',
  paragraphs: ['What it is.'],
  source: { label: 'Source code', href: 'https://github.com/x/y' },
  peopleTitle: 'Project team',
  people: [
    { name: 'Ada Lovelace', role: 'Main developer', detail: 'Research Fellow', href: 'https://profiles.example/ada' },
    { name: 'Student One', role: 'Placement student', newRow: true },
  ],
};
afterEach(() => { delete global.fetch; });
const show = (content, config = null) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => content });
  return render(
    <ConfigContext.Provider value={config}>
      <MemoryRouter><AboutPage /></MemoryRouter>
    </ConfigContext.Provider>,
  );
};

test('shows a round photo next to a person who has one', async () => {
  show({ ...about, people: [{ name: 'Ada Lovelace', photo: 'images/team/ada.jpg' }] });
  await screen.findByText('Ada Lovelace');
  const img = document.querySelector('img.ud-person-photo');
  expect(img).toHaveAttribute('src', expect.stringContaining('/images/team/ada.jpg'));
  expect(img).toHaveAttribute('alt', '');
});

test('shows a placeholder silhouette for a person without a photo', async () => {
  show({ ...about, people: [{ name: 'Student One', photo: '' }, { name: 'Ada Lovelace', photo: 'images/team/ada.jpg' }] });
  await screen.findByText('Student One');
  expect(screen.getByText('Student One').closest('li').querySelector('.ud-person-placeholder')).toBeInTheDocument();
  expect(screen.getByText('Ada Lovelace').closest('li').querySelector('.ud-person-placeholder')).toBeNull();
});

test('shows the intro, the source link and the project team', async () => {
  show(about);
  expect(await screen.findByRole('heading', { name: 'About this tool' })).toBeInTheDocument();
  expect(screen.getByText('What it is.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute('rel', 'noopener noreferrer');
  const team = screen.getByRole('region', { name: 'Project team' });
  expect(within(team).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', 'https://profiles.example/ada');
  expect(within(team).getByText('Main developer')).toBeInTheDocument();
  expect(within(team).getByText('Research Fellow')).toBeInTheDocument();
  expect(within(team).queryByRole('link', { name: 'Student One' })).toBeNull();
  expect(within(team).getByText('Student One').closest('li')).toHaveClass('ud-person-newrow');
  expect(within(team).getByText('Ada Lovelace').closest('li')).not.toHaveClass('ud-person-newrow');
});

test('opened directly (no platform loaded), Back is a full page load to the start page', async () => {
  show(about, null);
  const back = await screen.findByRole('link', { name: 'Back to start' });
  expect(back).toHaveAttribute('href', '/datadonation/');
});

test('says so when there is nothing to show', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  render(<ConfigContext.Provider value={null}><MemoryRouter><AboutPage /></MemoryRouter></ConfigContext.Provider>);
  expect(await screen.findByText(/no information to show/i)).toBeInTheDocument();
});

describe('sanitizeAbout', () => {
  test('keeps http(s) links only and drops unnamed people', () => {
    const a = sanitizeAbout({
      paragraphs: ['x'], source: { label: 's', href: 'javascript:alert(1)' },
      people: [{ name: 'A', href: 'javascript:x', photo: 'https://evil.example/a.jpg' }, { role: 'no name' }, { name: 'B', href: 'https://b.example' }],
    });
    expect(a.source).toBeNull();
    expect(a.people.map((p) => [p.name, p.href])).toEqual([['A', ''], ['B', 'https://b.example']]);
    expect(a.people.every((p) => p.newRow === false)).toBe(true);
  });
  test('accepts photo paths inside public/ only', () => {
    const photo = (value) => sanitizeAbout({ paragraphs: ['x'], people: [{ name: 'A', photo: value }] }).people[0].photo;
    expect(photo('images/team/a.jpg')).toBe('images/team/a.jpg');
    expect(photo('/images/team/a.PNG')).toBe('images/team/a.PNG');
    expect(photo('https://evil.example/a.jpg')).toBe('');
    expect(photo('../secret.jpg')).toBe('');
    expect(photo('images/team/a.svg')).toBe('');
  });
  test('null when empty or junk', () => {
    expect(sanitizeAbout({})).toBeNull();
    expect(sanitizeAbout(null)).toBeNull();
  });
});
