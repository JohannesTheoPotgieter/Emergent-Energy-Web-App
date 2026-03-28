const STORAGE_PREFIX = "ee_ab_";

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministically assigns a user to an A/B test variant.
 * Uses userId + testName to produce a stable hash, stored in localStorage for consistency.
 */
export function getVariant(
  testName: string,
  variants: string[],
  userId?: string | number | null
): string {
  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0];

  const storageKey = `${STORAGE_PREFIX}${testName}`;
  const stored = localStorage.getItem(storageKey);
  if (stored && variants.includes(stored)) {
    return stored;
  }

  const seed = `${userId ?? "anon"}-${testName}`;
  const index = hashString(seed) % variants.length;
  const variant = variants[index];

  localStorage.setItem(storageKey, variant);
  return variant;
}
