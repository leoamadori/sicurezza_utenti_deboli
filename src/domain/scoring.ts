import {
  CALIBRATION_HINTS,
  CALIBRATION_LABELS,
  CANONICAL_DOMAIN_ORDER,
  CANONICAL_RED_FLAG_ORDER,
  KM_BUCKET_LABELS,
  LIGHT_LABELS,
  VEHICLE_LABELS,
  VRU_RUBRIC,
  WEATHER_LABELS,
  type RubricDefinition,
} from "./rubric";
import type {
  ActiveRedFlagSummary,
  CalibrationBand,
  ConsistencyWarning,
  DomainId,
  EphemeralRamState,
  EphemeralSession,
  EvaluationMetrics,
  OutcomeConstraints,
  RedFlagId,
  ReviewTip,
  ScoreMap,
  StatScoreRecord,
  StudentReportDomainRow,
  StudentReportViewModel,
} from "./types";

function isValidScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function getActiveDomains(adasAvailable: boolean): DomainId[] {
  return adasAvailable
    ? [...CANONICAL_DOMAIN_ORDER]
    : CANONICAL_DOMAIN_ORDER.filter((d) => d !== "adas");
}

export function computeMetricsFromScores(
  adasAvailable: boolean,
  instructorScores: ScoreMap | StatScoreRecord,
  studentScores: ScoreMap | StatScoreRecord,
): EvaluationMetrics {
  const activeDomains = getActiveDomains(adasAvailable);
  const maxScore: 25 | 30 = activeDomains.length === 6 ? 30 : 25;
  const passThreshold: 20 | 24 = activeDomains.length === 6 ? 24 : 20;

  let totalI = 0;
  let totalA = 0;
  let minInstructorScore = 5;
  const blindSpotDomains: DomainId[] = [];

  for (const domainId of activeDomains) {
    const iScore = instructorScores[domainId];
    const aScore = studentScores[domainId];

    if (!isValidScore(iScore)) {
      throw new Error(
        `Punteggio istruttore mancante o fuori intervallo [1..5] per il dominio "${domainId}".`,
      );
    }
    if (!isValidScore(aScore)) {
      throw new Error(
        `Punteggio allievo mancante o fuori intervallo [1..5] per il dominio "${domainId}".`,
      );
    }

    totalI += iScore;
    totalA += aScore;
    if (iScore < minInstructorScore) {
      minInstructorScore = iScore;
    }
    if (aScore - iScore >= 2) {
      blindSpotDomains.push(domainId);
    }
  }

  const overconfidenceDelta = totalA - totalI;
  const isOverconfidenceCritical =
    activeDomains.length === 6 ? overconfidenceDelta > 3 : overconfidenceDelta >= 3;

  let calibrationBand: CalibrationBand;
  if (isOverconfidenceCritical) {
    calibrationBand = "critical_overconfidence";
  } else if (overconfidenceDelta >= 1) {
    calibrationBand = "mild_overconfidence";
  } else if (overconfidenceDelta >= -2) {
    calibrationBand = "aligned";
  } else {
    calibrationBand = "underconfidence";
  }

  return {
    activeDomains,
    maxScore,
    passThreshold,
    totalI,
    totalA,
    overconfidenceDelta,
    isOverconfidenceCritical,
    calibrationBand,
    blindSpotDomains,
    minInstructorScore,
  };
}

export function computeEvaluationMetrics(
  session: EphemeralSession,
): EvaluationMetrics {
  return computeMetricsFromScores(
    session.adasAvailable,
    session.instructorScores,
    session.studentScores,
  );
}

export function getActiveRedFlags(
  redFlags: Record<RedFlagId, boolean | null>,
): RedFlagId[] {
  return CANONICAL_RED_FLAG_ORDER.filter((rf) => redFlags[rf] === true);
}

export function determineOutcomeConstraints(
  metrics: EvaluationMetrics,
  redFlags: Record<RedFlagId, boolean | null>,
): OutcomeConstraints {
  const activeRedFlags = getActiveRedFlags(redFlags);

  if (metrics.totalI >= metrics.passThreshold && activeRedFlags.length === 0) {
    return {
      autoOutcome: "IDONEO",
      allowedOutcomes: ["IDONEO"],
      lowDomainWarning: metrics.minInstructorScore <= 2,
    };
  }

  return {
    autoOutcome: null,
    allowedOutcomes: ["MODULO_INTEGRATIVO", "NON_IDONEO"],
    lowDomainWarning: false,
  };
}

export function detectConsistencyWarnings(
  session: EphemeralSession,
  rubric: RubricDefinition = VRU_RUBRIC,
): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];

  for (const rfId of CANONICAL_RED_FLAG_ORDER) {
    if (session.redFlags[rfId] !== true) {
      continue;
    }
    const rfEntry = rubric.redFlagsById[rfId];
    const domainId = rfEntry.linkedDomain;
    const score = session.instructorScores[domainId];

    if (score !== null && score >= 3) {
      const domainLabel = rubric.domainsById[domainId].label;
      warnings.push({
        redFlagId: rfId,
        domainId,
        message: `${rfEntry.displayCode} è attiva, ma "${domainLabel}" ha voto ${score}/5: verifica la coerenza prima di proseguire.`,
      });
    }
  }

  return warnings;
}

