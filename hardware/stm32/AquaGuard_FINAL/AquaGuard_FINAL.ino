/*
 * ============================================================
 *  AquaNode STM32 — Blue Pill (updated for ESP32 gateway)
 *  Sends JSON telemetry to ESP32, receives pump/mode commands
 * ============================================================
 *  WIRING:
 *   HC-SR04 VCC   → 5V
 *   HC-SR04 GND   → GND
 *   HC-SR04 TRIG  → PA0
 *   HC-SR04 ECHO  → 10kΩ → PA1 → 20kΩ → GND
 *   Pot wiper     → PA2  (sides → 3.3V and GND)
 *   Relay IN      → PB0
 *   LCD SDA       → PB7
 *   LCD SCL       → PB6
 *   ESP32 GPIO17  → PA10 (Serial1 RX — commands from ESP32)
 *   ESP32 GPIO16  → PA9  (Serial1 TX — telemetry to ESP32)
 *   ESP32 GND     → STM32 GND
 *
 *  PROTOCOL (STM32 → ESP32, every 1s):
 *   {"wl":72,"v":230,"vs":"SAFE","ps":"OFF","mode":"AUTO","dry":false,"fault":""}
 *
 *  PROTOCOL (ESP32 → STM32, on command):
 *   PUMP:ON / PUMP:OFF / MODE:AUTO / MODE:MANUAL
 * ============================================================
 */

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ESP32 on Serial1 (PA9=TX, PA10=RX)
#define ESP32_SERIAL Serial1

// ─── Pins ─────────────────────────────────────────────────────
#define TRIG_PIN   PA0
#define ECHO_PIN   PA1
#define POT_PIN    PA2
#define RELAY_PIN  PB0

// ─── Tank calibration ─────────────────────────────────────────
const float TANK_EMPTY_CM = 10.0;
const float TANK_FULL_CM  = 1.0;
const float PUMP_ON_CM    = 9.0;   // ~10% full
const float PUMP_OFF_CM   = 2.0;   // ~89% full

// ─── Voltage simulation ───────────────────────────────────────
const float VOLT_MIN_SIM   = 150.0;
const float VOLT_MAX_SIM   = 280.0;
const float VOLT_SAFE_LOW  = 200.0;
const float VOLT_SAFE_HIGH = 250.0;
const int   ADC_MAX        = 1023;

// ─── Relay ────────────────────────────────────────────────────
#define PUMP_ON   HIGH
#define PUMP_OFF  LOW

// ─── Ultrasonic ───────────────────────────────────────────────
const unsigned long ECHO_TIMEOUT_US  = 30000UL;
const unsigned long PING_INTERVAL_MS = 50UL;
const int           SENSOR_SAMPLES   = 5;

// ─── Telemetry ────────────────────────────────────────────────
const unsigned long TELEMETRY_INTERVAL_MS = 1000;

// ─── LCD ──────────────────────────────────────────────────────
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ─── Mode: AUTO or MANUAL ─────────────────────────────────────
// AUTO = pump logic runs automatically from sensor
// MANUAL = web app controls pump directly
enum PumpMode { MODE_AUTO, MODE_MANUAL };
PumpMode currentMode = MODE_AUTO;

// ─── State ────────────────────────────────────────────────────
bool   pumpState      = false;
bool   sensorFault    = false;
bool   dryRun         = false;
String faultMsg       = "";
long   sequence       = 0;

// Dry-run lockout: after a dry-run event, pump stays OFF for at least
// DRY_RUN_LOCKOUT_MS and until water level recovers above DRY_RUN_CLEAR_PCT.
const unsigned long DRY_RUN_LOCKOUT_MS  = 30000UL;  // 30s minimum lockout
const int           DRY_RUN_CLEAR_PCT   = 10;        // must reach 10% to re-enable
const unsigned long DRY_RUN_CONFIRM_MS  = 4000UL;   // must persist 4s before triggering
bool          dryRunLocked    = false;
unsigned long dryRunLockedAt  = 0;
bool          dryRunPending   = false;   // debounce: condition seen but not yet confirmed
unsigned long dryRunPendingAt = 0;       // when the condition was first seen

unsigned long lastTelemetry = 0;
String        pendingCmd    = "";

// ─────────────────────────────────────────────────────────────
void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, PUMP_OFF);
  pinMode(TRIG_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  pinMode(ECHO_PIN, INPUT);
  pinMode(POT_PIN, INPUT);

  // UART to ESP32
  ESP32_SERIAL.begin(9600);

  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print(F("  AquaNode      "));
  lcd.setCursor(0, 1); lcd.print(F("  Starting...   "));
  delay(2000);
  lcd.clear();
}

