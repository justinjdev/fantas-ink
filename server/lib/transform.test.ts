import { describe, it, expect } from 'vitest'
import { transformStandings } from './transform.js'

function makeTeam(rank: number, teamKey: string, wins: number, losses: number, ties = 0) {
  return {
    team: [
      [{ team_key: teamKey }, { name: `Team ${rank}` }],
      {
        team_standings: {
          rank,
          outcome_totals: { wins: String(wins), losses: String(losses), ties: String(ties) },
        },
      },
    ],
  }
}

function makeRawStandings(teamCount: number) {
  const teams: Record<string, unknown> = { count: teamCount }
  for (let i = 1; i <= teamCount; i++) {
    // Wins descend with rank so rank order is unambiguous in the fixture.
    teams[String(i - 1)] = makeTeam(i, `453.l.1.t.${i}`, teamCount - i, i - 1)
  }
  return {
    fantasy_content: {
      league: [
        { league_key: '453.l.1', name: 'Test League' },
        { standings: [{ teams }] },
      ],
    },
  }
}

describe('transformStandings', () => {
  const ASOF = '2026-08-21T11:55:00Z'

  it('includes top 3 and my rank +/-2 with a gap divider when they do not overlap (myRank=8 of 16)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    expect(result.asOf).toBe(ASOF)
    expect(result.myTeamKey).toBe('453.l.1.t.8')

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 'gap', 6, 7, 8, 9, 10])

    const me = result.rows.find((r) => 'rank' in r && r.rank === 8)
    expect(me).toMatchObject({ isMe: true })
    const notMe = result.rows.find((r) => 'rank' in r && r.rank === 1)
    expect(notMe).not.toHaveProperty('isMe')
  })

  it('does not insert a gap when top 3 and the neighborhood window are adjacent or overlapping (myRank=4)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.4', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6])
    expect(ranks).not.toContain('gap')
  })

  it('does not insert a gap when the window fully contains the top 3 (myRank=2)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.2', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4])
  })

  it('clamps the window at the bottom of the league (myRank=16 of 16)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.16', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 'gap', 14, 15, 16])
  })

  it('clamps the window at the top of the league (myRank=1)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.1', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3])
  })

  it('extracts wins/losses/ties from outcome_totals as numbers', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    const rankOne = result.rows.find((r) => 'rank' in r && r.rank === 1)
    expect(rankOne).toMatchObject({ wins: 15, losses: 0, ties: 0 })
  })

  it('handles a small league where top 3 and window cover everyone (8 teams, myRank=5)', () => {
    const raw = makeRawStandings(8)
    const result = transformStandings(raw, '453.l.1.t.5', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
