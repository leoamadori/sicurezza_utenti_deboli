export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: {
    className?: string;
    text?: string;
    id?: string;
    attrs?: Record<string, string>;
  },
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options?.className) {
    node.className = options.className;
  }
  if (options?.id) {
    node.id = options.id;
  }
  if (options?.text !== undefined) {
    node.textContent = options.text;
  }
  if (options?.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) {
      node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) {
      continue;
    }
    if (typeof child === "string") {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function openConfirmDialog(options: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  twoStep?: boolean;
  secondStepLabel?: string;
  onConfirm: () => void;
}): void {
  const dialog = el("dialog", {
    className: "app-dialog",
    attrs: { "aria-modal": "true" },
  });

  let step = 1;

  const heading = el("h2", { className: "dialog-title", text: options.title });
  const message = el("p", { className: "dialog-body", text: options.body });

  const cancelBtn = el("button", {
    className: "btn btn-secondary",
    text: options.cancelLabel ?? "Annulla",
    attrs: { type: "button" },
  });

  const confirmBtn = el("button", {
    className: options.danger ? "btn btn-danger" : "btn btn-primary",
    text: options.confirmLabel,
    attrs: { type: "button" },
  });

  const cleanup = (): void => {
    if (dialog.open) {
      dialog.close();
    }
    dialog.remove();
  };

  cancelBtn.addEventListener("click", cleanup);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    cleanup();
  });

  confirmBtn.addEventListener("click", () => {
    if (options.twoStep && step === 1) {
      step = 2;
      confirmBtn.textContent =
        options.secondStepLabel ?? "Conferma definitivamente";
      message.textContent =
        "Conferma una seconda volta per procedere con l'operazione.";
      return;
    }
    cleanup();
    options.onConfirm();
  });

  const actions = el("div", { className: "dialog-actions" }, [
    cancelBtn,
    confirmBtn,
  ]);
  dialog.append(heading, message, actions);
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}
