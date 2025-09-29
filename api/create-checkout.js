// /api/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

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
// Append one query param (works with relative or absolute URLs)
function appendQueryParam(u, key, value) {
  if (!u || value == null) return u;
  const strVal = String(value);
  const hashIndex = u.indexOf('#');
  const hasHash = hashIndex >= 0;
  const base = hasHash ? u.slice(0, hashIndex) : u;
  const hash = hasHash ? u.slice(hashIndex) : '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(strVal)}${hash}`;
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
  const f = item?.item?.fieldData || item?.fieldData || {};
  return {
    id: item?.item?.id || item?.id,
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

// Fallback: paginate & find by slug
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
  const f = coachItem?.item?.fieldData || coachItem?.fieldData || {};
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
// DEFAULT: 18% unless PLATFORM_FEE_PCT or PLATFORM_FEE_CENTS override
function calcPlatformFeeCents(amountCents) {
  const fixed = process.env.PLATFORM_FEE_CENTS ? Number(process.env.PLATFORM_FEE_CENTS) : null;
  if (fixed != null && Number.isFinite(fixed)) return Math.max(0, Math.round(fixed));
  const pct = Number(process.env.PLATFORM_FEE_PCT || '0.18');
  if (!amountCents || Number.isNaN(amountCents)) return 0;
  return Math.max(0, Math.round(amountCents * pct));
}

// Resolve unit amount (cents) whether lab gives a numeric price or a priceId
async function resolveUnitPriceCents(lab) {
  if (typeof lab.priceCents === 'number' && lab.priceCents > 0) return lab.priceCents;
  if (lab.priceId) {
    const price = await stripe.prices.retrieve(lab.priceId);
    const cents = price?.unit_amount ?? null;
    if (typeof cents === 'number' && cents > 0) return cents;
  }
  return null;
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

    // Debug (incoming)
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

    // Seats guard (basic max check as stored in CMS)
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

    // Line item (priceId OR one-off price_data)
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

    // Compute platform fee from the actual unit amount (works for priceId or numeric)
    const unitAmountCents = await resolveUnitPriceCents(lab);
    if (!unitAmountCents) {
      setCors(req, res);
      return res.status(400).json({ error: 'Unable to resolve price for fee calculation' });
    }
    const platformFeeCents = calcPlatformFeeCents(unitAmountCents);

    /* =========================
       Normalize success/cancel URLs
       ========================= */
    const rawSuccess =
      process.env.CHECKOUT_SUCCESS_URL
      || lab.successUrl
      || '/flight-lab-success';

    const rawCancel =
      process.env.CHECKOUT_CANCEL_URL
      || lab.cancelUrl
      || '/flight-lab-cancelled';

    // Add lab id param then ensure session token
    const rawSuccessWithLab = appendQueryParam(rawSuccess, 'lab', lab.id);
    const successUrlWithToken = ensureSessionToken(rawSuccessWithLab);
    const successUrl = absoluteUrl(successUrlWithToken);
    const cancelUrl  = absoluteUrl(rawCancel);

    // Log URL stages
    console.log(JSON.stringify({
      tag: 'create-checkout:urls',
      rawSuccess,
      rawSuccessWithLab,
      successUrlWithToken,
      resolvedSuccess: successUrl,
      resolvedCancel: cancelUrl,
      publicSiteUrl: process.env.PUBLIC_SITE_URL || null
    }, null, 2));

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

    // Create Checkout Session (destination charge)
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
        application_fee_amount: platformFeeCents,
        // (optional best practice)
        // on_behalf_of: coachConnectId,
      },
      // Helpful for webhooks & automations
      client_reference_id: `lab_${lab.id}`,
      metadata: {
        kind: 'flight_lab',
        flight_lab_id: lab.id,
        coach_connect_id: coachConnectId,
        lab_title: lab.title,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    // Log created session
    console.log(JSON.stringify({
      tag: 'create-checkout:session-created',
      session_id: session.id,
      success_url_sent: successUrl,
      session_url: session.url,
      fee_cents: platformFeeCents
    }, null, 2));

    setCors(req, res);
    const body = { url: session.url };
    if ((process.env.DEBUG_SUCCESS_URLS || '').toLowerCase() === 'true') {
      body.debug = { successUrl };
    }
    return res.status(200).json(body);
  } catch (err) {
    console.error('create-checkout error:', err);
    setCors(req, res);
    if (process.env.DEBUG_STRIPE_ERRORS === 'true' && err && err.message) {
      return res.status(500).json({ error: err.message, code: err.code || null });
    }
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
