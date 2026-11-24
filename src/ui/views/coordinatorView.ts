import {
  buildStatsEnvelope,
  computeCoordinatorSummary,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_RECORDS,
  mergeAndDeduplicateRecords,
  parseAndValidateEnvelope,
  serializeRecordsToCsv,
} from "../../coordinator/exchange";
import { APP_VERSION, RUBRIC_VERSION, VRU_RUBRIC } from "../../domain/rubric";
import type { AnonymousStatRecord, CoordinatorSummary } from "../../domain/types";
import { downloadFileLocally, shareFileSynchronously } from "../../export/share";
import type { AppController } from "../../fsm/controller";
import {
  clearAnonymousStats,
  countAnonymousStats,
  formatLocalDate,
  getAllAnonymousStats,
  isExportReminderDue,
} from "../../storage/storage";
import { el, openConfirmDialog } from "../dom";

interface CoordinatorImportState {
  mergedRecords: AnonymousStatRecord[];
  summary: CoordinatorSummary | null;
  filesProcessed: number;
  duplicatesRemoved: number;
  rejectedCount: number;
  errors: string[];
  exportStatus: string;
}

const importState: CoordinatorImportState = {
  mergedRecords: [],
  summary: null,
  filesProcessed: 0,
  duplicatesRemoved: 0,
  rejectedCount: 0,
  errors: [],
  exportStatus: "",
};

async function handleImportedFiles(
  fileList: FileList | File[],
  rerender: () => void,
): Promise<void> {
  const files = Array.from(fileList);
  importState.errors = [];
  importState.rejectedCount = 0;
  importState.duplicatesRemoved = 0;
  importState.filesProcessed = 0;
  importState.mergedRecords = [];
  importState.summary = null;

  if (files.length === 0) {
    rerender();
    return;
  }

  if (files.length > MAX_IMPORT_FILES) {
    importState.errors.push(
      `Selezionati ${files.length} file: il limite massimo per sessione è ${MAX_IMPORT_FILES} file.`,
    );
    rerender();
    return;
  }

  const validLists: AnonymousStatRecord[][] = [];
  let runningCount = 0;

  for (const file of files) {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      importState.rejectedCount += 1;
      importState.errors.push(
        `File "${file.name}" scartato: supera il limite di 5 MB.`,
      );
      continue;
    }

    const rawText = await file.text();
    const parsed = parseAndValidateEnvelope(rawText);
    importState.filesProcessed += 1;
    importState.rejectedCount += parsed.rejectedCount;
    for (const err of parsed.errors) {
      importState.errors.push(`${file.name}: ${err}`);
    }

    runningCount += parsed.validRecords.length;
    if (runningCount > MAX_IMPORT_RECORDS) {
      importState.errors.push(
        `Superato il limite massimo di ${MAX_IMPORT_RECORDS} record importabili in una sessione.`,
      );
      rerender();
      return;
    }

    if (parsed.validRecords.length > 0) {
      validLists.push(parsed.validRecords);
    }
  }

  const { merged, duplicatesRemoved } = mergeAndDeduplicateRecords(validLists);
  importState.mergedRecords = merged;
  importState.duplicatesRemoved = duplicatesRemoved;
  importState.summary =
    merged.length > 0 ? computeCoordinatorSummary(merged) : null;
  rerender();
}

