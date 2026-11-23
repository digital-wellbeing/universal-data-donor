/**
 * Footer content comes from `public/footer.json` so each deployment can set its own
 * organisation, address and links. Only http(s), tel:, mailto: and in-app ("/path") links are kept.
 *
 * `phone` and `contact` can be given in two ways:
 *  - `{ "label", "href" }`: shown as an ordinary link;
 *  - `{ "reveal", "encoded" }`: hidden from scrapers. `encoded` is the base64 of the phone number or
 *    email address; the footer shows a "reveal" button and only decodes the value when it is pressed,
 *    so the plain text is in neither the JSON file nor the page until a person asks for it.
 */
const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
// http(s), tel: and mailto: links, plus in-app paths such as "/about" (but not "//host").
const safeHref = (href) => {
  const value = text(href, 500);
  return /^(https?:|tel:|mailto:)/i.test(value) || /^\/(?!\/)/.test(value) ? value : '';
};

const link = (raw) => {
  const label = text(raw && raw.label);
  const href = safeHref(raw && raw.href);
  return label && href ? { label, href } : null;
};

const CONTACT_FORMAT = {
  phone: /^\+?[\d\s()-]{6,25}$/,
  contact: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/,
};

/** Decode a hidden contact item to a link `{ label, href }`, or null when it is not valid. */
export const decodeContact = (item) => {
  const format = item && CONTACT_FORMAT[item.kind];
  if (!format || typeof item.encoded !== 'string') return null;
  let value;
  try {
    value = atob(item.encoded).trim();
  } catch (error) {
    return null;
  }
  if (!format.test(value)) return null;
  return item.kind === 'phone'
    ? { label: value, href: `tel:${value.replace(/[^\d+]/g, '')}` }
    : { label: value, href: `mailto:${value}` };
};

const contactItem = (raw, kind) => {
  if (raw && typeof raw === 'object' && typeof raw.encoded === 'string') {
    const item = { kind, reveal: text(raw.reveal, 60) || (kind === 'phone' ? 'Show phone number' : 'Show email address'), encoded: text(raw.encoded, 400) };
    return decodeContact(item) ? item : null; // invalid values are dropped, never shown
  }
  return link(raw);
};

export const sanitizeFooter = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const footer = {
    organisation: text(raw.organisation, 120),
    copyright: text(raw.copyright, 120),
    address: Array.isArray(raw.address) ? raw.address.map((line) => text(line)).filter(Boolean).slice(0, 6) : [],
    map: link(raw.map),
    phone: contactItem(raw.phone, 'phone'),
    contact: contactItem(raw.contact, 'contact'),
    linksTitle: text(raw.linksTitle, 60) || 'Legal',
    links: Array.isArray(raw.links) ? raw.links.map(link).filter(Boolean).slice(0, 12) : [],
  };
  const hasContent = footer.organisation || footer.copyright || footer.address.length || footer.map || footer.phone || footer.contact || footer.links.length;
  return hasContent ? footer : null;
};

/** Fetch the footer file; null (no footer) when it is missing or unreadable. */
export const loadFooter = async () => {
  try {
    const response = await fetch(`${process.env.PUBLIC_URL}/footer.json`);
    if (!response.ok) return null;
    return sanitizeFooter(await response.json());
  } catch (error) {
    return null;
  }
};
