// /api/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* =========================
   CORS (allow-list)
   ========================= */
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // reflect allowed origin
  } else if (ORIGINS.length) {
    res.setHeader('Access-Control-Allow-Origin', ORIGINS[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* =========================
   Webflow helpers
   ========================= */
async function wfFetch(url) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WEBFLOW_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Webflow ${url} -> ${r.status}: ${t}`);
  }
  return r.json();
}

function mapItemToLab(item) {
  const f = item?.fieldData || {};
  return {
    id: item?.id,
    title: f['name'] || 'Krāv Flight Lab',
    priceId: f['price_id'] || null,
    priceCents:
      typeof f['total-price-per-student-per-flight-lab'] === 'number'
        ? Math.round(f['total-price-per-student-per-flight-lab'] * 100)
        : null,
    // You use this as REMAINING seats (Make decrements it)
    seatsRemaining:
      typeof
