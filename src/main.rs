//! Runnable demo: build a coarse route graph from the browser terrain grid,
//! plan a return-safe science route, and either write `web/plan.json` or serve
//! the viewers plus a live replanning API.
//!
//! Run `cargo run --release -- --serve` to start the simulator. The 3D viewer
//! then posts hazards to `/api/plan` and the Rust planner recomputes the route,
//! the resource profile, and the return-safe region from the astronaut's
//! current position.
//!
//! This is deliberately a demo cost model. Replace `terrain_cost` with the
//! prediction layer's actual physiology/vehicle model when it is available.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nasa_hackathon::{
    PlannerConfig, Position, ResourceVector, Returnability, RiskCosts, RiskLevel, RiskValues,
    RouteGraph, ScienceStop, plan_mission,
};
use serde::Deserialize;
use serde_json::{Value, json};

const STRIDE: usize = 10; // 20 m browser cells -> 200 m planning cells
const EPS: f64 = 1.0e-9;
const MAX_HAZARD_SEVERITY: f64 = 2.0;

const TOTAL_RESOURCES: ResourceVector = ResourceVector::new(32_000.0, 30.0, 900.0, 16.0);
const RESERVE: ResourceVector = ResourceVector::new(6_0.0, 5.0, 150.0, 2.5);

const SITE_RADIUS_M: f64 = 4_200.0;
const SITE_MIN_DISTANCE_M: f64 = 700.0;
const SITE_MIN_SPACING_M: f64 = 750.0;
const SITE_MAX_SLOPE_DEG: f64 = 15.0;
const SITE_COUNT: usize = 10;

const NEIGHBOURS: [(isize, isize); 8] = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
];

/// Static terrain data and the hazard-free edge skeleton.
struct Terrain {
    left_m: f64,
    top_m: f64,
    cell_m: f64,
    width: usize,
    height: usize,
    valid: Vec<bool>,
    elevation: Vec<f64>,
    relief_m: Vec<f64>,
    slope_deg: Vec<f64>,
    positions: Vec<Position>,
    edges: Vec<BaseEdge>,
}

#[derive(Clone, Copy)]
struct BaseEdge {
    from: usize,
    to: usize,
    distance_m: f64,
    slope_deg: f64,
}

impl Terrain {
    fn load(web: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let meta: Value = serde_json::from_slice(&fs::read(web.join("terrain_meta.json"))?)?;
        let browser = &meta["browser"];

        let sample_left = browser["local_left_m"].as_f64().unwrap();
        let sample_top = browser["local_top_m"].as_f64().unwrap();
        let sample_cell = browser["cell_size_m"].as_f64().unwrap();
        let sample_width = browser["width_cells"].as_u64().unwrap() as usize;
        let sample_height = browser["height_cells"].as_u64().unwrap() as usize;

        let raw = fs::read(web.join("terrain.bin"))?;
        if raw.len() != sample_width * sample_height * 8 {
            return Err("terrain.bin has an unexpected size".into());
        }
        let sample = |row: usize, col: usize| -> Option<(f64, f64)> {
            let offset = (row * sample_width + col) * 8;
            let elevation = f32::from_le_bytes(raw[offset..offset + 4].try_into().unwrap()) as f64;
            let slope = f32::from_le_bytes(raw[offset + 4..offset + 8].try_into().unwrap()) as f64;
            (elevation.is_finite() && slope.is_finite()).then_some((elevation, slope))
        };

        let width = sample_width / STRIDE;
        let height = sample_height / STRIDE;
        let cell_m = sample_cell * STRIDE as f64;
        let left_m = sample_left;
        let top_m = sample_top;
        let node = |row: usize, col: usize| row * width + col;

        let mut valid = vec![false; width * height];
        let mut slope_deg = vec![0.0; width * height];
        let mut elevation = vec![f64::NAN; width * height];
        let mut positions = vec![Position::new(0.0, 0.0); width * height];

        for row in 0..height {
            for col in 0..width {
                let id = node(row, col);
                positions[id] = Position::new(
                    left_m + (col as f64 + 0.5) * cell_m,
                    top_m - (row as f64 + 0.5) * cell_m,
                );
                let sample_row = (row * STRIDE + STRIDE / 2).min(sample_height - 1);
                let sample_col = (col * STRIDE + STRIDE / 2).min(sample_width - 1);
                if let Some((height_m, slope)) = sample(sample_row, sample_col) {
                    valid[id] = true;
                    slope_deg[id] = slope;
                    elevation[id] = height_m;
                }
            }
        }

        let mut relief_m = vec![0.0; width * height];
        for row in 0..height {
            for col in 0..width {
                let id = node(row, col);
                if !valid[id] {
                    continue;
                }
                let mut low = f64::INFINITY;
                let mut high = f64::NEG_INFINITY;
                for d_row in -2..=2 {
                    for d_col in -2..=2 {
                        let r = row as isize + d_row;
                        let c = col as isize + d_col;
                        if r < 0 || c < 0 || r >= height as isize || c >= width as isize {
                            continue;
                        }
                        let neighbour = node(r as usize, c as usize);
                        if valid[neighbour] {
                            low = low.min(elevation[neighbour]);
                            high = high.max(elevation[neighbour]);
                        }
                    }
                }
                relief_m[id] = high - low;
            }
        }
        let mut edges = Vec::new();
        for row in 0..height {
            for col in 0..width {
                let from = node(row, col);
                if !valid[from] {
                    continue;
                }
                for (d_row, d_col) in NEIGHBOURS {
                    let next_row = row as isize + d_row;
                    let next_col = col as isize + d_col;
                    if next_row < 0
                        || next_col < 0
                        || next_row >= height as isize
                        || next_col >= width as isize
                    {
                        continue;
                    }
                    let to = node(next_row as usize, next_col as usize);
                    if !valid[to] {
                        continue;
                    }
                    let distance_m = if d_row == 0 || d_col == 0 {
                        cell_m
                    } else {
                        cell_m * std::f64::consts::SQRT_2
                    };
                    edges.push(BaseEdge {
                        from,
                        to,
                        distance_m,
                        slope_deg: (slope_deg[from] + slope_deg[to]) * 0.5,
                    });
                }
            }
        }
        Ok(Self {
            left_m,
            top_m,
            cell_m,
            width,
            height,
            valid,
            elevation,
            relief_m,
            slope_deg,
            positions,
            edges,
        })
    }

