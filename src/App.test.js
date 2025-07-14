import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders consent page on initial load', () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
  const linkElement = screen.getByText(/I have read and agree with the above terms/i);
  expect(linkElement).toBeInTheDocument();
});
