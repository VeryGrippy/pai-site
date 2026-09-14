# PAI Website Alpha 1

Static website for PAI. No framework or build step is required.

## Run locally
Open `index.html`, or run a local static server from this folder:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Publish
This folder can be deployed directly to Cloudflare Pages, Vercel, Netlify, GitHub Pages, or any ordinary static web host.

## Make downloads live
1. Build/sign the current public installer.
2. Copy it to `downloads/PAISetup.exe`.
3. Deploy the website.

All download buttons already point to that path.

## 6.9 updater hosting
The `updates/` directory contains example channel manifests:

- `updates/stable/latest.json`
- `updates/beta/latest.json`
- `updates/developer/latest.json`

Replace the placeholder package URL and SHA-256 when publishing a release. The future PAI updater can query these URLs directly.

## Current editable website version
Edit `assets/js/site.js` to update:

- current version
- channel label
- installer path
- Windows requirements text

## Before public commercial launch
Add final domain, privacy policy, terms/EULA, support/contact information, account/login flow, payment/subscription integration, real signed installer, and production update manifests.
