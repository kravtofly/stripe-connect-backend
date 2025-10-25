// /api/stripe-webhook.js
const { getStripeClient } = require('./lib/stripe');
const { createLogger } = require('./lib/logger');
const { HTTP_STATUS, STRIPE_EVENTS, CHECKOUT_FIELDS } = require('./lib/constants');
const { requireEnv } = require('./lib/validation');

const stripe = getStripeClient();
const logger = createLogger('stripe-webhook');

// Read the raw body (required for Stripe signature verification)
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * POST /api/stripe-webhook
 *
 * Receives and processes Stripe webhook events. Currently handles:
 * - checkout.session.completed: Forwards to Make.com for automation
 *
 * IMPORTANT: Returns 500 on Make.com forward failure to trigger Stripe retry.
 * This ensures events aren't lost if the automation service is down.
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).send('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    logger.warn('Missing Stripe signature header');
    return res.status(HTTP_STATUS.BAD_REQUEST).send('Missing stripe-signature header');
  }

  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    logger.error('Webhook signature verification failed', err);
    return res.status(HTTP_STATUS.BAD_REQUEST).send(`Webhook Error: ${err.message}`);
  }

  logger.info('Webhook event received', {
    event_id: event.id,
    event_type: event.type
  });

  if (event.type === STRIPE_EVENTS.CHECKOUT_SESSION_COMPLETED) {
    const session = event.data.object;

    // Try to expand line items (optional)
    let full = session;
    try {
      full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
      });
    } catch (e) {
      logger.warn('Failed to retrieve session with expand', {
        session_id: session.id,
        error: e.message
      });
    }

    // Build a clean payload for Make.com
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
        line_items: (full.line_items?.data || []).map((li) => ({
          description: li.description,
          quantity: li.quantity,
          amount_total: li.amount_total,
          amount_subtotal: li.amount_subtotal,
          price: li.price
            ? {
                id: li.price.id,
                unit_amount: li.price.unit_amount,
                currency: li.price.currency,
              }
            : null,
        })),
      },
    };

    logger.info('Forwarding event to Make.com', {
      event_id: event.id,
      session_id: full.id
    });

    // Forward to Make.com
    // CRITICAL FIX: Return 500 on failure (not 202) to trigger Stripe retry
    try {
      const makeWebhookUrl = requireEnv('MAKE_WEBHOOK_URL');
      const makeSecret = process.env.MAKE_FORWARDING_SECRET || '';

      const resp = await fetch(makeWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Secret': makeSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text();
        logger.error('Make.com forward failed', {
          event_id: event.id,
          session_id: full.id,
          status: resp.status,
          response: text
        });

        // Return 500 to trigger Stripe retry
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          received: true,
          forwarded: false,
          error: 'Failed to forward to automation service'
        });
      }

      logger.info('Event forwarded successfully', {
        event_id: event.id,
        session_id: full.id
      });
    } catch (err) {
      logger.error('Error forwarding to Make.com', err, {
        event_id: event.id,
        session_id: full.id
      });

      // Return 500 to trigger Stripe retry
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        received: true,
        forwarded: false,
        error: 'Failed to forward to automation service'
      });
    }
  }

  // Success - Stripe won't retry
  return res.status(HTTP_STATUS.OK).json({ received: true });
}

module.exports = handler;

// Vercel Serverless Functions config (disables body parsing)
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
