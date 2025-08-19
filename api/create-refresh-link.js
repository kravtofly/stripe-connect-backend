const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    console.log(`Creating refresh link for account: ${accountId}`);

    // Create new onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.WEBFLOW_DOMAIN}/coach-onboarding-refresh?coach_id=${coachId}&account_id=${accountId}`,
      return_url: `${process.env.WEBFLOW_DOMAIN}/coach-onboarding-success?coach_id=${coachId}&account_id=${accountId}`,
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      onboardingUrl: accountLink.url
    });

  } catch (error) {
    console.error('Error creating refresh link:', error);
    
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create refresh link'
    });
  }
}