    /// Rebuilds the directed graph with hazard multipliers applied to every
    /// edge. Hazards are circles in local metres; the multiplier at an edge is
    /// sampled at its midpoint and falls off linearly toward the rim.
    fn graph(&self, hazards: &[Hazard]) -> Result<RouteGraph, String> {
        let mut graph = RouteGraph::new(self.width * self.height);
        for (id, position) in self.positions.iter().enumerate() {
            graph
                .set_position(id, *position)
                .map_err(|error| error.to_string())?;
        }
        for edge in &self.edges {
            let base = terrain_cost(edge.distance_m, edge.slope_deg);
            let from = self.positions[edge.from];
            let to = self.positions[edge.to];
            let midpoint = Position::new((from.x_m + to.x_m) * 0.5, (from.y_m + to.y_m) * 0.5);
            let multiplier = hazard_multiplier(hazards, midpoint.x_m, midpoint.y_m);
            let costs = apply_multiplier(base, multiplier);
            graph
                .add_edge(edge.from, edge.to, costs)
                .map_err(|error| error.to_string())?;
        }
        Ok(graph)
    }
    fn nearest_node(&self, x_m: f64, y_m: f64) -> Option<usize> {
        let mut best = None;
        let mut best_distance = f64::INFINITY;
        for (id, position) in self.positions.iter().enumerate() {
            if !self.valid[id] {
                continue;
            }
            let distance = (position.x_m - x_m).hypot(position.y_m - y_m);
            if distance + EPS < best_distance {
                best_distance = distance;
                best = Some(id);
            }
        }
        best
    }
}

#[derive(Clone, Copy, Debug)]
struct Activity {
    code: &'static str,
    label: &'static str,
    value: f64,
    time_s: f64,
    oxygen: f64,
    rover_power: f64,
    equipment_power: f64,
}

const ACTIVITIES: [Activity; 5] = [
    Activity {
        code: "stratigraphy",
        label: "Layered outcrop",
        value: 14.0,
        time_s: 700.0,
        oxygen: 0.55,
        rover_power: 7.5,
        equipment_power: 0.12,
    },
    Activity {
        code: "clay_basin",
        label: "Clay-bearing basin",
        value: 12.5,
        time_s: 620.0,
        oxygen: 0.48,
        rover_power: 5.0,
        equipment_power: 0.18,
    },
    Activity {
        code: "vein_survey",
        label: "Fracture and vein survey",
        value: 9.5,
        time_s: 480.0,
        oxygen: 0.38,
        rover_power: 4.5,
        equipment_power: 0.14,
    },
    Activity {
        code: "overlook",
        label: "Ridge overlook",
        value: 7.5,
        time_s: 420.0,
        oxygen: 0.30,
        rover_power: 3.5,
        equipment_power: 0.08,
    },
    Activity {
        code: "regolith",
        label: "Regolith sample",
        value: 6.0,
        time_s: 340.0,
        oxygen: 0.25,
        rover_power: 3.0,
        equipment_power: 0.10,
    },
];

#[derive(Clone, Debug)]
struct Site {
    id: usize,
    node: usize,
    x_m: f64,
    y_m: f64,
    activity: Activity,
    value: f64,
    confidence: f64,
}

impl Site {
    fn reward(&self) -> f64 {
        self.value * self.confidence
    }

    fn visit_costs(&self) -> RiskCosts {
        let base = ResourceVector::new(
            self.activity.time_s,
            self.activity.oxygen,
            self.activity.rover_power,
            self.activity.equipment_power,
        );
        RiskCosts::new(base, base.scale(1.25), base.scale(2.0))
    }

    fn json(&self, selected: bool) -> Value {
        let round = |value: f64| (value * 100.0).round() / 100.0;
        json!({
            "id": self.id,
            "label": self.activity.label,
            "activity": self.activity.code,
            "x_m": self.x_m,
            "y_m": self.y_m,
            "reward": round(self.reward()),
            "confidence": round(self.confidence),
            "visit": resources_json(self.visit_costs().at(RiskLevel::Neutral)),
            "selected": selected,
        })
    }
}

const DEFAULT_SEED: u64 = 191289738;

fn random_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos() as u64 & 0x7fff_ffff)
        .unwrap_or(0x5eed_1e55)
}

fn seed_from_args(args: &[String]) -> u64 {
    if let Some(index) = args.iter().position(|arg| arg == "--seed") {
        if let Some(value) = args.get(index + 1) {
            if value == "random" {
                return random_seed();
            }
            if let Ok(seed) = value.parse() {
                return seed;
            }
        }
    }
    if let Ok(value) = std::env::var("REDLINE_SEED") {
        if value == "random" {
            return random_seed();
        }
        if let Ok(seed) = value.parse() {
            return seed;
        }
    }
    DEFAULT_SEED
}

fn split_mix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn unit(state: &mut u64) -> f64 {
    (split_mix(state) >> 11) as f64 / (1u64 << 53) as f64
}

fn between(state: &mut u64, low: f64, high: f64) -> f64 {
    low + (high - low) * unit(state)
}

fn quantile(pool: &[usize], value: impl Fn(usize) -> f64, fraction: f64) -> f64 {
    let mut values = pool.iter().map(|&id| value(id)).collect::<Vec<_>>();
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if values.is_empty() {
        return 0.0;
    }
    let index = ((values.len() - 1) as f64 * fraction).round() as usize;
    values[index]
}

