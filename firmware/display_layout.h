#pragma once
#include <string>
#include <vector>
#include <cstddef>
#include "category_layout.h"

// Mirrors one entry of the server's `rows[]` (see design spec's Data
// Contract) — already windowed/deduped/gap-marked server-side.
struct StandingsRow {
  bool isGap = false;
  int rank = 0;
  std::string name;
  int wins = 0;
  int losses = 0;
  int ties = 0;
  bool isMe = false;
  std::string winPct;
  std::string streak;
};

struct LayoutRow {
  bool isGap = false;
  int rank = 0;
  std::string displayName;
  int wins = 0;
  int losses = 0;
  int ties = 0;
  bool isMe = false;
  std::string winPct;
  std::string streak;
};

struct MatchupSummary {
  bool present = false;
  std::string opponent;
  std::string status; // "WON" | "LOST" | "TIED"
  std::string tally;
};

struct CurrentMatchup {
  bool present = false;
  std::string opponent;
  std::string status; // "AHEAD" | "BEHIND" | "TIED"
  std::string tally;
  std::vector<CategoryStat> categories;
};

struct NextMatchup {
  bool present = false;
  std::string opponent;
  std::string opponentRecord;
};

// Pure transform: names pass through unmodified and gap/isMe markers pass
// through unchanged. Fitting a name to its column is a render-time concern —
// it depends on font metrics this module has no access to. Does not re-derive
// windowing/dedup/gap logic — that's already done server-side.
std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows);
