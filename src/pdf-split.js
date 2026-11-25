// Splits a payroll PDF (one or more pages per employee) into one PDF per
// employee, and reads the employee number, name and pay period off each page.
// No external dependencies, like the rest of the app.
//
// This is not a general PDF parser. It handles what payroll exports such as
// Nethris produce: a classic cross-reference table, unencrypted, with
// Flate-compressed (or uncompressed) content streams and simple fonts. Anything
// it cannot read is reported as an error rather than half-processed, so a bad
// file never ends up in an employee's profile.
const zlib = require('node:zlib');

const OBJ_RE = /(\d+)\s+(\d+)\s+obj\b/g;
const REF_RE = /(\d+)\s+(\d+)\s+R\b/g;

// ---------- Object table ----------

// Returns Map<objectNumber, { dict: string, stream: Buffer|null }>, where `dict`
// is the object's text up to its stream keyword (latin1) and `stream` the raw
// stream bytes. A later definition of the same number wins, as with incremental
// updates.
function readObjects(buf) {
  const text = buf.toString('latin1');
  const objects = new Map();
  const STREAM_RE = />>\s*stream(\r\n|\n|\r)/g;
  OBJ_RE.lastIndex = 0;
  let m;
  while ((m = OBJ_RE.exec(text))) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    let end = text.indexOf('endobj', bodyStart);
    if (end === -1) break;
    STREAM_RE.lastIndex = bodyStart;
    const s = STREAM_RE.exec(text);
    let dict;
    let stream = null;
    if (s && s.index < end) {
      dict = text.slice(bodyStart, s.index + 2);
      const dataStart = s.index + s[0].length;
      // Trust a direct /Length when endstream sits right after it; binary data
      // can contain the bytes "endobj", so searching for it alone is not safe.
      let dataEnd = -1;
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      if (len) {
        const candidate = dataStart + Number(len[1]);
        if (/^\s*endstream/.test(text.slice(candidate, candidate + 20))) dataEnd = candidate;
      }
      if (dataEnd === -1) {
        dataEnd = text.indexOf('endstream', dataStart);
        if (dataEnd === -1) break;
        // The EOL before endstream is not part of the data.
        if (text[dataEnd - 1] === '\n') dataEnd--;
        if (text[dataEnd - 1] === '\r') dataEnd--;
      }
      stream = buf.subarray(dataStart, dataEnd);
      end = text.indexOf('endobj', dataEnd);
      if (end === -1) break;
    } else {
      dict = text.slice(bodyStart, end);
    }
    objects.set(num, { dict: dict.trim(), stream });
    OBJ_RE.lastIndex = end + 'endobj'.length;
  }
  return objects;
}

function getRef(dict, key) {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
}

function getRefArray(dict, key) {
  const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (!m) return null;
  return [...m[1].matchAll(REF_RE)].map((r) => Number(r[1]));
}

// The raw value of a key in the top level of a dictionary: a name, number,
// reference, array or nested dictionary, returned as source text.
function getRawValue(dict, key) {
  const re = new RegExp(`/${key}(?![A-Za-z0-9])`, 'g');
  let m;
  while ((m = re.exec(dict))) {
    if (depthAt(dict, m.index) !== 1) continue;
    let i = m.index + m[0].length;
    while (/\s/.test(dict[i])) i++;
    return readValue(dict, i);
  }
  return null;
}

// Dictionary nesting depth at position `pos` (1 = top level of the object).
function depthAt(s, pos) {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    if (s[i] === '<' && s[i + 1] === '<') { depth++; i++; } else if (s[i] === '>' && s[i + 1] === '>') { depth--; i++; } else if (s[i] === '(') i = skipString(s, i);
  }
  return depth;
}

function skipString(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return i;
}

function readValue(s, i) {
  const start = i;
  if (s.startsWith('<<', i)) {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s.startsWith('<<', i)) { depth++; i++; } else if (s.startsWith('>>', i)) { depth--; i++; if (depth === 0) return s.slice(start, i + 1); } else if (s[i] === '(') i = skipString(s, i);
    }
    return s.slice(start);
  }
  if (s[i] === '[') {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === '[') depth++;
      else if (s[i] === ']' && --depth === 0) return s.slice(start, i + 1);
      else if (s[i] === '(') i = skipString(s, i);
    }
    return s.slice(start);
  }
  const ref = /^(\d+\s+\d+\s+R)/.exec(s.slice(i));
  if (ref) return ref[1];
  const tok = /^\/[^\s/<>[\]()]+|^[^\s/<>[\]()]+/.exec(s.slice(i));
  return tok ? tok[0] : '';
}

