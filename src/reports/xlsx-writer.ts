import ExcelJS from 'exceljs';
import { uaDay } from '../tariffs/dates';
import type {
  Cell,
  ColumnType,
  Report,
  ReportColumn,
  ReportRow,
} from './report.types';

const FORMATS: Partial<Record<ColumnType, string>> = {
  money: '0.00',
  date: 'dd.mm.yyyy',
  percent: '0%',
};

const SHEET_NAME_MAX = 31;

const cellValue = (type: ColumnType, value: Cell): ExcelJS.CellValue => {
  if (value === null || value === '') return null;
  if (type === 'money') return Number(Number(value).toFixed(2));
  if (type === 'date') return new Date(`${String(value)}T00:00:00.000Z`);
  return value;
};

const day = (value: string) => uaDay(new Date(`${value}T00:00:00.000Z`));

const heading = (report: Report) =>
  report.period
    ? `${report.title} · ${day(report.period.from)} – ${day(report.period.to)}`
    : report.title;

function writeSheet(
  book: ExcelJS.Workbook,
  name: string,
  title: string,
  columns: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow | null,
) {
  const sheet = book.addWorksheet(name.slice(0, SHEET_NAME_MAX), {
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  const header = sheet.getRow(3);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true };
  });
  const lines = totals ? [...rows, totals] : rows;
  lines.forEach((row, rowIndex) => {
    const line = sheet.getRow(4 + rowIndex);
    columns.forEach((column, index) => {
      const cell = line.getCell(index + 1);
      cell.value = cellValue(column.type, row[column.key] ?? null);
      const format = FORMATS[column.type];
      if (format) cell.numFmt = format;
      if (totals && rowIndex === rows.length) cell.font = { bold: true };
    });
  });
  columns.forEach((column, index) => {
    const width = Math.max(
      column.label.length,
      ...lines.map((row) => String(row[column.key] ?? '').length),
    );
    sheet.getColumn(index + 1).width = Math.min(Math.max(width + 2, 10), 60);
  });
}

export async function renderXlsx(report: Report): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const title = heading(report);
  writeSheet(
    book,
    report.title,
    title,
    report.columns,
    report.rows,
    report.totals,
  );
  for (const extra of report.sheets)
    writeSheet(
      book,
      extra.name,
      `${title} · ${extra.name}`,
      extra.columns,
      extra.rows,
      extra.totals,
    );
  return Buffer.from(await book.xlsx.writeBuffer());
}
