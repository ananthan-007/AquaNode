/**
 * AquaGuard ESP32 Gateway
 *
 * STM32 <-> UART <-> ESP32 <-> HTTPS <-> AquaGuard Cloud
 *
 * ESP32 responsibilities:
 *   - Connect to Wi-Fi
 *   - Send heartbeat to Vercel
 *   - Verify STM32 through UART PING/PONG
 *   - Request STM32 telemetry
 *   - Forward telemetry to Vercel
 *   - Poll Vercel for commands/challenges
 *   - Relay commands to STM32
 *   - Answer handshake challenges
 *
 * IMPORTANT:
 *   The PWA NEVER connects directly to this ESP32.
 *
 * Required libraries (Arduino Library Manager):
 *   - ArduinoJson  >= 7.0.0  (Benoit Blanchon)
 *   - Built-in: WiFi, WiFiClientSecure, HTTPClient  (esp32 board core)
 *
 * Board: ESP32 Dev Module  (Tools → Board → esp32 → ESP32 Dev Module)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================================================
// DEVELOPMENT / PRODUCTION
// ============================================================
//
// For initial hardware testing against a DEVELOPMENT backend,
// uncomment this.
//
// DO NOT use insecure TLS against production.
//
// #define AQUAGUARD_DEV_MODE


// ============================================================
// WIFI CONFIGURATION
// ============================================================

#define WIFI_SSID       "YOUR_WIFI_NAME"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"


// ============================================================
// AQUAGUARD BACKEND
// ============================================================
//
// Your deployed AquaGuard application:
//
// https://aqua-guard-jade.vercel.app
//

#define BACKEND_URL "https://aqua-guard-jade.vercel.app"


// ============================================================
// DEVICE AUTHENTICATION
// ============================================================
//
// DEVELOPMENT (NODE_ENV != production):
//   Use the shared dev token — no database provisioning needed.
//
//     #define DEVICE_TOKEN "dev-device-token-secret"
//
//   The backend accepts this only when NODE_ENV is not "production".
//
// PRODUCTION:
//   Each ESP32 must have its own unique 64-char hex token.
//   Generate and register a token using the provisioning API:
//
//     Step 1 — Make sure this ESP32 has sent at least one heartbeat
//              with the dev token so it appears in device_registry.
//
//     Step 2 — Call POST /api/admin/provision-device-token
//              (requires an authenticated AquaGuard user session):
//
//       curl -X POST https://your-app.vercel.app/api/admin/provision-device-token \
//         -H "Cookie: <your-session-cookie>" \
//         -H "Content-Type: application/json" \
//         -d '{"registryDeviceId":"AQ-ESP32-XXXXXXXXXXXX","description":"Unit 1"}'
//
//     Step 3 — Copy the "rawToken" value from the response.
//              Replace DEVICE_TOKEN below with that value.
//              Flash this firmware to the ESP32.
//
//     Step 4 — The raw token is shown ONCE. Store it in your password
//              manager. Only its SHA-256 hash is stored in the database.
//
// DO NOT use your Supabase keys here.
// DO NOT put SUPABASE_SERVICE_ROLE_KEY here.
//

#define DEVICE_TOKEN "REPLACE_WITH_DEVICE_TOKEN"


// ============================================================
// DEVICE INFORMATION
// ============================================================

#define FIRMWARE_VERSION "1.0.0"


// ============================================================
// STM32 UART
// ============================================================

#define STM32_UART_RX 16
#define STM32_UART_TX 17

#define STM32_BAUD 115200

HardwareSerial stm32Serial(2);


// ============================================================
// TIMING
// ============================================================

#define HEARTBEAT_INTERVAL_MS      8000UL
#define TELEMETRY_INTERVAL_MS      5000UL
#define COMMAND_POLL_INTERVAL_MS   2000UL

#define UART_PING_INTERVAL_MS     10000UL
#define UART_RESPONSE_TIMEOUT_MS   2000UL

#define COMMAND_TIMEOUT_MS         5000UL

#define WIFI_RECONNECT_INTERVAL_MS 10000UL

#define HTTP_TIMEOUT_MS            10000UL


// ============================================================
// TLS
// ============================================================

#ifndef AQUAGUARD_DEV_MODE

/*
 * PRODUCTION:
 *
 * Replace this with the actual CA certificate required for
 * the deployed HTTPS endpoint.
 *
 * DO NOT leave this placeholder in production.
 */

