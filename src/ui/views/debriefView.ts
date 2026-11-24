import { OUTCOME_LABELS, VRU_RUBRIC } from "../../domain/rubric";
import { determineOutcomeConstraints } from "../../domain/scoring";
import type { FinalOutcome } from "../../domain/types";
import { downloadFileLocally, shareFileSynchronously } from "../../export/share";
import type { AppController } from "../../fsm/controller";
import { el, openConfirmDialog } from "../dom";

let showAllTipsExpanded = false;
let shareStatusMessage = "";

function outcomePillClass(outcome: FinalOutcome): string {
  if (outcome === "IDONEO") {
    return "outcome-pill outcome-idoneo";
  }
  if (outcome === "MODULO_INTEGRATIVO") {
    return "outcome-pill outcome-modulo";
  }
  return "outcome-pill outcome-non-idoneo";
}

function openPngPreviewDialog(previewUrl: string, fileName: string): void {
  const dialog = el("dialog", {
    className: "app-dialog",
    attrs: { "aria-modal": "true" },
  });

  const img = el("img", {
    className: "preview-img",
    attrs: {
      src: previewUrl,
      alt: `Anteprima ${fileName}`,
    },
  });

  const closeBtn = el("button", {
    className: "btn btn-primary",
    text: "Chiudi anteprima",
    attrs: { type: "button" },
  });
  const cleanup = (): void => {
    if (dialog.open) {
      dialog.close();
    }
    dialog.remove();
  };
  closeBtn.addEventListener("click", cleanup);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    cleanup();
  });

  dialog.append(
    el("h2", { className: "dialog-title", text: "Anteprima PNG" }),
    el("p", {
      className: "dialog-body",
      text: "Su iPhone o iPad in modalità schermata Home: tieni premuto sull'immagine e seleziona «Salva in Foto».",
    }),
    img,
    el("div", { className: "dialog-actions" }, [closeBtn]),
  );
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

