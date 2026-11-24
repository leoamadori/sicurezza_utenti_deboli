import {
  CANONICAL_DOMAIN_ORDER,
  CANONICAL_RED_FLAG_ORDER,
  ENVELOPE_VERSION,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
} from "../domain/rubric";
import { computeMetricsFromScores } from "../domain/scoring";
import type {
  AnonymousStatRecord,
  CoordinatorDomainAverage,
  CoordinatorMonthlyRow,
  CoordinatorSummary,
  DomainId,
  EnvelopeParseResult,
  FinalOutcome,
  KmBucket,
  LightType,
  MergeResult,
  RedFlagId,
  StatScoreRecord,
  StatsEnvelope,
  VehicleType,
  WeatherType,
} from "../domain/types";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const ALLOWED_ENVELOPE_KEYS = new Set([
  "envelopeVersion",
  "exportedAtMonth",
  "recordCount",
  "records",
]);

const ALLOWED_RECORD_KEYS = new Set([
  "evaluationId",
  "schemaVersion",
  "rubricVersion",
  "periodMonth",
  "vehicleType",
  "weather",
  "light",
  "kmBucket",
  "adasAvailable",
  "instructorScores",
  "studentScores",
  "redFlags",
  "finalOutcome",
]);

const ALLOWED_DOMAIN_KEYS = new Set<string>(CANONICAL_DOMAIN_ORDER);
const ALLOWED_RF_KEYS = new Set<string>(CANONICAL_RED_FLAG_ORDER);

const VALID_VEHICLES = new Set<VehicleType>(["B", "C_D", "ALTRO"]);
const VALID_WEATHERS = new Set<WeatherType>(["sereno", "pioggia"]);
const VALID_LIGHTS = new Set<LightType>(["giorno", "buio"]);
const VALID_KM_BUCKETS = new Set<KmBucket>(["lt_10", "10_20", "gt_20"]);
const VALID_OUTCOMES = new Set<FinalOutcome>([
  "IDONEO",
  "MODULO_INTEGRATIVO",
  "NON_IDONEO",
]);

export const MAX_IMPORT_FILES = 50;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 10_000;

export const CSV_COLUMNS = [
  "evaluationId",
  "schemaVersion",
  "rubricVersion",
  "periodMonth",
  "vehicleType",
  "weather",
  "light",
  "kmBucket",
  "adasAvailable",
  "i_dooring",
  "i_lateral_distance",
  "i_hazard_perception",
  "i_adas",
  "i_planning_rush",
  "i_self_control",
  "a_dooring",
  "a_lateral_distance",
  "a_hazard_perception",
  "a_adas",
  "a_planning_rush",
  "a_self_control",
  "totalI",
  "totalA",
  "overconfidenceDelta",
  "rf01",
  "rf02",
  "rf03",
  "finalOutcome",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.size) {
    return false;
  }
  return keys.every((k) => allowed.has(k));
}

function isIntScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function validateScoreBlock(
  raw: unknown,
  adasAvailable: boolean,
): StatScoreRecord | null {
  if (!isPlainObject(raw) || !hasExactKeys(raw, ALLOWED_DOMAIN_KEYS)) {
    return null;
  }

  for (const domainId of CANONICAL_DOMAIN_ORDER) {
    const val = raw[domainId];
    if (domainId === "adas" && !adasAvailable) {
      if (val !== null) {
        return null;
      }
    } else if (!isIntScore(val)) {
      return null;
    }
  }

  return {
    dooring: raw.dooring as number,
    lateral_distance: raw.lateral_distance as number,
    hazard_perception: raw.hazard_perception as number,
    adas: adasAvailable ? (raw.adas as number) : null,
    planning_rush: raw.planning_rush as number,
    self_control: raw.self_control as number,
  };
}

function validateRedFlagsBlock(
  raw: unknown,
): Record<RedFlagId, boolean> | null {
  if (!isPlainObject(raw) || !hasExactKeys(raw, ALLOWED_RF_KEYS)) {
    return null;
  }
  if (
    typeof raw.RF01 !== "boolean" ||
    typeof raw.RF02 !== "boolean" ||
    typeof raw.RF03 !== "boolean"
  ) {
    return null;
  }
  return {
    RF01: raw.RF01,
    RF02: raw.RF02,
    RF03: raw.RF03,
  };
}

