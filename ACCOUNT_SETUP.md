# PAI Accounts and Founding Supporter Payments

PAI's account/payment wiring is split into three trusted parts:

- **Supabase** owns user authentication and the account/profile database.
- **PayPal** owns payment collection.
- **The PAI website backend** creates PayPal orders, captures completed payments, verifies the account/order relationship, and grants entitlements.

The browser and PAI desktop app never receive the Supabase service-role key or PayPal client secret.

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
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=live
PUBLIC_SITE_URL=
FOUNDER_CUTOFF=2027-01-02T00:00:00Z
```

Use `PAYPAL_ENV=sandbox` for testing and `PAYPAL_ENV=live` for real payments.

Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` are safe to expose publicly.

## 3. PayPal flow

The website calls:

```
POST /api/create-founder-order
```

The backend creates a $5 USD PayPal order tied to the signed-in PAI user ID.

After the buyer approves the payment on PayPal, PayPal returns them to the PAI account page. The website then calls:

```
POST /api/capture-founder-order
```

The backend:

- verifies the user's PAI session
- captures or retrieves the PayPal order
- confirms the PayPal order belongs to that PAI user
- confirms the payment is exactly $5.00 USD
- confirms the payment is completed
- records the payment event idempotently
- permanently sets `founding_supporter = true`

The client does not grant its own entitlement.

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
