import {
  CANONICAL_DOMAIN_ORDER,
  CANONICAL_RED_FLAG_ORDER,
  VRU_RUBRIC,
} from "../domain/rubric";
import {
  buildStudentReportViewModel,
  computeEvaluationMetrics,
  determineOutcomeConstraints,
} from "../domain/scoring";
import type {
  DevicePrefs,
  DomainId,
  EphemeralRamState,
  EphemeralSession,
  FinalOutcome,
  FsmPhase,
  KmBucket,
  LightType,
  RedFlagId,
  StudentReportViewModel,
  VehicleType,
  WeatherType,
} from "../domain/types";
import { renderReportPng } from "../export/pngRenderer";
import {
  areRedFlagsComplete,
  commitAnonymousStat,
  createEmptySession,
  isDomainComplete,
  loadActiveSession,
  loadDevicePrefs,
  saveActiveSession,
  saveDevicePrefs,
  toAnonymousStatRecord,
  wipeActiveSession,
} from "../storage/storage";

export type AppTab = "evaluation" | "coordinator";

export interface ControllerSnapshot {
  activeTab: AppTab;
  session: EphemeralSession;
  ramState: EphemeralRamState;
  prefs: DevicePrefs;
  cachedPngFile: File | null;
  pngPreviewUrl: string | null;
  pngGenerating: boolean;
  pngError: string | null;
}

export interface AppControllerOptions {
  renderPng?: (vm: StudentReportViewModel) => Promise<File>;
}

export function isBlindPhase(phase: FsmPhase): boolean {
  return (
    phase === "HANDOVER_TO_STUDENT" ||
    phase === "STUDENT_SELF_EVAL" ||
    phase === "RETURN_TO_INSTRUCTOR"
  );
}

export class AppController {
  private activeTab: AppTab = "evaluation";
  private session: EphemeralSession;
  private ramState: EphemeralRamState = { studentLabel: null, pngExported: false };
  private prefs: DevicePrefs;
  private cachedPngFile: File | null = null;
  private pngPreviewUrl: string | null = null;
  private pngGenerating = false;
  private pngError: string | null = null;
  private pngGenerationToken = 0;
  private readonly listeners = new Set<() => void>();
  private readonly renderPngFn: (vm: StudentReportViewModel) => Promise<File>;
  private readonly boundPopState: () => void;

  constructor(options: AppControllerOptions = {}) {
    this.renderPngFn = options.renderPng ?? renderReportPng;
    this.prefs = loadDevicePrefs();
    this.session = loadActiveSession() ?? createEmptySession(this.prefs);
    this.boundPopState = this.handlePopState.bind(this);
  }

  public init(): void {
    window.addEventListener("popstate", this.boundPopState);
    if (isBlindPhase(this.session.fsmPhase)) {
      this.armBlindHistorySentinel();
    }
    if (
      this.session.fsmPhase === "REVEAL_DEBRIEF" &&
      this.session.finalOutcome !== null
    ) {
      this.commitStatIfReady();
      void this.regeneratePng();
    }
    this.emit();
  }