static const char AQUAGUARD_ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_ACTUAL_ROOT_CA
-----END CERTIFICATE-----
)EOF";

#endif


// ============================================================
// TELEMETRY STATE
// ============================================================

struct TelemetryState {

  int waterLevel = 0;

  float voltage = 0.0f;

  String voltageState = "NORMAL";

  String pumpState = "OFF";

  String mode = "AUTO";

  bool dryRun = false;

  String fault = "";

  int sequence = 0;

  bool valid = false;
};


// ============================================================
// SYSTEM STATE
// ============================================================

struct SystemState {

  bool wifiConnected = false;

  bool backendReachable = false;

  bool stm32Connected = false;

  TelemetryState telemetry;

  unsigned long lastHeartbeat = 0;

  unsigned long lastTelemetry = 0;

  unsigned long lastCommandPoll = 0;

  unsigned long lastUartPing = 0;

  unsigned long lastWifiAttempt = 0;
};


SystemState sys;

String DEVICE_ID;


// ============================================================
// TLS CONFIGURATION
// ============================================================

void configureTLS(WiFiClientSecure& client) {

#ifdef AQUAGUARD_DEV_MODE

  client.setInsecure();

  Serial.println(
    "[TLS] DEVELOPMENT MODE - certificate validation disabled"
  );

#else

  client.setCACert(AQUAGUARD_ROOT_CA);

  Serial.println(
    "[TLS] PRODUCTION MODE - CA validation enabled"
  );

#endif
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(500);

  // ----------------------------------------------------------
  // Generate stable device ID from ESP32 MAC
  // ----------------------------------------------------------

  uint8_t mac[6];

  esp_efuse_mac_get_default(mac);

  char macString[13];

  snprintf(
    macString,
    sizeof(macString),
    "%02X%02X%02X%02X%02X%02X",
    mac[0],
    mac[1],
    mac[2],
    mac[3],
    mac[4],
    mac[5]
  );

  DEVICE_ID = "AQ-ESP32-" + String(macString);


  // ----------------------------------------------------------
  // Startup information
  // ----------------------------------------------------------

  Serial.println();
  Serial.println("====================================");
  Serial.println("AquaGuard ESP32 Gateway");
  Serial.println("====================================");

  Serial.println(
    "Device ID: " + DEVICE_ID
  );

  Serial.println(
    "Firmware: " + String(FIRMWARE_VERSION)
  );

  Serial.println(
    "Backend: " + String(BACKEND_URL)
  );

#ifdef AQUAGUARD_DEV_MODE

  Serial.println(
    "Mode: DEVELOPMENT"
  );

#else

  Serial.println(
    "Mode: PRODUCTION"
  );

#endif


  // ----------------------------------------------------------
  // STM32 UART
  // ----------------------------------------------------------

  stm32Serial.begin(
    STM32_BAUD,
    SERIAL_8N1,
    STM32_UART_RX,
    STM32_UART_TX
  );

  Serial.println(
    "[UART] STM32 UART initialized"
  );


  // ----------------------------------------------------------
  // Wi-Fi
  // ----------------------------------------------------------

  connectWiFi();
}


// ============================================================
// MAIN LOOP
// ============================================================

void loop() {

  unsigned long now = millis();


  // ----------------------------------------------------------
  // Wi-Fi
  // ----------------------------------------------------------

  if (WiFi.status() != WL_CONNECTED) {

    sys.wifiConnected = false;

    if (
      now - sys.lastWifiAttempt
      >= WIFI_RECONNECT_INTERVAL_MS
    ) {

      sys.lastWifiAttempt = now;

      connectWiFi();
    }

    delay(20);

    return;
  }

  sys.wifiConnected = true;


  // ----------------------------------------------------------
  // Verify STM32
  // ----------------------------------------------------------

  if (
    now - sys.lastUartPing
    >= UART_PING_INTERVAL_MS
  ) {

    sys.lastUartPing = now;

    verifySTM32();
  }


  // ----------------------------------------------------------
  // Heartbeat
  // ----------------------------------------------------------

  if (
    now - sys.lastHeartbeat
    >= HEARTBEAT_INTERVAL_MS
  ) {

    sys.lastHeartbeat = now;

    sendHeartbeat();
  }


  // ----------------------------------------------------------
  // Telemetry
  // ----------------------------------------------------------

  if (
    now - sys.lastTelemetry
    >= TELEMETRY_INTERVAL_MS
  ) {

    sys.lastTelemetry = now;

    if (sys.stm32Connected) {

      requestSTM32Telemetry();
    }

    if (sys.telemetry.valid) {

      sendTelemetry();
    }
  }


  // ----------------------------------------------------------
  // Commands + handshake challenges
  // ----------------------------------------------------------

  if (
    now - sys.lastCommandPoll
    >= COMMAND_POLL_INTERVAL_MS
  ) {

    sys.lastCommandPoll = now;

    pollCloud();
  }


  delay(10);
}


