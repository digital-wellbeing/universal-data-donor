import React from 'react';
import fs from 'fs';
import path from 'path';
import { render as rtlRender, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';
import { sanitizeFooter, decodeContact } from '../utils/footerConfig';

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const full = {
  organisation: 'Research Centre',
  copyright: 'Project contributors',
  address: ['Guildford', 'Surrey GU2 7XH'],
  map: { label: 'Map and directions', href: 'https://maps.example/x' },
  phone: { label: '+44 (0)1483 300800', href: 'tel:+441483300800' },
  contact: { label: 'Contact us', href: 'https://www.surrey.ac.uk/visit-university/contact' },
  linksTitle: 'Information',
  links: [{ label: 'About', href: '/about' }, { label: 'Cookies', href: 'https://www.surrey.ac.uk/cookies' }],
};
afterEach(() => { delete global.fetch; });
const withFooter = (value) => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => value }); };

test('shows organisation, address, map, phone, contact, legal links and the year', async () => {
  withFooter(full);
  render(<Footer year={2031} />);
  const footer = await screen.findByRole('contentinfo');
  expect(within(footer).getByText('Research Centre')).toBeInTheDocument();
  expect(within(footer).getByText('Surrey GU2 7XH')).toBeInTheDocument();
  expect(within(footer).getByRole('link', { name: 'Map and directions' })).toHaveAttribute('target', '_blank');
  expect(within(footer).getByRole('link', { name: '+44 (0)1483 300800' })).toHaveAttribute('href', 'tel:+441483300800');
  expect(within(footer).getByRole('link', { name: 'Contact us' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(within(footer).getByRole('link', { name: 'Cookies' })).toBeInTheDocument();
  expect(footer).toHaveTextContent('© 2031 Project contributors');
  expect(footer).not.toHaveTextContent('© 2031 Research Centre');
});

test('Contact us can be a mailto link and does not open a new tab', async () => {
  withFooter({ ...full, contact: { label: 'Contact us', href: 'mailto:REDACTED-EMAIL' } });
  render(<Footer />);
  const contact = await screen.findByRole('link', { name: 'Contact us' });
  expect(contact).toHaveAttribute('href', 'mailto:REDACTED-EMAIL');
  expect(contact).not.toHaveAttribute('target');
});

test('has an in-app About link (no new tab) and does not list people', async () => {
  withFooter(full);
  render(<Footer />);
  const footer = await screen.findByRole('contentinfo');
  const about = within(footer).getByRole('link', { name: 'About' });
  expect(about).toHaveAttribute('href', '/about');
  expect(about).not.toHaveAttribute('target');
  expect(within(footer).getByText('Information')).toBeInTheDocument();
  expect(within(footer).getByRole('link', { name: 'Cookies' })).toHaveAttribute('target', '_blank');
});

test('the year defaults to the current year', async () => {
  withFooter(full);
  render(<Footer />);
  expect(await screen.findByRole('contentinfo')).toHaveTextContent(`© ${new Date().getFullYear()}`);
});

test('no copyright line unless a copyright holder is set (the organisation is never used for it)', async () => {
  withFooter({ ...full, copyright: undefined });
  render(<Footer />);
  const footer = await screen.findByRole('contentinfo');
  expect(footer).not.toHaveTextContent('©');
});

test('renders nothing when the footer file is missing or fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  const { container } = render(<Footer />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
  global.fetch = jest.fn().mockRejectedValue(new Error('x'));
  const second = render(<Footer />);
  await new Promise((r) => setTimeout(r, 0));
  expect(second.container).toBeEmptyDOMElement();
});

describe('sanitizeFooter', () => {
  test('drops links with unsafe schemes and empty entries', () => {
    const f = sanitizeFooter({
      organisation: 'Org',
      links: [{ label: 'x', href: 'javascript:alert(1)' }, { label: 'ok', href: 'https://a.example' }, { label: '', href: 'https://b.example' }],
      phone: { label: 'p', href: 'data:text/html,x' },
    });
    expect(f.links).toEqual([{ label: 'ok', href: 'https://a.example' }]);
    expect(f.phone).toBeNull();
  });
  test('allows in-app paths but not protocol-relative URLs', () => {
    const f = sanitizeFooter({ links: [{ label: 'a', href: '/about' }, { label: 'b', href: '//evil.example' }] });
    expect(f.links).toEqual([{ label: 'a', href: '/about' }]);
  });
  test('null for junk or an empty footer', () => {
    expect(sanitizeFooter(null)).toBeNull();
    expect(sanitizeFooter({})).toBeNull();
  });
});

describe('contact details hidden from scrapers', () => {
  const hidden = {
    ...full,
    phone: { reveal: 'Show phone number', encoded: btoa('+44 1483 123456') },
    contact: { reveal: 'Show email address', encoded: btoa('someone@example.ac.uk') },
  };

  test('the phone number and email are not in the page or any link until a button is pressed', async () => {
    withFooter(hidden);
    const { container } = render(<Footer />);
    const footer = await screen.findByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Show phone number' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: 'Show email address' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/123456|someone@example|mailto:|tel:/);
  });

  test('pressing a button reveals a real tel: or mailto: link and moves focus to it', async () => {
    withFooter(hidden);
    render(<Footer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show phone number' }));
    const phone = screen.getByRole('link', { name: '+44 1483 123456' });
    expect(phone).toHaveAttribute('href', 'tel:+441483123456');
    expect(phone).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Show phone number' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show email address' }));
    const email = screen.getByRole('link', { name: 'someone@example.ac.uk' });
    expect(email).toHaveAttribute('href', 'mailto:someone@example.ac.uk');
    expect(email).toHaveFocus();
  });

  test('a value that does not decode to a phone number or email is dropped, never shown', () => {
    const footer = sanitizeFooter({
      ...full,
      phone: { reveal: 'x', encoded: btoa('<script>alert(1)</script>') },
      contact: { reveal: 'x', encoded: '%%%not-base64%%%' },
    });
    expect(footer.phone).toBeNull();
    expect(footer.contact).toBeNull();
    expect(decodeContact({ kind: 'contact', encoded: btoa('javascript:alert(1)') })).toBeNull();
  });

  test('ordinary label/href contact links keep working', async () => {
    withFooter(full);
    render(<Footer />);
    expect(await screen.findByRole('link', { name: '+44 (0)1483 300800' })).toHaveAttribute('href', 'tel:+441483300800');
  });

  test('the real footer.json keeps the number and email out of plain text, and they decode correctly', () => {
    const file = fs.readFileSync(path.join(__dirname, '../../public/footer.json'), 'utf8');
    expect(file).not.toMatch(/REDACTED-PHONE|foldes|@surrey|mailto:|tel:/);
    const real = sanitizeFooter(JSON.parse(file));
    expect(decodeContact(real.phone)).toEqual({ label: 'REDACTED-PHONE', href: 'tel:REDACTED-PHONE' });
    expect(decodeContact(real.contact)).toEqual({ label: 'REDACTED-EMAIL', href: 'mailto:REDACTED-EMAIL' });
  });
});
