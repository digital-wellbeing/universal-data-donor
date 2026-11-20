import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConsentPage from './ConsentPage';
import { ConfigContext } from '../ConfigContext';

const renderWith = (config) => render(
  <ConfigContext.Provider value={config}>
    <MemoryRouter><ConsentPage /></MemoryRouter>
  </ConfigContext.Provider>,
);

const baseConsent = {
  title: 'Study', intro: 'intro text', process: 'process text', donationAgreement: 'By clicking:',
  agreementPoints: ['a', 'b'], agreementCheckbox: 'I agree', agreeButton: 'Go',
};
const base = (consent) => ({ header: { logo: '/x.svg', logoAlt: 'x' }, page: { consent: { ...baseConsent, ...consent } } });

describe('ConsentPage data scope', () => {
  test('without dataScope the page renders as before and shows no scope section', () => {
    renderWith(base({}));
    expect(screen.getByText('intro text')).toBeInTheDocument();
    expect(screen.queryByTestId('data-scope')).toBeNull();
  });

  test('renders each service with what is read and what is not, then the notes', () => {
    renderWith(base({
      dataScope: {
        title: 'Scope title', intro: 'Scope intro',
        services: [{ name: 'Svc One', read: 'reads one', notRead: 'skips one' }, { name: 'Svc Two', read: 'reads two', notRead: 'skips two' }],
        subsetNote: 'Subset note', otherServices: 'Other services note',
      },
    }));
    const scope = screen.getByTestId('data-scope');
    expect(within(scope).getByText('Scope title')).toBeInTheDocument();
    expect(within(scope).getByText('Svc One')).toBeInTheDocument();
    expect(within(scope).getByText(/reads two/)).toBeInTheDocument();
    expect(within(scope).getAllByText('Read:')).toHaveLength(2); // default labels
    expect(within(scope).getAllByText('Not read:')).toHaveLength(2);
    expect(within(scope).getByText('Subset note')).toBeInTheDocument();
    expect(within(scope).getByText('Other services note')).toBeInTheDocument();
  });
});

describe('Google Takeout consent (real config)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/config-googletakeout.json'), 'utf8'));

  test('names every requested service, says others are not read, and that only a subset is', () => {
    renderWith(config);
    const scope = screen.getByTestId('data-scope');

    // The services the Takeout parser looks for (Fit, Google Health/Fitbit, Play Games, YouTube).
    ['Fit', 'Google Health (or Fitbit)', 'Google Play Games Services', 'YouTube and YouTube Music'].forEach((name) => {
      expect(within(scope).getByText(name)).toBeInTheDocument();
    });
    expect(within(scope).getAllByText('Not read:')).toHaveLength(4);

    expect(scope).toHaveTextContent(/only the data listed under "Read" is used/);
    expect(scope).toHaveTextContent(/other services as well \(for example Google Play Movies & TV\)/);
    expect(scope).toHaveTextContent(/never opened, and nothing from them is donated/);
  });

  test('promises that location and YouTube titles/links are not collected, as the parsers guarantee', () => {
    renderWith(config);
    const scope = screen.getByTestId('data-scope');
    expect(scope).toHaveTextContent(/location and GPS tracks/);
    expect(scope).toHaveTextContent(/video titles, channel names, links and search text are not kept/);
  });
});
