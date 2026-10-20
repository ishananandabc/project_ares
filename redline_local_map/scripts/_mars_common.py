
from pathlib import Path
import json
import numpy as np
import rasterio
from rasterio.windows import from_bounds, Window
from pyproj import CRS, Transformer

LANDING_LON = 137.4417
LANDING_LAT = -4.5895

def mars_geographic_crs_from_dataset(dataset_crs):
    crs = CRS.from_user_input(dataset_crs)
    ell = crs.ellipsoid
    a = float(ell.semi_major_metre)
    b = float(ell.semi_minor_metre)
    return CRS.from_proj4(
        f"+proj=longlat +a={a:.12f} +b={b:.12f} +no_defs +type=crs"
    )

def landing_xy(ds):
    if ds.crs is None:
        raise RuntimeError("Input GeoTIFF has no CRS.")
    geo = mars_geographic_crs_from_dataset(ds.crs)
    transformer = Transformer.from_crs(geo, ds.crs, always_xy=True)
    return transformer.transform(LANDING_LON, LANDING_LAT)

def crop_window(ds, width_m, height_m):
    cx, cy = landing_xy(ds)
    left = cx - width_m / 2
    right = cx + width_m / 2
    bottom = cy - height_m / 2
    top = cy + height_m / 2

    win = from_bounds(left, bottom, right, top, transform=ds.transform)
    win = win.round_offsets().round_lengths()
    full = Window(0, 0, ds.width, ds.height)
    try:
        win = win.intersection(full)
    except Exception as e:
        raise RuntimeError(
            "Requested mission crop does not intersect the source raster. "
            "Check the landing coordinates / source mosaic."
        ) from e

    return win, (left, bottom, right, top), (cx, cy)

def robust_uint8(arr, nodata=None):
    a = arr.astype(np.float32)
    valid = np.isfinite(a)
    if nodata is not None and np.isfinite(nodata):
        valid &= a != nodata

    if not valid.any():
        return np.zeros(a.shape, dtype=np.uint8)

    vals = a[valid]
    lo, hi = np.percentile(vals, [1.0, 99.0])
    if hi <= lo:
        hi = lo + 1.0

    out = np.clip((a - lo) / (hi - lo), 0, 1) * 255
    out[~valid] = 0
    return out.astype(np.uint8)
