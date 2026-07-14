const status = document.querySelector("#status");
const catalog = document.querySelector("#catalog");
const count = document.querySelector("#catalog-count");

async function load(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

async function render() {
  try {
    const data = await load("/api/status");
    const detected = data.agents.filter((agent) => agent.installed);
    status.className = "state success";
    status.innerHTML = detected.length ? `<strong>${detected.length} agent${detected.length === 1 ? "" : "s"} detected</strong><span>${detected.map((agent) => escapeHtml(agent.displayName)).join(" · ")}</span>` : "No supported agent detected on PATH. Install one, then refresh.";
  } catch (error) { status.className = "state error"; status.textContent = `Could not load status: ${error.message}`; }
  try {
    const data = await load("/api/catalog");
    count.textContent = `${data.packages.length} packages`;
    if (!data.packages.length) { catalog.textContent = "The catalog is empty. Refresh it with loadout catalog --refresh."; return; }
    catalog.className = "grid";
    catalog.innerHTML = data.packages.map((pkg) => `<article><h3>${escapeHtml(pkg.displayName)}</h3><p>${escapeHtml(pkg.description || "No description available.")}</p><small>${escapeHtml(pkg.repository)} · ${escapeHtml(pkg.tier)}${pkg.stars == null ? "" : ` · ★${pkg.stars.toLocaleString()}`}</small></article>`).join("");
  } catch (error) { catalog.className = "grid state error"; catalog.textContent = `Could not load catalog: ${error.message}`; }
}
render();
