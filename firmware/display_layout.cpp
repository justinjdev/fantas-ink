#include "display_layout.h"

std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows, size_t maxNameChars) {
  std::vector<LayoutRow> result;
  result.reserve(rows.size());
  for (const auto& row : rows) {
    LayoutRow out;
    out.isGap = row.isGap;
    if (row.isGap) {
      result.push_back(out);
      continue;
    }
    out.rank = row.rank;
    out.wins = row.wins;
    out.losses = row.losses;
    out.ties = row.ties;
    out.isMe = row.isMe;
    out.winPct = row.winPct;
    out.streak = row.streak;
    out.displayName = row.name.size() > maxNameChars
      ? row.name.substr(0, maxNameChars)
      : row.name;
    result.push_back(out);
  }
  return result;
}
