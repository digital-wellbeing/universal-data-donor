/**
 * Footer content comes from `public/footer.json` so each deployment can set its own brand block
 * (logo, name, tagline, © holder, GitHub link) and link columns (e.g. Support, Legal).
 * Only http(s), tel:, mailto: and in-app ("/path") links are kept.
 *
 * Every entry in a column's `links` can be given in two ways:
 *  - `{ "label", "href" }`: shown as an ordinary link;
 *  - `{ "kind": "phone" | "contact", "reveal", "encoded" }`: hidden from scrapers. `encoded` is the
 *    base64 of the phone number or email address; the footer shows a "reveal" button and only decodes
 *    the value when it is pressed, so the plain text is in neither the JSON file nor the page until a
 *    person asks for it.
 */
const text = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isInApp = (value) => /^\/(?!\/)/.test(value); // "/about", but not "//host"
// http(s), tel: and mailto: links, plus in-app paths such as "/about".
const safeHref = (href) => {
  const value = text(href, 500);
  return /^(https?:|tel:|mailto:)/i.test(value) || isInApp(value) ? value : '';
};
// Images: a file under public/ ("/logo-mark.png") or an https URL.
const safeSrc = (src) => {
  const value = text(src, 500);
  return /^https:/i.test(value) || isInApp(value) ? value : '';
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

const contactItem = (raw) => {
  const kind = raw && raw.kind;
  const item = {
    kind,
    reveal: text(raw.reveal, 60) || (kind === 'phone' ? 'Show phone number' : 'Show email address'),
    encoded: text(raw.encoded, 400),
  };
  return decodeContact(item) ? item : null; // invalid values are dropped, never shown
};

const footerLink = (raw) => (raw && typeof raw.encoded === 'string' ? contactItem(raw) : link(raw));

const column = (raw) => {
  const title = text(raw && raw.title, 60);
  const links = Array.isArray(raw && raw.links) ? raw.links.map(footerLink).filter(Boolean).slice(0, 12) : [];
  return title && links.length ? { title, links } : null;
};

export const sanitizeFooter = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const brand = raw.brand && typeof raw.brand === 'object' ? raw.brand : {};
  const github = safeHref(raw.github);
  const footer = {
    name: text(brand.name, 120),
    tagline: text(brand.tagline, 200),
    logo: safeSrc(brand.logo),
    copyright: text(raw.copyright, 120),
    github: /^https:/i.test(github) ? github : '',
    columns: Array.isArray(raw.columns) ? raw.columns.map(column).filter(Boolean).slice(0, 4) : [],
  };
  const hasContent = footer.name || footer.tagline || footer.copyright || footer.github || footer.columns.length;
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
