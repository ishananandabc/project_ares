# REDLINE Local Mars Map

This starter uses **download-once, preprocess-once, render-locally**.

## Data sources

### Visual basemap (recommended)
USGS/JPL Curiosity / Gale HiRISE color mosaic, Cloud-Optimized GeoTIFF (~1 GB):

https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif

### Terrain DEM (optional but recommended for the routing team)
USGS/JPL Gale merged DEM, 1 m/pixel (~3.6 GB):

https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif

## 1. Install dependencies

Python 3.10+ recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install rasterio pyproj pillow numpy
```

## 2. Download the imagery

```bash
bash scripts/download_data.sh imagery
```

Optional DEM:

```bash
bash scripts/download_data.sh dem
```

Or both:

```bash
bash scripts/download_data.sh all
```

## 3. Build the local mission map

The default crop is a 12 km × 12 km square centered on Bradbury Landing.

```bash
python scripts/preprocess_basemap.py
```

This produces:

- `web/map.webp`
- `web/map_meta.json`

The browser loads **one image**, so there are no remote map tile requests during the demo.

## 4. (Optional) Build algorithm-ready terrain arrays

After downloading the DEM:

```bash
python scripts/preprocess_dem.py
```

This produces:

- `data/processed/dem.npy`
- `data/processed/slope_deg.npy`
- `data/processed/terrain_meta.json`

The default algorithm grid is 5 m/cell and covers the same 12 km × 12 km mission region.

## 5. Run the local viewer

From the project root:

```bash
python3 -m http.server 8000
```

Open:

http://localhost:8000/web/

## Coordinate contract for REDLINE

The frontend uses a local Cartesian frame centered on Bradbury Landing:

- `(0, 0)` = Bradbury Landing
- `+x` = east
- `+y` = north
- units = meters

Your teammate can update the returnability envelope with:

```js
window.REDLINE.setEnvelope([
  {x_m: -800, y_m:  500},
  {x_m:  100, y_m: 1200},
  {x_m: 1100, y_m:  400},
  {x_m:  900, y_m: -700},
  {x_m: -600, y_m: -900}
]);
```

Move the astronaut with:

```js
window.REDLINE.setAstronaut(120, -45);
```

Later, the same functions can be called from WebSocket/API updates.

## Why this architecture

The visual map is static mission data and should not depend on internet availability during a live demo.
The returnability envelope is dynamic and remains a lightweight vector overlay.

The DEM is kept separately as numeric terrain data so the routing algorithm can operate on actual elevation/slope values without coupling itself to the visual basemap.

## Terrain preprocessing and viewer

Run `source .venv/bin/activate && python scripts/preprocess_dem.py` from the project root. The script reads the DEM in its native projected Mars CRS and creates a Bradbury-centered 12 km × 12 km, 5 m grid in `data/processed/`. Cell centers are at `left + (column + 0.5) * 5` east and `top - (row + 0.5) * 5` north. Invalid cells have NaN elevation and slope; the validity mask is saved separately. Slope uses valid cardinal neighbors only. Relative elevation uses the exact DEM sample at Bradbury (−4501.0283 m).

The viewer loads a 20 m sample grid from `web/terrain.bin` (2.88 MB) for cursor readouts and optional elevation/slope tints. It does not download the full routing grid. Serve the `web/` directory over HTTP, for example `python -m http.server 8000 -d web`, then open `http://localhost:8000`.

Browser integration API: `REDLINE.setAstronaut(east_m, north_m)`, `REDLINE.setEnvelope([{x_m, y_m}, ...])`, `REDLINE.terrainAt(east_m, north_m)` (returns `{elevation, slope}` or `null`), and `REDLINE.setTerrainOverlay('none' | 'elevation' | 'slope')`. The 5 m arrays are the authoritative terrain inputs for future routing; no travel or physiological cost model is encoded yet.
