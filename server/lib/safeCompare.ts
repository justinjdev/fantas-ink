// server/lib/safeCompare.ts
import { timingSafeEqual } from 'node:crypto'

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}
