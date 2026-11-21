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
      people: [{ name: 'A', href: 'javascript:x' }, { role: 'no name' }, { name: 'B', href: 'https://b.example' }],
    });
    expect(a.source).toBeNull();
    expect(a.people.map((p) => [p.name, p.href])).toEqual([['A', ''], ['B', 'https://b.example']]);
    expect(a.people.every((p) => p.newRow === false)).toBe(true);
  });
  test('null when empty or junk', () => {
    expect(sanitizeAbout({})).toBeNull();
    expect(sanitizeAbout(null)).toBeNull();
  });
});
