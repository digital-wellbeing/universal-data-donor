/**
 * Content of the About page comes from `public/about.json` (intro paragraphs, a source-code
 * link and the project team), so it can be edited without touching code.
 */
const text = (value, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const webHref = (href) => (/^https?:\/\//i.test(text(href, 500)) ? text(href, 500) : '');

const person = (raw) => {
  const name = text(raw && raw.name, 80);
  if (!name) return null;
  return {
    name, role: text(raw.role, 120), detail: text(raw.detail, 120), href: webHref(raw.href), newRow: raw.newRow === true,
  };
};

export const sanitizeAbout = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const label = text(raw.source && raw.source.label, 80);
  const href = webHref(raw.source && raw.source.href);
  const about = {
    title: text(raw.title, 80) || 'About',
    paragraphs: Array.isArray(raw.paragraphs) ? raw.paragraphs.map((p) => text(p, 800)).filter(Boolean).slice(0, 8) : [],
    source: label && href ? { label, href } : null,
    peopleTitle: text(raw.peopleTitle, 60) || 'Project team',
    people: Array.isArray(raw.people) ? raw.people.map(person).filter(Boolean).slice(0, 20) : [],
  };
  return about.paragraphs.length || about.people.length ? about : null;
};

/** Fetch the About content; null when the file is missing or unreadable. */
export const loadAbout = async () => {
  try {
    const response = await fetch(`${process.env.PUBLIC_URL}/about.json`);
    if (!response.ok) return null;
    return sanitizeAbout(await response.json());
  } catch (error) {
    return null;
  }
};