function validateStatRecord(raw: unknown): AnonymousStatRecord | null {
  if (!isPlainObject(raw) || !hasExactKeys(raw, ALLOWED_RECORD_KEYS)) {
    return null;
  }

  if (typeof raw.evaluationId !== "string" || !UUID_V4_REGEX.test(raw.evaluationId)) {
    return null;
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return null;
  }
  if (raw.rubricVersion !== RUBRIC_VERSION) {
    return null;
  }
  if (typeof raw.periodMonth !== "string" || !PERIOD_MONTH_REGEX.test(raw.periodMonth)) {
    return null;
  }
  if (typeof raw.vehicleType !== "string" || !VALID_VEHICLES.has(raw.vehicleType as VehicleType)) {
    return null;
  }
  if (typeof raw.weather !== "string" || !VALID_WEATHERS.has(raw.weather as WeatherType)) {
    return null;
  }
  if (typeof raw.light !== "string" || !VALID_LIGHTS.has(raw.light as LightType)) {
    return null;
  }
  if (typeof raw.kmBucket !== "string" || !VALID_KM_BUCKETS.has(raw.kmBucket as KmBucket)) {
    return null;
  }
  if (typeof raw.adasAvailable !== "boolean") {
    return null;
  }
  if (typeof raw.finalOutcome !== "string" || !VALID_OUTCOMES.has(raw.finalOutcome as FinalOutcome)) {
    return null;
  }

  const instructorScores = validateScoreBlock(raw.instructorScores, raw.adasAvailable);
  const studentScores = validateScoreBlock(raw.studentScores, raw.adasAvailable);
  const redFlags = validateRedFlagsBlock(raw.redFlags);

  if (!instructorScores || !studentScores || !redFlags) {
    return null;
  }

  return {
    evaluationId: raw.evaluationId,
    schemaVersion: SCHEMA_VERSION,
    rubricVersion: RUBRIC_VERSION,
    periodMonth: raw.periodMonth,
    vehicleType: raw.vehicleType as VehicleType,
    weather: raw.weather as WeatherType,
    light: raw.light as LightType,
    kmBucket: raw.kmBucket as KmBucket,
    adasAvailable: raw.adasAvailable,
    instructorScores,
    studentScores,
    redFlags,
    finalOutcome: raw.finalOutcome as FinalOutcome,
  };
}

export function buildStatsEnvelope(
  records: readonly AnonymousStatRecord[],
  exportedAtMonth: string,
): StatsEnvelope {
  const sorted = [...records].sort((a, b) =>
    a.evaluationId.localeCompare(b.evaluationId),
  );
  return {
    envelopeVersion: ENVELOPE_VERSION,
    exportedAtMonth,
    recordCount: sorted.length,
    records: sorted,
  };
}

export function parseAndValidateEnvelope(rawText: string): EnvelopeParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      validRecords: [],
      rejectedCount: 1,
      errors: ["JSON non valido o malformato."],
    };
  }

  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ALLOWED_ENVELOPE_KEYS)) {
    return {
      validRecords: [],
      rejectedCount: 1,
      errors: ["Struttura envelope non conforme allo schema consentito."],
    };
  }

  if (parsed.envelopeVersion !== ENVELOPE_VERSION) {
    return {
      validRecords: [],
      rejectedCount: 1,
      errors: [`Versione envelope non supportata: ${String(parsed.envelopeVersion)}.`],
    };
  }

  if (
    typeof parsed.exportedAtMonth !== "string" ||
    !PERIOD_MONTH_REGEX.test(parsed.exportedAtMonth)
  ) {
    return {
      validRecords: [],
      rejectedCount: 1,
      errors: ["Campo exportedAtMonth non valido (atteso YYYY-MM)."],
    };
  }

  if (
    !Array.isArray(parsed.records) ||
    typeof parsed.recordCount !== "number" ||
    parsed.recordCount !== parsed.records.length
  ) {
    return {
      validRecords: [],
      rejectedCount: 1,
      errors: ["Elenco records mancante o incoerente con recordCount."],
    };
  }

  const validRecords: AnonymousStatRecord[] = [];
  const errors: string[] = [];
  let rejectedCount = 0;

  parsed.records.forEach((entry, index) => {
    const validated = validateStatRecord(entry);
    if (validated) {
      validRecords.push(validated);
    } else {
      rejectedCount += 1;
      errors.push(
        `Record #${index + 1} scartato: schema, versione rubrica o campi non conformi all'allowlist.`,
      );
    }
  });

  return { validRecords, rejectedCount, errors };
}

export function mergeAndDeduplicateRecords(
  recordLists: readonly (readonly AnonymousStatRecord[])[],
): MergeResult {
  const byId = new Map<string, AnonymousStatRecord>();
  let duplicatesRemoved = 0;

  for (const list of recordLists) {
    for (const rec of list) {
      if (byId.has(rec.evaluationId)) {
        duplicatesRemoved += 1;
      } else {
        byId.set(rec.evaluationId, rec);
      }
    }
  }

  return {
    merged: Array.from(byId.values()),
    duplicatesRemoved,
  };
}

