// /api/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Fetch the lab item from Webflow (or your DB) by lab_id.
 * You can swap this out if you already have these values elsewhere.
 */
async function getLabById(labId) {
  // OPTION A: If your Webflow CMS stores these fields, fetch them via Webflow API.
  // Pseudocode (uncomment/implement if you use Webflow API):
  //
  // const res = await fetch(`https://api.webflow.com/v2/collections/${process.env.WEBFLOW_COLLECTION_ID}/items/${labId}`, {
  //   headers: { Authorization: `Bearer ${process.env.WEBFLOW_TOKEN}` }
  // });
  // const item = await res.json();
  // return {
  //   title: item.fieldData.title,
  //   priceCents: item.fieldData.price_cents, // integer
  //   coachAccountId: item.fieldData.coach_stripe_account_id,
  //   cmsId: item.id
  // };

  // OPTION B: If Make wrote these values into the CMS Item, read them from query params
  // (less secure, but quick). For production, prefer Option A.
  throw new Error('getLabById not implemented. Populate from Webflow or pass via query/body.');
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).send('Method Not Allowed');
    }

    // Accept lab_id via query or JSON body
    const labId = req.method === 'GET' ? req.query.lab_id : req.body?.lab_id;
    if (!labId) return res.status(400).json({ error: 'Missing lab_id' });

    // TODO: implement getLabById. For now, read critical values from query as a quick test:
    // e.g. /api/create-checkout?lab_id=xxx&title=Flight%20Lab&price_cents=15000&coach_acct=acct_123
    const title       = req.query.title || 'Krāv Flight Lab';
    const priceCents  = Number(req.query.price_cents || 0);
    const coachAcctId = req.query.coach_acct;

    if (!coachAcctId || !priceCents) {
      return res.status(400).json({ error: 'Missing coach_acct or price_cents' });
    }

    const feeCents = Math.round(priceCents * (Number(process.env.PLATFORM_FEE_PCT || '0.20'))); // 20% default

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: 'https://www.kravtofly.com/flight-lab-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.kravtofly.com/flight-lab-cancelled',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: priceCents,
          product_data: { name: title }
        },
        quantity: 1
      }],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: coachAcctId }
      },
      metadata: {
        cms_id: labId,
        coach_id: req.query.coach_id || ''
      }
    });

    // Redirect the browser to the new Checkout Session
    res.statusCode = 303;  // SEE OTHER
    res.setHeader('Location', session.url);
    return res.end();
  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