fn generate_sites(terrain: &Terrain, seed: u64) -> Vec<Site> {
    let pool = (0..terrain.width * terrain.height)
        .filter(|&id| {
            if !terrain.valid[id] || terrain.slope_deg[id] > SITE_MAX_SLOPE_DEG {
                return false;
            }
            let position = terrain.positions[id];
            let distance = position.x_m.hypot(position.y_m);
            (SITE_MIN_DISTANCE_M..=SITE_RADIUS_M).contains(&distance)
        })
        .collect::<Vec<_>>();
    if pool.is_empty() {
        return Vec::new();
    }

    let slope_mid = quantile(&pool, |id| terrain.slope_deg[id], 0.5);

    let mut state = seed;
    let mut chosen: Vec<usize> = Vec::new();
    for _ in 0..4_000 {
        if chosen.len() == SITE_COUNT {
            break;
        }
        let node = pool[(split_mix(&mut state) % pool.len() as u64) as usize];
        let position = terrain.positions[node];
        let spaced = chosen.iter().all(|&other| {
            let other_position = terrain.positions[other];
            (position.x_m - other_position.x_m).hypot(position.y_m - other_position.y_m)
                >= SITE_MIN_SPACING_M
        });
        if spaced {
            chosen.push(node);
        }
    }

    let mut activities = vec![None; chosen.len()];
    let order = |key: &dyn Fn(usize) -> f64, descending: bool| {
        let mut indices = (0..chosen.len()).collect::<Vec<_>>();
        indices.sort_by(|a, b| {
            let left = key(chosen[*a]);
            let right = key(chosen[*b]);
            if descending {
                right.partial_cmp(&left)
            } else {
                left.partial_cmp(&right)
            }
            .unwrap_or(std::cmp::Ordering::Equal)
        });
        indices
    };
    let mut claim = |indices: Vec<usize>, count: usize, activity: Activity| {
        let mut taken = 0;
        for index in indices {
            if taken == count {
                break;
            }
            if activities[index].is_none() {
                activities[index] = Some(activity);
                taken += 1;
            }
        }
    };

    let mut quotas = [2usize; ACTIVITIES.len()];
    let mut shuffled = [0usize, 1, 2, 3, 4];
    for index in (1..shuffled.len()).rev() {
        let swap = (split_mix(&mut state) % (index as u64 + 1)) as usize;
        shuffled.swap(index, swap);
    }
    quotas[shuffled[0]] = 3;
    quotas[shuffled[4]] = 1;

    claim(
        order(&|node| terrain.relief_m[node], true),
        quotas[0],
        ACTIVITIES[0],
    );
    claim(
        order(&|node| terrain.elevation[node], true),
        quotas[3],
        ACTIVITIES[3],
    );
    let mut low_flats = order(&|node| terrain.elevation[node], false);
    low_flats.retain(|index| terrain.slope_deg[chosen[*index]] <= slope_mid);
    claim(low_flats, quotas[1], ACTIVITIES[1]);
    claim(
        order(&|node| terrain.relief_m[node], false),
        quotas[4],
        ACTIVITIES[4],
    );
    claim(
        order(&|node| terrain.elevation[node], false),
        quotas[2],
        ACTIVITIES[2],
    );
    for slot in activities.iter_mut() {
        if slot.is_none() {
            *slot = Some(ACTIVITIES[2]);
        }
    }

    chosen
        .into_iter()
        .zip(activities)
        .enumerate()
        .map(|(index, (node, activity))| {
            let activity = activity.expect("every site receives an activity");
            let position = terrain.positions[node];
            Site {
                id: index + 1,
                node,
                x_m: position.x_m,
                y_m: position.y_m,
                activity,
                value: activity.value * between(&mut state, 0.88, 1.14),
                confidence: between(&mut state, 0.62, 0.95),
            }
        })
        .collect()
}

fn science_sites(
    terrain: &Terrain,
    request: &PlanRequest,
) -> Result<(u64, Vec<Site>, Vec<usize>), String> {
    let seed = request.seed.unwrap_or_default();
    let sites = generate_sites(terrain, seed);
    let selected = match &request.site_ids {
        Some(ids) => {
            let mut seen = Vec::new();
            for &id in ids {
                if !sites.iter().any(|site| site.id == id) {
                    return Err(format!("unknown science site {id} for seed {seed}"));
                }
                if !seen.contains(&id) {
                    seen.push(id);
                }
            }
            seen
        }
        None => sites.iter().map(|site| site.id).collect(),
    };
    Ok((seed, sites, selected))
}

#[derive(Clone, Debug, Deserialize)]
struct Hazard {
    x_m: f64,
    y_m: f64,
    radius_m: f64,
    #[serde(default = "default_hazard_kind")]
    kind: String,
    #[serde(default = "default_severity")]
    severity: f64,
}

fn default_hazard_kind() -> String {
    "dust".to_string()
}

