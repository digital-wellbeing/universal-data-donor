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
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/config/platforms/googletakeout.json'), 'utf8'));

  test('names every requested service, says others are not read, and that only a subset is', () => {
    renderWith(config);
    const scope = screen.getByTestId('data-scope');

    // The services the Takeout parser looks for (Fit, Google Health/Fitbit, Play Games, Play Movies & TV, YouTube).
    ['Fit', 'Google Health (or Fitbit)', 'Google Play Games Services', 'Google Play Movies & TV', 'YouTube and YouTube Music'].forEach((name) => {
      expect(within(scope).getByText(name)).toBeInTheDocument();
    });
    expect(within(scope).getAllByText('Not read:')).toHaveLength(5);

    expect(scope).toHaveTextContent(/only the data listed under "Read" is used/);
    expect(scope).toHaveTextContent(/other services as well\. This tool does not read them/);
    expect(scope).toHaveTextContent(/never opened, and nothing from them is donated/);
  });

  test('lists Google Play Movies & TV explicitly: watchlist and viewing history are read, the rest is not', () => {
    renderWith(config);
    const scope = screen.getByTestId('data-scope');
    const entry = within(scope).getByText('Google Play Movies & TV').closest('li');
    expect(entry).toHaveTextContent(/Read: your watchlist and your viewing history/);
    expect(entry).toHaveTextContent(/titles and the dates and times/);
    expect(entry).toHaveTextContent(/Not read: your purchases, rentals, ratings/);
    expect(entry).toHaveTextContent(/None of it is used or donated/);
  });

  test('the upload instructions ask for Play Movies & TV, and say other services are ignored', () => {
    expect(config.page.upload.intro).toMatch(/select \\"Google Play Movies & TV\\"|select "Google Play Movies & TV"/i);
    expect(config.page.upload.intro).toMatch(/other service[^.]*ignored/);
  });

  test('promises that location and YouTube titles/links are not collected, as the parsers guarantee', () => {
    renderWith(config);
    const scope = screen.getByTestId('data-scope');
    expect(scope).toHaveTextContent(/location and GPS tracks/);
    expect(scope).toHaveTextContent(/video titles, channel names, links and search text are not kept/);
  });
});

describe('ConsentPage sections', () => {
  test('renders no sections when none are configured', () => {
    renderWith(base({}));
    expect(screen.queryAllByTestId('consent-section')).toHaveLength(0);
  });

  test('renders paragraphs, items and links; web links open in a new tab, mailto does not', () => {
    renderWith(base({
      sections: [{
        title: 'Sec A', paragraphs: ['para a'], items: ['item a'],
        links: [{ label: 'Web', href: 'https://example.org' }, { label: 'Mail', href: 'mailto:x@example.org' }],
      }, { title: 'Sec B', paragraphs: ['para b'] }],
    }));
    const [a, b] = screen.getAllByTestId('consent-section');
    expect(within(a).getByText('Sec A')).toBeInTheDocument();
    expect(within(a).getByText('item a').tagName).toBe('LI');
    expect(within(a).getByText('Web')).toHaveAttribute('target', '_blank');
    expect(within(a).getByText('Mail')).not.toHaveAttribute('target');
    expect(within(b).getByText('para b')).toBeInTheDocument();
  });
});

describe('Google Takeout consent: who, storage, use and withdrawal (real config)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/config/platforms/googletakeout.json'), 'utf8'));
  const pageText = () => document.body.textContent;

  test('names the University of Surrey as controller and gives a contact', () => {
    renderWith(config);
    expect(pageText()).toMatch(/University of Surrey is the data controller/);
    expect(pageText()).toMatch(/t\.foldes@surrey\.ac\.uk/);
  });

  test('discloses the stored IP hash and browser string, encryption, Cloudflare and the minimum 10-year retention', () => {
    renderWith(config);
    expect(pageText()).toMatch(/scrambled code made from your IP address \(the address itself is not stored\)/);
    expect(pageText()).toMatch(/browser's identification string/);
    expect(pageText()).toMatch(/encrypted as soon as it reaches our server/);
    expect(pageText()).toMatch(/Cloudflare receives your IP address/);
    expect(pageText()).toMatch(/kept for at least 10 years after the study ends/);
  });

  test('says anonymous, and that only day-level summaries may be shared openly', () => {
    renderWith(config);
    expect(pageText()).toMatch(/Your donation is anonymous/);
    expect(pageText()).not.toMatch(/pseudonym/);
    expect(pageText()).toMatch(/individual records you donate stay with the University of Surrey research team/);
    expect(pageText()).toMatch(/only day-level summaries .* may be shared openly/);
  });

  test('says heart and breathing data are not collected, and the parser is told to leave them out', () => {
    renderWith(config);
    expect(pageText()).toMatch(/We do not collect heart or breathing measurements/);
    expect(config.page.consent.dataScope.services.map((s) => s.read).join(' ')).not.toMatch(/heart rate|oxygen|respirat/i);
    expect(config.general.parserOptions.excludeVitals).toBe(true);
  });

  test('explains withdrawal by submission ID within 1 month, and the lawful basis', () => {
    renderWith(config);
    expect(pageText()).toMatch(/withdraw within 1 month: email t\.foldes@surrey\.ac\.uk with your submission ID/);
    expect(pageText()).toMatch(/can no longer be withdrawn/);
    expect(pageText()).toMatch(/Article 6\(1\)\(e\)/);
    expect(pageText()).toMatch(/Article 9\(2\)\(j\)/);
    expect(config.page.consent.agreementPoints.join(' ')).toMatch(/explicitly and voluntarily agree.*health data/);
  });

  test('the thank-you page says why the submission ID matters', () => {
    expect(config.page.thankyou.saveId).toMatch(/only way to find your donation/);
    expect(config.page.thankyou.saveId).toMatch(/withdraw within 1 month/);
  });
});

