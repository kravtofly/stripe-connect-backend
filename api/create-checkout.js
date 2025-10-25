// /api/create-checkout.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError, NotFoundError, ConflictError } = require('./lib/errors');
const {
  HTTP_STATUS,
  CURRENCY,
  STRIPE_CHECKOUT_MODE,
  METADATA_KEYS,
  CHECKOUT_FIELDS,
  DEFAULTS
} = require('./lib/constants');
const { requireEnv, getEnv, isValidEmail } = require('./lib/validation');
const { getLabById, getLabBySlug, getCoachStripeAccountId } = require('./lib/webflow');

const stripe = getStripeClient();
const logger = createLogger('create-checkout');

/* =========================
   URL helpers
   ========================= */
function isAbsoluteUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function absoluteUrl(u) {
  if (!u) return null;
  if (isAbsoluteUrl(u)) return u;
  const base = getEnv('PUBLIC_SITE_URL', '').trim();
  if (!isAbsoluteUrl(base)) return null;
  const baseNoSlash = base.replace(/\/+$/, '');
  const path = u.startsWith('/') ? u : `/${u}`;
  return `${baseNoSlash}${path}`;
}

function ensureSessionToken(u) {
  if (!u) return u;
  if (u.includes('{CHECKOUT_SESSION_ID}')) return u;
  return `${u}${u.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
}

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
   Fee calculation
   ========================= */
function calcPlatformFeeCents(amountCents) {
  const fixed = process.env.PLATFORM_FEE_CENTS ? Number(process.env.PLATFORM_FEE_CENTS) : null;
  if (fixed != null && Number.isFinite(fixed)) return Math.max(0, Math.round(fixed));
  const pct = Number(getEnv('PLATFORM_FEE_PCT', String(DEFAULTS.PLATFORM_FEE_PCT)));
  if (!amountCents || Number.isNaN(amountCents)) return 0;
  return Math.max(0, Math.round(amountCents * pct));
}

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
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      error: 'Method not allowed'
    });
  }

  if (!(req.headers['content-type'] || '').includes('application/json')) {
    return res.status(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE).json({
      error: 'Use application/json'
    });
  }

  const { labId, labSlug, studentName, studentEmail } = req.body || {};

  // Log incoming request
  logger.info('Create checkout request', {
    mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST',
    labId: labId || null,
    labSlug: labSlug || null,
    origin: req.headers.origin || null
  });

  if (!labId && !labSlug) {
    throw new ValidationError('Missing labId or labSlug');
  }

  // Validate student email if provided
  if (studentEmail && !isValidEmail(studentEmail)) {
    throw new ValidationError('Invalid email address format');
  }

  // Resolve Lab
  let lab = null;
  try {
    lab = labId ? await getLabById(labId) : await getLabBySlug(labSlug);
  } catch (e) {
    if (String(e.message).includes('resource_not_found') || e.status === 404) {
      throw new NotFoundError('Flight Lab');
    }
    throw e;
  }

  if (!lab) {
    throw new NotFoundError('Flight Lab');
  }

  // WARNING: Race condition check
  // This seat check has a race condition - multiple requests could pass this check
  // simultaneously before the seat count is decremented in the CMS. For production,
  // consider implementing:
  // 1. Optimistic locking with version numbers in Webflow
  // 2. A queue system to serialize checkout requests per lab
  // 3. Stripe Checkout inventory management features
  if (typeof lab.seatsRemaining === 'number' && lab.seatsRemaining <= 0) {
    throw new ConflictError('Flight Lab is sold out');
  }

  // Get coach's Stripe Connect account ID
  const coachConnectId = await getCoachStripeAccountId(lab.coachRefId);
  if (!coachConnectId) {
    logger.error('Coach Stripe account not found', {
      labId: lab.id,
      coachRefId: lab.coachRefId
    });
    throw new ValidationError(
      'Stripe Connect ID not found on Coach item (try field slugs "coach-stripe-account-id" or "stripe-account-id").'
    );
  }

  // Build line item (priceId OR one-off price_data)
  let lineItem;
  if (lab.priceId) {
    lineItem = { price: lab.priceId, quantity: 1 };
  } else if (lab.priceCents) {
    lineItem = {
      quantity: 1,
      price_data: {
        currency: CURRENCY.USD,
        unit_amount: lab.priceCents,
        product_data: { name: lab.title },
      },
    };
  } else {
    throw new ValidationError(
      'No price configured for this lab (add "price_id" or set "total-price-per-student-per-flight-lab").'
    );
  }

  // Compute platform fee from the actual unit amount
  const unitAmountCents = await resolveUnitPriceCents(lab);
  if (!unitAmountCents) {
    throw new ValidationError('Unable to resolve price for fee calculation');
  }
  const platformFeeCents = calcPlatformFeeCents(unitAmountCents);

  /* =========================
     Normalize success/cancel URLs
     ========================= */
  const rawSuccess =
    getEnv('CHECKOUT_SUCCESS_URL', null)
    || lab.successUrl
    || DEFAULTS.SUCCESS_URL;

  const rawCancel =
    getEnv('CHECKOUT_CANCEL_URL', null)
    || lab.cancelUrl
    || DEFAULTS.CANCEL_URL;

  // Add lab id param then ensure session token
  const rawSuccessWithLab = appendQueryParam(rawSuccess, 'lab', lab.id);
  const successUrlWithToken = ensureSessionToken(rawSuccessWithLab);
  const successUrl = absoluteUrl(successUrlWithToken);
  const cancelUrl = absoluteUrl(rawCancel);

  logger.debug('URL resolution', {
    rawSuccess,
    rawSuccessWithLab,
    successUrlWithToken,
    resolvedSuccess: successUrl,
    resolvedCancel: cancelUrl,
    publicSiteUrl: process.env.PUBLIC_SITE_URL || null
  });

  if (!successUrl || !cancelUrl) {
    logger.error('URL normalization failed', {
      PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
      rawSuccess,
      rawCancel,
      successUrl,
      cancelUrl
    });
    throw new ValidationError(
      'Invalid success/cancel URL. Ensure PUBLIC_SITE_URL is set to an https URL and that any CMS URLs are absolute or relative paths.'
    );
  }

  // Create Checkout Session (destination charge)
  const session = await stripe.checkout.sessions.create({
    mode: STRIPE_CHECKOUT_MODE.PAYMENT,
    line_items: [lineItem],
    customer_email: studentEmail || undefined,
    custom_fields: [
      {
        key: CHECKOUT_FIELDS.STUDENT_NAME,
        label: { type: 'custom', custom: 'Student name' },
        type: 'text',
        optional: !studentName,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination: coachConnectId },
      application_fee_amount: platformFeeCents,
    },
    client_reference_id: `lab_${lab.id}`,
    metadata: {
      kind: 'flight_lab',
      [METADATA_KEYS.FLIGHT_LAB_ID]: lab.id,
      [METADATA_KEYS.COACH_CONNECT_ID]: coachConnectId,
      [METADATA_KEYS.LAB_TITLE]: lab.title,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
  });

  logger.info('Checkout session created', {
    session_id: session.id,
    lab_id: lab.id,
    coach_connect_id: coachConnectId,
    fee_cents: platformFeeCents,
    success_url: successUrl,
    session_url: session.url
  });

  const body = { url: session.url };
  if (getEnv('DEBUG_SUCCESS_URLS', '').toLowerCase() === 'true') {
    body.debug = { successUrl };
  }

  return res.status(HTTP_STATUS.OK).json(body);
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['POST', 'OPTIONS']
}));
