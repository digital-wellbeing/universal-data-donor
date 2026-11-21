import React, { useEffect, useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { getThemeName, loadTheme, applyTheme, buildMuiTheme } from './utils/theme';

const FALLBACK = createTheme();

/**
 * Loads the colour theme (`?theme=` or the default) and applies it to the whole app.
 * If the theme cannot be loaded the app still renders, with the built-in colours.
 */
export default function ThemeLoader({ children }) {
  const [muiTheme, setMuiTheme] = useState(null);

  useEffect(() => {
    let active = true;
    const name = getThemeName();
    loadTheme(name)
      .then((theme) => (theme || (name === 'default' ? null : loadTheme('default'))))
      .then((theme) => {
        if (!active) return;
        if (theme) applyTheme(theme);
        setMuiTheme(theme ? buildMuiTheme(theme) : FALLBACK);
      });
    return () => { active = false; };
  }, []);

  if (!muiTheme) return null; // a few ms, avoids a flash of the wrong colours
  return <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>;
}