export function renderDebriefView(controller: AppController): HTMLElement {
  const snapshot = controller.getSnapshot();
  const { session, ramState, cachedPngFile, pngPreviewUrl, pngGenerating, pngError } =
    snapshot;
  const vm = controller.getCurrentReportViewModel();

  if (!vm) {
    return el("section", { className: "card" }, [
      el("p", { text: "Nessuna valutazione pronta per il debriefing." }),
    ]);
  }

  const constraints = determineOutcomeConstraints(vm.metrics, session.redFlags);
  const root = el("div", { className: "stack-actions" });

  // 1. Outcome Header Card
  const outcomeSectionChildren: Array<Node | null> = [
    el("h1", { className: "card-title", text: "Confronto e Debriefing" }),
    el("p", {
      className: "card-subtitle",
      text: `${vm.lessonDate} • ${vm.vehicleLabel} • ${vm.kmBucketLabel} • ${vm.weatherLabel} / ${vm.lightLabel}`,
    }),
  ];

  if (constraints.autoOutcome === "IDONEO" && vm.finalOutcome === "IDONEO") {
    outcomeSectionChildren.push(
      el("div", {}, [
        el("span", {
          className: outcomePillClass("IDONEO"),
          text: OUTCOME_LABELS.IDONEO,
          attrs: { "data-testid": "outcome-badge" },
        }),
      ]),
    );
    if (constraints.lowDomainWarning) {
      outcomeSectionChildren.push(
        el("div", { className: "banner banner-warn", attrs: { role: "status" } }, [
          el("span", {
            text: "Avviso didattico: punteggio complessivo in soglia, ma almeno un dominio ha voto insufficiente (1–2). Approfondiscilo nel debriefing.",
          }),
        ]),
      );
    }
  } else {
    const choiceButtons = constraints.allowedOutcomes.map((opt) => {
      const btn = el("button", {
        className:
          opt === "NON_IDONEO"
            ? "chip-btn chip-danger"
            : "chip-btn chip-student",
        text: OUTCOME_LABELS[opt],
        attrs: {
          type: "button",
          "aria-pressed": String(vm.finalOutcome === opt),
          "data-testid": `outcome-select-${opt}`,
        },
      });
      btn.addEventListener("click", () => {
        shareStatusMessage = "";
        controller.setFinalOutcome(opt);
      });
      return btn;
    });

    outcomeSectionChildren.push(
      el("p", {
        className: "status-note",
        text:
          vm.finalOutcome === null
            ? "Esito IDONEO bloccato (punteggio sotto soglia o Red Flag presente). Seleziona l'esito finale prima di esportare il PNG o iniziare una nuova guida:"
            : `Esito selezionato: ${OUTCOME_LABELS[vm.finalOutcome]} (modificabile prima di iniziare una nuova valutazione).`,
      }),
      el("div", { className: "chip-row" }, choiceButtons),
    );
    if (vm.finalOutcome !== null) {
      outcomeSectionChildren.push(
        el("div", {}, [
          el("span", {
            className: outcomePillClass(vm.finalOutcome),
            text: OUTCOME_LABELS[vm.finalOutcome],
            attrs: { "data-testid": "outcome-badge" },
          }),
        ]),
      );
    }
  }

  root.appendChild(el("section", { className: "card" }, outcomeSectionChildren));

  // 2. Scores & Calibration KPIs
  const deltaSign = vm.metrics.overconfidenceDelta > 0 ? "+" : "";
  root.appendChild(
    el("section", { className: "card" }, [
      el("h2", { className: "card-title", text: "Punteggi e Calibrazione" }),
      el("div", { className: "kpi-grid" }, [
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Istruttore (I)" }),
          el("span", {
            className: "kpi-value",
            text: `${vm.metrics.totalI}/${vm.metrics.maxScore}`,
          }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Allievo (A)" }),
          el("span", {
            className: "kpi-value",
            text: `${vm.metrics.totalA}/${vm.metrics.maxScore}`,
          }),
        ]),
        el("div", { className: "kpi-box" }, [
          el("span", { className: "kpi-label", text: "Scarto (A - I)" }),
          el("span", {
            className: "kpi-value",
            text: `${deltaSign}${vm.metrics.overconfidenceDelta}`,
          }),
        ]),
      ]),
      el(
        "div",
        {
          className: vm.metrics.isOverconfidenceCritical
            ? "banner banner-danger"
            : "banner banner-ok",
        },
        [
          el("strong", { text: vm.calibrationLabel }),
          el("span", { text: vm.calibrationHint }),
        ],
      ),
    ]),
  );

  // 3. HTML/CSS Horizontal Comparison Bar Chart (zero inline styles)
  const chartRows = vm.domainRows.map((row) => {
    const head = el("div", { className: "chart-row-head" }, [
      el("span", { text: row.label }),
      row.isBlindSpot
        ? el("span", { className: "blind-spot-tag", text: "Punto cieco" })
        : null,
    ]);

    if (row.instructorScore === null || row.studentScore === null) {
      return el("div", { className: "chart-row" }, [
        head,
        el("span", { className: "na-badge", text: "N/A (veicolo senza ADAS)" }),
      ]);
    }

    const iClass = `bar-fill bar-fill-instructor bar-w-${row.instructorScore}`;
    const aClass = `bar-fill bar-fill-student bar-w-${row.studentScore}`;

    const tracks = el(
      "div",
      {
        className: "bar-tracks-wrap",
        attrs: {
          "aria-label": `${row.label}: istruttore ${row.instructorScore} su 5, allievo ${row.studentScore} su 5`,
        },
      },
      [
        el("div", { className: "bar-track" }, [
          el("div", { className: iClass }),
          el("span", { className: "bar-score-label", text: `I: ${row.instructorScore}` }),
        ]),
        el("div", { className: "bar-track" }, [
          el("div", { className: aClass }),
          el("span", { className: "bar-score-label", text: `A: ${row.studentScore}` }),
        ]),
        el("div", {
          className: "chart-threshold-line",
          attrs: { "aria-hidden": "true" },
        }),
      ],
    );

    return el("div", { className: "chart-row" }, [head, tracks]);
  });

  root.appendChild(
    el(
      "section",
      {
        className: "card",
        attrs: { role: "region", "aria-label": "Grafico confronto domini" },
      },
      [
        el("h2", {
          className: "card-title",
          text: `Confronto Domini (Soglia idoneità ${vm.metrics.passThreshold}/${vm.metrics.maxScore})`,
        }),
        el("div", { className: "chart-legend" }, [
          el("span", { className: "legend-item" }, [
            el("span", { className: "legend-swatch swatch-instructor" }),
            "Istruttore",
          ]),
          el("span", { className: "legend-item" }, [
            el("span", { className: "legend-swatch swatch-student" }),
            "Allievo",
          ]),
          el("span", { className: "legend-item" }, [
            el("span", { className: "legend-swatch swatch-threshold" }),
            "Soglia 4/5",
          ]),
        ]),
        el("div", { className: "chart-rows" }, chartRows),
      ],
    ),
  );

  // 4. Red Flags Summary Card
  if (vm.activeRedFlags.length === 0) {
    root.appendChild(
      el("div", { className: "banner banner-ok" }, [
        el("strong", { text: "0 Red Flag rilevate durante la prova." }),
      ]),
    );
  } else {
    root.appendChild(
      el("section", { className: "card rf-card" }, [
        el("h2", {
          className: "card-title",
          text: `Red Flag rilevate (${vm.activeRedFlags.length})`,
        }),
        ...vm.activeRedFlags.map((rf) =>
          el("div", { className: "tip-item tip-item-rf" }, [
            el("span", {
              className: "tip-code",
              text: `${rf.displayCode} — ${rf.title}`,
            }),
            el("span", { text: rf.correctiveAction }),
          ]),
        ),
      ]),
    );
  }

  // 5. Canonical Read-Only GROW Card (collapsible)
  const growDetails = el("details", { className: "rubric-details" }, [
    el("summary", { text: "Scheda Debriefing GROW (4 domande guida)" }),
    el(
      "div",
      { className: "grow-list" },
      VRU_RUBRIC.growPrompts.map((gp) =>
        el("div", { className: "grow-item" }, [
          el("strong", { text: gp.title }),
          el("span", { text: gp.question }),
        ]),
      ),
    ),
  ]);
  root.appendChild(el("section", { className: "card" }, [growDetails]));

  // 6. Deterministic Review Tips Card
  const visibleTips = showAllTipsExpanded ? vm.allTips : vm.pngTips;
  const tipNodes = visibleTips.map((tip) => {
    const cls =
      tip.source === "red_flag"
        ? "tip-item tip-item-rf"
        : tip.source === "positive"
          ? "tip-item tip-item-positive"
          : "tip-item";
    return el("li", { className: cls }, [
      el("span", { className: "tip-code", text: tip.code }),
      el("span", { text: tip.text }),
    ]);
  });

  const tipsCardChildren: Array<Node | null> = [
    el("h2", { className: "card-title", text: "Promemoria per il ripasso" }),
    el("ul", { className: "tip-list" }, tipNodes),
  ];

  if (vm.allTips.length > 4) {
    const toggleTipsBtn = el("button", {
      className: "btn btn-ghost",
      text: showAllTipsExpanded
        ? "Mostra solo i 4 consigli inclusi nel PNG"
        : `Mostra tutti i consigli (${vm.allTips.length})`,
      attrs: { type: "button" },
    });
    toggleTipsBtn.addEventListener("click", () => {
      showAllTipsExpanded = !showAllTipsExpanded;
      controller.setActiveTab("evaluation");
    });
    tipsCardChildren.push(toggleTipsBtn);
  }

  root.appendChild(el("section", { className: "card" }, tipsCardChildren));

  // 7. Export PNG & Reset Card
  const labelInput = el("input", {
    className: "text-input",
    id: "student-label-input",
    attrs: {
      type: "text",
      maxlength: "40",
      placeholder: "Es. Luca R. (facoltativo)",
      value: ramState.studentLabel ?? "",
      autocomplete: "off",
    },
  });
  let labelDebounceTimer: number | null = null;
  labelInput.addEventListener("input", () => {
    if (labelDebounceTimer !== null) {
      window.clearTimeout(labelDebounceTimer);
    }
    labelDebounceTimer = window.setTimeout(() => {
      controller.setStudentLabel(labelInput.value);
    }, 250);
  });
  labelInput.addEventListener("blur", () => {
    if (labelDebounceTimer !== null) {
      window.clearTimeout(labelDebounceTimer);
      labelDebounceTimer = null;
    }
    controller.setStudentLabel(labelInput.value);
  });

  const exportReady = vm.finalOutcome !== null && cachedPngFile !== null && !pngGenerating;

  const shareBtn = el("button", {
    className: "btn btn-primary",
    text: pngGenerating ? "Preparazione PNG..." : "Condividi immagine PNG",
    attrs: { type: "button", "data-testid": "btn-share-png" },
  });
  shareBtn.disabled = !exportReady;
  shareBtn.addEventListener("click", () => {
    const file = controller.getSnapshot().cachedPngFile;
    if (!file) {
      return;
    }
    void shareFileSynchronously(file, "Valutazione VRU").then((res) => {
      if (res === "shared") {
        shareStatusMessage = "Immagine PNG condivisa.";
        controller.markPngExported();
      } else if (res === "fallback_downloaded") {
        shareStatusMessage =
          "Immagine salvata sul dispositivo: condividila appena torna la rete.";
        controller.markPngExported();
      } else if (res === "error") {
        shareStatusMessage =
          "Impossibile avviare la condivisione. Usa «Anteprima PNG» o «Salva PNG».";
        controller.setActiveTab("evaluation");
      }
    });
  });

  const saveBtn = el("button", {
    className: "btn btn-secondary",
    text: "Salva PNG",
    attrs: { type: "button", "data-testid": "btn-save-png" },
  });
  saveBtn.disabled = !exportReady;
  saveBtn.addEventListener("click", () => {
    const file = controller.getSnapshot().cachedPngFile;
    if (!file) {
      return;
    }
    downloadFileLocally(file);
    shareStatusMessage =
      "Immagine salvata sul dispositivo: condividila appena torna la rete.";
    controller.markPngExported();
  });

  const previewBtn = el("button", {
    className: "btn btn-ghost btn-block",
    text: "Anteprima PNG (salvataggio manuale iOS)",
    attrs: { type: "button", "data-testid": "btn-preview-png" },
  });
  previewBtn.disabled = !exportReady || !pngPreviewUrl;
  previewBtn.addEventListener("click", () => {
    const snap = controller.getSnapshot();
    if (snap.pngPreviewUrl && snap.cachedPngFile) {
      openPngPreviewDialog(snap.pngPreviewUrl, snap.cachedPngFile.name);
      controller.markPngExported();
    }
  });

  const resetBtn = el("button", {
    className: "btn btn-danger btn-block",
    text: "Nuova valutazione",
    attrs: { type: "button", "data-testid": "btn-reset-session" },
  });
  resetBtn.disabled = vm.finalOutcome === null;
  resetBtn.addEventListener("click", () => {
    const snap = controller.getSnapshot();
    const doReset = (): void => {
      showAllTipsExpanded = false;
      shareStatusMessage = "";
      controller.resetSession();
    };
    if (!snap.ramState.pngExported) {
      openConfirmDialog({
        title: "Avviare una nuova valutazione?",
        body: "Non hai ancora condiviso o salvato il PNG per l'allievo. La statistica anonima è già stata registrata; i dati della sessione corrente verranno azzerati.",
        confirmLabel: "Azzera e inizia nuova guida",
        danger: true,
        onConfirm: doReset,
      });
    } else {
      doReset();
    }
  });

  root.appendChild(
    el("section", { className: "card" }, [
      el("h2", { className: "card-title", text: "Invia all'allievo (PNG)" }),
      el("div", { className: "field-group" }, [
        el("label", {
          className: "field-label",
          text: "Nome o iniziali allievo (opzionale)",
          attrs: { for: "student-label-input" },
        }),
        labelInput,
        el("p", {
          className: "field-hint",
          text: "Usato solo sull'immagine PNG esportata, mai salvato sul dispositivo né nelle statistiche.",
        }),
      ]),
      pngError
        ? el("div", { className: "banner banner-danger" }, [
            el("span", { text: pngError }),
          ])
        : null,
      shareStatusMessage
        ? el("div", { className: "banner banner-ok", attrs: { role: "status" } }, [
            el("span", { text: shareStatusMessage }),
          ])
        : null,
      el("div", { className: "inline-actions" }, [shareBtn, saveBtn]),
      previewBtn,
      resetBtn,
    ]),
  );

  return root;
}
