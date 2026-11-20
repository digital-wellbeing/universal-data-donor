import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import PlatformSelector from './PlatformSelector';

// Match a tile by its exact name element: other tiles' descriptions also say "Google Takeout".
const tileNamed = (container, name) => [...container.querySelectorAll('button.platform-card')]
  .find((tile) => tile.querySelector('.platform-name')?.textContent === name);

describe('PlatformSelector', () => {
  test('shows the Google Takeout tile, in "Screen time & gaming", with its logo', () => {
    const { container } = render(<PlatformSelector onSelectPlatform={() => {}} />);

    const tile = tileNamed(container, 'Google Takeout');
    expect(tile).toBeTruthy();

    const logo = tile.querySelector('img.platform-logo');
    expect(logo).not.toBeNull();
    expect(logo.getAttribute('src')).toMatch(/googletakeout-logo\.svg$/);

    expect(tile.closest('section').querySelector('h2').textContent).toBe('Screen time & gaming');
  });

  test('selecting the Google Takeout tile reports the googletakeout platform id', () => {
    const onSelectPlatform = jest.fn();
    const { container } = render(<PlatformSelector onSelectPlatform={onSelectPlatform} />);

    fireEvent.click(tileNamed(container, 'Google Takeout'));
    expect(onSelectPlatform).toHaveBeenCalledWith('googletakeout');
  });

  test('every tile shown on the homepage has a logo', () => {
    const { container } = render(<PlatformSelector onSelectPlatform={() => {}} />);
    const tiles = container.querySelectorAll('button.platform-card');
    expect(tiles.length).toBeGreaterThan(0);
    tiles.forEach((tile) => {
      expect(tile.querySelector('img.platform-logo')?.getAttribute('src')).toMatch(/\.svg$/);
    });
  });
});
