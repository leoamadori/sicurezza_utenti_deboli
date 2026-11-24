import { registerSW } from "virtual:pwa-register";
import { AppController, isBlindPhase } from "./fsm/controller";
import { isStorageAvailable } from "./storage/storage";
import { el } from "./ui/dom";
import "./ui/styles.css";
import { renderCoordinatorView } from "./ui/views/coordinatorView";
import { renderDebriefView } from "./ui/views/debriefView";
import { renderInstructorView } from "./ui/views/instructorView";
import { renderStudentBlindView } from "./ui/views/studentBlindView";

let updateAvailable = false;
let applySwUpdate: (() => Promise<void>) | null = null;
let iosBannerDismissed = false;

function isIosNonStandalone(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return isIos && !isStandalone;
}

function requestStoragePersistenceSilently(): void {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.persist === "function"
    ) {
      void navigator.storage.persist().catch(() => {
        // Ignore refusal without notifying user
      });
    }
  } catch {
    // Ignore unsupported storage manager
  }
}

const rootEl = document.getElementById("app");
const controller = new AppController();

function renderApp(): void {
  if (!rootEl) {
    return;
  }

  const snapshot = controller.getSnapshot();
  const { activeTab, session, prefs } = snapshot;
  const blind = isBlindPhase(session.fsmPhase);

  document.documentElement.dataset.theme = prefs.themePreference;

  const shell = el("div", { className: "app-shell" });

  // Top navigation hidden during blind student phases
  if (!blind) {
    const evalBtn = el("button", {
      className: "nav-btn",
      text: "Valutazione",
      attrs: {
        type: "button",
        "aria-current": activeTab === "evaluation" ? "page" : "false",
        "data-testid": "nav-evaluation",
      },
    });
    evalBtn.addEventListener("click", () => controller.setActiveTab("evaluation"));

    const coordBtn = el("button", {
      className: "nav-btn",
      text: "Statistiche",
      attrs: {
        type: "button",
        "aria-current": activeTab === "coordinator" ? "page" : "false",
        "data-testid": "nav-coordinator",
      },
    });
    coordBtn.addEventListener("click", () => controller.setActiveTab("coordinator"));

    const themeBtn = el("button", {
      className: "nav-btn",
      text: prefs.themePreference === "dark" ? "Tema chiaro" : "Tema scuro",
      attrs: {
        type: "button",
        "aria-label": "Cambia tema chiaro o scuro",
        "data-testid": "nav-theme-toggle",
      },
    });
    themeBtn.addEventListener("click", () => controller.toggleTheme());

    const topbar = el("header", { className: "topbar" }, [
      el("div", { className: "topbar-inner" }, [
        el("span", { className: "topbar-brand", text: "Valutazione VRU" }),
        el("nav", { className: "topbar-nav", attrs: { "aria-label": "Principale" } }, [
          evalBtn,
          coordBtn,
          themeBtn,
        ]),
      ]),
    ]);
    shell.appendChild(topbar);
  }

  const main = el("main", { className: "main-container" });

  // Storage unavailable warning (private browsing / restricted WebView)
  if (!isStorageAvailable() && !blind) {
    main.appendChild(
      el("div", { className: "banner banner-danger", attrs: { role: "alert" } }, [
        el("span", {
          text: "Archiviazione locale bloccata (Navigazione Privata o browser in-app). Apri l'app in Safari o Chrome per conservare le statistiche offline.",
        }),
      ]),
    );
  }

  // Deferred PWA update banner (shown strictly when session is idle)
  if (updateAvailable && controller.isSessionIdle() && !blind) {
    const updateBtn = el("button", {
      className: "btn btn-primary",
      text: "Aggiorna app",
      attrs: { type: "button" },
    });
    updateBtn.addEventListener("click", () => {
      if (applySwUpdate) {
        void applySwUpdate();
      }
    });
    main.appendChild(
      el("div", { className: "banner banner-ok", attrs: { role: "status" } }, [
        el("span", { text: "Nuova versione dell'app pronta." }),
        updateBtn,
      ]),
    );
  }

  // iOS non-standalone install hint (dismissible, only when not blind)
  if (isIosNonStandalone() && !iosBannerDismissed && !blind) {
    const dismissBtn = el("button", {
      className: "btn btn-ghost",
      text: "Chiudi",
      attrs: { type: "button" },
    });
    dismissBtn.addEventListener("click", () => {
      iosBannerDismissed = true;
      renderApp();
    });
    main.appendChild(
      el("div", { className: "banner banner-warn" }, [
        el("span", {
          text: "Su iPhone/iPad: tocca Condividi → «Aggiungi a schermata Home» per garantire l'uso offline e prevenire la pulizia dei dati dopo 7 giorni.",
        }),
        dismissBtn,
      ]),
    );
  }

  if (activeTab === "coordinator" && !blind) {
    main.appendChild(renderCoordinatorView(controller));
  } else if (blind) {
    main.appendChild(renderStudentBlindView(controller));
  } else if (session.fsmPhase === "REVEAL_DEBRIEF") {
    main.appendChild(renderDebriefView(controller));
  } else {
    main.appendChild(renderInstructorView(controller));
  }

  shell.appendChild(main);
  rootEl.replaceChildren(shell);
}

controller.subscribe(renderApp);
controller.init();
requestStoragePersistenceSilently();

const updateSW = registerSW({
  onNeedRefresh() {
    updateAvailable = true;
    applySwUpdate = () => updateSW(true);
    renderApp();
  },
  onOfflineReady() {
    // Precache completed silently
  },
});
