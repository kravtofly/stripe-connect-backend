const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Enable CORS for your Webflow domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
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
    const { email, firstName, lastName, country = 'US', coachId } = req.body;

    // Validate required fields
    if (!email || !firstName || !lastName || !coachId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: email, firstName, lastName, coachId'
      });
    }

    console.log(`Creating Stripe account for coach: ${coachId}`);

    // Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: country,
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      individual: {
        first_name: firstName,
        last_name: lastName,
        email: email,
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'weekly',
            weekly_anchor: 'friday'
          }
        }
      }
    });

    console.log(`Created Stripe account: ${account.id}`);

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.WEBFLOW_DOMAIN}/coach-onboarding-refresh?coach_id=${coachId}&account_id=${account.id}`,
      return_url: `${process.env.WEBFLOW_DOMAIN}/coach-onboarding-success?coach_id=${coachId}&account_id=${account.id}`,
      type: 'account_onboarding',
    });

    console.log(`Created onboarding link for: ${account.id}`);

    // TODO: Save account.id to your database linked to coachId
    // You can add database logic here later

    res.json({
      success: true,
      accountId: account.id,
      onboardingUrl: accountLink.url,
      message: 'Account created successfully'
    });

  } catch (error) {
    console.error('Stripe Connect Error:', error);
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create Stripe account',
      type: error.type || 'unknown_error'
    });
  }
}