// ============================================================
// WIFI
// ============================================================

void connectWiFi() {

  Serial.print("[WiFi] Connecting");

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  for (
    int i = 0;
    i < 30 && WiFi.status() != WL_CONNECTED;
    i++
  ) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    sys.wifiConnected = true;

    Serial.println(
      "[WiFi] CONNECTED"
    );

    Serial.println(
      "[WiFi] IP: "
      + WiFi.localIP().toString()
    );

  } else {

    sys.wifiConnected = false;

    Serial.println(
      "[WiFi] CONNECTION FAILED"
    );
  }
}


// ============================================================
// HTTP POST -> VERCEL
// ============================================================

int postToCloud(
  const String& payload
) {

  if (WiFi.status() != WL_CONNECTED) {

    sys.backendReachable = false;

    return -1;
  }


  WiFiClientSecure client;

  configureTLS(client);


  HTTPClient http;

  String url =
    String(BACKEND_URL)
    + "/api/device/ingest";


  if (!http.begin(client, url)) {

    sys.backendReachable = false;

    Serial.println(
      "[HTTP] Could not connect to "
      + url
    );

    return -1;
  }


  http.addHeader(
    "Content-Type",
    "application/json"
  );

  http.addHeader(
    "Authorization",
    "Bearer " + String(DEVICE_TOKEN)
  );

  http.setTimeout(
    HTTP_TIMEOUT_MS
  );


  int responseCode =
    http.POST(payload);


  if (responseCode == 200) {

    sys.backendReachable = true;

  } else {

    sys.backendReachable = false;
  }


  Serial.printf(
    "[HTTP] POST /ingest -> %d\n",
    responseCode
  );


  if (responseCode < 0) {

    Serial.println(
      "[HTTP] "
      + http.errorToString(responseCode)
    );
  }


  http.end();

  return responseCode;
}


// ============================================================
// STM32 PING / PONG
// ============================================================

void verifySTM32() {

  while (stm32Serial.available()) {

    stm32Serial.read();
  }


  // Expected STM32 request:
  //
  // {"v":1,"type":"PING"}

  stm32Serial.println(
    "{\"v\":1,\"type\":\"PING\"}"
  );


  unsigned long start =
    millis();

  String response;


  while (
    millis() - start
    < UART_RESPONSE_TIMEOUT_MS
  ) {

    if (stm32Serial.available()) {

      char c =
        stm32Serial.read();

      if (c == '\n') {

        break;
      }

      response += c;
    }

    delay(1);
  }


  response.trim();


  bool previous =
    sys.stm32Connected;


  sys.stm32Connected =
    response.indexOf("PONG") >= 0;


  if (
    !previous
    && sys.stm32Connected
  ) {

    Serial.println(
      "[UART] STM32 CONNECTED"
    );
  }


  if (
    previous
    && !sys.stm32Connected
  ) {

    Serial.println(
      "[UART] STM32 DISCONNECTED"
    );
  }
}


// ============================================================
// STM32 TELEMETRY
// ============================================================

