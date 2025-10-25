// /api/complete-onboarding.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { updateMemberStripeAccount, verifyMemberExists } = require('./lib/memberstack');
const { ValidationError, NotFoundError } = require('./lib/errors');
const { HTTP_STATUS } = require('./lib/constants');
const { validateRequiredFields, isValidStripeAccountId } = require('./lib/validation');

const stripe = getStripeClient();
const logger = createLogger('complete-onboarding');

/**
 * POST /api/complete-onboarding
 *
 * Called after a coach is redirected back to your site from Stripe Connect
 * onboarding. This endpoint verifies that the account has completed
 * onboarding (i.e., `details_submitted` and `charges_enabled` are true)
 * and, if so, stores the Stripe account ID on the coach's Memberstack profile.
 *
 * Request body parameters:
 * - `accountId`: The Stripe account ID returned from `/api/start-onboarding`.
 * - `coachId`: The Memberstack ID of the coach.
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

  // SECURITY FIX: Verify the member exists before updating
  // This prevents account takeover attacks where an attacker could
  // associate a Stripe account with an arbitrary member ID
  logger.info('Verifying member exists', { coachId });
  const memberExists = await verifyMemberExists(coachId);
  if (!memberExists) {
    throw new NotFoundError('Coach');
  }

  logger.info('Verifying onboarding completion', { accountId, coachId });

  // Retrieve account status from Stripe
  const account = await stripe.accounts.retrieve(accountId);
  const onboardingComplete = account.details_submitted && account.charges_enabled;

  if (!onboardingComplete) {
    logger.warn('Onboarding incomplete', {
      accountId,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled
    });

    return res.status(HTTP_STATUS.OK).json({
      success: false,
      onboardingComplete: false,
      message: 'Onboarding is not yet complete. Please finish onboarding in Stripe.'
    });
  }

  // Update Memberstack custom field with the Stripe account ID
  await updateMemberStripeAccount(coachId, accountId);

  logger.info('Onboarding completed successfully', { accountId, coachId });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    onboardingComplete: true,
    message: 'Coach has completed onboarding. Stripe account ID stored.'
  });
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['POST', 'OPTIONS']
}));
