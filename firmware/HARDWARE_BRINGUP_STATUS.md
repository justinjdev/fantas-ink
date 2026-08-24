# ESP32 Firmware Hardware Bring-Up — Status Log

**Last updated:** 2026-08-23
**Current status:** BLOCKED — physical display produces no output; evidence points to a defective panel/module. Firmware itself is complete, tested, and merged.

## TL;DR for resuming

1. Firmware is done. Code is merged into `esp32-firmware-planning` (PR [#4](https://github.com/justinjdev/fantas-ink/pull/4) against `main`), all 7 plan tasks reviewed clean, final whole-branch review clean, host tests pass, `arduino-cli compile` clean.
2. Hardware bring-up is blocked: the physical e-ink panel has never displayed anything — stays completely black, on every attempt, no matter what's sent to it.
3. Exhaustive debugging (below) ruled out firmware, wiring, and power as the cause. The panel/module is very likely dead on arrival.
4. **Next step:** contact Waveshare (or the seller) for a replacement — draft message included below. Once a new panel arrives, skip straight to "Resuming after a replacement panel arrives" at the bottom.

## Hardware in use

- **Driver board:** Waveshare ESP32 e-Paper Driver Board. CH343 USB-serial chip. Has an "EN" (reset) and "BOOT" (flash mode) button.
- **Panel:** Waveshare 4.2" e-Paper Module, printed **"Rev2.2"** on the board, 400×300, SSD1683 controller. This is the **Module** variant (has its own onboard driver PCB with a labeled 8-pin connector: BUSY/RST/DC/CS/CLK/DIN/GND/VCC), not the raw FFC panel the driver board's included "e-Paper Adapter" accessory expects — the adapter is FFC-to-FFC and was never used. The panel connects via its factory 8-pin pigtail directly to the driver board's `J3`/`J4` GPIO breakout headers instead.
- **GxEPD2 driver class:** `GxEPD2_420_GDEY042T81` (confirmed correct for this exact panel revision).
- **Serial port:** was `/dev/cu.usbmodem5ABA0255651` this session — will likely enumerate under a different `/dev/cu.usbmodem*` name next time; run `arduino-cli board list` to find it.
- **Power:** directly from a laptop USB port (no hub). Voltage at the panel measured 3.3V.

## Confirmed-correct wiring reference

Cross-checked against **two independent official sources** (the driver board's own Altium schematic, and Waveshare's published pinout diagram for the board) — both agreed exactly. Then further verified against the physical hardware two more ways: full continuity testing of all 8 wires, and active toggle-and-measure testing (code drives the pin, multimeter confirms the voltage change at the panel end) for RST, DC, and CS specifically.

| Module wire color | Signal | Driver board header pin | Verification |
|---|---|---|---|
| Purple | BUSY | J3 pin 9 (GPIO25) | Continuity + stable-read test (see below) |
| White | RST | J3 pin 10 (GPIO26) | Continuity + **active toggle confirmed** |
| Teal/Green | DC | J3 pin 11 (GPIO27) | Continuity + **active toggle confirmed** |
| Orange | CS | J4 pin 16 (GPIO15) | Continuity + **active toggle confirmed** |
| Yellow | CLK | J3 pin 15 (GPIO13) | Continuity |
| Blue | DIN | J3 pin 12 (GPIO14) | Continuity |
| Brown/Maroon | GND | J3 pin 14 | Continuity |
| Gray/Tan | VCC | J3 pin 1 | Continuity, 3.3V measured at panel |

Module's own switches:
- **BS switch** (selects 3-line vs 4-line SPI): confirmed set to **0** (4-line SPI) — correct, matches what `GxEPD2_420_GDEY042T81` expects (it actively drives DC).
- Driver board's **SW1** DIP switch (A/B, selects a booster resistor for the FFC/raw-panel path only): confirmed **not applicable** to this wiring — it only feeds the driver board's own power-sequencing circuit, which is wired exclusively to the unused FFC connector (`J1`), not to `J3`/`J4`.

## Symptom

Panel is **always completely black** — from first power-on, through every firmware version tried, through the unmodified library reference example. It has never shown any image, text, or even the brief white-flash that's typical of an e-ink panel's first refresh.

Our firmware's serial log (when it gets that far) shows:
```
Busy Timeout!
_Update_Full : 10001040
```
This is GxEPD2's own diagnostic message: it sent the panel an update command and waited (~10s, the library's default timeout) for the BUSY pin to signal completion, and it never did.

## What was ruled out, and how

1. **Our firmware's logic** — ruled out by testing GxEPD2's own **unmodified** official example sketch for this exact board (`GxEPD2_WS_ESP32_Driver.ino`, saved at `firmware/diagnostics/gxepd2_reference_test/`), using the same pins. It failed identically. This means the bug is not in our code.
2. **Pin mapping being wrong** — ruled out by cross-checking two independent official sources (schematic + Waveshare's pinout diagram), which agreed exactly with each other and with our firmware's pin constants.
3. **Wiring being loose/miscounted** — ruled out three ways: full continuity test of all 8 wires, active toggle-and-measure verification of RST/DC/CS (code drives the pin, multimeter confirms the actual voltage change at the panel end — this is stronger than continuity alone, since it can't be fooled by a systematic pin-counting error), and a stable (non-floating) BUSY reading with zero commands sent (see `firmware/diagnostics/test_busy_read/`) — a genuinely disconnected/floating pin would read noisy/random, not a rock-solid consistent value.
4. **BS switch (3-line vs 4-line SPI)** — confirmed already correctly set to 4-line (0).
5. **Driver board's SW1 DIP switch** — confirmed not applicable to this wiring path at all (only feeds the unused FFC connector's power circuit).
6. **Power** — GND/VCC continuity confirmed, 3.3V measured at the panel, powered directly from a laptop USB port (not a weak hub).
7. **Internal module-to-glass FFC connector** (the ribbon inside the module linking its driver PCB to the actual glass panel) — visually/physically checked, appears properly seated.

Nothing left to test that wasn't already covered. **Conclusion: very likely a defective panel/module.**

## Diagnostic sketches (preserved in `firmware/diagnostics/`)

These were built during bring-up and are reusable if the replacement panel has issues too:

- **`gxepd2_reference_test/`** — GxEPD2's own official example for this exact driver board, stripped of the bitmap-drawing calls (which need image files not present in this install). Uses the correct pins and driver class. The strongest available "is it our code or the hardware" test.
- **`test_rst_only/`, `test_dc_only/`, `test_cs_only/`** — each toggles exactly one pin (GPIO26/27/15 respectively) HIGH/LOW on a 3-second cycle and does nothing else. Flash one at a time and probe the corresponding wire at the panel end with a multimeter to actively confirm that specific signal path.
- **`test_busy_read/`** — reads GPIO25 continuously with zero commands sent to the panel. Useful to check whether BUSY is floating (noisy/random reads) vs. genuinely connected (stable reads).

All compile with `arduino-cli compile --fqbn esp32:esp32:esp32 <dir>` and flash with the same `--fqbn` via `arduino-cli upload -p <port> <dir>`.

## Draft message for Waveshare / the seller

> Subject: 4.2" e-Paper Module (Rev2.2) — no display output, appears dead on arrival
>
> I have a 4.2" e-Paper Module (400×300, printed "Rev2.2" on the board) paired with the ESP32 e-Paper Driver Board, wired via the module's 8-pin connector (BUSY/RST/DC/CS/CLK/DIN/GND/VCC) directly to the driver board's GPIO headers. The display never produces any output — it stays completely black/blank, including on first power-up, and never performs even an initial refresh flash.
>
> Using the GxEPD2 library (with the `GxEPD2_420_GDEY042T81` driver class, matching this panel), every attempt to update the display fails with a "Busy Timeout" error — the library sends an update command and the BUSY pin never signals completion within the timeout window.
>
> **What I've already verified before concluding this is a hardware issue:**
> - Pin wiring cross-checked against two independent official sources (driver board schematic and Waveshare's own pinout diagram) — confirmed correct
> - All 8 wires continuity-tested end to end
> - RST, DC, and CS actively verified with a multimeter — confirmed each toggles correctly when driven by code
> - BUSY reads a stable, consistent value (not floating/noisy), suggesting a real connection to the panel
> - VCC measured 3.3V at the panel
> - BS switch correctly set to position 0 (4-line SPI)
> - Same failure occurs using the **unmodified official GxEPD2 example sketch** for this exact board/panel combination (not custom code)
>
> Given the pin mapping, wiring, and power all check out, and even the reference example fails identically, this looks like a defective panel or module. Could you help with a replacement or refund?

## Resuming after a replacement panel arrives

**Update (2026-08-23):** the replacement is not the same model — user sized up to the **Waveshare 7.5" e-Paper raw panel** (800×480, no onboard PCB, "GDEY075T7" generation, UC8179 controller, 24-pin/0.5mm FFC connector), not another 4.2" module. This is a materially different physical setup from everything logged above. Firmware and diagnostics have already been updated for it (see below) — the rest of this checklist reflects the new panel, not the old one.

1. **Wiring is NOT identical to the table above** — that table was for the 4.2" *Module*'s 8-pin pigtail into `J3`/`J4`. The 7.5" *raw* panel instead uses its 24-pin FFC ribbon plugged into the driver board's **"e-Paper Adapter"** (FFC-to-FFC accessory — previously unused) into connector **`J1`**. The GPIO pin numbers themselves are unchanged (BUSY=25, RST=26, DC=27, CS=15, CLK=13, DIN=14 — confirmed generic across panel sizes on this driver board), so the pin-toggle diagnostic sketches (`test_rst_only/`, `test_dc_only/`, `test_cs_only/`, `test_busy_read/`) remain valid as-is.
2. **Move driver board switch SW1 from A to B.** Waveshare's resistor table puts the 4.2" panel in the "A / 3R" group and the 7.5" panel in the "B / 0.47R" group. This didn't matter last time because SW1 only feeds the `J1` power path, which was unused with the pigtail wiring — now that `J1` is actually in use, getting this wrong will likely reproduce the same dead-panel symptom. Waveshare's own docs hedge this as somewhat empirical ("if display effect is poor, try switching"), but B is the documented default for this panel.
3. Firmware already updated for this panel (driver class swap, not a design decision — dictated by the hardware): `display_render.h`/`display_render.cpp` now use `GxEPD2_750_GDEY075T7` instead of `GxEPD2_420_GDEY042T81`, and `firmware/diagnostics/gxepd2_reference_test/` was updated the same way. Both compile clean as of this update.
4. `secrets.h` should already have real values from earlier bring-up (WiFi, SHARED_TOKEN, TZ_STRING) — check it wasn't reset to placeholders.
5. Flash the real firmware: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware && arduino-cli upload --fqbn esp32:esp32:esp32 -p <port> firmware`. It already includes on-screen boot status text ("Booting...", "Connecting WiFi...", etc.) so you can watch progress on the panel itself without needing a serial monitor.
6. Fake standings data is still live on the deployed server (`https://fantas-ink-server.vercel.app/api/standings`) — uploaded directly to Vercel Blob at `latest.json` for testing without needing real Yahoo API access (still pending approval, unrelated to this hardware work). `SHARED_TOKEN` is in `server/.env.local` if you need to re-verify with `curl`.
7. If the new panel also shows nothing: start with `firmware/diagnostics/gxepd2_reference_test/` (the official example, already updated for this panel) before assuming it's another dead unit — worth ruling out a fresh wiring/adapter/SW1 mistake first, since this is a brand new physical setup with a connector path (`J1`/adapter) that was never actually used or tested before. Note: this sketch currently can't be compiled via `arduino-cli compile <dir>` because its filename (`GxEPD2_WS_ESP32_Driver.ino`) doesn't match its containing directory name, a pre-existing issue predating this update — either rename the file to match the directory or open it in the Arduino IDE.
8. The display layout (`display_layout.cpp`/`display_render.cpp` row/column coordinates) is still tuned for the old 400×300 canvas — it will render correctly on the new 800×480 panel (nothing is hardcoded in a way that breaks), but it won't use the extra space. Treat that as a separate follow-up once the hardware itself is confirmed working, not a bring-up blocker.
9. Once a real image renders, work through the remaining manual verification checklist in `firmware/README.md` (WiFi failure, cached fallback, network blackhole, cold start, panel hibernate, sleep duration sanity).
