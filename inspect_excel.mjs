import XLSX from 'xlsx';

const filePath = process.argv[2];
const workbook = XLSX.readFile(filePath);
console.log('\n=== SHEET NAMES ===');
console.log(workbook.SheetNames.join('\n'));

const cashflowSheet = workbook.SheetNames.find(name => 
  name.toLowerCase().includes('cashflow') || name.toLowerCase().includes('cash flow')
);
const revenueSheet = workbook.SheetNames.find(name =>
  name.toLowerCase().includes('revenue') && name.toLowerCase().includes('finance')
);
const cosSheet = workbook.SheetNames.find(name =>
  name.toLowerCase().includes('cos') && name.toLowerCase().includes('finance')
);

console.log('\n=== MATCHING SHEETS ===');
console.log('Cashflow:', cashflowSheet || 'NOT FOUND');
console.log('Revenue:', revenueSheet || 'NOT FOUND');
console.log('COS:', cosSheet || 'NOT FOUND');

if (cashflowSheet) {
  console.log(`\n=== ${cashflowSheet} SHEET (First 10 rows, cols 0-8) ===`);
  const sheet = workbook.Sheets[cashflowSheet];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  data.slice(0, 10).forEach((row, i) => {
    console.log(`Row ${i}:`, row.slice(0, 8));
  });
}