// ---------- Page tree ----------

const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

// Returns the pages in reading order as [{ num, inherited: {key: raw} }].
function listPages(objects) {
  const catalog = [...objects.entries()].find(([, o]) => /\/Type\s*\/Catalog\b/.test(o.dict));
  if (!catalog) throw new Error('PDF catalog not found');
  const root = getRef(catalog[1].dict, 'Pages');
  if (root == null) throw new Error('PDF page tree not found');
  const pages = [];
  const seen = new Set();
  (function walk(num, inherited) {
    if (seen.has(num)) return;
    seen.add(num);
    const obj = objects.get(num);
    if (!obj) return;
    const own = { ...inherited };
    for (const key of INHERITED) {
      const v = getRawValue(obj.dict, key);
      if (v) own[key] = v;
    }
    if (/\/Type\s*\/Pages\b/.test(obj.dict)) {
      for (const kid of getRefArray(obj.dict, 'Kids') || []) walk(kid, own);
    } else if (/\/Type\s*\/Page\b/.test(obj.dict)) {
      pages.push({ num, inherited: own });
    }
  })(root, {});
  return pages;
}

// ---------- Text ----------

function decodeStream(obj) {
  if (!obj || !obj.stream) return null;
  const filter = getRawValue(obj.dict, 'Filter') || '';
  if (!filter) return obj.stream;
  if (/^\/FlateDecode$|^\[\s*\/FlateDecode\s*\]$/.test(filter)) {
    try {
      return zlib.inflateSync(obj.stream);
    } catch (e) {
      // Some writers leave a stray byte or two after the data.
      return zlib.inflateSync(obj.stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    }
  }
  return null; // An encoding we don't read; the page simply yields no text.
}

function unescapePdfString(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] ?? '';
  });
}

