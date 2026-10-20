#!/usr/bin/env python3
from pathlib import Path
import argparse, json, math
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.enums import Resampling
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# NASA/JPL Bradbury Landing
LANDING_LON = 137.4417       # positive east
LANDING_LAT = -4.5895        # planetocentric degrees

# USGS Astropedia footprint for "Mars MSL Gale Merged Orthophoto Mosaic 25cm".
# The 2025 HiRISE LRGB color mosaic is cartographically tied to this MSL mosaic.
MIN_LON = 137.094719
MAX_LON = 137.853896
MIN_LAT = -5.249525
MAX_LAT = -4.068583

MARS_RADIUS_M = 3_396_190.0

parser = argparse.ArgumentParser()
parser.add_argument("--input", type=Path,
                    default=ROOT/"data/raw/gale_hirise_color.tif")
parser.add_argument("--width-km", type=float, default=12.0)
parser.add_argument("--height-km", type=float, default=12.0)
parser.add_argument("--max-px", type=int, default=8192)
parser.add_argument("--quality", type=int, default=90)
args = parser.parse_args()

if not args.input.exists():
    raise SystemExit(f"Missing {args.input}")

def robust_uint8(a, nodata=None):
    a = a.astype(np.float32)
    valid = np.isfinite(a)
    if nodata is not None and np.isfinite(nodata):
        valid &= a != nodata
    if not valid.any():
        return np.zeros(a.shape, dtype=np.uint8)
    vals = a[valid]
    lo, hi = np.percentile(vals, [1, 99])
    if hi <= lo: hi = lo + 1
    out = np.clip((a-lo)/(hi-lo), 0, 1)*255
    out[~valid] = 0
    return out.astype(np.uint8)

# Convert desired physical crop to angular span on Mars.
half_h_m = args.height_km * 1000 / 2
half_w_m = args.width_km * 1000 / 2
lat0_rad = math.radians(LANDING_LAT)

dlat = math.degrees(half_h_m / MARS_RADIUS_M)
dlon = math.degrees(half_w_m / (MARS_RADIUS_M * math.cos(lat0_rad)))

crop_min_lon = LANDING_LON - dlon
crop_max_lon = LANDING_LON + dlon
crop_min_lat = LANDING_LAT - dlat
crop_max_lat = LANDING_LAT + dlat

if not (MIN_LON <= crop_min_lon < crop_max_lon <= MAX_LON and
        MIN_LAT <= crop_min_lat < crop_max_lat <= MAX_LAT):
    raise SystemExit("Requested crop extends outside the authoritative USGS mosaic footprint.")

with rasterio.open(args.input) as ds:
    # IMPORTANT: calculate pixels from the published geographic footprint.
    # This avoids pyproj's Earth/Mars/custom-CRS ambiguity entirely.
    def lon_to_col(lon):
        return (lon - MIN_LON) / (MAX_LON - MIN_LON) * ds.width

    def lat_to_row(lat):
        return (MAX_LAT - lat) / (MAX_LAT - MIN_LAT) * ds.height

    c0 = lon_to_col(crop_min_lon)
    c1 = lon_to_col(crop_max_lon)
    r0 = lat_to_row(crop_max_lat)
    r1 = lat_to_row(crop_min_lat)

    window = Window(
        col_off=round(c0),
        row_off=round(r0),
        width=max(1, round(c1-c0)),
        height=max(1, round(r1-r0))
    )

    aspect = window.width/window.height
    if aspect >= 1:
        out_w = args.max_px
        out_h = max(1, round(args.max_px/aspect))
    else:
        out_h = args.max_px
        out_w = max(1, round(args.max_px*aspect))

    if ds.count >= 3:
        raw = ds.read([1,2,3], window=window,
                      out_shape=(3,out_h,out_w),
                      resampling=Resampling.bilinear)
        rgb = np.stack([robust_uint8(raw[i], ds.nodata) for i in range(3)], axis=-1)
    else:
        raw = ds.read(1, window=window,
                      out_shape=(out_h,out_w),
                      resampling=Resampling.bilinear)
        g = robust_uint8(raw, ds.nodata)
        rgb = np.stack([g,g,g], axis=-1)

    outdir = ROOT/"web"
    outdir.mkdir(exist_ok=True)
    Image.fromarray(rgb, "RGB").save(outdir/"map.webp", "WEBP",
                                     quality=args.quality, method=6)

    # Derive exact geographic edges represented by rounded pixel window.
    px_min_lon = MIN_LON + (window.col_off/ds.width)*(MAX_LON-MIN_LON)
    px_max_lon = MIN_LON + ((window.col_off+window.width)/ds.width)*(MAX_LON-MIN_LON)
    px_max_lat = MAX_LAT - (window.row_off/ds.height)*(MAX_LAT-MIN_LAT)
    px_min_lat = MAX_LAT - ((window.row_off+window.height)/ds.height)*(MAX_LAT-MIN_LAT)

    # Convert those edges to local metres around Bradbury.
    def east_m(lon):
        return math.radians(lon-LANDING_LON)*MARS_RADIUS_M*math.cos(lat0_rad)
    def north_m(lat):
        return math.radians(lat-LANDING_LAT)*MARS_RADIUS_M

    landing_col = lon_to_col(LANDING_LON)
    landing_row = lat_to_row(LANDING_LAT)

    meta = {
      "name": "REDLINE Bradbury Landing verified crop",
      "source_file": args.input.name,
      "landing_site": {
        "name": "Bradbury Landing",
        "longitude_east_deg": LANDING_LON,
        "latitude_deg": LANDING_LAT
      },
      "verification": {
        "method": "USGS published geographic footprint -> raster pixel mapping",
        "source_footprint_deg": {
          "min_lon": MIN_LON, "max_lon": MAX_LON,
          "min_lat": MIN_LAT, "max_lat": MAX_LAT
        },
        "landing_source_pixel": {
          "column": landing_col, "row": landing_row
        },
        "landing_output_fraction": {
          "x": (landing_col-window.col_off)/window.width,
          "y": (landing_row-window.row_off)/window.height
        }
      },
      "coordinate_frame": {
        "origin": "Bradbury Landing",
        "units": "meters",
        "x_axis": "east",
        "y_axis": "north"
      },
      "image": {"file":"map.webp","width_px":out_w,"height_px":out_h},
      "geographic_bounds_deg": {
        "min_lon": px_min_lon, "max_lon": px_max_lon,
        "min_lat": px_min_lat, "max_lat": px_max_lat
      },
      "local_bounds_m": {
        "xmin_m": east_m(px_min_lon), "xmax_m": east_m(px_max_lon),
        "ymin_m": north_m(px_min_lat), "ymax_m": north_m(px_max_lat)
      }
    }
    (outdir/"map_meta.json").write_text(json.dumps(meta, indent=2))

print("FIXED crop complete")
print(f"Source raster: {ds.width} x {ds.height}, {ds.count} band(s)")
print(f"Landing source pixel: col={landing_col:.2f}, row={landing_row:.2f}")
print(f"Window: col={window.col_off}, row={window.row_off}, "
      f"w={window.width}, h={window.height}")
print(f"Wrote {ROOT/'web/map.webp'}")
print(f"Wrote {ROOT/'web/map_meta.json'}")
