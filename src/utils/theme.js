import { createTheme } from '@mui/material/styles';

/**
 * Colour themes. A theme is a small JSON file in `public/themes/<name>.json`:
 *   { "name": "...", "colors": { primary, primaryHover, onPrimary, onPrimaryHover,
 *                                secondary, accent, link, headerBackground, headerText } }
 * Every colour is a 6-digit hex value; anything else is ignored, so a theme file can
 * only ever set colours. The theme is picked with `?theme=<name>` (captured once at
 * startup, like the study details) and otherwise DEFAULT_THEME is used.
 */

export const DEFAULT_THEME = 'surrey';

const NAME = /^[a-z0-9-]{1,32}$/;
const HEX = /^#[0-9a-f]{6}$/i;

/** CSS custom properties each colour key drives (declared with defaults in theme.css). */
export const COLOR_VARS = {
  primary: '--ud-primary',
  primaryHover: '--ud-primary-hover',
  onPrimary: '--ud-on-primary',
  onPrimaryHover: '--ud-on-primary-hover',
  secondary: '--ud-secondary',
  accent: '--ud-accent',
  link: '--ud-link',
  headerBackground: '--ud-header-bg',
  headerText: '--ud-header-text',
};

/** Theme name from a query string; null when absent or not a plain lowercase name. */
export const readThemeName = (search) => {
  const value = new URLSearchParams(search || '').get('theme');
  const name = value ? value.trim().toLowerCase() : '';
  return NAME.test(name) ? name : null;
};

let captured;

/** The theme name for this visit; captured on first call because navigation drops the query string. */
export const getThemeName = () => {
  if (captured === undefined) captured = readThemeName(window.location.search) || DEFAULT_THEME;
  return captured;
};

export const resetThemeName = () => { captured = undefined; };

/** Keep only known colour keys with valid hex values. */
export const sanitizeTheme = (raw) => {
  const colors = {};
  const source = raw && typeof raw === 'object' && raw.colors && typeof raw.colors === 'object' ? raw.colors : {};
  Object.keys(COLOR_VARS).forEach((key) => {
    if (typeof source[key] === 'string' && HEX.test(source[key].trim())) colors[key] = source[key].trim();
  });
  const name = raw && typeof raw.name === 'string' ? raw.name.slice(0, 80) : '';
  return { name, colors };
};

/** Fetch and sanitise a theme file; null when it is missing or unreadable. */
export const loadTheme = async (name) => {
  if (!NAME.test(name)) return null;
  try {
    const response = await fetch(`${process.env.PUBLIC_URL}/themes/${name}.json`);
    if (!response.ok) return null;
    const theme = sanitizeTheme(await response.json());
    return Object.keys(theme.colors).length ? theme : null;
  } catch (error) {
    return null;
  }
};

/** Set the theme's colours as CSS variables on the page and tint the browser UI. */
export const applyTheme = (theme, root = document.documentElement) => {
  Object.entries(theme.colors).forEach(([key, value]) => root.style.setProperty(COLOR_VARS[key], value));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && theme.colors.headerBackground) meta.setAttribute('content', theme.colors.headerBackground);
};

/** MUI theme for the data grid, buttons and fields. Missing colours keep MUI's defaults. */
export const buildMuiTheme = (theme) => {
  const { primary, secondary, onPrimary } = theme.colors;
  const palette = {};
  if (primary) palette.primary = { main: primary, ...(onPrimary ? { contrastText: onPrimary } : {}) };
  if (secondary) palette.secondary = { main: secondary };
  return createTheme({ palette });
};
