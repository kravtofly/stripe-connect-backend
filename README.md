# Stripe Connect Backend - Krav Flight Labs

> **Version 2.0.0** - Comprehensive Security & Architecture Improvements

Secure serverless API backend for Stripe Connect onboarding and payment processing, designed for the Krav Flight Labs platform. This API handles coach onboarding, payment processing with platform fees, and integrates with Stripe, Webflow CMS, Memberstack, and Make.com.

## 🚀 Features

- **Stripe Connect Integration** - Full coach onboarding flow with Express accounts
- **Payment Processing** - Checkout sessions with destination charges and platform fees
- **Webflow CMS Integration** - Dynamic flight lab and coach data
- **Memberstack Integration** - User identity and custom field storage
- **Make.com Automation** - Webhook event forwarding
- **Calendar Generation** - .ics file generation for lab sessions
- **Security First** - Input validation, CORS, rate limiting, structured logging
- **Serverless Architecture** - Optimized for Vercel deployment

## 🛡️ Security Improvements (v2.0.0)

This version includes comprehensive security fixes. See [SECURITY.md](./SECURITY.md) for details.

**Critical Fixes:**
- ✅ Account takeover prevention
- ✅ CORS security bypass fix
- ✅ Input validation & sanitization
- ✅ Webhook event loss prevention
- ✅ Structured error handling
- ✅ Rate limiting
- ✅ Consistent Stripe API version (2024-06-20)

## 📋 Prerequisites

- Node.js 18+
- Vercel account
- Stripe account (Platform mode)
- Webflow CMS
- Memberstack account
- Make.com account (for automation)

## 🔧 Installation

### 1. Clone and Install

```bash
git clone <repository-url>
cd stripe-connect-backend
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and configure all variables:

```bash
cp .env.example .env
```

**Required Variables:**
```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Webflow
WEBFLOW_TOKEN=...
WEBFLOW_COLLECTION_ID=...
COACH_COLLECTION_ID=...

# Memberstack
MEMBERSTACK_SECRET_KEY=...
MEMBERSTACK_APP_ID=...

# URLs
PUBLIC_SITE_URL=https://www.kravtofly.com
ALLOWED_ORIGINS=https://www.kravtofly.com

# Platform Fee (18% default)
PLATFORM_FEE_PCT=0.18

