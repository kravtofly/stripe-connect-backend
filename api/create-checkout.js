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
      typeof f['maximum-number-of-participants'] === 'number'
        ? f['maximum-number-of-participants']
        : null,
    coachRefId: f['coach'] || null,
    successUrl: f['success_url'] || null,
    cancelUrl: f['cancel_url'] || null,
  };
}

async function getLabById(labId) {
  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  if (!collectionId) throw new Error('Missing WEBFLOW_COLLECTION_ID');
  const item = await wfFetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${labId}`);
  return mapItemToLab(item);
}

// Paginate & find by slug (optionally filtered to a locale)
async function getLabBySlug(slug) {
  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  if (!collectionId) throw new Error('Missing WEBFLOW_COLLECTION_ID');
  const localeParam = process.env.WEBFLOW_CMS_LOCALE_ID
    ? `&cmsLocaleId=${encodeURIComponent(process.env.WEBFLOW_CMS_LOCALE_ID)}`
    : '';

  let offset = 0;
  const limit = 100;
  while (offset < 2000) {
    const url = `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}&offset=${offset}${localeParam}`;
    const data = await wfFetch(url);
    const items = data.items || [];
    const found = items.find((it) => it?.slug === slug);
    if (found) return mapItemToLab(found);
    if (items.length < limit) break;
    offset += limit;
  }
  return null;
}

/* =========================
   Coach (Connect) helper
   ========================= */
async function getCoachConnectId(coachItemId) {
  if (!coachItemId) return null;
  const coachCollectionId = process.env.COACH_COLLECTION_ID;
  if (!coachCollectionId) throw new Error('Missing COACH_COLLECTION_ID');

  const coachItem = await wfFetch(
    `https://api.webflow.com/v2/collections/${coachCollectionId}/items/${coachItemId}`
  );
  const cf = coachItem?.fieldData || {};
  const acct = cf['stripe-account-id'];
  if (typeof acct === 'string' && acct.startsWith('acct_')) return acct;
  return null;
}

/* =========================
   Fees
   ========================= */
function calcPlatformFeeCents(priceCents) {
  const fixed = process.env.PLATFORM_FEE_CENTS ? Number(process.env.PLATFORM_FEE_CENTS) : null;
  if (fixed != null && Number.isFinite(fixed)) return Math.max(0, Math.round(fixed));
  const pct = Number(process.env.PLATFORM_FEE_PCT || '0.20');
  if (!priceCents || Number.isNaN(priceCents)) return 0;
  return Math.max(0, Math.round(priceCents * pct));
}

/* =========================
   Handler
   ========================= */
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(req, res);
    return res.status(204).end();
  }

  try {
    if (req.method !== 'POST') {
      setCors(req, res);
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).send('Method Not Allowed');
    }
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      setCors(req, res);
      return res.status(415).json({ error: 'Use application/json' });
    }

    const { labId, labSlug, studentName, studentEmail } = req.body || {};

    // Debug line (check in Vercel logs)
    console.log(
      JSON.stringify(
        {
          tag: 'create-checkout:incoming',
          mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST',
          labId: labId || null,
          labSlug: labSlug || null,
          WEBFLOW_COLLECTION_ID: process.env.WEBFLOW_COLLECTION_ID || null,
          WEBFLOW_CMS_LOCALE_ID: process.env.WEBFLOW_CMS_LOCALE_ID || null,
          origin: req.headers.origin || null,
        },
        null,
        2
      )
    );

    if (!labId && !labSlug) {
      setCors(req, res);
      return res.status(400).json({ error: 'Missing labId or labSlug' });
    }

    // Resolve lab by id or slug
    const lab = labId ? await getLabById(labId) : await getLabBySlug(labSlug);
    if (!lab) {
      console.error('Lab not found', { labId, labSlug });
      setCors(req, res);
      return res.status(404).json({ error: 'Flight Lab not found' });
    }

    // Sold out guard
    if (typeof lab.seatsRemaining === 'number' && lab.seatsRemaining <= 0) {
      setCors(req, res);
      return res.status(409).json({ error: 'Sold out' });
    }

    // Coach Connect account
    const coachConnectId = await getCoachConnectId(lab.coachRefId);
    if (!coachConnectId) {
      setCors(req, res);
      return res.status(400).json({
        error: 'Stripe Connect ID not found on Coach item (field "stripe-account-id").',
      });
    }

    // Line item
    let lineItem;
    if (lab.priceId) {
      lineItem = { price: lab.priceId, quantity: 1 };
    } else if (lab.priceCents) {
      lineItem = {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: lab.priceCents,
          product_data: { name: lab.title },
        },
      };
    } else {
      setCors(req, res);
      return res.status(400).json({
        error:
          'No price configured for this lab (add "price_id" or set "total-price-per-student-per-flight-lab").',
      });
    }

    const feeCents = calcPlatformFeeCents(lab.priceCents);

    const successUrl =
      process.env.CHECKOUT_SUCCESS_URL ||
      lab.successUrl ||
      `${process.env.PUBLIC_SITE_URL}/flight-lab/${lab.id}?status=success`;

    const cancelUrl =
      process.env.CHECKOUT_CANCEL_URL ||
      lab.cancelUrl ||
      `${process.env.PUBLIC_SITE_URL}/flight-lab/${lab.id}?status=cancelled`;

    // Create a fresh Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [lineItem],
      customer_email: studentEmail || undefined,
      custom_fields: [
        {
          key: 'student_name',
          label: { type: 'custom', custom: 'Student name' },
          type: 'text',
          optional: !studentName,
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: coachConnectId },
        application_fee_amount: feeCents,
      },
      metadata: {
        flight_lab_id: lab.id,
        coach_connect_id: coachConnectId,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    setCors(req, res);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    setCors(req, res);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
