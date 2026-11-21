import { MAX_FILES, filesFromDataTransfer, filterByExtension, mergeFiles } from './collectFiles';

const file = (name, size = 10, lastModified = 1) => new File([new Uint8Array(size)], name, { lastModified });

describe('filterByExtension', () => {
  it('splits by extension, ignoring case', () => {
    const { accepted, ignored } = filterByExtension([file('a.zip'), file('B.ZIP'), file('c.txt'), file('zip')], ['.zip']);
    expect(accepted.map((f) => f.name)).toEqual(['a.zip', 'B.ZIP']);
    expect(ignored.map((f) => f.name)).toEqual(['c.txt', 'zip']);
  });
});

describe('mergeFiles', () => {
  it('adds new files after the existing ones and drops exact duplicates', () => {
    const a = file('a.zip', 5, 1);
    const merged = mergeFiles([a], [file('a.zip', 5, 1), file('a.zip', 6, 1), file('b.zip', 5, 1)]);
    expect(merged.map((f) => `${f.name}:${f.size}`)).toEqual(['a.zip:5', 'a.zip:6', 'b.zip:5']);
    expect(merged[0]).toBe(a);
  });
});

const fileEntry = (f) => ({ isFile: true, isDirectory: false, file: (ok) => ok(f) });
// readEntries hands back the children in batches of `batch`, then an empty array.
const dirEntry = (children, batch = 2) => ({
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok) => {
        const part = children.slice(at, at + batch);
        at += batch;
        ok(part);
      },
    };
  },
});
const item = (entry) => ({ kind: 'file', webkitGetAsEntry: () => entry });

describe('filesFromDataTransfer', () => {
  it('walks dropped folders recursively and reads every batch', async () => {
    const tree = dirEntry([
      fileEntry(file('p1.zip')), fileEntry(file('p2.zip')), fileEntry(file('p3.zip')),
      dirEntry([fileEntry(file('nested.zip')), fileEntry(file('notes.txt'))]),
    ]);
    const dt = { items: [item(tree), item(fileEntry(file('loose.zip')))], files: [] };
    const names = (await filesFromDataTransfer(dt)).map((f) => f.name);
    expect(names).toEqual(['p1.zip', 'p2.zip', 'p3.zip', 'nested.zip', 'notes.txt', 'loose.zip']);
  });

  it('takes the entries synchronously, before the first await', () => {
    const calls = [];
    const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => { calls.push('entry'); return fileEntry(file('a.zip')); } }], files: [] };
    const promise = filesFromDataTransfer(dt);
    expect(calls).toEqual(['entry']);
    return promise;
  });

  it('uses the plain file for an item that has no entry, alongside folders that do', async () => {
    const dt = {
      items: [
        { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => file('plain.zip') },
        item(dirEntry([fileEntry(file('inside.zip'))])),
        { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => null },
      ],
      files: [],
    };
    expect((await filesFromDataTransfer(dt)).map((f) => f.name)).toEqual(['plain.zip', 'inside.zip']);
  });

  it('falls back to dataTransfer.files without the entries API', async () => {
    const dt = { items: [], files: [file('a.zip'), file('b.zip')] };
    expect((await filesFromDataTransfer(dt)).map((f) => f.name)).toEqual(['a.zip', 'b.zip']);
    expect(await filesFromDataTransfer(null)).toEqual([]);
  });

  it('skips non-file items and stops at the cap', async () => {
    const many = dirEntry(Array.from({ length: MAX_FILES + 50 }, (_, i) => fileEntry(file(`f${i}.zip`))), 100);
    const out = await filesFromDataTransfer({ items: [{ kind: 'string', webkitGetAsEntry: () => null }, item(many)], files: [] });
    expect(out).toHaveLength(MAX_FILES);
  });
});
