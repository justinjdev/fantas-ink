import { findByKey } from './yahooJson.js'
import { sanitizeAscii } from './asciiSanitize.js'

export interface CategoryDef {
  statId: string
  label: string
  higherWins: boolean
}

export interface LeagueSettings {
  categories: CategoryDef[]
  playoffTeams: number | null
}

// Yahoo's documented sort_order values are '1' (higher stat wins, e.g. goals)
// and '0' (lower stat wins, e.g. goals-against average). This field shape is
// an unverified guess pending real Yahoo API access, so an unrecognized value
// (missing field, renamed field, etc.) is logged rather than silently
// defaulting to a possibly-wrong direction.
function parseHigherWins(sortOrder: unknown): boolean {
  const raw = String(sortOrder)
  if (raw === '1') return true
  if (raw === '0') return false
  console.warn(`league settings: unrecognized stat sort_order ${JSON.stringify(raw)}, defaulting to higherWins=true`)
  return true
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
      label: sanitizeAscii(String(stat.display_name ?? '')),
      higherWins: parseHigherWins(stat.sort_order),
    }
  })

  return { categories, playoffTeams }
}
