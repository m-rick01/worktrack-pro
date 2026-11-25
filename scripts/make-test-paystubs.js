// Writes a FAKE payroll PDF in the layout the pay stub splitter reads, so the
// upload can be tried without a real payroll export (which holds real people's
// pay and must never be used for testing).
//
//   node scripts/make-test-paystubs.js [outfile] [--period N]
//
// outfile defaults to data/test-paystubs.pdf (data/ is not committed). Each
// --period step moves the pay period on by 14 days, so a second file can be
// made to try a later pay run.
//
// The people are the local test accounts, plus one stranger who matches nobody,
// and one employee whose stub runs to two pages, so every path in the upload
// can be exercised:
//
//   Tremblay, Sarah   employee number 11   -> matched by number or name
//   Bouchard, Marc    employee number 12   -> matched by number or name
//   Louis, Emmrick    employee number 13   -> two pages, must stay one stub
//   Gagnon, Julie     employee number 99   -> no such account: must be unmatched
const fs = require('node:fs');
const path = require('node:path');
const { PdfDoc } = require('../src/pdf');

const args = process.argv.slice(2);
const periodFlag = args.indexOf('--period');
const period = periodFlag === -1 ? 0 : Number(args[periodFlag + 1]) || 0;
// The value after --period is not the output path. When there is no --period,
// indexOf gives -1 and "periodFlag + 1" is 0, which used to exclude the FIRST
// argument, so an explicit path was silently ignored and the file was written to
// the default location instead.
const outFile = args.find((a, i) => !a.startsWith('--') && !(periodFlag !== -1 && i === periodFlag + 1)) ||
  path.join(__dirname, '..', 'data', 'test-paystubs.pdf');

const COMPANY = '00059095';

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, '/');
}

const periodStart = addDays('2026-10-18', period * 14);
const periodEnd = addDays('2026-10-31', period * 14);
const payDate = addDays('2026-11-06', period * 14);
const periodNumber = 22 + period;

const people = [
  { name: 'Tremblay, Sarah', number: '000000011', pages: 1, gross: '1 482,50' },
  { name: 'Bouchard, Marc', number: '000000012', pages: 1, gross: '1 320,00' },
  { name: 'Louis, Emmrick', number: '000000013', pages: 2, gross: '1 905,75' },
  { name: 'Gagnon, Julie', number: '000000099', pages: 1, gross: '1 100,00' },
];

const doc = new PdfDoc({ margin: 48 });
let first = true;

for (const person of people) {
  for (let page = 1; page <= person.pages; page++) {
    if (!first) doc.addPage();
    first = false;
    const x = doc.margin;
    let y = 60;
    const line = (str, opts = {}) => {
      doc.text(str, x, y, { size: 10, ...opts });
      y += 18;
    };

    line('BULLETIN DE PAIE - DOCUMENT FICTIF DE TEST', { bold: true, size: 12 });
    line('Aucune donnée réelle. Généré par scripts/make-test-paystubs.js');
    y += 12;
    // The label is all capitals and has a comma too; the splitter has to skip it.
    line('NOM, PRÉNOM');
    line(person.name, { bold: true });
    y += 12;
    // Company number then employee number, as on the deposit notice.
    line(`${COMPANY} ${person.number}`);
    line(`PP: ${periodNumber} ${periodStart} ${periodEnd}`);
    line(`DATE PAYABLE: ${payDate}`);
    y += 12;
    if (page === 1) {
      line(`SALAIRE BRUT: ${person.gross} $`);
      line('DÉDUCTIONS: (fictives)');
    } else {
      line('SUITE - CUMULS DE L’ANNÉE (fictifs)');
    }
    y += 24;
    line(`PAGE ${page} DE ${person.pages}`, { size: 9 });
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, doc.toBuffer());
console.log(`wrote ${outFile}`);
console.log(`  pay period ${periodNumber}: ${periodStart} to ${periodEnd}, payable ${payDate}`);
console.log(`  ${people.length} people, ${people.reduce((n, p) => n + p.pages, 0)} pages`);
