export interface CashflowLineItem {
  id: number;
  projectName: string;
  type: 'inflow' | 'outflow';
  amount: number;
  actualDate: string | null;
  forecastDate: string | null;
  confidence: 'High' | 'Medium' | 'Low';
  assumptionDriver: string;
  description: string;
  invoiceNumber: string | null;
  poNumber: string | null;
  category: string | null;
  supplierName: string | null;
}

export interface CashflowWeek {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  openingBalance: number;
  inflowsActual: number;
  inflowsForecast: number;
  outflowsActual: number;
  outflowsForecast: number;
  closingBalance: number;
  inflowLineCount: number;
  outflowLineCount: number;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getSunday(monday: Date): Date {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function dateToStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isDateInWeek(dateStr: string, weekStart: Date, weekEnd: Date): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  return d >= weekStart && d <= weekEnd;
}

export function computeWeeklyCashflow(
  inflowLines: CashflowLineItem[],
  outflowLines: CashflowLineItem[],
  startDate: string,
  numWeeks: number,
  openingBalance: number = 0,
): CashflowWeek[] {
  const weeks: CashflowWeek[] = [];
  const firstMonday = getMonday(new Date(startDate));
  let balance = openingBalance;

  for (let i = 0; i < numWeeks; i++) {
    const weekStart = new Date(firstMonday);
    weekStart.setDate(firstMonday.getDate() + i * 7);
    const weekEnd = getSunday(weekStart);

    let inflowsActual = 0;
    let inflowsForecast = 0;
    let inflowLineCount = 0;

    for (const line of inflowLines) {
      if (line.actualDate && isDateInWeek(line.actualDate, weekStart, weekEnd)) {
        inflowsActual += line.amount;
        inflowLineCount++;
      } else if (!line.actualDate && line.forecastDate && isDateInWeek(line.forecastDate, weekStart, weekEnd)) {
        inflowsForecast += line.amount;
        inflowLineCount++;
      }
    }

    let outflowsActual = 0;
    let outflowsForecast = 0;
    let outflowLineCount = 0;

    for (const line of outflowLines) {
      if (line.actualDate && isDateInWeek(line.actualDate, weekStart, weekEnd)) {
        outflowsActual += line.amount;
        outflowLineCount++;
      } else if (!line.actualDate && line.forecastDate && isDateInWeek(line.forecastDate, weekStart, weekEnd)) {
        outflowsForecast += line.amount;
        outflowLineCount++;
      }
    }

    const opening = balance;
    const closing = opening + inflowsActual + inflowsForecast - outflowsActual - outflowsForecast;

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const weekLabel = `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]}`;

    weeks.push({
      weekStart: dateToStr(weekStart),
      weekEnd: dateToStr(weekEnd),
      weekLabel,
      openingBalance: opening,
      inflowsActual,
      inflowsForecast,
      outflowsActual,
      outflowsForecast,
      closingBalance: closing,
      inflowLineCount,
      outflowLineCount,
    });

    balance = closing;
  }

  return weeks;
}

export function getLinesForWeek(
  allLines: CashflowLineItem[],
  weekStart: string,
  weekEnd: string,
): CashflowLineItem[] {
  const ws = new Date(weekStart);
  const we = new Date(weekEnd);
  ws.setHours(0, 0, 0, 0);
  we.setHours(0, 0, 0, 0);

  return allLines.filter(line => {
    const dateStr = line.actualDate || line.forecastDate;
    if (!dateStr) return false;
    return isDateInWeek(dateStr, ws, we);
  });
}
