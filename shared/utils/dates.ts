import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export const API_DATE_FORMAT = "YYYY-MM-DD";
export const DISPLAY_DATE_FORMAT_ZA = "DD/MM/YYYY";

export function parseIsoDateStrict(value: string | null | undefined) {
  if (!value) return null;
  const parsed = dayjs(value, [API_DATE_FORMAT, "YYYY-MM-DDTHH:mm:ssZ", "YYYY-MM-DDTHH:mm:ss.SSSZ"], true);
  return parsed.isValid() ? parsed : null;
}

export function parseImportDate(value: string, expectedFormat: string) {
  const parsed = dayjs(value, expectedFormat, true);
  return parsed.isValid() ? parsed : null;
}

export function formatForApi(value: string | Date | dayjs.Dayjs) {
  return dayjs(value).format(API_DATE_FORMAT);
}

export function formatForDisplayZA(value: string | Date | dayjs.Dayjs) {
  return dayjs(value).format(DISPLAY_DATE_FORMAT_ZA);
}