void requestSTM32Telemetry() {

  while (stm32Serial.available()) {

    stm32Serial.read();
  }


  stm32Serial.println(
    "{\"v\":1,\"type\":\"REQUEST_TELEMETRY\"}"
  );


  unsigned long start =
    millis();

  String response;


  while (
    millis() - start
    < UART_RESPONSE_TIMEOUT_MS
  ) {

    if (stm32Serial.available()) {

      char c =
        stm32Serial.read();

      if (c == '\n') {

        break;
      }

      response += c;
    }

    delay(1);
  }


  response.trim();


  if (response.length() == 0) {

    Serial.println(
      "[UART] No telemetry response"
    );

    return;
  }


  JsonDocument doc;


  DeserializationError error =
    deserializeJson(
      doc,
      response
    );


  if (error) {

    Serial.println(
      "[UART] Invalid telemetry JSON"
    );

    Serial.println(response);

    return;
  }


  sys.telemetry.waterLevel =
    doc["waterLevel"]
    | sys.telemetry.waterLevel;


  sys.telemetry.voltage =
    doc["voltage"]
    | sys.telemetry.voltage;


  sys.telemetry.voltageState =
    String(
      doc["voltageState"]
      | "NORMAL"
    );


  sys.telemetry.pumpState =
    String(
      doc["pumpState"]
      | "OFF"
    );


  sys.telemetry.mode =
    String(
      doc["mode"]
      | "AUTO"
    );


  sys.telemetry.dryRun =
    doc["dryRun"]
    | false;


  // Extract fault carefully: JSON null must map to empty string (no-fault),
  // NOT to the string "null". ArduinoJson's (doc["fault"] | "") coerces JSON
  // null to "" correctly when the fallback type is const char*, but
  // wrapping in String() is safe because ArduinoJson returns nullptr for
  // a null JSON value when cast to const char*, and String(nullptr) = "".
  const char* faultRaw = doc["fault"] | (const char*)nullptr;
  sys.telemetry.fault = (faultRaw != nullptr) ? String(faultRaw) : String("");


  sys.telemetry.sequence =
    doc["seq"]
    | (sys.telemetry.sequence + 1);


  sys.telemetry.valid = true;


  Serial.printf(
    "[TEL] level=%d%% voltage=%.2f pump=%s\n",
    sys.telemetry.waterLevel,
    sys.telemetry.voltage,
    sys.telemetry.pumpState.c_str()
  );
}


// ============================================================
// HEARTBEAT
// ============================================================

void sendHeartbeat() {

  JsonDocument doc;


  doc["deviceId"] =
    DEVICE_ID;

  doc["type"] =
    "heartbeat";

  doc["firmwareVersion"] =
    FIRMWARE_VERSION;

  doc["stm32Connected"] =
    sys.stm32Connected;


  String payload;

  serializeJson(
    doc,
    payload
  );


  Serial.printf(
    "[HB] STM32=%s\n",
    sys.stm32Connected
      ? "OK"
      : "FAIL"
  );


  postToCloud(payload);
}


// ============================================================
// TELEMETRY -> CLOUD
// ============================================================

void sendTelemetry() {

  JsonDocument doc;


  doc["deviceId"] =
    DEVICE_ID;

  doc["type"] =
    "telemetry";

  doc["firmwareVersion"] =
    FIRMWARE_VERSION;

  doc["stm32Connected"] =
    sys.stm32Connected;


  JsonObject telemetry =
    doc["telemetry"]
      .to<JsonObject>();


  telemetry["waterLevel"] =
    sys.telemetry.waterLevel;

  telemetry["voltage"] =
    sys.telemetry.voltage;

  telemetry["voltageState"] =
    sys.telemetry.voltageState;

  telemetry["pumpState"] =
    sys.telemetry.pumpState;

  telemetry["mode"] =
    sys.telemetry.mode;

  telemetry["dryRun"] =
    sys.telemetry.dryRun;

  telemetry["sequence"] =
    sys.telemetry.sequence;


  if (
    sys.telemetry.fault.length() > 0
  ) {

    telemetry["fault"] =
      sys.telemetry.fault;

  } else {

    telemetry["fault"] =
      nullptr;
  }


  String payload;

  serializeJson(
    doc,
    payload
  );


  postToCloud(payload);
}


// ============================================================
// CLOUD POLLING
// ============================================================

