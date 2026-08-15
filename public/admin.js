let AGENT_NAME = "";

const els = {
  totalCases: document.getElementById("totalCases"),
  openCases: document.getElementById("openCases"),
  assignedCases: document.getElementById("assignedCases"),
  resolvedCases: document.getElementById("resolvedCases"),

  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  emptyState: document.getElementById("emptyState"),
  casesList: document.getElementById("casesList"),

  searchInput: document.getElementById("searchInput"),
  refreshBtn: document.getElementById("refreshBtn"),

  emptyDetails: document.getElementById("emptyDetails"),
  caseDetails: document.getElementById("caseDetails"),

  detailCaseId: document.getElementById("detailCaseId"),
  detailStatus: document.getElementById("detailStatus"),
  detailMessage: document.getElementById("detailMessage"),
  detailCustomer: document.getElementById("detailCustomer"),
  detailIntent: document.getElementById("detailIntent"),
  detailAssignedTo: document.getElementById("detailAssignedTo"),
  detailCreatedAt: document.getElementById("detailCreatedAt"),
  detailReason: document.getElementById("detailReason"),

  resolutionNote: document.getElementById("resolutionNote"),
  assignBtn: document.getElementById("assignBtn"),
  resolveBtn: document.getElementById("resolveBtn"),
  actionMessage: document.getElementById("actionMessage")
};
async function loadLoggedInAgent() {
  const response = await fetch("/api/admin/session", {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    window.location.replace("/login.html");
    return false;
  }

  const data = await response.json();

  if (!response.ok || !data.authenticated) {
    window.location.replace("/login.html");
    return false;
  }

  AGENT_NAME = data.name || data.username || "Support Agent";

  document
    .querySelectorAll(".sidebar-footer strong")
    .forEach(el => {
      el.textContent = AGENT_NAME;
    });

  return true;
}
let allCases = [];
let activeFilter = "all";
let selectedCaseId = null;

/* =========================
   HELPERS
========================= */

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
}

function normalizeStatus(status) {
  return safeText(status, "Open").trim();
}

