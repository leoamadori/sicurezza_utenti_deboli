import {
  KM_BUCKET_LABELS,
  LIGHT_LABELS,
  VEHICLE_LABELS,
  VRU_RUBRIC,
  WEATHER_LABELS,
} from "../../domain/rubric";
import { detectConsistencyWarnings } from "../../domain/scoring";
import type {
  KmBucket,
  LightType,
  VehicleType,
  WeatherType,
} from "../../domain/types";
import type { AppController } from "../../fsm/controller";
import { areRedFlagsComplete, isDomainComplete } from "../../storage/storage";
import { el } from "../dom";

const SCORE_SUBLABELS: Readonly<Record<number, string>> = {
  1: "Insuff.",
  2: "Insuff.",
  3: "Sotto",
  4: "Idoneo",
  5: "Esperto",
};

export function renderInstructorView(controller: AppController): HTMLElement {
  const { session } = controller.getSnapshot();
  const root = el("div", { className: "stack-actions" });

  // 1. Metadata card
  const dateInput = el("input", {
    className: "text-input",
    id: "lesson-date-input",
    attrs: {
      type: "date",
      value: session.lessonDate,
      "aria-label": "Data della prova",
    },
  });
  dateInput.addEventListener("change", () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) {
      controller.updateInstructorMetadata({ lessonDate: dateInput.value });
    }
  });

  const vehicleChips = (["B", "C_D", "ALTRO"] as VehicleType[]).map((v) => {
    const btn = el("button", {
      className: "chip-btn",
      text: VEHICLE_LABELS[v],
      attrs: {
        type: "button",
        "aria-pressed": String(session.vehicleType === v),
      },
    });
    btn.addEventListener("click", () => {
      controller.updateInstructorMetadata({ vehicleType: v });
    });
    return btn;
  });

  const weatherChips = (["sereno", "pioggia"] as WeatherType[]).map((w) => {
    const btn = el("button", {
      className: "chip-btn",
      text: WEATHER_LABELS[w],
      attrs: {
        type: "button",
        "aria-pressed": String(session.weather === w),
      },
    });
    btn.addEventListener("click", () => {
      controller.updateInstructorMetadata({ weather: w });
    });
    return btn;
  });

  const lightChips = (["giorno", "buio"] as LightType[]).map((l) => {
    const btn = el("button", {
      className: "chip-btn",
      text: LIGHT_LABELS[l],
      attrs: {
        type: "button",
        "aria-pressed": String(session.light === l),
      },
    });
    btn.addEventListener("click", () => {
      controller.updateInstructorMetadata({ light: l });
    });
    return btn;
  });

  const kmChips = (["lt_10", "10_20", "gt_20"] as KmBucket[]).map((k) => {
    const btn = el("button", {
      className: "chip-btn",
      text: KM_BUCKET_LABELS[k],
      attrs: {
        type: "button",
        "aria-pressed": String(session.kmBucket === k),
      },
    });
    btn.addEventListener("click", () => {
      controller.updateInstructorMetadata({ kmBucket: k });
    });
    return btn;
  });

  const adasCheckbox = el("input", {
    className: "toggle-checkbox",
    id: "adas-na-toggle",
    attrs: {
      type: "checkbox",
    },
  });
  adasCheckbox.checked = !session.adasAvailable;
  adasCheckbox.addEventListener("change", () => {
    controller.updateInstructorMetadata({ adasAvailable: !adasCheckbox.checked });
  });

  const metaCard = el("section", { className: "card" }, [
    el("h1", { className: "card-title", text: "Valutazione Istruttore" }),
    el("p", {
      className: "card-subtitle",
      text: "Compila i dati della guida, i domini (1–5) e le 3 Red Flag prima di consegnare il telefono all'allievo.",
    }),
    el("div", { className: "field-grid" }, [
      el("div", { className: "field-group" }, [
        el("label", {
          className: "field-label",
          text: "Data prova",
          attrs: { for: "lesson-date-input" },
        }),
        dateInput,
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", text: "Tipo veicolo" }),
        el("div", { className: "chip-row" }, vehicleChips),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", text: "Meteo" }),
        el("div", { className: "chip-row" }, weatherChips),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", text: "Luce" }),
        el("div", { className: "chip-row" }, lightChips),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", text: "Fascia chilometri" }),
        el("div", { className: "chip-row" }, kmChips),
      ]),
      el("label", { className: "toggle-row", attrs: { for: "adas-na-toggle" } }, [
        el("span", {
          className: "field-label",
          text: "Veicolo senza ADAS (N/A — soglia 20/25)",
        }),
        adasCheckbox,
      ]),
    ]),
  ]);

  root.appendChild(metaCard);

  // 2. 6 Canonical Domains grouped by GDE Area
  let currentArea = "";
  for (const domain of VRU_RUBRIC.domains) {
    if (domain.areaLabel !== currentArea) {
      currentArea = domain.areaLabel;
      root.appendChild(el("h2", { className: "section-heading", text: currentArea }));
    }

    const isDisabledAdas = domain.id === "adas" && !session.adasAvailable;
    const currentScore = session.instructorScores[domain.id];

    const cardChildren: Array<Node | null> = [
      el("div", { className: "rf-header" }, [
        el("h3", { className: "card-title", text: domain.label }),
        el("span", { className: "na-badge", text: domain.gdeArea }),
      ]),
    ];

    if (isDisabledAdas) {
      cardChildren.push(
        el("p", {
          className: "card-subtitle",
          text: "Non applicabile (veicolo privo di ADAS): escluso dalla valutazione istruttore, dall'autovalutazione allievo e dal denominatore.",
        }),
      );
    } else {
      const scoreButtons = [1, 2, 3, 4, 5].map((value) => {
        const btn = el(
          "button",
          {
            className: "score-btn",
            attrs: {
              type: "button",
              "aria-pressed": String(currentScore === value),
              "aria-label": `${domain.label}: voto ${value} (${SCORE_SUBLABELS[value] ?? ""})`,
              "data-testid": `instructor-${domain.id}-${value}`,
            },
          },
          [
            el("span", { text: String(value) }),
            el("span", {
              className: "score-btn-sub",
              text: SCORE_SUBLABELS[value] ?? "",
            }),
          ],
        );
        btn.addEventListener("click", () => {
          controller.setInstructorScore(domain.id, value);
        });
        return btn;
      });

      const rubricDetails = el("details", { className: "rubric-details" }, [
        el("summary", { text: "Descrittori rubrica (1–5)" }),
        el("ul", { className: "rubric-list" }, [
          el("li", { text: `1–2 (Insufficiente): ${domain.instructorDescriptors.insufficient}` }),
          el("li", { text: `3 (Sotto soglia): ${domain.instructorDescriptors.level3}` }),
          el("li", { text: `4 (Idoneo): ${domain.instructorDescriptors.level4}` }),
          el("li", { text: `5 (Esperto): ${domain.instructorDescriptors.expert}` }),
        ]),
      ]);

      cardChildren.push(
        el("div", { className: "score-row", attrs: { role: "group", "aria-label": domain.label } }, scoreButtons),
        rubricDetails,
      );
    }

    root.appendChild(el("section", { className: "card" }, cardChildren));
  }

  // 3. 3 Red Flags (explicit NO / SÌ confirmation)
  root.appendChild(
    el("h2", {
      className: "section-heading",
      text: "Criteri di esclusione immediata — Red Flag (conferma obbligatoria)",
    }),
  );

  for (const rf of VRU_RUBRIC.redFlags) {
    const val = session.redFlags[rf.id];
    const noBtn = el("button", {
      className: "chip-btn chip-ok",
      text: "NO",
      attrs: {
        type: "button",
        "aria-pressed": String(val === false),
        "data-testid": `rf-${rf.id}-no`,
      },
    });
    noBtn.addEventListener("click", () => {
      controller.setRedFlag(rf.id, false);
    });

    const yesBtn = el("button", {
      className: "chip-btn chip-danger",
      text: "SÌ — Rilevata",
      attrs: {
        type: "button",
        "aria-pressed": String(val === true),
        "data-testid": `rf-${rf.id}-yes`,
      },
    });
    yesBtn.addEventListener("click", () => {
      controller.setRedFlag(rf.id, true);
    });

    root.appendChild(
      el("section", { className: "card rf-card" }, [
        el("div", { className: "rf-header" }, [
          el("h3", { className: "card-title", text: rf.title }),
          el("span", { className: "rf-badge", text: rf.displayCode }),
        ]),
        el("p", { className: "card-subtitle", text: rf.observedBehavior }),
        el("div", { className: "chip-row" }, [noBtn, yesBtn]),
      ]),
    );
  }

  // Consistency warnings (non-blocking)
  const warnings = detectConsistencyWarnings(session, VRU_RUBRIC);
  for (const w of warnings) {
    root.appendChild(
      el("div", { className: "banner banner-warn", attrs: { role: "status" } }, [
        el("span", { text: w.message }),
      ]),
    );
  }

  // 4. Handover Action
  const domainsReady = isDomainComplete(
    session.instructorScores,
    session.adasAvailable,
  );
  const redFlagsReady = areRedFlagsComplete(session.redFlags);
  const canProceed = domainsReady && redFlagsReady;

  const missingParts: string[] = [];
  if (!domainsReady) {
    missingParts.push(
      session.adasAvailable
        ? "tutti i 6 domini (1–5)"
        : "tutti i 5 domini attivi (1–5)",
    );
  }
  if (!redFlagsReady) {
    missingParts.push("le 3 Red Flag (NO/SÌ)");
  }

  const handoverBtn = el("button", {
    className: "btn btn-primary btn-block",
    text: "Passa all'allievo",
    attrs: {
      type: "button",
      "data-testid": "btn-enter-handover",
    },
  });
  handoverBtn.disabled = !canProceed;
  handoverBtn.addEventListener("click", () => {
    controller.enterHandover();
  });

  root.appendChild(
    el("section", { className: "card" }, [
      !canProceed
        ? el("p", {
            className: "status-note",
            text: `Per procedere completa: ${missingParts.join(" e ")}.`,
          })
        : el("p", {
            className: "status-note",
            text: "Valutazione istruttore completa. Tocca il pulsante per bloccare i tuoi voti prima di consegnare il telefono.",
          }),
      handoverBtn,
    ]),
  );

  return root;
}
