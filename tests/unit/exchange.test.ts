import { describe, expect, it } from "vitest";
import {
  buildStatsEnvelope,
  computeCoordinatorSummary,
  CSV_COLUMNS,
  formatCsvCell,
  mergeAndDeduplicateRecords,
  parseAndValidateEnvelope,
  serializeRecordsToCsv,
} from "../../src/coordinator/exchange";
import type { AnonymousStatRecord } from "../../src/domain/types";

function makeStat(
  overrides: Partial<AnonymousStatRecord> = {},
): AnonymousStatRecord {
  return {
    evaluationId: "11111111-1111-4111-8111-111111111111",
    schemaVersion: 1,
    rubricVersion: "vru-gde-v1",
    periodMonth: "2026-11",
    vehicleType: "B",
    weather: "sereno",
    light: "giorno",
    kmBucket: "10_20",
    adasAvailable: true,
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

describe("coordinator exchange — strict allowlist JSON parsing & sorting", () => {
  it("builds envelope sorted by evaluationId and parses cleanly", () => {
    const r2 = makeStat({ evaluationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const r1 = makeStat({ evaluationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const env = buildStatsEnvelope([r2, r1], "2026-11");

    expect(env.records.map((r) => r.evaluationId)).toEqual([
      r1.evaluationId,
      r2.evaluationId,
    ]);
    const parsed = parseAndValidateEnvelope(JSON.stringify(env));
    expect(parsed.rejectedCount).toBe(0);
    expect(parsed.errors).toEqual([]);
    expect(parsed.validRecords).toHaveLength(2);
  });

  it("rejects malformed JSON, wrong envelopeVersion, unknown/PII keys, invalid UUID/month/enums, and ADAS mismatch", () => {
    expect(parseAndValidateEnvelope("{not-json").rejectedCount).toBe(1);

    const badRoot = parseAndValidateEnvelope(
      JSON.stringify({ envelopeVersion: 2, exportedAtMonth: "2026-11", recordCount: 0, records: [] }),
    );
    expect(badRoot.rejectedCount).toBe(1);

    const badMonth = parseAndValidateEnvelope(
      JSON.stringify({ envelopeVersion: 1, exportedAtMonth: "2026-13", recordCount: 0, records: [] }),
    );
    expect(badMonth.rejectedCount).toBe(1);

    const badCount = parseAndValidateEnvelope(
      JSON.stringify({ envelopeVersion: 1, exportedAtMonth: "2026-11", recordCount: 2, records: [] }),
    );
    expect(badCount.rejectedCount).toBe(1);

    const validRec = makeStat();
    const withPii = { ...validRec, studentLabel: "Mario Rossi" };
    const badAdasNullMismatch = makeStat({
      evaluationId: "22222222-2222-4222-8222-222222222222",
      adasAvailable: false,
      instructorScores: {
        dooring: 4,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: 3, // invalid when adasAvailable is false
        planning_rush: 4,
        self_control: 4,
      },
    });
    const badRubric = {
      ...makeStat({ evaluationId: "33333333-3333-4333-8333-333333333333" }),
      rubricVersion: "vru-gde-v2",
    };
    const badUuid = { ...makeStat(), evaluationId: "not-a-uuid" };
    const badSchema = { ...makeStat({ evaluationId: "44444444-4444-4444-8444-444444444444" }), schemaVersion: 2 };
    const badEnums = { ...makeStat({ evaluationId: "55555555-5555-4555-8555-555555555555" }), vehicleType: "MOTO" };
    const badRf = {
      ...makeStat({ evaluationId: "66666666-6666-4666-8666-666666666666" }),
      redFlags: { RF01: "yes", RF02: false, RF03: false },
    };
    const badScore = {
      ...makeStat({ evaluationId: "77777777-7777-4777-8777-777777777777" }),
      instructorScores: { dooring: 6, lateral_distance: 4, hazard_perception: 4, adas: 4, planning_rush: 4, self_control: 4 },
    };

    const mixedEnvelope = {
      envelopeVersion: 1,
      exportedAtMonth: "2026-11",
      recordCount: 9,
      records: [
        validRec,
        withPii,
        badAdasNullMismatch,
        badRubric,
        badUuid,
        badSchema,
        badEnums,
        badRf,
        badScore,
      ],
    };

    const result = parseAndValidateEnvelope(JSON.stringify(mixedEnvelope));
    expect(result.validRecords).toHaveLength(1);
    expect(result.rejectedCount).toBe(8);
    expect(result.errors).toHaveLength(8);
  });
});

describe("coordinator exchange — deduplication, group summary & CSV", () => {
  it("deduplicates records with deterministic first-wins policy", () => {
    const first = makeStat({ finalOutcome: "MODULO_INTEGRATIVO" });
    const duplicate = makeStat({ finalOutcome: "NON_IDONEO" });
    const second = makeStat({
      evaluationId: "22222222-2222-4222-8222-222222222222",
    });

    const { merged, duplicatesRemoved } = mergeAndDeduplicateRecords([
      [first],
      [duplicate, second],
    ]);
    expect(duplicatesRemoved).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.finalOutcome).toBe("MODULO_INTEGRATIVO");
  });

  it("computes group summary excluding null ADAS from denominator and handles empty/zero ADAS cleanly", () => {
    const empty = computeCoordinatorSummary([]);
    expect(empty.totalEvaluations).toBe(0);
    expect(empty.lowSampleWarning).toBe(false);
    expect(empty.domainAverages.dooring.instructorMean).toBeNull();
    expect(empty.domainAverages.adas.instructorMean).toBeNull();

    const r1 = makeStat({
      evaluationId: "11111111-1111-4111-8111-111111111111",
      periodMonth: "2026-10",
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
        dooring: 5,
        lateral_distance: 5,
        hazard_perception: 5,
        adas: null,
        planning_rush: 4,
        self_control: 4,
      },
      redFlags: { RF01: true, RF02: false, RF03: false },
      finalOutcome: "NON_IDONEO",
    });

    const summaryOnlyNoAdas = computeCoordinatorSummary([r1]);
    expect(summaryOnlyNoAdas.lowSampleWarning).toBe(true);
    expect(summaryOnlyNoAdas.adasSampleCount).toBe(0);
    expect(summaryOnlyNoAdas.domainAverages.adas.instructorMean).toBeNull();
    expect(summaryOnlyNoAdas.criticalOverconfidenceCount).toBe(1);
    expect(summaryOnlyNoAdas.redFlagCounts.RF01).toBe(1);

    const r2 = makeStat({
      evaluationId: "22222222-2222-4222-8222-222222222222",
      periodMonth: "2026-11",
      adasAvailable: true,
      instructorScores: {
        dooring: 2,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: 5,
        planning_rush: 4,
        self_control: 4,
      },
      studentScores: {
        dooring: 2,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: 3,
        planning_rush: 4,
        self_control: 4,
      },
      finalOutcome: "MODULO_INTEGRATIVO",
    });

    const r3 = makeStat({
      evaluationId: "33333333-3333-4333-8333-333333333333",
      periodMonth: "2026-11",
      redFlags: { RF01: false, RF02: true, RF03: false },
      finalOutcome: "IDONEO",
    });

    const combined = computeCoordinatorSummary([r1, r2, r3]);
    expect(combined.adasSampleCount).toBe(2);
    expect(combined.domainAverages.adas.instructorMean).toBe(4.5);
    expect(combined.domainAverages.adas.studentMean).toBe(3.5);
    expect(combined.monthlyBreakdown).toHaveLength(2);
    expect(combined.monthlyBreakdown[0]?.periodMonth).toBe("2026-10");
    expect(combined.monthlyBreakdown[1]?.count).toBe(2);
    expect(combined.monthlyBreakdown[1]?.idoneoCount).toBe(1);
    expect(combined.monthlyBreakdown[1]?.redFlagSessionCount).toBe(1);
  });

  it("serializes 28 canonical CSV columns with UTF-8 BOM, ';', CRLF, empty null ADAS, intact negative numbers, and string-only formula neutralization", () => {
    // Neutralize strings starting with formula triggers, preserve negative finite numbers
    expect(formatCsvCell(-4)).toBe("-4");
    expect(formatCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(formatCsvCell("+cmd")).toBe("'+cmd");
    expect(formatCsvCell("-evil")).toBe("'-evil");
    expect(formatCsvCell("@macro")).toBe("'@macro");
    expect(formatCsvCell('a;b"c')).toBe('"a;b""c"');
    expect(formatCsvCell(null)).toBe("");
    expect(formatCsvCell(true)).toBe("true");
    expect(formatCsvCell(false)).toBe("false");

    const rec = makeStat({
      adasAvailable: false,
      instructorScores: {
        dooring: 5,
        lateral_distance: 5,
        hazard_perception: 5,
        adas: null,
        planning_rush: 5,
        self_control: 5,
      },
      studentScores: {
        dooring: 4,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: null,
        planning_rush: 5,
        self_control: 5,
      },
    });

    const csv = serializeRecordsToCsv([rec]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(CSV_COLUMNS.join(";"));
    const dataLine = lines[1] ?? "";
    const cols = dataLine.split(";");
    expect(cols).toHaveLength(28);
    expect(cols[12]).toBe(""); // i_adas null -> empty cell
    expect(cols[18]).toBe(""); // a_adas null -> empty cell
    expect(cols[21]).toBe("25"); // totalI
    expect(cols[22]).toBe("22"); // totalA
    expect(cols[23]).toBe("-3"); // negative number preserved (NOT '-3)
  });
});
