// /api/ics.js
// Generates an .ics for a Flight Lab from Webflow CMS data
// Works for single or multi-session labs (uses UTC timestamps).
// Optional token protection via HMAC (see ENV below).

const crypto = require("crypto");
const { createLogger } = require('../lib/logger');
const { getWebflowItem } = require('../lib/webflow');
const { HTTP_STATUS, WEBFLOW_FIELDS } = require('../lib/constants');
const { requireEnv, getEnv } = require('../lib/validation');

const logger = createLogger('ics');

// -------- ENV you should set in Vercel --------
// WEBFLOW_TOKEN=  (Private access token)
// WEBFLOW_COLLECTION_ID=  (Flight Labs collection ID)
// ICS_REQUIRE_TOKEN=true|false   (default false)
// ICS_HMAC_SECRET=  (if ICS_REQUIRE_TOKEN=true)

/**
 * GET /api/ics
 *
 * Generates an ICS calendar file for a Flight Lab.
 * Supports two modes:
 * 1. Webflow fetch: ?lab=<itemId>&t=<token>
 * 2. Quick-start: ?name=&meet=&url=&sessions=<base64url(JSON)>&t=<token>
 */
async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).send("Method Not Allowed");
  }

  try {
    // Accept either:
    // - ?lab=<Webflow Item ID>   (preferred)
    // - (quick start) ?name=&meet=&url=&sessions=<base64url(JSON[{start,end}])>
    const { lab, t, name, meet, url, sessions } = req.query;

    const requireToken = getEnv('ICS_REQUIRE_TOKEN', 'false');
    if (requireToken === "true") {
      if (!t) {
        logger.warn('ICS request missing token');
        return res.status(HTTP_STATUS.UNAUTHORIZED).send("Missing token");
      }
      if (!verifyToken(t)) {
        logger.warn('ICS request with invalid token');
        return res.status(HTTP_STATUS.UNAUTHORIZED).send("Invalid token");
      }
    }

    let labData;

    if (lab) {
      logger.info('Fetching lab from Webflow', { labId: lab });
      labData = await fetchLabFromWebflow(lab);
    } else if (name && sessions) {
      logger.info('Using quick-start mode', { name });
      // Quick-start (no Webflow fetch): build from query
      const sessionsArr = safeParseBase64urlJson(sessions);
      if (!Array.isArray(sessionsArr)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).send("Invalid sessions payload");
      }
      labData = {
        name,
        googleMeetUrl: meet || "",
        labUrl: url || "",
        sessions: sessionsArr,
      };
    } else {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .send("Provide ?lab=<itemId> or quick-start params (?name&sessions=base64url)");
    }

    if (!labData || !Array.isArray(labData.sessions) || labData.sessions.length === 0) {
      logger.warn('No sessions found for lab', { lab, name });
      return res.status(HTTP_STATUS.NOT_FOUND).send("No sessions found for this lab");
    }

    logger.info('Generating ICS file', {
      labName: labData.name,
      sessionCount: labData.sessions.length
    });

    const ics = buildICS(labData);

    const fileName =
      "krav-" + (slugify(labData.name || "flight-lab")) + ".ics";

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    logger.info('ICS file generated successfully', { fileName });

    // Important: ICS prefers CRLF line endings
    return res.status(HTTP_STATUS.OK).send(ics);
  } catch (err) {
    logger.error('ICS generation error', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).send("Internal Server Error");
  }
}

// ---------- Helpers ----------

function toICSDate(iso) {
  // Convert ISO string to YYYYMMDDTHHMMSSZ
  const z = new Date(iso).toISOString(); // always UTC
  return z.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escICS(s = "") {
  // Escape commas, semicolons, and newlines per RFC5545
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldLine(line) {
  // Optional folding at 75 octets; many clients work without this,
  // but it's safer to fold long DESCRIPTION/URL lines.
  if (!line) return "";
  const chunks = [];
  let i = 0;
  while (i < line.length) {
    chunks.push(line.slice(i, i + 73));
    i += 73;
  }
  return chunks.join("\r\n ");
}

function buildICS({ name, googleMeetUrl, labUrl, sessions }) {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Krav Flight Labs//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${foldLine(escICS(`${name} (Krāv Flight Lab)`))}`,
  ].join("\r\n");

  const events = sessions
    .map((s, idx) => {
      const dtStart = toICSDate(s.start);
      const dtEnd = toICSDate(s.end);
      const uid = `${slugify(name)}-${idx}@krav.to`;

      const summary = `SUMMARY:${foldLine(escICS(`${name} with Coach`))}`;
      const description = [
        `DESCRIPTION:${foldLine(escICS(`Join link: ${googleMeetUrl || ""}`))}`,
        labUrl ? ` ${foldLine(escICS(`Lab page: ${labUrl}`))}` : "",
      ]
        .filter(Boolean)
        .join("\\n");

      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toICSDate(new Date().toISOString())}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        summary,
        description,
        `LOCATION:${foldLine(escICS(googleMeetUrl ? "Google Meet" : ""))}`,
        labUrl ? `URL:${foldLine(escICS(labUrl))}` : "",
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");

  const footer = "END:VCALENDAR";

  // Ensure CRLF and a blank line between header and first VEVENT
  return [header, "", events, footer].join("\r\n");
}

function slugify(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function safeParseBase64urlJson(b64u) {
  try {
    const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
    const base64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function verifyToken(token) {
  // Token format: base64url(payload).base64url(signature)
  // signature = HMAC_SHA256(base64url(payload), ICS_HMAC_SECRET)
  try {
    const secret = process.env.ICS_HMAC_SECRET;
    if (!secret) return false;

    const [payloadB64u, sigB64u] = token.split(".");
    if (!payloadB64u || !sigB64u) return false;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(payloadB64u)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return crypto.timingSafeEqual(Buffer.from(sigB64u), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function fetchLabFromWebflow(itemId) {
  const collectionId = requireEnv('WEBFLOW_COLLECTION_ID');
  const data = await getWebflowItem(collectionId, itemId);

  // v2 response typically: { item: { fieldData: {...} } }
  const item = data.item || data;
  const f = item.fieldData || item;

  // Map field API names
  const sessionsRaw = f[WEBFLOW_FIELDS.SESSIONS_JSON];
  let sessions = sessionsRaw;
  if (typeof sessionsRaw === "string") {
    try {
      sessions = JSON.parse(sessionsRaw);
    } catch {
      sessions = [];
    }
  }

  return {
    name: f[WEBFLOW_FIELDS.NAME] || "Flight Lab",
    googleMeetUrl: f[WEBFLOW_FIELDS.GOOGLE_MEET_URL] || "",
    labUrl: f[WEBFLOW_FIELDS.LAB_URL] || "",
    sessions: Array.isArray(sessions) ? sessions : [],
  };
}

module.exports = handler;
