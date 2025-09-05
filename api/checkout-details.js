// /api/checkout-details.js (CommonJS)
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (ORIGINS.length) {
    res.setHeader('Access-Control-Allow-Origin', ORIGINS[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function wfFetch(url) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WEBFLOW_TOKEN}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Webflow ${url} -> ${r.status}: ${t}`);
  }
  return r.json();
}

function labFromItem(item) {
  const f = item?.fieldData || {};
  return {
    id: item?.id || null,
    title: f['name'] || 'Krāv Flight Lab',
    coachRefId: f['coach'] || null,
    meetUrl: f['google-meet-url'] || null,
    sessionsJson: f['sessions-json'] || '[]',
    description: f['full-description'] || null,
    seatsRemaining: typeof f['maximum-number-of-participants'] === 'number'
      ? f['maximum-number-of-participants'] : null,
  };
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(req, res);
    return res.status(204).end();
  }

  try {
    if (req.method !== 'GET') {
      setCors(req, res);
      res.setHeader('Allow', 'GET, OPTIONS');
      return res.status(405).send('Method Not Allowed');
    }

    const sessionId = req.query.session_id;
    if (!sessionId) {
      setCors(req, res);
      return res.status(400).json({ error: 'Missing session_id' });
    }

    // Get Checkout Session (on platform account)
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'payment_intent']
    });

    // We saved the lab id in metadata when creating the session
    const labId = session?.metadata?.flight_lab_id;
    if (!labId) {
      setCors(req, res);
      return res.status(404).json({ error: 'No lab linked to this session' });
    }

    // Pull the Flight Lab CMS item
    const collectionId = process.env.WEBFLOW_COLLECTION_ID;
    const labItem = await wfFetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${labId}`);
    const lab = labFromItem(labItem);

    // Optionally fetch coach data (for name/email)
    let coach = null;
    if (lab.coachRefId && process.env.COACH_COLLECTION_ID) {
      try {
        const coachItem = await wfFetch(
          `https://api.webflow.com/v2/collections/${process.env.COACH_COLLECTION_ID}/items/${lab.coachRefId}`
        );
        const cf = coachItem?.fieldData || {};
        coach = {
          name: cf['name'] || null,
          email: cf['email-field'] || null,
          instagram: cf['instagram-profile'] || null,
          facebook: cf['facebook-profile'] || null,
          profilePic: cf['profile-pic']?.url || null
        };
      } catch (_) {}
    }

    // Normalize sessions
    let sessions = [];
    try {
      sessions = JSON.parse(lab.sessionsJson) || [];
    } catch (_) {
      sessions = [];
    }

    const out = {
      session: {
        id: session.id,
        amount_total: session.amount_total,
        currency: session.currency,
        customer_email: session.customer_details?.email || session.customer_email || null,
        customer_name: session.custom_fields?.find?.(f => f.key === 'student_name')?.text?.value || null
      },
      lab: {
        id: lab.id,
        title: lab.title,
        description: lab.description,
        meetUrl: lab.meetUrl,
        sessions,
        seatsRemaining: lab.seatsRemaining
      },
      coach
    };

    setCors(req, res);
    return res.status(200).json(out);
  } catch (err) {
    console.error('checkout-details error:', err);
    setCors(req, res);
    return res.status(500).json({ error: 'Failed to load checkout details' });
  }
};
