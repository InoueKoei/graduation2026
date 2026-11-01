#include <Arduino.h>
#include "DialInput.h"

#if defined(ARDUINO_ARCH_RP2040)
#include <hardware/gpio.h>

#if defined(HEADKANA_TYPE_LCD)
#include "TypeLcdDial.h"
#elif defined(HEADKANA_SINGLE_LCD)
#include "SingleLcdDial.h"
#else

constexpr uint8_t ENCODER_A_PINS[2] = {6, 26};
constexpr uint8_t ENCODER_B_PINS[2] = {7, 15};
constexpr uint8_t ENCODER_SW_PINS[2] = {8, 14};
DualDialInput inputs;
DialTransmitScheduler transmitter;
RotaryEncoder interruptEncoders[2];
volatile int32_t pendingTurns[2] = {0, 0};
uint16_t sequence = 0;
bool usbWasConnected = false;

struct DialFrame {
  uint8_t flags, selection, left, right, pressedMask;
};
constexpr uint8_t EVENT_QUEUE_SIZE = 32;
DialFrame eventQueue[EVENT_QUEUE_SIZE];
uint8_t eventHead = 0, eventCount = 0;

void sampleEncoder(uint8_t index) {
  const uint32_t pins = gpio_get_all();
  const int8_t turn = interruptEncoders[index].update(
    (pins >> ENCODER_A_PINS[index]) & 1, (pins >> ENCODER_B_PINS[index]) & 1);
  pendingTurns[index] += turn;
}
void encoder0Changed() { sampleEncoder(0); }
void encoder1Changed() { sampleEncoder(1); }

DialFrame makeFrame(uint8_t eventFlags = 0, uint8_t dial = 0) {
  return {uint8_t(0x01 | eventFlags | (inputs.pressed() ? 0x08 : 0)),
    inputs.positions[dial], inputs.positions[0], inputs.positions[1], inputs.pressedMask()};
}

bool sendFrame(const DialFrame& frame) {
  if (!Serial) return false;
  const uint16_t nextSequence = sequence + 1;
  char line[80];
  const int length = snprintf(line, sizeof(line), "@D,%u,%u,%u,%u,%u,%u\n",
    frame.flags, frame.selection, nextSequence, frame.left, frame.right, frame.pressedMask);
  // Do not stall input sampling if the browser pauses its reader.
  if (Serial.availableForWrite() < length) return false;
  if (Serial.write(reinterpret_cast<const uint8_t*>(line), length) != size_t(length)) return false;
  sequence = nextSequence;
  return true;
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 2; ++i) {
    pinMode(ENCODER_A_PINS[i], INPUT_PULLUP);
    pinMode(ENCODER_B_PINS[i], INPUT_PULLUP);
    pinMode(ENCODER_SW_PINS[i], INPUT_PULLUP);
    interruptEncoders[i].begin(digitalRead(ENCODER_A_PINS[i]), digitalRead(ENCODER_B_PINS[i]));
  }
  attachInterrupt(digitalPinToInterrupt(ENCODER_A_PINS[0]), encoder0Changed, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_B_PINS[0]), encoder0Changed, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_A_PINS[1]), encoder1Changed, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENCODER_B_PINS[1]), encoder1Changed, CHANGE);
}

void loop() {
  const uint32_t now = millis();
  const bool connected = bool(Serial);
  if (connected != usbWasConnected) {
    usbWasConnected = connected;
    eventHead = eventCount = 0;
    if (connected) {
      Serial.println("BOOT HeadKana Dial v1.6 RP2040-Zero USB protocol=3 left=S1:GP6,S2:GP7,KEY:GP8 right=S1:GP26,S2:GP15,KEY:GP14");
      transmitter.lastSentAt = now - DIAL_HEARTBEAT_MS;
    }
  }
  int32_t turns[2];
  noInterrupts();
  for (uint8_t i = 0; i < 2; ++i) { turns[i] = pendingTurns[i]; pendingTurns[i] = 0; }
  interrupts();
  for (uint8_t i = 0; i < 2; ++i) {
    if (!turns[i]) continue;
    const int32_t start = DIAL_GROUP_STARTS[i], count = DIAL_GROUP_COUNTS[i];
    inputs.positions[i] = start + ((inputs.positions[i] - start + turns[i] % count + count) % count);
    transmitter.selectionChanged();
  }
  // Sample both keys before emitting either event; simultaneous input is left then right.
  DialButtonEvent events[2];
  for (uint8_t i = 0; i < 2; ++i) {
    const bool wasDown = inputs.buttons[i].down;
    events[i] = inputs.buttons[i].update(digitalRead(ENCODER_SW_PINS[i]) == LOW, now);
    if (wasDown != inputs.buttons[i].down) transmitter.selectionChanged();
  }
  for (uint8_t i = 0; i < 2; ++i) {
    if (!connected || events[i] == DialButtonEvent::none) continue;
    if (eventCount < EVENT_QUEUE_SIZE) {
      eventQueue[(eventHead + eventCount) % EVENT_QUEUE_SIZE] =
        makeFrame(events[i] == DialButtonEvent::confirm ? 0x02 : 0x04, i);
      ++eventCount;
    }
  }
  while (eventCount && sendFrame(eventQueue[eventHead])) {
    eventHead = (eventHead + 1) % EVENT_QUEUE_SIZE;
    --eventCount;
  }
  if (!eventCount && transmitter.due(now) && sendFrame(makeFrame())) transmitter.consume(now);
  delay(1);
}