# Make.com
MAKE_WEBHOOK_URL=...
MAKE_FORWARDING_SECRET=...
```

See [.env.example](./.env.example) for all available configuration options.

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Or connect your GitHub repository to Vercel for automatic deployments.

## 📚 API Endpoints

### Coach Onboarding

#### `POST /api/start-onboarding`
Create a new Stripe Express account for a coach.

**Request:**
```json
{
  "email": "coach@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "country": "US",
  "coachId": "memberstack_id"
}
```

**Response:**
```json
{
  "success": true,
  "accountId": "acct_...",
  "onboardingUrl": "https://connect.stripe.com/..."
}
```

#### `POST /api/complete-onboarding`
Verify onboarding completion and save to Memberstack.

**Request:**
```json
{
  "accountId": "acct_...",
  "coachId": "memberstack_id"
}
```

#### `POST /api/create-refresh-link`
Generate a new onboarding link for incomplete accounts.

#### `GET /api/check-account-status`
Check Stripe account status.

**Query:** `?account_id=acct_...`

### Payment Processing

#### `POST /api/create-checkout`
Create a Stripe Checkout session with destination charge.

**Request:**
```json
{
  "labId": "webflow_item_id",
  "studentName": "Jane Smith",
  "studentEmail": "student@example.com"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

**Features:**
- Automatic platform fee calculation (18% default)
- Destination charge to coach's account
- Seat availability checking
- Dynamic pricing from Webflow CMS

#### `GET /api/checkout-details`
Get session details with lab and coach info.

**Query:** `?session_id=cs_...`

#### `GET /api/session-to-lab`
Map session ID to lab ID.

**Query:** `?session_id=cs_...`

### Webhooks

#### `POST /api/stripe-webhook`
Receive Stripe webhook events and forward to Make.com.

**Handled Events:**
- `checkout.session.completed` - Payment completed

**Important:** Configure webhook signature verification in Stripe dashboard.

### Calendar

#### `GET /api/ics`
Generate .ics calendar file for a flight lab.

**Query:** `?lab=webflow_item_id` or `?name=...&sessions=...&meet=...`

### Debug Endpoints

#### `GET /api/debug-webflow`
List flight labs from Webflow CMS.

#### `GET /api/debug-coach`
Lookup coach's Stripe account ID.

**Query:** `?id=coach_id` or `?labId=lab_id`

## 🏗️ Architecture

### Directory Structure

```
stripe-connect-backend/
├── api/
│   ├── lib/                    # Shared utilities
│   │   ├── auth.js             # Authentication middleware
│   │   ├── config.js           # Environment validation
│   │   ├── constants.js        # Centralized constants
│   │   ├── cors.js             # CORS handling
│   │   ├── errors.js           # Error handling
│   │   ├── logger.js           # Structured logging
│   │   ├── memberstack.js      # Memberstack client
│   │   ├── rateLimit.js        # Rate limiting
│   │   ├── stripe.js           # Stripe client
│   │   ├── validation.js       # Input validation
│   │   └── webflow.js          # Webflow client with caching
│   ├── start-onboarding.js     # Coach onboarding
│   ├── complete-onboarding.js  # Onboarding completion
│   ├── create-checkout.js      # Payment sessions
│   ├── stripe-webhook.js       # Webhook handler
│   └── ...
├── .env.example
├── package.json
├── README.md
└── SECURITY.md
```

### Shared Utilities

All endpoints use shared utilities for consistency:

- **CORS:** Centralized origin validation
- **Logging:** Structured JSON logs
- **Validation:** Input sanitization & validation
- **Error Handling:** Consistent error responses
- **Rate Limiting:** Token bucket algorithm
- **Caching:** Webflow data caching (5-min TTL)

### Data Flow

```
User → Frontend → API Endpoint → Shared Utilities → External Services
                                     ↓
                              [Validation, Auth, CORS]
                                     ↓
                              [Business Logic]
                                     ↓
                       [Stripe, Webflow, Memberstack]
                                     ↓
                              [Structured Response]
```

## 🔐 Authentication

Currently, endpoints rely on CORS for protection. For production, we **strongly recommend** implementing API key authentication:

### Setup API Authentication

1. Generate a secure API key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

2. Set environment variable:
```env
API_SECRET_KEY=your_generated_key
```

3. Update client to send API key:
```javascript
fetch('/api/start-onboarding', {
  headers: {
    'Authorization': 'Bearer your_api_key',
    'Content-Type': 'application/json'
  }
})
```

See [SECURITY.md](./SECURITY.md) for implementation details.

## 📊 Monitoring & Logging

### Structured Logs

All logs are JSON-formatted for easy parsing:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "module": "create-checkout",
  "message": "Checkout session created",
  "session_id": "cs_test_123",
  "lab_id": "lab_456"
}
```

### Recommended Tools

- **Log Aggregation:** Logtail, Datadog, CloudWatch
- **Error Tracking:** Sentry, Rollbar
- **Uptime Monitoring:** Pingdom, UptimeRobot

## 🧪 Testing

### Local Development

```bash
# Run locally with Vercel CLI
vercel dev

# Test endpoints
curl -X POST http://localhost:3000/api/start-onboarding \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","firstName":"Test","lastName":"User","coachId":"123"}'
```

### Testing Checklist

- [ ] Test all onboarding flows
- [ ] Test payment processing
- [ ] Test webhook handling
- [ ] Verify CORS configuration
- [ ] Test rate limiting
- [ ] Test error handling
- [ ] Verify input validation
- [ ] Check structured logging

## ⚠️ Known Issues

### Seat Count Race Condition

The seat availability check in `create-checkout.js` has a potential race condition. Multiple users could simultaneously pass the check before the count is decremented.

**Recommended Solutions:**
1. Implement Stripe inventory management
2. Use optimistic locking in Webflow
3. Implement a queue system
4. Handle overbooking in webhook with refunds

See [SECURITY.md](./SECURITY.md) for details.

## 🚀 Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on git push

### Environment-Specific Configuration

```env
# Production
NODE_ENV=production
STRIPE_SECRET_KEY=sk_live_...
DEBUG_STRIPE_ERRORS=false

# Staging
NODE_ENV=staging
STRIPE_SECRET_KEY=sk_test_...
DEBUG_STRIPE_ERRORS=true
```

## 📖 Additional Documentation

- [SECURITY.md](./SECURITY.md) - Security documentation
- [.env.example](./.env.example) - Environment variables
- [Stripe Connect Docs](https://stripe.com/docs/connect)
- [Webflow API Docs](https://developers.webflow.com/)
- [Memberstack API Docs](https://docs.memberstack.com/)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Update documentation
5. Submit pull request

## 📄 License

UNLICENSED - Private project for Krav Flight Labs

## 🆘 Support

For issues or questions:
- Create an issue in this repository
- Contact the development team
- Review security documentation

## 🎯 Roadmap

- [ ] Implement JWT authentication
- [ ] Add comprehensive test suite
- [ ] Implement seat reservation system
- [ ] Add Redis-based rate limiting
- [ ] Implement retry queues for webhooks
- [ ] Add metrics dashboard
- [ ] Implement automated security scanning

---

**Last Updated:** 2025-01-15
**Version:** 2.0.0