fn default_severity() -> f64 {
    1.0
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct PointRequest {
    x_m: f64,
    y_m: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct SpentRequest {
    time_s: f64,
    oxygen: f64,
    rover_power: f64,
    equipment_power: f64,
}

impl SpentRequest {
    fn to_vector(self) -> Option<ResourceVector> {
        let values = [
            self.time_s,
            self.oxygen,
            self.rover_power,
            self.equipment_power,
        ];
        if values
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return None;
        }
        Some(ResourceVector::from_components(values))
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
struct PlanRequest {
    #[serde(default)]
    hazards: Vec<Hazard>,
    #[serde(default)]
    seed: Option<u64>,
    #[serde(default)]
    site_ids: Option<Vec<usize>>,
    #[serde(default)]
    start: Option<PointRequest>,
    #[serde(default)]
    spent_before: Option<SpentRequest>,
    #[serde(default)]
    elapsed_s: f64,
    #[serde(default)]
    visited_stop_ids: Vec<usize>,
    #[serde(default)]
    risk: Option<String>,
    #[serde(default)]
    objective: Option<String>,
}

fn resolve_web_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("REDLINE_WEB_DIR") {
        return PathBuf::from(dir);
    }
    let local = PathBuf::from("redline_local_map").join("web");
    if local.exists() {
        return local;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("redline_local_map")
        .join("web")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let web = resolve_web_dir();
    let terrain = Terrain::load(&web)?;

    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let seed = seed_from_args(&args);
    let request = PlanRequest {
        seed: Some(seed),
        ..PlanRequest::default()
    };
    if let Some(index) = args.iter().position(|arg| arg == "--serve") {
        let port = args
            .get(index + 1)
            .and_then(|value| value.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|v| v.parse().ok()))
            .unwrap_or(8000);
        let plan = build_plan(&terrain, &request).map_err(Box::<dyn std::error::Error>::from)?;
        fs::write(web.join("plan.json"), serde_json::to_vec_pretty(&plan)?)?;
        print_plan_summary(&plan);
        println!();
        println!("3D mission simulation: http://localhost:{port}/");
        println!("Live replanning API:   POST http://localhost:{port}/api/plan");
        println!("Science site API:      GET  http://localhost:{port}/api/sites?seed={seed}");
        println!("Reproduce this site set with REDLINE_SEED={seed} ./run_demo.sh");
        println!("Press Ctrl-C to stop.");
        serve(Arc::new(terrain), web, port)?;
        return Ok(());
    }

    let plan = build_plan(&terrain, &request).map_err(Box::<dyn std::error::Error>::from)?;
    fs::write(web.join("plan.json"), serde_json::to_vec_pretty(&plan)?)?;
    println!("Wrote {}", web.join("plan.json").display());
    print_plan_summary(&plan);
    Ok(())
}

fn print_plan_summary(plan: &Value) {
    let mission = &plan["mission"];
    let stops = plan["stops"].as_array().map(Vec::len).unwrap_or(0);
    let route_points = plan["route"].as_array().map(Vec::len).unwrap_or(0);
    println!(
        "Planning grid: {} x {} cells at {:.0} m; {} valid cells",
        mission["grid_width"].as_u64().unwrap_or(0),
        mission["grid_height"].as_u64().unwrap_or(0),
        mission["grid_cell_m"].as_f64().unwrap_or(0.0),
        mission["valid_cells"].as_u64().unwrap_or(0)
    );
    println!(
        "Visited stops: {}; reward {:.1}; route points {}; duration {:.0} s",
        mission["stop_ids"]
            .as_array()
            .map(|ids| {
                let ids = ids
                    .iter()
                    .filter_map(Value::as_u64)
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("[{ids}]")
            })
            .unwrap_or_else(|| "[]".to_string()),
        mission["reward"].as_f64().unwrap_or(0.0),
        route_points,
        mission["duration_s"].as_f64().unwrap_or(0.0)
    );
    println!(
        "Resources used: time {:.0} s, O2 {:.2}, rover {:.1}, equipment {:.2}",
        mission["used"]["time_s"].as_f64().unwrap_or(0.0),
        mission["used"]["oxygen"].as_f64().unwrap_or(0.0),
        mission["used"]["rover_power"].as_f64().unwrap_or(0.0),
        mission["used"]["equipment_power"].as_f64().unwrap_or(0.0)
    );
    println!(
        "Science seed {}: {} of {} candidate sites selected",
        mission["seed"].as_u64().unwrap_or(0),
        mission["stop_ids"].as_array().map(Vec::len).unwrap_or(0),
        mission["sites_total"].as_u64().unwrap_or(0)
    );
    println!("Route stops: {stops} rendered stop markers");
}

/// Plans from the requested start position with the requested resource state,
/// excluding already-visited science stops. The returned JSON has the same
/// schema as `plan.json`, so the viewer applies it with `REDLINE.setPlan`.
fn build_plan(terrain: &Terrain, request: &PlanRequest) -> Result<Value, String> {
    for hazard in &request.hazards {
        if !hazard.x_m.is_finite()
            || !hazard.y_m.is_finite()
            || !hazard.radius_m.is_finite()
            || hazard.radius_m <= 0.0
            || !hazard.severity.is_finite()
        {
            return Err("hazards require finite positions and a positive radius".into());
        }
    }

    let spent_before = match request.spent_before {
        Some(spent) => spent
            .to_vector()
            .ok_or("spent_before must contain finite, non-negative resources")?,
        None => ResourceVector::ZERO,
    };
    if !spent_before.fits_within(TOTAL_RESOURCES) {
        return Err("spent_before exceeds the mission resource totals".into());
    }
    let available = TOTAL_RESOURCES.minus(spent_before);
    let elapsed_before = request.elapsed_s.max(0.0);

    let graph = terrain.graph(&request.hazards)?;

    let home = terrain
        .nearest_node(0.0, 0.0)
        .ok_or("the DEM has no valid cell near Bradbury Landing")?;
    let start = match request.start {
        Some(point) => terrain
            .nearest_node(point.x_m, point.y_m)
            .ok_or("no valid planning cell near the requested start")?,
        None => home,
    };
    let safehouses = vec![home];

    let (seed, sites, selected) = science_sites(terrain, request)?;
    let mut stops = Vec::new();
    for site in &sites {
        if !selected.contains(&site.id) || request.visited_stop_ids.contains(&site.id) {
            continue;
        }
        if site.node == start {
            continue;
        }
        stops.push(ScienceStop {
            id: site.id,
            node: site.node,
            expected_value: RiskValues::new(site.value, site.value, site.value * 0.8),
            confidence: site.confidence,
            visit_costs: site.visit_costs(),
        });
    }

    let risk = parse_risk(request.risk.as_deref())?;
    let (objective_label, path_weights) = parse_objective(request.objective.as_deref())?;

    let config = PlannerConfig {
        risk,
        return_risk: RiskLevel::Pessimistic,
        path_weights,
        beam_width: 32,
        max_stops: stops.len(),
        max_labels_per_leg: 256,
    };

    let plan = plan_mission(
        &graph,
        start,
        &safehouses,
        &stops,
        available,
        RESERVE,
        config,
    )
    .map_err(|error| format!("planner could not find a safe route: {error}"))?;
    let safety = Returnability::compute(&graph, &safehouses, RiskLevel::Pessimistic)
        .map_err(|error| format!("returnability failed: {error}"))?;

    // Stops are visited in plan order. Walk the route once so each stop gets
    // the route index at which the astronaut actually arrives.
    let mut visited = Vec::new();
    let mut cursor = 0;
    for &id in &plan.stop_ids {
        let stop = stops
            .iter()
            .find(|stop| stop.id == id)
            .expect("plan stop IDs come from the stop list");
        let arrive_index = (cursor..plan.route_nodes.len())
            .find(|&index| plan.route_nodes[index] == stop.node)
            .ok_or("a visited stop is missing from the route")?;
        visited.push((stop, arrive_index));
        cursor = arrive_index;
    }

    // Reconstruct the segment's cumulative travel cost. Outbound legs use the
    // travel forecast and the leg home uses the return forecast, matching the
    // planner's own resource accounting.
    let last_stop_index = visited.last().map(|(_, index)| *index).unwrap_or(0);
    let mut travel = graph
        .path_costs(&plan.route_nodes[..=last_stop_index], config.risk)
        .ok_or("the planned outbound route contains a gap")?;
    let home_costs = graph
        .path_costs(&plan.route_nodes[last_stop_index..], config.return_risk)
        .ok_or("the planned return route contains a gap")?;
    let outbound_last = *travel.last().expect("travel always contains the start");
    for cost in &home_costs[1..] {
        travel.push(outbound_last.plus(*cost));
    }
    debug_assert_eq!(travel.len(), plan.route_nodes.len());

    // Segment spend per route point = travel + visit costs of stops already
    // reached. This drives the safe-region frames and the segment duration.
    let mut segment_spent = travel.clone();
    for (stop, arrive_index) in &visited {
        let visit = stop.visit_costs.at(config.risk);
        for point in segment_spent.iter_mut().skip(*arrive_index) {
            *point = point.plus(visit);
        }
    }
    let duration_s = segment_spent
        .last()
        .map(|value| value.time_s)
        .unwrap_or(0.0);

    let route = plan
        .route_nodes
        .iter()
        .enumerate()
        .map(|(index, &node)| {
            let position = graph
                .position(node)
                .expect("every graph node has a position");
            json!({
                "x_m": position.x_m,
                "y_m": position.y_m,
                "t": elapsed_before + travel[index].time_s,
                "spent": resources_json(spent_before.plus(travel[index])),
            })
        })
        .collect::<Vec<_>>();

    let rendered_stops = visited
        .iter()
        .map(|(stop, arrive_index)| {
            let position = graph.position(stop.node).expect("stop node has a position");
            json!({
                "id": stop.id,
                "label": format!("S{}", stop.id),
                "x_m": position.x_m,
                "y_m": position.y_m,
                "arrive_index": arrive_index,
                "reward": stop.reward(config.risk),
                "visit": resources_json(stop.visit_costs.at(config.risk)),
            })
        })
        .collect::<Vec<_>>();

    let start_position = graph.position(start).expect("start node has a position");
    let usable = available.minus(RESERVE);
    let cell_count = terrain.width * terrain.height;
    let frames = safe_region_frames(&safety, cell_count, &segment_spent, usable);
    let final_mask = frames
        .last()
        .map(|frame| frame.mask.clone())
        .unwrap_or_else(|| vec![false; cell_count]);

    Ok(json!({
        "route": route,
        "stops": rendered_stops,
        "safe_region": {
            "left_m": terrain.left_m,
            "top_m": terrain.top_m,
            "cell_size_m": terrain.cell_m,
            "width": terrain.width,
            "height": terrain.height,
            "cells": final_mask.iter().map(|cell| u8::from(*cell)).collect::<Vec<_>>(),
        },
        "safe_region_frames": frames
            .iter()
            .map(|frame| json!({
                "t": frame.fraction,
                "cells": pack_bits(&frame.mask),
                "ratios": bytes_to_hex(&frame.ratios),
            }))
            .collect::<Vec<_>>(),
        "mission": {
            "reward": plan.expected_reward,
            "duration_s": duration_s,
            "end_time_s": elapsed_before + duration_s,
            "risk": risk_label(plan.risk),
            "return_risk": risk_label(plan.return_risk),
            "objective": objective_label,
            "stop_ids": plan.stop_ids,
            "stops_visited": plan.stop_ids.len(),
            "stops_total": request
                .visited_stop_ids
                .iter()
                .filter(|id| selected.contains(id))
                .count()
                + plan.stop_ids.len(),
            "sites_total": sites.len(),
            "sites_selected": selected.len(),
            "seed": seed,
            "resources": resources_json(TOTAL_RESOURCES),
            "reserve": resources_json(RESERVE),
            "spent_before": resources_json(spent_before),
            "elapsed_before": elapsed_before,
            "used": resources_json(plan.resources_used),
            "remaining": resources_json(plan.resources_remaining),
            "hazards": request.hazards.len(),
            "grid_width": terrain.width,
            "grid_height": terrain.height,
            "grid_cell_m": terrain.cell_m,
            "valid_cells": terrain.valid.iter().filter(|valid| **valid).count(),
        },
        "science": {
            "seed": seed,
            "selected": selected,
            "sites": sites.iter().map(|site| {
                site.json(selected.contains(&site.id))
            }).collect::<Vec<_>>(),
        },
        "astronaut": {"x_m": start_position.x_m, "y_m": start_position.y_m},
    }))
}

/// Multiplicative edge cost pressure from every hazard covering a point.
/// Dust slows travel and raises oxygen/equipment draw; bad terrain is much
/// harder on the rover and only moderately harder on life support.
fn hazard_multiplier(hazards: &[Hazard], x_m: f64, y_m: f64) -> [f64; 4] {
    let mut multiplier = [1.0; 4];
    for hazard in hazards {
        if hazard.radius_m <= 0.0 {
            continue;
        }
        let distance = (x_m - hazard.x_m).hypot(y_m - hazard.y_m);
        if distance >= hazard.radius_m {
            continue;
        }
        let falloff =
            (1.0 - distance / hazard.radius_m) * hazard.severity.clamp(0.0, MAX_HAZARD_SEVERITY);
        if hazard.kind.eq_ignore_ascii_case("terrain") {
            multiplier[0] *= 1.0 + 2.4 * falloff;
            multiplier[1] *= 1.0 + 1.1 * falloff;
            multiplier[2] *= 1.0 + 4.0 * falloff;
            multiplier[3] *= 1.0 + 0.9 * falloff;
        } else {
            multiplier[0] *= 1.0 + 3.2 * falloff;
            multiplier[1] *= 1.0 + 2.2 * falloff;
            multiplier[2] *= 1.0 + 1.4 * falloff;
            multiplier[3] *= 1.0 + 2.2 * falloff;
        }
    }
    multiplier
}

fn apply_multiplier(costs: RiskCosts, multiplier: [f64; 4]) -> RiskCosts {
    RiskCosts::new(
        scale_resources(costs.optimistic, multiplier),
        scale_resources(costs.neutral, multiplier),
        scale_resources(costs.pessimistic, multiplier),
    )
}

fn scale_resources(value: ResourceVector, multiplier: [f64; 4]) -> ResourceVector {
    let components = value.components();
    ResourceVector::from_components(std::array::from_fn(|index| {
        components[index] * multiplier[index]
    }))
}

/// One precomputed return-safe region and utilization field along the segment timeline.
struct SafeFrame {
    fraction: f64,
    mask: Vec<bool>,
    ratios: Vec<u8>,
}

/// Samples the reserve-safe return region and normalized cost ratio along the
/// segment so the viewer can animate multi-band isochrones continuously.
fn safe_region_frames(
    safety: &Returnability,
    cell_count: usize,
    spent: &[ResourceVector],
    resources: ResourceVector,
) -> Vec<SafeFrame> {
    const FRAME_COUNT: usize = 45;
    let duration = spent.last().map(|value| value.time_s).unwrap_or(0.0);
    let mut frames: Vec<SafeFrame> = Vec::new();
    for index in 0..FRAME_COUNT {
        let fraction = if FRAME_COUNT == 1 {
            0.0
        } else {
            index as f64 / (FRAME_COUNT - 1) as f64
        };
        let spent_now = sample_spent(spent, duration * fraction);
        let remaining = resources.minus(spent_now);
        let (mask, ratios) = return_field(safety, cell_count, remaining);
        match frames.last() {
            Some(previous) if previous.mask == mask && previous.ratios == ratios => {}
            _ => frames.push(SafeFrame {
                fraction,
                mask,
                ratios,
            }),
        }
    }
    frames
}

/// Computes the binary return-safe mask and quantized bottleneck return-cost ratio
/// (`0..=200` for `0%..=100%` of `remaining`; `201..=255` for over-budget or unreachable).
fn return_field(
    safety: &Returnability,
    cell_count: usize,
    remaining: ResourceVector,
) -> (Vec<bool>, Vec<u8>) {
    let rem = remaining.components();
    let mut mask = vec![false; cell_count];
    let mut ratios = vec![255u8; cell_count];
    for node in 0..cell_count {
        let frontier = safety.return_frontier(node);
        if frontier.is_empty() {
            continue;
        }
        let mut safe = false;
        let mut best_ratio = f64::INFINITY;
        for cost in frontier {
            if cost.fits_within(remaining) {
                safe = true;
            }
            let comp = cost.components();
            let ratio = (0..4)
                .map(|i| {
                    if comp[i] <= 0.0 {
                        0.0
                    } else if rem[i] <= 0.0 {
                        f64::INFINITY
                    } else {
                        comp[i] / rem[i]
                    }
                })
                .fold(0.0_f64, f64::max);
            if ratio < best_ratio {
                best_ratio = ratio;
            }
        }
        mask[node] = safe;
        ratios[node] = if safe {
            (best_ratio * 200.0).round().clamp(0.0, 200.0) as u8
        } else if best_ratio.is_finite() {
            (best_ratio * 200.0).round().clamp(201.0, 254.0) as u8
        } else {
            255
        };
    }
    (mask, ratios)
}

/// Linear interpolation of cumulative spend at a segment time.
fn sample_spent(spent: &[ResourceVector], target_s: f64) -> ResourceVector {
    let Some(first) = spent.first().copied() else {
        return ResourceVector::ZERO;
    };
    if target_s <= first.time_s {
        return first;
    }
    for pair in spent.windows(2) {
        let a = pair[0];
        let b = pair[1];
        if target_s <= b.time_s {
            let span = b.time_s - a.time_s;
            let fraction = if span > 0.0 {
                ((target_s - a.time_s) / span).clamp(0.0, 1.0)
            } else {
                0.0
            };
            return lerp_resources(a, b, fraction);
        }
    }
    spent.last().copied().unwrap_or(ResourceVector::ZERO)
}

fn lerp_resources(a: ResourceVector, b: ResourceVector, fraction: f64) -> ResourceVector {
    let a = a.components();
    let b = b.components();
    ResourceVector::from_components(std::array::from_fn(|index| {
        a[index] + (b[index] - a[index]) * fraction
    }))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;

    let mut packed = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(packed, "{byte:02x}");
    }
    packed
}

/// Packs booleans little-endian into a lowercase hex string. The viewer
/// decodes this back into the safe-region raster without a base64 dependency.
fn pack_bits(mask: &[bool]) -> String {
    let mut bytes = vec![0u8; mask.len().div_ceil(8)];
    for (index, &value) in mask.iter().enumerate() {
        if value {
            bytes[index / 8] |= 1 << (index % 8);
        }
    }
    bytes_to_hex(&bytes)
}

fn resources_json(value: ResourceVector) -> Value {
    json!({
        "time_s": value.time_s,
        "oxygen": value.oxygen,
        "rover_power": value.rover_power,
        "equipment_power": value.equipment_power,
    })
}

fn risk_label(risk: RiskLevel) -> &'static str {
    match risk {
        RiskLevel::Optimistic => "Optimistic",
        RiskLevel::Neutral => "Neutral",
        RiskLevel::Pessimistic => "Pessimistic",
    }
}

