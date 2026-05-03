import ExcelJS from 'exceljs';
async function t(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
}
