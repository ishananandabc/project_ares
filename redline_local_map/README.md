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

For an offline replay of the generated `plan.json` (no live replanning):

```bash
python3 -m http.server 8000 -d redline_local_map/web
```

Open:

http://localhost:8000/3d.html

## Run the complete Rust + viewer demo

From the repository root:

```bash
./run_demo.sh
```

This builds the Rust planner, writes the default `web/plan.json`, and starts a small local server that serves both viewers plus the replanning API:

```text
3D mission simulation: http://localhost:8000/3d.html
2D map:                http://localhost:8000/
Live replanning API:   POST http://localhost:8000/api/plan
```

Set a different port with `PORT=9000 ./run_demo.sh`. To run the server directly:

```bash
cargo run --release -- --serve 8000
```

The planner uses a 200 m coarse grid for the demo (60 × 60 cells). The 5 m arrays remain the authoritative terrain inputs for production routing; this demo uses the coarse grid and the synthetic cost model.

## Science stops (S1–S5)

The five labels are candidate science targets, not waypoints the mission must visit:

| Label | Local position (E, N) | Base science value |
|---|---|---|
| S1 | (−3000, +1000) m | 8 |
| S2 | (+1500, +1500) m | 10 |
| S3 | (+1800, −1500) m | 12 |
| S4 | (−1500, −3000) m | 14 |
| S5 | (+500, +500) m | 16 |

Each stop has a confidence-weighted reward and a visit cost in time, oxygen, rover power, and equipment power. The planner picks the subset and order that maximizes reward while keeping a certified path back to the safehouse. That is why the current plan visits `[S5, S2, S3, S4, S1]` and not all five, or not in numeric order.

## 3D mission simulation

`web/3d.html` renders the plan on the 32 × 40 km Gale DEM instead of the 2D basemap. It loads `plan.json` and drapes everything onto the terrain mesh:

- **Route** — amber ribbon following elevation (not a flat line), sampled at half the DEM step.
- **Stops** — orange pins with labels; they turn green when the astronaut samples them. Their dwell time is the stop's visit cost.
- **Return-safe region** — translucent green raster over the cells where a return path fits the remaining resources. It shrinks as the mission spends oxygen and power.
- **Playback** — the astronaut marker moves along the route, pauses at each science stop, and the resource bars and HUD update from the planner's per-leg costs.
- **Hazards** — dust storms and bad terrain can be placed on the terrain at runtime. Each hazard is a circle with a radius and severity; it raises the cost of every graph edge it covers and immediately triggers a fresh plan.
- **Controls** — Play/Pause (or space), Restart, scrubber, 60×–1800× time compression, Focus route, vertical exaggeration, wireframe, top-down, and click-to-inspect terrain.

### Live hazard replanning

Choose **Dust storm** or **Bad terrain**, set a radius and severity, then click the terrain. The viewer posts the hazards to the Rust server, which:

1. rebuilds the graph with hazard cost multipliers,
2. plans from the astronaut's current position with the resources still available,
3. excludes already-visited stops but keeps their pins on the map,
4. recomputes the return-safe region for the new resource state,
5. streams the new route, stop order, and mission clock back to the viewer.

Dust increases travel time, oxygen, rover, and equipment draw. Bad terrain is much harder on the rover power and moderately harder on life support. Severity falls off linearly from the circle centre to its rim. If the remaining resources cannot certify a return path, the server rejects the plan and the viewer keeps the previous route so you can weaken or remove the hazard.

The same simulation can be driven programmatically:

```js
REDLINE.setPlan(plan);          // route + stops + safe region + mission metadata
REDLINE.setRoute(points);       // [{x_m, y_m, t, spent}]
REDLINE.setStops(stops);        // [{x_m, y_m, label, arrive_index, visit, reward}]
REDLINE.setSafeRegion(region);  // {left_m, top_m, cell_size_m, width, height, cells}
REDLINE.setHazards([{x_m: 1200, y_m: 200, radius_m: 1800, kind: 'dust', severity: 1.0}]);
REDLINE.getHazards();
REDLINE.replan('Changed the weather');
REDLINE.seek(0.5);              // jump to mission progress 0..1
REDLINE.focusRoute();
```

### Replanning API

`POST /api/plan` accepts:

```json
{
  "hazards": [
    {"x_m": 1200, "y_m": 200, "radius_m": 1800, "kind": "dust", "severity": 1.0},
    {"x_m": -3000, "y_m": 1000, "radius_m": 1200, "kind": "terrain", "severity": 0.7}
  ],
  "start": {"x_m": 1500, "y_m": 1500},
  "spent_before": {"time_s": 5000, "oxygen": 5.0, "rover_power": 100.0, "equipment_power": 1.5},
  "elapsed_s": 5000,
  "visited_stop_ids": [5, 2]
}
```