// ─────────────────────────────────────────────────────────────
void loop() {

  // 1. Read any commands from ESP32
  readCommands();

  // 2. Distance + water level
  float distCm  = readMedian();
  int   levelPct = 0;
  sensorFault    = false;
  faultMsg       = "";

  if (distCm < 0) {
    sensorFault = true;
    faultMsg    = "SENSOR_TIMEOUT";
    // Don't update dryRun on bad reads — keep last known value
  } else {
    float d = distCm;
    if (d < TANK_FULL_CM)  d = TANK_FULL_CM;
    if (d > TANK_EMPTY_CM) d = TANK_EMPTY_CM;
    levelPct = (int)((TANK_EMPTY_CM - d) /
               (TANK_EMPTY_CM - TANK_FULL_CM) * 100.0);

    // Dry run: pump is ON but tank reads nearly empty — need 4s confirmation
    bool conditionMet = (pumpState && levelPct <= 2);
    if (conditionMet && !dryRunPending && !dryRun && !dryRunLocked) {
      // Condition just appeared — start debounce timer
      dryRunPending   = true;
      dryRunPendingAt = millis();
    } else if (!conditionMet) {
      // Condition cleared before confirmation
      dryRunPending = false;
    }
    // Confirm dry run only after 4 continuous seconds
    bool newDryRun = dryRun || (dryRunPending && (millis() - dryRunPendingAt >= DRY_RUN_CONFIRM_MS));
    if (newDryRun && !dryRun) {
      // Dry run confirmed — start lockout
      dryRunLocked    = true;
      dryRunLockedAt  = millis();
      dryRunPending   = false;
    }
    dryRun = newDryRun;
    if (dryRun)       faultMsg = "DRY_RUN";
    if (dryRunPending) faultMsg = "DRY_RUN_WARN"; // warning before full lockout

    // Clear lockout only when: period elapsed AND level recovered
    if (dryRunLocked &&
        (millis() - dryRunLockedAt >= DRY_RUN_LOCKOUT_MS) &&
        levelPct >= DRY_RUN_CLEAR_PCT) {
      dryRunLocked  = false;
      dryRun        = false;
      dryRunPending = false;
    }
  }

  // 3. Voltage
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(POT_PIN); delay(2); }
  int   adcRaw  = (int)(sum / 8);
  int   simVolt = (int)(VOLT_MIN_SIM +
                  ((float)adcRaw / ADC_MAX) *
                  (VOLT_MAX_SIM - VOLT_MIN_SIM));
  if (simVolt < (int)VOLT_MIN_SIM) simVolt = (int)VOLT_MIN_SIM;
  if (simVolt > (int)VOLT_MAX_SIM) simVolt = (int)VOLT_MAX_SIM;
  bool voltOk = (simVolt >= (int)VOLT_SAFE_LOW &&
                 simVolt <= (int)VOLT_SAFE_HIGH);
  String voltState = voltOk ? "NORMAL" : (simVolt < (int)VOLT_SAFE_LOW ? "UNDER_VOLTAGE" : "OVER_VOLTAGE");

  // 4. Pump logic (AUTO mode only)
  if (currentMode == MODE_AUTO && !sensorFault) {
    if (!voltOk) {
      if (pumpState) { pumpState = false; }
    } else if (dryRun || dryRunLocked) {
      // Force pump OFF — dry run active or still in lockout period
      pumpState = false;
    } else {
      if      (distCm >= PUMP_ON_CM  && !pumpState) pumpState = true;
      else if (distCm <= PUMP_OFF_CM &&  pumpState) pumpState = false;
    }
  }
  // Safety override applies in ALL modes (MANUAL too):
  // dryRunLocked ensures pump can't re-enable immediately after dry run clears
  if (!voltOk || dryRun || dryRunLocked) pumpState = false;

  digitalWrite(RELAY_PIN, pumpState ? PUMP_ON : PUMP_OFF);
  sequence++;

  // 5. LCD
  updateLCD(levelPct, simVolt, voltOk);

  // 6. Send telemetry to ESP32 as JSON
  if (millis() - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    sendTelemetry(levelPct, simVolt, voltState);
    lastTelemetry = millis();
  }
}

