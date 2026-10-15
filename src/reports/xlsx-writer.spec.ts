import ExcelJS from 'exceljs';
import type { Report } from './report.types';
import { renderXlsx } from './xlsx-writer';

const report: Report = {
  title: 'Оплати',
  fileName: 'оплати',
  period: { from: '2026-10-01', to: '2026-10-31' },
  columns: [
    { key: 'date', label: 'Дата', type: 'date' },
    { key: 'child', label: 'Дитина', type: 'text' },
    { key: 'count', label: 'Кількість', type: 'number' },
    { key: 'share', label: 'Частка', type: 'percent' },
    { key: 'amount', label: 'Сума', type: 'money' },
  ],
  rows: [
    {
      date: '2026-10-05',
      child: 'Іваненко Олена',
      count: 2,
      share: 0.5,
      amount: '1250.50',
    },
    {
      date: null,
      child: 'Петренко Іван',
      count: 1,
      share: null,
      amount: '0.10',
    },
  ],
  totals: {
    date: null,
    child: 'Разом',
    count: 3,
    share: null,
    amount: '1250.60',
  },
  sheets: [
    {
      name: 'За способами',
      columns: [
        { key: 'method', label: 'Спосіб', type: 'text' },
        { key: 'amount', label: 'Сума', type: 'money' },
      ],
      rows: [{ method: 'Готівка', amount: '1250.60' }],
      totals: null,
    },
  ],
};

const load = async (buffer: Buffer) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return book;
};

describe('renderXlsx', () => {
  it('writes title, header, typed cells and a bold totals row', async () => {
    const book = await load(await renderXlsx(report));
    const sheet = book.getWorksheet('Оплати');
    expect(sheet).toBeDefined();
    expect(sheet!.getCell('A1').value).toBe('Оплати · 01.10.2026 – 31.10.2026');
    expect(sheet!.getCell('A1').font?.bold).toBe(true);
    expect(sheet!.getRow(3).values).toEqual([
      undefined,
      'Дата',
      'Дитина',
      'Кількість',
      'Частка',
      'Сума',
    ]);
    expect(sheet!.getCell('A4').value).toEqual(
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(sheet!.getCell('A4').numFmt).toBe('dd.mm.yyyy');
    expect(sheet!.getCell('E4').value).toBe(1250.5);
    expect(sheet!.getCell('E4').numFmt).toBe('0.00');
    expect(sheet!.getCell('D4').value).toBe(0.5);
    expect(sheet!.getCell('D4').numFmt).toBe('0%');
    expect(sheet!.getCell('A5').value).toBeNull();
    expect(sheet!.getCell('B6').value).toBe('Разом');
    expect(sheet!.getCell('B6').font?.bold).toBe(true);
    expect(sheet!.getCell('E6').value).toBe(1250.6);
    expect(sheet!.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });
  });

  it('adds one worksheet per extra sheet', async () => {
    const book = await load(await renderXlsx(report));
    expect(book.worksheets.map((s) => s.name)).toEqual([
      'Оплати',
      'За способами',
    ]);
    const extra = book.getWorksheet('За способами')!;
    expect(extra.getCell('A3').value).toBe('Спосіб');
    expect(extra.getCell('B4').value).toBe(1250.6);
  });

  it('writes a report without period or rows', async () => {
    const book = await load(
      await renderXlsx({
        ...report,
        period: null,
        rows: [],
        totals: null,
        sheets: [],
      }),
    );
    const sheet = book.getWorksheet('Оплати')!;
    expect(sheet.getCell('A1').value).toBe('Оплати');
    expect(sheet.getCell('A3').value).toBe('Дата');
    expect(sheet.rowCount).toBe(3);
  });
});
