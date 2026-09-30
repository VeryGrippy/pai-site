# PAI Accounts and Founding Supporter Payments

PAI's account/payment wiring is split into three trusted parts:

- **Supabase** owns user authentication and the account/profile database.
- **Stripe** owns payment collection.
- **The PAI website backend** creates Stripe Checkout sessions and accepts verified Stripe webhooks.

The browser and PAI desktop app never receive the Supabase service-role key or Stripe secret key.

## 1. Supabase

Create a Supabase project, then run `supabase/schema.sql` in the SQL editor.

The schema creates:

- `profiles`
- `payment_events`
- row-level security so a signed-in user may read only their own profile
- a trigger that creates a profile automatically when an auth user is created

PAI account entitlements are represented as:

- `plan = free | pro`
- `founding_supporter = true | false`

Founding Supporter is independent from Pro, so an account can eventually be both.

## 2. Website/backend environment variables

Configure these on the serverless website host:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PUBLIC_SITE_URL=
FOUNDER_CUTOFF=2027-01-02T00:00:00Z
```

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` are safe to expose publicly.

## 3. Stripe webhook

Create a Stripe webhook endpoint pointing to:

```
https://YOUR_SITE/api/stripe-webhook
```

Subscribe at minimum to:

```
checkout.session.completed
```

Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

The webhook verifies Stripe's signature before changing entitlements. A successful paid Founding Supporter checkout permanently sets:

```
founding_supporter = true
```

The webhook also records Stripe event IDs so retries are idempotent.

## 4. Public desktop configuration

After Supabase is configured, publish `account-config.json` from the example file with only:

- Supabase project URL
- public anon key
- public account-page URL

PAI desktop reads this public file, signs users in directly against Supabase Auth, loads only the signed-in user's RLS-protected profile, and stores its refresh session encrypted with Windows DPAPI.

## 5. Founding Supporter offer

Current server-side cutoff:

**January 2, 2027 at 00:00 UTC**, which means the offer remains available through January 1, 2027.

The server checks this cutoff before opening checkout; hiding the website button alone is not treated as security.

## 6. Pro

Pro remains **TBD**. The database supports `plan = pro`, but no Pro checkout is exposed until pricing, limits, and benefits are finalized.
