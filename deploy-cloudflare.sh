#!/usr/bin/env bash
set -euo pipefail

OUT=".cloudflare-dist"
rm -rf "$OUT"
mkdir -p "$OUT"

cp index.html download.html pricing.html changelog.html docs.html account.html account-config.json 404.html robots.txt "$OUT"/
cp -R assets "$OUT/assets"

echo "Prepared Cloudflare static site:"
find "$OUT" -type f -maxdepth 4 -print

npx wrangler deploy --assets "$OUT"
