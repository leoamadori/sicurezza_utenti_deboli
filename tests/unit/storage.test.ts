import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SESSION_KEY,
  ANONYMOUS_STATS_KEY,
  clearAnonymousStats,
  commitAnonymousStat,
  countAnonymousStats,
  createEmptySession,
  DEVICE_PREFS_KEY,
  extractPeriodMonth,
  formatLocalDate,
  generateUuidV4,
  getAllAnonymousStats,
  isExportReminderDue,
  isStorageAvailable,
  loadActiveSession,
  loadDevicePrefs,
  resetMemoryFallbackForTests,
  saveActiveSession,
  saveDevicePrefs,
  SESSION_TTL_MS,
  toAnonymousStatRecord,
  wipeActiveSession,
} from "../../src/storage/storage";
import type { EphemeralSession } from "../../src/domain/types";

function completedSession(overrides: Partial<EphemeralSession> = {}): EphemeralSession {
  return {
    ...createEmptySession(undefined, new Date(2026, 10, 24, 10, 0, 0)),
    fsmPhase: "REVEAL_DEBRIEF",
    instructorScores: {
      dooring: 4,
      lateral_distance: 4,
      hazard_perception: 4,
      adas: 4,
      planning_rush: 4,
      self_control: 4,
    },
    studentScores: {
      dooring: 4,
      lateral_distance: 4,
      hazard_perception: 4,
      adas: 4,
      planning_rush: 4,
      self_control: 4,
    },
    redFlags: { RF01: false, RF02: false, RF03: false },
    finalOutcome: "IDONEO",
    ...overrides,
  };
}

