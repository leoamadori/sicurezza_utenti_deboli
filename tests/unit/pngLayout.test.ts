import { describe, expect, it } from "vitest";
import { VRU_RUBRIC } from "../../src/domain/rubric";
import { buildStudentReportViewModel } from "../../src/domain/scoring";
import type { EphemeralSession } from "../../src/domain/types";
import {
  computePngLayout,
  PNG_MAX_HEIGHT,
  PNG_WIDTH,
  wrapText,
} from "../../src/export/pngLayout";

// Deterministic character-width estimator (~0.56 * fontSize per char)
const approxMeasure = (text: string, fontSizePx: number, bold = false): number => {
  const factor = bold ? 0.6 : 0.56;
  return text.length * fontSizePx * factor;
};

function makeWorstCaseSession(): EphemeralSession {
  return {
    evaluationId: "11111111-1111-4111-8111-111111111111",
    fsmPhase: "REVEAL_DEBRIEF",
    updatedAtMs: 1_700_000_000_000,
    lessonDate: "2026-11-24",
    vehicleType: "C_D",
    weather: "pioggia",
    light: "buio",
    kmBucket: "gt_20",
    adasAvailable: true,
    instructorScores: {
      dooring: 1,
      lateral_distance: 1,
      hazard_perception: 1,
      adas: 2,
      planning_rush: 2,
      self_control: 2,
    },
    studentScores: {
      dooring: 5,
      lateral_distance: 5,
      hazard_perception: 5,
      adas: 5,
      planning_rush: 5,
      self_control: 5,
    },
    redFlags: { RF01: true, RF02: true, RF03: true },
    finalOutcome: "NON_IDONEO",
  };
}

describe("pngLayout — deterministic wrapping & <= 1920px height invariant", () => {
  it("wraps long text deterministically with ellipsis when clamped to maxLines", () => {
    const longText =
      "Questo è un testo molto lungo pensato per verificare il funzionamento deterministico del word wrapping con ellissi finale.";
    const lines = wrapText(longText, 300, approxMeasure, 28, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);

    // Single overlong token without spaces
    const unspaced = "SupercalifragilistichespiralidosoSenzaSpazi";
    const singleWordLines = wrapText(unspaced, 200, approxMeasure, 28, 2);
    expect(singleWordLines).toHaveLength(2);
    expect(singleWordLines[1]?.endsWith("…")).toBe(true);

    expect(wrapText("   ", 300, approxMeasure, 28, 2)).toEqual([]);
  });

  it("keeps worst-case report (40-char studentLabel + 3 Red Flags + 6 domains + 4 tips) within 1080x1920", () => {
    const vm = buildStudentReportViewModel(
      makeWorstCaseSession(),
      {
        studentLabel: "Alessandro Massimiliano De Santis Rossi!",
        pngExported: false,
      },
      VRU_RUBRIC,
    );

    const layout = computePngLayout(vm, approxMeasure);
    expect(layout.width).toBe(PNG_WIDTH);
    expect(layout.totalHeight).toBeLessThanOrEqual(PNG_MAX_HEIGHT);
    expect(layout.redFlagsCard.items).toHaveLength(3);
    expect(layout.tipsCard.items).toHaveLength(4);
    expect(layout.scoresCard.y).toBeGreaterThan(layout.header.y + layout.header.height);
    expect(layout.chartCard.y).toBeGreaterThan(
      layout.scoresCard.y + layout.scoresCard.height,
    );
    expect(layout.redFlagsCard.y).toBeGreaterThan(
      layout.chartCard.y + layout.chartCard.height,
    );
    expect(layout.tipsCard.y).toBeGreaterThan(
      layout.redFlagsCard.y + layout.redFlagsCard.height,
    );
  });

  it("handles clean ADAS N/A report in non-compact layout", () => {
    const cleanAdasNa: EphemeralSession = {
      ...makeWorstCaseSession(),
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
        dooring: 5,
        lateral_distance: 5,
        hazard_perception: 5,
        adas: null,
        planning_rush: 5,
        self_control: 5,
      },
      redFlags: { RF01: false, RF02: false, RF03: false },
      finalOutcome: "IDONEO",
    };

    const vm = buildStudentReportViewModel(
      cleanAdasNa,
      { studentLabel: null, pngExported: false },
      VRU_RUBRIC,
    );
    const layout = computePngLayout(vm, approxMeasure);
    expect(layout.compact).toBe(false);
    expect(layout.totalHeight).toBeLessThanOrEqual(PNG_MAX_HEIGHT);
    expect(layout.header.studentLine).toBeNull();
    expect(layout.redFlagsCard.items).toHaveLength(0);
    expect(layout.tipsCard.items).toHaveLength(1);
  });
});
