/*
 * ============================================================
 *  AquaNode — ESP32 WiFi Gateway
 *  Connects to Supabase, reads STM32 via UART, pushes telemetry
 *  and polls for pump commands from the web app.
 * ============================================================
 *
 *  ARCHITECTURE:
 *   Web App → Supabase (commands table) → ESP32 → STM32 UART
 *   STM32 UART → ESP32 → Supabase (device_state + events)
 *
 *  WIRING (ESP32 ↔ STM32):
 *   ESP32 GPIO17 (TX2) → STM32 PA10 (RX1)
 *   ESP32 GPIO16 (RX2) → STM32 PA9  (TX1)
 *   ESP32 GND          → STM32 GND  (shared ground — critical!)
 *
 *  SERIAL PROTOCOL (STM32 → ESP32, every 1 second):
 *   STM32 sends a JSON line:
 *   {"wl":72,"v":230,"vs":"SAFE","ps":"OFF","mode":"AUTO","dry":false,"fault":""}
 *
 *  COMMAND PROTOCOL (ESP32 → STM32):
 *   ESP32 sends a single line:
 *   PUMP:ON   or   PUMP:OFF   or   MODE:AUTO   or   MODE:MANUAL
 *
 * ============================================================
 *  SETUP:
 *   1. Fill in your WiFi credentials below.
 *   2. Fill in your Supabase URL and anon key.
 *   3. Fill in your DEVICE_ID (must match a registered device
 *      in your device_registry table).
 *   4. Upload to ESP32 DevKit V1.
 * ============================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ─── USER CONFIG — fill these in ─────────────────────────────
#define WIFI_SSID        "realme P1 5G"
#define WIFI_PASSWORD    "Ananthan_007"

// Supabase project URL (no trailing slash)
#define SUPABASE_URL     "https://byzekttpfkftpfkhdpwh.supabase.co"

// Supabase anon key (from Project Settings → API)
#define SUPABASE_KEY     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5emVrdHRwZmtmdHBma2hkcHdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzQ3NDUsImV4cCI6MjEwMzMxMDc0NX0.F99-zC6-0vM6FndztVnvBFluaVsvoPZ78ZXHnjGLbA8"

// Backend API URL (for ingest)
#define BACKEND_URL      "https://aqua-node-beta.vercel.app"
#define INGEST_TOKEN     "dev-device-token-secret"

// Device ID — must match device_registry.device_id (text, not UUID)
// This is the string ID your web app registered the device with
#define DEVICE_ID        "AQ-ESP32-DEV000000001"

// Firmware version shown in dashboard
#define FIRMWARE_VERSION "1.0.0"

// ─── Pins ─────────────────────────────────────────────────────
// Serial2: GPIO17=TX, GPIO16=RX (to STM32 PA10/PA9)
#define STM32_SERIAL     Serial2
#define STM32_TX_PIN     17
#define STM32_RX_PIN     16

// ─── Timing ───────────────────────────────────────────────────
const unsigned long TELEMETRY_INTERVAL_MS  = 2000;   // push to Supabase every 2s
const unsigned long COMMAND_POLL_MS        = 3000;   // poll commands every 3s
const unsigned long HEARTBEAT_INTERVAL_MS  = 8000;   // heartbeat every 8s (matches web app ONLINE threshold of 25s)
const unsigned long WIFI_RETRY_MS          = 5000;
const unsigned long STM32_TIMEOUT_MS       = 10000;  // STM32 considered offline after 10s (give it time to boot+send first packet)

// ─── State ────────────────────────────────────────────────────
struct DeviceState {
  int    water_level    = 0;
  float  voltage        = 0.0;
  String voltage_state  = "UNKNOWN";
  String pump_state     = "OFF";
  String mode           = "AUTO";
  bool   dry_run        = false;
  String fault          = "";
  bool   stm32_online   = false;
  long   sequence       = 0;
};

DeviceState state;
unsigned long lastTelemetry  = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastHeartbeat  = 0;
unsigned long lastSTM32Data  = 0;  // Will be set in setup() after millis() is valid
unsigned long lastSTM32Debug = 0;  // For periodic UART debug print
String        pendingSTM32Line = "";

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  STM32_SERIAL.begin(9600, SERIAL_8N1, STM32_RX_PIN, STM32_TX_PIN);
  delay(500);

  // Initialize lastSTM32Data to now so first 10 s don't falsely report STM32 offline
  // (millis() is valid after setup starts)
  lastSTM32Data = millis();

  Serial.println(F("=== AquaNode ESP32 Gateway ==="));
  Serial.print(F("Device ID: ")); Serial.println(DEVICE_ID);
  Serial.print(F("Firmware:  ")); Serial.println(FIRMWARE_VERSION);

  connectWiFi();

  // Register device on startup
  registerDevice();
}

// ─────────────────────────────────────────────────────────────
void loop() {
  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WiFi] Disconnected — reconnecting..."));
    connectWiFi();
  }

  // Read any data from STM32
  readSTM32();

  // Periodic debug: show whether UART is getting bytes
  unsigned long now = millis();
  if (now - lastSTM32Debug >= 5000) {
    lastSTM32Debug = now;
    Serial.printf("[STM32] Status: %s, Last data: %lums ago, Available: %d bytes\n",
      state.stm32_online ? "ONLINE" : "OFFLINE",
      now - lastSTM32Data,
      STM32_SERIAL.available());
  }

  // Check STM32 online status
  state.stm32_online = (millis() - lastSTM32Data < STM32_TIMEOUT_MS);

  unsigned long now = millis();

  // Push telemetry to Supabase
  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    pushTelemetry();
    lastTelemetry = now;
  }

  // Poll for commands from web app
  if (now - lastCommandPoll >= COMMAND_POLL_MS) {
    pollCommands();
    lastCommandPoll = now;
  }

  // Heartbeat
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    pushHeartbeat();
    lastHeartbeat = now;
  }
}

// ─────────────────────────────────────────────────────────────
//  WiFi
// ─────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.print(F("[WiFi] Connecting to "));
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 15000) {
      Serial.println(F("[WiFi] Timeout — will retry in loop"));
      return;
    }
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  Serial.print(F("[WiFi] Connected. IP: "));
  Serial.println(WiFi.localIP());
}

// ─────────────────────────────────────────────────────────────
//  Read JSON lines from STM32 over UART
//  STM32 sends: {"wl":72,"v":230,"vs":"SAFE","ps":"OFF","mode":"AUTO","dry":false,"fault":""}
// ─────────────────────────────────────────────────────────────
void readSTM32() {
  while (STM32_SERIAL.available()) {
    char c = STM32_SERIAL.read();
    if (c == '\n') {
      parseSTM32Line(pendingSTM32Line);
      pendingSTM32Line = "";
    } else if (c != '\r') {
      pendingSTM32Line += c;
    }
  }
}

void parseSTM32Line(String line) {
  line.trim();
  if (line.length() == 0) return;

  // Only parse JSON lines
  if (!line.startsWith("{")) return;

  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    Serial.print(F("[STM32] JSON parse error: "));
    Serial.println(err.c_str());
    return;
  }

  state.water_level   = doc["wl"]   | 0;
  state.voltage       = doc["v"]    | 0.0f;
  state.voltage_state = doc["vs"]   | "UNKNOWN";
  state.pump_state    = doc["ps"]   | "OFF";
  state.mode          = doc["mode"] | "AUTO";
  state.dry_run       = doc["dry"]  | false;
  state.fault         = doc["fault"]| "";
  state.sequence++;

  lastSTM32Data = millis();

  Serial.printf("[STM32] WL:%d%% V:%.0f %s Pump:%s Mode:%s\n",
    state.water_level, state.voltage,
    state.voltage_state.c_str(),
    state.pump_state.c_str(),
    state.mode.c_str());

  // Send event to Supabase if there's a fault
  if (state.fault.length() > 0) {
    pushEvent("FAULT", state.fault);
  }
}

// ─────────────────────────────────────────────────────────────
//  Push telemetry to device_state (upsert)
// ─────────────────────────────────────────────────────────────
void pushTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = String(BACKEND_URL) + "/api/device/ingest";
  
  StaticJsonDocument<512> doc;
  doc["type"] = "telemetry";
  doc["deviceId"] = DEVICE_ID;
  
  JsonObject tel = doc.createNestedObject("telemetry");
  tel["waterLevel"] = state.water_level;
  tel["voltage"] = (int)state.voltage;
  tel["voltageState"] = state.voltage_state;
  tel["pumpState"] = state.pump_state;
  tel["mode"] = state.mode;
  tel["dryRun"] = state.dry_run;
  tel["fault"] = state.fault;
  tel["sequence"] = state.sequence;
  tel["firmwareVersion"] = FIRMWARE_VERSION;
  tel["stm32Connected"] = state.stm32_online;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  int code = http.POST(body);
  http.end();

  if (code == 200 || code == 201 || code == 204) {
    Serial.println(F("[Ingest] Telemetry pushed ✓"));
  } else {
    Serial.printf("[Ingest] Telemetry failed: HTTP %d\n", code);
  }
}

// ─────────────────────────────────────────────────────────────
//  Push heartbeat (device_registry last_seen update)
// ─────────────────────────────────────────────────────────────
void pushHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = String(BACKEND_URL) + "/api/device/ingest";
  
  StaticJsonDocument<256> doc;
  doc["type"] = "heartbeat";
  doc["deviceId"] = DEVICE_ID;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["stm32Connected"] = state.stm32_online;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  int code = http.POST(body);
  http.end();
  Serial.printf("[Ingest] Heartbeat: HTTP %d\n", code);
}

// ─────────────────────────────────────────────────────────────
//  Push an event to events table
// ─────────────────────────────────────────────────────────────
void pushEvent(String type, String message) {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = String(BACKEND_URL) + "/api/device/ingest";
  
  StaticJsonDocument<256> doc;
  doc["type"] = "event";
  doc["deviceId"] = DEVICE_ID;
  JsonObject evt = doc.createNestedObject("event");
  evt["type"] = type;
  evt["message"] = message;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  int code = http.POST(body);
  http.end();
  Serial.printf("[Ingest] Event (%s): HTTP %d\n", type.c_str(), code);
}

// ─────────────────────────────────────────────────────────────
//  Register device in device_registry on boot
// ─────────────────────────────────────────────────────────────
void registerDevice() {
  if (WiFi.status() != WL_CONNECTED) return;
  // The ingest API automatically handles device registration when a heartbeat is received.
  pushHeartbeat();
}

// ─────────────────────────────────────────────────────────────
//  Poll commands table for pending commands from web app
//  commands table has: type (PUMP_ON/PUMP_OFF/MODE_AUTO/MODE_MANUAL)
//                      status (PENDING/EXECUTED/FAILED)
// ─────────────────────────────────────────────────────────────
void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Fetch PENDING commands for this device by registry_device_id (text),
  // not device_id (UUID FK) which the hardware can never satisfy directly.
  String url = String(SUPABASE_URL)
    + "/rest/v1/commands"
    + "?registry_device_id=eq." + DEVICE_ID
    + "&status=eq.PENDING"
    + "&order=created_at.asc"
    + "&limit=1";

  HTTPClient http;
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Accept", "application/json");

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }

  String response = http.getString();
  http.end();

  // Parse response array
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err || !doc.is<JsonArray>() || doc.as<JsonArray>().size() == 0) {
    return;  // No pending commands
  }

  JsonObject cmd = doc[0];
  String cmdId   = cmd["id"] | "";
  String cmdType = cmd["type"] | "";

  Serial.print(F("[Command] Received: ")); Serial.println(cmdType);

  // Execute the command
  bool success = executeCommand(cmdType);

  // Update command status in Supabase
  updateCommandStatus(cmdId, success ? "EXECUTED" : "FAILED");
}

// ─────────────────────────────────────────────────────────────
//  Execute a command by sending it to STM32 over UART
// ─────────────────────────────────────────────────────────────
bool executeCommand(String cmdType) {
  if (cmdType == "PUMP_ON") {
    STM32_SERIAL.println("PUMP:ON");
    Serial.println(F("[STM32] → PUMP:ON"));
    state.pump_state = "ON";
    pushEvent("PUMP_ON", "Pump turned ON by web app command");
    return true;
  } else if (cmdType == "PUMP_OFF") {
    STM32_SERIAL.println("PUMP:OFF");
    Serial.println(F("[STM32] → PUMP:OFF"));
    state.pump_state = "OFF";
    pushEvent("PUMP_OFF", "Pump turned OFF by web app command");
    return true;
  } else if (cmdType == "MODE_AUTO" || cmdType == "SET_MODE_AUTO") {
    STM32_SERIAL.println("MODE:AUTO");
    Serial.println(F("[STM32] → MODE:AUTO"));
    state.mode = "AUTO";
    return true;
  } else if (cmdType == "MODE_MANUAL" || cmdType == "SET_MODE_MANUAL") {
    STM32_SERIAL.println("MODE:MANUAL");
    Serial.println(F("[STM32] → MODE:MANUAL"));
    state.mode = "MANUAL";
    return true;
  } else if (cmdType == "FAULT_RESET") {
    STM32_SERIAL.println("FAULT:RESET");
    Serial.println(F("[STM32] → FAULT:RESET"));
    state.fault = "";
    pushEvent("FAULT_RESET", "Fault cleared by web app");
    return true;
  }

  Serial.print(F("[Command] Unknown type: ")); Serial.println(cmdType);
  return false;
}

// ─────────────────────────────────────────────────────────────
//  Update command status (EXECUTED or FAILED)
// ─────────────────────────────────────────────────────────────
void updateCommandStatus(String cmdId, String status) {
  if (cmdId.length() == 0) return;
  String url = String(BACKEND_URL) + "/api/device/ingest";
  
  StaticJsonDocument<256> doc;
  doc["type"] = "command_result";
  doc["deviceId"] = DEVICE_ID;
  doc["commandId"] = cmdId;
  doc["status"] = status;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  int code = http.POST(body);
  http.end();
  Serial.printf("[Ingest] Command %s -> %s: HTTP %d\n", cmdId.c_str(), status.c_str(), code);
}

// ─────────────────────────────────────────────────────────────
//  Generic Supabase POST (insert or upsert)
// ─────────────────────────────────────────────────────────────
int supabasePost(String url, String body, bool upsert) {
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  if (upsert) {
    http.addHeader("Prefer", "resolution=merge-duplicates,return=minimal");
  } else {
    http.addHeader("Prefer", "return=minimal");
  }
  int code = http.POST(body);
  http.end();
  return code;
}

// ─────────────────────────────────────────────────────────────
//  ISO 8601 timestamp (requires NTP)
// ─────────────────────────────────────────────────────────────
String nowISO() {
  // Trigger NTP sync on first successful WiFi connection
  static bool ntpSynced = false;
  if (!ntpSynced && WiFi.status() == WL_CONNECTED) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    // Non-blocking: check once, will succeed within a few seconds naturally
    ntpSynced = true;
  }

  struct tm ti;
  if (!getLocalTime(&ti, 0)) {  // 0ms timeout = non-blocking
    // NTP not synced yet — caller will check for "1970" prefix and omit the field
    return "1970-01-01T00:00:00Z";
  }

  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buf);
}
