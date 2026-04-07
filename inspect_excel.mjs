import ExcelJS from 'exceljs';

const filePath = process.argv[2];
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);

console.log('\n=== SHEET NAMES ===');
console.log(workbook.worksheets.map(ws => ws.name).join('\n'));

const cashflowSheet = workbook.worksheets.find(ws => 
  ws.name.toLowerCase().includes('cashflow') || ws.name.toLowerCase().includes('cash flow')
);
const revenueSheet = workbook.worksheets.find(ws =>
  ws.name.toLowerCase().includes('revenue') && ws.name.toLowerCase().includes('finance')
);
const cosSheet = workbook.worksheets.find(ws =>
  ws.name.toLowerCase().includes('cos') && ws.name.toLowerCase().includes('finance')
);

console.log('\n=== MATCHING SHEETS ===');
console.log('Cashflow:', cashflowSheet?.name || 'NOT FOUND');
console.log('Revenue:', revenueSheet?.name || 'NOT FOUND');
console.log('COS:', cosSheet?.name || 'NOT FOUND');

function sheetToRows(ws, maxRows, maxCols) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= maxRows) return;
    const vals = [];
    for (let c = 1; c <= maxCols; c++) {
      const cell = row.getCell(c);
      vals.push(cell.value);
    }
    rows.push({ rowNumber, vals });
  });
  return rows;
}

if (cashflowSheet) {
  console.log(`\n=== ${cashflowSheet.name} SHEET (First 10 rows, cols 0-8) ===`);
  const rows = sheetToRows(cashflowSheet, 10, 8);
  rows.forEach(r => console.log(`Row ${r.rowNumber}:`, r.vals));
}