#endif // HEADKANA_SINGLE_LCD

#else
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <atomic>

constexpr uint8_t ENCODER_A_PINS[2] = {1, 7};
constexpr uint8_t ENCODER_B_PINS[2] = {3, 9};
constexpr uint8_t ENCODER_SW_PINS[2] = {5, 13};
constexpr uint8_t STATUS_LED_PIN = 21;

constexpr const char* BLE_SERVICE = "9f6c0001-4b68-4b3a-9c87-df6f1da60001";
constexpr const char* BLE_NOTIFY = "9f6c0002-4b68-4b3a-9c87-df6f1da60001";
constexpr const char* BLE_SNAPSHOT = "9f6c0003-4b68-4b3a-9c87-df6f1da60001";

std::atomic<bool> bleConnected{false};
BLECharacteristic* bleNotify = nullptr;
BLECharacteristic* bleSnapshot = nullptr;
BLE2902* bleSubscription = nullptr;
DualDialInput inputs;
DialTransmitScheduler transmitter;
uint16_t sequence = 0;
uint32_t lastSelectionLogMs = 0;
bool lastLedConnected = false;
bool keyDiagnostic = false;
uint32_t keyDiagnosticStartedAt = 0;
uint32_t lastKeyDiagnosticAt = 0;

class DialServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected.store(true); }
  void onDisconnect(BLEServer*) override { bleConnected.store(false); }
};

void updateSnapshot() {
  char json[144];
  snprintf(json, sizeof(json),
    "{\"type\":\"dial\",\"protocol\":3,\"ready\":true,\"selected\":%u,\"positions\":[%u,%u],\"pressedMask\":%u}",
    inputs.positions[0], inputs.positions[0], inputs.positions[1], inputs.pressedMask());
  bleSnapshot->setValue(json);
}

void notifyDial(uint8_t eventFlags = 0, uint8_t eventDial = 0) {
  updateSnapshot();
  const uint16_t currentSequence = ++sequence;
  const uint8_t flags = 0x01 | eventFlags | (inputs.pressed() ? 0x08 : 0);
  const uint8_t selection = inputs.positions[eventDial];
  uint8_t packet[8] = {
    0xD3,
    flags,
    selection,
    uint8_t(currentSequence & 0xFF),
    uint8_t(currentSequence >> 8),
    inputs.positions[0], inputs.positions[1], inputs.pressedMask()
  };
  if (Serial) {
    Serial.printf("@D,%u,%u,%u,%u,%u,%u\n", flags, selection, currentSequence,
      inputs.positions[0], inputs.positions[1], inputs.pressedMask());
  }
  if (!bleConnected.load() || !bleSubscription->getNotifications()) return;
  bleNotify->setValue(packet, sizeof(packet));
  bleNotify->notify();
}

void updateStatusLed() {
  const bool connected = bleConnected.load();
  if (connected == lastLedConnected) return;
  lastLedConnected = connected;
  if (connected) rgbLedWrite(STATUS_LED_PIN, 0, 10, 8);
  else rgbLedWrite(STATUS_LED_PIN, 10, 3, 0);
}