export function buildDeterministicTips(
  session: EphemeralSession,
  metrics: EvaluationMetrics,
  rubric: RubricDefinition = VRU_RUBRIC,
): ReviewTip[] {
  const tips: ReviewTip[] = [];
  const coveredDomains = new Set<DomainId>();

  // 1. Active Red Flags in canonical order RF01 > RF02 > RF03
  for (const rfId of CANONICAL_RED_FLAG_ORDER) {
    if (session.redFlags[rfId] === true) {
      const entry = rubric.redFlagsById[rfId];
      tips.push({
        source: "red_flag",
        code: entry.displayCode,
        text: entry.studentTip,
      });
      coveredDomains.add(entry.linkedDomain);
    }
  }

  // 2. Active domains not covered by an active Red Flag with instructorScore < 4
  const lowDomains = metrics.activeDomains
    .filter((domainId) => {
      if (coveredDomains.has(domainId)) {
        return false;
      }
      const iScore = session.instructorScores[domainId];
      return iScore !== null && iScore < 4;
    })
    .sort((a, b) => {
      const iA = session.instructorScores[a] as number;
      const iB = session.instructorScores[b] as number;
      if (iA !== iB) {
        return iA - iB;
      }
      const deltaA = (session.studentScores[a] as number) - iA;
      const deltaB = (session.studentScores[b] as number) - iB;
      if (deltaA !== deltaB) {
        return deltaB - deltaA;
      }
      return CANONICAL_DOMAIN_ORDER.indexOf(a) - CANONICAL_DOMAIN_ORDER.indexOf(b);
    });

  for (const domainId of lowDomains) {
    const entry = rubric.domainsById[domainId];
    tips.push({
      source: "low_domain",
      code: entry.label,
      text: entry.lowScoreTip,
    });
    coveredDomains.add(domainId);
  }

  // 3. Residual blind-spot domains (A_i - I_i >= 2) not yet included
  const residualBlindSpots = metrics.blindSpotDomains
    .filter((domainId) => !coveredDomains.has(domainId))
    .sort((a, b) => {
      const deltaA =
        (session.studentScores[a] as number) - (session.instructorScores[a] as number);
      const deltaB =
        (session.studentScores[b] as number) - (session.instructorScores[b] as number);
      if (deltaA !== deltaB) {
        return deltaB - deltaA;
      }
      return CANONICAL_DOMAIN_ORDER.indexOf(a) - CANONICAL_DOMAIN_ORDER.indexOf(b);
    });

  for (const domainId of residualBlindSpots) {
    const entry = rubric.domainsById[domainId];
    tips.push({
      source: "blind_spot",
      code: entry.label,
      text: entry.blindSpotTip,
    });
    coveredDomains.add(domainId);
  }

  // 4. Positive fallback if no issues detected
  if (tips.length === 0) {
    tips.push({
      source: "positive",
      code: "Conferma",
      text: rubric.positiveConfirmationTip,
    });
  }

  return tips;
}

export function buildStudentReportViewModel(
  session: EphemeralSession,
  ramState: EphemeralRamState,
  rubric: RubricDefinition = VRU_RUBRIC,
): StudentReportViewModel {
  const metrics = computeEvaluationMetrics(session);
  const allTips = buildDeterministicTips(session, metrics, rubric);
  const pngTips = allTips.slice(0, 4);

  const blindSpotSet = new Set(metrics.blindSpotDomains);

  const domainRows: StudentReportDomainRow[] = rubric.domains.map((entry) => {
    const isAdasDisabled = entry.id === "adas" && !session.adasAvailable;
    return {
      id: entry.id,
      label: entry.label,
      instructorScore: isAdasDisabled ? null : session.instructorScores[entry.id],
      studentScore: isAdasDisabled ? null : session.studentScores[entry.id],
      isBlindSpot: !isAdasDisabled && blindSpotSet.has(entry.id),
    };
  });

  const activeRedFlags: ActiveRedFlagSummary[] = getActiveRedFlags(
    session.redFlags,
  ).map((rfId) => {
    const entry = rubric.redFlagsById[rfId];
    return {
      id: rfId,
      displayCode: entry.displayCode,
      title: entry.title,
      correctiveAction: entry.correctiveAction,
    };
  });

  return {
    lessonDate: session.lessonDate,
    studentLabel: ramState.studentLabel,
    vehicleLabel: VEHICLE_LABELS[session.vehicleType],
    weatherLabel: WEATHER_LABELS[session.weather],
    lightLabel: LIGHT_LABELS[session.light],
    kmBucketLabel: KM_BUCKET_LABELS[session.kmBucket],
    finalOutcome: session.finalOutcome,
    metrics,
    calibrationLabel: CALIBRATION_LABELS[metrics.calibrationBand],
    calibrationHint: CALIBRATION_HINTS[metrics.calibrationBand],
    domainRows,
    activeRedFlags,
    pngTips,
    allTips,
  };
}
