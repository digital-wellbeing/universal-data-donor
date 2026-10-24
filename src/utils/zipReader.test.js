import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { openZip, isZip, streamBlobText } from './zipReader';

const makeZip = async (files, compression = 'DEFLATE') => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression });
  return new Blob([bytes]);
};

describe('zipReader', () => {
  test('detects zip vs non-zip blobs', async () => {
    expect(await isZip(await makeZip({ 'a.txt': 'x' }))).toBe(true);
    expect(await isZip(new Blob(['<?xml version="1.0"?>']))).toBe(false);
    expect(await isZip(new Blob([]))).toBe(false);
  });

  test.each(['DEFLATE', 'STORE'])('reads entries (%s)', async (compression) => {
    const big = 'line of text ünïcödé\n'.repeat(20000);
    const blob = await makeZip({
      'folder/a.json': '{"ok":true}',
      'folder/big.txt': big,
      'empty.txt': '',
    }, compression);

    const zip = await openZip(blob);
    const names = zip.entries.map((e) => e.name).sort();
    expect(names).toEqual(['empty.txt', 'folder/a.json', 'folder/big.txt']);

    const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));
    expect(JSON.parse(await zip.readText(byName['folder/a.json']))).toEqual({ ok: true });
    expect(await zip.readText(byName['empty.txt'])).toBe('');

    let streamed = '';
    const progress = [];
    await zip.streamText(byName['folder/big.txt'], (t) => { streamed += t; }, (f) => progress.push(f));
    expect(streamed).toBe(big);
    expect(progress[progress.length - 1]).toBe(1);
  });

  test('reads ZIP64 archives', async () => {
    // Built by scripts/fixtures/make_zip64_fixture.py.
    const bytes = fs.readFileSync(path.join(__dirname, '__fixtures__', 'zip64.zip'));
    const zip = await openZip(new Blob([new Uint8Array(bytes)]));
    const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(['apple_health_export/export.xml', 'second.txt']);
    expect(await zip.readText(byName['second.txt'])).toBe('second entry');
    const xml = await zip.readText(byName['apple_health_export/export.xml']);
    expect(xml.startsWith('<HealthData><Record/>')).toBe(true);
    expect(xml).toHaveLength(12 + 9 * 1000 + 13);
  });

  test('error messages never contain entry names (they can hold account names)', async () => {
    const zip = new JSZip();
    zip.file('samsunghealth_jane.doe_20240101/data.csv', 'x'.repeat(100));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    // Patch the compression method to 9 (Deflate64) in the central directory.
    const view = new DataView(bytes.buffer);
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint16(i + 10, 9, true); break; }
    }
    const z = await openZip(new Blob([bytes]));
    await expect(z.readText(z.entries[0])).rejects.toThrow(/unsupported compression method \(9\)/);
    await z.readText(z.entries[0]).catch((e) => expect(e.message).not.toMatch(/jane/));
  });

  test('rejects non-zip input', async () => {
    await expect(openZip(new Blob(['not a zip at all']))).rejects.toThrow(/Not a ZIP/);
  });

  test('streams a plain blob as text', async () => {
    let out = '';
    await streamBlobText(new Blob(['héllo ', 'wörld']), (t) => { out += t; });
    expect(out).toBe('héllo wörld');
  });
});