void pollCloud() {

  if (
    WiFi.status()
    != WL_CONNECTED
  ) {

    return;
  }


  WiFiClientSecure client;

  configureTLS(client);


  HTTPClient http;


  String url =
    String(BACKEND_URL)
    + "/api/device/commands/pending?deviceId="
    + DEVICE_ID;


  if (!http.begin(client, url)) {

    return;
  }


  http.addHeader(
    "Authorization",
    "Bearer " + String(DEVICE_TOKEN)
  );


  http.setTimeout(8000);


  int code =
    http.GET();


  if (code != 200) {

    Serial.printf(
      "[HTTP] pending -> %d\n",
      code
    );

    http.end();

    return;
  }


  String body =
    http.getString();


  http.end();


  JsonDocument doc;


  if (
    deserializeJson(
      doc,
      body
    )
  ) {

    Serial.println(
      "[HTTP] Invalid pending JSON"
    );

    return;
  }


  // ----------------------------------------------------------
  // Commands
  // ----------------------------------------------------------

  JsonArray commands =
    doc["commands"]
      .as<JsonArray>();


  for (
    JsonObject command : commands
  ) {

    String commandId =
      command["id"] | "";

    String commandType =
      command["type"] | "";


    if (
      commandId.isEmpty()
      || commandType.isEmpty()
    ) {

      continue;
    }


    Serial.println(
      "[CMD] "
      + commandType
    );


    relayCommandToSTM32(
      commandId,
      commandType
    );
  }


  // ----------------------------------------------------------
  // Live handshake challenges
  // ----------------------------------------------------------

  JsonArray challenges =
    doc["challenges"]
      .as<JsonArray>();


  for (
    JsonObject challenge : challenges
  ) {

    String nonce =
      challenge["nonce"] | "";


    if (nonce.isEmpty()) {

      continue;
    }


    Serial.println(
      "[HANDSHAKE] Challenge received"
    );


    JsonDocument response;


    response["deviceId"] =
      DEVICE_ID;

    response["type"] =
      "challenge_response";

    response["nonce"] =
      nonce;


    String payload;

    serializeJson(
      response,
      payload
    );


    postToCloud(payload);
  }
}


// ============================================================
// COMMAND -> STM32
// ============================================================

void relayCommandToSTM32(
  const String& commandId,
  const String& commandType
) {

  reportCommandResult(
    commandId,
    "RECEIVED",
    ""
  );


  if (
    !sys.stm32Connected
  ) {

    reportCommandResult(
      commandId,
      "FAILED",
      "STM32 UART not connected"
    );

    return;
  }


  JsonDocument command;


  command["v"] =
    1;

  command["cmdId"] =
    commandId;

  command["type"] =
    commandType;


  String payload;

  serializeJson(
    command,
    payload
  );


  while (
    stm32Serial.available()
  ) {

    stm32Serial.read();
  }


  stm32Serial.println(
    payload
  );


  unsigned long start =
    millis();

  String response;


  while (
    millis() - start
    < COMMAND_TIMEOUT_MS
  ) {

    if (
      stm32Serial.available()
    ) {

      char c =
        stm32Serial.read();


      if (c == '\n') {

        break;
      }


      response += c;
    }

    delay(1);
  }


  response.trim();


  if (
    response.length() == 0
  ) {

    reportCommandResult(
      commandId,
      "FAILED",
      "STM32 timeout"
    );

    return;
  }


  JsonDocument responseDoc;


  if (
    deserializeJson(
      responseDoc,
      response
    )
  ) {

    reportCommandResult(
      commandId,
      "FAILED",
      "STM32 invalid JSON"
    );

    return;
  }


  String result =
    responseDoc["result"]
    | "FAILED";


  String reason =
    responseDoc["reason"]
    | "";


  if (
    result == "EXECUTED"
  ) {

    reportCommandResult(
      commandId,
      "EXECUTED",
      ""
    );

  } else if (
    result == "REJECTED"
  ) {

    reportCommandResult(
      commandId,
      "REJECTED",
      reason
    );

  } else {

    reportCommandResult(
      commandId,
      "FAILED",
      reason.length()
        ? reason
        : "Unknown STM32 error"
    );
  }
}


// ============================================================
// COMMAND RESULT -> CLOUD
// ============================================================

void reportCommandResult(
  const String& commandId,
  const String& status,
  const String& reason
) {

  JsonDocument doc;


  doc["deviceId"] =
    DEVICE_ID;

  doc["type"] =
    "command_result";

  doc["commandId"] =
    commandId;

  doc["status"] =
    status;


  if (
    reason.length() > 0
  ) {

    doc["reason"] =
      reason;
  }


  String payload;

  serializeJson(
    doc,
    payload
  );


  postToCloud(payload);
}