#pragma once
#include <stdint.h>

constexpr uint8_t DIAL_KANA_COUNT = 46;
constexpr uint8_t DIAL_HOME_INDEX = 23;
constexpr uint8_t DIAL_GROUP_STARTS[2] = {0, 25};
constexpr uint8_t DIAL_GROUP_COUNTS[2] = {25, 21};
constexpr uint32_t DIAL_NOTIFY_INTERVAL_MS = 25;
constexpr uint32_t DIAL_HEARTBEAT_MS = 250;

struct RotaryEncoder {
  uint8_t previous = 0;
  int8_t quarterSteps = 0;

  void begin(bool a, bool b) {
    previous = (uint8_t(a) << 1) | uint8_t(b);
    quarterSteps = 0;
  }

  int8_t update(bool a, bool b) {
    static constexpr int8_t transitions[16] = {
      0,-1, 1, 0, 1, 0, 0,-1,
     -1, 0, 0, 1, 0, 1,-1, 0
    };
    const uint8_t current = (uint8_t(a) << 1) | uint8_t(b);
    const uint8_t transition = (previous << 2) | current;
    previous = current;
    quarterSteps += transitions[transition];
    if (quarterSteps >= 4) {
      quarterSteps = 0;
      return 1;
    }
    if (quarterSteps <= -4) {
      quarterSteps = 0;
      return -1;
    }
    return 0;
  }
};

struct DialTransmitScheduler {
  bool selectionDirty = false;
  uint8_t eventFlags = 0;
  uint32_t lastSentAt = 0;

  void selectionChanged() { selectionDirty = true; }
  void queueEvent(uint8_t flags) { eventFlags |= flags; }

  bool due(uint32_t now) const {
    const uint32_t elapsed = uint32_t(now - lastSentAt);
    return eventFlags != 0 ||
      (selectionDirty && elapsed >= DIAL_NOTIFY_INTERVAL_MS) ||
      elapsed >= DIAL_HEARTBEAT_MS;
  }

  uint8_t consume(uint32_t now) {
    const uint8_t flags = eventFlags;
    eventFlags = 0;
    selectionDirty = false;
    lastSentAt = now;
    return flags;
  }
};

enum class DialButtonEvent : uint8_t { none, confirm, erase };

struct DialButton {
  bool raw = false;
  bool down = false;
  bool longFired = false;
  uint32_t changedAt = 0;
  uint32_t downAt = 0;

  DialButtonEvent update(bool reading, uint32_t now) {
    if (reading != raw) {
      raw = reading;
      changedAt = now;
    }
    if (down != raw && uint32_t(now - changedAt) >= 30) {
      down = raw;
      if (down) {
        downAt = now;
        longFired = false;
      } else if (!longFired) {
        return DialButtonEvent::confirm;
      }
    }
    if (down && !longFired && uint32_t(now - downAt) >= 800) {
      longFired = true;
      return DialButtonEvent::erase;
    }
    return DialButtonEvent::none;
  }
};

// Dial 1: あ〜の (25). Dial 2: は〜ん (21).
// Both cursors and buttons are independent; no active dial is selected.
struct DualDialInput {
  RotaryEncoder encoders[2];
  DialButton buttons[2];
  uint8_t positions[2] = {0, 25};

  int8_t rotate(uint8_t index, bool a, bool b) {
    const int8_t turn = encoders[index].update(a, b);
    if (turn) {
      const uint8_t start = DIAL_GROUP_STARTS[index], count = DIAL_GROUP_COUNTS[index];
      positions[index] = start + (int(positions[index]) - start + turn + count) % count;
    }
    return turn;
  }

  bool pressed() const { return buttons[0].down || buttons[1].down; }
  uint8_t pressedMask() const { return (buttons[0].down ? 1 : 0) | (buttons[1].down ? 2 : 0); }
};
