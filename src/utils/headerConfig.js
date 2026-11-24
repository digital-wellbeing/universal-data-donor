/** Site header text comes from `public/config/header.json` ({ title, tagline }); null (no header) when missing. */
const text = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const sanitizeHeader = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const header = { title: text(raw.title), tagline: text(raw.tagline, 160) };
  return header.title ? header : null;
};

export const loadHeader = async () => {
  try {
    const response = await fetch(`${process.env.PUBLIC_URL}/config/header.json`);
    if (!response.ok) return null;
    return sanitizeHeader(await response.json());
  } catch (error) {
    return null;
  }
};
