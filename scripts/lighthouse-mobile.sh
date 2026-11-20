#!/bin/zsh
# Usage: scripts/lighthouse-mobile.sh "https://host/|home" "https://host/p/<slug>|product" (for protected Vercel previews, set a fresh VERCEL_OIDC_TOKEN via `vc env pull` first)
# Lighthouse mobile for a list of URLs → /tmp/lh-<name>.json and a one-line summary each.
cd "$(dirname "$0")/.."
CHROME=$(node -e "console.log(require('@playwright/test').chromium.executablePath())")
HDR=()
if [[ -n "$VERCEL_OIDC_TOKEN" ]]; then
  HFILE=$(mktemp -t lh-headers); chmod 600 "$HFILE"; trap 'rm -f "$HFILE"' EXIT
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN}))" "$HFILE"
  HDR=(--extra-headers="$HFILE")
fi
for spec in "$@"; do
  url="${spec%%|*}"; name="${spec##*|}"
  npx -y lighthouse@12 "$url" --quiet --chrome-path="$CHROME" --chrome-flags="--headless=new --no-sandbox" --form-factor=mobile --output=json --output-path="/tmp/lh-$name.json" --only-categories=performance,accessibility,best-practices,seo "${HDR[@]}" >/dev/null 2>&1
  node -e "const r=require('/tmp/lh-$name.json');const c=r.categories;const a=r.audits;console.log('$name', Object.keys(c).map(k=>k+':'+Math.round(c[k].score*100)).join(' '), '| LCP',a['largest-contentful-paint'].displayValue,'CLS',a['cumulative-layout-shift'].displayValue,'TBT',a['total-blocking-time'].displayValue, '| final URL', r.finalDisplayedUrl)" 2>&1 | tail -1
done