// TODO(dpo): the consent text in public/config-*.json states 10-year retention, withdrawal within
// 1 month, aggregate-only publication and UK GDPR Art 6(1)(e) public task (+ Art 9(2)(j) for health
// platforms). Check each against the DPO's advice and the ethics application, then update the
// configs and the assertions below if they differ.
describe('every platform consent discloses controller, storage, use and withdrawal', () => {
  const publicDir = path.join(__dirname, '../../public/config/platforms');
  const configs = fs.readdirSync(publicDir)
    .filter((name) => /\.json$/.test(name))
    .map((name) => [name, JSON.parse(fs.readFileSync(path.join(publicDir, name), 'utf8'))]);
  // Platforms that collect health data, a special category under UK GDPR Article 9.
  const HEALTH = ['applehealth', 'fitbit', 'garmin', 'googlefit', 'googletakeout', 'healthconnect', 'samsunghealth'];

  // Platforms already aligned with the study's ethics application: donations are described as
  // anonymous, only day-level summaries may be shared openly, and 10 years is a minimum.
  const DAY_LEVEL_SHARING = ['googletakeout'];

  test('finds all platform configs', () => {
    expect(configs.length).toBeGreaterThanOrEqual(11);
  });

  test.each(configs)('%s', (name, config) => {
    const consent = config.page.consent;
    const text = JSON.stringify(consent);
    expect(consent.ethics).toMatch(/ethic/i);
    expect(text).toMatch(/University of Surrey is the data controller/);
    expect(text).toMatch(/scrambled code made from your IP address/);
    expect(text).toMatch(/browser's identification string/);
    if (DAY_LEVEL_SHARING.includes(name.replace(/\.json$/, ''))) {
      expect(text).toMatch(/kept for at least 10 years/);
      expect(text).toMatch(/Your donation is anonymous/);
      expect(text).toMatch(/only day-level summaries/);
    } else {
      expect(text).toMatch(/kept for 10 years/);
      expect(text).toMatch(/pseudonymised, not anonymous/);
      expect(text).toMatch(/only aggregate results/);
    }
    expect(text).toMatch(/withdraw within 1 month: email t\.foldes@surrey\.ac\.uk with your submission ID/);
    expect(text).toMatch(/Article 6\(1\)\(e\)/);
    expect(text).not.toMatch(/will be anonymous|publicly available/);
    expect(consent.agreementPoints[0]).toMatch(/^you explicitly and voluntarily agree/);
    expect(config.page.thankyou.saveId).toMatch(/only way to find your donation/);
    expect(config.page.thankyou.deleteFile).toMatch(/maximum security.*delete the file you uploaded.*trash or recycle bin/);

    const health = HEALTH.includes(config.general.platformId || name.replace(/\.json$/, ''));
    expect(/Article 9\(2\)\(j\)/.test(text)).toBe(health);
    expect(/health data/.test(consent.agreementPoints[0])).toBe(health);
  });
});

describe('ConsentPage study details from the URL', () => {
  const { resetStudyInfo } = require('../utils/studyInfo');
  const visit = (search) => {
    resetStudyInfo();
    window.history.pushState({}, '', `/${search}`);
  };
  afterEach(() => {
    resetStudyInfo();
    window.history.pushState({}, '', '/');
  });

  test('puts the study name and ethics code in parentheses after "our study"', () => {
    visit('?study=Screen%20Time%20Study&ethics=ETH-2026-001');
    renderWith(base({ intro: 'donating data to our study. More.' }));
    expect(screen.getByText('donating data to our study (Screen Time Study; ethics approval: ETH-2026-001). More.')).toBeInTheDocument();
  });

  test('a configured ethics statement replaces the ethics code from the URL, which anyone can set', () => {
    visit('?study=Screen%20Time%20Study&ethics=FAKE-APPROVAL');
    renderWith(base({ intro: 'donating data to our study. More.', ethics: 'Awaiting ethical review.' }));
    expect(screen.getByText('donating data to our study (Screen Time Study). More.')).toBeInTheDocument();
    expect(screen.getByTestId('ethics-statement')).toHaveTextContent('Awaiting ethical review.');
    expect(document.body.textContent).not.toMatch(/FAKE-APPROVAL/);
  });

  test('the real Takeout config states its ethics status and ignores the URL code', () => {
    visit('?ethics=FAKE-APPROVAL');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/config/platforms/googletakeout.json'), 'utf8'));
    renderWith(real);
    expect(screen.getByTestId('ethics-statement')).toHaveTextContent(/awaiting review by the University of Surrey's ethics committee/);
    expect(document.body.textContent).not.toMatch(/FAKE-APPROVAL/);
  });

  test('shows the text unchanged without parameters', () => {
    visit('');
    renderWith(base({ intro: 'donating data to our study. More.' }));
    expect(screen.getByText('donating data to our study. More.')).toBeInTheDocument();
  });

  test('renders markup in a parameter as plain text', () => {
    visit('?study=%3Cb%3Ebold%3C%2Fb%3E');
    const { container } = renderWith(base({ intro: 'to our study.' }));
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('to our study (<b>bold</b>).');
  });

  test('works with the real Takeout wording', () => {
    visit('?study=Sleep%20and%20Screens');
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/config/platforms/googletakeout.json'), 'utf8'));
    renderWith(real);
    expect(screen.getByText(/from your Google Takeout export to our study \(Sleep and Screens\)\. We ask for/)).toBeInTheDocument();
  });
});
