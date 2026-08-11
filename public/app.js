const form = document.getElementById("chatForm");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("message");
const nameInput = document.getElementById("name");
const sendBtn = document.getElementById("sendBtn");

let sessionId =
  localStorage.getItem("mim_session_id") ||
  `WEB-${crypto.randomUUID()}`;

localStorage.setItem("mim_session_id", sessionId);

function addMessage(text, type = "assistant") {
  const row = document.createElement("div");
  row.className = `message ${type}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  return row;
}

function typing() {
  const row = document.createElement("div");

  row.className = "message assistant";

  row.innerHTML = `
    <div class="bubble typing">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  return row;
}

async function sendMessage(text) {
  const clean = text.trim();

  if (!clean) return;

  addMessage(clean, "user");

  messageInput.value = "";
  sendBtn.disabled = true;

  const typingRow = typing();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        name: nameInput.value.trim() || "Website Visitor",
        channel: "web",
        message: clean,
        session_id: sessionId
      })
    });

    const data = await response.json();

    typingRow.remove();

    if (!response.ok) {
      addMessage(
        data.reply || "Support is temporarily unavailable.",
        "system"
      );

      return;
    }

    if (data.session_id) {
      sessionId = data.session_id;

      localStorage.setItem(
        "mim_session_id",
        sessionId
      );
    }

    addMessage(
      data.reply ||
      "Thanks — your request has been received."
    );

  } catch (error) {
    typingRow.remove();

    addMessage(
      "I couldn't reach support just now. Please try again.",
      "system"
    );

  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

document
  .querySelectorAll("[data-message]")
  .forEach(button => {
    button.addEventListener("click", () => {
      sendMessage(button.dataset.message);
    });
  });


// CASE STATUS TRACKER

const caseStatusForm =
  document.getElementById("caseStatusForm");

const caseIdInput =
  document.getElementById("caseId");

const caseStatusBtn =
  document.getElementById("caseStatusBtn");

const caseStatusMessage =
  document.getElementById("caseStatusMessage");

const caseResult =
  document.getElementById("caseResult");

const resultCaseId =
  document.getElementById("resultCaseId");

const resultStatus =
  document.getElementById("resultStatus");

const resultAssignedTo =
  document.getElementById("resultAssignedTo");

const resultAssignedAt =
  document.getElementById("resultAssignedAt");

const resultResolvedAt =
  document.getElementById("resultResolvedAt");

const resultResolutionNote =
  document.getElementById("resultResolutionNote");

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function updateStatusStyle(status) {
  resultStatus.className = "status-badge";

  const normalized =
    String(status || "").toLowerCase();

  if (normalized === "resolved") {
    resultStatus.classList.add("status-resolved");

  } else if (normalized === "open") {
    resultStatus.classList.add("status-open");

  } else if (
    normalized === "in progress" ||
    normalized === "in_progress"
  ) {
    resultStatus.classList.add("status-progress");

  } else {
    resultStatus.classList.add("status-default");
  }
}

caseStatusForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const caseId =
      caseIdInput.value.trim();

    if (!caseId) return;

    caseStatusBtn.disabled = true;
    caseStatusBtn.textContent = "Checking...";

    caseStatusMessage.textContent =
      "Looking up your case...";

    caseStatusMessage.className =
      "case-status-message loading";

    caseResult.classList.add("hidden");

    try {
      const response = await fetch(
        `/api/case-status?Case_Id=${encodeURIComponent(caseId)}`
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        caseStatusMessage.textContent =
          data.message || "Case could not be found.";

        caseStatusMessage.className =
          "case-status-message error";

        return;
      }

      caseStatusMessage.textContent =
        "Case found.";

      caseStatusMessage.className =
        "case-status-message success";

      resultCaseId.textContent =
        data.Case_Id || caseId;

      resultStatus.textContent =
        data.case_status || "Unknown";

      updateStatusStyle(data.case_status);

      resultAssignedTo.textContent =
        data.assigned_to || "Not assigned";

      resultAssignedAt.textContent =
        formatDate(data.assigned_at);

      resultResolvedAt.textContent =
        formatDate(data.resolved_at);

      resultResolutionNote.textContent =
        data.resolution_note ||
        "No resolution note available.";

      caseResult.classList.remove("hidden");

    } catch (error) {
      caseStatusMessage.textContent =
        "Unable to check case status right now. Please try again.";

      caseStatusMessage.className =
        "case-status-message error";

    } finally {
      caseStatusBtn.disabled = false;
      caseStatusBtn.textContent = "Check Status";
    }
  }
);
