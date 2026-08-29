// firmware/preview/host_display_stub.h
#pragma once
#include "Adafruit_GFX.h"
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// Stands in for the GxEPD2 `Display` type in host builds. Implements just
// enough of GxEPD2's paged-drawing API (firstPage()/nextPage()) alongside
// Adafruit_GFX for display_render.h's templates to compile and run: this
// panel's Display alias uses a full-height page, so the real device's
// `do { ... } while (nextPage())` loop body also runs exactly once.
class HostDisplayStub : public Adafruit_GFX {
 public:
  HostDisplayStub(int16_t w, int16_t h)
      : Adafruit_GFX(w, h), pixels(static_cast<size_t>(w) * static_cast<size_t>(h), true) {}

  void drawPixel(int16_t x, int16_t y, uint16_t color) override {
    if (x < 0 || y < 0 || x >= _width || y >= _height) return;
    pixels[static_cast<size_t>(y) * _width + x] = (color != 0x0000); // false = black
  }

  void firstPage() {}
  bool nextPage() { return false; }

  void writeBMP(const std::string& path) const;

 private:
  std::vector<bool> pixels; // true = white, false = black
};

inline void HostDisplayStub::writeBMP(const std::string& path) const {
  const int w = _width, h = _height;
  const int rowSize = ((w * 3 + 3) / 4) * 4; // 24bpp rows padded to a 4-byte boundary
  const int dataSize = rowSize * h;
  const int fileSize = 54 + dataSize;

  FILE* f = fopen(path.c_str(), "wb");
  if (!f) throw std::runtime_error("HostDisplayStub::writeBMP: failed to open " + path);

  auto put16 = [&](uint16_t v) { fwrite(&v, 2, 1, f); };
  auto put32 = [&](uint32_t v) { fwrite(&v, 4, 1, f); };

  fputc('B', f);
  fputc('M', f);
  put32(static_cast<uint32_t>(fileSize));
  put32(0);
  put32(54);
  put32(40); // BITMAPINFOHEADER size
  put32(static_cast<uint32_t>(w));
  put32(static_cast<uint32_t>(h));
  put16(1);  // color planes
  put16(24); // bits per pixel
  put32(0);  // no compression
  put32(static_cast<uint32_t>(dataSize));
  put32(2835); // ~72 DPI
  put32(2835);
  put32(0);
  put32(0);

  std::vector<uint8_t> row(static_cast<size_t>(rowSize), 0);
  for (int y = h - 1; y >= 0; y--) { // BMP pixel rows are stored bottom-up
    for (int x = 0; x < w; x++) {
      uint8_t v = pixels[static_cast<size_t>(y) * w + x] ? 255 : 0;
      row[static_cast<size_t>(x) * 3 + 0] = v;
      row[static_cast<size_t>(x) * 3 + 1] = v;
      row[static_cast<size_t>(x) * 3 + 2] = v;
    }
    fwrite(row.data(), 1, static_cast<size_t>(rowSize), f);
  }
  fclose(f);
}