// The text drawn on a page, one shown string per line, in drawing order.
// Reads literal strings shown with Tj, ', " and TJ. Payroll exports use simple
// WinAnsi fonts, which latin1 decodes closely enough for names and numbers.
function pageText(objects, pageNum) {
  const page = objects.get(pageNum);
  const contents = getRefArray(page.dict, 'Contents') || [getRef(page.dict, 'Contents')].filter((n) => n != null);
  const lines = [];
  for (const num of contents) {
    const data = decodeStream(objects.get(num));
    if (!data) continue;
    const ops = data.toString('latin1');
    const re = /\[((?:\\.|\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
    let m;
    while ((m = re.exec(ops))) {
      if (m[1] !== undefined) {
        lines.push([...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((p) => unescapePdfString(p[1])).join(''));
      } else {
        lines.push(unescapePdfString(m[2]));
      }
    }
  }
  return lines.join('\n');
}

// ---------- Field detection ----------

function isoDate(s) {
  return s ? s.replace(/\//g, '-') : '';
}

// Reads the employee number, name and pay period off a Nethris pay stub page.
// Every field is optional: what isn't found comes back empty and the admin
// fills the gap when confirming.
function detectFields(text) {
  // "00059095 000000001" — the company number followed by the employee number,
  // printed on the deposit notice of every stub.
  let payrollNumber = '';
  const pair = /\b\d{8}\s+(\d{9})\b/.exec(text);
  if (pair) {
    payrollNumber = pair[1];
  } else {
    const counts = new Map();
    for (const m of text.matchAll(/\b(\d{9})\b/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) payrollNumber = best[0];
  }

  // "Last, First" as printed on the stub. The field label itself also has a
  // comma ("NOM, PRÉNOM"), so all-capital matches are skipped.
  let name = '';
  for (const m of text.matchAll(/([A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'.-]+(?: [A-ZÀ-ÖØ-Þa-zß-ÿ'.-]+)*, [A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'.-]+(?:[ -][A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'.-]+)*)/g)) {
    if (m[1] === m[1].toUpperCase()) continue;
    name = m[1].trim();
    break;
  }

  const pp = /PP:\s*(\d+)\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{4}\/\d{2}\/\d{2})/.exec(text);
  const payable = /DATE PAYABLE:\s*(\d{4}\/\d{2}\/\d{2})/.exec(text);
  const pageOf = /PAGE\s+(\d+)\s+DE\s+(\d+)/.exec(text);

  return {
    payrollNumber,
    name,
    payPeriodNumber: pp ? Number(pp[1]) : null,
    periodStart: pp ? isoDate(pp[2]) : '',
    periodEnd: pp ? isoDate(pp[3]) : '',
    payDate: payable ? isoDate(payable[1]) : '',
    pageIndex: pageOf ? Number(pageOf[1]) : null,
    pageTotal: pageOf ? Number(pageOf[2]) : null,
  };
}

// ---------- Writing ----------

// Builds a standalone PDF containing `pageNums` (in order), copying every
// object they reach except the old page tree.
function buildPdf(objects, pages) {
  const renumber = new Map();
  const order = [];
  const pageSet = new Set(pages.map((p) => p.num));

  function visit(num) {
    if (renumber.has(num)) return;
    const obj = objects.get(num);
    if (!obj) return;
    // A link to another employee's page must not drag that page (and through
    // its parent, the whole document) into this one; it becomes null instead.
    if (/\/Type\s*\/(Pages?|Catalog)\b/.test(obj.dict)) return;
    renumber.set(num, order.length + 3); // 1 = catalog, 2 = pages
    order.push(num);
    for (const m of obj.dict.matchAll(REF_RE)) visit(Number(m[1]));
  }

  // Inherited values must be written onto the page, since its old parent is gone.
  const pageDicts = new Map();
  for (const p of pages) {
    let dict = stripParent(objects.get(p.num).dict);
    for (const key of INHERITED) {
      if (p.inherited[key] && !new RegExp(`/${key}(?![A-Za-z0-9])`).test(dict)) {
        dict = dict.replace(/>>\s*$/, `/${key} ${p.inherited[key]}>>`);
      }
    }
    pageDicts.set(p.num, dict);
  }
  for (const p of pages) {
    renumber.set(p.num, order.length + 3);
    order.push(p.num);
  }
  for (const p of pages) {
    for (const m of pageDicts.get(p.num).matchAll(REF_RE)) visit(Number(m[1]));
  }

  const rewrite = (dict) => dict.replace(REF_RE, (all, n) => (renumber.has(Number(n)) ? `${renumber.get(Number(n))} 0 R` : 'null'));

  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (b) => { chunks.push(b); length += b.length; };
  push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));

  const kids = pages.map((p) => `${renumber.get(p.num)} 0 R`).join(' ');
  offsets[1] = length;
  push(Buffer.from('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n', 'latin1'));
  offsets[2] = length;
  push(Buffer.from(`2 0 obj\n<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>\nendobj\n`, 'latin1'));

  for (const num of order) {
    const obj = objects.get(num);
    const newNum = renumber.get(num);
    let dict = pageDicts.has(num) ? pageDicts.get(num).replace(/>>\s*$/, '/Parent 2 0 R>>') : obj.dict;
    dict = rewrite(dict);
    offsets[newNum] = length;
    if (obj.stream) {
      // /Length may have pointed at another object; state it directly.
      dict = dict.replace(/\/Length\s+(\d+\s+\d+\s+R|null|\d+)/, `/Length ${obj.stream.length}`);
      push(Buffer.from(`${newNum} 0 obj\n${dict}\nstream\n`, 'latin1'));
      push(obj.stream);
      push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      push(Buffer.from(`${newNum} 0 obj\n${dict}\nendobj\n`, 'latin1'));
    }
  }

  const count = order.length + 3;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks, length);
}

function stripParent(dict) {
  return dict.replace(/\/Parent\s+\d+\s+\d+\s+R/, '');
}

// ---------- Entry point ----------

// Returns [{ pdf: Buffer, pages: number, fields }] — one entry per employee.
// Consecutive pages carrying the same employee number are kept together, so a
// two-page stub stays one document.
function splitPayStubs(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('This file is not a PDF.');
  }
  const head = buf.toString('latin1');
  if (/\/Encrypt\b/.test(head)) throw new Error('This PDF is password-protected; export it without protection.');
  if (/\/ObjStm\b/.test(head)) throw new Error('This PDF uses a compressed format the app cannot read.');

  const objects = readObjects(buf);
  const pages = listPages(objects);
  if (!pages.length) throw new Error('No pages found in this PDF.');

  const groups = [];
  for (const page of pages) {
    const fields = detectFields(pageText(objects, page.num));
    const prev = groups[groups.length - 1];
    const continues = prev && fields.payrollNumber && prev.fields.payrollNumber === fields.payrollNumber &&
      !(fields.pageIndex === 1);
    if (continues) prev.pages.push(page);
    else groups.push({ pages: [page], fields });
  }
  return groups.map((g) => ({ pdf: buildPdf(objects, g.pages), pages: g.pages.length, fields: g.fields }));
}

module.exports = { splitPayStubs, detectFields, readObjects, listPages, pageText };
