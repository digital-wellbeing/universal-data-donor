/**
 * Streaming XML tag scanner for very large, flat XML files (Apple Health's
 * export.xml). Text chunks go in; tags come out via a callback. It is not a
 * validating parser: text content is ignored, and declarations, comments,
 * processing instructions and CDATA are skipped. That is all an
 * attribute-only format like Apple's needs, at a fraction of a DOM parser's
 * memory.
 */

const ENTITY_RE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode XML character and predefined entity references.
 * @param {string} s
 * @returns {string}
 */
export const decodeEntities = (s) => {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (m, hex, dec, named) => {
    if (named) return NAMED[named];
    const cp = parseInt(hex || dec, hex ? 16 : 10);
    try {
      return String.fromCodePoint(cp);
    } catch (e) {
      return m;
    }
  });
};

/**
 * Read one double-quoted attribute from a raw tag string without parsing the
 * rest. Returns undefined when absent.
 * @param {string} tag - e.g. '<Record type="X" value="1"/>'
 * @param {string} name
 * @returns {string|undefined}
 */
export const getAttr = (tag, name) => {
  const needle = ` ${name}="`;
  let i = tag.indexOf(needle);
  if (i === -1) {
    // Attributes may also follow a newline or tab.
    const m = tag.match(new RegExp(`\\s${name}="`));
    if (!m) return undefined;
    i = m.index;
  }
  const start = i + needle.length;
  const end = tag.indexOf('"', start);
  if (end === -1) return undefined;
  return decodeEntities(tag.slice(start, end));
};

/**
 * Create a push-based tag scanner.
 *
 * `onTag(name, tag, kind)` is called with the element name, the raw tag text
 * (pass it to getAttr) and kind 'open' | 'self' | 'close'.
 *
 * @param {(name: string, tag: string, kind: string) => void} onTag
 * @returns {{push: (text: string) => void, end: () => void}}
 */
export function createTagScanner(onTag) {
  let buf = '';

  const findTagEnd = (from) => {
    // A '>' inside a quoted attribute value does not close the tag.
    let gt = buf.indexOf('>', from);
    while (gt !== -1) {
      let quotes = 0;
      for (let q = buf.indexOf('"', from); q !== -1 && q < gt; q = buf.indexOf('"', q + 1)) quotes++;
      if (quotes % 2 === 0) return gt;
      gt = buf.indexOf('>', gt + 1);
    }
    return -1;
  };

  const scan = () => {
    let i = 0;
    for (;;) {
      const lt = buf.indexOf('<', i);
      if (lt === -1) {
        i = buf.length;
        break;
      }
      const next = buf.charCodeAt(lt + 1);
      let end;
      if (next === 33 /* ! */) {
        if (buf.startsWith('<!--', lt)) {
          end = buf.indexOf('-->', lt + 4);
          if (end === -1) { i = lt; break; }
          i = end + 3;
          continue;
        }
        if (buf.startsWith('<![CDATA[', lt)) {
          end = buf.indexOf(']]>', lt + 9);
          if (end === -1) { i = lt; break; }
          i = end + 3;
          continue;
        }
        // <!DOCTYPE ... [ and the <!ELEMENT>/<!ATTLIST> declarations inside it.
        end = findTagEnd(lt + 2);
        if (end === -1) { i = lt; break; }
        i = end + 1;
        continue;
      }
      if (next === 63 /* ? */) {
        end = buf.indexOf('?>', lt + 2);
        if (end === -1) { i = lt; break; }
        i = end + 2;
        continue;
      }
      if (Number.isNaN(next)) { i = lt; break; } // '<' is the last char

      end = findTagEnd(lt + 1);
      if (end === -1) { i = lt; break; }

      const tag = buf.slice(lt, end + 1);
      if (next === 47 /* / */) {
        onTag(tag.slice(2, -1).trim(), tag, 'close');
      } else {
        let nameEnd = 1;
        while (nameEnd < tag.length) {
          const c = tag.charCodeAt(nameEnd);
          if (c === 32 || c === 9 || c === 10 || c === 13 || c === 47 || c === 62) break;
          nameEnd++;
        }
        const kind = tag.charCodeAt(tag.length - 2) === 47 ? 'self' : 'open';
        onTag(tag.slice(1, nameEnd), tag, kind);
      }
      i = end + 1;
    }
    buf = buf.slice(i);
  };

  return {
    push(text) {
      buf += text;
      scan();
    },
    end() {
      scan();
      buf = '';
    },
  };
}
