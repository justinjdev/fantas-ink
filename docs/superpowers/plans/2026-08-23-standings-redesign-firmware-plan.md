# Standings Redesign — Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the firmware's display rendering to a two-page layout (standings+matchup summary,
then a category breakdown), add a physical button to page between them, and parse the extended
`latest.json` contract the companion server plan produces — per
[2026-08-23-standings-display-redesign-design.md](../specs/2026-08-23-standings-display-redesign-design.md).

**Architecture:** New pure data/logic modules (`category_layout.h/.cpp`, extended
`display_layout.h/.cpp`) hold everything host-testable — struct shapes, row-height math, leader
comparisons. `network_api.cpp` extends its existing JSON parser for the new fields. `display_render.h/.cpp`
gets rewritten for two pages, using the vendored `FreeSans`/`FreeMono` fonts instead of the default
bitmap font. `firmware.ino` gains wake-cause branching (daily timer vs. button) and RTC-persisted page
state.

**Tech Stack:** Arduino/ESP32 (C++17), GxEPD2 + Adafruit_GFX, ArduinoJson. Host tests compile with
plain `clang++`, no Arduino dependency, for the pure modules only — this project has never had host
tests for Arduino-dependent code (`network_api.cpp`, `display_render.cpp`), and this plan doesn't
invent that infrastructure; those tasks are verified by `arduino-cli compile` plus the manual
on-device checklist instead, consistent with what's already there.

## Global Constraints

