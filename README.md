# DO IT FOR ME — Commercial Platform

Customer · Agent · Admin in one app.

## Quick start (server)

```bash
cp .env.example .env
# Set JWT_SECRET and keys — see COMMERCIAL_LAUNCH.md
node server.js
```

Open **http://localhost:3000**

### Default admin (change before production)
- Phone: `08000000001`
- Password: `Admin123!`

## Customer vs Admin

| Who | How |
|-----|-----|
| **Customer** | Register → OTP → book, pay, live track |
| **Agent** | Created by admin → jobs, GPS, proof of delivery |
| **Admin** | Login with admin account → full operations dashboard |

Same URL / same APK / same IPA. Role is decided after login.

## Mobile apps (APK & IPA)

See **COMMERCIAL_LAUNCH.md** for full steps.

Short version:

```bash
npm install
npx cap add android   # requires Android Studio for APK
npx cap add ios       # requires Mac + Xcode for IPA
npx cap sync
npx cap open android  # Build → Generate Signed APK / AAB
npx cap open ios      # Archive → Distribute IPA
```

## PWA (no store needed)

Deploy the server on **HTTPS**, then users can **Install app** / **Add to Home Screen**.

## Features

- Auth + phone OTP
- Orders, pricing, Paystack payments
- Live GPS tracking (SSE + Leaflet)
- Route / ETA (Mapbox optional)
- Agent KYC, proof of delivery
- Admin: assign, refunds, disputes, audit
- Push / SMS / WhatsApp hooks (optional)

## Production

Read **COMMERCIAL_LAUNCH.md** before going live.
