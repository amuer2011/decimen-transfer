/** Accessible, keyboard-dismissable confirmation for actions that lose progress. */
export function confirmAction(title: string, detail: string, action: string): Promise<boolean> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className = "help-dialog";
    const heading = document.createElement("h2");
    heading.id = "confirm-title"; heading.textContent = title;
    dialog.setAttribute("aria-labelledby", heading.id);
    const body = document.createElement("p");
    body.className = "received-note"; body.textContent = detail;
    const actions = document.createElement("div"); actions.className = "note-actions";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "secondary-button";
    cancel.textContent = "返回"; cancel.autofocus = true;
    const confirm = document.createElement("button");
    confirm.type = "button"; confirm.className = "danger-button secondary-button";
    confirm.textContent = action;
    cancel.onclick = () => dialog.close();
    confirm.onclick = () => dialog.close("confirm");
    actions.append(cancel, confirm); dialog.append(heading, body, actions);
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      dialog.remove(); previous?.focus(); resolve(confirmed);
    }, {once: true});
    document.body.append(dialog); dialog.showModal();
  });
}

export function guardNavigation(active: () => boolean): void {
  let asking = false;
  let leaving = false;
  window.addEventListener("beforeunload", event => {
    if (!active() || leaving) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("click", async event => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || link.download || link.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const destination = new URL(link.href);
    if (destination.origin !== location.origin || !active()) return;
    event.preventDefault();
    if (destination.pathname === location.pathname || asking) return;
    asking = true;
    const confirmed = await confirmAction("离开当前传输？", "离开会结束当前会话，未完成的进度和未保存的结果将丢失。", "终止并离开");
    asking = false;
    if (confirmed) { leaving = true; location.assign(link.href); }
  });
}
