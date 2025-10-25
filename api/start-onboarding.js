// /api/start-onboarding.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const {
  isValidEmail,
  isValidCountryCode,
  validateName,
  validateRequiredFields,
  sanitizeString
} = require('./lib/validation');
const { withErrorHandling, ValidationError } = require('./lib/errors');
const { withRateLimit } = require('./lib/rateLimit');
const {
  STRIPE_ACCOUNT_TYPE,
  STRIPE_CAPABILITIES,
  STRIPE_ACCOUNT_LINK_TYPE,
  STRIPE_BUSINESS_TYPE,
  DEFAULTS,
  HTTP_STATUS
} = require('./lib/constants');
const { getConfig } = require('./lib/config');

const logger = createLogger('start-onboarding');
const stripe = getStripeClient();

/**
 * POST /api/start-onboarding
 *
 * Creates a new Stripe Express connected account for a coach and
 * returns a one-time onboarding link. The caller must provide the coach's
 * Memberstack ID (coachId) along with their email, first name, last name
 * and country. Country defaults to 'US' if not provided.
 *
 * The resulting account ID is returned in the response along with the
 * onboarding URL. A subsequent call to /api/complete-onboarding should be
 * made after the coach completes onboarding to verify that the account is
 * fully setup and to store the account ID in Memberstack.
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const config = getConfig();

  // Validate required fields
  const missing = validateRequiredFields(req.body, ['email', 'firstName', 'lastName', 'coachId']);
  if (missing.length > 0) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
  }

  const {
    email,
    firstName,
    lastName,
    country = DEFAULTS.COUNTRY,
    coachId
  } = req.body;

  // Validate email
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email address');
  }

  // Validate country code
  if (!isValidCountryCode(country)) {
    throw new ValidationError(`Invalid country code: ${country}`);
  }

  // Validate and sanitize names
  const firstNameValidation = validateName(firstName);
  if (!firstNameValidation.valid) {
    throw new ValidationError(`Invalid first name: ${firstNameValidation.error}`);
  }

  const lastNameValidation = validateName(lastName);
  if (!lastNameValidation.valid) {
    throw new ValidationError(`Invalid last name: ${lastNameValidation.error}`);
  }

  // Sanitize coach ID
  const sanitizedCoachId = sanitizeString(coachId, 100);
  if (!sanitizedCoachId) {
    throw new ValidationError('Invalid coach ID');
  }

  logger.info('Creating Stripe account', {
    coachId: sanitizedCoachId,
    email: email.toLowerCase(),
    country: country.toUpperCase()
  });

  // Create Stripe Connect Express account
  const account = await stripe.accounts.create({
    type: STRIPE_ACCOUNT_TYPE.EXPRESS,
    country: country.toUpperCase(),
    email: email.toLowerCase(),
    capabilities: {
      [STRIPE_CAPABILITIES.CARD_PAYMENTS]: { requested: true },
      [STRIPE_CAPABILITIES.TRANSFERS]: { requested: true }
    },
    business_type: STRIPE_BUSINESS_TYPE.INDIVIDUAL,
    individual: {
      first_name: firstNameValidation.value,
      last_name: lastNameValidation.value,
      email: email.toLowerCase()
    },
    settings: {
      payouts: {
        schedule: {
          interval: DEFAULTS.PAYOUT_INTERVAL,
          weekly_anchor: DEFAULTS.PAYOUT_ANCHOR
        }
      }
    }
  });

  logger.info('Stripe account created', {
    accountId: account.id,
    coachId: sanitizedCoachId
  });

  // Create onboarding link
  const webflowDomain = config.webflowDomain;
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: `${webflowDomain}/coach-onboarding-refresh?coach_id=${encodeURIComponent(sanitizedCoachId)}&account_id=${account.id}`,
    return_url: `${webflowDomain}/coach-onboarding-success?coach_id=${encodeURIComponent(sanitizedCoachId)}&account_id=${account.id}`,
    type: STRIPE_ACCOUNT_LINK_TYPE.ONBOARDING
  });

  logger.info('Onboarding link created', {
    accountId: account.id,
    coachId: sanitizedCoachId
  });

  // Note: We do not immediately save the account ID to Memberstack here.
  // Instead, the client should call /api/complete-onboarding after the coach
  // completes onboarding. This helps ensure the account is fully verified.

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    accountId: account.id,
    onboardingUrl: accountLink.url,
    message: 'Account created successfully'
  });
}

// Apply middleware: error handling, rate limiting, CORS
module.exports = withCors(
  withRateLimit(
    withErrorHandling(handler),
    { maxRequests: 10, windowMs: 60000 } // 10 requests per minute
  ),
  { methods: ['POST', 'OPTIONS'] }
);
