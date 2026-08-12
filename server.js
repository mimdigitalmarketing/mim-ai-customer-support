const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json({ limit: "32kb" }));

// =====================================================
// SESSION CONFIG
// =====================================================

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  console.error("SESSION_SECRET is missing.");
  process.exit(1);
}

app.use(
  session({
    name: "mim.support.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

// =====================================================
// AUTH HELPERS
// =====================================================

function isAdminAuthenticated(req) {
  return Boolean(
    req.session &&
    req.session.admin &&
    req.session.admin.authenticated === true
  );
}

function requireAdminApi(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  next();
}

function requireAdminPage(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.redirect("/login.html");
  }

  next();
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a || ""));
  const bBuffer = Buffer.from(String(b || ""));

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

// =====================================================
// LOGIN / LOGOUT
// =====================================================

app.post("/api/admin/login", (req, res) => {
  const username = String(
    req.body?.username || ""
  ).trim();

  const password = String(
    req.body?.password || ""
  );

  const expectedUsername =
    process.env.ADMIN_USERNAME || "";

  const expectedPassword =
    process.env.ADMIN_PASSWORD || "";

  if (!expectedUsername || !expectedPassword) {
    return res.status(500).json({
      success: false,
      message:
        "Admin authentication is not configured."
    });
  }

  const usernameValid =
    safeEqual(username, expectedUsername);

  const passwordValid =
    safeEqual(password, expectedPassword);

  if (!usernameValid || !passwordValid) {
    return res.status(401).json({
      success: false,
      message: "Invalid username or password."
    });
  }

  req.session.regenerate(error => {
    if (error) {
      console.error(
        "Session regeneration error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to start a secure session."
      });
    }

    req.session.admin = {
      authenticated: true,
      username: expectedUsername,
      loginAt: new Date().toISOString()
    };

    req.session.save(saveError => {
      if (saveError) {
        console.error(
          "Session save error:",
          saveError
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to save the login session."
        });
      }

      return res.json({
        success: true,
        username: expectedUsername
      });
    });
  });
});

app.post("/api/admin/logout", (req, res) => {
  if (!req.session) {
    return res.json({
      success: true
    });
  }

  req.session.destroy(error => {
    if (error) {
      console.error(
        "Session destroy error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to log out."
      });
    }

    res.clearCookie("mim.support.sid");

    return res.json({
      success: true
    });
  });
});

app.get(
  "/api/admin/session",
  requireAdminApi,
  (req, res) => {
    return res.json({
      success: true,
      authenticated: true,
      username:
        req.session.admin.username
    });
  }
);

// =====================================================
// ADMIN PAGE PROTECTION
// =====================================================

app.get(
  "/admin",
  requireAdminPage,
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

app.get(
  "/admin.html",
  requireAdminPage,
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

app.get(
  "/admin.js",
  requireAdminPage,
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.js"
      )
    );
  }
);

app.get(
  "/admin.css",
  requireAdminPage,
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.css"
      )
    );
  }
);

// Public files such as index.html, login.html,
// app.js and styles.css remain accessible.
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// SMALL HELPERS
// =====================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 15000
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

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
        reply:
          "Please enter a message so I can help you."
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        status: "invalid",
        reply:
          "Your message is too long. Please shorten it and try again."
      });
    }

    const webhookUrl =
      process.env.N8N_WEBHOOK_URL;

    const apiKey =
      process.env.N8N_API_KEY;

    if (!webhookUrl || !apiKey) {
      return res.status(500).json({
        status: "configuration_error",
        reply:
          "The demo backend is not configured yet."
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
      name:
        (name || "Website Visitor").trim(),
      channel,
      message: message.trim(),
      session_id: finalSessionId
    };

    const response =
      await fetchWithTimeout(
        webhookUrl,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "X-API-Key": apiKey
          },
          body:
            JSON.stringify(payload)
        },
        25000
      );

    const data =
      await readJsonResponse(response);

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
      status:
        data.status || "ok",

      reply:
        data.reply ||
        "Thanks — your request has been received.",

      session_id:
        finalSessionId
    });
  } catch (error) {
    const timedOut =
      error &&
      error.name === "AbortError";

    console.error(
      "Chat API error:",
      error
    );

    return res.status(502).json({
      status:
        timedOut
          ? "timeout"
          : "error",

      reply:
        timedOut
          ? "Support is taking longer than expected. Please try again."
          : "Something went wrong. Please try again shortly."
    });
  }
});

// =====================================================
// CASE STATUS API
// =====================================================