function statusClass(status) {
  const value = normalizeStatus(status).toLowerCase();

  if (value === "resolved") return "status-resolved";
  if (value === "assigned") return "status-assigned";
  if (value === "escalated") return "status-escalated";

  return "status-open";
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCaseId(item) {
  return item.Case_Id || item.case_id || "";
}

function getCreatedDate(item) {
  return item.createdAt || item.timestamp || null;
}

function setActionMessage(message = "", type = "") {
  els.actionMessage.textContent = message;
  els.actionMessage.className = "action-message";

  if (type) {
    els.actionMessage.classList.add(type);
  }
}

function setBusy(isBusy) {
  els.assignBtn.disabled = isBusy;
  els.resolveBtn.disabled = isBusy;
  els.refreshBtn.disabled = isBusy;
}

/* =========================
   LOAD CASES
========================= */

async function loadCases({ preserveSelection = true } = {}) {
  els.loadingState.classList.remove("hidden");
  els.errorState.classList.add("hidden");
  els.emptyState.classList.add("hidden");

  els.refreshBtn.disabled = true;

  try {
    const response = await fetch("/api/admin/cases", {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Cases API returned ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Invalid cases response");
    }

    allCases = data.filter(item => getCaseId(item));

    updateStats();
    renderCases();

    if (
      preserveSelection &&
      selectedCaseId &&
      allCases.some(item => getCaseId(item) === selectedCaseId)
    ) {
      selectCase(selectedCaseId);
    } else if (!preserveSelection) {
      clearSelectedCase();
    }
  } catch (error) {
    console.error("Unable to load admin cases:", error);

    allCases = [];
    updateStats();
    els.casesList.innerHTML = "";

    els.errorState.classList.remove("hidden");
    clearSelectedCase();
  } finally {
    els.loadingState.classList.add("hidden");
    els.refreshBtn.disabled = false;
  }
}

/* =========================
   STATS
========================= */

function updateStats() {
  const open = allCases.filter(
    item => normalizeStatus(item.case_status).toLowerCase() === "open"
  ).length;

  const assigned = allCases.filter(
    item => normalizeStatus(item.case_status).toLowerCase() === "assigned"
  ).length;

  const resolved = allCases.filter(
    item => normalizeStatus(item.case_status).toLowerCase() === "resolved"
  ).length;

  els.totalCases.textContent = allCases.length;
  els.openCases.textContent = open;
  els.assignedCases.textContent = assigned;
  els.resolvedCases.textContent = resolved;
}

function filteredCases() {
  const query =
    els.searchInput.value.trim().toLowerCase();

  return allCases.filter(item => {
    const status =
      normalizeStatus(item.case_status);

    const assignedTo =
      safeText(item.assigned_to, "")
        .trim()
        .toLowerCase();

    const loggedInAgent =
      AGENT_NAME.trim().toLowerCase();

    let matchesFilter = false;

    // All cases
    if (activeFilter === "all") {
      matchesFilter = true;
    }

    // My Cases:
    // Show cases assigned to the currently logged-in agent
    else if (activeFilter === "My Cases") {
      matchesFilter =
        assignedTo === loggedInAgent &&
        assignedTo !== "";
    }

    // Normal status filters:
    // Open, Assigned, Resolved
    else {
      matchesFilter =
        status.toLowerCase() ===
        activeFilter.toLowerCase();
    }

    if (!matchesFilter) {
      return false;
    }

    // No search text = case already matches filter
    if (!query) {
      return true;
    }

    const searchableText = [
      getCaseId(item),
      item.customer_id,
      item.message,
      item.intent,
      item.reason,
      item.assigned_to,
      item.case_status
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  });
}

/* =========================
   CASE LIST
========================= */

function renderCases() {
  const cases = filteredCases();

  els.casesList.innerHTML = "";

  if (!cases.length) {
    els.emptyState.classList.remove("hidden");
    return;
  }

  els.emptyState.classList.add("hidden");

  cases.forEach(item => {
    const caseId = getCaseId(item);
    const status = normalizeStatus(item.case_status);

    const row = document.createElement("article");
    row.className = "case-item";

    if (caseId === selectedCaseId) {
      row.classList.add("active");
    }

    row.dataset.caseId = caseId;

    const top = document.createElement("div");
    top.className = "case-top";

    const caseIdEl = document.createElement("div");
    caseIdEl.className = "case-id";
    caseIdEl.textContent = caseId;

    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass(status)}`;
    badge.textContent = status;

    top.appendChild(caseIdEl);
    top.appendChild(badge);

    const message = document.createElement("div");
    message.className = "case-message";
    message.textContent = safeText(item.message, "No customer message available.");

    const meta = document.createElement("div");
    meta.className = "case-meta";

    const intent = document.createElement("span");
    intent.textContent = `Intent: ${safeText(item.intent, "Unknown")}`;

    const assigned = document.createElement("span");
    assigned.textContent = `Assigned: ${safeText(
      item.assigned_to,
      "Not assigned"
    )}`;

    const created = document.createElement("span");
    created.textContent = formatDate(getCreatedDate(item));

    meta.appendChild(intent);
    meta.appendChild(assigned);
    meta.appendChild(created);

    row.appendChild(top);
    row.appendChild(message);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      selectCase(caseId);
    });

    els.casesList.appendChild(row);
  });
}

/* =========================
   DETAILS
========================= */

function clearSelectedCase() {
  selectedCaseId = null;

  els.emptyDetails.classList.remove("hidden");
  els.caseDetails.classList.add("hidden");

  setActionMessage();
}

function selectCase(caseId) {
  const item = allCases.find(
    entry => getCaseId(entry) === caseId
  );

  if (!item) {
    clearSelectedCase();
    return;
  }

  selectedCaseId = caseId;

  els.emptyDetails.classList.add("hidden");
  els.caseDetails.classList.remove("hidden");

  const status = normalizeStatus(item.case_status);

  els.detailCaseId.textContent = caseId;

  els.detailStatus.textContent = status;
  els.detailStatus.className =
    `status-badge ${statusClass(status)}`;

  els.detailMessage.textContent = safeText(
    item.message,
    "No customer message available."
  );

  els.detailCustomer.textContent = safeText(
    item.customer_id,
    "Website Visitor"
  );

  els.detailIntent.textContent = safeText(
    item.intent,
    "Unknown"
  );

  els.detailAssignedTo.textContent = safeText(
    item.assigned_to,
    "Not assigned"
  );

  els.detailCreatedAt.textContent =
    formatDate(getCreatedDate(item));

  els.detailReason.textContent = safeText(
    item.reason,
    "No escalation reason recorded."
  );

  els.resolutionNote.value =
    item.resolution_note || "";

  // =====================================================
  // AGENT OWNERSHIP UI RULES
  // =====================================================

  const normalizedStatus =
    status.toLowerCase();

  const assignedAgent =
    safeText(item.assigned_to, "").trim();

  const isResolved =
    normalizedStatus === "resolved";

  const isOpen =
    normalizedStatus === "open";

  const isAssigned =
    normalizedStatus === "assigned";

  const assignedToMe =
    Boolean(assignedAgent) &&
    assignedAgent.toLowerCase() ===
      AGENT_NAME.trim().toLowerCase();

  const assignedToAnotherAgent =
    isAssigned &&
    Boolean(assignedAgent) &&
    !assignedToMe;

  // -----------------------------------------------------
  // ASSIGN BUTTON
  // Open case       -> enabled
  // My case         -> disabled
  // Other agent     -> disabled
  // Resolved case   -> disabled
  // -----------------------------------------------------

  els.assignBtn.disabled =
    !isOpen;

  if (assignedToMe) {
    els.assignBtn.textContent =
      "Assigned to Me";
  } else if (assignedToAnotherAgent) {
    els.assignBtn.textContent =
      `Assigned to ${assignedAgent}`;
  } else if (isResolved) {
    els.assignBtn.textContent =
      "Case Closed";
  } else {
    els.assignBtn.textContent =
      "Assign to Me";
  }

  // -----------------------------------------------------
  // RESOLVE BUTTON
  // Only logged-in owner can resolve
  // -----------------------------------------------------

  els.resolveBtn.disabled =
    isResolved ||
    !isAssigned ||
    !assignedToMe;

  if (isResolved) {
    els.resolveBtn.textContent =
      "Case Resolved";
  } else if (assignedToAnotherAgent) {
    els.resolveBtn.textContent =
      "Not Your Case";
  } else if (isOpen) {
    els.resolveBtn.textContent =
      "Assign Case First";
  } else {
    els.resolveBtn.textContent =
      "Resolve Case";
  }

  // -----------------------------------------------------
  // RESOLUTION NOTE
  // Only owner of assigned case may edit
  // -----------------------------------------------------

  els.resolutionNote.disabled =
    isResolved ||
    !isAssigned ||
    !assignedToMe;

  // -----------------------------------------------------
  // USER MESSAGE
  // -----------------------------------------------------

  if (assignedToAnotherAgent) {
    setActionMessage(
      `This case is assigned to ${assignedAgent}. Only ${assignedAgent} can resolve it.`,
      "error"
    );
  } else if (isOpen) {
    setActionMessage(
      "Assign this case to yourself before resolving it."
    );
  } else {
    setActionMessage();
  }

  renderCases();
}
/* =========================
   UPDATE CASE
========================= */

async function updateCase(payload) {
  const response = await fetch("/api/admin/cases/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Your session has expired.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message ||
      data.reply ||
      `Update failed with status ${response.status}`
    );
  }

  return data;
}

/* =========================
   ASSIGN CASE
========================= */

async function assignSelectedCase() {
  if (!selectedCaseId) return;

  setBusy(true);
  setActionMessage("Assigning case...");

  try {
    await updateCase({
      Case_Id: selectedCaseId,
      case_status: "Assigned",
      resolution_note: ""
    });

    setActionMessage(
      `Case assigned to ${AGENT_NAME}.`,
      "success"
    );

    await loadCases({
      preserveSelection: true
    });
  } catch (error) {
    console.error("Assign case error:", error);

    setActionMessage(
      error.message || "Unable to assign case.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}

/* =========================
   RESOLVE CASE
========================= */

async function resolveSelectedCase() {
  if (!selectedCaseId) return;

  const selectedCase = allCases.find(
    item => getCaseId(item) === selectedCaseId
  );

  if (!selectedCase) {
    setActionMessage(
      "Unable to find the selected case.",
      "error"
    );
    return;
  }

  const assignedAgent = safeText(
    selectedCase.assigned_to,
    ""
  ).trim();

  const assignedToMe =
    assignedAgent.toLowerCase() ===
    AGENT_NAME.trim().toLowerCase();

  if (!assignedToMe) {
    setActionMessage(
      assignedAgent
        ? `This case belongs to ${assignedAgent}.`
        : "Assign this case to yourself first.",
      "error"
    );
    return;
  }

  const note = els.resolutionNote.value.trim();

  if (!note) {
    setActionMessage(
      "Please enter a resolution note before resolving the case.",
      "error"
    );

    els.resolutionNote.focus();
    return;
  }

  setBusy(true);
  setActionMessage("Resolving case...");

  try {
    await updateCase({
      Case_Id: selectedCaseId,
      case_status: "Resolved",
      resolution_note: note
    });

    // Update the current case locally.
    selectedCase.case_status = "Resolved";
    selectedCase.resolution_note = note;
    selectedCase.resolved_at = new Date().toISOString();

    // Refresh UI only — no API reload.
    updateStats();
    renderCases();
    selectCase(selectedCaseId);

    setActionMessage(
      "Case resolved successfully.",
      "success"
    );
  } catch (error) {
    console.error("Resolve case error:", error);

    setActionMessage(
      error.message || "Unable to resolve case.",
      "error"
    );
  } finally {
    setBusy(false);
  }
}
