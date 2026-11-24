import type {
  CalibrationBand,
  DomainId,
  FinalOutcome,
  KmBucket,
  LightType,
  RedFlagId,
  VehicleType,
  WeatherType,
} from "./types";

export const RUBRIC_VERSION = "vru-gde-v1" as const;
export const SCHEMA_VERSION = 1 as const;
export const ENVELOPE_VERSION = 1 as const;
export const APP_VERSION: string = __APP_VERSION__;

export const CANONICAL_DOMAIN_ORDER: readonly DomainId[] = [
  "dooring",
  "lateral_distance",
  "hazard_perception",
  "adas",
  "planning_rush",
  "self_control",
] as const;

export const CANONICAL_RED_FLAG_ORDER: readonly RedFlagId[] = [
  "RF01",
  "RF02",
  "RF03",
] as const;

export interface DomainRubricEntry {
  readonly id: DomainId;
  readonly gdeArea: "GDE 1–2" | "GDE 3" | "GDE 4";
  readonly areaLabel: string;
  readonly label: string;
  readonly optionalAdas: boolean;
  readonly instructorDescriptors: {
    readonly insufficient: string;
    readonly level3: string;
    readonly level4: string;
    readonly expert: string;
  };
  readonly studentPrompt: string;
  readonly lowScoreTip: string;
  readonly blindSpotTip: string;
}

export interface RedFlagRubricEntry {
  readonly id: RedFlagId;
  readonly displayCode: "RF-01" | "RF-02" | "RF-03";
  readonly linkedDomain: DomainId;
  readonly title: string;
  readonly observedBehavior: string;
  readonly correctiveAction: string;
  readonly studentTip: string;
}

export interface GrowPromptEntry {
  readonly phase: "G" | "R" | "O" | "W";
  readonly title: string;
  readonly question: string;
}

export interface RubricDefinition {
  readonly version: typeof RUBRIC_VERSION;
  readonly domains: readonly DomainRubricEntry[];
  readonly domainsById: Readonly<Record<DomainId, DomainRubricEntry>>;
  readonly redFlags: readonly RedFlagRubricEntry[];
  readonly redFlagsById: Readonly<Record<RedFlagId, RedFlagRubricEntry>>;
  readonly growPrompts: readonly GrowPromptEntry[];
  readonly positiveConfirmationTip: string;
}

