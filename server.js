const express = require("express");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

// -----------------------------
// CHAT API
// -----------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { name, message, channel = "web", session_id } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        status: "invalid",
        reply: "Please enter a message so I can help you."
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        status: "invalid",
        reply: "Your message is too long. Please shorten it and try again."
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
      req.body.customer_id || `WEB-${crypto.randomUUID()}`;

    const finalSessionId =
      session_id || `SESSION-${crypto.randomUUID()}`;

    const payload = {
      customer_id: customerId,
      name: (name || "Website Visitor").trim(),
      channel,
      message: message.trim(),
      session_id: finalSessionId
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        reply:
          raw || "The support service returned an empty response."
      };
    }

    if (!response.ok) {
      return res.status(502).json({
        status: "upstream_error",
        reply:
          data.reply ||
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

    return res.status(502).json({
      status: timedOut ? "timeout" : "error",
      reply: timedOut
        ? "Support is taking longer than expected. Please try again."
        : "Something went wrong. Please try again shortly."
    });
  }
});

// -----------------------------
// CASE STATUS API
// -----------------------------
app.get("/api/case-status", async (req, res) => {
  try {
    const caseId = String(req.query.Case_Id || "").trim();

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

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      15000
    );

    const url = new URL(caseStatusUrl);
    url.searchParams.set("Case_Id", caseId);

    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal
    });

    clearTimeout(timer);

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        success: false,
        message:
          raw || "The case status service returned an empty response."
      };
    }

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message:
          data.message ||
          "Unable to retrieve case status right now."
      });
    }

    return res.json(data);
  } catch (error) {
    const timedOut =
      error && error.name === "AbortError";

    return res.status(502).json({
      success: false,
      message: timedOut
        ? "Case status lookup is taking longer than expected. Please try again."
        : "Unable to retrieve case status right now."
    });
  }
});

// -----------------------------
// HEALTH CHECK
// -----------------------------
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