export function computeCoordinatorSummary(
  records: readonly AnonymousStatRecord[],
): CoordinatorSummary {
  const totalEvaluations = records.length;
  const outcomeCounts: Record<FinalOutcome, number> = {
    IDONEO: 0,
    MODULO_INTEGRATIVO: 0,
    NON_IDONEO: 0,
  };
  const redFlagCounts: Record<RedFlagId, number> = {
    RF01: 0,
    RF02: 0,
    RF03: 0,
  };

  const sumI: Record<DomainId, number> = {
    dooring: 0,
    lateral_distance: 0,
    hazard_perception: 0,
    adas: 0,
    planning_rush: 0,
    self_control: 0,
  };
  const sumA: Record<DomainId, number> = {
    dooring: 0,
    lateral_distance: 0,
    hazard_perception: 0,
    adas: 0,
    planning_rush: 0,
    self_control: 0,
  };

  let criticalOverconfidenceCount = 0;
  let adasSampleCount = 0;

  const monthlyMap = new Map<string, CoordinatorMonthlyRow>();

  for (const rec of records) {
    outcomeCounts[rec.finalOutcome] += 1;

    let hasAnyRf = false;
    for (const rfId of CANONICAL_RED_FLAG_ORDER) {
      if (rec.redFlags[rfId]) {
        redFlagCounts[rfId] += 1;
        hasAnyRf = true;
      }
    }

    const metrics = computeMetricsFromScores(
      rec.adasAvailable,
      rec.instructorScores,
      rec.studentScores,
    );
    if (metrics.isOverconfidenceCritical) {
      criticalOverconfidenceCount += 1;
    }

    for (const domainId of CANONICAL_DOMAIN_ORDER) {
      if (domainId === "adas") {
        if (rec.adasAvailable && rec.instructorScores.adas !== null && rec.studentScores.adas !== null) {
          sumI.adas += rec.instructorScores.adas;
          sumA.adas += rec.studentScores.adas;
          adasSampleCount += 1;
        }
      } else {
        sumI[domainId] += rec.instructorScores[domainId];
        sumA[domainId] += rec.studentScores[domainId];
      }
    }

    const existingMonth = monthlyMap.get(rec.periodMonth);
    if (existingMonth) {
      existingMonth.count += 1;
      if (rec.finalOutcome === "IDONEO") {
        existingMonth.idoneoCount += 1;
      }
      if (hasAnyRf) {
        existingMonth.redFlagSessionCount += 1;
      }
    } else {
      monthlyMap.set(rec.periodMonth, {
        periodMonth: rec.periodMonth,
        count: 1,
        idoneoCount: rec.finalOutcome === "IDONEO" ? 1 : 0,
        redFlagSessionCount: hasAnyRf ? 1 : 0,
      });
    }
  }

  const domainAverages = {} as Record<DomainId, CoordinatorDomainAverage>;
  for (const domainId of CANONICAL_DOMAIN_ORDER) {
    const denom = domainId === "adas" ? adasSampleCount : totalEvaluations;
    domainAverages[domainId] =
      denom === 0
        ? { instructorMean: null, studentMean: null }
        : {
            instructorMean: Number((sumI[domainId] / denom).toFixed(2)),
            studentMean: Number((sumA[domainId] / denom).toFixed(2)),
          };
  }

  const monthlyBreakdown = Array.from(monthlyMap.values()).sort((a, b) =>
    a.periodMonth.localeCompare(b.periodMonth),
  );

  return {
    totalEvaluations,
    lowSampleWarning: totalEvaluations > 0 && totalEvaluations < 5,
    outcomeCounts,
    criticalOverconfidenceCount,
    criticalOverconfidenceRate:
      totalEvaluations === 0
        ? 0
        : Number((criticalOverconfidenceCount / totalEvaluations).toFixed(4)),
    redFlagCounts,
    adasSampleCount,
    domainAverages,
    monthlyBreakdown,
  };
}

export function formatCsvCell(value: string | number | boolean | null): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  // Neutralize formula prefixes exclusively on string values
  let safe = value;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `'${safe}`;
  }

  if (/[;"\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function serializeRecordsToCsv(
  records: readonly AnonymousStatRecord[],
): string {
  const rows: string[] = [CSV_COLUMNS.join(";")];

  for (const rec of records) {
    const metrics = computeMetricsFromScores(
      rec.adasAvailable,
      rec.instructorScores,
      rec.studentScores,
    );

    const cells: Array<string | number | boolean | null> = [
      rec.evaluationId,
      rec.schemaVersion,
      rec.rubricVersion,
      rec.periodMonth,
      rec.vehicleType,
      rec.weather,
      rec.light,
      rec.kmBucket,
      rec.adasAvailable,
      rec.instructorScores.dooring,
      rec.instructorScores.lateral_distance,
      rec.instructorScores.hazard_perception,
      rec.instructorScores.adas,
      rec.instructorScores.planning_rush,
      rec.instructorScores.self_control,
      rec.studentScores.dooring,
      rec.studentScores.lateral_distance,
      rec.studentScores.hazard_perception,
      rec.studentScores.adas,
      rec.studentScores.planning_rush,
      rec.studentScores.self_control,
      metrics.totalI,
      metrics.totalA,
      metrics.overconfidenceDelta,
      rec.redFlags.RF01,
      rec.redFlags.RF02,
      rec.redFlags.RF03,
      rec.finalOutcome,
    ];

    rows.push(cells.map(formatCsvCell).join(";"));
  }

  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