const DOMAIN_ENTRIES: readonly DomainRubricEntry[] = [
  {
    id: "dooring",
    gdeArea: "GDE 1–2",
    areaLabel: "Area Operativa e Tattica (GDE 1–2)",
    label: "Apertura portiera",
    optionalAdas: false,
    instructorDescriptors: {
      insufficient:
        "Apre con mano vicina senza voltarsi; nessun controllo angolo cieco posteriore.",
      level3:
        "Usa la mano lontana solo su promemoria; rotazione parziale del busto.",
      level4:
        "Usa spontaneamente mano lontana, specchio e controllo spalla prima di aprire.",
      expert:
        "Automatismo completo: mano lontana, rotazione 360°, controllo spalla-cieco, apertura progressiva.",
    },
    studentPrompt:
      "Prima di aprire la portiera, controllo dietro girando le spalle e usando la mano lontana?",
    lowScoreTip:
      "Allenati ad aprire sempre la portiera con la mano lontana: ti obbliga a ruotare le spalle e vedere chi arriva da dietro.",
    blindSpotTip:
      "Fai attenzione alla percezione sull'apertura portiera: anche quando ti sembra di aver controllato, verifica sempre l'angolo cieco.",
  },
  {
    id: "lateral_distance",
    gdeArea: "GDE 1–2",
    areaLabel: "Area Operativa e Tattica (GDE 1–2)",
    label: "Distanza sorpasso",
    optionalAdas: false,
    instructorDescriptors: {
      insufficient:
        "Sorpassa a distanza critica (< 1,0 m); nessuna decelerazione; traiettoria rigida.",
      level3:
        "Tenta di mantenere margine ma esita a rallentare o a spostarsi in corsia libera.",
      level4:
        "Mantiene margine di sicurezza ~1,5 m adeguando la velocità in fase di sorpasso.",
      expert:
        "Garantisce costantemente >= 1,5 m, adegua la velocità e attende con pazienza varchi sicuri.",
    },
    studentPrompt:
      "Quando supero bici o monopattini, rallento e lascio almeno 1,5 metri di spazio laterale?",
    lowScoreTip:
      "Quando superi bici o monopattini, riduci la velocità e spostati con decisione fino a garantire almeno 1,5 metri di margine.",
    blindSpotTip:
      "Ricalibra la distanza laterale percepita nei sorpassi: dall'abitacolo lo spazio sembra spesso maggiore di quello reale.",
  },
  {
    id: "hazard_perception",
    gdeArea: "GDE 1–2",
    areaLabel: "Area Operativa e Tattica (GDE 1–2)",
    label: "Percezione incroci",
    optionalAdas: false,
    instructorDescriptors: {
      insufficient:
        "Fissazione centrale; ignora la pista ciclabile nelle svolte a destra.",
      level3:
        "Scansiona gli specchietti solo in parte prima della manovra; rallentamento tardivo agli incroci.",
      level4:
        "Scansiona specchietti e incroci prima di svoltare, rallentando con margine verso ciclabili e strisce.",
      expert:
        "Scansione sistematica a 360° (specchio-spalla); anticipa traiettorie anomale di pedoni e anziani.",
    },
    studentPrompt:
      "Prima di svoltare o attraversare un incrocio, controllo specchietti, angolo cieco, bici e pedoni?",
    lowScoreTip:
      "Prima di ogni svolta o incrocio, esegui la sequenza specchietto-spalla-ciclabile e anticipa i movimenti improvvisi dei pedoni.",
    blindSpotTip:
      "Non dare per scontato di aver visto tutto agli incroci: inserisci sempre un secondo controllo sull'angolo cieco prima di girare.",
  },
  {
    id: "adas",
    gdeArea: "GDE 1–2",
    areaLabel: "Area Operativa e Tattica (GDE 1–2)",
    label: "Sistemi di assistenza",
    optionalAdas: true,
    instructorDescriptors: {
      insufficient:
        "Si affida ciecamente ai sensori o ne disattiva gli allarmi.",
      level3:
        "Conosce gli avvisi ma reagisce in ritardo o sovrastima l'affidabilità dei sensori.",
      level4:
        "Conosce gli avvisi acustici/visivi e mantiene vigilanza attiva sulla strada.",
      expert:
        "Consapevole dei limiti dei sensori (pioggia/lenti sporche); li usa come mero ausilio alla vigilanza.",
    },
    studentPrompt:
      "Uso gli avvisi di sicurezza dell'auto solo come aiuto, tenendo sempre alta la mia attenzione?",
    lowScoreTip:
      "Ricorda i limiti dei sensori con pioggia, buio o sporco: usali solo come supporto e resta pronto a frenare tu per primo.",
    blindSpotTip:
      "Valuta in modo più critico i sistemi di assistenza: l'assenza di un avviso acustico non garantisce che la strada sia libera.",
  },
  {
    id: "planning_rush",
    gdeArea: "GDE 3",
    areaLabel: "Area Strategica ed Emotiva (GDE 3–4)",
    label: "Gestione della fretta",
    optionalAdas: false,
    instructorDescriptors: {
      insufficient:
        "Ansia da ritardo evidente; accelera vicino agli attraversamenti; considera i VRU un intralcio.",
      level3:
        "Rispetta i limiti ma mostra impazienza in coda o davanti a ciclisti/pedoni.",
      level4:
        "Rispetta i limiti anche sotto pressione temporale ed evita sorpassi azzardati.",
      expert:
        "Pianifica percorsi preventivi, adotta velocità calmierata nelle Zone 30 e mostra tolleranza verso la mobilità lenta.",
    },
    studentPrompt:
      "Anche quando ho fretta, mantengo una velocità prudente vicino a pedoni, bici e zone 30?",
    lowScoreTip:
      "Parti con margine e mantieni una velocità calma nelle Zone 30: un sorpasso affrettato fa risparmiare pochi secondi ma moltiplica il rischio.",
    blindSpotTip:
      "Monitora la sensazione di fretta alla guida: spesso si accelera vicino agli attraversamenti senza accorgersene.",
  },
  {
    id: "self_control",
    gdeArea: "GDE 4",
    areaLabel: "Area Strategica ed Emotiva (GDE 3–4)",
    label: "Calma e rispetto VRU",
    optionalAdas: false,
    instructorDescriptors: {
      insufficient:
        "Reazioni di stizza o aggressività verso monopattini/bici; suscettibile a passeggeri o pari.",
      level3:
        "Comportamento corretto alla guida ma con lieve tensione verbale o fastidio.",
      level4:
        "Mantiene calma e accetta regolarmente le precedenze di pedoni, bici e monopattini.",
      expert:
        "Guida empatica e protettiva (Traffic Safety Culture); tutela proattiva del diritto alla strada degli utenti deboli.",
    },
    studentPrompt:
      "Resto calmo e paziente verso pedoni, bici e monopattini senza farmi mettere pressione?",
    lowScoreTip:
      "Quando incontri bici o monopattini lenti, respira e proteggi la loro sicurezza senza farti condizionare da chi suona o dai passeggeri.",
    blindSpotTip:
      "Osserva le tue reazioni emotive nel traffico: anche una lieve tensione riduce la lucidità verso gli utenti vulnerabili.",
  },
];

