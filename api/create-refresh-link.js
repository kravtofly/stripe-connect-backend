// /api/create-refresh-link.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { requireAuth } = require('./lib/auth');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError } = require('./lib/errors');
const { HTTP_STATUS, STRIPE_ACCOUNT_LINK_TYPE } = require('./lib/constants');
const { validateRequiredFields, isValidStripeAccountId, requireEnv } = require('./lib/validation');

const stripe = getStripeClient();
const logger = createLogger('create-refresh-link');

/**
 * POST /api/create-refresh-link
 *
 * Creates a new Stripe onboarding link for an existing connected account.
 * This is useful if a coach abandons the onboarding flow and needs to resume
 * later. Requires the `accountId` and the coach's Memberstack ID (`coachId`).
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const { accountId, coachId } = req.body;

  // Validate required fields
  const missing = validateRequiredFields(req.body, ['accountId', 'coachId']);
  if (missing.length > 0) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
  }

  // Validate Stripe account ID format
  if (!isValidStripeAccountId(accountId)) {
    throw new ValidationError('Invalid Stripe account ID format');
  }

  logger.info('Creating refresh link', { accountId, coachId });

  const webflowDomain = requireEnv('WEBFLOW_DOMAIN');

  // Create new onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${webflowDomain}/coach-onboarding-refresh?coach_id=${coachId}&account_id=${accountId}`,
    return_url: `${webflowDomain}/coach-onboarding-success?coach_id=${coachId}&account_id=${accountId}`,
    type: STRIPE_ACCOUNT_LINK_TYPE.ONBOARDING
  });

  logger.info('Refresh link created', {
    accountId,
    coachId,
    url: accountLink.url
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    onboardingUrl: accountLink.url
  });
}

module.exports = withCors(
  requireAuth(
    withErrorHandling(handler)
  ),
  {
    methods: ['POST', 'OPTIONS']
  }
);
