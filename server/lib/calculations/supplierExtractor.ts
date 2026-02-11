export function extractSupplierName(invoiceNumber: string | null | undefined): string | null {
  if (!invoiceNumber || !invoiceNumber.trim()) return null;
  const inv = invoiceNumber.trim();
  const dashIdx = inv.indexOf(' - ');
  if (dashIdx > 0) {
    return inv.substring(0, dashIdx).trim();
  }
  const parts = inv.split(/[-_]/);
  if (parts.length >= 2 && /^[A-Za-z]/.test(parts[0])) {
    return parts[0].trim();
  }
  return null;
}
