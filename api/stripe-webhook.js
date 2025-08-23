// /api/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Read the raw body (required for Stripe signature verification)
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature header');

  let event;
  let rawBody;
  try {
    rawBody = await getRawBody(req);                    // <— RAW body as Buffer
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET                 // <— set in Vercel later
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // We only need this one right now
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Fetch expanded session for line items/details (lives on PLATFORM in dest-charges)
    let full;
    try {
      full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
    } catch (e) {
      console.error('Failed to retrieve session with expand:', e);
      full = session; // fallback
    }

    // Prepare a minimal, normalized payload for Make
    const payload = {
      event_id: event.id,
      event_type: event.type,
      created: event.created,
      session: {
        id: full.id,
        customer_details: full.customer_details || null,
        customer_email: full.customer_details?.email || full.customer_email || null,
        amount_total: full.amount_total,
        currency: full.currency,
        metadata: full.metadata || {},
        line_items: (full.line_items?.data || []).map(li => ({
          description: li.description,
          quantity: li.quantity,
          amount_total: li.amount_total,
          amount_subtotal: li.amount_subtotal,
          price: li.price ? {
            id: li.price.id,
            unit_amount: li.price.unit_amount,
            currency: li.price.currency
          } : null
        }))
      }
    };

    // Forward to Make (optional shared secret header)
    try {
      const resp = await fetch(process.env.MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Secret': process.env.MAKE_FORWARDING_SECRET || ''  // optional check in Make
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error('Forward to Make failed:', resp.status, text);
        // 202 = we received it but couldn’t forward; Stripe will retry
        return res.status(202).json({ received: true, forwarded: false });
      }
    } catch (err) {
      console.error('Error forwarding to Make:', err);
      return res.status(202).json({ received: true, forwarded: false });
    }
  }

  // Always return 200 quickly so Stripe doesn’t keep retrying (unless signature failed)
  return res.status(200).json({ received: true });
};
