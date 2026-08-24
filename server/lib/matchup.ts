import { findByKey, numberedEntries } from './yahooJson.js'
import type { CategoryDef } from './leagueSettings.js'

export interface CategoryStat {
  label: string
  mine: number
  theirs: number
  higherWins: boolean
}

export interface CurrentMatchup {
  opponent: string
  status: 'AHEAD' | 'BEHIND' | 'TIED'
  tally: string
  categories: CategoryStat[]
}

export interface MatchupSummary {
  opponent: string
  status: 'WON' | 'LOST' | 'TIED'
  tally: string
}

export interface NextOpponent {
  opponent: string
  opponentTeamKey: string
}

export interface ParsedMatchups {
  current: CurrentMatchup | null
  last: MatchupSummary | null
  next: NextOpponent | null
}

interface RawMatchupTeam {
  teamKey: string
  name: string
  stats: Record<string, string>
}

interface RawMatchup {
  week: number
  status: string
  me: RawMatchupTeam
  opponent: RawMatchupTeam
}

function parseMatchupTeam(teamWrapper: unknown): RawMatchupTeam {
  const teamArray = (teamWrapper as { team: unknown[] }).team
  const teamKey = findByKey(teamArray, 'team_key') as string
  const name = findByKey(teamArray, 'name') as string
  const statsContainer = findByKey(teamArray, 'team_stats') as { stats?: unknown[] } | undefined
  const statEntries = Array.isArray(statsContainer?.stats) ? statsContainer!.stats : []
  const stats: Record<string, string> = {}
  for (const entry of statEntries) {
    const stat = (entry as { stat: { stat_id: string; value: string } }).stat
    stats[stat.stat_id] = stat.value
  }
  return { teamKey, name, stats }
}

function parseOneMatchup(matchupWrapper: unknown, myTeamKey: string): RawMatchup | null {
  const matchup = (matchupWrapper as { matchup: Record<string, unknown> }).matchup
  const teamsContainer = findByKey(matchup, 'teams') as Record<string, unknown>
  const teamEntries = numberedEntries(teamsContainer).map(parseMatchupTeam)
  const me = teamEntries.find((t) => t.teamKey === myTeamKey)
  const opponent = teamEntries.find((t) => t.teamKey !== myTeamKey)
  if (!me || !opponent) return null

  return {
    week: Number(matchup.week),
    status: String(matchup.status),
    me,
    opponent,
  }
}

function parseAllMatchups(rawYahooJson: unknown, myTeamKey: string): RawMatchup[] {
  const matchupsContainer = findByKey(rawYahooJson, 'matchups') as Record<string, unknown>
  if (!matchupsContainer) return []
  return numberedEntries(matchupsContainer)
    .map((wrapper) => parseOneMatchup(wrapper, myTeamKey))
    .filter((m): m is RawMatchup => m !== null)
}

function buildCategoryStats(matchup: RawMatchup, categories: CategoryDef[]): CategoryStat[] {
  return categories.map((cat) => ({
    label: cat.label,
    mine: Number(matchup.me.stats[cat.statId]),
    theirs: Number(matchup.opponent.stats[cat.statId]),
    higherWins: cat.higherWins,
  }))
}

function tallyCategoryWins(categoryStats: CategoryStat[]): { mine: number; theirs: number; ties: number } {
  let mine = 0
  let theirs = 0
  let ties = 0
  for (const c of categoryStats) {
    const meLeads = c.higherWins ? c.mine > c.theirs : c.mine < c.theirs
    const theyLead = c.higherWins ? c.theirs > c.mine : c.theirs < c.mine
    if (meLeads) mine++
    else if (theyLead) theirs++
    else ties++
  }
  return { mine, theirs, ties }
}

export function parseMatchups(rawYahooJson: unknown, myTeamKey: string, categories: CategoryDef[]): ParsedMatchups {
  const all = parseAllMatchups(rawYahooJson, myTeamKey)

  const midevent = all.filter((m) => m.status === 'midevent')
  const postevent = all.filter((m) => m.status === 'postevent').sort((a, b) => b.week - a.week)
  const preevent = all.filter((m) => m.status === 'preevent').sort((a, b) => a.week - b.week)

  let current: CurrentMatchup | null = null
  if (midevent.length > 0) {
    const m = midevent[0]
    const categoryStats = buildCategoryStats(m, categories)
    const tally = tallyCategoryWins(categoryStats)
    const status = tally.mine > tally.theirs ? 'AHEAD' : tally.mine < tally.theirs ? 'BEHIND' : 'TIED'
    current = {
      opponent: m.opponent.name,
      status,
      tally: `${tally.mine}-${tally.theirs}-${tally.ties}`,
      categories: categoryStats,
    }
  }

  let last: MatchupSummary | null = null
  if (postevent.length > 0) {
    const m = postevent[0]
    const categoryStats = buildCategoryStats(m, categories)
    const tally = tallyCategoryWins(categoryStats)
    const status = tally.mine > tally.theirs ? 'WON' : tally.mine < tally.theirs ? 'LOST' : 'TIED'
    last = {
      opponent: m.opponent.name,
      status,
      tally: `${tally.mine}-${tally.theirs}-${tally.ties}`,
    }
  }

  let next: NextOpponent | null = null
  if (preevent.length > 0) {
    const m = preevent[0]
    next = { opponent: m.opponent.name, opponentTeamKey: m.opponent.teamKey }
  }

  return { current, last, next }
}
