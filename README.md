# stripe-connect-backend

This repository contains serverless API routes for handling Stripe Connect onboarding and account management for the Kravtofly platform.  The API is designed to run on Vercel (or any platform that supports Node.js-based serverless functions) and integrates with Memberstack to store the connected Stripe account ID for each coach.

The core endpoints are:

- `start-onboarding.js` – Creates a new Stripe Express connected account for a coach and returns a one‑time onboarding link.
- `create-refresh-link.js` – Generates a new onboarding link if a coach needs to refresh their onboarding session.
- `check-account-status.js` – Retrieves the status of a Stripe account (e.g., whether details are submitted and charges/payouts are enabled).
- **New:** `complete-onboarding.js` – (See example below) Confirms onboarding completion and updates the coach’s `stripe_account_id` custom field in Memberstack.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment variables** – Set the following environment variables in Vercel or your local `.env` file:

   - `STRIPE_SECRET_KEY` – Your Stripe secret key for the platform account (e.g., `sk_live_...` or `sk_test_...`).
   - `WEBFLOW_DOMAIN` – The domain of your Webflow site, used for the return and refresh URLs (e.g., `https://www.kravtofly.com`).
   - `MEMBERSTACK_SECRET_KEY` – A Memberstack Admin API key with permission to update member data.
   - `MEMBERSTACK_APP_ID` – Your Memberstack application ID (used for verifying webhooks, if needed).

3. **Deploy** – Deploy the project to Vercel.  Each file in the `api` directory automatically becomes a serverless function.

## License

MIT