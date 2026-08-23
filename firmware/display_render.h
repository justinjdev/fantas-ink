// firmware/display_render.h
#pragma once
#include <GxEPD2_BW.h>
#include <vector>
#include <string>
#include "display_layout.h"

using Display = GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>;

// Constructs the remapped HSPI bus this board requires (its CLK/DIN pins
// are swapped from the ESP32's default VSPI — see design spec's Hardware
// section) and returns an initialized display object.
Display initDisplay();

// Draws the standings table. `footer` is shown at the bottom (e.g.
// "Last updated: ..." for stale data) or left empty for fresh data.
void renderLayout(Display& display, const std::vector<LayoutRow>& rows, const std::string& footer);

// Full-screen single message — used for the first-boot/empty-cache case.
void renderMessage(Display& display, const std::string& message);

// Must be called after every render. See design spec: an unrefreshed,
// still-powered panel can be permanently damaged per Waveshare's own
// documentation — this is not optional cleanup.
void hibernateDisplay(Display& display);
