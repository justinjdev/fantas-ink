// server/scripts/setup-yahoo-auth.test.ts
import { describe, it, expect } from 'vitest'
import { parseLeagueTeamKeys } from './setup-yahoo-auth.js'

describe('parseLeagueTeamKeys', () => {
  it('extracts league and team key/name pairs for the logged-in user across their NHL leagues', () => {
    // Shape per Yahoo's numbered-object convention, confirmed against
    // documented field names (league_key, team_key, name) — see design
    // research notes; verify against a live response before relying on
    // exact nesting depth in production.
    const raw = {
      fantasy_content: {
        users: {
          '0': {
            user: [
              {},
              {
                games: {
                  '0': {
                    game: [
                      {},
                      {
                        leagues: {
                          '0': {
                            league: [
                              { league_key: '453.l.1', name: 'My League' },
                              {
                                teams: {
                                  '0': { team: [[{ team_key: '453.l.1.t.7' }, { name: 'My Team' }]] },
                                  count: 1,
                                },
                              },
                            ],
                          },
                          count: 1,
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    }

    const result = parseLeagueTeamKeys(raw)

    expect(result).toEqual([
      { leagueKey: '453.l.1', leagueName: 'My League', teamKey: '453.l.1.t.7', teamName: 'My Team' },
    ])
  })
})
