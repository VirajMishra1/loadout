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
const refreshDashboard = document.querySelector("#refresh-dashboard");
const previewSync = document.querySelector("#preview-sync");
const applySync = document.querySelector("#apply-sync");
const rollbackSync = document.querySelector("#rollback-sync");
const syncAcknowledgement = document.querySelector("#sync-acknowledgement");
const syncResult = document.querySelector("#sync-result");
const notice = document.querySelector("#dashboard-notice");

let sessionToken;
let latestSnapshot;
let reviewedSafePlan = false;
let renderRun = 0;

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : "An unexpected local error occurred";
}

async function responseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected a local JSON response (${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`The local dashboard returned invalid JSON (${response.status})`);
  }
}

async function load(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body;
}

async function mutate(path, value) {
  if (!sessionToken) sessionToken = (await load("/api/session")).token;
  if (typeof sessionToken !== "string" || !sessionToken) throw new Error("Could not establish a private dashboard session");
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-loadout-token": sessionToken },
    body: JSON.stringify(value),
  });
  const result = await responseBody(response);
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Request failed (${response.status})`);
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function announce(message) {
  notice.textContent = message;
}

function setBusy(element, message) {
  element.className = "state";
  element.setAttribute("aria-busy", "true");
  element.setAttribute("role", "status");
  element.textContent = message;
}

function setTextState(element, message, kind = "default") {
  element.className = `state${kind === "default" ? "" : ` ${kind}`}`;
  element.setAttribute("aria-busy", "false");
  element.setAttribute("role", kind === "error" ? "alert" : "status");
  element.textContent = message;
}

function setMarkupState(element, className, markup) {
  element.className = className;
  element.setAttribute("aria-busy", "false");
  element.setAttribute("role", "status");
  element.innerHTML = markup;
}

function renderUpdate(plan, index) {
  const label = plan.status === "update-available" ? "Update available" : plan.status === "up-to-date" ? "Up to date" : plan.status === "untracked" ? "Needs tracking" : "Could not check";
  const details = plan.diff?.length ? `<details><summary>${plan.diff.length} changed file${plan.diff.length === 1 ? "" : "s"}</summary><ul>${plan.diff.slice(0, 20).map((change) => `<li><code>${escapeHtml(change.path)}</code> <small>${escapeHtml(change.kind)}</small></li>`).join("")}</ul></details>` : "";
  const headingId = `update-${index}`;
  return `<article class="update ${escapeHtml(plan.status || "unknown")}" aria-labelledby="${headingId}"><div class="update-heading"><h3 id="${headingId}">${escapeHtml(plan.packageId || "Unknown package")}</h3><span class="badge">${label}</span></div><p>${escapeHtml(plan.action || "No update action available.")}</p>${plan.repository ? `<small>${escapeHtml(plan.repository)}${plan.availableCommit ? ` · ${escapeHtml(String(plan.availableCommit).slice(0, 12))}` : ""}</small>` : ""}${plan.error ? `<p class="error-text">${escapeHtml(plan.error)}</p>` : ""}${details}</article>`;
}

function describeSync(plan) {
  const packages = asArray(plan.packages);
  const mcpChanges = asArray(plan.mcpChanges);
  const policyViolations = asArray(plan.policyViolations);
  const files = packages.reduce((total, pkg) => total + asArray(pkg.files).length, 0);
  const risky = packages.filter((pkg) => pkg.safety?.approvalRequired).map((pkg) => pkg.packageId).filter(Boolean);
  return { text: `${packages.length} package(s), ${files} file target(s), ${mcpChanges.length} MCP plan(s)${risky.length ? `; CLI risk approval required for ${risky.join(", ")}` : ""}`, safe: !risky.length && !policyViolations.length };
}

function resetSyncReview() {
  reviewedSafePlan = false;
  syncAcknowledgement.checked = false;
  syncAcknowledgement.disabled = true;
  applySync.disabled = true;
}

syncAcknowledgement.addEventListener("change", () => {
  applySync.disabled = !reviewedSafePlan || !syncAcknowledgement.checked;
});

previewSync.addEventListener("click", async () => {
  previewSync.disabled = true;
  resetSyncReview();
  setTextState(syncResult, "Building a read-only plan…");
  try {
    const { plan } = await load("/api/sync-plan");
    const summary = describeSync(plan || {});
    setTextState(syncResult, summary.text, summary.safe ? "success" : "attention");
    reviewedSafePlan = summary.safe;
    syncAcknowledgement.disabled = !summary.safe;
    if (summary.safe) announce("A safe sync plan is ready for review. Check the acknowledgement box to enable apply.");
    else announce("This plan needs CLI risk approval and cannot be applied from the dashboard.");
  } catch (error) {
    setTextState(syncResult, `Could not build sync plan: ${errorMessage(error)}`, "error");
    announce("Could not build the sync plan.");
  } finally {
    previewSync.disabled = false;
  }
});

applySync.addEventListener("click", async () => {
  if (!reviewedSafePlan || !syncAcknowledgement.checked) return;
  applySync.disabled = true;
  syncAcknowledgement.disabled = true;
  setTextState(syncResult, "Applying the reviewed safe plan…");
  try {
    const { result } = await mutate("/api/sync", { approveRisk: false });
    latestSnapshot = result?.snapshotId;
    setTextState(syncResult, `Synchronized successfully.${latestSnapshot ? ` Snapshot: ${latestSnapshot}` : ""}`, "success");
    rollbackSync.disabled = !latestSnapshot;
    resetSyncReview();
    announce("Safe sync completed.");
    await render();
  } catch (error) {
    setTextState(syncResult, `Synchronization failed: ${errorMessage(error)}`, "error");
    reviewedSafePlan = true;
    syncAcknowledgement.disabled = false;
    applySync.disabled = !syncAcknowledgement.checked;
    announce("Synchronization failed.");
  }
});

rollbackSync.addEventListener("click", async () => {
  if (!latestSnapshot) return;
  rollbackSync.disabled = true;
  setTextState(syncResult, "Restoring the exact previous snapshot…");
  try {
    await mutate("/api/rollback", { snapshotId: latestSnapshot });
    setTextState(syncResult, `Restored snapshot ${latestSnapshot}.`, "success");
    latestSnapshot = undefined;
    announce("The last dashboard change was restored.");
    await render();
  } catch (error) {
    setTextState(syncResult, `Rollback failed: ${errorMessage(error)}`, "error");
    rollbackSync.disabled = false;
    announce("Rollback failed.");
  }
});

function renderStatus(data) {
  const detected = asArray(data.agents).filter((agent) => agent?.installed);
  if (!detected.length) return setTextState(status, "No supported agent detected on PATH. Install one, then refresh.");
  setMarkupState(status, "state success", `<strong>${detected.length} agent${detected.length === 1 ? "" : "s"} detected</strong><span>${detected.map((agent) => escapeHtml(agent.displayName)).join(" · ")}</span>`);
}

function renderHealth(data) {
  const report = data.health;
  if (!report || typeof report !== "object") throw new Error("The local health response was incomplete");
  healthLabel.textContent = typeof report.status === "string" ? report.status : "unknown";
  const state = report.status === "healthy" ? "success" : report.status === "unhealthy" ? "error" : "attention";
  const findings = asArray(report.findings);
  setMarkupState(health, `health-list ${state}`, `<div class="metric-row"><strong>${Number(report.installedPackages) || 0}</strong><span>packages</span><strong>${Number(report.updatesAvailable) || 0}</strong><span>updates</span><strong>${Number(report.driftedFiles) || 0}</strong><span>drifted files</span><strong>${Number(report.driftedMcpServers) || 0}</strong><span>drifted MCP</span></div>${findings.map((finding) => `<p><span class="finding-level">${escapeHtml(finding.level || "info")}</span>${escapeHtml(finding.message || "")}</p>`).join("")}`);
}

function renderUpdates(data) {
  const plans = asArray(data.updates || data.data || data);
  const available = plans.filter((plan) => plan?.status === "update-available").length;
  updatesCount.textContent = plans.length ? `${available} available · ${plans.length} tracked` : "";
  if (!plans.length) return setTextState(updates, "No tracked installations yet. Install a package with Loadout to start update tracking.");
  setMarkupState(updates, "updates-grid", plans.map(renderUpdate).join(""));
}

function renderRecommendations(data) {
  const signals = data.signals || {};
  projectSignals.textContent = [...asArray(signals.languages), ...asArray(signals.frameworks)].join(" · ") || "No known signals";
  const items = asArray(data.recommendations);
  if (!items.length) return setTextState(recommendations, "No matching recommendations yet.");
  setMarkupState(recommendations, "grid", items.map((item, index) => {
    const headingId = `recommendation-${index}`;
    return `<article aria-labelledby="${headingId}"><div class="card-heading"><h3 id="${headingId}">${escapeHtml(item.packageId || "Unknown package")}</h3><span class="badge">${escapeHtml(item.confidence || "unknown")}</span></div><p>${escapeHtml(item.reason || "No recommendation reason available.")}</p></article>`;
  }).join(""));
}

function renderProfiles(data) {
  const entries = data.profiles && typeof data.profiles === "object" ? Object.entries(data.profiles) : [];
  if (!entries.length) return setTextState(profiles, "No tested profiles are available.");
  setMarkupState(profiles, "grid", entries.map(([name, profile], index) => {
    const value = profile && typeof profile === "object" ? profile : {};
    const headingId = `profile-${index}`;
    return `<article aria-labelledby="${headingId}"><h3 id="${headingId}">${escapeHtml(name)}</h3><p>${escapeHtml(value.description || "No description available.")}</p><small>${asArray(value.packages).map(escapeHtml).join(" · ")}</small></article>`;
  }).join(""));
}

function renderCatalog(data) {
  const packages = asArray(data.packages);
  count.textContent = `${packages.length} packages`;
  if (!packages.length) return setTextState(catalog, "The catalog is empty. Refresh it with loadout catalog --refresh.");
  setMarkupState(catalog, "grid", packages.map((pkg, index) => {
    const headingId = `catalog-${index}`;
    const stars = typeof pkg.stars === "number" ? ` · ★${pkg.stars.toLocaleString()}` : "";
    return `<article aria-labelledby="${headingId}"><h3 id="${headingId}">${escapeHtml(pkg.displayName || pkg.id || "Unknown package")}</h3><p>${escapeHtml(pkg.description || "No description available.")}</p><small>${escapeHtml(pkg.repository || "No repository")}${pkg.tier ? ` · ${escapeHtml(pkg.tier)}` : ""}${stars}</small></article>`;
  }).join(""));
}

function renderRegistry(data) {
  const packages = asArray(data.packages);
  registryCount.textContent = `${packages.length} local`;
  if (!packages.length) return setTextState(registry, "No local packages published yet.");
  setMarkupState(registry, "grid", packages.map((pkg, index) => {
    const headingId = `registry-${index}`;
    return `<article aria-labelledby="${headingId}"><h3 id="${headingId}">${escapeHtml(pkg.name || "Unknown package")}@${escapeHtml(pkg.version || "unknown")}</h3><p>${escapeHtml(pkg.description || "No description available.")}</p></article>`;
  }).join(""));
}

function renderFailure(element, prefix, error) {
  setTextState(element, `${prefix}: ${errorMessage(error)}`, "error");
}

async function render() {
  const run = ++renderRun;
  refreshDashboard.disabled = true;
  refreshDashboard.textContent = "Refreshing…";
  setBusy(status, "Loading agent status…");
  setBusy(health, "Checking setup health…");
  setBusy(updates, "Checking installed packages…");
  setBusy(recommendations, "Reading local project signals…");
  setBusy(profiles, "Loading profiles…");
  setBusy(catalog, "Loading catalog…");
  setBusy(registry, "Loading locally published packages…");

  const results = await Promise.allSettled([
    load("/api/status"), load("/api/health"), load("/api/update"), load("/api/recommendations"), load("/api/profiles"), load("/api/catalog"), load("/api/registry"),
  ]);
  if (run !== renderRun) return;
  const [statusResult, healthResult, updatesResult, recommendationsResult, profilesResult, catalogResult, registryResult] = results;
  const applyResult = (result, element, prefix, draw) => {
    if (result.status === "rejected") return renderFailure(element, prefix, result.reason);
    try { draw(result.value); } catch (error) { renderFailure(element, prefix, error); }
  };
  applyResult(statusResult, status, "Could not load status", renderStatus);
  applyResult(healthResult, health, "Could not load health", renderHealth);
  applyResult(updatesResult, updates, "Could not check updates", renderUpdates);
  applyResult(recommendationsResult, recommendations, "Could not build recommendations", renderRecommendations);
  applyResult(profilesResult, profiles, "Could not load profiles", renderProfiles);
  applyResult(catalogResult, catalog, "Could not load catalog", renderCatalog);
  applyResult(registryResult, registry, "Could not load local registry", renderRegistry);
  refreshDashboard.disabled = false;
  refreshDashboard.textContent = "Refresh dashboard";
  announce("Dashboard data refreshed.");
}

refreshDashboard.addEventListener("click", () => { void render(); });
void render();
