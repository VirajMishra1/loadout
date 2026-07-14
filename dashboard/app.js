const status = document.querySelector("#status");
const catalog = document.querySelector("#catalog");
const count = document.querySelector("#catalog-count");
const updates = document.querySelector("#updates");
const updatesCount = document.querySelector("#updates-count");
const health = document.querySelector("#health");
const healthLabel = document.querySelector("#health-label");
const recommendations = document.querySelector("#recommendations");
const projectSignals = document.querySelector("#project-signals");
const profiles = document.querySelector("#profiles");
const registry = document.querySelector("#registry");
const registryCount = document.querySelector("#registry-count");

async function load(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function renderUpdate(plan) {
  const label = plan.status === "update-available" ? "Update available" : plan.status === "up-to-date" ? "Up to date" : plan.status === "untracked" ? "Needs tracking" : "Could not check";
  const details = plan.diff?.length ? `<details><summary>${plan.diff.length} changed file${plan.diff.length === 1 ? "" : "s"}</summary><ul>${plan.diff.slice(0, 20).map((change) => `<li><code>${escapeHtml(change.path)}</code> <small>${escapeHtml(change.kind)}</small></li>`).join("")}</ul></details>` : "";
  return `<article class="update ${escapeHtml(plan.status)}"><div class="update-heading"><h3>${escapeHtml(plan.packageId)}</h3><span class="badge">${label}</span></div><p>${escapeHtml(plan.action)}</p>${plan.repository ? `<small>${escapeHtml(plan.repository)}${plan.availableCommit ? ` · ${escapeHtml(plan.availableCommit.slice(0, 12))}` : ""}</small>` : ""}${plan.error ? `<p class="error-text">${escapeHtml(plan.error)}</p>` : ""}${details}</article>`;
}

async function render() {
  try {
    const data = await load("/api/status");
    const detected = data.agents.filter((agent) => agent.installed);
    status.className = "state success";
    status.innerHTML = detected.length ? `<strong>${detected.length} agent${detected.length === 1 ? "" : "s"} detected</strong><span>${detected.map((agent) => escapeHtml(agent.displayName)).join(" · ")}</span>` : "No supported agent detected on PATH. Install one, then refresh.";
  } catch (error) { status.className = "state error"; status.textContent = `Could not load status: ${error.message}`; }
  try {
    const data = await load("/api/health");
    const report = data.health;
    healthLabel.textContent = report.status;
    health.className = `health-list ${report.status === "healthy" ? "success" : report.status === "unhealthy" ? "error" : "attention"}`;
    health.innerHTML = `<div class="metric-row"><strong>${report.installedPackages}</strong><span>packages</span><strong>${report.updatesAvailable}</strong><span>updates</span><strong>${report.driftedFiles}</strong><span>drifted files</span><strong>${report.driftedMcpServers}</strong><span>drifted MCP</span></div>${report.findings.map((finding) => `<p><span class="finding-level">${escapeHtml(finding.level)}</span>${escapeHtml(finding.message)}</p>`).join("")}`;
  } catch (error) { health.className = "state error"; health.textContent = `Could not load health: ${error.message}`; }
  try {
    const data = await load("/api/update");
    const plans = Array.isArray(data) ? data : (data.updates || data.data || []);
    const available = plans.filter((plan) => plan.status === "update-available").length;
    updatesCount.textContent = plans.length ? `${available} available · ${plans.length} tracked` : "";
    if (!plans.length) { updates.className = "state"; updates.textContent = "No tracked installations yet. Install a package with Loadout to start update tracking."; }
    else { updates.className = "updates-grid"; updates.innerHTML = plans.map(renderUpdate).join(""); }
  } catch (error) { updates.className = "state error"; updates.textContent = `Could not check updates: ${error.message}`; }
  try {
    const data = await load("/api/recommendations");
    projectSignals.textContent = [...data.signals.languages, ...data.signals.frameworks].join(" · ") || "No known signals";
    if (!data.recommendations.length) { recommendations.className = "state"; recommendations.textContent = "No matching recommendations yet."; }
    else { recommendations.className = "grid"; recommendations.innerHTML = data.recommendations.map((item) => `<article><div class="card-heading"><h3>${escapeHtml(item.packageId)}</h3><span class="badge">${escapeHtml(item.confidence)}</span></div><p>${escapeHtml(item.reason)}</p></article>`).join(""); }
  } catch (error) { recommendations.className = "grid state error"; recommendations.textContent = `Could not build recommendations: ${error.message}`; }
  try {
    const data = await load("/api/profiles");
    profiles.className = "grid";
    profiles.innerHTML = Object.entries(data.profiles).map(([name, profile]) => `<article><h3>${escapeHtml(name)}</h3><p>${escapeHtml(profile.description)}</p><small>${profile.packages.map(escapeHtml).join(" · ")}</small></article>`).join("");
  } catch (error) { profiles.className = "grid state error"; profiles.textContent = `Could not load profiles: ${error.message}`; }
  try {
    const data = await load("/api/catalog");
    count.textContent = `${data.packages.length} packages`;
    if (!data.packages.length) { catalog.textContent = "The catalog is empty. Refresh it with loadout catalog --refresh."; return; }
    catalog.className = "grid";
    catalog.innerHTML = data.packages.map((pkg) => `<article><h3>${escapeHtml(pkg.displayName)}</h3><p>${escapeHtml(pkg.description || "No description available.")}</p><small>${escapeHtml(pkg.repository)} · ${escapeHtml(pkg.tier)}${pkg.stars == null ? "" : ` · ★${pkg.stars.toLocaleString()}`}</small></article>`).join("");
  } catch (error) { catalog.className = "grid state error"; catalog.textContent = `Could not load catalog: ${error.message}`; }
  try {
    const data = await load("/api/registry");
    registryCount.textContent = `${data.packages.length} local`;
    if (!data.packages.length) { registry.className = "state"; registry.textContent = "No local packages published yet."; }
    else { registry.className = "grid"; registry.innerHTML = data.packages.map((pkg) => `<article><h3>${escapeHtml(pkg.name)}@${escapeHtml(pkg.version)}</h3><p>${escapeHtml(pkg.description)}</p></article>`).join(""); }
  } catch (error) { registry.className = "grid state error"; registry.textContent = `Could not load local registry: ${error.message}`; }
}
render();
