# Customer booking page

A standalone, static quote-calculator page for Temporary Escape Inn customers. Plain HTML/CSS/JS, no build step, no framework. Fully separate from the admin app (`C:\dev\tea`) and its Google account/backend — see `docs/customer-page-plan.md` at the repo root for the full design history.

## Files

- `index.html`, `style.css`, `app.js` — the page itself.
- `pricing.js` — the pricing engine, a hand-kept vanilla-JS port of `src/pricing/calculatePrice.ts`. If the admin app's pricing rules ever change, update both files.
- `logo.png` — not included yet; drop your logo PNG in here (page falls back to a text wordmark if it's missing).
- `apps-script/Code.gs` — the backend: request history + room status/notices.

## One-time setup

### 1. Backend (separate Google account)

1. Sign in to a **new** Google account (not the one the admin app's Apps Script uses).
2. Create a new Google Sheet.
3. Extensions → Apps Script, paste in `apps-script/Code.gs`.
4. Run the `setup` function once (creates the `Requests` and `Status` tabs).
5. Project Settings (gear icon) → Script Properties → add `SHARED_SECRET` = any long random string.
6. Deploy → New deployment → Web app. Execute as **Me**, access **Anyone**. Copy the deployed URL.

### 2. Page config

Open `app.js` and fill in the three constants at the top:

```js
const BUSINESS_WHATSAPP_NUMBER = '15551234567'; // digits only, your WhatsApp Business number
const BACKEND_URL = 'https://script.google.com/macros/s/.../exec'; // from step 1.6
const BACKEND_TOKEN = 'the-same-random-string-you-set-as-SHARED_SECRET';
```

Leaving `BACKEND_URL` blank is fine — the page still works, it just skips request logging and room status/notices (no banner, no disabled rooms).

### 3. Logo

Save your logo as `customer-page/logo.png`. No code changes needed — the page looks for that exact filename and falls back to a plain text wordmark if it's not there.

### 4. Hosting

Not deployed yet. Any static host works (GitHub Pages, Cloudflare Pages, etc.) — ask to have this set up once the page itself looks right.

## Day-to-day: disabling a room / posting a notice

Open the Google Sheet from step 1, go to the **Status** tab:

| roomKey | enabled | notice |
|---|---|---|
| `_site` | (ignored) | whole-page banner text, or leave blank for none |
| `standard` | `TRUE`/`FALSE` | shown under the room grid if `FALSE` |
| `white` | `TRUE`/`FALSE` | shown under the room grid if `FALSE` |
| `blue` | `TRUE`/`FALSE` | shown under the room grid if `FALSE` |

Edit a cell, done — no redeploy, the page picks it up on next load.

## Keeping pricing in sync

`pricing.js` mirrors `src/pricing/calculatePrice.ts` by hand — there's no shared build step between the React Native app and this static page. If you change pricing rules in one, update the other. The full rule set is documented in `docs/customer-page-plan.md`.
