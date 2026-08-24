import { describe, it, expect } from 'vitest'
import { parseMatchups } from './matchup.js'
import type { CategoryDef } from './leagueSettings.js'

const CATEGORIES: CategoryDef[] = [
  { statId: '1', label: 'G', higherWins: true },
  { statId: '2', label: 'A', higherWins: true },
  { statId: '26', label: 'GAA', higherWins: false },
]

function makeMatchupTeam(teamKey: string, name: string, statValues: Record<string, string>) {
  return {
    team: [
      [{ team_key: teamKey }, { name }],
      { team_stats: { stats: Object.entries(statValues).map(([stat_id, value]) => ({ stat: { stat_id, value } })) } },
    ],
  }
}

function makeMatchup(
  week: number,
  status: string,
  myStats: Record<string, string>,
  theirStats: Record<string, string>,
  opponentName = 'Puck Norris',
  opponentTeamKey = '453.l.1.t.2',
) {
  return {
    matchup: {
      week: String(week),
      status,
      teams: {
        '0': { team: makeMatchupTeam('453.l.1.t.8', 'Cellar Dwellers', myStats).team },
        '1': { team: makeMatchupTeam(opponentTeamKey, opponentName, theirStats).team },
        count: 2,
      },
    },
  }
}

function makeRawMatchups(matchups: Record<string, unknown>) {
  return {
    fantasy_content: {
      team: [
        [{ team_key: '453.l.1.t.8' }, { name: 'Cellar Dwellers' }],
        { matchups: { ...matchups, count: Object.keys(matchups).length } },
      ],
    },
  }
}

describe('parseMatchups', () => {
  it('builds the current matchup from a midevent entry, with per-category tally', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(20, 'midevent', { '1': '14', '2': '18', '26': '2.85' }, { '1': '10', '2': '22', '26': '2.60' }),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    expect(result.current).toEqual({
      opponent: 'Puck Norris',
      status: 'BEHIND', // I lead G only (higherWins), they lead A (higherWins) and GAA (lower wins, 2.60 < 2.85)
      tally: '1-2-0',
      categories: [
        { label: 'G', mine: 14, theirs: 10, higherWins: true },
        { label: 'A', mine: 18, theirs: 22, higherWins: true },
        { label: 'GAA', mine: 2.85, theirs: 2.6, higherWins: false },
      ],
    })
  })

  it('builds the last matchup from the most recent postevent entry', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(18, 'postevent', { '1': '5', '2': '3', '26': '3.10' }, { '1': '2', '2': '9', '26': '2.90' }),
      '1': makeMatchup(19, 'postevent', { '1': '8', '2': '5', '26': '2.60' }, { '1': '5', '2': '9', '26': '2.85' }),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    // Week 19 is more recent than week 18 — must pick that one, not the first in the container.
    // Week 19 tallies WON 2-1-0 (G mine, A theirs, GAA mine since lower wins); week 18 tallies
    // LOST 1-2-0. The two are distinguishable, so this genuinely pins which week was selected.
    expect(result.last).toEqual({ opponent: 'Puck Norris', status: 'WON', tally: '2-1-0' })
  })

  it('builds the next matchup from the soonest preevent entry, with no status or tally', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(22, 'preevent', {}, {}, 'Later Opponent', '453.l.1.t.5'),
      '1': makeMatchup(21, 'preevent', {}, {}, 'Sooner Opponent', '453.l.1.t.3'),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    // Week 21 is sooner than week 22 — must pick that one, not the first in the container.
    expect(result.next).toEqual({ opponent: 'Sooner Opponent', opponentTeamKey: '453.l.1.t.3' })
  })

  it('returns null for any matchup state with no matching entry, not a throw', () => {
    const raw = makeRawMatchups({})
    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)
    expect(result).toEqual({ current: null, last: null, next: null })
  })

  it('marks a tied current matchup correctly', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(20, 'midevent', { '1': '10' }, { '1': '10' }),
    })
    const categories: CategoryDef[] = [{ statId: '1', label: 'G', higherWins: true }]

    const result = parseMatchups(raw, '453.l.1.t.8', categories)

    expect(result.current?.status).toBe('TIED')
    expect(result.current?.tally).toBe('0-0-1')
  })
})
