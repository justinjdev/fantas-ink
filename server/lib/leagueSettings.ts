import { findByKey } from './yahooJson.js'

export interface CategoryDef {
  statId: string
  label: string
  higherWins: boolean
}

export interface LeagueSettings {
  categories: CategoryDef[]
  playoffTeams: number | null
}

export function parseLeagueSettings(rawYahooJson: unknown): LeagueSettings {
  const settingsNode = findByKey(rawYahooJson, 'settings')

  const numPlayoffTeamsRaw = findByKey(settingsNode, 'num_playoff_teams')
  const playoffTeams = numPlayoffTeamsRaw != null ? Number(numPlayoffTeamsRaw) : null

  const statCategories = findByKey(settingsNode, 'stat_categories') as { stats?: unknown } | undefined
  const statEntries = Array.isArray(statCategories?.stats) ? (statCategories!.stats as unknown[]) : []

  const categories: CategoryDef[] = statEntries.map((entry) => {
    const stat = (entry as { stat: Record<string, unknown> }).stat
    return {
      statId: String(stat.stat_id),
      label: String(stat.display_name),
      higherWins: String(stat.sort_order) !== '0',
    }
  })

  return { categories, playoffTeams }
}
