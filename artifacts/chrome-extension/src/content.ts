const JOBSAGE_PILL_ID = "jobsage-extension-root";

const PILL_STYLES = `
  :host {
    all: initial;
  }

  #jobsage-pill {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: #1a56db;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    transition: background 0.15s ease, transform 0.1s ease;
    user-select: none;
  }

  #jobsage-pill:hover {
    background: #1e40af;
    transform: translateY(-1px);
  }

  #jobsage-pill:active {
    transform: translateY(0);
  }

  #jobsage-pill-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
`;

function mountSidebar(): void {
  if (document.getElementById(JOBSAGE_PILL_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = JOBSAGE_PILL_ID;

  const shadowRoot = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = PILL_STYLES;

  const pill = document.createElement("button");
  pill.id = "jobsage-pill";
  pill.setAttribute("aria-label", "Open JOBSAGE");
  pill.setAttribute("title", "Open JOBSAGE");

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.id = "jobsage-pill-icon";
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "16 3 21 3 21 8");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "10");
  line.setAttribute("y1", "14");
  line.setAttribute("x2", "21");
  line.setAttribute("y2", "3");

  icon.appendChild(path);
  icon.appendChild(polyline);
  icon.appendChild(line);

  const label = document.createElement("span");
  label.textContent = "JOBSAGE";

  pill.appendChild(icon);
  pill.appendChild(label);

  pill.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "PILL_CLICKED" });
  });

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(pill);

  document.body.appendChild(host);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountSidebar);
} else {
  mountSidebar();
}
