# Clover ticket checkout backend

This is a standalone Vercel backend for a Framer ticket site. It creates a short-lived Clover Hosted Checkout session, reserves inventory atomically in Supabase, and issues tickets only after a verified Clover webhook reports an approved payment.

## What this does

```text
Framer → POST /api/checkout-sessions → Clover Hosted Checkout
                                      ↓
                              POST /api/webhooks/clover
                                      ↓
                          Supabase order + issued tickets
```

The Framer site never receives the Clover private token or the Supabase service-role key.

## Deploy it

1. Create a new GitHub repository and upload the complete `web-backend` directory to it. Do not upload credential files.
2. Create a new Supabase project. In its SQL Editor, run every file in [`supabase/migrations`](supabase/migrations) in filename order. Existing projects must run the newest [checkout-safety migration](supabase/migrations/20260803_checkout_safety.sql) before deploying its matching API code.
3. Add each ticket tier in Supabase's Table Editor under `ticket_types`. Enter prices as whole cents: `2500` is $25.00. Set `inventory_remaining` to the number available.
4. Import the GitHub repository into Vercel. Use the default build settings; these are Vercel serverless functions, not a frontend build.
5. Add the environment variables listed below in Vercel's Production, Preview, and Development environments as appropriate.
6. Deploy. Note the Vercel URL, then configure the Clover test merchant's Hosted Checkout webhook URL as `https://YOUR-VERCEL-DOMAIN/api/webhooks/clover` and generate its signing secret.
7. In Clover, configure the hosted-checkout success and failure redirect URLs. Dashboard values override the request values. Use:
   - `https://YOUR-FRAMER-DOMAIN/payment-success?session_id={CHECKOUT_SESSION_ID}`
   - `https://YOUR-FRAMER-DOMAIN/payment-failed?error_code={ERROR_CODE}`
8. Add the Framer domain (without a trailing slash) to `ALLOWED_ORIGIN` and `PUBLIC_SITE_URL`.

## Vercel environment variables

Create these in Vercel's Environment Variables UI; do not commit them.

| Variable | Value |
| --- | --- |
| `ALLOWED_ORIGIN` | Framer site origin, e.g. `https://tickets.example.com` |
| `PUBLIC_SITE_URL` | Same Framer origin used for Clover redirects |
| `SUPABASE_URL` | Project URL from Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key from Supabase project settings; backend only |
| `CLOVER_MERCHANT_ID` | Clover merchant ID |
| `CLOVER_PRIVATE_TOKEN` | Clover Ecommerce token created for **Hosted checkout** |
| `CLOVER_WEBHOOK_SECRET` | Signing secret generated next to the webhook URL in Clover |
| `CLOVER_API_BASE_URL` | `https://apisandbox.dev.clover.com` in sandbox; change to Clover's production API base URL only when going live |

This project works on Vercel's free Hobby plan. Expired checkout holds are released safely when the next customer starts a checkout. If you later use a paid scheduler, you can add a periodic cleanup job as an optimization, but it is not required for payment processing.

## Framer integration contract

Your Framer code override or custom component should call this endpoint from the Buy button:

`POST https://YOUR-VERCEL-DOMAIN/api/checkout-sessions`

```json
{
  "checkoutAttemptId": "a-new-UUID-created-once-per-button-attempt",
  "ticketTypeId": "UUID_FROM_SUPABASE",
  "quantity": 2,
  "customer": {
    "email": "buyer@example.com",
    "firstName": "Avery",
    "lastName": "Lee",
    "phoneNumber": "5555550100"
  }
}
```

`checkoutAttemptId` is required. The browser must retain it while retrying the same click; the API returns the existing unexpired Clover checkout URL instead of creating a second order. Use the ready-to-paste [Framer component](framer/TicketCheckout.tsx), which supplies this value and blocks repeat clicks synchronously.

On a successful response, redirect the browser to `checkoutUrl`:

```json
{ "checkoutUrl": "https://...clover..." }
```

The success page can show live fulfillment status with:

`GET https://YOUR-VERCEL-DOMAIN/api/orders?session_id=CHECKOUT_SESSION_ID`

Only use a `paid` response to show ticket IDs. A customer redirect is not proof of payment; the signed Clover webhook is the system of record.

## Clover setup and testing

1. Create a Clover global developer account and a sandbox merchant.
2. In the merchant dashboard, create an Ecommerce API token with integration type **Hosted checkout**, then record the merchant ID and private token in Vercel.
3. Set the Hosted Checkout webhook to the deployed Vercel endpoint and copy the generated signing secret to `CLOVER_WEBHOOK_SECRET`.
4. Test against the sandbox API URL. Clover sessions expire after 15 minutes.
5. Confirm all four cases: approved payment issues the expected number of tickets, declined payment restores inventory, an abandoned checkout restores inventory after expiry, and a duplicate webhook does not create duplicate tickets.

For current Clover details, use [Create a Hosted Checkout session](https://docs.clover.com/dev/docs/creating-a-hosted-checkout-session), [redirect URLs](https://docs.clover.com/dev/docs/redirecting-customers), and [webhook validation](https://docs.clover.com/dev/docs/ecomm-hosted-checkout-webhook).

## Checkout safety

The server requires a unique `checkoutAttemptId` for each buyer intent. It returns the existing unexpired checkout URL if a browser retries that intent, rather than creating a second Clover session. The supplied Framer component also locks immediately on the first submit. Replace existing Framer component instances after updating their source, then republish the live site.

Approved Clover webhooks are reconciled by checkout session ID and payment ID. An unmatched approved payment now returns an error and emits safe IDs in Vercel logs instead of being silently acknowledged.

## Not included yet

- Email delivery of tickets
- QR-code generation and door check-in app
- Refund/cancellation workflow
- Multiple events or event dates

Those are intentionally separate from payment confirmation, so they can be added safely after the checkout has been tested.
