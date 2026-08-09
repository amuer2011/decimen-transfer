const picker = window.decimenPicker;
const sourcePage = document.getElementById("source-page");
const previewPage = document.getElementById("preview-page");
const sourceGroups = document.getElementById("source-groups");
const previewFrame = document.getElementById("preview-frame");
const previewMark = document.getElementById("preview-mark");
const previewKind = document.getElementById("preview-kind");
const previewName = document.getElementById("preview-name");
const useButton = document.getElementById("use-button");
let selectedSource = null;

function sourceIcon(source, className = "source-icon") {
  if (source.appIcon) {
    const image = document.createElement("img");
    image.className = className;
    image.src = source.appIcon;
    image.alt = "";
    return image;
  }
  const icon = document.createElement("span");
  icon.className = `${className} generic-icon ${source.kind === "Display" ? "display-icon" : "window-icon"}`;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function sourceThumbnail(source, className = "source-thumbnail") {
  if (source.thumbnail) {
    const image = document.createElement("img");
    image.className = className;
    image.src = source.thumbnail;
    image.alt = "";
    return image;
  }
  const empty = document.createElement("div");
  empty.className = `${className} thumbnail-empty`;
  empty.textContent = "No preview";
  return empty;
}

function showPreview(source) {
  selectedSource = source;
  sourcePage.hidden = true;
  previewPage.hidden = false;
  previewFrame.replaceChildren(sourceThumbnail(source, "preview-image"));
  previewMark.replaceChildren(sourceIcon(source, "preview-icon"));
  previewKind.textContent = source.kind;
  previewName.textContent = source.name;
  useButton.focus();
}

function showSources(sources) {
  sourceGroups.replaceChildren();
  const displays = sources.filter((source) => source.kind === "Display");
  const windows = sources.filter((source) => source.kind === "Window");
  const grid = document.createElement("div");
  grid.className = "source-grid";
  for (const source of [...displays, ...windows]) {
    const button = document.createElement("button");
    button.className = "source-tile";
    button.type = "button";
    button.title = source.name;
    button.append(sourceThumbnail(source), document.createElement("span"));
    const label = button.lastElementChild;
    label.className = "source-label";
    const name = document.createElement("span");
    name.className = "source-name";
    name.textContent = source.name;
    label.append(sourceIcon(source), name);
    button.addEventListener("click", () => showPreview(source));
    grid.append(button);
  }
  if (grid.children.length > 0) {
    sourceGroups.append(grid);
  } else {
    const empty = document.createElement("div");
    empty.className = "loading-state error-state";
    empty.textContent = "No screen or window sources are available.";
    sourceGroups.append(empty);
  }
}

document.getElementById("cancel-top").addEventListener("click", () => picker.cancel());
document.getElementById("cancel-preview").addEventListener("click", () => picker.cancel());
document.getElementById("back-button").addEventListener("click", () => {
  selectedSource = null;
  previewPage.hidden = true;
  sourcePage.hidden = false;
});
useButton.addEventListener("click", () => {
  if (selectedSource) picker.confirm(selectedSource.id);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") picker.cancel();
});

picker.onSources(showSources);
picker.ready();
