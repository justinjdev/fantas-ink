import { describe, it, expect } from 'vitest'
import { transformStandings, formatWinPct, formatStreak, parseAllTeams, formatRecord } from './transform.js'

function makeTeam(rank: number, teamKey: string, wins: number, losses: number, ties = 0, streak = { type: 'wins', value: '1' }) {
  return {
    team: [
      [{ team_key: teamKey }, { name: `Team ${rank}` }],
      {
        team_standings: {
          rank,
          outcome_totals: { wins: String(wins), losses: String(losses), ties: String(ties) },
          streak,
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

describe('formatWinPct', () => {
  it('formats a fractional record without a leading zero', () => {
    expect(formatWinPct(10, 2, 0)).toBe('.833')
  })

  it('formats an undefeated record as 1.000, not .000', () => {
    expect(formatWinPct(12, 0, 0)).toBe('1.000')
  })

  it('formats a winless record as .000', () => {
    expect(formatWinPct(0, 12, 0)).toBe('.000')
  })

  it('counts ties as games played', () => {
    expect(formatWinPct(5, 5, 2)).toBe('.417')
  })

  it('returns .000 for zero games played rather than dividing by zero', () => {
    expect(formatWinPct(0, 0, 0)).toBe('.000')
  })
})

describe('formatStreak', () => {
  it('formats a winning streak', () => {
    expect(formatStreak({ type: 'wins', value: '4' })).toBe('W4')
  })

  it('formats a losing streak', () => {
    expect(formatStreak({ type: 'losses', value: '2' })).toBe('L2')
  })

  it('formats a tie streak', () => {
    expect(formatStreak({ type: 'ties', value: '1' })).toBe('T1')
  })

  it('accepts a numeric value, not just a string', () => {
    expect(formatStreak({ type: 'wins', value: 3 })).toBe('W3')
  })
})

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
    expect(rankOne).toMatchObject({ winPct: '1.000' })
    expect(rankOne).toMatchObject({ streak: 'W1' })
  })

  it('handles a small league where top 3 and window cover everyone (8 teams, myRank=5)', () => {
    const raw = makeRawStandings(8)
    const result = transformStandings(raw, '453.l.1.t.5', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('reads the league name from the top of the raw response, not a team name', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    expect(result.leagueName).toBe('Test League')
  })

  it('sanitizes non-ASCII characters out of team and league names', () => {
    const raw = makeRawStandings(16)
    raw.fantasy_content.league[0].name = 'Café Legends 🏒'
    const secondLeagueEntry = raw.fantasy_content.league[1] as { standings: { teams: Record<string, unknown> }[] }
    const teamOneWrapper = secondLeagueEntry.standings[0].teams['0'] as { team: unknown[] }
    ;(teamOneWrapper.team[0] as unknown[])[1] = { name: 'Café Team 🏒' }
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)
    expect(result.leagueName).toBe('Cafe Legends')
    const rankOne = result.rows.find((r) => 'rank' in r && r.rank === 1)
    expect(rankOne).toMatchObject({ name: 'Cafe Team' })
  })
})

describe('parseAllTeams', () => {
  it('is exported and returns every team, not just the windowed subset', () => {
    const raw = makeRawStandings(16)
    const teams = parseAllTeams(raw)

    expect(teams).toHaveLength(16)
    expect(teams.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  })

  it('can look up a team not in a windowed rows[] result by team key', () => {
    const ASOF = '2026-08-21T11:55:00Z'
    const raw = makeRawStandings(16)

    // With myTeamKey at rank 8, the window is [6, 7, 8, 9, 10], combined with top 3 = [1, 2, 3, gap, 6, 7, 8, 9, 10]
    // So rank 4 is absent from the windowed result
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)
    const ranksInWindow = result.rows.filter((r) => 'rank' in r).map((r) => ('rank' in r ? r.rank : null))
    expect(ranksInWindow).not.toContain(4)

    // But parseAllTeams returns every team, including rank 4
    const teams = parseAllTeams(raw)
    const rankFour = teams.find((t) => t.teamKey === '453.l.1.t.4')
    expect(rankFour).toMatchObject({ rank: 4, wins: 12, losses: 3 })
  })
})

describe('formatRecord', () => {
  it('formats a record as wins-losses-ties', () => {
    expect(formatRecord(6, 6, 0)).toBe('6-6-0')
  })
})
