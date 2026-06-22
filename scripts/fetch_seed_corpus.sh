#!/usr/bin/env bash
# Re-download the MVP seed corpus into data/manual/ (with provenance sidecars).
# incometaxindia.gov.in blocks bots, so we use mirror gov sources: India Code
# (Act), dor.gov.in (Rules), and the e-filing portal (circular). Run from repo root.
set -euo pipefail
UA="BharathTax-Ingest/0.1 (+internal government research tool)"
BASE="data/manual/income_tax"

fetch () {  # url  dest  title  doc_type  source_host  [published_date]
  local url="$1" dest="$2" title="$3" dtype="$4" host="$5" pub="${6:-null}"
  mkdir -p "$(dirname "$dest")"
  echo "→ $title"
  curl -fSL -A "$UA" --retry 3 --max-time 180 -o "$dest" "$url"
  local pub_json="null"; [ "$pub" != "null" ] && pub_json="\"$pub\""
  cat > "$dest.meta.json" <<EOF
{
  "title": "$title",
  "source_url": "$url",
  "source_host": "$host",
  "doc_type": "$dtype",
  "published_date": $pub_json
}
EOF
}

fetch "https://www.indiacode.nic.in/bitstream/123456789/2435/1/a1961-43.pdf" \
      "$BASE/act_1961/income-tax-act-1961_indiacode_a1961-43.pdf" \
      "Income-tax Act, 1961" act indiacode.nic.in

fetch "https://dor.gov.in/files/rules_files/IT%20Rules%20(English)Part4_2_11zon_0.pdf" \
      "$BASE/rules_1962/income-tax-rules-1962_dor_part4.pdf" \
      "Income-tax Rules, 1962 (Part 4)" rule dor.gov.in

fetch "https://www.incometax.gov.in/iec/foportal/sites/default/files/2025-05/CBDT%20Circular%20no.pdf" \
      "$BASE/circulars/cbdt-circular-06-2025.pdf" \
      "CBDT Circular No. 06/2025" circular incometax.gov.in 2025-05-27

echo "Done. Now: make ingest && make verify-corpus"
