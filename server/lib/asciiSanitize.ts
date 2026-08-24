// Normalizes to NFKD (splits accented characters into a base letter + a
// combining diacritical mark), strips the marks and anything else outside
// printable ASCII, then collapses whitespace left behind by removed
// characters. The firmware's vendored fonts only cover 0x20-0x7E; this is
// the one place that constraint gets enforced, so nothing downstream needs
// its own per-glyph fallback.
export function sanitizeAscii(text: string): string {
  const stripped = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .replace(/[^\x20-\x7E]/g, '')
  return stripped.replace(/\s+/g, ' ').trim()
}
