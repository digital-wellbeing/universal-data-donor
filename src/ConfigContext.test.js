import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Link, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from './ConfigContext';

// Like index.js: the footer (with the About link) sits next to the provider, not inside it.
const app = (
  <>
    <ConfigProvider>
      <Routes>
        <Route path="/about" element={<p>about page content</p>} />
        <Route path="/" element={<p>start page content</p>} />
      </Routes>
    </ConfigProvider>
    <Link to="/about">go to about</Link>
  </>
);

afterEach(() => { delete global.fetch; window.history.pushState({}, '', '/'); });

test('shows the platform picker on the homepage when no platform is given', async () => {
  render(<MemoryRouter initialEntries={['/']}>{app}</MemoryRouter>);
  expect(await screen.findByRole('heading', { level: 1, name: 'Select the platform you want to donate data from' })).toBeInTheDocument(); // the picker
  expect(screen.queryByText('start page content')).toBeNull();
});

test('the About page opens directly, without the picker', async () => {
  render(<MemoryRouter initialEntries={['/about']}>{app}</MemoryRouter>);
  expect(await screen.findByText('about page content')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: 'Select the platform you want to donate data from' })).toBeNull();
});

test('the About page also opens from the platform picker (client-side navigation)', async () => {
  render(<MemoryRouter initialEntries={['/']}>{app}</MemoryRouter>);
  await screen.findByRole('heading', { level: 1, name: 'Select the platform you want to donate data from' }); // the picker is showing
  fireEvent.click(screen.getByText('go to about'));
  expect(await screen.findByText('about page content')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: 'Select the platform you want to donate data from' })).toBeNull(); // the picker is gone
});

test.each(['/cookies', '/accessibility'])('the %s page also opens without a platform', async (route) => {
  render(<MemoryRouter initialEntries={[route]}><ConfigProvider><p>info page content</p></ConfigProvider></MemoryRouter>);
  expect(await screen.findByText('info page content')).toBeInTheDocument();
});
