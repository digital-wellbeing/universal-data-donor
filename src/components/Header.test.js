import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';
import { sanitizeHeader } from '../utils/headerConfig';

afterEach(() => { delete global.fetch; });
const show = (value) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => value });
  return render(<MemoryRouter><Header /></MemoryRouter>);
};

test('shows the tool name as a link to the start page, the tagline and an About link', async () => {
  show({ title: 'Universal Data Donor', tagline: 'Donate your data' });
  const header = await screen.findByRole('banner');
  expect(within(header).getByRole('link', { name: 'Universal Data Donor' })).toHaveAttribute('href', '/');
  expect(within(header).getByText('Donate your data')).toBeInTheDocument();
  expect(within(header).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
});

test('renders nothing when header.json is missing or has no title', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  const { container } = render(<MemoryRouter><Header /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
  expect(sanitizeHeader({ tagline: 'x' })).toBeNull();
  expect(sanitizeHeader(null)).toBeNull();
});
