/**
 * Statement pages (cookies, accessibility) read their text from `public/content/<slug>.json`:
 *   { title, intro, sections: [{ heading, paragraphs[], items[], links[{label, href}] }] }
 * Only the slugs listed here can be requested.
 */
export const CONTENT_SLUGS = ['cookies', 'accessibility'];

const text = (value, max = 800) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const strings = (list, max = 800, limit = 12) => (Array.isArray(list) ? list.map((v) => text(v, max)).filter(Boolean).slice(0, limit) : []);
const safeHref = (href) => (/^(https?:|mailto:)/i.test(text(href, 500)) ? text(href, 500) : '');

const section = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const links = Array.isArray(raw.links)
    ? raw.links.map((l) => ({ label: text(l && l.label, 120), href: safeHref(l && l.href) })).filter((l) => l.label && l.href).slice(0, 6)
    : [];
  const result = { heading: text(raw.heading, 120), paragraphs: strings(raw.paragraphs), items: strings(raw.items), links };
  return result.heading || result.paragraphs.length || result.items.length || links.length ? result : null;
};

export const sanitizeContent = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const page = {
    title: text(raw.title, 120),
    intro: text(raw.intro),
    sections: Array.isArray(raw.sections) ? raw.sections.map(section).filter(Boolean).slice(0, 12) : [],
  };
  return page.title && (page.intro || page.sections.length) ? page : null;
};

/** Fetch one statement page; null for an unknown slug or a missing/unreadable file. */
export const loadContent = async (slug) => {
  if (!CONTENT_SLUGS.includes(slug)) return null;
  try {
    const response = await fetch(`${process.env.PUBLIC_URL}/content/${slug}.json`);
    if (!response.ok) return null;
    return sanitizeContent(await response.json());
  } catch (error) {
    return null;
  }
};
