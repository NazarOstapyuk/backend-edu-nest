export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type Cell = string | number | null;

export type ReportRow = Record<string, Cell>;

export interface ReportSheet {
  name: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
}

export interface Report {
  title: string;
  fileName: string;
  period: { from: string; to: string } | null;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  sheets: ReportSheet[];
}
