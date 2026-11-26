#!/bin/zsh
# Adds a batch of owner-supplied Turnkey project photos (zip of "<no>-<name>.jpg") to the catalogue data and staging.
#   zsh scripts/add-turnkey-photos.sh <zip> [<zip> ...]
# Photos are resized (1280 px, JPEG q60) into data/turnkey/photos (gitignored), the catalogue JSON gets their paths by
# project number, then the seed script uploads them and fills projects that have no photo yet (STAGING ONLY).
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
for z in "$@"; do unzip -q -o "$z" -d "$tmp"; done
mkdir -p data/turnkey/photos
find "$tmp" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) | while read f; do
  b=$(basename "$f"); sips -Z 1280 -s format jpeg -s formatOptions 60 "$f" --out "data/turnkey/photos/${b%.*}.jpg" >/dev/null
done
rm -rf "$tmp"
python3 - <<'EOF'
import json, os
p = 'data/turnkey/catalogue-300.json'; d = json.load(open(p))
photos = {int(f.split('-')[0]): f for f in os.listdir('data/turnkey/photos') if f[0].isdigit()}
for r in d['projects']:
    if r['no'] in photos: r['image'] = f"turnkey/catalogue/{photos[r['no']]}"; r['image_alt'] = r['title']
nos = sorted(photos)
d['photos_supplied'] = f"{len(nos)} photos (projects {nos[0]}–{nos[-1]})"
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1)
missing = [n for n in range(1, 301) if n not in photos]
print(f"photos on file: {len(nos)}; still missing: {len(missing)}" + (f" (first: {missing[:10]})" if missing else ""))
EOF
node --env-file=.env.staging scripts/seed-turnkey-catalogue.mjs | tail -1
