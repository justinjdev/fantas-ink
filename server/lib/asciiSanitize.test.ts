import { describe, it, expect } from 'vitest'
import { sanitizeAscii } from './asciiSanitize.js'

describe('sanitizeAscii', () => {
  it('passes plain ASCII text through unchanged', () => {
    expect(sanitizeAscii('Zamboni Drivers')).toBe('Zamboni Drivers')
  })

  it('transliterates common accented Latin characters to their ASCII base letter', () => {
    expect(sanitizeAscii('Café Champions')).toBe('Cafe Champions')
  })

  it('strips characters with no reasonable ASCII equivalent, e.g. emoji', () => {
    expect(sanitizeAscii('Puck Norris 🏒')).toBe('Puck Norris')
  })

  it('collapses whitespace left behind by stripped characters', () => {
    expect(sanitizeAscii('Ice   🧊   Capades')).toBe('Ice Capades')
  })

  it('returns an empty string, not a crash, for an all-non-ASCII input', () => {
    expect(sanitizeAscii('🏒🥅🏆')).toBe('')
  })
})