fn parse_risk(value: Option<&str>) -> Result<RiskLevel, String> {
    match value.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(RiskLevel::Neutral),
        Some(v) if v.eq_ignore_ascii_case("optimistic") => Ok(RiskLevel::Optimistic),
        Some(v) if v.eq_ignore_ascii_case("neutral") => Ok(RiskLevel::Neutral),
        Some(v) if v.eq_ignore_ascii_case("pessimistic") => Ok(RiskLevel::Pessimistic),
        Some(other) => Err(format!(
            "unknown risk '{other}'; expected optimistic, neutral, or pessimistic"
        )),
    }
}

fn parse_objective(value: Option<&str>) -> Result<(&'static str, ResourceVector), String> {
    match value.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(("fastest", ResourceVector::new(1.0, 0.0, 0.0, 0.0))),
        Some(v) if v.eq_ignore_ascii_case("fastest") => {
            Ok(("fastest", ResourceVector::new(1.0, 0.0, 0.0, 0.0)))
        }
        Some(v) if v.eq_ignore_ascii_case("oxygen") => {
            Ok(("oxygen", ResourceVector::new(0.0, 1.0, 0.0, 0.0)))
        }
        Some(v) if v.eq_ignore_ascii_case("rover") => {
            Ok(("rover", ResourceVector::new(0.0, 0.0, 1.0, 0.0)))
        }
        Some(v) if v.eq_ignore_ascii_case("equipment") => {
            Ok(("equipment", ResourceVector::new(0.0, 0.0, 0.0, 1.0)))
        }
        Some(v) if v.eq_ignore_ascii_case("balanced") => Ok((
            "balanced",
            ResourceVector::new(
                1.0 / TOTAL_RESOURCES.time_s,
                1.0 / TOTAL_RESOURCES.oxygen,
                1.0 / TOTAL_RESOURCES.rover_power,
                1.0 / TOTAL_RESOURCES.equipment_power,
            ),
        )),
        Some(other) => Err(format!(
            "unknown objective '{other}'; expected fastest, oxygen, rover, equipment, or balanced"
        )),
    }
}