const RED_FLAG_ENTRIES: readonly RedFlagRubricEntry[] = [
  {
    id: "RF01",
    displayCode: "RF-01",
    linkedDomain: "dooring",
    title: "Apertura Pericolosa",
    observedBehavior:
      "Apertura portiera senza verifica con ciclista o monopattino sopraggiungente (< 10 m).",
    correctiveAction:
      "Stop immediato • Blocco manovra e ripetizione statica del protocollo di apertura con mano lontana.",
    studentTip:
      "Fermati e ripeti sempre l'apertura con la mano lontana girando le spalle: un ciclista dietro la portiera non ha spazio per frenare.",
  },
  {
    id: "RF02",
    displayCode: "RF-02",
    linkedDomain: "lateral_distance",
    title: "Sorpasso a Filo",
    observedBehavior:
      "Sorpasso di micromobilità con margine laterale < 0,8 m o taglio improvviso della traiettoria.",
    correctiveAction:
      "Intervento istruttore • Modulo pratico integrativo di mezza giornata in bicicletta (SUD).",
    studentTip:
      "Non forzare mai il sorpasso stretto di bici o monopattini: rallenta, attendi la corsia libera e lascia sempre almeno 1,5 metri.",
  },
  {
    id: "RF03",
    displayCode: "RF-03",
    linkedDomain: "hazard_perception",
    title: "Taglio di Precedenza",
    observedBehavior:
      "Mancata precedenza a pedoni su strisce o ciclisti su corsia preferenziale in fase di svolta.",
    correctiveAction:
      "Intervento sui doppi comandi • Rivalutazione cognitiva delle funzioni attentive.",
    studentTip:
      "Prima di svoltare o avvicinarti alle strisce, rallenta presto e controlla sempre specchietto e angolo cieco per dare precedenza a pedoni e ciclisti.",
  },
];

const GROW_PROMPT_ENTRIES: readonly GrowPromptEntry[] = [
  {
    phase: "G",
    title: "G — Goal (Obiettivo)",
    question:
      "«Qual era il tuo obiettivo di sicurezza verso i ciclisti e i pedoni all'inizio della sessione?»",
  },
  {
    phase: "R",
    title: "R — Reality (Realtà)",
    question:
      "«Come descriveresti lo spazio laterale che hai lasciato al monopattino sulla destra? Ti sei sentito vicino?»",
  },
  {
    phase: "O",
    title: "O — Options (Opzioni)",
    question:
      "«Cosa avresti potuto fare diversamente alla rotonda prima di iniziare la manovra di svolta?»",
  },
  {
    phase: "W",
    title: "W — Will (Volontà)",
    question:
      "«Cosa cambierai concretamente nella prossima guida per mantenere automaticamente 1,5 metri?»",
  },
];

function indexById<T extends { readonly id: string }>(
  items: readonly T[],
): Readonly<Record<string, T>> {
  const map: Record<string, T> = {};
  for (const item of items) {
    map[item.id] = item;
  }
  return map;
}

export const VRU_RUBRIC: RubricDefinition = {
  version: RUBRIC_VERSION,
  domains: DOMAIN_ENTRIES,
  domainsById: indexById(DOMAIN_ENTRIES) as Readonly<
    Record<DomainId, DomainRubricEntry>
  >,
  redFlags: RED_FLAG_ENTRIES,
  redFlagsById: indexById(RED_FLAG_ENTRIES) as Readonly<
    Record<RedFlagId, RedFlagRubricEntry>
  >,
  growPrompts: GROW_PROMPT_ENTRIES,
  positiveConfirmationTip:
    "Ottima consapevolezza verso gli utenti vulnerabili: mantieni questi automatismi anche in condizioni di pioggia, buio o stanchezza.",
};

export const VEHICLE_LABELS: Readonly<Record<VehicleType, string>> = {
  B: "Patente B",
  C_D: "Patente C/D",
  ALTRO: "Altro",
};

export const WEATHER_LABELS: Readonly<Record<WeatherType, string>> = {
  sereno: "Sereno",
  pioggia: "Pioggia",
};

export const LIGHT_LABELS: Readonly<Record<LightType, string>> = {
  giorno: "Giorno",
  buio: "Buio",
};

export const KM_BUCKET_LABELS: Readonly<Record<KmBucket, string>> = {
  lt_10: "< 10 km",
  "10_20": "10–20 km",
  gt_20: "> 20 km",
};

export const OUTCOME_LABELS: Readonly<Record<FinalOutcome, string>> = {
  IDONEO: "IDONEO",
  MODULO_INTEGRATIVO: "MODULO INTEGRATIVO",
  NON_IDONEO: "NON IDONEO",
};

export const CALIBRATION_LABELS: Readonly<Record<CalibrationBand, string>> = {
  critical_overconfidence: "Sovrastima critica",
  mild_overconfidence: "Sovrastima lieve",
  aligned: "Valutazione allineata",
  underconfidence: "Sottostima",
};

export const CALIBRATION_HINTS: Readonly<Record<CalibrationBand, string>> = {
  critical_overconfidence:
    "Hai valutato la guida molto più sicura rispetto all'osservazione dell'istruttore: rileggi i punti ciechi.",
  mild_overconfidence:
    "Leggera tendenza a sopravvalutare la guida su alcuni aspetti: utile confrontare i singoli domini.",
  aligned:
    "La tua percezione della guida è coerente con la valutazione dell'istruttore.",
  underconfidence:
    "Hai guidato meglio di quanto percepito: consolida fiducia mantenendo alta la vigilanza.",
};
