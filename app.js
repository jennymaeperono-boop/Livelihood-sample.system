import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ?.replace(/\/rest\/v1\/?$/, "")
  .replace(/\/+$/, "");
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes("your-project-id") &&
  !supabaseAnonKey.includes("your-supabase")
);
const supabase = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

const roles = {
  A: { title: "Section Leader", label: "SECTION LEADER" },
  B: { title: "Stock Requisition", label: "STOCK REQUISITION" },
  C: { title: "Gatepass Verifier", label: "GATEPASS VERIFIER" },
  D: { title: "Guard", label: "GUARD" }
};

let data = {
  requests: [],
  gatepasses: []
};

let activeRole = null;
let activeView = "overview";
let authUser = null;
let profile = null;
let authMode = "signin";
let toastTimer;
let realtimeChannel = null;
let refreshTimer = null;
let sessionGeneration = 0;

function mapRequest(row) {
  return {
    id: row.id,
    number: row.request_number,
    itemName: row.item_name,
    quantity: row.quantity,
    unit: row.unit,
    purpose: row.purpose,
    requester: "A",
    requesterName: row.requester_name,
    status: row.status[0].toUpperCase() + row.status.slice(1),
    note: row.note,
    createdAt: row.created_at
  };
}

function mapGatepass(row) {
  return {
    id: row.id,
    number: row.gatepass_number,
    itemName: row.item_name,
    quantity: row.quantity,
    unit: row.unit,
    destination: row.destination,
    purpose: row.purpose,
    requester: "A",
    requesterName: row.requester_name,
    status: row.status[0].toUpperCase() + row.status.slice(1),
    createdAt: row.created_at
  };
}

