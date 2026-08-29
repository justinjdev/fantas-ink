// firmware/preview/preview_main.cpp
//
// Renders the real display_render.h templates against fake data into BMP
// files, for a desktop preview without hardware. See README's "Host preview"
// section for the build command. Output defaults to /tmp; pass a directory
// as argv[1] to change it.
#include <string>
#include <vector>
#include "host_display_stub.h"
#include "../display_layout.h"
#include "../display_render.h"

namespace {

// Mirrors the server's actual windowing (see design spec: top 3 + 5 rows
// around the user's team, 9 rows total incl. the gap divider) for a 16-team
// league where the user sits mid-pack at rank 10 — NOT the full 16 teams,
// since the device never receives more than this 9-row window.
std::vector<StandingsRow> sampleStandings() {
  return {
      {false, 1, "Ovi's Snipers", 14, 3, 1, false, ".806", "W4"},
      {false, 2, "Bread Man", 12, 5, 1, false, ".694", "W1"},
      {false, 3, "Crosby's Crease", 11, 6, 1, false, ".639", "L2"},
      {true, 0, "", 0, 0, 0, false, "", ""}, // windowed gap (ranks 4-7 omitted)
      {false, 8, "Slap Happy", 9, 8, 1, false, ".528", "W2"},
      {false, 9, "Zamboni Drivers", 9, 8, 1, false, ".528", "L1"},
      {false, 10, "My Team", 8, 9, 1, true, ".472", "L1"},
      {false, 11, "Fourth Line Energy", 7, 10, 1, false, ".417", "L3"},
      {false, 12, "Empty Netters", 7, 10, 1, false, ".417", "W1"},
  };
}

CurrentMatchup sampleCurrentMatchup() {
  CurrentMatchup m;
  m.present = true;
  m.opponent = "Bread Man";
  m.status = "AHEAD";
  m.tally = "5-2-1";
  m.categories = {
      {"Goals", 12, 8, true},
      {"Assists", 18, 20, true},
      {"+/-", 6, 4, true},
      {"PIM", 22, 30, false},
      {"Shots", 88, 91, true},
      {"Hits", 40, 35, true},
      {"Saves", 112, 98, true},
      {"GAA", 2.410, 2.870, false},
  };
  return m;
}

MatchupSummary sampleLastMatchup() {
  MatchupSummary m;
  m.present = true;
  m.opponent = "Crosby's Crease";
  m.status = "WON";
  m.tally = "6-3-0";
  return m;
}

NextMatchup sampleNextMatchup() {
  NextMatchup m;
  m.present = true;
  m.opponent = "Puck Yeah";
  m.opponentRecord = "10-7-1";
  return m;
}

} // namespace

int main(int argc, char** argv) {
  std::string outDir = argc > 1 ? argv[1] : "/tmp";

  auto layout = buildLayout(sampleStandings());
  auto current = sampleCurrentMatchup();
  auto last = sampleLastMatchup();
  auto next = sampleNextMatchup();

  {
    HostDisplayStub display(800, 480);
    renderStandingsPage(display, "Slapshot Sixers", layout, /*hasPlayoffTeams=*/true, /*playoffTeams=*/8,
                         current, last, next, /*footer=*/"");
    display.writeBMP(outDir + "/preview_page1_standings.bmp");
  }
  {
    HostDisplayStub display(800, 480);
    renderCategoryPage(display, "My Team", current, /*footer=*/"");
    display.writeBMP(outDir + "/preview_page2_categories.bmp");
  }
  {
    HostDisplayStub display(800, 480);
    renderMessage(display, "No data yet");
    display.writeBMP(outDir + "/preview_message.bmp");
  }

  printf("Wrote %s/preview_page1_standings.bmp, preview_page2_categories.bmp, preview_message.bmp\n", outDir.c_str());
  return 0;
}
