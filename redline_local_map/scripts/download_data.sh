#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-imagery}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/data/raw"
mkdir -p "$RAW"

IMAGERY_URL="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif"
DEM_URL="https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"

download() {
  local url="$1"
  local out="$2"
  echo "Downloading $(basename "$out")"
  curl -L --fail --retry 4 --retry-delay 3 -C - "$url" -o "$out"
}

case "$MODE" in
  imagery)
    download "$IMAGERY_URL" "$RAW/gale_hirise_color.tif"
    ;;
  dem)
    download "$DEM_URL" "$RAW/gale_dem_1m.tif"
    ;;
  all)
    download "$IMAGERY_URL" "$RAW/gale_hirise_color.tif"
    download "$DEM_URL" "$RAW/gale_dem_1m.tif"
    ;;
  *)
    echo "Usage: $0 [imagery|dem|all]"
    exit 1
    ;;
esac
