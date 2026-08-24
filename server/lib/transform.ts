import { findByKey, numberedEntries } from './yahooJson.js'

export interface StandingsPayload {
  asOf: string
  myTeamKey: string
  leagueName: string
  rows: StandingsRow[]
}

export type StandingsRow =
  | { rank: number; name: string; wins: number; losses: number; ties: number; winPct: string; streak: string; isMe?: true }
  | { gap: true }

export interface ParsedTeam {
  teamKey: string
  name: string
  rank: number
  wins: number
  losses: number
  ties: number
  streak: { type: string; value: string | number }
}

export function formatWinPct(wins: number, losses: number, ties: number): string {
  const games = wins + losses + ties
  const pct = games === 0 ? 0 : wins / games
  const formatted = pct.toFixed(3)
  return formatted.startsWith('0.') ? formatted.slice(1) : formatted
}

export function formatStreak(streak: { type: string; value: string | number }): string {
  const letter = streak.type === 'wins' ? 'W' : streak.type === 'losses' ? 'L' : 'T'
  return `${letter}${streak.value}`
}

export function formatRecord(wins: number, losses: number, ties: number): string {
  return `${wins}-${losses}-${ties}`
}

function parseTeam(rawTeamWrapper: unknown): ParsedTeam {
  const teamArray = (rawTeamWrapper as { team: unknown[] }).team
  const teamKey = findByKey(teamArray, 'team_key') as string
  const name = findByKey(teamArray, 'name') as string
  const standings = findByKey(teamArray, 'team_standings') as {
    rank: number | string
    outcome_totals: { wins: string; losses: string; ties: string }
    streak: { type: string; value: string | number }
  }

  return {
    teamKey,
    name,
    rank: Number(standings.rank),
    wins: Number(standings.outcome_totals.wins),
    losses: Number(standings.outcome_totals.losses),
    ties: Number(standings.outcome_totals.ties),
    streak: standings.streak,
  }
}

export function parseAllTeams(rawYahooJson: unknown): ParsedTeam[] {
  const teamsContainer = findByKey(rawYahooJson, 'teams') as Record<string, unknown>
  return numberedEntries(teamsContainer)
    .map(parseTeam)
    .sort((a, b) => a.rank - b.rank)
}

export function transformStandings(rawYahooJson: unknown, myTeamKey: string, asOf: string): StandingsPayload {
  const leagueName = findByKey(rawYahooJson, 'name') as string
  const teams = parseAllTeams(rawYahooJson)
  const myTeam = teams.find((t) => t.teamKey === myTeamKey)
  if (!myTeam) {
    throw new Error(`myTeamKey ${myTeamKey} not found in standings response`)
  }

  const topRanks = new Set([1, 2, 3])
  const windowStart = Math.max(1, myTeam.rank - 2)
  const windowEnd = Math.min(teams.length, myTeam.rank + 2)
  const windowRanks = new Set<number>()
  for (let r = windowStart; r <= windowEnd; r++) windowRanks.add(r)

  const includedRanks = [...new Set([...topRanks, ...windowRanks])]
    .filter((r) => r <= teams.length)
    .sort((a, b) => a - b)

  const rows: StandingsRow[] = []
  let previousRank: number | null = null
  for (const rank of includedRanks) {
    if (previousRank !== null && rank - previousRank > 1) {
      rows.push({ gap: true })
    }
    const team = teams.find((t) => t.rank === rank)!
    rows.push({
      rank: team.rank,
      name: team.name,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: formatWinPct(team.wins, team.losses, team.ties),
      streak: formatStreak(team.streak),
      ...(team.teamKey === myTeamKey ? { isMe: true as const } : {}),
    })
    previousRank = rank
  }

  return { asOf, myTeamKey, leagueName, rows }
}
