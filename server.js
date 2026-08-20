    const express = require("express");
    const path = require("path");
    const crypto = require("crypto");
    const session = require("express-session");
    const bcrypt = require("bcryptjs");
    require("dotenv").config();

    const app = express();
    const PORT = process.env.PORT || 3000;
    let supportAgents = [];

    // Prevent the same customer + request_id from being processed
    // concurrently within this running server instance.
    const inFlightChatRequests = new Set();

    try {
      supportAgents = JSON.parse(
        process.env.SUPPORT_AGENTS_JSON || "[]"
      );

      if (!Array.isArray(supportAgents)) {
        throw new Error("SUPPORT_AGENTS_JSON must be an array");
      }
    } catch (error) {
      console.error(
        "Invalid SUPPORT_AGENTS_JSON:",
        error.message
      );

      process.exit(1);
    }
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

    app.post("/api/admin/login", async (req, res) => {
      try {
        const username = String(
          req.body?.username || ""
        ).trim();

        const password = String(
          req.body?.password || ""
        );

        if (!username || !password) {
          return res.status(400).json({
            success: false,
            message: "Username and password are required."
          });
        }

        const agent = supportAgents.find(
          item =>
            String(item.username || "")
              .trim()
              .toLowerCase() ===
            username.toLowerCase()
        );

        if (!agent || !agent.passwordHash) {
          return res.status(401).json({
            success: false,
            message: "Invalid username or password."
          });
        }

        const passwordValid = await bcrypt.compare(
          password,
          agent.passwordHash
        );

        if (!passwordValid) {
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
            username: agent.username,
            name: agent.name || agent.username,
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
              username: agent.username,
              name: agent.name || agent.username
            });
          });
        });
      } catch (error) {
        console.error(
          "Admin login error:",
          error
        );

        return res.status(500).json({
          success: false,
          message:
            "Unable to sign in right now."
        });
      }
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
            req.session.admin.username,
          name:
            req.session.admin.name
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
  let idempotencyKey = "";
  let acquiredInFlightLock = false;

  try {
    const {
      name,
      message,
      channel = "web",
      session_id,
      request_id
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

    const finalRequestId =
      request_id ||
      `REQ-${crypto.randomUUID()}`;

    idempotencyKey =
      `${customerId}::${finalRequestId}`;

    if (inFlightChatRequests.has(idempotencyKey)) {
      return res.json({
        status: "duplicate",
        reply:
          "We have already received this request and it is currently being handled.",
        session_id: finalSessionId
      });
    }

    inFlightChatRequests.add(idempotencyKey);
    acquiredInFlightLock = true;

    const payload = {
      customer_id: customerId,
      name:
        (name || "Website Visitor").trim(),
      channel,
      message: message.trim(),
      session_id: finalSessionId,
      request_id: finalRequestId
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
        1000
      );

    const data =
      await readJsonResponse(response);

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        return res.status(response.status).json({
          status: data.status || "rejected",
          error: data.error || data.message || "Invalid request",
          reply:
            data.reply ||
            "We could not process your request. Please check your input and try again."
        });
      }

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
  } finally {
    if (acquiredInFlightLock && idempotencyKey) {
      inFlightChatRequests.delete(idempotencyKey);
    }
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
    // ADMIN — GET CASE ACTIVITY
    // =====================================================

    app.get(
      "/api/admin/cases/:caseId/activity",
      requireAdminApi,
      async (req, res) => {
        try {
          const caseId = String(
            req.params?.caseId || ""
          ).trim();

          if (!caseId) {
            return res.status(400).json({
              success: false,
              message: "Case ID is required."
            });
          }

          const activityUrl =
            process.env.N8N_CASE_ACTIVITY_URL;

          if (!activityUrl) {
            return res.status(500).json({
              success: false,
              message:
                "Case activity service is not configured yet."
            });
          }

          const url = new URL(activityUrl);

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
                  Accept: "application/json"
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
                "Unable to load case activity right now."
            });
          }

          if (!Array.isArray(data)) {
            return res.status(502).json({
              success: false,
              message:
                "Case activity service returned an invalid response."
            });
          }

          return res.json(data);
        } catch (error) {
          const timedOut =
            error &&
            error.name === "AbortError";

          console.error(
            "Admin case activity API error:",
            error
          );

          return res.status(502).json({
            success: false,
            message: timedOut
              ? "Loading case activity is taking longer than expected. Please try again."
              : "Unable to load case activity right now."
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
            resolution_note
          } = req.body || {};

          const caseId = String(
            Case_Id || ""
          ).trim();

          const status = String(
            case_status || ""
          ).trim();

          const resolutionNote = String(
            resolution_note || ""
          ).trim();

          const loggedInAgent = String(
            req.session?.admin?.name || ""
          ).trim();

          if (!caseId) {
            return res.status(400).json({
              success: false,
              message: "Case ID is required."
            });
          }

          if (!loggedInAgent) {
            return res.status(401).json({
              success: false,
              message: "Authentication required."
            });
          }

          const allowedStatuses = [
            "Assigned",
            "Resolved"
          ];

          if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
              success: false,
              message:
                "Only case assignment and resolution are allowed."
            });
          }

          // =================================================
          // LOAD CURRENT CASE BEFORE ALLOWING UPDATE
          // =================================================

          const adminCasesUrl =
            process.env.N8N_ADMIN_CASES_URL;

          if (!adminCasesUrl) {
            return res.status(500).json({
              success: false,
              message:
                "Admin cases service is not configured yet."
            });
          }

          const casesResponse = await fetchWithTimeout(
            adminCasesUrl,
            {
              method: "GET",
              headers: {
                Accept: "application/json"
              }
            },
            15000
          );

          const casesData =
            await readJsonResponse(casesResponse);

          if (!casesResponse.ok) {
            return res.status(502).json({
              success: false,
              message:
                "Unable to verify case ownership right now."
            });
          }

          if (!Array.isArray(casesData)) {
            return res.status(502).json({
              success: false,
              message:
                "Case service returned an invalid response."
            });
          }

          const currentCase = casesData.find(
            item =>
              String(item.Case_Id || "").trim() ===
              caseId
          );

          if (!currentCase) {
            return res.status(404).json({
              success: false,
              message: "Case not found."
            });
          }

          const currentStatus = String(
            currentCase.case_status || "Open"
          ).trim();

          const currentAssignedTo = String(
            currentCase.assigned_to || ""
          ).trim();

          // =================================================
          // RULE 1:
          // OPEN CASE CAN BE CLAIMED BY ANY LOGGED-IN AGENT
          // =================================================

          if (status === "Assigned") {
            if (
              currentStatus === "Assigned" &&
              currentAssignedTo
            ) {
              if (currentAssignedTo === loggedInAgent) {
                return res.status(409).json({
                  success: false,
                  message:
                    "This case is already assigned to you."
                });
              }

              return res.status(403).json({
                success: false,
                message:
                  `This case is already assigned to ${currentAssignedTo}.`
              });
            }

            if (currentStatus === "Resolved") {
              return res.status(409).json({
                success: false,
                message:
                  "Resolved cases cannot be reassigned."
              });
            }

            if (currentStatus !== "Open") {
              return res.status(409).json({
                success: false,
                message:
                  "This case cannot be assigned in its current state."
              });
            }
          }

          // =================================================
          // RULE 2:
          // ONLY THE ASSIGNED AGENT CAN RESOLVE THE CASE
          // =================================================

          if (status === "Resolved") {
            if (currentStatus === "Resolved") {
              return res.status(409).json({
                success: false,
                message:
                  "This case has already been resolved."
              });
            }

            if (currentStatus !== "Assigned") {
              return res.status(409).json({
                success: false,
                message:
                  "The case must be assigned before it can be resolved."
              });
            }

            if (!currentAssignedTo) {
              return res.status(409).json({
                success: false,
                message:
                  "This case does not have an assigned agent."
              });
            }

            if (currentAssignedTo !== loggedInAgent) {
              return res.status(403).json({
                success: false,
                message:
                  `This case belongs to ${currentAssignedTo}.`
              });
            }

            if (!resolutionNote) {
              return res.status(400).json({
                success: false,
                message:
                  "A resolution note is required before resolving the case."
              });
            }
          }

          // =================================================
          // UPDATE THROUGH N8N
          // =================================================

          const updateUrl =
            process.env.N8N_ADMIN_CASE_UPDATE_URL;

          if (!updateUrl) {
            return res.status(500).json({
              success: false,
              message:
                "Admin case update service is not configured yet."
            });
          }

          const finalAssignedTo =
            status === "Assigned"
              ? loggedInAgent
              : currentAssignedTo;

          const payload = {
            Case_Id: caseId,
            case_status: status,
            assigned_to: finalAssignedTo,
            resolution_note:
              status === "Resolved"
                ? resolutionNote
                : ""
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

          const data =
            await readJsonResponse(response);

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
            success: data.success !== false,
            Case_Id: data.Case_Id || caseId,
            case_status:
              data.case_status || status,
            assigned_to: finalAssignedTo,
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
            message: timedOut
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
          service: "MIM AI Customer Support Demo"
        })
    );

    // =====================================================
    // START SERVER
    // =====================================================

    app.listen(PORT, () => {
      console.log(
        `MIM AI demo running on http://localhost:${PORT}`
      );
    });
