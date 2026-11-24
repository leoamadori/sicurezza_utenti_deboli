import {
  CANONICAL_DOMAIN_ORDER,
  CANONICAL_RED_FLAG_ORDER,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
} from "../domain/rubric";
import type {
  AnonymousStatRecord,
  DevicePrefs,
  DomainId,
  EphemeralSession,
  RedFlagId,
  ScoreMap,
  StatScoreRecord,
} from "../domain/types";

export const ACTIVE_SESSION_KEY = "vru_active_session_v1";
export const ANONYMOUS_STATS_KEY = "vru_anonymous_stats_v1";
export const DEVICE_PREFS_KEY = "vru_device_prefs_v1";
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const DEFAULT_PREFS: DevicePrefs = {
  lastVehicleType: "B",
  themePreference: "light",
  lastStatsExportDate: null,
};

const memoryFallback = new Map<string, string>();
let storageAvailableFlag = true;

export function isStorageAvailable(): boolean {
  return storageAvailableFlag;
}

export function resetMemoryFallbackForTests(): void {
  memoryFallback.clear();
  storageAvailableFlag = true;
}

function readRaw(key: string): string | null {
  try {
    const val = window.localStorage.getItem(key);
    return val;
  } catch {
    storageAvailableFlag = false;
    return memoryFallback.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    storageAvailableFlag = false;
    memoryFallback.set(key, value);
    return false;
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    storageAvailableFlag = false;
  }
  memoryFallback.delete(key);
}

export function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function extractPeriodMonth(lessonDate: string, fallbackDate: Date = new Date()): string {
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(lessonDate)) {
    return lessonDate.slice(0, 7);
  }
  return formatLocalDate(fallbackDate).slice(0, 7);
}