/// Demo-only cost model. All resource units are arbitrary demo units.
fn terrain_cost(distance_m: f64, slope_deg: f64) -> RiskCosts {
    let slope = slope_deg.clamp(0.0, 30.0);
    let speed_m_s = (1.1 - slope / 35.0).max(0.18);
    let time_s = distance_m / speed_m_s;
    let neutral = ResourceVector::new(
        time_s,
        time_s * 0.0012,
        distance_m * (0.012 + slope * 0.0025),
        time_s * 0.00025,
    );
    RiskCosts::new(
        neutral.scale(0.8),
        neutral,
        ResourceVector::new(
            neutral.time_s * 1.35,
            neutral.oxygen * 1.35,
            neutral.rover_power * 1.5,
            neutral.equipment_power * 1.35,
        ),
    )
}

// -------------------------------------------------------------------- HTTP --

fn serve(terrain: Arc<Terrain>, web: PathBuf, port: u16) -> std::io::Result<()> {
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let listener = TcpListener::bind((host.as_str(), port))?;
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let terrain = Arc::clone(&terrain);
                let web = web.clone();
                std::thread::spawn(move || {
                    if let Err(error) = handle_connection(stream, &terrain, &web) {
                        eprintln!("connection error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("accept error: {error}"),
        }
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, terrain: &Terrain, web: &Path) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(15)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target.as_str(), ""),
    };

    if method == "GET" && path == "/api/health" {
        let payload = json!({
            "ok": true,
            "hazards": true,
            "sites": true,
            "grid_width": terrain.width,
            "grid_height": terrain.height,
            "grid_cell_m": terrain.cell_m,
        });
        return respond(
            &mut stream,
            200,
            "OK",
            "application/json",
            payload.to_string().as_bytes(),
        );
    }

    if method == "GET" && path == "/api/sites" {
        let seed = query
            .split('&')
            .find_map(|part| part.strip_prefix("seed="))
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or_else(random_seed);
        let sites = generate_sites(terrain, seed);
        let payload = json!({
            "seed": seed,
            "count": sites.len(),
            "selected": sites.iter().map(|site| site.id).collect::<Vec<_>>(),
            "sites": sites.iter().map(|site| site.json(true)).collect::<Vec<_>>(),
        });
        return respond(
            &mut stream,
            200,
            "OK",
            "application/json",
            payload.to_string().as_bytes(),
        );
    }

    if method == "POST" && path == "/api/plan" {
        let response = match serde_json::from_slice::<PlanRequest>(&body) {
            Ok(request) => match build_plan(terrain, &request) {
                Ok(plan) => (200, "OK", plan),
                Err(message) => (422, "Unprocessable Content", json!({"error": message})),
            },
            Err(error) => (
                400,
                "Bad Request",
                json!({"error": format!("invalid plan request: {error}")}),
            ),
        };
        return respond(
            &mut stream,
            response.0,
            response.1,
            "application/json",
            response.2.to_string().as_bytes(),
        );
    }

    if method != "GET" && method != "HEAD" {
        return respond(
            &mut stream,
            405,
            "Method Not Allowed",
            "text/plain",
            b"method not allowed",
        );
    }

    let mut relative = path.trim_start_matches('/');
    if relative.is_empty() {
        relative = "index.html";
    }
    if relative
        .split('/')
        .any(|part| part == ".." || part.is_empty())
    {
        return respond(&mut stream, 400, "Bad Request", "text/plain", b"bad path");
    }

    let file = web.join(relative);
    match fs::read(&file) {
        Ok(bytes) => respond(&mut stream, 200, "OK", content_type(relative), &bytes),
        Err(_) => respond(
            &mut stream,
            404,
            "Not Found",
            "text/plain",
            format!("not found: {relative}").as_bytes(),
        ),
    }
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()
}

