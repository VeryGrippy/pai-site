# PAI Website — 6.9 Distribution Upgrade

Static PAI product website. No framework/build step is required.

## Live release behavior
The Download page no longer hardcodes a PAI version or installer. It loads the selected channel manifest at runtime. Canonical layout:

- `developer/latest.json`
- `beta/latest.json`
- `stable/latest.json`

For compatibility, the client also checks `updates/<channel>/latest.json`.

A release manifest should include `version`, `channel`, `package_url`, `sha256`, `installer_url`, and optionally `installer_sha256`, `release_notes`, and updater policy fields.

The website uses `installer_url` for new installations. Existing PAI installations use `package_url` through PAI's OTA updater.

## Publishing
The PAI Windows release workflow should publish both the versioned update ZIP and versioned installer before updating `latest.json`. This keeps the website synchronized automatically with the release channel.

## Local test
Run `python -m http.server 8080` and open `http://localhost:8080/download.html`. A local checkout without a live channel manifest will intentionally show release service unavailable.

## Production
The site can be deployed to Cloudflare Pages, Vercel, Netlify, GitHub Pages, or an ordinary HTTPS host. A custom domain can be attached later without changing the release-client design.
