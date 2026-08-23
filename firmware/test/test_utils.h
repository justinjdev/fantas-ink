#pragma once
#include <iostream>
#include <string>

inline int g_failures = 0;

#define CHECK_EQ(actual, expected) do { \
  auto _a = (actual); auto _e = (expected); \
  if (!(_a == _e)) { \
    std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ \
               << " — expected " << _e << ", got " << _a << "\n"; \
    g_failures++; \
  } \
} while (0)

#define RUN(testFn) do { \
  std::cout << "  " #testFn "\n"; \
  testFn(); \
} while (0)
