import { describe, it, expect } from 'vitest'
import { findByKey, numberedEntries } from './yahooJson.js'

describe('findByKey', () => {
  it('finds a key nested inside arrays and objects at any depth', () => {
    const node = [{}, { a: [{ b: { target: 'found' } }] }]
    expect(findByKey(node, 'target')).toBe('found')
  })

  it('returns undefined when the key is absent', () => {
    expect(findByKey({ a: { b: 1 } }, 'missing')).toBeUndefined()
  })
})

describe('numberedEntries', () => {
  it('returns the numbered values and excludes the sibling "count" key', () => {
    const container = { '0': 'a', '1': 'b', count: 2 }
    expect(numberedEntries(container)).toEqual(['a', 'b'])
  })
})
