import { describe, it, expect } from 'vitest'
import { parseLeagueSettings } from './leagueSettings.js'

function makeRawSettings() {
  return {
    fantasy_content: {
      league: [
        { league_key: '453.l.1', name: 'Test League' },
        {
          settings: [
            {
              num_playoff_teams: '6',
              stat_categories: {
                stats: [
                  { stat: { stat_id: '1', name: 'Goals', display_name: 'G', sort_order: '1' } },
                  { stat: { stat_id: '2', name: 'Assists', display_name: 'A', sort_order: '1' } },
                  {
                    stat: {
                      stat_id: '26',
                      name: 'Goals Against Average',
                      display_name: 'GAA',
                      sort_order: '0',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  }
}

describe('parseLeagueSettings', () => {
  it('extracts every stat category with its label and direction', () => {
    const result = parseLeagueSettings(makeRawSettings())

    expect(result.categories).toEqual([
      { statId: '1', label: 'G', higherWins: true },
      { statId: '2', label: 'A', higherWins: true },
      { statId: '26', label: 'GAA', higherWins: false },
    ])
  })

  it('extracts the playoff team count as a number', () => {
    const result = parseLeagueSettings(makeRawSettings())
    expect(result.playoffTeams).toBe(6)
  })

  it('returns an empty category list and null playoffTeams for a malformed response, not a throw', () => {
    const result = parseLeagueSettings({ fantasy_content: {} })
    expect(result).toEqual({ categories: [], playoffTeams: null })
  })
})
