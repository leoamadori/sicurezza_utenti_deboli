import { VRU_RUBRIC } from "../../domain/rubric";
import type { AppController } from "../../fsm/controller";
import { isDomainComplete } from "../../storage/storage";
import { el, openConfirmDialog } from "../dom";

const STUDENT_SCORE_SUBLABELS: Readonly<Record<number, string>> = {
  1: "Mai",
  2: "Poco",
  3: "A volte",
  4: "Spesso",
  5: "Sempre",
};

/**
 * Blind handover views.
 * Invariant: NEVER reads or renders session.instructorScores or session.redFlags in the DOM.
 */
export function renderStudentBlindView(controller: AppController): HTMLElement {
  const { session } = controller.getSnapshot();
  const phase = session.fsmPhase;

  if (phase === "HANDOVER_TO_STUDENT") {
    const startBtn = el("button", {
      className: "btn btn-student btn-block",
      text: "Inizia autovalutazione",
      attrs: { type: "button", "data-testid": "btn-start-student" },
    });
    startBtn.addEventListener("click", () => {
      controller.startStudentSelfEval();
    });

    const cancelBtn = el("button", {
      className: "btn btn-secondary btn-block",
      text: "Annulla passaggio",
      attrs: { type: "button", "data-testid": "btn-cancel-handover" },
    });
    cancelBtn.addEventListener("click", () => {
      controller.cancelHandover();
    });

    return el("section", { className: "card shield-card" }, [
      el("h1", {
        className: "shield-title",
        text: "Valutazione istruttore nascosta",
      }),
      el("p", {
        className: "shield-lead",
        text: "Tocca «Inizia autovalutazione» e poi consegna il telefono all'allievo. I voti e le segnalazioni dell'istruttore non sono visibili.",
      }),
      el("div", { className: "stack-actions" }, [startBtn, cancelBtn]),
    ]);
  }

  if (phase === "RETURN_TO_INSTRUCTOR") {
    const revealBtn = el("button", {
      className: "btn btn-primary btn-block",
      text: "Mostra confronto ed esito",
      attrs: { type: "button", "data-testid": "btn-reveal-debrief" },
    });
    revealBtn.addEventListener("click", () => {
      controller.revealDebrief();
    });

    return el("section", { className: "card shield-card" }, [
      el("h1", {
        className: "shield-title",
        text: "Autovalutazione completata",
      }),
      el("p", {
        className: "shield-lead",
        text: "Autovalutazione completata — restituisci il telefono all'istruttore per vedere il confronto.",
      }),
      revealBtn,
    ]);
  }

  // STUDENT_SELF_EVAL
  const root = el("div", { className: "stack-actions" });

  const activeDomains = VRU_RUBRIC.domains.filter(
    (d) => !(d.id === "adas" && !session.adasAvailable),
  );

  root.appendChild(
    el("section", { className: "card" }, [
      el("h1", { className: "card-title", text: "Autovalutazione Allievo" }),
      el("p", {
        className: "card-subtitle",
        text: `Valuta sinceramente come hai guidato oggi verso pedoni, bici e monopattini (${activeDomains.length} domande da 1 a 5).`,
      }),
    ]),
  );

  activeDomains.forEach((domain, idx) => {
    const currentScore = session.studentScores[domain.id];

    const buttons = [1, 2, 3, 4, 5].map((value) => {
      const btn = el(
        "button",
        {
          className: "score-btn score-student",
          attrs: {
            type: "button",
            "aria-pressed": String(currentScore === value),
            "aria-label": `Domanda ${idx + 1}: voto ${value} (${STUDENT_SCORE_SUBLABELS[value] ?? ""})`,
            "data-testid": `student-${domain.id}-${value}`,
          },
        },
        [
          el("span", { text: String(value) }),
          el("span", {
            className: "score-btn-sub",
            text: STUDENT_SCORE_SUBLABELS[value] ?? "",
          }),
        ],
      );
      btn.addEventListener("click", () => {
        controller.setStudentScore(domain.id, value);
      });
      return btn;
    });

    root.appendChild(
      el("section", { className: "card" }, [
        el("h2", {
          className: "card-title",
          text: `${idx + 1}. ${domain.label}`,
        }),
        el("p", { className: "card-subtitle", text: domain.studentPrompt }),
        el(
          "div",
          {
            className: "score-row",
            attrs: { role: "group", "aria-label": domain.studentPrompt },
          },
          buttons,
        ),
      ]),
    );
  });

  const completeReady = isDomainComplete(
    session.studentScores,
    session.adasAvailable,
  );

  const completeBtn = el("button", {
    className: "btn btn-student btn-block",
    text: "Completa autovalutazione",
    attrs: { type: "button", "data-testid": "btn-complete-student" },
  });
  completeBtn.disabled = !completeReady;
  completeBtn.addEventListener("click", () => {
    controller.completeStudentSelfEval();
  });

  const overrideBtn = el("button", {
    className: "btn btn-ghost btn-block",
    text: "Modifica dati istruttore",
    attrs: { type: "button", "data-testid": "btn-override-instructor" },
  });
  overrideBtn.addEventListener("click", () => {
    openConfirmDialog({
      title: "Riservato all'istruttore",
      body: "Stai per tornare alla schermata con i voti dell'istruttore. Conferma solo se il telefono è tornato in mano all'istruttore.",
      confirmLabel: "Continua (Passo 1 di 2)",
      twoStep: true,
      secondStepLabel: "Torna alla vista istruttore (Passo 2 di 2)",
      onConfirm: () => {
        controller.overrideBackToInstructor();
      },
    });
  });

  root.appendChild(
    el("section", { className: "card" }, [
      !completeReady
        ? el("p", {
            className: "status-note",
            text: "Rispondi a tutte le domande per completare l'autovalutazione.",
          })
        : null,
      completeBtn,
      overrideBtn,
    ]),
  );

  return root;
}