export function renderCoordinatorView(controller: AppController): HTMLElement {
  const { prefs } = controller.getSnapshot();
  const recordCount = countAnonymousStats();
  const reminderDue = isExportReminderDue(recordCount, prefs.lastStatsExportDate);

  const rerender = (): void => {
    controller.setActiveTab("coordinator");
  };

  const root = el("div", { className: "stack-actions" });

  // 1. Instructor Local Anonymous Stats Export Panel
  const exportJsonBtn = el("button", {
    className: "btn btn-primary",
    text: "Esporta statistiche anonime",
    attrs: { type: "button", "data-testid": "btn-export-stats-json" },
  });
  exportJsonBtn.disabled = recordCount === 0;
  exportJsonBtn.addEventListener("click", () => {
    const records = getAllAnonymousStats();
    const today = formatLocalDate();
    const currentMonth = today.slice(0, 7);
    const envelope = buildStatsEnvelope(records, currentMonth);
    const jsonText = JSON.stringify(envelope, null, 2);
    const file = new File(
      [jsonText],
      `statistiche-vru-gruppo-${currentMonth}.json`,
      { type: "application/json" },
    );

    void shareFileSynchronously(file, "Statistiche anonime VRU").then((res) => {
      if (res === "shared" || res === "fallback_downloaded") {
        importState.exportStatus =
          res === "shared"
            ? `File ${file.name} condiviso (${records.length} record anonimi).`
            : `File ${file.name} scaricato sul dispositivo (${records.length} record anonimi).`;
        controller.markStatsExported(today);
      } else if (res === "error") {
        importState.exportStatus = "Errore durante l'esportazione del file JSON.";
        rerender();
      }
    });
  });

  const clearBtn = el("button", {
    className: "btn btn-secondary",
    text: "Svuota archivio locale",
    attrs: { type: "button", "data-testid": "btn-clear-local-stats" },
  });
  clearBtn.disabled = recordCount === 0;
  clearBtn.addEventListener("click", () => {
    openConfirmDialog({
      title: "Svuotare l'archivio statistico locale?",
      body: "Assicurati di aver prima esportato e inviato il file JSON al coordinatore. Questa operazione cancella definitivamente i record anonimi presenti su questo telefono.",
      confirmLabel: "Svuota archivio locale",
      danger: true,
      onConfirm: () => {
        clearAnonymousStats();
        importState.exportStatus = "Archivio statistico locale svuotato.";
        rerender();
      },
    });
  });

  root.appendChild(
    el("section", { className: "card" }, [
      el("h1", { className: "card-title", text: "Statistiche Anonime (Istruttore)" }),
      el("p", {
        className: "card-subtitle",
        text: "Record aggregati a livello di gruppo (mese YYYY-MM, fascia km, voti e Red Flag; nessun nome allievo né identificativo istruttore).",
      }),
      el("div", { className: "kpi-grid" }, [
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Rilevazioni locali" }),
          el("span", {
            className: "kpi-value",
            text: String(recordCount),
            attrs: { "data-testid": "local-stats-count" },
          }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Ultimo export" }),
          el("span", {
            className: "kpi-value",
            text: prefs.lastStatsExportDate ?? "Mai",
          }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Rubrica" }),
          el("span", { className: "kpi-value", text: RUBRIC_VERSION }),
        ]),
      ]),
      reminderDue
        ? el("div", { className: "banner banner-warn", attrs: { role: "status" } }, [
            el("span", {
              text: "Promemoria: sono presenti rilevazioni anonime non esportate da almeno 5 giorni. Esporta il file JSON per evitare perdite su Safari iOS.",
            }),
          ])
        : null,
      importState.exportStatus
        ? el("div", { className: "banner banner-ok", attrs: { role: "status" } }, [
            el("span", { text: importState.exportStatus }),
          ])
        : null,
      el("div", { className: "inline-actions" }, [exportJsonBtn, clearBtn]),
      el("div", { className: "muted-footer" }, [
        el("p", {
          className: "field-hint",
          text: `Versione app v${APP_VERSION} • Rubrica ${RUBRIC_VERSION} • iOS Safari: tocca Condividi → «Aggiungi a schermata Home» → Aggiungi per mantenere il funzionamento offline e i dati locali.`,
        }),
      ]),
    ]),
  );

  // 2. Coordinator Multi-File Aggregation Panel
  const fileInput = el("input", {
    id: "coordinator-json-input",
    attrs: {
      type: "file",
      multiple: "multiple",
      accept: ".json,application/json",
      "data-testid": "coordinator-file-input",
    },
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files) {
      void handleImportedFiles(fileInput.files, rerender);
    }
  });

  const dropzone = el("div", { className: "dropzone" }, [
    el("label", {
      className: "field-label",
      text: "Seleziona o trascina uno o più file .json esportati dagli istruttori",
      attrs: { for: "coordinator-json-input" },
    }),
    fileInput,
    el("p", {
      className: "field-hint",
      text: "Limiti: max 50 file, 5 MB/file, 10.000 record. Deduplicazione automatica tramite evaluationId.",
    }),
  ]);

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dropzone-active");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone-active");
    if (e.dataTransfer?.files) {
      void handleImportedFiles(e.dataTransfer.files, rerender);
    }
  });

  const coordChildren: Array<Node | null> = [
    el("h2", { className: "card-title", text: "Vista Coordinatore (Aggregazione Locale)" }),
    el("p", {
      className: "card-subtitle",
      text: "Carica i file JSON mensili di gruppo per consultare le medie aggregate ed esportare il file CSV per Excel o Fogli Google.",
    }),
    dropzone,
  ];

  if (importState.filesProcessed > 0 || importState.errors.length > 0) {
    coordChildren.push(
      el("div", { className: "banner banner-ok", attrs: { "data-testid": "import-report" } }, [
        el("span", {
          text: `File elaborati: ${importState.filesProcessed} • Record validi unici: ${importState.mergedRecords.length} • Duplicati rimossi: ${importState.duplicatesRemoved} • Scartati: ${importState.rejectedCount}`,
        }),
      ]),
    );
  }

  if (importState.errors.length > 0) {
    coordChildren.push(
      el("div", { className: "banner banner-danger" }, [
        el(
          "ul",
          { className: "rubric-list" },
          importState.errors.slice(0, 8).map((msg) => el("li", { text: msg })),
        ),
      ]),
    );
  }

  const summary = importState.summary;
  if (summary) {
    if (summary.lowSampleWarning) {
      coordChildren.push(
        el(
          "div",
          {
            className: "banner banner-warn",
            attrs: { "data-testid": "low-sample-warning" },
          },
          [
            el("span", {
              text: `Campione ridotto (${summary.totalEvaluations} guide < 5): per tutelare l'anonimato di gruppo, aggrega più file mensili prima di trarre conclusioni.`,
            }),
          ],
        ),
      );
    }

    const overconfPct = Math.round(summary.criticalOverconfidenceRate * 100);
    coordChildren.push(
      el("div", { className: "kpi-grid" }, [
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Guide uniche" }),
          el("span", { className: "kpi-value", text: String(summary.totalEvaluations) }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Idonei" }),
          el("span", { className: "kpi-value", text: String(summary.outcomeCounts.IDONEO) }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Sovrastima crit." }),
          el("span", { className: "kpi-value", text: `${overconfPct}%` }),
        ]),
      ]),
      el("p", {
        className: "status-note",
        text: `Esiti — Idoneo: ${summary.outcomeCounts.IDONEO} • Modulo Integrativo: ${summary.outcomeCounts.MODULO_INTEGRATIVO} • Non Idoneo: ${summary.outcomeCounts.NON_IDONEO}`,
      }),
      el("p", {
        className: "status-note",
        text: `Red Flag — RF-01: ${summary.redFlagCounts.RF01} • RF-02: ${summary.redFlagCounts.RF02} • RF-03: ${summary.redFlagCounts.RF03}`,
      }),
    );

    // Domain averages table
    const domainRows = VRU_RUBRIC.domains.map((d) => {
      const avg = summary.domainAverages[d.id];
      const note =
        d.id === "adas" ? ` (n=${summary.adasSampleCount})` : "";
      return el("tr", {}, [
        el("td", { text: `${d.label}${note}` }),
        el("td", { text: avg.instructorMean !== null ? avg.instructorMean.toFixed(2) : "N/A" }),
        el("td", { text: avg.studentMean !== null ? avg.studentMean.toFixed(2) : "N/A" }),
      ]);
    });

    coordChildren.push(
      el("h3", { className: "section-heading", text: "Medie per dominio (1–5)" }),
      el("table", { className: "data-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Dominio" }),
            el("th", { text: "Istruttore" }),
            el("th", { text: "Allievo" }),
          ]),
        ]),
        el("tbody", {}, domainRows),
      ]),
    );

    // Monthly breakdown table
    const monthRows = summary.monthlyBreakdown.map((m) =>
      el("tr", {}, [
        el("td", { text: m.periodMonth }),
        el("td", { text: String(m.count) }),
        el("td", { text: String(m.idoneoCount) }),
        el("td", { text: String(m.redFlagSessionCount) }),
      ]),
    );

    coordChildren.push(
      el("h3", { className: "section-heading", text: "Riepilogo mensile (YYYY-MM)" }),
      el("table", { className: "data-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "Mese" }),
            el("th", { text: "Guide" }),
            el("th", { text: "Idonei" }),
            el("th", { text: "Con RF" }),
          ]),
        ]),
        el("tbody", {}, monthRows),
      ]),
    );

    const exportCsvBtn = el("button", {
      className: "btn btn-primary btn-block",
      text: "Esporta dati CSV",
      attrs: { type: "button", "data-testid": "btn-export-csv" },
    });
    exportCsvBtn.addEventListener("click", () => {
      const csvText = serializeRecordsToCsv(importState.mergedRecords);
      const currentMonth = formatLocalDate().slice(0, 7);
      const csvFile = new File(
        [csvText],
        `riepilogo-vru-gruppo-${currentMonth}.csv`,
        { type: "text/csv;charset=utf-8" },
      );
      downloadFileLocally(csvFile);
    });
    coordChildren.push(exportCsvBtn);
  }

  root.appendChild(el("section", { className: "card" }, coordChildren));
  return root;
}
