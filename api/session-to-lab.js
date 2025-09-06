// /api/session-to-lab.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* CORS (reuse your helper pattern) */
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
function setCors(req, res) {
  const origin = req.headers.origin;
  const allow = (origin && ORIGINS.includes(origin)) ? origin : '*'; // allow GETs broadly
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
  if (req.method !== 'GET') {
    setCors(req, res); res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const sessionId = (req.query.session_id || '').trim();
    if (!sessionId) { setCors(req, res); return res.status(400).json({ error: 'Missing session_id' }); }

    const sess = await stripe.checkout.sessions.retrieve(sessionId);
    const md = sess?.metadata || {};
    const labId = md.flight_lab_id || md.lab_id || md.flightLabId || null;

    if (!labId) { setCors(req, res); return res.status(404).json({ error: 'labId not found on session' }); }

    setCors(req, res);
    return res.status(200).json({ labId });
  } catch (err) {
    console.error('session-to-lab error:', err);
    setCors(req, res);
    return res.status(500).json({ error: 'Lookup failed' });
  }
};