// ─────────────────────────────────────────────────────────────
//  Send JSON telemetry line to ESP32
// ─────────────────────────────────────────────────────────────
void sendTelemetry(int levelPct, int volt, String voltState) {
  // Build compact JSON — no library needed, values are all simple types
  ESP32_SERIAL.print(F("{\"wl\":"));
  ESP32_SERIAL.print(levelPct);
  ESP32_SERIAL.print(F(",\"v\":"));
  ESP32_SERIAL.print(volt);
  ESP32_SERIAL.print(F(",\"vs\":\""));
  ESP32_SERIAL.print(voltState);
  ESP32_SERIAL.print(F("\",\"ps\":\""));
  ESP32_SERIAL.print(pumpState ? "ON" : "OFF");
  ESP32_SERIAL.print(F("\",\"mode\":\""));
  ESP32_SERIAL.print(currentMode == MODE_AUTO ? "AUTO" : "MANUAL");
  ESP32_SERIAL.print(F("\",\"dry\":"));
  ESP32_SERIAL.print(dryRun ? "true" : "false");
  ESP32_SERIAL.print(F(",\"fault\":\""));
  ESP32_SERIAL.print(faultMsg);
  ESP32_SERIAL.println(F("\"}"));
}

// ─────────────────────────────────────────────────────────────
//  Read commands from ESP32 (non-blocking)
//  Commands: PUMP:ON / PUMP:OFF / MODE:AUTO / MODE:MANUAL
// ─────────────────────────────────────────────────────────────
void readCommands() {
  while (ESP32_SERIAL.available()) {
    char c = ESP32_SERIAL.read();
    if (c == '\n') {
      pendingCmd.trim();
      if (pendingCmd.length() > 0) processCommand(pendingCmd);
      pendingCmd = "";
    } else if (c != '\r') {
      pendingCmd += c;
    }
  }
}

void processCommand(String cmd) {
  if (cmd == "PUMP:ON") {
    currentMode = MODE_MANUAL;
    pumpState   = true;
    digitalWrite(RELAY_PIN, PUMP_ON);
  } else if (cmd == "PUMP:OFF") {
    currentMode = MODE_MANUAL;
    pumpState   = false;
    digitalWrite(RELAY_PIN, PUMP_OFF);
  } else if (cmd == "MODE:AUTO") {
    currentMode = MODE_AUTO;
  } else if (cmd == "MODE:MANUAL") {
    currentMode = MODE_MANUAL;
  } else if (cmd == "FAULT:RESET") {
    // Clear dry-run lockout so pump can restart
    dryRunLocked  = false;
    dryRun        = false;
    dryRunPending = false;
    faultMsg      = "";
    // In MANUAL mode, keep pump OFF until explicitly turned on
    if (currentMode == MODE_MANUAL) pumpState = false;
  }
  updateLCDMode();
}

// ─────────────────────────────────────────────────────────────
//  LCD
// ─────────────────────────────────────────────────────────────
void updateLCD(int level, int volt, bool voltOk) {
  // Row 0: Water level % + pump + mode
  lcd.setCursor(0, 0);
  if (sensorFault) {
    lcd.print(F("Water:ERR  P:---"));
  } else {
    lcd.print(F("Water:"));
    if (level < 100) lcd.print(' ');
    if (level < 10)  lcd.print(' ');
    lcd.print(level);
    lcd.print(F("% P:"));
    lcd.print(pumpState ? F("ON ") : F("OFF"));
  }

  // Row 1: Voltage + mode
  lcd.setCursor(0, 1);
  lcd.print(F("V:"));
  lcd.print(volt);
  lcd.print(voltOk ? F("V OK ") : F("V ERR"));
  lcd.print(currentMode == MODE_AUTO ? F(" AUTO") : F(" MAN "));
}

void updateLCDMode() {
  // Quick mode update on row 1 end
  lcd.setCursor(11, 1);
  lcd.print(currentMode == MODE_AUTO ? F(" AUTO") : F(" MAN "));
}

// ─────────────────────────────────────────────────────────────
float readUltrasonic() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(4);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long dur = pulseIn(ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
  if (dur == 0) return -1.0;
  return (dur * 0.0343) / 2.0;
}

float readMedian() {
  float buf[SENSOR_SAMPLES];
  int   valid = 0;
  for (int i = 0; i < SENSOR_SAMPLES; i++) {
    buf[i] = readUltrasonic();
    if (buf[i] > 0) valid++;
    delay(PING_INTERVAL_MS);
  }
  if (valid < (SENSOR_SAMPLES / 2 + 1)) return -1.0;
  for (int i = 1; i < SENSOR_SAMPLES; i++) {
    float k = buf[i]; int j = i - 1;
    while (j >= 0 && buf[j] > k) { buf[j+1] = buf[j]; j--; }
    buf[j+1] = k;
  }
  return buf[SENSOR_SAMPLES / 2];
}