async function loadData() {
  const [requestsResult, gatepassesResult] = await Promise.all([
    supabase.from("stock_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("gatepasses").select("*").order("created_at", { ascending: false })
  ]);
  if (requestsResult.error) throw requestsResult.error;
  if (gatepassesResult.error) throw gatepassesResult.error;
  data = {
    requests: requestsResult.data.map(mapRequest),
    gatepasses: gatepassesResult.data.map(mapGatepass)
  };
}

function showOperationError(action, error) {
  console.error(`${action} failed.`, error);
  showToast(`${action} failed: ${error.message || "Please try again."}`);
}

async function refreshWorkspace() {
  try {
    await loadData();
    if (activeRole) render();
  } catch (error) {
    showOperationError("Refreshing workspace", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function showAuthNotice(message, isError = false) {
  const notice = document.getElementById("auth-notice");
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle("error", isError);
}

function renderAuthMode() {
  const isSignup = authMode === "signup";
  document.getElementById("auth-title").textContent = isSignup ? "Create your account" : "Sign in to your account";
  document.getElementById("auth-description").textContent = isSignup
    ? "Create an account to request supplies and manage gatepasses."
    : "Manage stock requests and gatepasses in one place.";
  document.getElementById("name-field").hidden = !isSignup;
  document.getElementById("auth-name").required = isSignup;
  document.getElementById("auth-password").autocomplete = isSignup ? "new-password" : "current-password";
  document.getElementById("auth-submit").textContent = isSignup ? "Create account" : "Sign in";
  document.getElementById("auth-switch").innerHTML = isSignup
    ? 'Already have an account? <button type="button" data-auth-mode="signin">Sign in</button>'
    : 'New here? <button type="button" data-auth-mode="signup">Create an account</button>';
  document.getElementById("auth-form").hidden = !isConfigured;
  document.getElementById("auth-switch").hidden = !isConfigured;
  if (!isConfigured) {
    showAuthNotice("Add your Supabase project URL and publishable/anon key to .env, then restart the app.", true);
  } else {
    showAuthNotice("");
  }
}

function showPendingRole() {
  document.getElementById("app-shell").hidden = true;
  document.getElementById("auth-screen").hidden = false;
  document.querySelector(".auth-card").innerHTML = `
    <a class="brand auth-brand" href="#" aria-label="Livelihood home">
      <span class="brand-mark">L</span>
      <span><strong>Livelihood</strong><small>SUPPLY &amp; GATEPASS</small></span>
    </a>
    <div class="auth-intro">
      <div class="eyebrow">ACCOUNT CREATED</div>
      <h1>Waiting for role assignment</h1>
      <p>Your account is signed in, but a workspace role has not been assigned yet.</p>
    </div>
    <div class="auth-notice">Ask your administrator to assign your role in Supabase. You can sign in again after approval.</div>
    <button class="button button-secondary auth-submit" type="button" data-action="signout">Sign out</button>`;
}

function showProfileError(error) {
  document.getElementById("app-shell").hidden = true;
  document.getElementById("auth-screen").hidden = false;
  document.querySelector(".auth-card").innerHTML = `
    <a class="brand auth-brand" href="#" aria-label="Livelihood home">
      <span class="brand-mark">L</span>
      <span><strong>Livelihood</strong><small>SUPPLY &amp; GATEPASS</small></span>
    </a>
    <div class="auth-intro">
      <div class="eyebrow">SETUP NEEDED</div>
      <h1>Could not load your profile</h1>
      <p>Check that the Supabase schema has been installed and try signing out before signing in again.</p>
    </div>
    <div class="auth-notice error">${escapeHtml(error.message || "Supabase profile request failed.")}</div>
    <button class="button button-secondary auth-submit" type="button" data-action="signout">Sign out</button>`;
}

async function handleAuthSession(session) {
  const generation = ++sessionGeneration;
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  authUser = session?.user || null;
  profile = null;
  activeRole = null;
  if (!authUser) {
    document.getElementById("app-shell").hidden = true;
    document.getElementById("auth-screen").hidden = false;
    if (!document.getElementById("auth-form")) {
      document.querySelector(".auth-card").innerHTML = `
        <a class="brand auth-brand" href="#" aria-label="Livelihood home">
          <span class="brand-mark">L</span>
          <span><strong>Livelihood</strong><small>SUPPLY &amp; GATEPASS</small></span>
        </a>
        <div class="auth-intro"><div class="eyebrow">WELCOME</div><h1>Sign in to your account</h1><p>Manage stock requests and gatepasses in one place.</p></div>
        <div id="auth-notice" class="auth-notice" role="status" aria-live="polite" hidden></div>
        <form id="auth-form" class="auth-form">
          <div id="name-field" class="field" hidden><label for="auth-name">Full name</label><input id="auth-name" name="name" type="text" autocomplete="name" maxlength="100"></div>
          <div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" minlength="6" required></div>
          <button id="auth-submit" class="button button-primary auth-submit" type="submit">Sign in</button>
        </form>
        <p id="auth-switch" class="auth-switch">New here? <button type="button" data-auth-mode="signup">Create an account</button></p>
        <p class="auth-footnote">New accounts need a role assigned by an administrator before they can access the workspace.</p>`;
      renderAuthMode();
    }
    return;
  }

  try {
    const { data: result, error } = await supabase
      .from("profiles")
      .select("user_id, email, display_name, role")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (generation !== sessionGeneration) return;
    if (error) throw error;
    profile = result;
    if (!profile || !roles[profile.role]) {
      showPendingRole();
      return;
    }
    activeRole = profile.role;
    await loadData();
    if (generation !== sessionGeneration) return;
    document.getElementById("auth-screen").hidden = true;
    document.getElementById("app-shell").hidden = false;
    activeView = "overview";
    render();
    subscribeToWorkspace();
  } catch (error) {
    if (generation === sessionGeneration) showProfileError(error);
  }
}

function subscribeToWorkspace() {
  if (!supabase || !authUser) return;
  realtimeChannel = supabase.channel(`workspace-${authUser.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "stock_requests" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "gatepasses" }, scheduleRefresh)
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        showToast("Live updates are unavailable. Reload the page to refresh.");
      }
    });
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshWorkspace, 200);
}

async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) showOperationError("Signing out", error);
}

async function initializeAuth() {
  if (!isConfigured) {
    renderAuthMode();
    return;
  }
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleAuthSession(session), 0);
  });
  const { data: result, error } = await supabase.auth.getSession();
  if (error) {
    showAuthNotice(error.message, true);
    return;
  }
  await handleAuthSession(result.session);
}

function statusPill(status) {
  const classes = {
    Pending: "pending", Confirmed: "confirmed", Unavailable: "unavailable",
    Verified: "verified", Rejected: "rejected"
  };
  return `<span class="status status-${classes[status] || "pending"}">${escapeHtml(status)}</span>`;
}

function countPendingRequests() {
  return data.requests.filter(item => item.status === "Pending").length;
}

function countPendingPasses() {
  return data.gatepasses.filter(item => item.status === "Pending").length;
}

function updateChrome() {
  const role = roles[activeRole];
  const displayName = profile.display_name || profile.email;
  document.getElementById("sidebar-avatar").textContent = displayName.trim().charAt(0).toUpperCase();
  document.getElementById("sidebar-user").textContent = displayName;
  document.getElementById("sidebar-role").textContent = role.label;
  document.getElementById("top-role").textContent = role.title;
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  document.getElementById("request-nav-count").textContent = activeRole === "B" && countPendingRequests() ? countPendingRequests() : "";
  document.getElementById("gatepass-nav-count").textContent = activeRole === "C" && countPendingPasses() ? countPendingPasses() : "";
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === activeView));
  const names = { overview: "Overview", requests: "Stock requests", gatepasses: "Gatepasses" };
  document.getElementById("breadcrumb-current").textContent = names[activeView];
}

function pageHeading(eyebrow, title, description, button = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
}

function statCard(label, value, note, symbol) {
  return `<div class="stat-card"><div class="stat-top">${label}<span class="stat-symbol">${symbol}</span></div><strong class="stat-value">${value}</strong><div class="stat-foot">${note}</div></div>`;
}

function renderOverview() {
  const pendingRequests = countPendingRequests();
  const pendingPasses = countPendingPasses();
  const verified = data.gatepasses.filter(item => item.status === "Verified").length;
  let title = "Good day";
  let description = "Here’s what’s happening with your supplies and gatepasses.";
  if (activeRole === "A") {
    description = "Create a stock request or prepare a gatepass for items leaving the premises.";
  } else if (activeRole === "B") {
    description = "Review each request and confirm whether the requested item is available.";
  } else if (activeRole === "C") {
    description = "Check gatepass details and verify approved items before they leave.";
  } else {
    description = "Check verified gatepasses before allowing items to leave the premises.";
  }

  const actionButtons = activeRole === "A"
    ? `<button class="quick-action" data-action="new-request"><span class="quick-icon">＋</span>Request stock<span class="quick-arrow">›</span></button><button class="quick-action" data-action="new-gatepass"><span class="quick-icon">▤</span>Create gatepass<span class="quick-arrow">›</span></button>`
    : activeRole === "B"
      ? `<button class="quick-action" data-goto="requests"><span class="quick-icon">⇄</span>Review stock requests<span class="quick-arrow">›</span></button>`
      : activeRole === "C"
        ? `<button class="quick-action" data-goto="gatepasses"><span class="quick-icon">✓</span>Review pending gatepasses<span class="quick-arrow">›</span></button>`
        : `<button class="quick-action" data-goto="gatepasses"><span class="quick-icon">▤</span>View verified gatepasses<span class="quick-arrow">›</span></button>`;

  const stats = activeRole === "A"
    ? statCard("My stock requests", data.requests.filter(item => item.requester === "A").length, "Requests submitted", "⇄") +
      statCard("Awaiting stock check", data.requests.filter(item => item.requester === "A" && item.status === "Pending").length, "With Stock Requisition", "◷") +
      statCard("My gatepasses", data.gatepasses.filter(item => item.requester === "A").length, "Gatepasses created", "▤") +
      statCard("Verified", data.gatepasses.filter(item => item.requester === "A" && item.status === "Verified").length, "Ready for guard check", "✓")
    : activeRole === "B"
      ? statCard("Pending requests", pendingRequests, "Need your stock check", "◷") +
        statCard("Confirmed requests", data.requests.filter(item => item.status === "Confirmed").length, "Ready for pickup", "✓") +
        statCard("Unavailable", data.requests.filter(item => item.status === "Unavailable").length, "Not available for pickup", "!") +
        statCard("Total requests", data.requests.length, "Requests received", "⇄")
      : activeRole === "C"
        ? statCard("Awaiting verification", pendingPasses, "Need your review", "◷") +
          statCard("Verified gatepasses", verified, "Cleared for the guard", "✓") +
          statCard("Rejected", data.gatepasses.filter(item => item.status === "Rejected").length, "Not cleared", "×") +
          statCard("Gatepasses today", data.gatepasses.filter(item => new Date(item.createdAt).toDateString() === new Date().toDateString()).length, "Submitted today", "▤")
        : statCard("Ready to check", verified, "Verified gatepasses", "✓") +
          statCard("Pending verification", pendingPasses, "Not cleared for exit", "◷") +
          statCard("Stock requests", data.requests.length, "Handled by Stock Requisition", "⇄") +
          statCard("Verified passes", verified, "Cleared by C", "▤");

  const recentRows = activeRole === "D"
    ? data.gatepasses.filter(item => item.status === "Verified").slice().reverse().slice(0, 5).map(gatepassRow).join("")
    : activeRole === "C"
      ? data.gatepasses.filter(item => item.status === "Pending").slice().reverse().slice(0, 5).map(gatepassRow).join("")
      : activeRole === "B"
        ? data.requests.filter(item => item.status === "Pending").slice().reverse().slice(0, 5).map(requestRow).join("")
        : data.requests.filter(item => item.requester === "A").slice().reverse().slice(0, 5).map(requestRow).join("");
  const recentTitle = activeRole === "D" ? "Verified gatepasses" : activeRole === "C" ? "Needs verification" : activeRole === "B" ? "Stock requests to review" : "My recent requests";
  const recentEmpty = activeRole === "D" ? "No verified gatepasses to show." : activeRole === "C" ? "No gatepasses are waiting for verification." : activeRole === "B" ? "No stock requests are waiting for review." : "Your stock requests will appear here.";

  return `${pageHeading("WORKSPACE", title, description)}
    <div class="stats-grid">${stats}</div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-header"><div><h2>${recentTitle}</h2><p>${activeRole === "D" ? "Only gatepasses verified by C appear here." : "A quick look at the latest activity."}</p></div><button class="button button-secondary button-small" data-goto="${activeRole === "C" || activeRole === "D" ? "gatepasses" : "requests"}">View all <span>›</span></button></div>
      ${recentRows ? `<div class="table-wrap"><table><thead><tr>${activeRole === "C" || activeRole === "D" ? "<th>Gatepass</th><th>Item</th><th>Requested by</th><th>Status</th>" : "<th>Request</th><th>Item</th><th>Quantity</th><th>Status</th>"}</tr></thead><tbody>${recentRows}</tbody></table></div>` : `<div class="empty-state">${recentEmpty}</div>`}</section>
      <section class="panel"><div class="panel-header"><div><h2>Quick actions</h2><p>Common tasks for your role.</p></div></div><div class="panel-body"><div class="quick-actions">${actionButtons}</div></div></section>
    </div>
    <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>How it works</h2><p>Every item has a clear path from request to release.</p></div></div><div class="panel-body"><div class="workflow-list">
      <div class="workflow-item"><span class="workflow-step">1</span><div><strong>A · Section Leader</strong><p>Submit a stock request or create a gatepass for items leaving the premises.</p></div></div>
      <div class="workflow-item"><span class="workflow-step">2</span><div><strong>B · Stock Requisition</strong><p>Check stock and confirm availability. A can collect items only after confirmation.</p></div></div>
      <div class="workflow-item"><span class="workflow-step">3</span><div><strong>C · Gatepass Verifier</strong><p>Review and verify gatepasses. Only verified passes are cleared for exit.</p></div></div>
      <div class="workflow-item"><span class="workflow-step">4</span><div><strong>D · Guard</strong><p>View the verified gatepass and check the items before they leave.</p></div></div>
    </div></div></section>`;
}

function requestRow(item) {
  return `<tr><td><strong>${escapeHtml(item.number)}</strong><span class="cell-sub">${formatDate(item.createdAt)}</span></td><td><strong>${escapeHtml(item.itemName)}</strong><span class="cell-sub">${escapeHtml(item.purpose || "No purpose provided")}</span></td><td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td><td>${statusPill(item.status)}</td></tr>`;
}

function gatepassRow(item) {
  return `<tr><td><strong>${escapeHtml(item.number)}</strong><span class="cell-sub">${formatDate(item.createdAt)}</span></td><td><strong>${escapeHtml(item.itemName)}</strong><span class="cell-sub">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)} · ${escapeHtml(item.destination)}</span></td><td>${escapeHtml(item.requesterName)}</td><td>${statusPill(item.status)}</td></tr>`;
}

function renderRequests() {
  const isStock = activeRole === "B";
  const records = (isStock ? data.requests : data.requests.filter(item => item.requester === activeRole)).slice().reverse();
  const rows = records.map(item => `<tr><td><strong>${escapeHtml(item.number)}</strong><span class="cell-sub">${formatDate(item.createdAt)}</span></td><td><strong>${escapeHtml(item.itemName)}</strong><span class="cell-sub">${escapeHtml(item.purpose || "No purpose provided")}</span></td><td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td><td>${isStock ? escapeHtml(item.requesterName) : "Me"}</td><td>${statusPill(item.status)}${item.status === "Unavailable" && item.note ? `<span class="cell-sub">${escapeHtml(item.note)}</span>` : ""}</td><td>${requestActions(item)}</td></tr>`).join("");
  const heading = isStock
    ? pageHeading("STOCK REQUISITION", "Stock requests", "Check with the stock room, then confirm whether each requested item is available.")
    : activeRole === "A"
      ? pageHeading("REQUESTS", "Stock requests", "Track your requests. You’ll be notified here once Stock Requisition confirms availability.", `<button class="button button-primary" data-action="new-request"><span class="button-icon">＋</span> New request`)
      : pageHeading("REQUESTS", "Stock requests", "Stock request review is available to Section Leader A and Stock Requisition B.");
  const note = isStock ? "" : `<div class="permission-note">Your request is pending until B checks the stock. Once confirmed, you can collect the items from Stock Requisition.</div>`;
  return `${heading}${note}<section class="panel"><div class="panel-header"><div><h2>${isStock ? "All requests" : "My requests"}</h2><p>${records.length} ${records.length === 1 ? "request" : "requests"}</p></div><div class="filter-row"><input class="search-input" type="search" placeholder="Search item or request…" data-search="requests" aria-label="Search requests"><select class="filter-select" data-filter="requests" aria-label="Filter requests"><option value="">All statuses</option><option>Pending</option><option>Confirmed</option><option>Unavailable</option></select></div></div>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>Request</th><th>Item</th><th>Quantity</th><th>${isStock ? "Requested by" : "Submitted by"}</th><th>Status</th><th>Actions</th></tr></thead><tbody id="record-rows">${rows}</tbody></table></div>` : `<div class="empty-state"><strong>No stock requests yet</strong>${isStock ? "New requests from the Section Leader will appear here." : "Create a request when you need supplies."}</div>`}
    <div class="table-footer">Requests are visible to Section Leader A and Stock Requisition B.</div></section>`;
}

function requestActions(item) {
  if (activeRole === "B" && item.status === "Pending") {
    return `<div class="action-group"><button class="button button-primary button-small" data-action="confirm-request" data-id="${escapeHtml(item.id)}">Available</button><button class="button button-danger button-small" data-action="unavailable-request" data-id="${escapeHtml(item.id)}">Unavailable</button></div>`;
  }
  if (activeRole === "A" && item.status === "Pending") {
    return `<button class="button button-secondary button-small" data-action="delete-request" data-id="${escapeHtml(item.id)}">Cancel</button>`;
  }
  return `<span class="cell-sub">${item.status === "Confirmed" ? "Ready for pickup" : item.status === "Unavailable" ? "Please contact Stock Requisition" : "Waiting for stock check"}</span>`;
}

function renderGatepasses() {
  const canVerify = activeRole === "C";
  const records = activeRole === "D"
    ? data.gatepasses.filter(item => item.status === "Verified").slice().reverse()
    : activeRole === "C"
      ? data.gatepasses.slice().reverse()
      : data.gatepasses.filter(item => item.requester === activeRole).slice().reverse();
  const rows = records.map(item => `<tr><td><strong>${escapeHtml(item.number)}</strong><span class="cell-sub">${formatDate(item.createdAt)}</span></td><td><strong>${escapeHtml(item.itemName)}</strong><span class="cell-sub">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</span></td><td><strong>${escapeHtml(item.destination)}</strong><span class="cell-sub">${escapeHtml(item.purpose || "No purpose provided")}</span></td><td>${escapeHtml(item.requesterName)}</td><td>${statusPill(item.status)}</td><td>${gatepassActions(item)}</td></tr>`).join("");
  const heading = activeRole === "A"
    ? pageHeading("GATEPASS", "My gatepasses", "Prepare a pass for items leaving the premises. C must verify it before the guard can clear it.", `<button class="button button-primary" data-action="new-gatepass"><span class="button-icon">＋</span> Create gatepass`)
    : activeRole === "C"
      ? pageHeading("GATEPASS REVIEW", "Verify gatepasses", "Review the item and destination. Verified gatepasses become visible to Guard D.")
      : activeRole === "D"
        ? pageHeading("EXIT CHECK", "Verified gatepasses", "Only gatepasses verified by C are shown. Check the items against the pass.")
        : pageHeading("GATEPASS", "Gatepasses", "Gatepass creation and verification are managed by A and C.");
  const empty = activeRole === "D" ? "No verified gatepasses are available for exit." : canVerify ? "No gatepasses have been submitted yet." : "Your gatepasses will appear here.";
  const note = activeRole === "D" ? `<div class="permission-note">Pending and rejected gatepasses are hidden. Only C-verified passes are cleared for your check.</div>` : "";
  return `${heading}${note}<section class="panel"><div class="panel-header"><div><h2>${activeRole === "C" ? "Submitted gatepasses" : activeRole === "D" ? "Cleared for exit" : "My gatepasses"}</h2><p>${records.length} ${records.length === 1 ? "gatepass" : "gatepasses"}</p></div>${canVerify ? `<div class="filter-row"><select class="filter-select" data-filter="gatepasses" aria-label="Filter gatepasses"><option value="">All statuses</option><option>Pending</option><option>Verified</option><option>Rejected</option></select></div>` : ""}</div>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>Gatepass</th><th>Item</th><th>Destination / purpose</th><th>${canVerify || activeRole === "D" ? "Created by" : "Requested by"}</th><th>Status</th><th>Actions</th></tr></thead><tbody id="record-rows">${rows}</tbody></table></div>` : `<div class="empty-state"><strong>No gatepasses to show</strong>${empty}</div>`}
    <div class="table-footer">Gatepass verification is handled by C · Gatepass Verifier. Guard D sees verified passes only.</div></section>`;
}

function gatepassActions(item) {
  if (activeRole === "C" && item.status === "Pending") {
    return `<div class="action-group"><button class="button button-primary button-small" data-action="verify-gatepass" data-id="${escapeHtml(item.id)}">Verify</button><button class="button button-danger button-small" data-action="reject-gatepass" data-id="${escapeHtml(item.id)}">Reject</button></div>`;
  }
  if (activeRole === "A" && item.status === "Pending") {
    return `<button class="button button-secondary button-small" data-action="delete-gatepass" data-id="${escapeHtml(item.id)}">Cancel</button>`;
  }
  if (activeRole === "D" && item.status === "Verified") {
    return `<span class="cell-sub">Cleared</span>`;
  }
  return `<span class="cell-sub">${item.status === "Verified" ? "Visible to Guard" : item.status === "Rejected" ? "Contact verifier" : "Awaiting C"}</span>`;
}

function render() {
  updateChrome();
  const content = document.getElementById("page-content");
  if (activeView === "requests") content.innerHTML = renderRequests();
  else if (activeView === "gatepasses") content.innerHTML = renderGatepasses();
  else content.innerHTML = renderOverview();
}

function openModal({ title, description, fields, submitLabel, onSubmit }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button class="modal-close" type="button" aria-label="Close dialog" data-close-modal>×</button></div><form class="modal-form">${fields}<div class="modal-actions"><button class="button button-secondary" type="button" data-close-modal>Cancel</button><button class="button button-primary" type="submit">${submitLabel}</button></div></form></section></div>`;
  root.querySelector(".modal").addEventListener("click", event => event.stopPropagation());
  root.querySelector(".modal-backdrop").addEventListener("click", event => {
    if (event.target.closest("[data-close-modal]")) root.innerHTML = "";
  });
  root.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    Promise.resolve(onSubmit(values))
      .then(success => {
        if (success) root.innerHTML = "";
        else submitButton.disabled = false;
      })
      .catch(error => {
        showOperationError("Saving changes", error);
        submitButton.disabled = false;
      });
  });
  const firstInput = root.querySelector("input, select, textarea");
  if (firstInput) firstInput.focus();
}