app.get(
  "/api/case-status",
  async (req, res) => {
    try {
      const caseId =
        String(
          req.query.Case_Id || ""
        ).trim();

      if (!caseId) {
        return res.status(400).json({
          success: false,
          message:
            "Please provide a Case ID."
        });
      }

      const caseStatusUrl =
        process.env
          .N8N_CASE_STATUS_URL;

      if (!caseStatusUrl) {
        return res.status(500).json({
          success: false,
          message:
            "Case status service is not configured yet."
        });
      }

      const url =
        new URL(caseStatusUrl);

      url.searchParams.set(
        "Case_Id",
        caseId
      );

      const response =
        await fetchWithTimeout(
          url.toString(),
          {
            method: "GET",
            headers: {
              Accept:
                "application/json"
            }
          },
          15000
        );

      const data =
        await readJsonResponse(
          response
        );

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
        error &&
        error.name === "AbortError";

      console.error(
        "Case status API error:",
        error
      );

      return res.status(502).json({
        success: false,

        message:
          timedOut
            ? "Case status lookup is taking longer than expected. Please try again."
            : "Unable to retrieve case status right now."
      });
    }
  }
);

// =====================================================
// ADMIN — GET CASES
// =====================================================

app.get(
  "/api/admin/cases",
  requireAdminApi,
  async (_req, res) => {
    try {
      const adminCasesUrl =
        process.env
          .N8N_ADMIN_CASES_URL;

      if (!adminCasesUrl) {
        return res.status(500).json({
          success: false,
          message:
            "Admin cases service is not configured yet."
        });
      }

      const response =
        await fetchWithTimeout(
          adminCasesUrl,
          {
            method: "GET",
            headers: {
              Accept:
                "application/json"
            }
          },
          15000
        );

      const data =
        await readJsonResponse(
          response
        );

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
        error &&
        error.name === "AbortError";

      console.error(
        "Admin cases API error:",
        error
      );

      return res.status(502).json({
        success: false,

        message:
          timedOut
            ? "Loading cases is taking longer than expected. Please try again."
            : "Unable to load support cases right now."
      });
    }
  }
);

// =====================================================
// ADMIN — UPDATE CASE
// =====================================================

app.post(
  "/api/admin/cases/update",
  requireAdminApi,
  async (req, res) => {
    try {
      const {
        Case_Id,
        case_status,
        assigned_to,
        resolution_note
      } = req.body || {};

      const caseId =
        String(
          Case_Id || ""
        ).trim();

      const status =
        String(
          case_status || ""
        ).trim();

      const assignedTo =
        String(
          assigned_to || ""
        ).trim();

      const resolutionNote =
        String(
          resolution_note || ""
        ).trim();

      if (!caseId) {
        return res.status(400).json({
          success: false,
          message:
            "Case ID is required."
        });
      }

      const allowedStatuses = [
        "Open",
        "Assigned",
        "Resolved"
      ];

      if (
        !allowedStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid case status. Allowed values are Open, Assigned or Resolved."
        });
      }

      if (
        (
          status === "Assigned" ||
          status === "Resolved"
        ) &&
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
        process.env
          .N8N_ADMIN_CASE_UPDATE_URL;

      if (!updateUrl) {
        return res.status(500).json({
          success: false,
          message:
            "Admin case update service is not configured yet."
        });
      }

      const payload = {
        Case_Id:
          caseId,

        case_status:
          status,

        assigned_to:
          assignedTo,

        resolution_note:
          resolutionNote
      };

      const response =
        await fetchWithTimeout(
          updateUrl,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json"
            },
            body:
              JSON.stringify(payload)
          },
          15000
        );

      const data =
        await readJsonResponse(
          response
        );

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
          data.Case_Id ||
          caseId,

        case_status:
          data.case_status ||
          status,

        message:
          data.message ||
          "Case updated successfully"
      });
    } catch (error) {
      const timedOut =
        error &&
        error.name === "AbortError";

      console.error(
        "Admin update API error:",
        error
      );

      return res.status(502).json({
        success: false,

        message:
          timedOut
            ? "Case update is taking longer than expected. Please try again."
            : "Unable to update this case right now."
      });
    }
  }
);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
  "/health",
  (_req, res) =>
    res.json({
      ok: true,
      service:
        "MIM AI Customer Support Demo"
    })
);

app.listen(
  PORT,
  () =>
    console.log(
      `MIM AI demo running on http://localhost:${PORT}`
    )
);
