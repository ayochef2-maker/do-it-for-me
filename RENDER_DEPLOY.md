# Deploy DO IT FOR ME to Render

## Option A — Deploy from GitHub (recommended)

### 1. Push this folder to GitHub

```bash
cd DIFM_COMMERCIAL   # or DO_IT_FOR_ME_APP
git init
git add .
git commit -m "DO IT FOR ME production"
# Create a new empty repo on github.com, then:
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/do-it-for-me.git
git push -u origin main
```

### 2. Create the service on Render

1. Go to https://dashboard.render.com
2. **New → Web Service**
3. Connect the GitHub repo
4. Settings:

| Field | Value |
|--------|--------|
| Name | `do-it-for-me` |
| Region | Closest to you |
| Runtime | **Node** |
| Build Command | `mkdir -p data` |
| Start Command | `node server.js` |
| Instance | Free |

5. **Environment** → Add:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `JWT_SECRET` | long random string (Render can auto-generate) |
| `OTP_DEV_MODE` | `true` (set `false` when SMS is live) |
| `PAYSTACK_DEV_MODE` | `true` (set `false` with real Paystack key) |
| `DB_FILE` | `./data/doitforme.sqlite` |
| `APP_BASE_URL` | `https://YOUR-SERVICE.onrender.com` (set after first deploy) |

6. Click **Create Web Service**

### 3. After deploy

Render gives a URL like:

```text
https://do-it-for-me-xxxx.onrender.com
```

1. Open that URL in the browser  
2. Login admin: `08000000001` / `Admin123!`  
3. Set env `APP_BASE_URL` to that exact HTTPS URL and **Manual Deploy → Clear build cache & deploy**

---

## Option B — Blueprint (`render.yaml`)

1. Push repo to GitHub (same as above)
2. Render Dashboard → **New → Blueprint**
3. Select the repo (it reads `render.yaml`)
4. Apply → fill optional secrets when asked

---

## Important notes

### Free tier cold starts
After ~15 minutes idle, the free service sleeps. First request can take 30–60 seconds.

### SQLite data
On the **free** plan, the disk is **ephemeral**. Redeploys can wipe the database.  
For production data:

- Upgrade and attach a **Persistent Disk**, mount at e.g. `/var/data`, set `DB_FILE=/var/data/doitforme.sqlite`, **or**
- Move to managed Postgres later

### Node version
This app needs **Node 22+** (`node:sqlite`). In Render:

- Environment → add `NODE_VERSION` = `22`

### Live payments / OTP
When ready:

```text
OTP_DEV_MODE=false
PAYSTACK_DEV_MODE=false
PAYSTACK_SECRET_KEY=sk_live_...
TERMII_API_KEY=...
APP_BASE_URL=https://your-service.onrender.com
```

---

## Quick checklist after deploy

- [ ] Open `https://YOUR-SERVICE.onrender.com`
- [ ] `/api/health` returns `{"ok":true}`
- [ ] Admin login works
- [ ] Customer can register
- [ ] `APP_BASE_URL` matches the live URL
