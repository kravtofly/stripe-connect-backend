// /api/debug-coach.js
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else if (ORIGINS.length) res.setHeader('Access-Control-Allow-Origin', ORIGINS[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function wfFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WEBFLOW_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Webflow ${url} -> ${r.status}: ${txt}`);
  return JSON.parse(txt);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
  if (req.method !== 'GET')     { setCors(req, res); return res.status(405).json({ error: 'GET only' }); }

  try {
    setCors(req, res);

    const coachCollectionId = process.env.COACH_COLLECTION_ID;
    const labCollectionId   = process.env.WEBFLOW_COLLECTION_ID;
    if (!coachCollectionId) return res.status(400).json({ error: 'Missing COACH_COLLECTION_ID' });

    const { id, coachId, labId } = req.query;
    let resolvedCoachId = id || coachId || null;

    if (!resolvedCoachId && labId) {
      const lab = await wfFetch(`https://api.webflow.com/v2/collections/${labCollectionId}/items/${labId}`);
      const f = lab?.fieldData || {};
      resolvedCoachId = f['coach'] || null;
      if (!resolvedCoachId) {
        return res.status(404).json({ error: 'Lab found, but no coach reference on this lab', labId, labFieldKeys: Object.keys(f) });
      }
    }

    if (!resolvedCoachId) {
      return res.status(400).json({ error: 'Pass ?id=<coachItemId> or ?labId=<flightLabItemId>' });
    }

    const coach = await wfFetch(`https://api.webflow.com/v2/collections/${coachCollectionId}/items/${resolvedCoachId}`);
    const f = coach?.fieldData || {};

    const candidates = {
      'coach-stripe-account-id': f['coach-stripe-account-id'],
      'stripe-account-id':       f['stripe-account-id'],
      'coach_stripe_account_id': f['coach_stripe_account_id'],
      'stripe_account_id':       f['stripe_account_id'],
    };
    const found = Object.values(candidates).find(v => typeof v === 'string' && v.startsWith('acct_')) || null;

    return res.status(200).json({
      coachItemId: coach.id,
      candidates,
      found,
      fieldKeys: Object.keys(f),
      name: f['name'] || null,
      email: f['email-field'] || null,
    });
  } catch (e) {
    setCors(req, res);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
