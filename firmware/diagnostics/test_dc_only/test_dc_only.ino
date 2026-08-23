// Diagnostic only: toggles DC (GPIO27) and nothing else.
// Probe the DC wire at the PANEL end and confirm it alternates ~0V / ~3.3V.

static const int PIN_DC = 27;

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(PIN_DC, OUTPUT);
  Serial.println("DC-only test starting. Probe the DC wire at the panel end.");
}

void loop() {
  Serial.println("DC (GPIO27): HIGH for 3s -- expect ~3.3V");
  digitalWrite(PIN_DC, HIGH);
  delay(3000);
  Serial.println("DC (GPIO27): LOW for 3s -- expect ~0V");
  digitalWrite(PIN_DC, LOW);
  delay(3000);
}
