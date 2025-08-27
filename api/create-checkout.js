// /api/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Webflow helper (throws with useful detail) ---
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

// Map your Flight Lab item (tailored to your keys)
async function getLabById(labId) {
  const labsCollectionId = process.env.WEBFLOW_COLLECTION_ID;
  if (!labsCollectionId) throw new Error('Missing WEBFLOW_COLLECTION_ID');

  const item = await wfFetch(
    `https://api.webflow.com/v2/collections/${labsCollectionId}/items/${labId}`
  );
  const f = item?.fieldData || {};

  // Title
  const title = f['name'] || 'Krāv Flight Lab';

  // Preferred: Stripe Price stored on the lab (optional)
  const priceId = f['price_id'] || null;

  // Fallback: convert your dollars field to cents
  let priceCents = null;
  if (!priceId) {
    const dollars = f['total-price-per-student-per-flight-lab'];
    if (typeof dollars === 'number' && Number.isFinite(dollars)) {
      priceCents = Math.round(dollars * 100);
    }
  }

  // You’re using this as REMAINING seats (Make decrements it after purchase)
  const seatsRemaining =
    typeof f['maximum-number-of-participants'] === 'number'
      ? f['maximum-number-of-participants']
      : null;

  // Coach relation (we’ll dereference to get acct_…)
  const coachRefId = f['coach'] || null;

  // Optional per-lab redirects (fallbacks provided later)
  const successUrl = f['success_url'] || null;
  const cancelUrl = f['cancel_url'] || null;

  return {
    id: item?.id,
    title,
    priceId,
    priceCents,
    seatsRemaining,
    coachRefId,
    successUrl,
    cancelUrl,
  };
}

// Read the coach item and pull their Connect account from 'coach-stripe-account-id'
async function getCoachConnectId(coachItemId) {
  if (!coachItemId) return null;
  const coachCollectionId = process.env.COACH_COLLECTION_ID;
  if (!coachCollectionId) throw new Error('Missing COACH_COLLECTION_ID');

  const coachItem = await wfFetch(
    `https://api.webflow.com/v2/collections/${coachCollectionId}/items/${coachItemId}`
  );
  const cf = coachItem?.fieldData || {};
  const acct = cf['coach-stripe-account-id'];
  if (typeof acct === 'string' && acct.startsWith('acct_')) return acct;
  return null;
}

// Fee helper
function calcPlatformFeeCents(priceCents) {
  const fixed = process.env.PLATFORM_FEE_CENTS ? Number(process.env.PLATFORM_FEE_CENTS) : null;
  if (fixed != null && Number.isFinite(fixed)) return Math.max(0, Math.round(fixed));
  const pct = Number(process.env.PLATFORM_FEE_PCT || '0.20');
  if (!priceCents || Number.isNaN(priceCents)) return 0;
  return Math.max(0, Math.round(priceCents * pct));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }
    if (!(req.headers['content-type'] || '').includes('application/json')) {
      return res.status(415).json({ error: 'Use application/json' });
    }

    const { labId, studentName, studentEmail } = req.body || {};
    if (!labId) return res.status(400).json({ error: 'Missing labId' });

    // 1) Load Lab from Webflow
    const lab = await getLabById(labId);

    // 2) Block creating a session when you have no seats left
    if (typeof lab.seatsRemaining === 'number' && lab.seatsRemaining <= 0) {
      return res.status(409).json({ error: 'Sold out' });
    }

    // 3) Load Coach Connect ID from Coach collection
    const coachConnectId = await getCoachConnectId(lab.coachRefId);
    if (!coachConnectId) {
      return res.status(400).json({
        error:
          'Coach Stripe Connect ID not found on Coach item (field "coach-stripe-account-id").',
      });
    }

    // 4) Build line item
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
      return res.status(400).json({
        error:
          'No price configured for this lab (add "price_id" or set "total-price-per-student-per-flight-lab").',
      });
    }

    const feeCents = calcPlatformFeeCents(lab.priceCents);

    // 5) Choose redirect URLs (env overrides > per-lab > defaults)
    const successUrl =
      process.env.CHECKOUT_SUCCESS_URL ||
      lab.successUrl ||
      `${process.env.PUBLIC_SITE_URL}/flight-lab/${lab.id}?status=success`;

    const cancelUrl =
      process.env.CHECKOUT_CANCEL_URL ||
      lab.cancelUrl ||
      `${process.env.PUBLIC_SITE_URL}/flight-lab/${lab.id}?status=cancelled`;

    // 6) Create a fresh Checkout Session (destination charge)
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

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