void startBLE() {
  BLEDevice::init("M5-Kana-Dial");
  auto server = BLEDevice::createServer();
  server->setCallbacks(new DialServerCallbacks());
  server->advertiseOnDisconnect(true);
  auto service = server->createService(BLE_SERVICE);
  bleNotify = service->createCharacteristic(BLE_NOTIFY, BLECharacteristic::PROPERTY_NOTIFY);
  bleSubscription = new BLE2902();
  bleNotify->addDescriptor(bleSubscription);
  bleSnapshot = service->createCharacteristic(BLE_SNAPSHOT, BLECharacteristic::PROPERTY_READ);
  updateSnapshot();
  service->start();
  auto advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
}

void setup() {
  Serial.begin(115200);
  for (uint8_t i = 0; i < 2; ++i) {
    pinMode(ENCODER_A_PINS[i], INPUT_PULLUP);
    pinMode(ENCODER_B_PINS[i], INPUT_PULLUP);
    pinMode(ENCODER_SW_PINS[i], INPUT_PULLUP);
    inputs.encoders[i].begin(digitalRead(ENCODER_A_PINS[i]), digitalRead(ENCODER_B_PINS[i]));
  }
  rgbLedWrite(STATUS_LED_PIN, 10, 3, 0);
  startBLE();
  Serial.printf("BOOT HeadKana Dial v1.5 StampS3 independent left=%u right=%u notify=%ums\n",
    inputs.positions[0], inputs.positions[1], DIAL_NOTIFY_INTERVAL_MS);
  for (uint8_t i = 0; i < 2; ++i) {
    Serial.printf("DIAL%u A=G%u B=G%u SW=G%u range=%u..%u\n", i + 1,
      ENCODER_A_PINS[i], ENCODER_B_PINS[i], ENCODER_SW_PINS[i],
      DIAL_GROUP_STARTS[i], DIAL_GROUP_STARTS[i] + DIAL_GROUP_COUNTS[i] - 1);
  }
  Serial.println("BLE advertising M5-Kana-Dial protocol=3");
}

void loop() {
  const uint32_t now = millis();
  while (Serial.available()) {
    if (Serial.read() == 'k') {
      keyDiagnostic = true;
      keyDiagnosticStartedAt = now;
      lastKeyDiagnosticAt = now - 100;
      Serial.println("KEY diagnostic: 20s, LOW=pressed HIGH=released");
    }
  }
  if (keyDiagnostic && uint32_t(now - keyDiagnosticStartedAt) >= 20000) keyDiagnostic = false;
  for (uint8_t i = 0; i < 2; ++i) {
    const int8_t turn = inputs.rotate(i, digitalRead(ENCODER_A_PINS[i]), digitalRead(ENCODER_B_PINS[i]));
    if (turn) {
      transmitter.selectionChanged();
      if (uint32_t(now - lastSelectionLogMs) >= 100) {
        lastSelectionLogMs = now;
        Serial.printf("SELECT %u dial=%u direction=%d\n", inputs.positions[i], i + 1, turn);
      }
    }
  }

  // Sample BOTH keys before sending. Each event carries its own dial's cursor.
  DialButtonEvent events[2];
  for (uint8_t i = 0; i < 2; ++i) {
    const bool wasDown = inputs.buttons[i].down;
    events[i] = inputs.buttons[i].update(digitalRead(ENCODER_SW_PINS[i]) == LOW, now);
    if (wasDown != inputs.buttons[i].down) transmitter.selectionChanged();
  }
  for (uint8_t i = 0; i < 2; ++i) {
    const DialButtonEvent event = events[i];
    if (event == DialButtonEvent::none) continue;
    transmitter.queueEvent(event == DialButtonEvent::confirm ? 0x02 : 0x04);
    notifyDial(transmitter.consume(now), i);
    Serial.printf("%s %u dial=%u\n", event == DialButtonEvent::confirm ? "CONFIRM" : "ERASE", inputs.positions[i], i + 1);
  }

  if (transmitter.due(now)) {
    notifyDial(transmitter.consume(now));
  }
  if (keyDiagnostic && uint32_t(now - lastKeyDiagnosticAt) >= 100) {
    lastKeyDiagnosticAt = now;
    Serial.printf("KEY G%u=%d G%u=%d down1=%d down2=%d\n",
      ENCODER_SW_PINS[0], digitalRead(ENCODER_SW_PINS[0]),
      ENCODER_SW_PINS[1], digitalRead(ENCODER_SW_PINS[1]),
      inputs.buttons[0].down, inputs.buttons[1].down);
  }
  updateStatusLed();
  delay(1);
}
#endif
