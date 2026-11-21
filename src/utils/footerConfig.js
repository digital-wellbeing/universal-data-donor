/**
 * Footer content comes from `public/footer.json` so each deployment can set its own
 * organisation, address and links. Only http(s), tel:, mailto: and in-app ("/path") links are kept.
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

export const sanitizeFooter = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const footer = {
    organisation: text(raw.organisation, 120),
    copyright: text(raw.copyright, 120),
    address: Array.isArray(raw.address) ? raw.address.map((line) => text(line)).filter(Boolean).slice(0, 6) : [],
    map: link(raw.map),
    phone: link(raw.phone),
    contact: link(raw.contact),
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
