import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { ConfigContext } from './ConfigContext';

// The real PlayStation config (the shape the app reads: `general`, `header`, `page`).
const config = require('../public/config-playstation.json');

test('renders consent page on initial load', () => {
  render(
    <ConfigContext.Provider value={config}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </ConfigContext.Provider>
  );
  const linkElement = screen.getByText(/I have read and agree with the above terms/i);
  expect(linkElement).toBeInTheDocument();
});