- Every text element must use plain ASCII (`0x20`–`0x7E`) — the vendored fonts don't cover anything
  else (confirmed from the font headers' `{Bitmap, Glyph, first, last, yAdvance}` struct during this
  session's design review). Server-side sanitization (companion server plan) handles free-text
  team/league names; firmware-authored strings (labels, separators, markers) must themselves be
  ASCII-only from the start.
- Font sizes are constrained to **9pt, 12pt, 18pt, 24pt only** — the only sizes vendored in
  `Adafruit_GFX_Library/Fonts/` for `FreeSans`/`FreeSansBold`/`FreeMono`/`FreeMonoBold`. The design
  mockup used a few sizes (11pt, 14pt, 22pt, 32pt) that don't exist as real font files — every task
  below uses the corrected, actually-available size, noted at the point it differs from the mockup.
- Column/row pixel positions come from the approved design spec and mockup; treat them as the
  structural decision, not pixel-exact truth — real glyph metrics will shift baselines slightly once
  compiled against the real fonts. This is expected, not a bug to chase before flashing.
- No new Arduino library dependencies — `FreeSans*`/`FreeMono*` fonts are already vendored inside the
  already-installed `Adafruit_GFX_Library`.
- Host tests compile with: `clang++ -std=c++17 firmware/test/<name>_test.cpp firmware/<name>.cpp -o /tmp/<name>_test && /tmp/<name>_test`
  — matches the exact pattern in `firmware/README.md`'s "Host tests" section. Every host-testable task
  in this plan must keep working with that exact command style; don't introduce a build system.
- Arduino-dependent tasks are verified with: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
  from the repo root.

---

### Task 1: Win% and streak on `StandingsRow`/`LayoutRow`

**Files:**
- Modify: `firmware/display_layout.h`, `firmware/display_layout.cpp`
- Test: `firmware/test/display_layout_test.cpp`

**Interfaces:**
- Produces: `StandingsRow` and `LayoutRow` both gain `std::string winPct` and `std::string streak`,
  appended after the existing `isMe` field (appending, not inserting, keeps every existing positional
  aggregate-initializer test call — e.g. `{false, 1, "Team A", 10, 2, 0, false}` — compiling unchanged,
  with the two new fields defaulting to empty strings for those cases).

- [ ] **Step 1: Write the failing test**

Add to `firmware/test/display_layout_test.cpp`, before `int main()`:

```cpp
void test_winPct_and_streak_pass_through_unchanged() {
  std::vector<StandingsRow> rows = { {false, 1, "Team A", 10, 2, 0, false, ".833", "W4"} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].winPct, std::string(".833"));
  CHECK_EQ(result[0].streak, std::string("W4"));
}
```

Add the new call to `main()`, alongside the existing `RUN(...)` calls:

```cpp
  RUN(test_winPct_and_streak_pass_through_unchanged);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test`
Expected: FAIL to compile — `StandingsRow` has no 8th/9th aggregate-init field yet (`winPct`/`streak`
don't exist).

- [ ] **Step 3: Write minimal implementation**

In `firmware/display_layout.h`, add the two fields to both structs:

```cpp
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
```

In `firmware/display_layout.cpp`, `buildLayout` needs to copy the two new fields through (they're
short, pre-formatted strings — no truncation, unlike `displayName`):

```cpp
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
```

(Only the two `out.winPct = ...` / `out.streak = ...` lines are new.)

- [ ] **Step 4: Run test to verify it passes**

Run: `clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test`
Expected: PASS, all 8 tests (7 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add firmware/display_layout.h firmware/display_layout.cpp firmware/test/display_layout_test.cpp
git commit -m "feat(firmware): pass win% and streak through the layout pipeline"
```

---

### Task 2: Pure category-table logic

**Files:**
- Create: `firmware/category_layout.h`, `firmware/category_layout.cpp`
- Test: `firmware/test/category_layout_test.cpp`

**Interfaces:**
- Produces: `CategoryStat` struct (`label`, `mine`, `theirs`, `higherWins`); `categoryLeaderIsMe`,
  `categoryLeaderIsThem` (both `const CategoryStat&` → `bool`); `categoryRowHeight(size_t categoryCount, float tableTop, float tableBottom) -> float`.

This is the pure logic behind the category breakdown page — deliberately split out from rendering
code so it's host-testable. `categoryRowHeight` specifically guards against the exact bug the design
mockup hit once: a hardcoded row height for a 13-category table overran the footer's rule and "Last
updated" text. The real category count depends on league settings and won't always be 13, so this
must stay a computed function, never a constant.

- [ ] **Step 1: Write the failing test**

Create `firmware/test/category_layout_test.cpp`:

```cpp
// firmware/test/category_layout_test.cpp
#include "../category_layout.h"
#include "test_utils.h"

void test_higher_wins_category_leader_is_whoever_has_the_bigger_number() {
  CategoryStat goals{"G", 14, 10, true};
  CHECK_EQ(categoryLeaderIsMe(goals), true);
  CHECK_EQ(categoryLeaderIsThem(goals), false);
}

void test_lower_wins_category_leader_is_whoever_has_the_smaller_number() {
  CategoryStat gaa{"GAA", 2.85, 2.60, false};
  CHECK_EQ(categoryLeaderIsMe(gaa), false);
  CHECK_EQ(categoryLeaderIsThem(gaa), true);
}

void test_tied_category_has_no_leader_on_either_side() {
  CategoryStat blocks{"BLK", 33, 33, true};
  CHECK_EQ(categoryLeaderIsMe(blocks), false);
  CHECK_EQ(categoryLeaderIsThem(blocks), false);
}

void test_row_height_evenly_divides_the_available_space() {
  float height = categoryRowHeight(13, 118.0f, 440.0f);
  CHECK_EQ(height > 24.7f && height < 24.8f, true);
}

void test_row_height_adapts_to_a_different_category_count_without_overrunning() {
  float heightFor13 = categoryRowHeight(13, 118.0f, 440.0f);
  float heightFor8 = categoryRowHeight(8, 118.0f, 440.0f);
  // Fewer categories must mean MORE room per row, not the same hardcoded value —
  // this is the exact property that broke once when the height was a constant.
  CHECK_EQ(heightFor8 > heightFor13, true);
  CHECK_EQ(118.0f + heightFor8 * 8 <= 440.0f, true);
  CHECK_EQ(118.0f + heightFor13 * 13 <= 440.0f, true);
}

void test_row_height_is_zero_for_zero_categories_not_a_divide_by_zero_crash() {
  CHECK_EQ(categoryRowHeight(0, 118.0f, 440.0f), 0.0f);
}

int main() {
  std::cout << "category_layout_test\n";
  RUN(test_higher_wins_category_leader_is_whoever_has_the_bigger_number);
  RUN(test_lower_wins_category_leader_is_whoever_has_the_smaller_number);
  RUN(test_tied_category_has_no_leader_on_either_side);
  RUN(test_row_height_evenly_divides_the_available_space);
  RUN(test_row_height_adapts_to_a_different_category_count_without_overrunning);
  RUN(test_row_height_is_zero_for_zero_categories_not_a_divide_by_zero_crash);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `clang++ -std=c++17 firmware/test/category_layout_test.cpp firmware/category_layout.cpp -o /tmp/category_layout_test && /tmp/category_layout_test`
Expected: FAIL — neither file exists yet.

- [ ] **Step 3: Write minimal implementation**

Create `firmware/category_layout.h`:

```cpp
#pragma once
#include <cstddef>
#include <string>

struct CategoryStat {
  std::string label;
  double mine = 0;
  double theirs = 0;
  bool higherWins = true;
};

bool categoryLeaderIsMe(const CategoryStat& stat);
bool categoryLeaderIsThem(const CategoryStat& stat);

// Row height for a `categoryCount`-row table evenly filling [tableTop, tableBottom].
// Must be computed, not a constant — see the file-level comment in
// category_layout.cpp for why this specific function exists.
float categoryRowHeight(size_t categoryCount, float tableTop, float tableBottom);
```

Create `firmware/category_layout.cpp`:

```cpp
// firmware/category_layout.cpp
//
// A hardcoded category-table row height once overran the page footer during
// design iteration, because the real category count (league-configured, not
// fixed) didn't match the constant the layout was tuned against. This file
// exists so that class of bug is a pure-function test, not a rendering bug
// only visible on real hardware.
#include "category_layout.h"

bool categoryLeaderIsMe(const CategoryStat& stat) {
  return stat.higherWins ? stat.mine > stat.theirs : stat.mine < stat.theirs;
}

bool categoryLeaderIsThem(const CategoryStat& stat) {
  return stat.higherWins ? stat.theirs > stat.mine : stat.theirs < stat.mine;
}

float categoryRowHeight(size_t categoryCount, float tableTop, float tableBottom) {
  if (categoryCount == 0) return 0.0f;
  return (tableBottom - tableTop) / static_cast<float>(categoryCount);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `clang++ -std=c++17 firmware/test/category_layout_test.cpp firmware/category_layout.cpp -o /tmp/category_layout_test && /tmp/category_layout_test`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add firmware/category_layout.h firmware/category_layout.cpp firmware/test/category_layout_test.cpp
git commit -m "feat(firmware): add pure category-table row-height and leader logic"
```

---

### Task 3: Matchup data structs

**Files:**
- Modify: `firmware/display_layout.h`
- Test: `firmware/test/display_layout_test.cpp`

**Interfaces:**
- Consumes: `CategoryStat` from `category_layout.h`.
- Produces: `MatchupSummary`, `CurrentMatchup`, `NextMatchup` structs, each with a `bool present = false`
  default — mirrors the server's independently-nullable `currentMatchup`/`lastMatchup`/`nextMatchup`
  fields (companion server plan, Task 11's `LatestStandingsPayload`).

- [ ] **Step 1: Write the failing test**

Add to `firmware/test/display_layout_test.cpp`:

```cpp
void test_matchup_structs_default_to_not_present() {
  MatchupSummary last;
  CurrentMatchup current;
  NextMatchup next;
  CHECK_EQ(last.present, false);
  CHECK_EQ(current.present, false);
  CHECK_EQ(next.present, false);
}

void test_current_matchup_carries_a_category_list() {
  CurrentMatchup current;
  current.present = true;
  current.opponent = "Ice Capades";
  current.status = "AHEAD";
  current.tally = "7-5-1";
  current.categories.push_back(CategoryStat{"G", 14, 10, true});
  CHECK_EQ(current.categories.size(), (size_t)1);
  CHECK_EQ(current.categories[0].label, std::string("G"));
}
```

Add both to `main()`:

```cpp
  RUN(test_matchup_structs_default_to_not_present);
  RUN(test_current_matchup_carries_a_category_list);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp firmware/category_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test`

(Note the extra `firmware/category_layout.cpp` on the compile line from here on — `display_layout.h`
now includes `category_layout.h`, so anything linking against it needs that object file too. Update
this compile command anywhere else it's documented, e.g. `firmware/README.md`'s Host tests section,
in Task 9.)

Expected: FAIL — `MatchupSummary`/`CurrentMatchup`/`NextMatchup` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `firmware/display_layout.h`, add the include and the three structs (place after the existing
`LayoutRow` struct, before `MAX_NAME_CHARS`):

```cpp
#include "category_layout.h"
```

```cpp
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp firmware/category_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add firmware/display_layout.h firmware/test/display_layout_test.cpp
git commit -m "feat(firmware): add matchup data structs with independent presence flags"
```

---

### Task 4: Parse the extended JSON contract

**Files:**
- Modify: `firmware/network_api.h`, `firmware/network_api.cpp`

**Interfaces:**
- Consumes: `MatchupSummary`, `CurrentMatchup`, `NextMatchup` from `display_layout.h` (already
  included via `network_api.h`).
- Produces: `FetchResult` gains `leagueName` (`String`), `hasPlayoffTeams` (`bool`), `playoffTeams`
  (`int`), `currentMatchup` (`CurrentMatchup`), `lastMatchup` (`MatchupSummary`), `nextMatchup`
  (`NextMatchup`).

Not host-testable — `network_api.cpp` depends on `ArduinoJson`/`WiFi.h`/`HTTPClient.h`, same as
today (no test file exists for it now either). Verified by `arduino-cli compile` plus the manual
checklist (Task 9).

- [ ] **Step 1: Extend `FetchResult`**

In `firmware/network_api.h`, update the struct:

```cpp
struct FetchResult {
  bool success = false;
  std::vector<StandingsRow> rows;
  String rawJson;
  String asOf;
  String leagueName;
  bool hasPlayoffTeams = false;
  int playoffTeams = 0;
  CurrentMatchup currentMatchup;
  MatchupSummary lastMatchup;
  NextMatchup nextMatchup;
};
```

- [ ] **Step 2: Extend `parseStandingsJson`**

In `firmware/network_api.cpp`, add three small parse helpers above `parseStandingsJson`:

```cpp
static CurrentMatchup parseCurrentMatchup(JsonVariant node) {
  CurrentMatchup m;
  if (node.isNull()) return m;
  m.present = true;
  m.opponent = node["opponent"].as<std::string>();
  m.status = node["status"].as<std::string>();
  m.tally = node["tally"].as<std::string>();
  for (JsonObject catObj : node["categories"].as<JsonArray>()) {
    CategoryStat stat;
    stat.label = catObj["label"].as<std::string>();
    stat.mine = catObj["mine"].as<double>();
    stat.theirs = catObj["theirs"].as<double>();
    stat.higherWins = catObj["higherWins"].as<bool>();
    m.categories.push_back(stat);
  }
  return m;
}

static MatchupSummary parseMatchupSummary(JsonVariant node) {
  MatchupSummary m;
  if (node.isNull()) return m;
  m.present = true;
  m.opponent = node["opponent"].as<std::string>();
  m.status = node["status"].as<std::string>();
  m.tally = node["tally"].as<std::string>();
  return m;
}

static NextMatchup parseNextMatchup(JsonVariant node) {
  NextMatchup m;
  if (node.isNull()) return m;
  m.present = true;
  m.opponent = node["opponent"].as<std::string>();
  m.opponentRecord = node["opponentRecord"].as<std::string>();
  return m;
}
```

Inside the existing row-parsing loop in `parseStandingsJson`, add the two new row fields right after
the existing `row.isMe = ...` line:

```cpp
      row.winPct = rowObj["winPct"].as<std::string>();
      row.streak = rowObj["streak"].as<std::string>();
```

After the existing `if (result.rows.empty()) return FetchResult{};` check and before
`result.rawJson = payload;`, add:

```cpp
  result.leagueName = doc["leagueName"].as<String>();
  result.hasPlayoffTeams = !doc["playoffTeams"].isNull();
  if (result.hasPlayoffTeams) result.playoffTeams = doc["playoffTeams"].as<int>();
  result.currentMatchup = parseCurrentMatchup(doc["currentMatchup"]);
  result.lastMatchup = parseMatchupSummary(doc["lastMatchup"]);
  result.nextMatchup = parseNextMatchup(doc["nextMatchup"]);
```

- [ ] **Step 3: Compile to verify**

Run: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
Expected: compiles clean. (This will only fully succeed once Task 5 also updates `display_render.cpp`
to match the new `FetchResult`/render function signatures — if it fails here with errors originating
in `display_render.cpp`, that's expected until that task lands; errors originating in
`network_api.cpp` itself are what this step is actually checking.)

- [ ] **Step 4: Commit**

```bash
git add firmware/network_api.h firmware/network_api.cpp
git commit -m "feat(firmware): parse league name, playoff line, and matchup fields from latest.json"
```

---

### Task 5: Render page 1 — standings table + matchup sidebar

**Files:**
- Modify: `firmware/display_render.h`, `firmware/display_render.cpp`

**Interfaces:**
- Consumes: `LayoutRow`, `CurrentMatchup`, `MatchupSummary`, `NextMatchup` from `display_layout.h`.
- Produces: `renderStandingsPage(Display& display, const std::string& leagueName, const std::vector<LayoutRow>& rows, bool hasPlayoffTeams, int playoffTeams, const CurrentMatchup& current, const MatchupSummary& last, const NextMatchup& next, const std::string& footer)`,
  replacing the old `renderLayout`. `renderMessage`/`hibernateDisplay`/`initDisplay` are unchanged.

Not host-testable (GxEPD2/Adafruit_GFX dependency) — verified by `arduino-cli compile` and the manual
checklist (Task 9).

**Font size correction from the mockup:** the approved mockup used a few canvas-only point sizes that
don't correspond to real vendored fonts (only 9/12/18/24pt exist — see Global Constraints). Every size
below is already corrected; none of this task uses an unavailable size.

- [ ] **Step 1: Add font includes and an alignment helper**

Adafruit_GFX has no built-in text alignment — `setCursor`/`print` is always left-from-cursor. The
mockup relies on right- and center-aligned text in several places (footer page indicator, page 2's
column headers and category values), so this needs a small helper that measures text width first via
`getTextBounds` and adjusts the cursor. Also note: with a custom `GFXfont` set via `setFont()` (as
opposed to the default built-in font this codebase used until now), `setCursor(x, y)` positions the
text **baseline**, not the top-left corner — the old code's `y + 16` offset trick doesn't apply here
and must not be carried over.

At the top of `firmware/display_render.cpp`, add the font includes alongside the existing ones:

```cpp
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Fonts/FreeMono9pt7b.h>
#include <Fonts/FreeMono12pt7b.h>
#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>
```

Add the alignment helper near the top of the file, after the pin constants:

```cpp
enum class Align { Left, Center, Right };

static void printAligned(Display& display, const std::string& text, int x, int y, Align align = Align::Left) {
  int16_t tbx, tby;
  uint16_t tbw, tbh;
  display.getTextBounds(text.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
  int drawX = x;
  if (align == Align::Right) drawX = x - static_cast<int>(tbw);
  else if (align == Align::Center) drawX = x - static_cast<int>(tbw) / 2;
  display.setCursor(drawX, y);
  display.print(text.c_str());
}

static void hrule(Display& display, int x1, int y, int x2) {
  display.fillRect(x1, y, x2 - x1, 1, GxEPD_BLACK);
}

static void vrule(Display& display, int x, int y1, int y2) {
  display.fillRect(x, y1, 1, y2 - y1, GxEPD_BLACK);
}
```

- [ ] **Step 2: Write `renderStandingsPage`**

In `firmware/display_render.h`, replace the `renderLayout` declaration:

```cpp
void renderStandingsPage(Display& display, const std::string& leagueName, const std::vector<LayoutRow>& rows,
                          bool hasPlayoffTeams, int playoffTeams, const CurrentMatchup& current,
                          const MatchupSummary& last, const NextMatchup& next, const std::string& footer);
```

In `firmware/display_render.cpp`, replace `renderLayout`, `drawRow`, `drawGap`, `ROW_HEIGHT`,
`TOP_MARGIN`, `COL_RANK_X`, `COL_NAME_X`, `COL_RECORD_X` entirely with:

```cpp
constexpr size_t MAX_LEAGUE_NAME_CHARS = 24;

static std::string truncateToFit(const std::string& text, size_t maxChars) {
  return text.size() > maxChars ? text.substr(0, maxChars) : text;
}

static void drawStandingsTable(Display& display, const std::vector<LayoutRow>& rows,
                                bool hasPlayoffTeams, int playoffTeams) {
  const int top = 74, rowH = 40;
  const int rankX = 20, teamX = 56, wltX = 235, pctX = 315, strkX = 385;

  int y = top;
  bool prevWasGap = false;
  for (const auto& row : rows) {
    if (row.isGap) {
      hrule(display, teamX, y + rowH / 2, 440);
      y += rowH;
      prevWasGap = true;
      continue;
    }
    if (hasPlayoffTeams && row.rank == playoffTeams + 1 && !prevWasGap) {
      for (int x = 56; x < 440; x += 10) display.fillRect(x, y, 6, 2, GxEPD_BLACK);
    }
    prevWasGap = false;

    const int baseline = y + rowH / 2 + 7;
    if (row.isMe) {
      display.fillRect(16, y + 2, 432, rowH - 6, GxEPD_BLACK);
      display.setTextColor(GxEPD_WHITE);
    } else {
      display.setTextColor(GxEPD_BLACK);
    }

    display.setFont(&FreeMonoBold12pt7b);
    printAligned(display, std::to_string(row.rank), rankX, baseline);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, row.displayName, teamX, baseline);
    display.setFont(row.isMe ? &FreeMonoBold12pt7b : &FreeMono12pt7b);
    printAligned(display, std::to_string(row.wins) + "-" + std::to_string(row.losses) + "-" + std::to_string(row.ties), wltX, baseline);
    printAligned(display, row.winPct, pctX, baseline);
    printAligned(display, row.streak, strkX, baseline);

    y += rowH;
  }
  display.setTextColor(GxEPD_BLACK);
}

static void drawMatchupBlock(Display& display, int topY, int bottomY, const char* eyebrow,
                              const std::string& statusWord, const std::string& oppName,
                              const std::string& tally, const std::string& caption, bool big) {
  const int sx = 484;
  const int midY = (topY + bottomY) / 2;
  const int eyebrowOffset = 20;

  display.setFont(&FreeSansBold9pt7b);
  printAligned(display, eyebrow, sx, topY + eyebrowOffset);

  if (big) {
    display.setFont(&FreeSansBold18pt7b);
    printAligned(display, statusWord, sx, midY - 4);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "vs " + oppName, sx, midY + 19);
    display.setFont(&FreeMonoBold18pt7b);
    printAligned(display, tally, sx, midY + 46);
    display.setFont(&FreeSans9pt7b);
    printAligned(display, caption, sx, midY + 63);
  } else {
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, statusWord + " vs " + oppName, sx, midY + 8);
    display.setFont(&FreeMonoBold12pt7b);
    printAligned(display, tally, sx, midY + 30);
  }
}

static void drawMatchupSidebar(Display& display, const CurrentMatchup& current, const MatchupSummary& last,
                                const NextMatchup& next) {
  const int sbTop = 64, sbBottom = 452;
  const int thisWeekEnd = sbTop + static_cast<int>((sbBottom - sbTop) * 0.4f);
  const int lastWeekEnd = thisWeekEnd + static_cast<int>((sbBottom - sbTop) * 0.3f);
  hrule(display, 460, thisWeekEnd, 780);
  hrule(display, 460, lastWeekEnd, 780);

  if (current.present) {
    drawMatchupBlock(display, sbTop, thisWeekEnd, "THIS WEEK", current.status, current.opponent,
                      current.tally, "categories ahead-behind-tied", true);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "THIS WEEK", 484, sbTop + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No matchup this week", 484, (sbTop + thisWeekEnd) / 2);
  }

  if (last.present) {
    drawMatchupBlock(display, thisWeekEnd, lastWeekEnd, "LAST WEEK", last.status, last.opponent,
                      last.tally, "", false);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "LAST WEEK", 484, thisWeekEnd + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No result last week", 484, (thisWeekEnd + lastWeekEnd) / 2 + 8);
  }

  if (next.present) {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "NEXT WEEK", 484, lastWeekEnd + 20);
    const int midY = (lastWeekEnd + 452) / 2;
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "vs " + next.opponent, 484, midY + 8);
    display.setFont(&FreeMono9pt7b);
    printAligned(display, "Their record: " + next.opponentRecord, 484, midY + 30);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "NEXT WEEK", 484, lastWeekEnd + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No matchup scheduled", 484, (lastWeekEnd + 452) / 2 + 8);
  }
}

void renderStandingsPage(Display& display, const std::string& leagueName, const std::vector<LayoutRow>& rows,
                          bool hasPlayoffTeams, int playoffTeams, const CurrentMatchup& current,
                          const MatchupSummary& last, const NextMatchup& next, const std::string& footer) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    display.setFont(&FreeSansBold24pt7b);
    printAligned(display, truncateToFit(leagueName, MAX_LEAGUE_NAME_CHARS), 20, 40);
    hrule(display, 20, 54, 780);
    vrule(display, 460, 64, 452);

    drawStandingsTable(display, rows, hasPlayoffTeams, playoffTeams);
    drawMatchupSidebar(display, current, last, next);

    hrule(display, 20, 452, 780);
    display.setFont(&FreeSans9pt7b);
    if (!footer.empty()) printAligned(display, footer, 20, 468);
    printAligned(display, "PAGE 1/2 - button > categories", 780, 468, Align::Right);
  } while (display.nextPage());
}
```

- [ ] **Step 3: Compile to verify**

Run: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
Expected: still fails at this point — `firmware.ino` still calls the now-deleted `renderLayout` and
page 2 doesn't exist yet. Confirm the *only* remaining errors are about the missing `renderLayout`
symbol and `renderCategoryPage` (added in Task 6) — nothing originating inside
`display_render.cpp`/`display_render.h` themselves. `firmware.ino` gets fixed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add firmware/display_render.h firmware/display_render.cpp
git commit -m "feat(firmware): render page 1 - standings table, playoff line, matchup sidebar"
```

---

### Task 6: Render page 2 — category breakdown

**Files:**
- Modify: `firmware/display_render.h`, `firmware/display_render.cpp`

**Interfaces:**
- Consumes: `CurrentMatchup`, `categoryLeaderIsMe`, `categoryLeaderIsThem`, `categoryRowHeight` from
  `category_layout.h` (via `display_layout.h`).
- Produces: `renderCategoryPage(Display& display, const std::string& myTeamName, const CurrentMatchup& current, const std::string& footer)`.

Not host-testable, same as Task 5 — verified by `arduino-cli compile` and the manual checklist.

- [ ] **Step 1: Write `renderCategoryPage`**

In `firmware/display_render.h`, add:

```cpp
void renderCategoryPage(Display& display, const std::string& myTeamName, const CurrentMatchup& current,
                         const std::string& footer);
```

In `firmware/display_render.cpp`, add a small number formatter (mirrors the mockup's `fmt()` — integers
print without a decimal, everything else to 3 places) and the render function:

```cpp
static std::string formatStatValue(double value) {
  if (value == static_cast<long long>(value)) {
    return std::to_string(static_cast<long long>(value));
  }
  char buf[16];
  snprintf(buf, sizeof(buf), "%.3f", value);
  return std::string(buf);
}

void renderCategoryPage(Display& display, const std::string& myTeamName, const CurrentMatchup& current,
                         const std::string& footer) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    if (!current.present) {
      display.setFont(&FreeSansBold18pt7b);
      printAligned(display, "No matchup this week", 20, 200);
    } else if (current.categories.empty()) {
      // Matchup exists (status/tally are valid) but the category settings
      // fetch failed server-side - a different failure than no matchup at
      // all, so it gets its own message rather than reusing the one above.
      display.setFont(&FreeSansBold18pt7b);
      printAligned(display, "vs " + current.opponent, 20, 38);
      display.setFont(&FreeSansBold24pt7b);
      printAligned(display, current.status + "  " + current.tally, 20, 70);
      hrule(display, 20, 88, 780);
      display.setFont(&FreeSansBold12pt7b);
      printAligned(display, "Category breakdown unavailable", 20, 200);
    } else {
      display.setFont(&FreeSansBold18pt7b);
      printAligned(display, "vs " + current.opponent, 20, 38);
      display.setFont(&FreeSansBold24pt7b);
      printAligned(display, current.status + "  " + current.tally, 20, 70);
      hrule(display, 20, 88, 780);

      const int meColX = 300, oppColX = 500, labelColX = 400;
      display.setFont(&FreeSansBold9pt7b);
      std::string myUpper = myTeamName;
      for (auto& c : myUpper) c = toupper(c);
      std::string oppUpper = current.opponent;
      for (auto& c : oppUpper) c = toupper(c);
      printAligned(display, myUpper, meColX, 108, Align::Right);
      printAligned(display, oppUpper, oppColX, 108, Align::Left);
      hrule(display, 20, 118, 780);

      const float tableTop = 118.0f, tableBottom = 440.0f;
      float rowH = categoryRowHeight(current.categories.size(), tableTop, tableBottom);
      float y = tableTop;
      for (const auto& cat : current.categories) {
        int baseline = static_cast<int>(y + rowH / 2.0f) + 7;
        bool meLeads = categoryLeaderIsMe(cat);
        bool oppLeads = categoryLeaderIsThem(cat);

        display.setFont(meLeads ? &FreeMonoBold12pt7b : &FreeMono12pt7b);
        printAligned(display, formatStatValue(cat.mine), meColX, baseline, Align::Right);
        if (meLeads) {
          display.setFont(&FreeSansBold9pt7b);
          printAligned(display, ">", meColX + 10, baseline);
        }

        display.setFont(&FreeSansBold9pt7b);
        printAligned(display, cat.label, labelColX, baseline, Align::Center);

        display.setFont(oppLeads ? &FreeMonoBold12pt7b : &FreeMono12pt7b);
        printAligned(display, formatStatValue(cat.theirs), oppColX, baseline, Align::Left);
        if (oppLeads) {
          display.setFont(&FreeSansBold9pt7b);
          printAligned(display, "<", oppColX - 10, baseline, Align::Right);
        }

        y += rowH;
      }
    }

    hrule(display, 20, 452, 780);
    display.setFont(&FreeSans9pt7b);
    if (!footer.empty()) printAligned(display, footer, 20, 468);
    printAligned(display, "PAGE 2/2 - button > standings", 780, 468, Align::Right);
  } while (display.nextPage());
}
```

- [ ] **Step 2: Compile to verify**

Run: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
Expected: still fails — `firmware.ino` doesn't call either new render function yet (Task 7). Confirm
the remaining errors are all in `firmware.ino`, not in `display_render.cpp`/`.h`.

- [ ] **Step 3: Commit**

```bash
git add firmware/display_render.h firmware/display_render.cpp
git commit -m "feat(firmware): render page 2 - head-to-head category breakdown"
```

---

### Task 7: Wire the new render functions into the wake cycle (page 1 only, no button yet)

**Files:**
- Modify: `firmware/firmware.ino`

**Interfaces:**
- Consumes: `renderStandingsPage` (Task 5), `FetchResult`'s new fields (Task 4).

This task gets page 1 fully working end to end with real fetched/cached data before Task 8 adds the
button — smaller, independently verifiable step, rather than changing the render call sites and
adding wake-source branching in the same task.

- [ ] **Step 1: Update both `renderLayout` call sites**

In `firmware/firmware.ino`, the fresh-fetch branch currently reads:

```cpp
  if (haveFreshData) {
    Serial.printf("Data source: fresh fetch (%u rows)\n", (unsigned)data.rows.size());
    auto layout = buildLayout(data.rows);
    renderLayout(display, layout, "");
  } else {
```

Replace the `renderLayout` call:

```cpp
  if (haveFreshData) {
    Serial.printf("Data source: fresh fetch (%u rows)\n", (unsigned)data.rows.size());
    auto layout = buildLayout(data.rows);
    renderStandingsPage(display, data.leagueName.c_str(), layout, data.hasPlayoffTeams, data.playoffTeams,
                        data.currentMatchup, data.lastMatchup, data.nextMatchup, "");
  } else {
```

The cached-fallback branch currently reads:

```cpp
    if (cached.success && !cached.rows.empty()) {
      Serial.printf("Data source: NVS cache (%u rows)\n", (unsigned)cached.rows.size());
      auto layout = buildLayout(cached.rows);
      std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
      renderLayout(display, layout, footer);
    } else {
```

Replace the `renderLayout` call the same way:

```cpp
    if (cached.success && !cached.rows.empty()) {
      Serial.printf("Data source: NVS cache (%u rows)\n", (unsigned)cached.rows.size());
      auto layout = buildLayout(cached.rows);
      std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
      renderStandingsPage(display, cached.leagueName.c_str(), layout, cached.hasPlayoffTeams, cached.playoffTeams,
                          cached.currentMatchup, cached.lastMatchup, cached.nextMatchup, footer);
    } else {
```

(`std::string(String)` conversion: `data.leagueName`/`cached.leagueName` are Arduino `String`, and
`renderStandingsPage` takes `const std::string&` — `.c_str()` bridges this the same way the existing
`std::string(cached.asOf.c_str())` line already does two lines below it.)

- [ ] **Step 2: Compile to verify**

Run: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
Expected: compiles clean. This is the first point in the plan where the full firmware builds again —
confirm no errors anywhere, not just in `firmware.ino`.

- [ ] **Step 3: Commit**

```bash
git add firmware/firmware.ino
git commit -m "feat(firmware): wire the new two-page render function into both render paths"
```

---

### Task 8: Button-driven page toggle

**Files:**
- Modify: `firmware/firmware.ino`

**Interfaces:**
- Consumes: `renderCategoryPage` (Task 6), `parseStandingsJson`/`loadCachedStandings`/
  `hasCachedStandings` (already used elsewhere in `firmware.ino`).
- Produces: an `RTC_DATA_ATTR int currentPage` global; wake-cause branching in `setup()`.

**GPIO pin is provisional — needs the physical board in hand to confirm**, per the design spec's Open
Items. `GPIO4` is used below because it's RTC-capable (required for `EXT0` wake), supports internal
pull resistors (unlike input-only pins 34–39, which would need an external resistor for a simple
button), isn't one of the ESP32's boot-strapping pins (0, 2, 5, 12, 15), and isn't already used by the
display (25, 26, 27, 15, 13, 14, 12) — reasoned from ESP32 pinout documentation, not yet confirmed
against this specific board's free headers. If the real board's layout rules it out, only the
`BUTTON_PIN` constant below needs to change, nothing else in this task.

- [ ] **Step 1: Add the RTC-persisted page state and pin constant**

Near the top of `firmware/firmware.ino`, alongside the existing `static const` wake-cycle constants,
add:

```cpp
static const gpio_num_t BUTTON_PIN = GPIO_NUM_4; // provisional - confirm against real hardware
RTC_DATA_ATTR int currentPage = 0; // 0 = standings/matchup, 1 = category breakdown
```

- [ ] **Step 2: Branch on wake cause at the top of `setup()`**

Immediately after `Serial.begin(115200);` in `setup()`, before `uint32_t cycleStart = millis();`, add:

```cpp
  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  if (wakeCause == ESP_SLEEP_WAKEUP_EXT0) {
    handleButtonWake();
    return;
  }
  currentPage = 0; // any non-button wake (daily timer, or first boot) resets to page 1
```

- [ ] **Step 3: Write `armWakeSources` and `handleButtonWake`**

`armWakeSources` must be defined **above** `goToSleep()` in the file — Step 4 below modifies
`goToSleep()` to call it, and `goToSleep()` is defined near the top of `firmware.ino`, before
`setup()`. Defining `armWakeSources` after `goToSleep()` (e.g. textually next to `handleButtonWake`,
which is otherwise the more natural spot) would be a forward reference C++ won't compile without a
separate declaration — simplest is to just place `armWakeSources` immediately above `goToSleep()`.
`handleButtonWake` has no such constraint (nothing above it calls it) — add it anywhere above
`setup()`, e.g. directly after `goToSleep()`, where it reads naturally next to the other wake-cycle
logic.

Add immediately above `goToSleep()`:

```cpp
static void armWakeSources(uint64_t sleepMicros) {
  esp_sleep_enable_timer_wakeup(sleepMicros);
  esp_sleep_enable_ext0_wakeup(BUTTON_PIN, 1); // wake on HIGH (button pulls the pin high when pressed)
}
```

Add directly after `goToSleep()` (still above `setup()`):

```cpp
static void handleButtonWake() {
  currentPage = currentPage == 0 ? 1 : 0;
  Serial.printf("Button wake: switching to page %d\n", currentPage);

  Display& display = initDisplay();

  FetchResult cached;
  if (hasCachedStandings()) {
    cached = parseStandingsJson(loadCachedStandings());
  }
  if (cached.success && !cached.rows.empty()) {
    auto layout = buildLayout(cached.rows);
    std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
    if (currentPage == 0) {
      renderStandingsPage(display, cached.leagueName.c_str(), layout, cached.hasPlayoffTeams,
                          cached.playoffTeams, cached.currentMatchup, cached.lastMatchup,
                          cached.nextMatchup, footer);
    } else {
      std::string myTeamName;
      for (const auto& row : cached.rows) {
        if (!row.isGap && row.isMe) { myTeamName = row.name; break; }
      }
      renderCategoryPage(display, myTeamName, cached.currentMatchup, footer);
    }
  } else {
    renderMessage(display, "No data yet");
  }
  hibernateDisplay(display);

  // EXT0 wake is level-triggered, not edge-triggered - a held or bouncing
  // button would otherwise re-trigger the moment we go back to sleep. Wait
  // for the pin to return to idle (LOW) before re-arming, capped so a
  // stuck/held button can't hang the device awake indefinitely.
  uint32_t debounceStart = millis();
  while (digitalRead(BUTTON_PIN) == HIGH && millis() - debounceStart < 2000) {
    delay(20);
  }

  time_t now;
  time(&now);
  uint64_t sleepMicros = now < PLAUSIBLE_TIME_THRESHOLD
    ? FALLBACK_RETRY_SLEEP_MICROS
    : computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
  armWakeSources(sleepMicros);
  esp_deep_sleep_start();
}
```

- [ ] **Step 4: Arm the button wake source on every sleep, not just button wakes**

The button must stay live across a normal daily-timer sleep too, not just after a button press —
otherwise it would only work once. In `firmware.ino`'s existing `goToSleep()`, `pinMode` the button
pin once (it only needs configuring on the timer-wake path, since `handleButtonWake` already returns
via its own `esp_deep_sleep_start()` and never calls `goToSleep()`), and replace the existing
`esp_sleep_enable_timer_wakeup(sleepMicros);` line with a call to the new shared helper:

```cpp
static void goToSleep() {
  time_t now;
  time(&now);
  uint64_t sleepMicros;
  if (now < PLAUSIBLE_TIME_THRESHOLD) {
    sleepMicros = FALLBACK_RETRY_SLEEP_MICROS;
    Serial.println("Sleep: clock never synced, using 1h retry fallback");
  } else {
    sleepMicros = computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
    Serial.println("Sleep: clock synced, scheduling next 8am wake");
  }
  Serial.printf("Sleep: sleepMicros=%llu (%.2f hours)\n", sleepMicros, sleepMicros / 3600000000.0);
  Serial.flush();
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);
  armWakeSources(sleepMicros);
  esp_deep_sleep_start();
}
```

(Only the `pinMode(...)` line and swapping the direct `esp_sleep_enable_timer_wakeup(sleepMicros);`
call for `armWakeSources(sleepMicros);` are new — the rest of the function is unchanged. `armWakeSources`
must be declared/defined above `goToSleep()` for this to compile, matching where Step 3 placed it.)

`handleButtonWake` also needs `pinMode(BUTTON_PIN, INPUT_PULLDOWN);` before its debounce-wait loop
reads the pin — add it right after `esp_sleep_wakeup_cause_t wakeCause = ...` reads as `ESP_SLEEP_WAKEUP_EXT0`
in `setup()`, before calling `handleButtonWake()`, since the pin mode itself doesn't survive deep sleep
and must be re-established every wake before it's read or armed:

```cpp
  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  if (wakeCause == ESP_SLEEP_WAKEUP_EXT0) {
    pinMode(BUTTON_PIN, INPUT_PULLDOWN);
    handleButtonWake();
    return;
  }
```

- [ ] **Step 5: Compile to verify**

Run: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware`
Expected: compiles clean.

- [ ] **Step 6: Commit**

```bash
git add firmware/firmware.ino
git commit -m "feat(firmware): add button-driven page toggle via EXT0 deep-sleep wake"
```

---

### Task 9: Update the manual verification checklist

**Files:**
- Modify: `firmware/README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Fix the Host tests section for the new compile dependency**

`firmware/README.md`'s "Host tests" section currently shows:

```bash
clang++ -std=c++17 firmware/test/sleep_util_test.cpp firmware/sleep_util.cpp -o /tmp/sleep_util_test && /tmp/sleep_util_test
clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test
```

Update the second line for the new `category_layout.cpp` dependency introduced in Task 3, and add a
third line for the new `category_layout_test.cpp` from Task 2:

```bash
clang++ -std=c++17 firmware/test/sleep_util_test.cpp firmware/sleep_util.cpp -o /tmp/sleep_util_test && /tmp/sleep_util_test
clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp firmware/category_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test
clang++ -std=c++17 firmware/test/category_layout_test.cpp firmware/category_layout.cpp -o /tmp/category_layout_test && /tmp/category_layout_test
```

- [ ] **Step 2: Add new manual verification cases**

Add these as new numbered items at the end of the "Manual on-device verification" section (after the
existing item 7, "Sleep duration sanity"):

```markdown
8. **`currentMatchup`/`lastMatchup` both null:** point `STANDINGS_URL` at a payload with both fields
   `null` (a bye week, or the matchup fetch failing server-side). Confirm the sidebar shows "No
   matchup this week" and "No result last week" instead of blank space, and the rest of page 1 (table,
   header, footer) renders normally.
9. **`nextMatchup` null:** same idea for the "NEXT WEEK" block — confirm "No matchup scheduled"
   renders instead of blank space.
10. **`categories` omitted with `currentMatchup` present:** a payload where `currentMatchup` has
    `status`/`tally` but an empty `categories` array (settings fetch failed server-side, matchup fetch
    succeeded). Confirm page 1's sidebar still shows the current matchup normally, and page 2 (via
    button press) shows "Category breakdown unavailable" instead of an empty or garbled table.
11. **`playoffTeams` absent:** a payload with `playoffTeams: null`. Confirm the standings table
    renders with no playoff-line divider at all — not a guessed position, not a blank gap.
12. **Physical button — page toggle:** press the button once. Confirm the display redraws
    near-instantly (no WiFi reconnect, no `Fetching standings...` message) showing the category
    breakdown page, and the serial log shows `Button wake: switching to page 1`, not a fresh fetch
    cycle. Press again — confirm it toggles back to page 1.
13. **Physical button — debounce:** hold the button down continuously for several seconds instead of a
    quick press. Confirm the device doesn't rapidly cycle pages or repeatedly wake — it should toggle
    once, then wait for release (up to the 2-second debounce cap) before going back to sleep.
14. **Physical button — daily reset:** after toggling to page 2 via the button, wait for (or force) a
    normal daily timer wake. Confirm it comes back up on page 1, not wherever the button last left it.
```

- [ ] **Step 3: Commit**

```bash
git add firmware/README.md
git commit -m "docs(firmware): add manual verification cases for the two-page redesign"
```

---

## Post-Implementation Notes

- This plan doesn't touch `nvs_cache.h/.cpp` at all — it already caches the full raw JSON string
  verbatim and re-parses it through `parseStandingsJson` on every cached-fallback path (including the
  new button-wake path added in Task 8), so the new fields ride along automatically once Task 4 lands.
  No NVS schema change needed.
- Every pixel position in Tasks 5–6 is the structural decision from the approved mockup; exact
  baselines will shift slightly once real font metrics are in play. Don't treat a slightly-off vertical
  alignment on first flash as a bug to silently patch — compare against the approved mockup images in
  `firmware/docs/images/` and adjust the specific constant that's off, the same way the mockup itself
  was iterated on with the user's screenshots during design.
- The button's GPIO pin (Task 8) is the one piece of this plan that cannot be fully verified until the
  physical board is in hand — everything else compiles and (for the pure-logic tasks) is unit-tested
  without hardware.
