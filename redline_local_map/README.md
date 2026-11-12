# REDLINE: Gale terrain and mission simulation

REDLINE uses a real USGS/JPL Gale DEM for the terrain and a smaller, registered HiRISE color mosaic where imagery exists. The 2D and 3D viewers load the same `web/terrain_build.json` manifest. Its visible build ID identifies the exact content-addressed assets loaded by both viewers.

## Run a cloned demo

The repository includes every browser terrain asset. No GeoTIFF download or Python setup is needed to **view** the demo:

```bash
cd project_ares
./run_demo.sh
```

Open [2D viewer](http://localhost:8000/) or [3D viewer](http://localhost:8000/3d.html). `PORT=9000 ./run_demo.sh` selects another port. The Rust server provides live hazard replanning; a static server provides offline playback with the committed `plan.json`:

```bash
python3 -m http.server 8000 -d redline_local_map/web
```

In the 3D viewer, the initial camera shows the full regional terrain. **Focus route** zooms to the mission; **Reset view** returns to the region. The panel shows the build ID, extent, and mesh resolution. The 2D viewer shows the same build ID. Select imagery, elevation, or slope tint. HiRISE covers only part of the DEM; neutral material represents DEM where that high-resolution image is unavailable. Missing DEM is empty/dark.

## Source data and rebuilding

The large original GeoTIFFs are intentionally ignored by Git. Download them only to regenerate assets:

```bash
cd redline_local_map
python3 -m venv .venv
source .venv/bin/activate
pip install numpy rasterio pillow pyproj
bash scripts/download_data.sh all
python scripts/build_terrain.py
python scripts/validate_terrain.py
```

Sources:

- [MSL Gale Merged DEM v3, 1 m](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif), local `data/raw/gale_dem_1m.tif` (~3.6 GB).
- [Gale HiRISE color mosaic, 0.25 m](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif), local `data/raw/gale_hirise_color.tif` (~1 GB).

`build_terrain.py` is the one command that rebuilds all **regional browser terrain** from these raw sources. It writes 10 m computational arrays under ignored `data/processed/` and content-addressed mesh, query, tint, hillshade, and registered HiRISE assets under `web/`. Commit `web/terrain_build.json` and every file it names, plus the viewer code. The manifest includes file hashes and byte counts; the browser checks the mesh and query hashes on load. Changing a terrain asset creates a new build ID and filenames, so an old browser cache cannot silently mix builds.

The older tracked `web/terrain.bin` and `web/terrain_meta.json` are the Rust planner's **local 12 km demo input**, generated with `python scripts/preprocess_dem.py`. They are not loaded by the 2D or 3D regional viewers. The 5 m local arrays and new 10 m regional arrays in `data/processed/` are computational data; the 50 m visualization mesh is never used for routing.

Superseded `web/terrain3d.*`, `web/hirise_registered.*`, and `web/map.*` assets remain tracked for now, but neither viewer requests them. The active assets are only those named by `web/terrain_build.json`. The older preprocessing scripts remain in the tree for compatibility; `scripts/build_terrain.py` is the regional build entrypoint.

## Terrain coordinate contract

Bradbury Landing is REDLINE `(0,0)`; +x is east, +y is north, metres. The source CRS places it at projected `(8146815.194589, -272041.224283)` m, and the original 1 m DEM sample is about `-4501.0283` m. The regional view spans **32.95 km east–west × 57.4 km north–south**: E −18,800 to +14,150 m, N −30,150 to +27,250 m. Nodata at the edges remains missing.

The Three.js frame is X=east, Z=north, Y=elevation relative to Bradbury. The 3D mesh has 660 × 1149 vertices at 50 m spacing. The 2D base, 3D mesh, browser queries, and imagery registration all derive from the same manifest. The original DEM and image have different footprints and are aligned by projected metres, never raster pixel numbers.

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

`web/3d.html` renders the plan on the 32.95 × 57.4 km Gale DEM. It loads `plan.json` and drapes everything onto the terrain mesh:

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

## Terrain API and limits

Both viewers expose `REDLINE.setAstronaut(east_m,north_m)`, `REDLINE.setEnvelope([{x_m,y_m},...])`, and `REDLINE.terrainAt(east_m,north_m)`. Terrain queries return `valid`, `nodata`, `outside_processed`, or `outside_dataset`; valid results include absolute elevation, relative elevation, slope, and imagery availability. The 2D viewer also exposes route, stop, safe-region, and tint controls. The 3D viewer preserves mission playback, hazard replanning, camera controls, and 1×/2×/5× vertical scale. At 1× all geometry axes are in metres.

The regional DEM is nearly the maximum useful rectangle inside the available 1 m source. It has genuine nodata gaps near its edges. The HiRISE mosaic is only 9 × 19 km and covers about 9% of the regional footprint. Adding detailed imagery or terrain outside these sources requires another correctly registered NASA/USGS dataset.
