import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { ConfigContext } from './ConfigContext';
import config from '../public/config.json';

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

