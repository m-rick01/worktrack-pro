// Minimal PDF writer — no external dependencies, in keeping with the rest of
// the app. Emits PDF 1.4 using the two standard Helvetica fonts, which every
// PDF reader already has, so nothing needs embedding.
//
// Coordinates are given in points (72 per inch) from the TOP-LEFT of the page;
// the PDF format itself measures from the bottom-left, and toBuffer() flips it.

const PAGE_WIDTH = 612; // US Letter portrait
const PAGE_HEIGHT = 792;

// Helvetica advance widths (units per 1000) for ASCII 32..126.
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

// Characters outside Latin-1 that WinAnsiEncoding still provides, mapped to
// their WinAnsi byte. The em dash matters: the UI uses it for "no task type".
const WINANSI_EXTRAS = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

// Accented letters carry the same advance width as their base letter in
// Helvetica, so widths fall back to the base rather than a hand-typed table.
// One character per code point from 0xC0 to 0xFF; '.' means "no simple base".
const ACCENT_BASE =
  'AAAAAAACEEEEIIIIDNOOOOO.OUUUUY..aaaaaaaceeeeiiiidnooooo.ouuuuy.y';
const WIDTH_EXCEPTIONS = {
  0xc6: [1000, 1000], // AE
  0xe6: [889, 889], // ae
  0x8c: [944, 944], // OE
  0x9c: [944, 944], // oe
  0xdf: [611, 611], // germandbls
};

function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 255) out.push(code);
    else if (WINANSI_EXTRAS[ch] !== undefined) out.push(WINANSI_EXTRAS[ch]);
    else out.push(0x3f); // '?'
  }
  return out;
}

function charWidth(code, bold) {
  const table = bold ? W_BOLD : W_REGULAR;
  const exception = WIDTH_EXCEPTIONS[code];
  if (exception) return exception[bold ? 1 : 0];
  if (code >= 32 && code <= 126) return table[code - 32];
  if (code >= 0xc0 && code <= 0xff) {
    const base = ACCENT_BASE[code - 0xc0];
    if (base && base !== '.') return table[base.charCodeAt(0) - 32];
    return table['o'.charCodeAt(0) - 32];
  }
  if (code >= 0x91 && code <= 0x94) return bold ? 238 : 191; // curly quotes
  if (code === 0x96 || code === 0x97) return 556; // en/em dash
  return table[0];
}

// Width of `text` in points when set in `size`-point Helvetica.
function measure(text, size, bold = false) {
  let total = 0;
  for (const code of toWinAnsi(text)) total += charWidth(code, bold);
  return (total / 1000) * size;
}

// Trim `text` with an ellipsis until it fits inside `maxWidth`.
function ellipsize(text, maxWidth, size, bold = false) {
  const str = String(text ?? '');
  if (measure(str, size, bold) <= maxWidth) return str;
  let out = str;
  while (out.length > 1 && measure(out + '…', size, bold) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function escapeText(text) {
  let out = '';
  for (const code of toWinAnsi(text)) {
    const ch = String.fromCharCode(code);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch;
  }
  return out;
}

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

class PdfDoc {
  constructor({ margin = 48 } = {}) {
    this.margin = margin;
    this.width = PAGE_WIDTH;
    this.height = PAGE_HEIGHT;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.margin;
    return this;
  }

  get contentWidth() {
    return this.width - this.margin * 2;
  }

  // Vertical space left on this page before the footer area.
  get remaining() {
    return this.height - this.margin - 24 - this.y;
  }

  text(str, x, yTop, { size = 10, bold = false, color = '#1a1d21', align = 'left', width = 0 } = {}) {
    let drawX = x;
    if (align !== 'left' && width > 0) {
      const w = measure(str, size, bold);
      drawX = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    const font = bold ? '/F2' : '/F1';
    const baseline = this.height - yTop - size;
    this.ops.push(
      `BT ${font} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${drawX.toFixed(2)} ${baseline.toFixed(2)} Tm (${escapeText(str)}) Tj ET`
    );
    return this;
  }

  rect(x, yTop, w, h, color) {
    const bottom = this.height - yTop - h;
    this.ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${bottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }

  line(x1, yTop1, x2, yTop2, { color = '#e3e6ea', width = 0.75 } = {}) {
    this.ops.push(
      `${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(this.height - yTop1).toFixed(2)} m ` +
        `${x2.toFixed(2)} ${(this.height - yTop2).toFixed(2)} l S`
    );
    return this;
  }

  toBuffer() {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // 1-based object number
    };

    const catalogNum = add(null); // placeholders: both need numbers assigned first
    const pagesNum = add(null);
    const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const pageNums = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentNum = add(
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
      );
      pageNums.push(
        add(
          `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
            `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentNum} 0 R >>`
        )
      );
    }

    objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
    objects[pagesNum - 1] =
      `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;

    const chunks = [];
    let offset = 0;
    const push = (str) => {
      const buf = Buffer.from(str, 'latin1');
      chunks.push(buf);
      offset += buf.length;
    };

    push('%PDF-1.4\n');
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      push(`${i + 1} 0 obj\n${body}\nendobj\n`);
    });

    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`
    );

    return Buffer.concat(chunks);
  }
}

module.exports = { PdfDoc, measure, ellipsize, PAGE_WIDTH, PAGE_HEIGHT };