  public destroy(): void {
    window.removeEventListener("popstate", this.boundPopState);
    this.revokePreviewUrl();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ControllerSnapshot {
    return {
      activeTab: this.activeTab,
      session: this.session,
      ramState: this.ramState,
      prefs: this.prefs,
      cachedPngFile: this.cachedPngFile,
      pngPreviewUrl: this.pngPreviewUrl,
      pngGenerating: this.pngGenerating,
      pngError: this.pngError,
    };
  }

  public isSessionIdle(): boolean {
    if (this.activeTab === "coordinator") {
      return true;
    }
    if (this.session.fsmPhase !== "INSTRUCTOR_EVAL") {
      return false;
    }
    const allScoresNull = CANONICAL_DOMAIN_ORDER.every(
      (d) => this.session.instructorScores[d] === null,
    );
    const allFlagsNull = CANONICAL_RED_FLAG_ORDER.every(
      (rf) => this.session.redFlags[rf] === null,
    );
    return allScoresNull && allFlagsNull;
  }

  public setActiveTab(tab: AppTab): void {
    if (isBlindPhase(this.session.fsmPhase)) {
      return;
    }
    this.activeTab = tab;
    this.emit();
  }

  public toggleTheme(): void {
    const nextTheme = this.prefs.themePreference === "dark" ? "light" : "dark";
    this.prefs = { ...this.prefs, themePreference: nextTheme };
    saveDevicePrefs(this.prefs);
    this.emit();
  }

  public markStatsExported(exportDate: string): void {
    this.prefs = { ...this.prefs, lastStatsExportDate: exportDate };
    saveDevicePrefs(this.prefs);
    this.emit();
  }

  public updateInstructorMetadata(patch: {
    lessonDate?: string;
    vehicleType?: VehicleType;
    weather?: WeatherType;
    light?: LightType;
    kmBucket?: KmBucket;
    adasAvailable?: boolean;
  }): void {
    if (this.session.fsmPhase !== "INSTRUCTOR_EVAL") {
      return;
    }
    const nextAdas =
      patch.adasAvailable !== undefined
        ? patch.adasAvailable
        : this.session.adasAvailable;

    const instructorScores = { ...this.session.instructorScores };
    const studentScores = { ...this.session.studentScores };
    if (!nextAdas) {
      instructorScores.adas = null;
      studentScores.adas = null;
    }

    this.session = {
      ...this.session,
      lessonDate: patch.lessonDate ?? this.session.lessonDate,
      vehicleType: patch.vehicleType ?? this.session.vehicleType,
      weather: patch.weather ?? this.session.weather,
      light: patch.light ?? this.session.light,
      kmBucket: patch.kmBucket ?? this.session.kmBucket,
      adasAvailable: nextAdas,
      instructorScores,
      studentScores,
      updatedAtMs: Date.now(),
    };

    if (patch.vehicleType && patch.vehicleType !== this.prefs.lastVehicleType) {
      this.prefs = { ...this.prefs, lastVehicleType: patch.vehicleType };
      saveDevicePrefs(this.prefs);
    }

    saveActiveSession(this.session);
    this.emit();
  }

  public setInstructorScore(domainId: DomainId, score: number): void {
    if (this.session.fsmPhase !== "INSTRUCTOR_EVAL") {
      return;
    }
    if (domainId === "adas" && !this.session.adasAvailable) {
      return;
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return;
    }
    this.session = {
      ...this.session,
      instructorScores: { ...this.session.instructorScores, [domainId]: score },
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.emit();
  }

  public setRedFlag(rfId: RedFlagId, value: boolean): void {
    if (this.session.fsmPhase !== "INSTRUCTOR_EVAL") {
      return;
    }
    this.session = {
      ...this.session,
      redFlags: { ...this.session.redFlags, [rfId]: value },
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.emit();
  }

  public enterHandover(): boolean {
    if (this.session.fsmPhase !== "INSTRUCTOR_EVAL") {
      return false;
    }
    if (
      !isDomainComplete(this.session.instructorScores, this.session.adasAvailable) ||
      !areRedFlagsComplete(this.session.redFlags)
    ) {
      return false;
    }
    this.session = {
      ...this.session,
      fsmPhase: "HANDOVER_TO_STUDENT",
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.armBlindHistorySentinel();
    this.emit();
    return true;
  }

  public cancelHandover(): boolean {
    if (this.session.fsmPhase !== "HANDOVER_TO_STUDENT") {
      return false;
    }
    this.session = {
      ...this.session,
      fsmPhase: "INSTRUCTOR_EVAL",
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.emit();
    return true;
  }

  public startStudentSelfEval(): boolean {
    if (this.session.fsmPhase !== "HANDOVER_TO_STUDENT") {
      return false;
    }
    this.session = {
      ...this.session,
      fsmPhase: "STUDENT_SELF_EVAL",
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.armBlindHistorySentinel();
    this.emit();
    return true;
  }

  public overrideBackToInstructor(): boolean {
    if (this.session.fsmPhase !== "STUDENT_SELF_EVAL") {
      return false;
    }
    // Preserves partial studentScores in Store A
    this.session = {
      ...this.session,
      fsmPhase: "INSTRUCTOR_EVAL",
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.emit();
    return true;
  }

  public setStudentScore(domainId: DomainId, score: number): void {
    if (this.session.fsmPhase !== "STUDENT_SELF_EVAL") {
      return;
    }
    if (domainId === "adas" && !this.session.adasAvailable) {
      return;
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return;
    }
    this.session = {
      ...this.session,
      studentScores: { ...this.session.studentScores, [domainId]: score },
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.emit();
  }

  public completeStudentSelfEval(): boolean {
    if (this.session.fsmPhase !== "STUDENT_SELF_EVAL") {
      return false;
    }
    if (!isDomainComplete(this.session.studentScores, this.session.adasAvailable)) {
      return false;
    }
    this.session = {
      ...this.session,
      fsmPhase: "RETURN_TO_INSTRUCTOR",
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.armBlindHistorySentinel();
    this.emit();
    return true;
  }

  public revealDebrief(): boolean {
    if (this.session.fsmPhase !== "RETURN_TO_INSTRUCTOR") {
      return false;
    }
    const metrics = computeEvaluationMetrics(this.session);
    const constraints = determineOutcomeConstraints(metrics, this.session.redFlags);

    this.session = {
      ...this.session,
      fsmPhase: "REVEAL_DEBRIEF",
      finalOutcome: constraints.autoOutcome,
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);

    if (this.session.finalOutcome !== null) {
      this.commitStatIfReady();
      void this.regeneratePng();
    } else {
      this.invalidatePng();
    }

    this.emit();
    return true;
  }

  public setFinalOutcome(outcome: FinalOutcome): boolean {
    if (this.session.fsmPhase !== "REVEAL_DEBRIEF") {
      return false;
    }
    const metrics = computeEvaluationMetrics(this.session);
    const constraints = determineOutcomeConstraints(metrics, this.session.redFlags);
    if (!constraints.allowedOutcomes.includes(outcome)) {
      return false;
    }

    this.session = {
      ...this.session,
      finalOutcome: outcome,
      updatedAtMs: Date.now(),
    };
    saveActiveSession(this.session);
    this.commitStatIfReady();
    void this.regeneratePng();
    this.emit();
    return true;
  }

  public setStudentLabel(raw: string): void {
    const trimmed = raw.trim().slice(0, 40);
    const nextLabel = trimmed.length > 0 ? trimmed : null;
    if (nextLabel === this.ramState.studentLabel) {
      return;
    }
    // Strictly RAM-only: never persisted to localStorage
    this.ramState = { ...this.ramState, studentLabel: nextLabel };
    if (
      this.session.fsmPhase === "REVEAL_DEBRIEF" &&
      this.session.finalOutcome !== null
    ) {
      void this.regeneratePng();
    }
    this.emit();
  }

  public markPngExported(): void {
    this.ramState = { ...this.ramState, pngExported: true };
    this.emit();
  }

  public resetSession(): boolean {
    if (
      this.session.fsmPhase === "REVEAL_DEBRIEF" &&
      this.session.finalOutcome === null
    ) {
      return false;
    }
    if (isBlindPhase(this.session.fsmPhase)) {
      return false;
    }
    this.invalidatePng();
    wipeActiveSession();
    this.ramState = { studentLabel: null, pngExported: false };
    this.session = createEmptySession(this.prefs);
    this.emit();
    return true;
  }

  public getCurrentReportViewModel(): StudentReportViewModel | null {
    if (this.session.fsmPhase !== "REVEAL_DEBRIEF") {
      return null;
    }
    return buildStudentReportViewModel(this.session, this.ramState, VRU_RUBRIC);
  }

  private commitStatIfReady(): void {
    if (this.session.finalOutcome === null) {
      return;
    }
    const record = toAnonymousStatRecord(this.session);
    commitAnonymousStat(record);
  }

  private invalidatePng(): void {
    this.pngGenerationToken += 1;
    this.cachedPngFile = null;
    this.pngGenerating = false;
    this.pngError = null;
    this.revokePreviewUrl();
  }

  private revokePreviewUrl(): void {
    if (this.pngPreviewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.pngPreviewUrl);
    }
    this.pngPreviewUrl = null;
  }

  private async regeneratePng(): Promise<void> {
    const vm = this.getCurrentReportViewModel();
    if (!vm || vm.finalOutcome === null) {
      return;
    }

    const token = ++this.pngGenerationToken;
    this.cachedPngFile = null;
    this.pngGenerating = true;
    this.pngError = null;
    this.revokePreviewUrl();
    this.emit();

    try {
      const file = await this.renderPngFn(vm);
      if (token !== this.pngGenerationToken) {
        return;
      }
      this.cachedPngFile = file;
      this.pngGenerating = false;
      this.pngError = null;
      if (typeof URL.createObjectURL === "function") {
        this.pngPreviewUrl = URL.createObjectURL(file);
      }
      this.emit();
    } catch (err: unknown) {
      if (token !== this.pngGenerationToken) {
        return;
      }
      this.cachedPngFile = null;
      this.pngGenerating = false;
      this.pngError =
        err instanceof Error
          ? err.message
          : "Errore nella generazione dell'immagine PNG.";
      this.emit();
    }
  }

  private armBlindHistorySentinel(): void {
    try {
      window.history.pushState({ vruBlindLock: true }, "");
    } catch {
      // Ignore history API restrictions in exotic embedded contexts
    }
  }

  private handlePopState(): void {
    if (isBlindPhase(this.session.fsmPhase)) {
      this.armBlindHistorySentinel();
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
