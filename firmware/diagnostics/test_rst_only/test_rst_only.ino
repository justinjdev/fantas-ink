// Diagnostic only: toggles RST (GPIO26) and nothing else.
// Probe the RST wire at the PANEL end and confirm it alternates ~0V / ~3.3V.

static const int PIN_RST = 26;

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(PIN_RST, OUTPUT);
  Serial.println("RST-only test starting. Probe the RST wire at the panel end.");
}

void loop() {
  Serial.println("RST (GPIO26): HIGH for 3s -- expect ~3.3V");
  digitalWrite(PIN_RST, HIGH);
  delay(3000);
  Serial.println("RST (GPIO26): LOW for 3s -- expect ~0V");
  digitalWrite(PIN_RST, LOW);
  delay(3000);
}
