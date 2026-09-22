# DO IT FOR ME — Commercial Launch Guide

## What you get

| Channel | How customers use it | How admin uses it |
|---------|----------------------|-------------------|
| **Web / PWA** | Browser or “Add to Home Screen” | Same URL — login as admin |
| **Android APK** | Install from Play Store or sideload | Same app, admin login |
| **iOS IPA** | Install from App Store or TestFlight | Same app, admin login |

One codebase serves **customer**, **agent**, and **admin**. Access is by **role after login**, not separate binaries.

### Demo credentials (change before launch)

- **Admin:** phone `08000000001` / password `Admin123!`
- Customers & agents: register or create via admin

---

## 1. Backend (required first)

```bash
cd DO_IT_FOR_ME_APP
cp .env.example .env
# Edit .env — set JWT_SECRET, APP_BASE_URL, Paystack, Termii, etc.
# OTP_DEV_MODE=false in production

node server.js
```

Host on a **HTTPS** domain (e.g. `https://app.yourdomain.com`).  
Geolocation, payments callback, and push require HTTPS.

Suggested stack: Node 22+, Nginx reverse proxy, managed PostgreSQL later (SQLite is fine to start).

---

## 2. Customer app (PWA — fastest path)

1. Open `https://app.yourdomain.com` on the phone.
2. **Android Chrome:** Menu → Install app / Add to Home screen.
3. **iPhone Safari:** Share → Add to Home Screen.

Works offline for shell UI; API needs network.

---

## 3. Android APK (Capacitor)

### Prerequisites
- Node 22+
- [Android Studio](https://developer.android.com/studio) (SDK 34+)
- Java 17+

### Build

```bash
cd DO_IT_FOR_ME_APP
npm install
# Point the WebView at your live API (recommended for production):
# Edit capacitor.config.json → "server": { "url": "https://app.yourdomain.com", "cleartext": false }
npx cap add android   # once
npx cap sync android
npx cap open android
```

In Android Studio:
1. **Build → Generate Signed Bundle / APK**
2. Create a keystore (keep it safe)
3. Produce **APK** (sideload / testing) or **AAB** (Play Store)

### Play Store listing notes
- App name: DO IT FOR ME  
- Package: `com.doitforme.app`  
- Privacy policy URL required  
- Screenshots of customer + tracking screens  

---

## 4. iOS IPA (Capacitor)

### Prerequisites
- Mac with **Xcode 15+**
- Apple Developer account ($99/year)
- CocoaPods

```bash
cd DO_IT_FOR_ME_APP
npm install
npx cap add ios   # once (on Mac)
npx cap sync ios
npx cap open ios
```

In Xcode:
1. Set Team + Bundle ID `com.doitforme.app`
2. **Product → Archive**
3. Distribute to **App Store** or **Ad Hoc / TestFlight** (IPA)

---

## 5. Admin access

No separate admin APK required.

1. Open the same app / URL  
2. Sign in with an **admin** account  
3. Admin dashboard loads automatically (operations, KYC, refunds, disputes, agents)

Create more admins only via secure DB/ops process; do not expose admin registration publicly.

---

## 6. Pre-launch checklist

- [ ] Strong unique `JWT_SECRET`
- [ ] `OTP_DEV_MODE=false`
- [ ] Change default admin password
- [ ] HTTPS + real domain on `APP_BASE_URL`
- [ ] Paystack live keys
- [ ] Termii (or other) SMS for OTP
- [ ] Privacy policy + terms pages
- [ ] Mapbox token if using traffic routing
- [ ] OneSignal for push (optional)
- [ ] Backups for SQLite / migrate to Postgres
- [ ] Rate limiting / WAF in front of API

---

## 7. Roles summary

| Role | Access |
|------|--------|
| **Customer** | Book services, pay, track live GPS, dispute, wallet |
| **Agent** | Availability, jobs, GPS sharing, proof of delivery |
| **Admin** | Assign agents, KYC, refunds, disputes, audit, stats |

---

## Support paths after launch

- Sideload APK for internal agent tablets  
- TestFlight for iOS beta  
- PWA for customers who prefer not to install from stores  