function field(name, label, type = "text", options = {}) {
  const required = options.required === false ? "" : "required";
  if (type === "select") {
    return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required}>${options.placeholder ? `<option value="" selected disabled>${options.placeholder}</option>` : ""}${options.choices.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select></div>`;
  }
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${required}${options.min !== undefined ? ` min="${options.min}"` : ""}${options.step ? ` step="${options.step}"` : ""}${options.value !== undefined ? ` value="${escapeHtml(options.value)}"` : ""}${options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""}></div>`;
}

function openRequestModal() {
  if (activeRole !== "A") return;
  openModal({
    title: "Request stock",
    description: "Stock Requisition will check availability before you collect anything.",
    fields: field("itemName", "Specific item", "text", { placeholder: "Type the item you need, e.g. rice (25kg sack)" }) +
      field("quantity", "Quantity needed", "number", { min: 1 }) +
      field("unit", "Unit", "text", { placeholder: "e.g. sacks, boxes, pieces" }) +
      `<div class="field"><label for="request-purpose">Purpose / notes</label><textarea id="request-purpose" name="purpose" maxlength="240" placeholder="What are the supplies for?"></textarea></div>`,
    submitLabel: "Submit request",
    onSubmit: async values => {
      const quantity = Number(values.quantity);
      const itemName = values.itemName.trim();
      const unit = values.unit.trim();
      if (!itemName || !Number.isInteger(quantity) || quantity < 1 || !unit) {
        showToast("Enter an item, a valid quantity, and its unit.");
        return false;
      }
      const { error } = await supabase.from("stock_requests").insert({
        request_number: makeId("REQ"),
        requester_id: authUser.id,
        requester_name: profile.display_name,
        item_name: itemName,
        quantity,
        unit,
        purpose: values.purpose.trim(),
        status: "pending"
      });
      if (error) {
        showOperationError("Submitting stock request", error);
        return false;
      }
      await loadData();
      activeView = "requests";
      render();
      showToast("Stock request sent to Stock Requisition.");
      return true;
    }
  });
}

function openGatepassModal() {
  if (activeRole !== "A") return;
  openModal({
    title: "Create gatepass",
    description: "C, the Gatepass Verifier, must verify this pass before exit.",
    fields: field("itemName", "Specific item to take out", "text", { placeholder: "Type the exact item, e.g. folding tables" }) +
      field("quantity", "Quantity", "number", { min: 1 }) +
      field("unit", "Unit", "text", { placeholder: "e.g. pieces, boxes, sacks" }) +
      field("destination", "Destination", "text", { placeholder: "e.g. Community kitchen" }) +
      `<div class="field"><label for="pass-purpose">Purpose / notes</label><textarea id="pass-purpose" name="purpose" maxlength="240" placeholder="Add a short reason for taking the items out"></textarea></div>`,
    submitLabel: "Submit gatepass",
    onSubmit: async values => {
      const quantity = Number(values.quantity);
      const itemName = values.itemName.trim();
      const unit = values.unit.trim();
      if (!itemName || !Number.isInteger(quantity) || quantity < 1 || !unit || !values.destination.trim()) {
        showToast("Enter an item, quantity, unit, and destination.");
        return false;
      }
      const { error } = await supabase.from("gatepasses").insert({
        gatepass_number: makeId("GP"),
        requester_id: authUser.id,
        requester_name: profile.display_name,
        item_name: itemName,
        quantity,
        unit,
        destination: values.destination.trim(),
        purpose: values.purpose.trim(),
        status: "pending"
      });
      if (error) {
        showOperationError("Submitting gatepass", error);
        return false;
      }
      await loadData();
      activeView = "gatepasses";
      render();
      showToast("Gatepass submitted to C for verification.");
      return true;
    }
  });
}

async function confirmRequest(id, available) {
  if (activeRole !== "B") return;
  const request = data.requests.find(item => item.id === id && item.status === "Pending");
  if (!request) return;
  const { data: updated, error } = await supabase
    .from("stock_requests")
    .update({
      status: available ? "confirmed" : "unavailable",
      note: available ? "" : "Stock unavailable. Please contact Stock Requisition.",
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    showOperationError("Reviewing stock request", error);
    return;
  }
  if (!updated) {
    showToast("This request was already reviewed. Refresh to see the latest status.");
    await refreshWorkspace();
    return;
  }
  await loadData();
  render();
  showToast(available ? "Request confirmed. A can collect the items." : "Request marked unavailable.");
}

async function updateGatepass(id, status) {
  if (activeRole !== "C") return;
  const pass = data.gatepasses.find(item => item.id === id && item.status === "Pending");
  if (!pass) return;
  const { data: updated, error } = await supabase
    .from("gatepasses")
    .update({
      status: status.toLowerCase(),
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    showOperationError("Reviewing gatepass", error);
    return;
  }
  if (!updated) {
    showToast("This gatepass was already reviewed. Refresh to see the latest status.");
    await refreshWorkspace();
    return;
  }
  await loadData();
  render();
  showToast(status === "Verified" ? "Gatepass verified. It is now visible to Guard D." : "Gatepass rejected.");
}

async function deleteRecord(collection, id) {
  let result;
  if (collection === "requests") {
    const item = data.requests.find(record => record.id === id);
    if (!item || (activeRole !== "A" && activeRole !== "B") || (activeRole === "A" && (item.requester !== "A" || item.status !== "Pending"))) return;
    result = await supabase.from("stock_requests").delete().eq("id", id).eq("status", "pending").select("id").maybeSingle();
  } else if (collection === "gatepasses") {
    const item = data.gatepasses.find(record => record.id === id);
    if (!item || activeRole !== "A" || item.requester !== "A" || item.status !== "Pending") return;
    result = await supabase.from("gatepasses").delete().eq("id", id).eq("status", "pending").select("id").maybeSingle();
  }
  if (result.error) {
    showOperationError("Deleting record", result.error);
    return;
  }
  if (!result.data) {
    showToast("This record is no longer pending.");
    await refreshWorkspace();
    return;
  }
  await loadData();
  render();
  showToast("Record deleted.");
}

function applyFilters() {
  const search = document.querySelector("[data-search]");
  const filter = document.querySelector("[data-filter]");
  const rows = document.getElementById("record-rows");
  if (!rows) return;
  const query = search?.value.trim().toLowerCase() || "";
  const status = filter?.value || "";
  [...rows.querySelectorAll("tr")].forEach(row => {
    const matchesText = row.textContent.toLowerCase().includes(query);
    const matchesStatus = !status || row.querySelector(".status")?.textContent.trim() === status;
    row.hidden = !(matchesText && matchesStatus);
  });
}

document.addEventListener("click", event => {
  const authModeButton = event.target.closest("[data-auth-mode]");
  if (authModeButton) {
    authMode = authModeButton.dataset.authMode;
    renderAuthMode();
    return;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) {
    activeView = nav.dataset.view;
    render();
    return;
  }
  const goto = event.target.closest("[data-goto]");
  if (goto) {
    activeView = goto.dataset.goto;
    render();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const id = action.dataset.id;
  if (action.dataset.action === "signout") {
    signOut();
    return;
  }
  switch (action.dataset.action) {
    case "new-request": openRequestModal(); break;
    case "new-gatepass": openGatepassModal(); break;
    case "confirm-request": confirmRequest(id, true); break;
    case "unavailable-request": confirmRequest(id, false); break;
    case "verify-gatepass": updateGatepass(id, "Verified"); break;
    case "reject-gatepass": updateGatepass(id, "Rejected"); break;
    case "delete-request": deleteRecord("requests", id); break;
    case "delete-gatepass": deleteRecord("gatepasses", id); break;
  }
});

document.addEventListener("input", event => {
  if (event.target.matches("[data-search]")) applyFilters();
});
document.addEventListener("change", event => {
  if (event.target.matches("[data-filter]")) applyFilters();
});
document.addEventListener("submit", async event => {
  if (event.target.id !== "auth-form") return;
  event.preventDefault();
  if (!supabase) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  showAuthNotice("");
  try {
    if (authMode === "signup") {
      const { data: result, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: { data: { display_name: values.name.trim() } }
      });
      if (error) throw error;
      if (!result.session) {
        showAuthNotice("Account created. Check your email to confirm it, then sign in. An administrator must assign your role before you can enter the workspace.");
      } else {
        showAuthNotice("Account created. An administrator must assign your role before you can enter the workspace.");
        await handleAuthSession(result.session);
      }
    } else {
      const { data: result, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password
      });
      if (error) throw error;
      await handleAuthSession(result.session);
    }
  } catch (error) {
    showAuthNotice(error.message || "Authentication failed. Please try again.", true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

initializeAuth();
