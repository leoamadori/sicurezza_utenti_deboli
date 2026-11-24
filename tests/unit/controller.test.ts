import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppController, isBlindPhase } from "../../src/fsm/controller";
import {
  countAnonymousStats,
  getAllAnonymousStats,
  resetMemoryFallbackForTests,
} from "../../src/storage/storage";
import type { DomainId, StudentReportViewModel } from "../../src/domain/types";

const ALL_DOMAINS: DomainId[] = [
  "dooring",
  "lateral_distance",
  "hazard_perception",
  "adas",
  "planning_rush",
  "self_control",
];

function fillInstructor(
  ctrl: AppController,
  score = 4,
  rf01 = false,
): void {
  for (const d of ALL_DOMAINS) {
    ctrl.setInstructorScore(d, score);
  }
  ctrl.setRedFlag("RF01", rf01);
  ctrl.setRedFlag("RF02", false);
  ctrl.setRedFlag("RF03", false);
}

function fillStudent(ctrl: AppController, score = 4): void {
  for (const d of ALL_DOMAINS) {
    ctrl.setStudentScore(d, score);
  }
}

describe("FSM AppController — transitions, blind lock, reload recovery, idempotent commit & PNG anti-race", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMemoryFallbackForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enforces full 5-phase lifecycle, IDONEO auto-commit, RAM-only studentLabel, and clean reset", async () => {
    const fakePng = vi.fn(async (_vm: StudentReportViewModel) => {
      return new File([new Uint8Array([137, 80, 78, 71])], "test.png", {
        type: "image/png",
      });
    });

    const ctrl = new AppController({ renderPng: fakePng });
    ctrl.init();
    expect(ctrl.isSessionIdle()).toBe(true);
    expect(ctrl.enterHandover()).toBe(false); // incomplete

    fillInstructor(ctrl, 4, false);
    expect(ctrl.isSessionIdle()).toBe(false);
    expect(ctrl.enterHandover()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("HANDOVER_TO_STUDENT");
    expect(isBlindPhase(ctrl.getSnapshot().session.fsmPhase)).toBe(true);

    // Cancel handover returns to instructor before handoff
    expect(ctrl.cancelHandover()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("INSTRUCTOR_EVAL");

    // Re-enter handover and start blind self-eval
    expect(ctrl.enterHandover()).toBe(true);
    expect(ctrl.startStudentSelfEval()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("STUDENT_SELF_EVAL");

    // Switching tab blocked in blind phase
    ctrl.setActiveTab("coordinator");
    expect(ctrl.getSnapshot().activeTab).toBe("evaluation");

    // Override back preserves partial student answers; toggling ADAS off clears only adas
    ctrl.setStudentScore("dooring", 5);
    ctrl.setStudentScore("adas", 3);
    expect(ctrl.overrideBackToInstructor()).toBe(true);
    expect(ctrl.getSnapshot().session.studentScores.dooring).toBe(5);
    ctrl.updateInstructorMetadata({ adasAvailable: false, vehicleType: "C_D" });
    expect(ctrl.getSnapshot().session.studentScores.adas).toBeNull();
    expect(ctrl.getSnapshot().session.studentScores.dooring).toBe(5);
    expect(ctrl.getSnapshot().prefs.lastVehicleType).toBe("C_D");

    // Resume student eval with 5 domains
    expect(ctrl.enterHandover()).toBe(true);
    expect(ctrl.startStudentSelfEval()).toBe(true);
    for (const d of ALL_DOMAINS.filter((x) => x !== "adas")) {
      ctrl.setStudentScore(d, 4);
    }
    expect(ctrl.completeStudentSelfEval()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("RETURN_TO_INSTRUCTOR");

    // Reveal debrief -> IDONEO automatic, commits Store B, pre-generates PNG
    expect(ctrl.revealDebrief()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("REVEAL_DEBRIEF");
    expect(ctrl.getSnapshot().session.finalOutcome).toBe("IDONEO");
    expect(countAnonymousStats()).toBe(1);

    await vi.waitFor(() => {
      expect(ctrl.getSnapshot().cachedPngFile).not.toBeNull();
    });

    // RAM-only studentLabel triggers PNG regen but never touches localStorage
    ctrl.setStudentLabel("  Anna B.  ");
    expect(ctrl.getSnapshot().ramState.studentLabel).toBe("Anna B.");
    expect(window.localStorage.getItem("vru_active_session_v1")).not.toContain("Anna B.");

    ctrl.markPngExported();
    expect(ctrl.getSnapshot().ramState.pngExported).toBe(true);

    // Reset wipes Store A and RAM, preserves Store B
    expect(ctrl.resetSession()).toBe(true);
    expect(ctrl.getSnapshot().session.fsmPhase).toBe("INSTRUCTOR_EVAL");
    expect(ctrl.getSnapshot().ramState.studentLabel).toBeNull();
    expect(countAnonymousStats()).toBe(1);

    ctrl.destroy();
  });

  it("blocks reset when finalOutcome is null, re-commits Store B on outcome change, and discards stale PNG", async () => {
    let resolveFirst!: (file: File) => void;
    let callNum = 0;
    const slowThenFastPng = vi.fn((vm: StudentReportViewModel) => {
      callNum += 1;
      if (callNum === 1) {
        return new Promise<File>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        new File([new TextEncoder().encode(vm.finalOutcome ?? "")], "second.png", {
          type: "image/png",
        }),
      );
    });

    const ctrl = new AppController({ renderPng: slowThenFastPng });
    ctrl.init();
    fillInstructor(ctrl, 4, true); // RF01 active -> IDONEO blocked
    ctrl.enterHandover();
    ctrl.startStudentSelfEval();
    fillStudent(ctrl, 4);
    ctrl.completeStudentSelfEval();
    ctrl.revealDebrief();

    expect(ctrl.getSnapshot().session.finalOutcome).toBeNull();
    expect(countAnonymousStats()).toBe(0);
    expect(ctrl.resetSession()).toBe(false); // blocked until outcome selected
    expect(ctrl.setFinalOutcome("IDONEO")).toBe(false); // forbidden with RF01

    // First selection starts slow PNG generation
    expect(ctrl.setFinalOutcome("MODULO_INTEGRATIVO")).toBe(true);
    expect(countAnonymousStats()).toBe(1);
    expect(getAllAnonymousStats()[0]?.finalOutcome).toBe("MODULO_INTEGRATIVO");

    // Second selection supersedes first PNG and updates same evaluationId in Store B
    expect(ctrl.setFinalOutcome("NON_IDONEO")).toBe(true);
    expect(countAnonymousStats()).toBe(1);
    expect(getAllAnonymousStats()[0]?.finalOutcome).toBe("NON_IDONEO");

    await vi.waitFor(() => {
      expect(ctrl.getSnapshot().cachedPngFile?.name).toBe("second.png");
    });

    // Resolving stale first promise must NOT overwrite newer PNG
    resolveFirst(new File([new Uint8Array([1])], "stale.png", { type: "image/png" }));
    await Promise.resolve();
    expect(ctrl.getSnapshot().cachedPngFile?.name).toBe("second.png");

    ctrl.destroy();
  });

  it("re-arms popstate sentinel after reload during STUDENT_SELF_EVAL and handles theme/tab switches", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");

    const ctrl1 = new AppController();
    ctrl1.init();
    fillInstructor(ctrl1, 4, false);
    ctrl1.enterHandover();
    ctrl1.startStudentSelfEval();
    ctrl1.setStudentScore("dooring", 5);
    ctrl1.destroy();

    pushStateSpy.mockClear();

    // Simulate cold reload in STUDENT_SELF_EVAL
    const ctrl2 = new AppController();
    ctrl2.init();
    expect(ctrl2.getSnapshot().session.fsmPhase).toBe("STUDENT_SELF_EVAL");
    expect(ctrl2.getSnapshot().session.studentScores.dooring).toBe(5);
    expect(pushStateSpy).toHaveBeenCalledTimes(1);

    // Triggering popstate keeps blind phase and re-arms sentinel
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(ctrl2.getSnapshot().session.fsmPhase).toBe("STUDENT_SELF_EVAL");
    expect(pushStateSpy).toHaveBeenCalledTimes(2);

    ctrl2.toggleTheme();
    expect(ctrl2.getSnapshot().prefs.themePreference).toBe("dark");
    ctrl2.toggleTheme();
    expect(ctrl2.getSnapshot().prefs.themePreference).toBe("light");
    ctrl2.markStatsExported("2026-11-24");
    expect(ctrl2.getSnapshot().prefs.lastStatsExportDate).toBe("2026-11-24");

    ctrl2.destroy();
  });

  it("handles out-of-phase guards, PNG render failures, coordinator idle state, and REVEAL_DEBRIEF reload", async () => {
    const failingPng = vi.fn(async () => {
      throw new Error("Canvas GPU fail");
    });

    const ctrl = new AppController({ renderPng: failingPng });
    ctrl.init();

    // Out-of-phase transitions return false cleanly
    expect(ctrl.cancelHandover()).toBe(false);
    expect(ctrl.startStudentSelfEval()).toBe(false);
    expect(ctrl.overrideBackToInstructor()).toBe(false);
    expect(ctrl.completeStudentSelfEval()).toBe(false);
    expect(ctrl.revealDebrief()).toBe(false);
    expect(ctrl.setFinalOutcome("IDONEO")).toBe(false);
    expect(ctrl.getCurrentReportViewModel()).toBeNull();

    // Invalid scores ignored
    ctrl.setInstructorScore("dooring", 0);
    ctrl.setInstructorScore("dooring", 6);
    expect(ctrl.getSnapshot().session.instructorScores.dooring).toBeNull();

    // Coordinator tab counts as idle
    ctrl.setActiveTab("coordinator");
    expect(ctrl.isSessionIdle()).toBe(true);
    ctrl.setActiveTab("evaluation");

    // Metadata updates and ADAS disabled ignores ADAS score
    ctrl.updateInstructorMetadata({
      lessonDate: "2026-11-20",
      weather: "pioggia",
      light: "buio",
      kmBucket: "gt_20",
      adasAvailable: false,
    });
    ctrl.setInstructorScore("adas", 4);
    expect(ctrl.getSnapshot().session.instructorScores.adas).toBeNull();
    ctrl.updateInstructorMetadata({ adasAvailable: true });

    fillInstructor(ctrl, 4, false);
    ctrl.enterHandover();
    // Blocked during blind phase
    expect(ctrl.resetSession()).toBe(false);
    ctrl.updateInstructorMetadata({ weather: "sereno" });
    ctrl.setInstructorScore("dooring", 1);
    ctrl.setRedFlag("RF01", true);

    ctrl.startStudentSelfEval();
    // Invalid student score ignored; incomplete student eval returns false
    ctrl.setStudentScore("dooring", 9);
    expect(ctrl.completeStudentSelfEval()).toBe(false);
    fillStudent(ctrl, 4);
    ctrl.completeStudentSelfEval();
    ctrl.revealDebrief();

    await vi.waitFor(() => {
      expect(ctrl.getSnapshot().pngError).toBe("Canvas GPU fail");
    });

    // Reload directly into REVEAL_DEBRIEF triggers commit + PNG regen
    ctrl.destroy();
    const okPng = vi.fn(async () => new File([new Uint8Array([1])], "reloaded.png", { type: "image/png" }));
    const ctrlReloaded = new AppController({ renderPng: okPng });
    ctrlReloaded.init();
    expect(ctrlReloaded.getSnapshot().session.fsmPhase).toBe("REVEAL_DEBRIEF");
    await vi.waitFor(() => {
      expect(ctrlReloaded.getSnapshot().cachedPngFile?.name).toBe("reloaded.png");
    });

    // Same student label is no-op
    ctrlReloaded.setStudentLabel("   ");
    expect(ctrlReloaded.getSnapshot().ramState.studentLabel).toBeNull();
    ctrlReloaded.destroy();
  });
});
