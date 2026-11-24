export type DomainId =
  | "dooring"
  | "lateral_distance"
  | "hazard_perception"
  | "adas"
  | "planning_rush"
  | "self_control";

export type RedFlagId = "RF01" | "RF02" | "RF03";

export type FsmPhase =
  | "INSTRUCTOR_EVAL"
  | "HANDOVER_TO_STUDENT"
  | "STUDENT_SELF_EVAL"
  | "RETURN_TO_INSTRUCTOR"
  | "REVEAL_DEBRIEF";

export type VehicleType = "B" | "C_D" | "ALTRO";
export type WeatherType = "sereno" | "pioggia";
export type LightType = "giorno" | "buio";
export type KmBucket = "lt_10" | "10_20" | "gt_20";
export type FinalOutcome = "IDONEO" | "MODULO_INTEGRATIVO" | "NON_IDONEO";

export type CalibrationBand =
  | "critical_overconfidence"
  | "mild_overconfidence"
  | "aligned"
  | "underconfidence";

export type ScoreMap = Record<DomainId, number | null>;

export interface EphemeralSession {
  evaluationId: string;
  fsmPhase: FsmPhase;
  updatedAtMs: number;
  lessonDate: string;
  vehicleType: VehicleType;
  weather: WeatherType;
  light: LightType;
  kmBucket: KmBucket;
  adasAvailable: boolean;
  instructorScores: ScoreMap;
  studentScores: ScoreMap;
  redFlags: Record<RedFlagId, boolean | null>;
  finalOutcome: FinalOutcome | null;
}

export interface EphemeralRamState {
  studentLabel: string | null;
  pngExported: boolean;
}

export interface DevicePrefs {
  lastVehicleType: VehicleType;
  themePreference: "light" | "dark";
  lastStatsExportDate: string | null;
}

export interface StatScoreRecord {
  dooring: number;
  lateral_distance: number;
  hazard_perception: number;
  adas: number | null;
  planning_rush: number;
  self_control: number;
}

export interface AnonymousStatRecord {
  evaluationId: string;
  schemaVersion: 1;
  rubricVersion: "vru-gde-v1";
  periodMonth: string;
  vehicleType: VehicleType;
  weather: WeatherType;
  light: LightType;
  kmBucket: KmBucket;
  adasAvailable: boolean;
  instructorScores: StatScoreRecord;
  studentScores: StatScoreRecord;
  redFlags: Record<RedFlagId, boolean>;
  finalOutcome: FinalOutcome;
}

export interface StatsEnvelope {
  envelopeVersion: 1;
  exportedAtMonth: string;
  recordCount: number;
  records: AnonymousStatRecord[];
}

export interface EvaluationMetrics {
  activeDomains: DomainId[];
  maxScore: 25 | 30;
  passThreshold: 20 | 24;
  totalI: number;
  totalA: number;
  overconfidenceDelta: number;
  isOverconfidenceCritical: boolean;
  calibrationBand: CalibrationBand;
  blindSpotDomains: DomainId[];
  minInstructorScore: number;
}

export interface OutcomeConstraints {
  autoOutcome: "IDONEO" | null;
  allowedOutcomes: FinalOutcome[];
  lowDomainWarning: boolean;
}

export interface ConsistencyWarning {
  redFlagId: RedFlagId;
  domainId: DomainId;
  message: string;
}

export interface ReviewTip {
  source: "red_flag" | "low_domain" | "blind_spot" | "positive";
  code: string;
  text: string;
}

export interface StudentReportDomainRow {
  id: DomainId;
  label: string;
  instructorScore: number | null;
  studentScore: number | null;
  isBlindSpot: boolean;
}

export interface ActiveRedFlagSummary {
  id: RedFlagId;
  displayCode: "RF-01" | "RF-02" | "RF-03";
  title: string;
  correctiveAction: string;
}

export interface StudentReportViewModel {
  lessonDate: string;
  studentLabel: string | null;
  vehicleLabel: string;
  weatherLabel: string;
  lightLabel: string;
  kmBucketLabel: string;
  finalOutcome: FinalOutcome | null;
  metrics: EvaluationMetrics;
  calibrationLabel: string;
  calibrationHint: string;
  domainRows: StudentReportDomainRow[];
  activeRedFlags: ActiveRedFlagSummary[];
  pngTips: ReviewTip[];
  allTips: ReviewTip[];
}

export interface CoordinatorDomainAverage {
  instructorMean: number | null;
  studentMean: number | null;
}

export interface CoordinatorMonthlyRow {
  periodMonth: string;
  count: number;
  idoneoCount: number;
  redFlagSessionCount: number;
}

export interface CoordinatorSummary {
  totalEvaluations: number;
  lowSampleWarning: boolean;
  outcomeCounts: Record<FinalOutcome, number>;
  criticalOverconfidenceCount: number;
  criticalOverconfidenceRate: number;
  redFlagCounts: Record<RedFlagId, number>;
  adasSampleCount: number;
  domainAverages: Record<DomainId, CoordinatorDomainAverage>;
  monthlyBreakdown: CoordinatorMonthlyRow[];
}

export interface EnvelopeParseResult {
  validRecords: AnonymousStatRecord[];
  rejectedCount: number;
  errors: string[];
}

export interface MergeResult {
  merged: AnonymousStatRecord[];
  duplicatesRemoved: number;
}

export type ShareResult = "shared" | "cancelled" | "fallback_downloaded" | "error";
