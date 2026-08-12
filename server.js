const express = require("express");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// SMALL HELPER
// =====================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response) {
  const raw = await response.text();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {
      raw
    };
  }
}

// =====================================================
// CHAT API
// =====================================================

app.post("/api/chat", async (req, res) => {
  try {
    const {
      name,
      message,
      channel = "web",
      session_id
    } = req.body || {};

    if (
      !message ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        status: "invalid",
        reply: "Please enter a message so I can help you."
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        status: "invalid",
        reply:
          "Your message is too long. Please shorten it and try again."
      });
    }

    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    const apiKey = process.env.N8N_API_KEY;

    if (!webhookUrl || !apiKey) {
      return res.status(500).json({
        status: "configuration_error",
        reply: "The demo backend is not configured yet."
      });
    }

    const customerId =
      req.body.customer_id ||
      `WEB-${crypto.randomUUID()}`;

    const finalSessionId =
      session_id ||
      `SESSION-${crypto.randomUUID()}`;

    const payload = {
      customer_id: customerId,
      name: (name || "Website Visitor").trim(),
      channel,
      message: message.trim(),
      session_id: finalSessionId
    };

    const response = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey
        },
        body: JSON.stringify(payload)
      },
      25000
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return res.status(502).json({
        status: "upstream_error",
        reply:
          data.reply ||
          data.message ||
          data.raw ||
          "Support is temporarily unavailable. Please try again shortly."
      });
    }

    return res.json({
      status: data.status || "ok",
      reply:
        data.reply ||
        "Thanks — your request has been received.",
      session_id: finalSessionId
    });
  } catch (error) {
    const timedOut =
      error && error.name === "AbortError";

    console.error("Chat API error:", error);

    return res.status(502).json({
      status: timedOut ? "timeout" : "error",
      reply: timedOut
        ? "Support is taking longer than expected. Please try again."
        : "Something went wrong. Please try again shortly."
    });
  }
});

// =====================================================
// CASE STATUS API
// =====================================================

app.get("/api/case-status", async (req, res) => {
  try {
    const caseId = String(
      req.query.Case_Id || ""
    ).trim();

    if (!caseId) {
      return res.status(400).json({
        success: false,
        message: "Please provide a Case ID."
      });
    }

    const caseStatusUrl =
      process.env.N8N_CASE_STATUS_URL;

    if (!caseStatusUrl) {
      return res.status(500).json({
        success: false,
        message:
          "Case status service is not configured yet."
      });
    }

    const url = new URL(caseStatusUrl);
    url.searchParams.set("Case_Id", caseId);

    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      },
      15000
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data.message ||
          data.reply ||
          data.raw ||
          "Unable to retrieve case status right now."
      });
    }

    return res.json(data);
  } catch (error) {
    const timedOut =
      error && error.name === "AbortError";

    console.error("Case status API error:", error);

    return res.status(502).json({
      success: false,
      message: timedOut
        ? "Case status lookup is taking longer than expected. Please try again."
        : "Unable to retrieve case status right now."
    });
  }
});

// =====================================================
// ADMIN — GET CASES
// =====================================================

app.get("/api/admin/cases", async (_req, res) => {
  try {
    const adminCasesUrl =
      process.env.N8N_ADMIN_CASES_URL;

    if (!adminCasesUrl) {
      return res.status(500).json({
        success: false,
        message:
          "Admin cases service is not configured yet."
      });
    }

    const response = await fetchWithTimeout(
      adminCasesUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      },
      15000
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data.message ||
          data.reply ||
          data.raw ||
          "Unable to load support cases right now."
      });
    }

    if (!Array.isArray(data)) {
      return res.status(502).json({
        success: false,
        message:
          "Admin cases service returned an invalid response."
      });
    }

    return res.json(data);
  } catch (error) {
    const timedOut =
      error && error.name === "AbortError";

    console.error("Admin cases API error:", error);

    return res.status(502).json({
      success: false,
      message: timedOut
        ? "Loading cases is taking longer than expected. Please try again."
        : "Unable to load support cases right now."
    });
  }
});

// =====================================================
// ADMIN — UPDATE CASE
// =====================================================

app.post("/api/admin/cases/update", async (req, res) => {
  try {
    const {
      Case_Id,
      case_status,
      assigned_to,
      resolution_note
    } = req.body || {};

    const caseId = String(
      Case_Id || ""
    ).trim();

    const status = String(
      case_status || ""
    ).trim();

    const assignedTo = String(
      assigned_to || ""
    ).trim();

    const resolutionNote = String(
      resolution_note || ""
    ).trim();

    if (!caseId) {
      return res.status(400).json({
        success: false,
        message: "Case ID is required."
      });
    }

    const allowedStatuses = [
      "Open",
      "Assigned",
      "Resolved"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid case status. Allowed values are Open, Assigned or Resolved."
      });
    }

    if (
      (status === "Assigned" ||
        status === "Resolved") &&
      !assignedTo
    ) {
      return res.status(400).json({
        success: false,
        message:
          "An assigned agent is required for this status."
      });
    }

    if (
      status === "Resolved" &&
      !resolutionNote
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A resolution note is required before resolving the case."
      });
    }

    const updateUrl =
      process.env.N8N_ADMIN_CASE_UPDATE_URL;

    if (!updateUrl) {
      return res.status(500).json({
        success: false,
        message:
          "Admin case update service is not configured yet."
      });
    }

    const payload = {
      Case_Id: caseId,
      case_status: status,
      assigned_to: assignedTo,
      resolution_note: resolutionNote
    };

    const response = await fetchWithTimeout(
      updateUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      },
      15000
    );

    const data = await readJsonResponse(response);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data.message ||
          data.reply ||
          data.raw ||
          "Unable to update this case right now."
      });
    }

    return res.json({
      success:
        data.success !== false,
      Case_Id:
        data.Case_Id || caseId,
      case_status:
        data.case_status || status,
      message:
        data.message ||
        "Case updated successfully"
    });
  } catch (error) {
    const timedOut =
      error && error.name === "AbortError";

    console.error("Admin update API error:", error);

    return res.status(502).json({
      success: false,
      message: timedOut
        ? "Case update is taking longer than expected. Please try again."
        : "Unable to update this case right now."
    });
  }
});

// =====================================================
// ADMIN PAGE SHORT URL
// =====================================================

app.get("/admin", (_req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    )
  );
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "MIM AI Customer Support Demo"
  })
);

app.listen(PORT, () =>
  console.log(
    `MIM AI demo running on http://localhost:${PORT}`
  )
);
