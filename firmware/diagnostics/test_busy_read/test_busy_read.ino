// Diagnostic only: reads BUSY (GPIO25) continuously with no other panel
// activity at all (no init, no commands sent). A stable HIGH or LOW
// suggests a real connection to the panel; rapid/random flickering
// suggests a floating or disconnected pin.

static const int PIN_BUSY = 25;

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(PIN_BUSY, INPUT);
  Serial.println("BUSY-read-only test starting. No commands sent to panel.");
}

void loop() {
  Serial.printf("BUSY (GPIO25): %s\n", digitalRead(PIN_BUSY) ? "HIGH" : "LOW");
  delay(200);
}
