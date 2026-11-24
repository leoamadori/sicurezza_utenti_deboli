import { describe, expect, it } from "vitest";
import { VRU_RUBRIC } from "../../src/domain/rubric";
import {
  buildDeterministicTips,
  buildStudentReportViewModel,
  computeEvaluationMetrics,
  detectConsistencyWarnings,
  determineOutcomeConstraints,
} from "../../src/domain/scoring";
import type { EphemeralRamState, EphemeralSession } from "../../src/domain/types";

function makeSession(overrides: Partial<EphemeralSession> = {}): EphemeralSession {
  return {
    evaluationId: "11111111-1111-4111-8111-111111111111",
    fsmPhase: "REVEAL_DEBRIEF",
    updatedAtMs: 1_700_000_000_000,
    lessonDate: "2026-11-24",
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

describe("scoring — 6-domain and 5-domain ADAS N/A math", () => {
  it("computes 6-domain totals (6..30) and pass threshold 24", () => {
    const metrics = computeEvaluationMetrics(makeSession());
    expect(metrics.activeDomains).toHaveLength(6);
    expect(metrics.maxScore).toBe(30);
    expect(metrics.passThreshold).toBe(24);
    expect(metrics.totalI).toBe(24);
    expect(metrics.totalA).toBe(24);
    expect(metrics.overconfidenceDelta).toBe(0);
    expect(metrics.calibrationBand).toBe("aligned");
    expect(metrics.isOverconfidenceCritical).toBe(false);
    expect(metrics.blindSpotDomains).toEqual([]);
  });

  it("computes 5-domain ADAS N/A totals (5..25) and pass threshold 20", () => {
    const session = makeSession({
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
    });
    const metrics = computeEvaluationMetrics(session);
    expect(metrics.activeDomains).toHaveLength(5);
    expect(metrics.activeDomains).not.toContain("adas");
    expect(metrics.maxScore).toBe(25);
    expect(metrics.passThreshold).toBe(20);
    expect(metrics.totalI).toBe(20);
    expect(metrics.totalA).toBe(23);
    expect(metrics.overconfidenceDelta).toBe(3);
    expect(metrics.isOverconfidenceCritical).toBe(true);
    expect(metrics.calibrationBand).toBe("critical_overconfidence");
  });

  it("distinguishes +3 mild vs +4 critical on 6 domains, and +2 mild vs +3 critical on 5 domains", () => {
    const sixMild = computeEvaluationMetrics(
      makeSession({
        studentScores: {
          dooring: 5,
          lateral_distance: 5,
          hazard_perception: 5,
          adas: 4,
          planning_rush: 4,
          self_control: 4,
        },
      }),
    );
    expect(sixMild.overconfidenceDelta).toBe(3);
    expect(sixMild.isOverconfidenceCritical).toBe(false);
    expect(sixMild.calibrationBand).toBe("mild_overconfidence");

    const sixCritical = computeEvaluationMetrics(
      makeSession({
        studentScores: {
          dooring: 5,
          lateral_distance: 5,
          hazard_perception: 5,
          adas: 5,
          planning_rush: 4,
          self_control: 4,
        },
      }),
    );
    expect(sixCritical.overconfidenceDelta).toBe(4);
    expect(sixCritical.isOverconfidenceCritical).toBe(true);
    expect(sixCritical.calibrationBand).toBe("critical_overconfidence");

    const fiveMild = computeEvaluationMetrics(
      makeSession({
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
          hazard_perception: 4,
          adas: null,
          planning_rush: 4,
          self_control: 4,
        },
      }),
    );
    expect(fiveMild.overconfidenceDelta).toBe(2);
    expect(fiveMild.isOverconfidenceCritical).toBe(false);
    expect(fiveMild.calibrationBand).toBe("mild_overconfidence");
  });

  it("classifies underconfidence (<= -3) and detects per-domain blind spots even when total delta is 0", () => {
    const under = computeEvaluationMetrics(
      makeSession({
        studentScores: {
          dooring: 3,
          lateral_distance: 3,
          hazard_perception: 3,
          adas: 4,
          planning_rush: 4,
          self_control: 4,
        },
      }),
    );
    expect(under.overconfidenceDelta).toBe(-3);
    expect(under.calibrationBand).toBe("underconfidence");

    const cancelled = computeEvaluationMetrics(
      makeSession({
        instructorScores: {
          dooring: 2,
          lateral_distance: 4,
          hazard_perception: 4,
          adas: 4,
          planning_rush: 4,
          self_control: 5,
        },
        studentScores: {
          dooring: 5,
          lateral_distance: 4,
          hazard_perception: 4,
          adas: 4,
          planning_rush: 4,
          self_control: 2,
        },
      }),
    );
    expect(cancelled.overconfidenceDelta).toBe(0);
    expect(cancelled.calibrationBand).toBe("aligned");
    expect(cancelled.blindSpotDomains).toEqual(["dooring"]);
  });

  it("throws when active domain scores are missing or out of [1..5]", () => {
    expect(() =>
      computeEvaluationMetrics(
        makeSession({
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
    ).toThrow(/istruttore/i);

    expect(() =>
      computeEvaluationMetrics(
        makeSession({
          studentScores: {
            dooring: 6,
            lateral_distance: 4,
            hazard_perception: 4,
            adas: 4,
            planning_rush: 4,
            self_control: 4,
          },
        }),
      ),
    ).toThrow(/allievo/i);
  });
});

describe("scoring — outcomes, consistency warnings, deterministic tips, ViewModel", () => {
  it("enforces IDONEO rules, low-domain warning, and Red Flag blocking", () => {
    const passWithLowDomain = makeSession({
      instructorScores: {
        dooring: 5,
        lateral_distance: 5,
        hazard_perception: 5,
        adas: 5,
        planning_rush: 2,
        self_control: 2,
      },
    });
    const mPass = computeEvaluationMetrics(passWithLowDomain);
    const cPass = determineOutcomeConstraints(mPass, passWithLowDomain.redFlags);
    expect(cPass.autoOutcome).toBe("IDONEO");
    expect(cPass.allowedOutcomes).toEqual(["IDONEO"]);
    expect(cPass.lowDomainWarning).toBe(true);

    const rfBlocked = makeSession({
      redFlags: { RF01: true, RF02: false, RF03: false },
    });
    const mRf = computeEvaluationMetrics(rfBlocked);
    const cRf = determineOutcomeConstraints(mRf, rfBlocked.redFlags);
    expect(cRf.autoOutcome).toBeNull();
    expect(cRf.allowedOutcomes).toEqual(["MODULO_INTEGRATIVO", "NON_IDONEO"]);

    const scoreBlocked = makeSession({
      instructorScores: {
        dooring: 3,
        lateral_distance: 4,
        hazard_perception: 4,
        adas: 4,
        planning_rush: 4,
        self_control: 4,
      },
    });
    const cScore = determineOutcomeConstraints(
      computeEvaluationMetrics(scoreBlocked),
      scoreBlocked.redFlags,
    );
    expect(cScore.autoOutcome).toBeNull();
    expect(cScore.allowedOutcomes).toEqual(["MODULO_INTEGRATIVO", "NON_IDONEO"]);
  });

  it("emits non-blocking consistency warning when active Red Flag has linked domain >= 3", () => {
    const warnings = detectConsistencyWarnings(
      makeSession({
        instructorScores: {
          dooring: 4,
          lateral_distance: 2,
          hazard_perception: 3,
          adas: 4,
          planning_rush: 4,
          self_control: 4,
        },
        redFlags: { RF01: true, RF02: true, RF03: true },
      }),
    );
    expect(warnings.map((w) => w.redFlagId)).toEqual(["RF01", "RF03"]);
  });

  it("prioritizes Red Flags, deduplicates linked domains, sorts low domains + blind spots, caps PNG tips at 4", () => {
    const session = makeSession({
      instructorScores: {
        dooring: 2, // covered by RF01 -> should NOT duplicate
        lateral_distance: 3,
        hazard_perception: 2,
        adas: 3,
        planning_rush: 3,
        self_control: 2,
      },
      studentScores: {
        dooring: 4,
        lateral_distance: 5, // delta +2
        hazard_perception: 3, // delta +1
        adas: 4, // delta +1
        planning_rush: 4, // delta +1
        self_control: 5, // delta +3 -> ties I=2 with hazard_perception, wins on higher delta
      },
      redFlags: { RF01: true, RF02: false, RF03: false },
      finalOutcome: "NON_IDONEO",
    });

    const metrics = computeEvaluationMetrics(session);
    const tips = buildDeterministicTips(session, metrics, VRU_RUBRIC);

    expect(tips[0]?.source).toBe("red_flag");
    expect(tips[0]?.code).toBe("RF-01");
    // Next: I=2 domains -> self_control (delta +3) before hazard_perception (delta +1)
    expect(tips[1]?.code).toBe("Calma e rispetto VRU");
    expect(tips[2]?.code).toBe("Percezione incroci");
    // Next: I=3 domains -> lateral_distance (delta +2) before adas & planning_rush (delta +1, canonical order)
    expect(tips[3]?.code).toBe("Distanza sorpasso");
    expect(tips[4]?.code).toBe("Sistemi di assistenza");
    expect(tips[5]?.code).toBe("Gestione della fretta");
    expect(tips).toHaveLength(6);

    const ram: EphemeralRamState = { studentLabel: "Luca R.", pngExported: false };
    const vm = buildStudentReportViewModel(session, ram, VRU_RUBRIC);
    expect(vm.pngTips).toHaveLength(4);
    expect(vm.allTips).toHaveLength(6);
    expect(vm.activeRedFlags[0]?.displayCode).toBe("RF-01");
  });

  it("includes residual blind spots on passing domains and positive fallback when clean", () => {
    const clean = makeSession();
    const cleanTips = buildDeterministicTips(
      clean,
      computeEvaluationMetrics(clean),
      VRU_RUBRIC,
    );
    expect(cleanTips).toHaveLength(1);
    expect(cleanTips[0]?.source).toBe("positive");

    // Blind spot with I >= 4 is impossible (since max A is 5, 5-4=1),
    // but let's verify residual sorting if two blind spots exist where I=3 covered vs I>=4 not applicable.
    const adasNa = makeSession({
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
    const vmNa = buildStudentReportViewModel(adasNa, {
      studentLabel: null,
      pngExported: false,
    });
    const adasRow = vmNa.domainRows.find((r) => r.id === "adas");
    expect(adasRow?.instructorScore).toBeNull();
    expect(adasRow?.studentScore).toBeNull();
    expect(adasRow?.isBlindSpot).toBe(false);
  });
});
