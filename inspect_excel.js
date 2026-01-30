const XLSX = require('xlsx');

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

if (cashflowSheet) {
  console.log(`\n=== ${cashflowSheet} SHEET (First 10 rows, cols 0-8) ===`);
  const sheet = workbook.Sheets[cashflowSheet];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  data.slice(0, 10).forEach((row, i) => {
    console.log(`Row ${i}:`, row.slice(0, 8));
  });
}

if (revenueSheet) {
  console.log(`\n=== ${revenueSheet} SHEET (First 8 rows) ===`);
  const sheet = workbook.Sheets[revenueSheet];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  data.slice(0, 8).forEach((row, i) => {
    console.log(`Row ${i}:`, row.slice(0, 6));
  });
}

if (cosSheet) {
  console.log(`\n=== ${cosSheet} SHEET (First 8 rows) ===`);
  const sheet = workbook.Sheets[cosSheet];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  data.slice(0, 8).forEach((row, i) => {
    console.log(`Row ${i}:`, row.slice(0, 6));
  });
}