describe("storage — unified localStorage (Store A, Store B, DevicePrefs)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMemoryFallbackForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats local dates without UTC drift and generates valid UUIDv4 including fallback", () => {
    const localDate = formatLocalDate(new Date(2026, 0, 5, 0, 15, 0));
    expect(localDate).toBe("2026-01-05");
    expect(extractPeriodMonth("2026-11-24")).toBe("2026-11");
    expect(extractPeriodMonth("bad-date", new Date(2026, 4, 10))).toBe("2026-05");

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(generateUuidV4())).toBe(true);

    // Test fallback when crypto.randomUUID is unavailable
    const origCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => origCrypto.getRandomValues(arr),
    });
    expect(uuidRegex.test(generateUuidV4())).toBe(true);
    vi.stubGlobal("crypto", origCrypto);
  });

  it("persists Store A without PII, enforces 2h TTL expiry, handles corrupt JSON, and wipes on reset", () => {
    const baseTime = 1_700_000_000_000;
    const session = completedSession({ updatedAtMs: baseTime });
    // Inject an accidental PII key at runtime and verify allowlist strips it
    const poisoned = Object.assign({}, session, { studentLabel: "Mario Rossi" });
    saveActiveSession(poisoned);

    const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY) ?? "";
    expect(raw).not.toContain("studentLabel");
    expect(raw).not.toContain("Mario Rossi");

    const loaded = loadActiveSession(baseTime + 10_000);
    expect(loaded?.evaluationId).toBe(session.evaluationId);

    // Expired (> 2h) -> automatically wiped
    expect(loadActiveSession(baseTime + SESSION_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();

    // Corrupt JSON -> wiped
    window.localStorage.setItem(ACTIVE_SESSION_KEY, "{broken");
    expect(loadActiveSession()).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();

    // Missing required fields -> wiped
    window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ evaluationId: "x" }));
    expect(loadActiveSession()).toBeNull();

    saveActiveSession(session);
    wipeActiveSession();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
  });

  it("commits Store B idempotently on evaluationId and updates finalOutcome without duplicates", () => {
    const session = completedSession({ finalOutcome: "MODULO_INTEGRATIVO" });
    const rec1 = toAnonymousStatRecord(session);
    commitAnonymousStat(rec1);
    expect(countAnonymousStats()).toBe(1);

    // Outcome change before reset overwrites same evaluationId
    const rec2 = toAnonymousStatRecord({ ...session, finalOutcome: "NON_IDONEO" });
    commitAnonymousStat(rec2);
    expect(countAnonymousStats()).toBe(1);
    expect(getAllAnonymousStats()[0]?.finalOutcome).toBe("NON_IDONEO");

    // ADAS N/A serializes null
    const noAdas = completedSession({
      evaluationId: "22222222-2222-4222-8222-222222222222",
      adasAvailable: false,
      instructorScores: {
        dooring: 4,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: null,
        planning_rush: 4,
        self_control: 4,
      },
      studentScores: {
        dooring: 4,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: null,
        planning_rush: 4,
        self_control: 4,
      },
    });
    commitAnonymousStat(toAnonymousStatRecord(noAdas));
    expect(countAnonymousStats()).toBe(2);
    const savedNoAdas = getAllAnonymousStats().find(
      (r) => r.evaluationId === noAdas.evaluationId,
    );
    expect(savedNoAdas?.instructorScores.adas).toBeNull();
    expect(savedNoAdas?.studentScores.adas).toBeNull();

    clearAnonymousStats();
    expect(countAnonymousStats()).toBe(0);
  });

  it("throws when projecting incomplete sessions to AnonymousStatRecord", () => {
    expect(() =>
      toAnonymousStatRecord(completedSession({ finalOutcome: null })),
    ).toThrow(/finalOutcome/);
    expect(() =>
      toAnonymousStatRecord(
        completedSession({ redFlags: { RF01: null, RF02: false, RF03: false } }),
      ),
    ).toThrow(/Red Flag/);
    expect(() =>
      toAnonymousStatRecord(
        completedSession({
          instructorScores: {
            dooring: null,
            lateral_distance: 4,
            hazard_perception: 4,
            adas: 4,
            planning_rush: 4,
            self_control: 4,
          },
        }),
      ),
    ).toThrow(/istruttore/);
  });

  it("persists DevicePrefs with lastStatsExportDate and computes 5-day export reminder", () => {
    expect(loadDevicePrefs()).toEqual({
      lastVehicleType: "B",
      themePreference: "light",
      lastStatsExportDate: null,
    });

    saveDevicePrefs({
      lastVehicleType: "C_D",
      themePreference: "dark",
      lastStatsExportDate: "2026-11-18",
    });
    expect(loadDevicePrefs()).toEqual({
      lastVehicleType: "C_D",
      themePreference: "dark",
      lastStatsExportDate: "2026-11-18",
    });

    // Corrupt prefs fall back to defaults
    window.localStorage.setItem(DEVICE_PREFS_KEY, "not-json");
    expect(loadDevicePrefs().lastVehicleType).toBe("B");

    // Reminder logic
    expect(isExportReminderDue(0, null, new Date(2026, 10, 24))).toBe(false);
    expect(isExportReminderDue(2, null, new Date(2026, 10, 24))).toBe(true);
    expect(isExportReminderDue(2, "2026-11-22", new Date(2026, 10, 24))).toBe(false);
    expect(isExportReminderDue(2, "2026-11-18", new Date(2026, 10, 24))).toBe(true);
  });

  it("degrades cleanly to memory fallback when localStorage throws QuotaExceededError", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const throwingStorage: Storage = {
      length: 0,
      clear() {
        throw new DOMException("SecurityError", "SecurityError");
      },
      getItem() {
        throw new DOMException("SecurityError", "SecurityError");
      },
      key() {
        return null;
      },
      removeItem() {
        throw new DOMException("SecurityError", "SecurityError");
      },
      setItem() {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      },
    };

    Object.defineProperty(window, "localStorage", {
      value: throwingStorage,
      configurable: true,
      writable: true,
    });

    try {
      const session = completedSession();
      const ok = saveActiveSession(session);
      expect(ok).toBe(false);
      expect(isStorageAvailable()).toBe(false);
      expect(loadActiveSession(session.updatedAtMs + 1000)?.evaluationId).toBe(
        session.evaluationId,
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "localStorage", originalDescriptor);
      }
    }

    // Corrupt stats store handled gracefully
    window.localStorage.setItem(ANONYMOUS_STATS_KEY, "[]");
    expect(getAllAnonymousStats()).toEqual([]);
  });
});
