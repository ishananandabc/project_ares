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

## Separate 3D terrain viewer

Run `source .venv/bin/activate && python scripts/preprocess_3d.py` from the project root after the 5 m terrain preprocessing. This creates a 28 km × 28 km, 769 × 769 display mesh (`web/terrain3d.bin`), a matching 4096 × 4096 georegistered texture from the original full HiRISE mosaic (`web/hirise_registered.webp`), an extended inspection grid (`web/terrain3d_query.bin`), and `web/terrain3d_meta.json`. The DEM determines the 28 km centered extent; HiRISE covers only its actual overlapping footprint. The original processed arrays remain the source for future routing. The 3D viewer uses local east as Three.js X, north as Three.js Z, and elevation relative to Bradbury as Three.js Y. At 1× vertical scale, all axes use metres.

Serve `web/` with `python -m http.server 8765 -d web` and open `http://localhost:8765/3d.html`. Drag to orbit, right drag to pan, scroll to zoom, and click terrain to inspect coordinates, elevation and slope. The scale control offers 1×, 2× and 5×; the latter two explicitly identify visual exaggeration. `window.REDLINE.setAstronaut(east_m,north_m)` and `window.REDLINE.setEnvelope([{x_m,y_m},...])` are available to a future planner. `window.REDLINE.terrainAt(east_m,north_m)` returns a status of `valid`, `nodata`, or `outside` plus measurements when valid. The current 2D viewer remains at `index.html`.

The HiRISE texture is sampled using the original GeoTIFF transform and internal validity mask, and has transparent pixels outside imagery coverage. Neutral DEM material shows through there. The browser mesh is visual only and is not used for routing or resource calculations. Three.js and OrbitControls are vendored under `web/vendor/` (Three.js 0.180.0).
