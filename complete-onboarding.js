const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const memberstackAdmin = require('@memberstack/admin');

// Initialize Memberstack admin client lazily to avoid repeated initialization.
let memberstack;
function getMemberstack() {
  if (!memberstack) {
    if (!process.env.MEMBERSTACK_SECRET_KEY) {
      throw new Error('Missing MEMBERSTACK_SECRET_KEY environment variable');
    }
    memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);
  }
  return memberstack;
}

/**
 * POST /api/complete-onboarding
 *
 * Called after a coach is redirected back to your site from Stripe Connect
 * onboarding.  This endpoint verifies that the account has completed
 * onboarding (i.e., `details_submitted` and `charges_enabled` are true)
 * and, if so, stores the Stripe account ID on the coach’s Memberstack profile.
 *
 * Request body parameters:
 * - `accountId`: The Stripe account ID returned from `/api/start-onboarding`.
 * - `coachId`: The Memberstack ID of the coach.
 */
module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kravtofly.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { accountId, coachId } = req.body;
    if (!accountId || !coachId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: accountId, coachId'
      });
    }

    console.log(`Verifying onboarding completion for account: ${accountId}`);

    // Retrieve account status from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    const onboardingComplete = account.details_submitted && account.charges_enabled;

    if (!onboardingComplete) {
      return res.status(200).json({
        success: false,
        onboardingComplete: false,
        message: 'Onboarding is not yet complete. Please finish onboarding in Stripe.'
      });
    }

    // Update Memberstack custom field with the Stripe account ID
    const ms = getMemberstack();
    await ms.members.update({
      id: coachId,
      data: {
        customFields: {
          stripe_account_id: accountId
        }
      }
    });

    return res.json({
      success: true,
      onboardingComplete: true,
      message: 'Coach has completed onboarding. Stripe account ID stored.'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to complete onboarding'
    });
  }
};