/**
 * Safe money handling utilities to prevent NaN and formatting issues.
 * All currency values should go through these helpers.
 */

/**
 * Safely converts any value to a number, returning 0 for null/undefined/NaN.
 */
export function safeNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Safely sums an array of values, handling null/undefined/NaN gracefully.
 */
export function safeSum(values: unknown[]): number {
  return values.reduce<number>((acc, val) => acc + safeNumber(val), 0);
}

/**
 * Safely sums a specific field from an array of objects.
 */
export function safeSumField<T>(items: T[], field: keyof T): number {
  return items.reduce((acc, item) => acc + safeNumber(item[field]), 0);
}

/**
 * Format a number as South African Rand currency.
 * @param value - The value to format
 * @param options - Formatting options
 */
export function formatRand(
  value: unknown,
  options: {
    decimals?: number;
    compact?: boolean; // Show as "1.2M" instead of "1,200,000"
    showSign?: boolean; // Show + for positive values
  } = {}
): string {
  const { decimals = 2, compact = false, showSign = false } = options;
  const num = safeNumber(value);
  
  if (!Number.isFinite(num)) {
    return '—';
  }
  
  const sign = showSign && num > 0 ? '+' : '';
  
  if (compact) {
    const absNum = Math.abs(num);
    if (absNum >= 1_000_000_000) {
      return `${sign}R${(num / 1_000_000_000).toFixed(decimals)}B`;
    }
    if (absNum >= 1_000_000) {
      return `${sign}R${(num / 1_000_000).toFixed(decimals)}M`;
    }
    if (absNum >= 1_000) {
      return `${sign}R${(num / 1_000).toFixed(decimals)}K`;
    }
  }
  
  return `${sign}R${num.toLocaleString('en-ZA', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  })}`;
}

/**
 * Format a percentage safely.
 */
export function formatPercent(
  value: unknown, 
  options: { decimals?: number; showSign?: boolean } = {}
): string {
  const { decimals = 1, showSign = false } = options;
  const num = safeNumber(value);
  
  if (!Number.isFinite(num)) {
    return '—';
  }
  
  const sign = showSign && num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

/**
 * Calculate a safe percentage (numerator / denominator * 100).
 * Returns 0 if denominator is 0 or either value is invalid.
 */
export function safePercent(numerator: unknown, denominator: unknown): number {
  const num = safeNumber(numerator);
  const denom = safeNumber(denominator);
  
  if (denom === 0 || !Number.isFinite(num) || !Number.isFinite(denom)) {
    return 0;
  }
  
  return (num / denom) * 100;
}

/**
 * Format a number with thousands separators.
 */
export function formatNumber(value: unknown, decimals = 0): string {
  const num = safeNumber(value);
  
  if (!Number.isFinite(num)) {
    return '—';
  }
  
  return num.toLocaleString('en-ZA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Check if a value is a valid, non-zero number.
 */
export function hasValue(value: unknown): boolean {
  const num = safeNumber(value);
  return Number.isFinite(num) && num !== 0;
}
