// Diagnostic only: toggles CS (GPIO15) and nothing else.
// Probe the CS wire at the PANEL end and confirm it alternates ~0V / ~3.3V.

static const int PIN_CS = 15;

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(PIN_CS, OUTPUT);
  Serial.println("CS-only test starting. Probe the CS wire at the panel end.");
}

void loop() {
  Serial.println("CS (GPIO15): HIGH for 3s -- expect ~3.3V");
  digitalWrite(PIN_CS, HIGH);
  delay(3000);
  Serial.println("CS (GPIO15): LOW for 3s -- expect ~0V");
  digitalWrite(PIN_CS, LOW);
  delay(3000);
}