export function generateUuidV4(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Set RFC 4122 version 4 and variant bits
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyScoreMap(): ScoreMap {
  return {
    dooring: null,
    lateral_distance: null,
    hazard_perception: null,
    adas: null,
    planning_rush: null,
    self_control: null,
  };
}

export function loadDevicePrefs(): DevicePrefs {
  const raw = readRaw(DEVICE_PREFS_KEY);
  if (!raw) {
    return { ...DEFAULT_PREFS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    const lastVehicleType =
      parsed.lastVehicleType === "B" ||
      parsed.lastVehicleType === "C_D" ||
      parsed.lastVehicleType === "ALTRO"
        ? parsed.lastVehicleType
        : DEFAULT_PREFS.lastVehicleType;
    const themePreference =
      parsed.themePreference === "dark" || parsed.themePreference === "light"
        ? parsed.themePreference
        : DEFAULT_PREFS.themePreference;
    const lastStatsExportDate =
      typeof parsed.lastStatsExportDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastStatsExportDate)
        ? parsed.lastStatsExportDate
        : null;
    return { lastVehicleType, themePreference, lastStatsExportDate };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveDevicePrefs(prefs: DevicePrefs): boolean {
  const clean: DevicePrefs = {
    lastVehicleType: prefs.lastVehicleType,
    themePreference: prefs.themePreference,
    lastStatsExportDate: prefs.lastStatsExportDate,
  };
  return writeRaw(DEVICE_PREFS_KEY, JSON.stringify(clean));
}

export function createEmptySession(
  prefs: DevicePrefs = loadDevicePrefs(),
  now: Date = new Date(),
): EphemeralSession {
  return {
    evaluationId: generateUuidV4(),
    fsmPhase: "INSTRUCTOR_EVAL",
    updatedAtMs: now.getTime(),
    lessonDate: formatLocalDate(now),
    vehicleType: prefs.lastVehicleType,
    weather: "sereno",
    light: "giorno",
    kmBucket: "10_20",
    adasAvailable: true,
    instructorScores: emptyScoreMap(),
    studentScores: emptyScoreMap(),
    redFlags: { RF01: null, RF02: null, RF03: null },
    finalOutcome: null,
  };
}

export function saveActiveSession(session: EphemeralSession): boolean {
  // Explicit allowlist projection: never persists studentLabel or unknown keys
  const sanitized: EphemeralSession = {
    evaluationId: session.evaluationId,
    fsmPhase: session.fsmPhase,
    updatedAtMs: session.updatedAtMs,
    lessonDate: session.lessonDate,
    vehicleType: session.vehicleType,
    weather: session.weather,
    light: session.light,
    kmBucket: session.kmBucket,
    adasAvailable: session.adasAvailable,
    instructorScores: {
      dooring: session.instructorScores.dooring,
      lateral_distance: session.instructorScores.lateral_distance,
      hazard_perception: session.instructorScores.hazard_perception,
      adas: session.instructorScores.adas,
      planning_rush: session.instructorScores.planning_rush,
      self_control: session.instructorScores.self_control,
    },
    studentScores: {
      dooring: session.studentScores.dooring,
      lateral_distance: session.studentScores.lateral_distance,
      hazard_perception: session.studentScores.hazard_perception,
      adas: session.studentScores.adas,
      planning_rush: session.studentScores.planning_rush,
      self_control: session.studentScores.self_control,
    },
    redFlags: {
      RF01: session.redFlags.RF01,
      RF02: session.redFlags.RF02,
      RF03: session.redFlags.RF03,
    },
    finalOutcome: session.finalOutcome,
  };
  return writeRaw(ACTIVE_SESSION_KEY, JSON.stringify(sanitized));
}

export function loadActiveSession(nowMs: number = Date.now()): EphemeralSession | null {
  const raw = readRaw(ACTIVE_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<EphemeralSession>;
    if (
      typeof parsed.evaluationId !== "string" ||
      typeof parsed.updatedAtMs !== "number" ||
      typeof parsed.fsmPhase !== "string" ||
      typeof parsed.lessonDate !== "string" ||
      typeof parsed.adasAvailable !== "boolean" ||
      !parsed.instructorScores ||
      !parsed.studentScores ||
      !parsed.redFlags
    ) {
      wipeActiveSession();
      return null;
    }

    if (nowMs - parsed.updatedAtMs > SESSION_TTL_MS || parsed.updatedAtMs > nowMs + 60_000) {
      wipeActiveSession();
      return null;
    }

    return parsed as EphemeralSession;
  } catch {
    wipeActiveSession();
    return null;
  }
}

export function wipeActiveSession(): void {
  removeRaw(ACTIVE_SESSION_KEY);
}

function projectScoresForStat(
  scores: ScoreMap,
  adasAvailable: boolean,
  roleLabel: string,
): StatScoreRecord {
  const check = (d: DomainId): number => {
    const v = scores[d];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) {
      throw new Error(`Punteggio ${roleLabel} mancante per "${d}".`);
    }
    return v;
  };

  return {
    dooring: check("dooring"),
    lateral_distance: check("lateral_distance"),
    hazard_perception: check("hazard_perception"),
    adas: adasAvailable ? check("adas") : null,
    planning_rush: check("planning_rush"),
    self_control: check("self_control"),
  };
}

export function toAnonymousStatRecord(session: EphemeralSession): AnonymousStatRecord {
  if (session.finalOutcome === null) {
    throw new Error("Impossibile registrare statistica senza finalOutcome definito.");
  }

  for (const rf of CANONICAL_RED_FLAG_ORDER) {
    if (typeof session.redFlags[rf] !== "boolean") {
      throw new Error(`Red Flag "${rf}" non confermata.`);
    }
  }

  return {
    evaluationId: session.evaluationId,
    schemaVersion: SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    periodMonth: extractPeriodMonth(session.lessonDate),
    vehicleType: session.vehicleType,
    weather: session.weather,
    light: session.light,
    kmBucket: session.kmBucket,
    adasAvailable: session.adasAvailable,
    instructorScores: projectScoresForStat(
      session.instructorScores,
      session.adasAvailable,
      "istruttore",
    ),
    studentScores: projectScoresForStat(
      session.studentScores,
      session.adasAvailable,
      "allievo",
    ),
    redFlags: {
      RF01: session.redFlags.RF01 as boolean,
      RF02: session.redFlags.RF02 as boolean,
      RF03: session.redFlags.RF03 as boolean,
    },
    finalOutcome: session.finalOutcome,
  };
}

function loadStatsMap(): Record<string, AnonymousStatRecord> {
  const raw = readRaw(ANONYMOUS_STATS_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, AnonymousStatRecord>;
  } catch {
    return {};
  }
}

export function commitAnonymousStat(record: AnonymousStatRecord): boolean {
  const map = loadStatsMap();
  map[record.evaluationId] = record;
  return writeRaw(ANONYMOUS_STATS_KEY, JSON.stringify(map));
}

export function getAllAnonymousStats(): AnonymousStatRecord[] {
  const map = loadStatsMap();
  return Object.values(map);
}

export function countAnonymousStats(): number {
  return Object.keys(loadStatsMap()).length;
}

export function clearAnonymousStats(): void {
  removeRaw(ANONYMOUS_STATS_KEY);
}

export function isExportReminderDue(
  recordCount: number,
  lastStatsExportDate: string | null,
  now: Date = new Date(),
): boolean {
  if (recordCount <= 0) {
    return false;
  }
  if (!lastStatsExportDate) {
    return true;
  }
  const parts = lastStatsExportDate.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) {
    return true;
  }
  const lastDate = new Date(year, month - 1, day);
  const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 5;
}

export function isDomainComplete(
  scores: ScoreMap,
  adasAvailable: boolean,
): boolean {
  for (const domainId of CANONICAL_DOMAIN_ORDER) {
    if (domainId === "adas" && !adasAvailable) {
      continue;
    }
    const v = scores[domainId];
    if (typeof v !== "number" || v < 1 || v > 5) {
      return false;
    }
  }
  return true;
}

export function areRedFlagsComplete(
  redFlags: Record<RedFlagId, boolean | null>,
): boolean {
  return CANONICAL_RED_FLAG_ORDER.every((rf) => typeof redFlags[rf] === "boolean");
}
