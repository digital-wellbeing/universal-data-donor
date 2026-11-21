// Helpers for gathering the files a participant picks or drops: filter by the platform's
// accepted extensions, merge repeated selections without duplicates, and read folders that
// are dropped onto the page (a plain `dataTransfer.files` only lists the folder itself).

export const MAX_FILES = 500; // a safety cap on what a dropped folder can add

const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

const hasAcceptedExtension = (name, extensions) => {
  const lower = name.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension.toLowerCase()));
};

/** Splits files into those with an accepted extension and those that are ignored. */
export function filterByExtension(files, extensions) {
  const accepted = [];
  const ignored = [];
  files.forEach((file) => {
    (hasAcceptedExtension(file.name, extensions) ? accepted : ignored).push(file);
  });
  return { accepted, ignored };
}

/** Existing files plus the new ones, without the same file (name, size, date) twice. */
export function mergeFiles(existing, incoming) {
  const seen = new Set(existing.map(fileKey));
  const merged = [...existing];
  incoming.forEach((file) => {
    const key = fileKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  });
  return merged;
}

const readEntryFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

const readAllEntries = async (directoryEntry) => {
  const reader = directoryEntry.createReader();
  const entries = [];
  for (;;) {
    // readEntries returns the directory in batches; an empty batch means it is finished.
    // eslint-disable-next-line no-await-in-loop
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
};

const walk = async (entry, out) => {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    out.push(await readEntryFile(entry));
  } else if (entry.isDirectory) {
    const children = await readAllEntries(entry);
    for (const child of children) {
      // Sequential on purpose: keeps the order stable and the cap exact.
      // eslint-disable-next-line no-await-in-loop
      await walk(child, out);
    }
  }
};

/**
 * Every file in a drop, including the contents of dropped folders (recursively), capped at
 * MAX_FILES. Falls back to `dataTransfer.files` where the entries API is missing.
 */
export async function filesFromDataTransfer(dataTransfer) {
  const items = Array.from((dataTransfer && dataTransfer.items) || []);
  const canWalk = items.length > 0 && items.every((item) => typeof item.webkitGetAsEntry === 'function');
  if (!canWalk) return Array.from((dataTransfer && dataTransfer.files) || []);

  // Entries and files must be taken synchronously: the browser invalidates the items after
  // the event handler returns. An item without an entry (some drag sources and browsers) is
  // still usable as a plain file.
  const taken = items
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry(), file: typeof item.getAsFile === 'function' ? item.getAsFile() : null }));
  const out = [];
  for (const { entry, file } of taken) {
    if (entry) {
      // eslint-disable-next-line no-await-in-loop
      await walk(entry, out);
    } else if (file && out.length < MAX_FILES) {
      out.push(file);
    }
  }
  return out;
}
