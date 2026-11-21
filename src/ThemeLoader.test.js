import React from 'react';
import { render, screen } from '@testing-library/react';
import ThemeLoader from './ThemeLoader';
import { resetThemeName } from './utils/theme';

afterEach(() => { delete global.fetch; resetThemeName(); window.history.pushState({}, '', '/'); document.documentElement.removeAttribute('style'); });

test('applies the theme named in the URL, then renders the app', async () => {
  window.history.pushState({}, '', '/?theme=surrey');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ colors: { primary: '#25384A' } }) });
  render(<ThemeLoader><p>app</p></ThemeLoader>);
  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(global.fetch.mock.calls[0][0]).toMatch(/themes\/surrey\.json$/);
  expect(document.documentElement.style.getPropertyValue('--ud-primary')).toBe('#25384A');
});

test('an unknown theme falls back to the default theme file', async () => {
  window.history.pushState({}, '', '/?theme=nope');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ colors: { primary: '#1976D2' } }) });
  render(<ThemeLoader><p>app</p></ThemeLoader>);
  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(global.fetch.mock.calls[1][0]).toMatch(/themes\/default\.json$/);
});

test('still renders the app when no theme can be loaded', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<ThemeLoader><p>app</p></ThemeLoader>);
  expect(await screen.findByText('app')).toBeInTheDocument();
});
