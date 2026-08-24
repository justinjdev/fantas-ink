// firmware/display_render.cpp
#include "display_render.h"
#include <SPI.h>
#include <cctype>
#include <cstdio>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Fonts/FreeMono9pt7b.h>
#include <Fonts/FreeMono12pt7b.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>

// Pins confirmed against Waveshare's ESP32 e-Paper Driver Board wiki and
// GxEPD2's ConnectingHardware.md — see design spec's Hardware section.
static const int PIN_EPD_CS = 15;
static const int PIN_EPD_DC = 27;
static const int PIN_EPD_RST = 26;
static const int PIN_EPD_BUSY = 25;
static const int PIN_SPI_SCK = 13;
static const int PIN_SPI_MISO = 12; // unused by the panel (write-only), required by SPIClass::begin's signature
static const int PIN_SPI_MOSI = 14;

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

static SPIClass hspi(HSPI);

// The Display object embeds a ~48KB framebuffer as a member array, which is
// larger than loopTask's 8192-byte stack (ARDUINO_LOOP_STACK_SIZE). It must
// live in static storage, and initDisplay() must hand back a reference —
// returning by value would put a copy right back on the caller's stack.
static Display display(GxEPD2_750_GDEY075T7(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

Display& initDisplay() {
  hspi.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200);
  display.setRotation(0);
  display.setTextWrap(false);
  return display;
}

static int textWidth(Display& display, const std::string& text) {
  int16_t tbx, tby;
  uint16_t tbw, tbh;
  display.getTextBounds(text.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
  return static_cast<int>(tbw);
}

// getTextBounds measures against whatever font is currently set on the display,
// so every caller must setFont() to the font that will actually draw the string
// BEFORE calling this — measuring with the wrong font fails silently.
static std::string truncateToWidth(Display& display, const std::string& text, int maxWidth) {
  if (textWidth(display, text) <= maxWidth) return text;
  std::string out = text;
  while (!out.empty()) {
    out.pop_back();
    if (textWidth(display, out) <= maxWidth) break;
  }
  return out;
}

static void drawStandingsTable(Display& display, const std::vector<LayoutRow>& rows,
                                bool hasPlayoffTeams, int playoffTeams) {
  const float tableTop = 74.0f, tableBottom = 452.0f;
  const int rankX = 20, teamX = 56, wltX = 235, pctX = 335, strkX = 400;

  const float rowH = standingsRowHeight(rows.size(), tableTop, tableBottom);
  float y = tableTop;
  bool prevWasGap = false;
  for (const auto& row : rows) {
    if (row.isGap) {
      hrule(display, teamX, static_cast<int>(y + rowH / 2), 440);
      y += rowH;
      prevWasGap = true;
      continue;
    }
    if (hasPlayoffTeams && row.rank == playoffTeams + 1 && !prevWasGap) {
      for (int x = 56; x < 440; x += 10) display.fillRect(x, static_cast<int>(y), 6, 2, GxEPD_BLACK);
    }
    prevWasGap = false;

    const int baseline = static_cast<int>(y + rowH / 2.0f) + 7;
    if (row.isMe) {
      display.fillRect(16, static_cast<int>(y) + 2, 432, static_cast<int>(rowH) - 6, GxEPD_BLACK);
      display.setTextColor(GxEPD_WHITE);
    } else {
      display.setTextColor(GxEPD_BLACK);
    }

    display.setFont(&FreeMonoBold12pt7b);
    printAligned(display, std::to_string(row.rank), rankX, baseline);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, truncateToWidth(display, row.displayName, 175), teamX, baseline);
    display.setFont(row.isMe ? &FreeMonoBold9pt7b : &FreeMono9pt7b);
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
  const int nameBudget = 296; // sidebar x=484 to the frame rule's right end at 780

  display.setFont(&FreeSansBold9pt7b);
  printAligned(display, eyebrow, sx, topY + eyebrowOffset);

  if (big) {
    display.setFont(&FreeSansBold18pt7b);
    printAligned(display, statusWord, sx, midY - 4);
    display.setFont(&FreeSansBold12pt7b);
    const std::string prefix = "vs ";
    printAligned(display, prefix + truncateToWidth(display, oppName, nameBudget - textWidth(display, prefix)),
                 sx, midY + 19);
    display.setFont(&FreeMonoBold18pt7b);
    printAligned(display, tally, sx, midY + 46);
    display.setFont(&FreeSans9pt7b);
    printAligned(display, caption, sx, midY + 63);
  } else {
    display.setFont(&FreeSansBold12pt7b);
    const std::string prefix = statusWord + " vs ";
    printAligned(display, prefix + truncateToWidth(display, oppName, nameBudget - textWidth(display, prefix)),
                 sx, midY + 8);
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
    const std::string prefix = "vs ";
    printAligned(display, prefix + truncateToWidth(display, next.opponent, 296 - textWidth(display, prefix)),
                 484, midY + 8);
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
    printAligned(display, truncateToWidth(display, leagueName, 760), 20, 40);
    hrule(display, 20, 54, 780);
    vrule(display, 460, 54, 452);

    drawStandingsTable(display, rows, hasPlayoffTeams, playoffTeams);
    drawMatchupSidebar(display, current, last, next);

    hrule(display, 20, 452, 780);
    display.setFont(&FreeSans9pt7b);
    if (!footer.empty()) printAligned(display, footer, 20, 468);
    printAligned(display, "PAGE 1/2 - button > categories", 780, 468, Align::Right);
  } while (display.nextPage());
}

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
      const std::string prefix = "vs ";
      printAligned(display, prefix + truncateToWidth(display, current.opponent, 760 - textWidth(display, prefix)),
                   20, 36);
      display.setFont(&FreeSansBold24pt7b);
      printAligned(display, current.status + "  " + current.tally, 20, 78);
      hrule(display, 20, 92, 780);
      display.setFont(&FreeSansBold12pt7b);
      printAligned(display, "Category breakdown unavailable", 20, 200);
    } else {
      display.setFont(&FreeSansBold18pt7b);
      const std::string prefix = "vs ";
      printAligned(display, prefix + truncateToWidth(display, current.opponent, 760 - textWidth(display, prefix)),
                   20, 36);
      display.setFont(&FreeSansBold24pt7b);
      printAligned(display, current.status + "  " + current.tally, 20, 78);
      hrule(display, 20, 92, 780);

      const int meColX = 300, oppColX = 500, labelColX = 400;
      display.setFont(&FreeSansBold9pt7b);
      // Uppercase before measuring: capitals are wider than lowercase, so
      // fitting the mixed-case string would overflow once it was uppercased.
      std::string myUpper = myTeamName;
      for (auto& c : myUpper) c = toupper(static_cast<unsigned char>(c));
      myUpper = truncateToWidth(display, myUpper, 280);
      std::string oppUpper = current.opponent;
      for (auto& c : oppUpper) c = toupper(static_cast<unsigned char>(c));
      oppUpper = truncateToWidth(display, oppUpper, 280);
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

void renderMessage(Display& display, const std::string& message) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, display.height() / 2);
    display.print(message.c_str());
  } while (display.nextPage());
}

void hibernateDisplay(Display& display) {
  display.hibernate();
}
