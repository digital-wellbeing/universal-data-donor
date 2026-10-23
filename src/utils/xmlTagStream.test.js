import { createTagScanner, getAttr, decodeEntities } from './xmlTagStream';

const collect = (pieces) => {
  const tags = [];
  const scanner = createTagScanner((name, tag, kind) => tags.push([name, kind, tag]));
  for (const p of pieces) scanner.push(p);
  scanner.end();
  return tags;
};

const XML = `<?xml version="1.0"?>
<!DOCTYPE HealthData [
<!-- a comment with <Record> inside -->
<!ELEMENT HealthData (Record*)>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData>
 <Record type="A" value="1 &gt; 0" note="x>y"/>
 <Record
   type="B"
   value="&#228;&amp;"><MetadataEntry key="k" value="v"/></Record>
 <![CDATA[<Record type="ignored"/>]]>
</HealthData>`;

describe('createTagScanner', () => {
  test('emits element tags and skips declarations, comments and CDATA', () => {
    const tags = collect([XML]);
    expect(tags.map(([n, k]) => `${n}:${k}`)).toEqual([
      'HealthData:open', 'Record:self', 'Record:open', 'MetadataEntry:self', 'Record:close', 'HealthData:close',
    ]);
    expect(getAttr(tags[1][2], 'note')).toBe('x>y');
    expect(getAttr(tags[1][2], 'value')).toBe('1 > 0');
    expect(getAttr(tags[2][2], 'type')).toBe('B');
    expect(getAttr(tags[2][2], 'value')).toBe('ä&');
    expect(getAttr(tags[2][2], 'missing')).toBeUndefined();
  });

  test.each([1, 2, 3, 7, 64])('is independent of chunk size (%i chars)', (size) => {
    const pieces = XML.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
    expect(collect(pieces)).toEqual(collect([XML]));
  });
});

test('decodeEntities', () => {
  expect(decodeEntities('a &lt;b&gt; &quot;c&quot; &apos;d&apos; &#x1F600; &unknown;'))
    .toBe('a <b> "c" \'d\' 😀 &unknown;');
});
