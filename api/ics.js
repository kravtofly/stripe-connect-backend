// /api/ics.js
// Generates an .ics for a Flight Lab from Webflow CMS data
// Works for single or multi-session labs (uses UTC timestamps).
// Optional token protection via HMAC (see ENV below).

const crypto = require("crypto");

// -------- ENV you should set in Vercel --------
// WEBFLOW_TOKEN=  (Private access token)
// WEBFLOW_COLLECTION_ID=  (Flight Labs collection ID)
// ICS_REQUIRE_TOKEN=true|false   (default false)
// ICS_HMAC_SECRET=  (if ICS_REQUIRE_TOKEN=true)
const {
  WEBFLOW_TOKEN,
  WEBFLOW_COLLECTION_ID,
  ICS_REQUIRE_TOKEN = "false",
  ICS_HMAC_SECRET,
} = process.env;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  try {
    // Accept either:
    // - ?lab=<Webflow Item ID>   (preferred)
    // - (quick start) ?name=&meet=&url=&sessions=<base64url(JSON[{start,end}])>
    const { lab, t, name, meet, url, sessions } = req.query;

    if (ICS_REQUIRE_TOKEN === "true") {
      if (!t) return res.status(401).send("Missing token");
      if (!verifyToken(t)) return res.status(401).send("Invalid token");
    }

    let labData;

    if (lab) {
      labData = await fetchLabFromWebflow(lab);
    } else if (name && sessions) {
      // Quick-start (no Webflow fetch): build from query
      const sessionsArr = safeParseBase64urlJson(sessions);
      if (!Array.isArray(sessionsArr)) {
        return res.status(400).send("Invalid sessions payload");
      }
      labData = {
        name,
        googleMeetUrl: meet || "",
        labUrl: url || "",
        sessions: sessionsArr,
      };
    } else {
      return res
        .status(400)
        .send("Provide ?lab=<itemId> or quick-start params (?name&sessions=base64url)");
    }

    if (!labData || !Array.isArray(labData.sessions) || labData.sessions.length === 0) {
      return res.status(404).send("No sessions found for this lab");
    }

    const ics = buildICS(labData);

    const fileName =
      "krav-" + (slugify(labData.name || "flight-lab")) + ".ics";

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    // Important: ICS prefers CRLF line endings
    return res.status(200).send(ics);
  } catch (err) {
    console.error("ICS error:", err);
    return res.status(500).send("Internal Server Error");
  }
};

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
  // but it’s safer to fold long DESCRIPTION/URL lines.
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

      const summary = `SUMMARY:${foldLine(escICS(`${name} with Coach`))}`; // You can swap in coach name if you store it
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
        // Optional: built-in reminders
        // "BEGIN:VALARM",
        // "TRIGGER:-PT24H",
        // "ACTION:DISPLAY",
        // "DESCRIPTION:Upcoming Krāv Flight Lab",
        // "END:VALARM",
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
    if (!ICS_HMAC_SECRET) return false;
    const [payloadB64u, sigB64u] = token.split(".");
    if (!payloadB64u || !sigB64u) return false;
    const expected = crypto
      .createHmac("sha256", ICS_HMAC_SECRET)
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
  // Adjust field keys to your CMS schema
  const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items/${itemId}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Webflow fetch failed: ${r.status} ${t}`);
  }
  const data = await r.json();

  // v2 response typically: { item: { fieldData: {...} } }
  const item = data.item || data; // fallback if shape differs
  const f = item.fieldData || item; // fallback

  // Map your field API names here:
  // e.g., f["name"], f["google-meet-url"], f["sessions-json"], f["lab-url"]
  const sessionsRaw = f["sessions-json"];
  let sessions = sessionsRaw;
  if (typeof sessionsRaw === "string") {
    try {
      sessions = JSON.parse(sessionsRaw);
    } catch {
      sessions = [];
    }
  }

  return {
    name: f["name"] || "Flight Lab",
    googleMeetUrl: f["google-meet-url"] || "",
    labUrl: f["lab-url"] || "",
    sessions: Array.isArray(sessions) ? sessions : [],
  };
}
