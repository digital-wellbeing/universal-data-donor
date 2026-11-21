/**
 * Optional study details passed in the page URL, e.g.
 * `?platform=googletakeout&study=Screen%20Time%20Study&ethics=ETH-2026-001`.
 *
 * They are only a label shown to the participant (in parentheses after "our study") and recorded
 * in the donation package. They carry no authority: anyone can put any text in a URL, so values
 * are rendered as plain text, stripped of control characters and length-limited.
 */

const MAX_LENGTH = 120;
const PARAMS = { study: 'study', ethics: 'ethics' };

// Control characters and the Unicode bidi/zero-width controls that can disguise text.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

/** Trim, collapse whitespace, drop unsafe characters and cut to MAX_LENGTH; '' when nothing is left. */
export const cleanValue = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH).trim();
};

/** Read the study details from a query string; `null` when neither is present. */
export const readStudyInfo = (search) => {
  const params = new URLSearchParams(search || '');
  const study = cleanValue(params.get(PARAMS.study));
  const ethics = cleanValue(params.get(PARAMS.ethics));
  return study || ethics ? { study: study || null, ethics: ethics || null } : null;
};

let captured; // undefined until read; null when the URL had none

/**
 * The study details of this visit. The query string is lost when the app navigates between pages,
 * so the first call (at startup) remembers it for the rest of the session.
 */
export const getStudyInfo = () => {
  if (captured === undefined) captured = readStudyInfo(window.location.search);
  return captured;
};

/** For tests: forget what was captured. */
export const resetStudyInfo = () => { captured = undefined; };

/** "Screen Time Study; ethics approval: ETH-2026-001", or '' when there is nothing to show. */
export const describeStudyInfo = (info) => {
  if (!info) return '';
  const parts = [];
  if (info.study) parts.push(info.study);
  if (info.ethics) parts.push(`ethics approval: ${info.ethics}`);
  return parts.join('; ');
};

/**
 * Put the study details in parentheses right after the first "our study" / "our <Name> study" in
 * `text`; when the wording has no such phrase, after the text. Unchanged when there are no details.
 */
export const insertStudyInfo = (text, info) => {
  const label = describeStudyInfo(info);
  if (!label || typeof text !== 'string') return text;
  const match = text.match(/\bour (?:[A-Za-z]+ )?study\b/i);
  const at = match ? match.index + match[0].length : text.length;
  return `${text.slice(0, at)} (${label})${text.slice(at)}`;
};
