#!/usr/bin/env python3

import math
import json
from pathlib import Path

import rasterio
from rasterio.windows import Window
from PIL import Image
import numpy as np


# ------------------------------------------------------------
# REDLINE / Bradbury Landing configuration
# ------------------------------------------------------------

SOURCE = Path("data/raw/gale_hirise_color.tif")
OUTPUT_IMAGE = Path("web/map.webp")
OUTPUT_META = Path("web/map_meta.json")

# NASA Bradbury Landing coordinate
LANDING_LON = 137.4417
LANDING_LAT = -4.5895

# Radius encoded in this GeoTIFF's CRS
MARS_RADIUS_M = 3_396_190.0

# Physical area around landing site
CROP_WIDTH_M = 12_000
CROP_HEIGHT_M = 12_000

# Browser image resolution.
# Source is 0.25 m/pixel, so a 12 km crop would otherwise be
# 48,000 px wide. We downsample for the browser.
MAX_OUTPUT_PX = 8192


def mars_equirectangular(lon_deg, lat_deg):
    """
    Convert Mars lon/lat into this GeoTIFF's native
    equirectangular projected coordinates.

    CRS parameters:
        central_meridian = 0
        standard_parallel = 0
        false_easting = 0
        false_northing = 0
    """
    x = MARS_RADIUS_M * math.radians(lon_deg)
    y = MARS_RADIUS_M * math.radians(lat_deg)
    return x, y


def main():
    OUTPUT_IMAGE.parent.mkdir(parents=True, exist_ok=True)

    landing_x, landing_y = mars_equirectangular(
        LANDING_LON,
        LANDING_LAT,
    )

    with rasterio.open(SOURCE) as ds:

        print("Source raster:")
        print(" ", ds.width, "x", ds.height)
        print(" Resolution:", ds.res)
        print(" Bounds:", ds.bounds)

        # Exact Bradbury pixel from native GeoTIFF transform
        landing_row, landing_col = ds.index(
            landing_x,
            landing_y,
        )

        print()
        print("Bradbury Landing:")
        print(" lon/lat:", LANDING_LON, LANDING_LAT)
        print(" projected:", landing_x, landing_y)
        print(" source pixel:", landing_col, landing_row)

        if not (
            0 <= landing_col < ds.width
            and 0 <= landing_row < ds.height
        ):
            raise RuntimeError(
                "Bradbury Landing is outside the raster."
            )

        pixel_size_x = abs(ds.transform.a)
        pixel_size_y = abs(ds.transform.e)

        crop_width_px = round(CROP_WIDTH_M / pixel_size_x)
        crop_height_px = round(CROP_HEIGHT_M / pixel_size_y)

        col_off = landing_col - crop_width_px // 2
        row_off = landing_row - crop_height_px // 2

        # Clamp to raster boundaries.
        col_off = max(0, col_off)
        row_off = max(0, row_off)

        crop_width_px = min(
            crop_width_px,
            ds.width - col_off,
        )

        crop_height_px = min(
            crop_height_px,
            ds.height - row_off,
        )

        window = Window(
            col_off,
            row_off,
            crop_width_px,
            crop_height_px,
        )

        print()
        print("Crop window:")
        print(window)

        # Determine browser output size while preserving aspect ratio.
        scale = min(
            1.0,
            MAX_OUTPUT_PX / crop_width_px,
            MAX_OUTPUT_PX / crop_height_px,
        )

        out_width = max(1, round(crop_width_px * scale))
        out_height = max(1, round(crop_height_px * scale))

        print("Browser image:", out_width, "x", out_height)

        # Read first 3 bands directly at browser resolution.
        band_count = min(3, ds.count)

        data = ds.read(
            list(range(1, band_count + 1)),
            window=window,
            out_shape=(
                band_count,
                out_height,
                out_width,
            ),
            resampling=rasterio.enums.Resampling.bilinear,
        )

        # Convert band-first -> image-last
        data = np.moveaxis(data, 0, -1)

        if data.shape[2] == 1:
            data = np.repeat(data, 3, axis=2)

        # Handle non-uint8 imagery robustly.
        if data.dtype != np.uint8:
            data = data.astype(np.float32)

            finite = np.isfinite(data)

            if finite.any():
                lo = np.percentile(data[finite], 1)
                hi = np.percentile(data[finite], 99)

                if hi > lo:
                    data = (data - lo) / (hi - lo)
                    data = np.clip(data, 0, 1) * 255

            data = data.astype(np.uint8)

        img = Image.fromarray(data[:, :, :3], "RGB")

        img.save(
            OUTPUT_IMAGE,
            "WEBP",
            quality=90,
            method=6,
        )

        # Determine exact projected bounds of crop.
        crop_transform = ds.window_transform(window)

        left = crop_transform.c
        top = crop_transform.f

        right = left + crop_width_px * pixel_size_x
        bottom = top - crop_height_px * pixel_size_y

        # Landing point expressed relative to crop.
        landing_crop_x = landing_col - col_off
        landing_crop_y = landing_row - row_off

        landing_fraction_x = landing_crop_x / crop_width_px
        landing_fraction_y = landing_crop_y / crop_height_px

        meta = {
            "source": str(SOURCE),

            "projection": "Mars Equirectangular",
            "mars_radius_m": MARS_RADIUS_M,

            "landing": {
                "name": "Bradbury Landing",
                "longitude_deg_east": LANDING_LON,
                "latitude_deg": LANDING_LAT,

                "projected_x_m": landing_x,
                "projected_y_m": landing_y,

                "source_column": landing_col,
                "source_row": landing_row,

                "image_fraction_x": landing_fraction_x,
                "image_fraction_y": landing_fraction_y,
            },

            "crop": {
                "width_m": right - left,
                "height_m": top - bottom,

                "left_projected_m": left,
                "right_projected_m": right,
                "top_projected_m": top,
                "bottom_projected_m": bottom,

                # REDLINE local coordinates relative to Bradbury.
                "local_left_m": left - landing_x,
                "local_right_m": right - landing_x,
                "local_top_m": top - landing_y,
                "local_bottom_m": bottom - landing_y,
            },

            "output": {
                "width_px": out_width,
                "height_px": out_height,
            },
        }

        OUTPUT_META.write_text(
            json.dumps(meta, indent=2)
        )

        print()
        print("DONE")
        print("Image:", OUTPUT_IMAGE)
        print("Metadata:", OUTPUT_META)
        print()
        print(
            "Bradbury image position:",
            f"{landing_fraction_x:.6f},",
            f"{landing_fraction_y:.6f}",
        )


if __name__ == "__main__":
    main()