All fields are optional. With no body it returns the same default plan that is written to `plan.json`. `GET /api/health` reports whether the API is available.

The response is the full plan schema. Replanning-related fields:

- `route[i].t` — absolute mission seconds (already offset by `elapsed_s`).
- `route[i].spent` — absolute cumulative travel spend (already offset by `spent_before`).
- `mission.elapsed_before`, `mission.spent_before` — the starting state of this segment.
- `mission.duration_s` — duration of this segment, including stop visits.
- `mission.end_time_s` — projected mission clock at return.
- `mission.used` / `mission.remaining` — resources for this segment, not the whole mission.
- `safe_region_frames` — return-safe masks sampled along this segment, hex-packed, with `t` as a segment fraction.
- `mission.stops_total` — total science targets, so the HUD can show `visited / 5` across replans.

Outbound legs are costed with the travel forecast and the return leg with the return forecast, matching the planner's resource accounting. The mission clock and the resource bars remain continuous because the viewer adds the previous segment's elapsed time and spend to the new segment.

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

Browser integration API: `REDLINE.setAstronaut(east_m, north_m)`, `REDLINE.setEnvelope([{x_m, y_m}, ...])`, `REDLINE.terrainAt(east_m, north_m)` (returns `{elevation, slope}` or `null`), and `REDLINE.setTerrainOverlay('none' | 'elevation' | 'slope')`.

Route and plan rendering API:

```js
REDLINE.setRoute([{x_m: 0, y_m: 0}, {x_m: 120, y_m: 40}, ...]);
REDLINE.setStops([{x_m: 120, y_m: 40, label: "Stop 1"}, ...]);
REDLINE.setSafeRegion({
  left_m: -6000, top_m: 6000, cell_size_m: 20,
  width: 600, height: 600, cells: [0, 1, 1, 0, ...]
});

// One-call form for a plan produced by the Rust core.
REDLINE.setPlan({
  route: [{x_m: 0, y_m: 0}, ...],
  stops: [{x_m: 120, y_m: 40, label: "Stop 1"}, ...],
  safe_region: {left_m: -6000, top_m: 6000, cell_size_m: 20, width: 600, height: 600, cells: [...]},
  astronaut: {x_m: 0, y_m: 0},
  envelope: [{x_m: -800, y_m: 500}, ...]
});
```

All coordinates use the same local `(east, north)` metre frame as `terrain.bin`. `cells` is row-major from the top-left of `safe_region`, matching the DEM grid convention. The 5 m arrays are the authoritative terrain inputs for production routing; the Rust demo uses a coarse planning grid and a synthetic cost model that should be replaced by the mission cost model.

## Separate 3D terrain viewer

Run `source .venv/bin/activate && python scripts/preprocess_3d.py` from the project root after the 5 m terrain preprocessing. This creates a 32 km east–west × 40 km north–south, 801 × 1001 display mesh (`web/terrain3d.bin`), a matching 3200 × 4000 georegistered texture from the original full HiRISE mosaic (`web/hirise_registered.png`), an extended inspection grid (`web/terrain3d_query.bin`), and `web/terrain3d_meta.json`. The extent runs from local E −18 km to +14 km and N −20 km to +20 km, staying inside the DEM. HiRISE covers only its actual overlapping footprint. The original processed arrays remain the source for future routing. The 3D viewer uses local east as Three.js X, north as Three.js Z, and elevation relative to Bradbury as Three.js Y. At 1× vertical scale, all axes use metres.

Serve `web/` with `python -m http.server 8765 -d web` and open `http://localhost:8765/3d.html`. Drag to orbit, right drag to pan, scroll to zoom, and click terrain to inspect coordinates, elevation and slope. The scale control offers 1×, 2× and 5×; the latter two explicitly identify visual exaggeration. `window.REDLINE.setAstronaut(east_m,north_m)` and `window.REDLINE.setEnvelope([{x_m,y_m},...])` are available to a future planner. `window.REDLINE.terrainAt(east_m,north_m)` returns a status of `valid`, `nodata`, or `outside` plus measurements when valid. The current 2D viewer remains at `index.html`.

The HiRISE texture is sampled using the original GeoTIFF transform and internal validity mask, and has transparent pixels outside imagery coverage. Neutral DEM material shows through there. The browser mesh is visual only and is not used for routing or resource calculations. Three.js and OrbitControls are vendored under `web/vendor/` (Three.js 0.180.0).
