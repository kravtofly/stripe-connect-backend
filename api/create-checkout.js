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
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (ORIGINS.length) {
    res.setHeader('Access-Control-Allow-Origin', ORIGINS[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* =========================
   URL helpers
   ========================= */
function isAbsoluteUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}
function absoluteUrl(u) {
  if (!u) return null;
  if (isAbsoluteUrl(u)) return u;
  const base = (process.env.PUBLIC_SITE_URL || '').trim();
  if (!isAbsoluteUrl(base)) return null; // cannot normalize without a base
  const baseNoSlash = base.replace(/\/+$/, '');
  const path = u.startsWith('/') ? u : `/${u}`;
  return `${baseNoSlash}${path}`;
}
// Ensure success URL includes the Stripe token
function ensureSessionToken(u) {
  if (!u) return u;
  if (u.includes('{CHECKOUT_SESSION_ID}')) return u;
  return `${u}${u.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
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

// Fallback: paginate & find by slug (if your collection returns slugs)
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
  const f = coachItem?.fieldData || {};
  const candidates = [
    f['coach-stripe-account-id'],
    f['stripe-account-id'],
    f['coach_stripe_account_id'],
    f['stripe_account_id'],
  ];
  const acct = candidates.find(v => typeof v === 'string' && v.startsWith('acct_')) || null;
  return acct;
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

    // Debug
    console.log(JSON.stringify({
      tag: 'create-checkout:incoming',
      mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST',
      labId: labId || null,
      labSlug: labSlug || null,
      WEBFLOW_COLLECTION_ID: process.env.WEBFLOW_COLLECTION_ID || null,
      WEBFLOW_CMS_LOCALE_ID: process.env.WEBFLOW_CMS_LOCALE_ID || null,
      origin: req.headers.origin || null,
    }, null, 2));

    if (!labId && !labSlug) {
      setCors(req, res);
      return res.status(400).json({ error: 'Missing labId or labSlug' });
    }

    // Resolve Lab
    let lab = null;
    try {
      lab = labId ? await getLabById(labId) : await getLabBySlug(labSlug);
    } catch (e) {
      if (String(e.message).includes('resource_not_found')) {
        setCors(req, res);
        return res.status(404).json({ error: 'Flight Lab not found' });
      }
      throw e;
    }
    if (!lab) {
      setCors(req, res);
      return res.status(404).json({ error: 'Flight Lab not found' });
    }

    // Seats guard
    if (typeof lab.seatsRemaining === 'number' && lab.seatsRemaining <= 0) {
      setCors(req, res);
      return res.status(409).json({ error: 'Sold out' });
    }

    // Coach Connect ID
    const coachConnectId = await getCoachConnectId(lab.coachRefId);
    if (!coachConnectId) {
      setCors(req, res);
      return res.status(400).json({
        error:
          'Stripe Connect ID not found on Coach item (try field slugs "coach-stripe-account-id" or "stripe-account-id").',
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

    /* =========================
       Normalize success/cancel URLs
       - accept env or CMS values (absolute or relative)
       - ensure success contains {CHECKOUT_SESSION_ID}
       ========================= */
    const rawSuccess =
      process.env.CHECKOUT_SUCCESS_URL   // may include token; may be absolute or relative
      || lab.successUrl                  // may include token; may be absolute or relative
      || '/flight-lab-success';          // default path (token appended below)

    const rawCancel =
      process.env.CHECKOUT_CANCEL_URL
      || lab.cancelUrl
      || '/flight-lab-cancelled';

    const successUrlWithToken = ensureSessionToken(rawSuccess);
    const successUrl = absoluteUrl(successUrlWithToken);
    const cancelUrl  = absoluteUrl(rawCancel);

    if (!successUrl || !cancelUrl) {
      console.error('URL normalization failed', {
        PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
        rawSuccess, rawCancel, successUrl, cancelUrl
      });
      setCors(req, res);
      return res.status(500).json({
        error:
          'Invalid success/cancel URL. Ensure PUBLIC_SITE_URL is set to an https URL and that any CMS URLs are absolute or relative paths.',
      });
    }

    // Create Checkout Session
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
        application_fee_amount: calcPlatformFeeCents(lab.priceCents),
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
    if (process.env.DEBUG_STRIPE_ERRORS === 'true' && err && err.message) {
      return res.status(500).json({ error: err.message, code: err.code || null });
    }
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
