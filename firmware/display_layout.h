#pragma once
#include <string>
#include <vector>
#include <cstddef>

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

constexpr size_t MAX_NAME_CHARS = 12;

// Pure transform: truncates names to fit the display column width and
// passes gap/isMe markers through unchanged. Does not re-derive
// windowing/dedup/gap logic — that's already done server-side.
std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows, size_t maxNameChars = MAX_NAME_CHARS);
