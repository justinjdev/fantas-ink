#include "display_layout.h"

std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows) {
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
    out.displayName = row.name;
    result.push_back(out);
  }
  return result;
}

float standingsRowHeight(size_t rowCount, float tableTop, float tableBottom) {
  if (rowCount == 0) return 0.0f;
  return (tableBottom - tableTop) / static_cast<float>(rowCount);
}
