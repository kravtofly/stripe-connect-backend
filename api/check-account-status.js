const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://www.kravtofly.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { account_id } = req.query;
    
    if (!account_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing account_id parameter' 
      });
    }

    console.log(`Checking status for account: ${account_id}`);

    const account = await stripe.accounts.retrieve(account_id);
    
    res.json({
      success: true,
      accountId: account_id,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      requirements: account.requirements,
      onboarding_complete: account.details_submitted && account.charges_enabled
    });

  } catch (error) {
    console.error('Error checking account status:', error);
    
    res.status(400).json({ 
      success: false, 
      error: error.message || 'Failed to check account status'
    });
  }
}