fn content_type(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webp" => "image/webp",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "bin" | "wasm" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hazard(kind: &str, x_m: f64, y_m: f64, radius_m: f64, severity: f64) -> Hazard {
        Hazard {
            x_m,
            y_m,
            radius_m,
            kind: kind.to_string(),
            severity,
        }
    }

    #[test]
    fn hazards_outside_the_circle_leave_costs_unchanged() {
        let dust = hazard("dust", 0.0, 0.0, 1000.0, 1.0);
        assert_eq!(hazard_multiplier(&[dust], 1000.0, 0.0), [1.0; 4]);
        assert_eq!(hazard_multiplier(&[], 0.0, 0.0), [1.0; 4]);
    }

    #[test]
    fn hazard_pressure_falls_off_toward_the_rim() {
        let dust = hazard("dust", 0.0, 0.0, 1000.0, 1.0);
        let centre = hazard_multiplier(std::slice::from_ref(&dust), 0.0, 0.0);
        let near_rim = hazard_multiplier(&[dust], 900.0, 0.0);
        assert!(centre[0] > near_rim[0]);
        assert!(near_rim[0] > 1.0);
    }

    #[test]
    fn bad_terrain_hits_the_rover_harder_than_dust() {
        let dust = hazard_multiplier(&[hazard("dust", 0.0, 0.0, 1000.0, 1.0)], 0.0, 0.0);
        let terrain = hazard_multiplier(&[hazard("terrain", 0.0, 0.0, 1000.0, 1.0)], 0.0, 0.0);
        // index 2 is rover power.
        assert!(terrain[2] > dust[2]);
        // Dust is harder on life support than bad terrain.
        assert!(dust[1] > terrain[1]);
    }

    #[test]
    fn overlapping_hazards_multiply() {
        let one = hazard_multiplier(&[hazard("dust", 0.0, 0.0, 1000.0, 1.0)], 0.0, 0.0);
        let two = hazard_multiplier(
            &[
                hazard("dust", 0.0, 0.0, 1000.0, 1.0),
                hazard("dust", 0.0, 0.0, 1000.0, 1.0),
            ],
            0.0,
            0.0,
        );
        assert!((two[0] - one[0] * one[0]).abs() < 1.0e-12);
    }

    fn demo_terrain() -> Terrain {
        Terrain::load(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("redline_local_map")
                .join("web"),
        )
        .expect("demo terrain assets")
    }

    #[test]
    fn science_sites_repeat_for_the_same_seed() {
        let terrain = demo_terrain();
        let first = generate_sites(&terrain, 42);
        let second = generate_sites(&terrain, 42);
        assert_eq!(first.len(), SITE_COUNT);
        assert_eq!(
            first
                .iter()
                .map(|site| (site.id, site.node))
                .collect::<Vec<_>>(),
            second
                .iter()
                .map(|site| (site.id, site.node))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_new_seed_moves_the_site_set() {
        let terrain = demo_terrain();
        let first = generate_sites(&terrain, 42);
        let second = generate_sites(&terrain, 43);
        assert_ne!(
            first.iter().map(|site| site.node).collect::<Vec<_>>(),
            second.iter().map(|site| site.node).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sites_stay_inside_the_region_and_apart() {
        let terrain = demo_terrain();
        let sites = generate_sites(&terrain, 7);
        assert!(!sites.is_empty());
        for site in &sites {
            let distance = site.x_m.hypot(site.y_m);
            assert!((SITE_MIN_DISTANCE_M..=SITE_RADIUS_M + terrain.cell_m).contains(&distance));
            assert!(terrain.valid[site.node]);
        }
        for (index, site) in sites.iter().enumerate() {
            for other in &sites[index + 1..] {
                let gap = (site.x_m - other.x_m).hypot(site.y_m - other.y_m);
                assert!(gap >= SITE_MIN_SPACING_M);
            }
        }
    }

    #[test]
    fn selection_limits_the_planned_stops() {
        let terrain = demo_terrain();
        let sites = generate_sites(&terrain, 11);
        let chosen = vec![sites[0].id, sites[3].id];
        let request = PlanRequest {
            seed: Some(11),
            site_ids: Some(chosen.clone()),
            ..PlanRequest::default()
        };
        let plan = build_plan(&terrain, &request).expect("plan for two sites");
        let stops = plan["stops"].as_array().expect("stops");
        assert!(stops.len() <= chosen.len());
        assert!(
            plan["mission"]["stops_total"]
                .as_u64()
                .expect("stops total")
                <= 2
        );
        assert_eq!(plan["mission"]["sites_selected"].as_u64(), Some(2));
        assert_eq!(
            plan["mission"]["sites_total"].as_u64(),
            Some(sites.len() as u64)
        );
        for stop in stops {
            let id = stop["id"].as_u64().expect("stop id") as usize;
            assert!(chosen.contains(&id));
        }
    }

    #[test]
    fn unknown_site_ids_are_rejected() {
        let terrain = demo_terrain();
        let request = PlanRequest {
            seed: Some(11),
            site_ids: Some(vec![999]),
            ..PlanRequest::default()
        };
        let error = build_plan(&terrain, &request).expect_err("unknown site must fail");
        assert!(error.contains("unknown science site 999"), "{error}");
    }

    #[test]
    fn clearing_the_selection_returns_home_without_stops() {
        let terrain = demo_terrain();
        let request = PlanRequest {
            seed: Some(11),
            site_ids: Some(Vec::new()),
            ..PlanRequest::default()
        };
        let plan = build_plan(&terrain, &request).expect("plan with no sites");
        assert!(plan["stops"].as_array().expect("stops").is_empty());
        assert_eq!(plan["mission"]["stops_total"].as_u64(), Some(0));
        assert!(!plan["route"].as_array().expect("route").is_empty());
    }

    #[test]
    fn risk_and_objective_options_are_applied_and_validated() {
        let terrain = demo_terrain();
        let request = PlanRequest {
            seed: Some(11),
            risk: Some("pessimistic".to_string()),
            objective: Some("rover".to_string()),
            ..PlanRequest::default()
        };
        let plan = build_plan(&terrain, &request).expect("pessimistic rover plan");
        assert_eq!(plan["mission"]["risk"].as_str(), Some("Pessimistic"));
        assert_eq!(plan["mission"]["objective"].as_str(), Some("rover"));

        let bad_risk = PlanRequest {
            seed: Some(11),
            risk: Some("reckless".to_string()),
            ..PlanRequest::default()
        };
        assert!(build_plan(&terrain, &bad_risk).is_err());

        let bad_obj = PlanRequest {
            seed: Some(11),
            objective: Some("unknown".to_string()),
            ..PlanRequest::default()
        };
        assert!(build_plan(&terrain, &bad_obj).is_err());
    }

    #[test]
    fn safe_region_frames_emit_reserve_consistent_ratios() {
        let terrain = demo_terrain();
        let plan = build_plan(
            &terrain,
            &PlanRequest {
                seed: Some(11),
                ..PlanRequest::default()
            },
        )
        .expect("default plan builds");
        let frames = plan["safe_region_frames"]
            .as_array()
            .expect("safe_region_frames array");
        assert!(frames.len() >= 10);
        let cell_count = terrain.width * terrain.height;
        let first_ratios = frames[0]["ratios"].as_str().expect("ratios hex");
        let last_ratios = frames
            .last()
            .and_then(|frame| frame["ratios"].as_str())
            .expect("last ratios hex");
        assert_eq!(first_ratios.len(), cell_count * 2);
        assert_eq!(last_ratios.len(), cell_count * 2);

        let safe_count = |hex: &str| {
            (0..cell_count)
                .filter(|&i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap() <= 200)
                .count()
        };
        let mid_count = |hex: &str| {
            (0..cell_count)
                .filter(|&i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap() <= 100)
                .count()
        };
        assert!(mid_count(first_ratios) > mid_count(last_ratios));
        assert!(safe_count(first_ratios) >= safe_count(last_ratios));
    }
}
