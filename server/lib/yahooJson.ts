// Yahoo's JSON represents arrays as objects with stringified numeric keys plus
// a sibling "count" key, with inconsistent nesting depth. These helpers search
// by key name rather than assuming fixed positions or depths. Shared by
// lib/transform.ts and scripts/setup-yahoo-auth.ts — do not duplicate.
export function numberedEntries(container: Record<string, unknown>): unknown[] {
  const entries: unknown[] = []
  for (const [key, value] of Object.entries(container)) {
    if (key === 'count') continue
    entries.push(value)
  }
  return entries
}

export function findByKey(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findByKey(item, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  const record = node as Record<string, unknown>
  if (key in record) return record[key]
  for (const value of Object.values(record)) {
    const found = findByKey(value, key)
    if (found !== undefined) return found
  }
  return undefined
}
