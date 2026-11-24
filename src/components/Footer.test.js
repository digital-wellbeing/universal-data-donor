import React from 'react';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { render as rtlRender, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from './Footer';
import { sanitizeFooter, decodeContact } from '../utils/footerConfig';

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const full = {
  brand: { name: 'Data Donor', tagline: 'Donate your data for research.', logo: '/logo-mark.png' },
  copyright: 'Project contributors',
  github: 'https://github.com/example/repo',
  columns: [
    {
      title: 'Support',
      links: [{ label: 'About', href: '/about' }, { label: 'Contact us', href: 'mailto:team@example.ac.uk' }],
    },
    {
      title: 'Legal',
      links: [{ label: 'Cookies', href: '/cookies' }, { label: 'Disclaimer', href: 'https://example.org/disclaimer' }],
    },
  ],
};
afterEach(() => { delete global.fetch; });
const withFooter = (value) => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => value }); };

test('shows the brand block: logo, name, tagline, © year + holder and a GitHub link', async () => {
  withFooter(full);
  render(<Footer year={2031} />);
  const footer = await screen.findByRole('contentinfo');
  expect(within(footer).getByText('Data Donor')).toBeInTheDocument();
  expect(within(footer).getByText('Donate your data for research.')).toBeInTheDocument();
  expect(within(footer).getByRole('presentation')).toHaveAttribute('src', expect.stringMatching(/\/logo-mark\.png$/));
  expect(footer).toHaveTextContent('© 2031 Project contributors');
  const github = within(footer).getByRole('link', { name: 'Source code on GitHub' });
  expect(github).toHaveAttribute('href', 'https://github.com/example/repo');
  expect(github).toHaveAttribute('target', '_blank');
});

test('renders each link column as a labelled navigation list', async () => {
  withFooter(full);
  render(<Footer />);
  const support = await screen.findByRole('navigation', { name: 'Support' });
  const legal = screen.getByRole('navigation', { name: 'Legal' });
  expect(within(support).getByRole('heading', { name: 'Support' })).toBeInTheDocument();
  expect(within(support).getAllByRole('link')).toHaveLength(2);
  expect(within(legal).getByRole('link', { name: 'Disclaimer' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('in-app and mailto links do not open a new tab; web links do', async () => {
  withFooter(full);
  render(<Footer />);
  const about = await screen.findByRole('link', { name: 'About' });
  expect(about).toHaveAttribute('href', '/about');
  for (const name of ['About', 'Contact us', 'Cookies']) {
    expect(screen.getByRole('link', { name })).not.toHaveAttribute('target');
  }
  expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', 'mailto:team@example.ac.uk');
  expect(screen.getByRole('link', { name: 'Disclaimer' })).toHaveAttribute('target', '_blank');
});

test('the year defaults to the current year', async () => {
  withFooter(full);
  render(<Footer />);
  expect(await screen.findByRole('contentinfo')).toHaveTextContent(`© ${new Date().getFullYear()}`);
});

test('no copyright line unless a copyright holder is set', async () => {
  withFooter({ ...full, copyright: undefined });
  render(<Footer />);
  const footer = await screen.findByRole('contentinfo');
  expect(footer).not.toHaveTextContent('©');
});

test('renders nothing when the footer file is missing or fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  const { container, unmount } = render(<Footer />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
  unmount();
  global.fetch = jest.fn().mockRejectedValue(new Error('x'));
  const view = render(<Footer />);
  await new Promise((r) => setTimeout(r, 0));
  expect(view.container).toBeEmptyDOMElement();
});

describe('sanitizeFooter', () => {
  test('drops links with unsafe schemes, empty entries and empty columns', () => {
    const f = sanitizeFooter({
      columns: [
        { title: 'Support', links: [{ label: 'x', href: 'javascript:alert(1)' }, { label: 'ok', href: 'https://a.example' }, { label: '', href: 'https://b.example' }] },
        { title: 'Empty', links: [{ label: 'p', href: 'data:text/html,x' }] },
      ],
    });
    expect(f.columns).toEqual([{ title: 'Support', links: [{ label: 'ok', href: 'https://a.example' }] }]);
  });
  test('allows in-app paths but not protocol-relative URLs', () => {
    const f = sanitizeFooter({ columns: [{ title: 'T', links: [{ label: 'a', href: '/about' }, { label: 'b', href: '//evil.example' }] }] });
    expect(f.columns[0].links).toEqual([{ label: 'a', href: '/about' }]);
  });
  test('keeps only an https GitHub link and a public-path or https logo', () => {
    const f = sanitizeFooter({ brand: { name: 'N', logo: 'javascript:x' }, github: 'http://github.com/x' });
    expect(f.logo).toBe('');
    expect(f.github).toBe('');
    expect(sanitizeFooter({ brand: { name: 'N', logo: '/logo.png' } }).logo).toBe('/logo.png');
  });
  test('null for junk or an empty footer', () => {
    expect(sanitizeFooter(null)).toBeNull();
    expect(sanitizeFooter({})).toBeNull();
  });
});

describe('contact details hidden from scrapers', () => {
  const hidden = {
    ...full,
    columns: [
      {
        title: 'Support',
        links: [
          { label: 'About', href: '/about' },
          { kind: 'phone', reveal: 'Show phone number', encoded: btoa('+44 1483 123456') },
          { kind: 'contact', reveal: 'Show email address', encoded: btoa('someone@example.ac.uk') },
        ],
      },
    ],
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
      columns: [{
        title: 'Support',
        links: [
          { label: 'About', href: '/about' },
          { kind: 'phone', reveal: 'x', encoded: btoa('<script>alert(1)</script>') },
          { kind: 'contact', reveal: 'x', encoded: '%%%not-base64%%%' },
          { kind: 'other', reveal: 'x', encoded: btoa('+44 1483 123456') },
        ],
      }],
    });
    expect(footer.columns[0].links).toEqual([{ label: 'About', href: '/about' }]);
    expect(decodeContact({ kind: 'contact', encoded: btoa('javascript:alert(1)') })).toBeNull();
  });

  test('a hidden item without a reveal label gets a sensible default', () => {
    const footer = sanitizeFooter({ columns: [{ title: 'S', links: [{ kind: 'phone', encoded: btoa('+44 1483 123456') }] }] });
    expect(footer.columns[0].links[0].reveal).toBe('Show phone number');
  });

  test('the real footer.json keeps the number and email out of plain text, and they still decode to valid values', () => {
    // Compared by hash so this test file does not itself contain the real details.
    const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
    const file = fs.readFileSync(path.join(__dirname, '../../public/footer.json'), 'utf8');
    expect(file).not.toMatch(/mailto:|tel:|@|\+\d/);
    const items = sanitizeFooter(JSON.parse(file)).columns.flatMap((c) => c.links);
    const phone = decodeContact(items.find((l) => l.kind === 'phone'));
    const email = decodeContact(items.find((l) => l.kind === 'contact'));
    expect(sha(phone.label)).toBe('a994f21f4a07baaed8eee24c9c8c309241d321a49bbb139dcd14544fb4b076b4');
    expect(phone.href).toBe(`tel:${phone.label.replace(/[^\d+]/g, '')}`);
    expect(sha(email.label)).toBe('df645ce638ff4c28eabd9c6db853391f04fe43736cc6fa9ed4a6d1941a681bc9');
    expect(email.href).toBe(`mailto:${email.label}`);
  });
});
