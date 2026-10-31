use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use std::error::Error;
use std::fmt;

pub type NodeId = usize;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Position {
    pub x_m: f64,
    pub y_m: f64,
}
impl Position {
    pub const fn new(x_m: f64, y_m: f64) -> Self {
        Self { x_m, y_m }
    }
    fn distance(self, other: Self) -> f64 {
        (self.x_m - other.x_m).hypot(self.y_m - other.y_m)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ResourceVector {
    pub time_s: f64,
    pub oxygen: f64,
    pub rover_power: f64,
    pub equipment_power: f64,
}
impl ResourceVector {
    pub const ZERO: Self = Self {
        time_s: 0.0,
        oxygen: 0.0,
        rover_power: 0.0,
        equipment_power: 0.0,
    };
    pub const fn new(time_s: f64, oxygen: f64, rover_power: f64, equipment_power: f64) -> Self {
        Self {
            time_s,
            oxygen,
            rover_power,
            equipment_power,
        }
    }
    pub fn components(self) -> [f64; 4] {
        [
            self.time_s,
            self.oxygen,
            self.rover_power,
            self.equipment_power,
        ]
    }
    pub fn from_components(v: [f64; 4]) -> Self {
        Self {
            time_s: v[0],
            oxygen: v[1],
            rover_power: v[2],
            equipment_power: v[3],
        }
    }
    pub fn validate(self, name: &str) -> Result<(), RedlineError> {
        if self
            .components()
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err(RedlineError::InvalidInput(format!(
                "{name} resource values must be finite and non-negative"
            )));
        }
        Ok(())
    }
    pub fn fits_within(self, available: Self) -> bool {
        let a = self.components();
        let b = available.components();
        (0..4).all(|i| a[i] <= b[i])
    }
    pub fn plus(self, other: Self) -> Self {
        Self::from_components(std::array::from_fn(|i| {
            self.components()[i] + other.components()[i]
        }))
    }
    pub fn minus(self, other: Self) -> Self {
        Self::from_components(std::array::from_fn(|i| {
            self.components()[i] - other.components()[i]
        }))
    }
    pub fn dominates(self, other: Self) -> bool {
        let a = self.components();
        let b = other.components();
        (0..4).all(|i| a[i] <= b[i])
    }
    pub fn strictly_dominates(self, other: Self) -> bool {
        self.dominates(other) && (0..4).any(|i| self.components()[i] < other.components()[i])
    }
    pub fn weighted_sum(self, weights: Self) -> f64 {
        self.time_s * weights.time_s
            + self.oxygen * weights.oxygen
            + self.rover_power * weights.rover_power
            + self.equipment_power * weights.equipment_power
    }
    pub fn scale(self, factor: f64) -> Self {
        Self::from_components(std::array::from_fn(|i| self.components()[i] * factor))
    }
    fn sum_components(self) -> f64 {
        self.components().iter().sum()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RiskCosts {
    pub optimistic: ResourceVector,
    pub neutral: ResourceVector,
    pub pessimistic: ResourceVector,
}
impl RiskCosts {
    pub const fn new(
        optimistic: ResourceVector,
        neutral: ResourceVector,
        pessimistic: ResourceVector,
    ) -> Self {
        Self {
            optimistic,
            neutral,
            pessimistic,
        }
    }
    pub fn at(self, risk: RiskLevel) -> ResourceVector {
        match risk {
            RiskLevel::Optimistic => self.optimistic,
            RiskLevel::Neutral => self.neutral,
            RiskLevel::Pessimistic => self.pessimistic,
        }
    }
    pub fn validate(self) -> Result<(), RedlineError> {
        self.optimistic.validate("optimistic edge")?;
        self.neutral.validate("neutral edge")?;
        self.pessimistic.validate("pessimistic edge")
    }
}

/* science value specific to scenario */
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RiskValues {
    pub optimistic: f64,
    pub neutral: f64,
    pub pessimistic: f64,
}
impl RiskValues {
    pub const fn new(optimistic: f64, neutral: f64, pessimistic: f64) -> Self {
        Self {
            optimistic,
            neutral,
            pessimistic,
        }
    }
    pub fn at(self, risk: RiskLevel) -> f64 {
        match risk {
            RiskLevel::Optimistic => self.optimistic,
            RiskLevel::Neutral => self.neutral,
            RiskLevel::Pessimistic => self.pessimistic,
        }
    }
    pub fn validate(self) -> Result<(), RedlineError> {
        if [self.optimistic, self.neutral, self.pessimistic]
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err(RedlineError::InvalidInput(
                "science expected values must be finite and non-negative".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub enum RiskLevel {
    Optimistic,
    #[default]
    Neutral,
    Pessimistic,
}
impl RiskLevel {
    pub const ALL: [Self; 3] = [Self::Optimistic, Self::Neutral, Self::Pessimistic];
    const fn index(self) -> usize {
        match self {
            Self::Optimistic => 0,
            Self::Neutral => 1,
            Self::Pessimistic => 2,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum RedlineError {
    InvalidInput(String),
    NodeOutOfBounds(NodeId),
    NoSafehouse,
    StartNotReturnable,
    NoReturnPath,
}
impl fmt::Display for RedlineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => f.write_str(message),
            Self::NodeOutOfBounds(node) => write!(f, "node {node} is outside the graph"),
            Self::NoSafehouse => f.write_str("at least one safehouse is required"),
            Self::StartNotReturnable => f.write_str("the start node has no feasible return path"),
            Self::NoReturnPath => f.write_str("the planned route has no feasible return path"),
        }
    }
}
impl Error for RedlineError {}

#[derive(Clone, Debug)]
struct Edge {
    to: NodeId,
    costs: RiskCosts,
}

/* edges carry predicted resource consumption */
#[derive(Clone, Debug)]
pub struct RouteGraph {
    adjacency: Vec<Vec<Edge>>,
    positions: Vec<Option<Position>>,
    positioned_count: usize,
    /// `[risk][resource]` minimum cost per metre observed on any positioned
    /// edge. This gives A* a lower bound automatically.
    min_cost_per_m: [[f64; 4]; 3],
}
impl RouteGraph {
    pub fn new(node_count: usize) -> Self {
        Self {
            adjacency: vec![Vec::new(); node_count],
            positions: vec![None; node_count],
            positioned_count: 0,
            min_cost_per_m: [[f64::INFINITY; 4]; 3],
        }
    }
    pub fn node_count(&self) -> usize {
        self.adjacency.len()
    }
    /// Cumulative resource cost at each node of `nodes` under `risk`, starting
    /// at zero for the first node. Returns `None` when a node is out of bounds
    /// or two consecutive nodes have no connecting edge.
    ///
    /// When parallel edges exist, the first matching edge is used. Planner
    /// routes are built from the same adjacency order, so this reconstructs
    /// the costs the planner actually accounted for.
    pub fn path_costs(&self, nodes: &[NodeId], risk: RiskLevel) -> Option<Vec<ResourceVector>> {
        let first = *nodes.first()?;
        self.check_node(first).ok()?;
        let mut cumulative = Vec::with_capacity(nodes.len());
        cumulative.push(ResourceVector::ZERO);
        for pair in nodes.windows(2) {
            self.check_node(pair[1]).ok()?;
            let edge = self.adjacency[pair[0]]
                .iter()
                .find(|edge| edge.to == pair[1])?;
            let previous = *cumulative.last()?;
            cumulative.push(previous.plus(edge.costs.at(risk)));
        }
        Some(cumulative)
    }

    /// Assigns a local metric position used for the A* heuristic. Positions can
    /// be set before or after edges; call [`Self::rebuild_heuristic`] if edges
    /// were added before the positions.
    pub fn set_position(&mut self, node: NodeId, position: Position) -> Result<(), RedlineError> {
        self.check_node(node)?;
        if !position.x_m.is_finite() || !position.y_m.is_finite() {
            return Err(RedlineError::InvalidInput(
                "node positions must be finite".into(),
            ));
        }
        if self.positions[node].is_none() {
            self.positioned_count += 1;
        }
        self.positions[node] = Some(position);
        Ok(())
    }

    pub fn position(&self, node: NodeId) -> Option<Position> {
        self.positions.get(node).copied().flatten()
    }

    /// Recomputes the cost-per-metre lower bound after positions are assigned.
    pub fn rebuild_heuristic(&mut self) {
        let mut mins = [[f64::INFINITY; 4]; 3];
        for (from, edges) in self.adjacency.iter().enumerate() {
            let Some(from_position) = self.positions[from] else {
                continue;
            };
            for edge in edges {
                let Some(to_position) = self.positions[edge.to] else {
                    continue;
                };
                let distance = from_position.distance(to_position);
                if distance <= f64::EPSILON {
                    continue;
                }
                for risk in RiskLevel::ALL {
                    let risk_mins = &mut mins[risk.index()];
                    for (index, value) in edge.costs.at(risk).components().iter().enumerate() {
                        risk_mins[index] = risk_mins[index].min(*value / distance);
                    }
                }
            }
        }
        self.min_cost_per_m = mins;
    }

    fn update_heuristic_edge(&mut self, from: Position, to: Position, costs: RiskCosts) {
        let distance = from.distance(to);
        if distance <= f64::EPSILON {
            return;
        }
        for risk in RiskLevel::ALL {
            let mins = &mut self.min_cost_per_m[risk.index()];
            for (index, value) in costs.at(risk).components().iter().enumerate() {
                mins[index] = mins[index].min(*value / distance);
            }
        }
    }

    /// Admissible A* estimate of the weighted cost from `node` to `goal`.
    /// Returns zero unless every node has a position.
    fn heuristic(
        &self,
        node: NodeId,
        goal: NodeId,
        risk: RiskLevel,
        weights: ResourceVector,
    ) -> f64 {
        if self.positioned_count != self.node_count() {
            return 0.0;
        }
        let (Some(from), Some(to)) = (self.positions[node], self.positions[goal]) else {
            return 0.0;
        };
        let mins = self.min_cost_per_m[risk.index()];
        let mut components = [0.0; 4];
        for (index, value) in mins.iter().enumerate() {
            if value.is_finite() {
                components[index] = *value;
            }
        }
        from.distance(to) * ResourceVector::from_components(components).weighted_sum(weights)
    }

    pub fn add_edge(
        &mut self,
        from: NodeId,
        to: NodeId,
        costs: RiskCosts,
    ) -> Result<(), RedlineError> {
        self.check_node(from)?;
        self.check_node(to)?;
        costs.validate()?;
        self.adjacency[from].push(Edge { to, costs });
        if let (Some(from_position), Some(to_position)) = (self.positions[from], self.positions[to])
        {
            self.update_heuristic_edge(from_position, to_position, costs);
        }
        Ok(())
    }

    /// Adds both directions. Callers may give each direction different costs
    /// when slope, wind, or vehicle behavior makes travel asymmetric.
    pub fn add_bidirectional_edge(
        &mut self,
        a: NodeId,
        b: NodeId,
        a_to_b: RiskCosts,
        b_to_a: RiskCosts,
    ) -> Result<(), RedlineError> {
        self.check_node(a)?;
        self.check_node(b)?;
        a_to_b.validate()?;
        b_to_a.validate()?;
        self.adjacency[a].push(Edge {
            to: b,
            costs: a_to_b,
        });
        self.adjacency[b].push(Edge {
            to: a,
            costs: b_to_a,
        });
        if let (Some(a_position), Some(b_position)) = (self.positions[a], self.positions[b]) {
            self.update_heuristic_edge(a_position, b_position, a_to_b);
            self.update_heuristic_edge(b_position, a_position, b_to_a);
        }
        Ok(())
    }

    fn check_node(&self, node: NodeId) -> Result<(), RedlineError> {
        if node >= self.node_count() {
            Err(RedlineError::NodeOutOfBounds(node))
        } else {
            Ok(())
        }
    }

    /// Finds a minimum weighted-resource path with A*. When positions are
    /// available the heuristic is a cost-per-metre lower bound; otherwise this
    /// degrades cleanly to Dijkstra. This is used to generate candidate legs;
    /// safety is checked independently with Pareto return paths, so the
    /// weighted objective never relaxes the return constraint.
    fn shortest_path(
        &self,
        start: NodeId,
        goal: NodeId,
        risk: RiskLevel,
        weights: ResourceVector,
    ) -> Option<Leg> {
        if start == goal {
            return Some(Leg {
                path: vec![start],
                prefix_costs: vec![ResourceVector::ZERO],
            });
        }

        let n = self.node_count();
        let mut best = vec![f64::INFINITY; n];
        let mut spent = vec![ResourceVector::ZERO; n];
        let mut previous: Vec<Option<NodeId>> = vec![None; n];
        let mut queue = BinaryHeap::new();
        best[start] = 0.0;
        queue.push(QueueEntry {
            f: self.heuristic(start, goal, risk, weights),
            g: 0.0,
            node: start,
        });

        while let Some(QueueEntry { g, node, .. }) = queue.pop() {
            if g > best[node] {
                continue;
            }
            if node == goal {
                break;
            }
            for edge in &self.adjacency[node] {
                let edge_cost = edge.costs.at(risk);
                let next_g = g + edge_cost.weighted_sum(weights);
                if next_g < best[edge.to] {
                    best[edge.to] = next_g;
                    spent[edge.to] = spent[node].plus(edge_cost);
                    previous[edge.to] = Some(node);
                    queue.push(QueueEntry {
                        f: next_g + self.heuristic(edge.to, goal, risk, weights),
                        g: next_g,
                        node: edge.to,
                    });
                }
            }
        }
        if !best[goal].is_finite() {
            return None;
        }
        let mut path = vec![goal];
        let mut cursor = goal;
        while cursor != start {
            cursor = previous[cursor]?;
            path.push(cursor);
        }
        path.reverse();
        let prefix_costs = path.iter().map(|&node| spent[node]).collect();
        Some(Leg { path, prefix_costs })
    }

    /// Finds a minimum-primary-cost path whose complete resource vector fits
    /// inside `budget`. This is a resource-constrained multiobjective A*
    /// search: labels that exceed any resource are pruned, and Pareto-dominated
    /// labels are dropped. `max_labels_per_node == 0` means no cap.
    ///
    /// The cap makes the search approximate when it is reached; a cap of zero
    /// is exact for a finite graph. The beam planner uses this as a fallback
    /// when none of the cheaper scalarized paths fits.
    fn shortest_feasible_path(
        &self,
        start: NodeId,
        goal: NodeId,
        budget: ResourceVector,
        risk: RiskLevel,
        weights: ResourceVector,
        max_labels_per_node: usize,
    ) -> Option<Leg> {
        if start == goal {
            return Some(Leg {
                path: vec![start],
                prefix_costs: vec![ResourceVector::ZERO],
            });
        }

        let mut arena = Vec::new();
        let mut labels: Vec<Vec<LabelId>> = vec![Vec::new(); self.node_count()];
        let mut queue = BinaryHeap::new();

        let start_id = arena.len();
        arena.push(ParetoLabel {
            node: start,
            cost: ResourceVector::ZERO,
            parent: None,
        });
        labels[start].push(start_id);
        queue.push(GuidedEntry {
            f: self.heuristic(start, goal, risk, weights),
            g: 0.0,
            id: start_id,
        });

        while let Some(GuidedEntry { id, .. }) = queue.pop() {
            let (node, cost) = {
                let label = &arena[id];
                (label.node, label.cost)
            };
            if !labels[node].contains(&id) {
                continue;
            }
            if node == goal {
                let (path, prefix_costs) = build_forward_path(&arena, id);
                return Some(Leg { path, prefix_costs });
            }

            for edge in &self.adjacency[node] {
                let candidate_cost = cost.plus(edge.costs.at(risk));
                if !candidate_cost.fits_within(budget) {
                    continue;
                }
                let candidate_id = arena.len();
                arena.push(ParetoLabel {
                    node: edge.to,
                    cost: candidate_cost,
                    parent: Some(id),
                });
                if !insert_label(&arena, &mut labels[edge.to], candidate_id) {
                    continue;
                }
                enforce_label_cap(&arena, &mut labels[edge.to], max_labels_per_node, weights);
                if !labels[edge.to].contains(&candidate_id) {
                    continue;
                }
                let g = candidate_cost.weighted_sum(weights);
                queue.push(GuidedEntry {
                    f: g + self.heuristic(edge.to, goal, risk, weights),
                    g,
                    id: candidate_id,
                });
            }
        }
        None
    }
}

#[derive(Clone, Debug)]
struct Leg {
    path: Vec<NodeId>,
    /// Resource cost from the start of this leg to each corresponding node.
    prefix_costs: Vec<ResourceVector>,
}

impl Leg {
    fn cost(&self) -> ResourceVector {
        *self
            .prefix_costs
            .last()
            .expect("a leg always contains its start node")
    }
}

fn path_weight_variants(primary: ResourceVector) -> [ResourceVector; 6] {
    [
        primary,
        ResourceVector::new(1.0, 0.0, 0.0, 0.0),
        ResourceVector::new(0.0, 1.0, 0.0, 0.0),
        ResourceVector::new(0.0, 0.0, 1.0, 0.0),
        ResourceVector::new(0.0, 0.0, 0.0, 1.0),
        ResourceVector::new(1.0, 1.0, 1.0, 1.0),
    ]
}

/// Caches shortest paths because they do not depend on the remaining budget.
/// Only the choice among the cached path alternatives depends on the budget.
/// Without this, the beam search would repeat the same Dijkstra runs for every
/// state that reaches the same node.
struct PathCache<'a> {
    graph: &'a RouteGraph,
    risk: RiskLevel,
    primary_weights: ResourceVector,
    variants: [ResourceVector; 6],
    cache: HashMap<(NodeId, NodeId, usize), Option<Leg>>,
}

impl<'a> PathCache<'a> {
    fn new(graph: &'a RouteGraph, risk: RiskLevel, primary_weights: ResourceVector) -> Self {
        Self {
            graph,
            risk,
            primary_weights,
            variants: path_weight_variants(primary_weights),
            cache: HashMap::new(),
        }
    }

    /// Tries several scalarizations and keeps the cheapest feasible leg under
    /// `primary_weights`. A single weighted shortest path can consume too much
    /// of one resource even when a slightly slower route fits the budget, so
    /// extra weightings are used as cheap path alternatives. If none fits, the
    /// resource-constrained label search is used as an exact fallback.
    fn best_leg(
        &mut self,
        start: NodeId,
        goal: NodeId,
        budget: ResourceVector,
        max_labels_per_leg: usize,
    ) -> Option<Leg> {
        let mut best_key = None;
        let mut best_score = f64::INFINITY;

        for index in 0..self.variants.len() {
            let key = (start, goal, index);
            if !self.cache.contains_key(&key) {
                let leg = self
                    .graph
                    .shortest_path(start, goal, self.risk, self.variants[index]);
                self.cache.insert(key, leg);
            }
            let Some(leg) = self.cache.get(&key).expect("leg was just cached") else {
                continue;
            };
            let cost = leg.cost();
            if !cost.fits_within(budget) {
                continue;
            }
            let score = cost.weighted_sum(self.primary_weights);
            if best_key.is_none() || score < best_score {
                best_score = score;
                best_key = Some(key);
            }
        }
        if let Some(leg) = best_key.and_then(|key| self.cache.get(&key).and_then(|leg| leg.clone()))
        {
            return Some(leg);
        }
        self.graph.shortest_feasible_path(
            start,
            goal,
            budget,
            self.risk,
            self.primary_weights,
            max_labels_per_leg,
        )
    }
}

#[derive(Clone, Copy, Debug)]
struct QueueEntry {
    f: f64,
    g: f64,
    node: NodeId,
}

impl PartialEq for QueueEntry {
    fn eq(&self, other: &Self) -> bool {
        self.f.total_cmp(&other.f) == Ordering::Equal
            && self.g.total_cmp(&other.g) == Ordering::Equal
            && self.node == other.node
    }
}

impl Eq for QueueEntry {}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f
            .total_cmp(&self.f)
            .then_with(|| other.g.total_cmp(&self.g))
            .then_with(|| other.node.cmp(&self.node))
    }
}

#[derive(Clone, Copy, Debug)]
struct GuidedEntry {
    f: f64,
    g: f64,
    id: LabelId,
}

impl PartialEq for GuidedEntry {
    fn eq(&self, other: &Self) -> bool {
        self.f.total_cmp(&other.f) == Ordering::Equal
            && self.g.total_cmp(&other.g) == Ordering::Equal
            && self.id == other.id
    }
}

impl Eq for GuidedEntry {}

impl PartialOrd for GuidedEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for GuidedEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f
            .total_cmp(&self.f)
            .then_with(|| other.g.total_cmp(&self.g))
            .then_with(|| other.id.cmp(&self.id))
    }
}

type LabelId = usize;

#[derive(Clone, Debug)]
struct ParetoLabel {
    node: NodeId,
    cost: ResourceVector,
    /// Parent label in the arena. Return labels point toward a safehouse;
    /// forward search labels point toward the start. Parent IDs are always
    /// smaller than their children, so following them cannot cycle.
    parent: Option<LabelId>,
}

/// Exact Pareto return-cost labels for each graph node. A node belongs to the
/// return-safe region for a resource state iff at least one complete path to
/// a safehouse fits within every remaining resource.
///
/// Labels store only costs and parent pointers. Paths are materialized on
/// demand, which keeps the hot search loop and the return frontier compact.
#[derive(Clone, Debug)]
pub struct Returnability {
    labels: Vec<Vec<LabelId>>,
    arena: Vec<ParetoLabel>,
    risk: RiskLevel,
}

impl Returnability {
    pub fn compute(
        graph: &RouteGraph,
        safehouses: &[NodeId],
        risk: RiskLevel,
    ) -> Result<Self, RedlineError> {
        if safehouses.is_empty() {
            return Err(RedlineError::NoSafehouse);
        }
        for &node in safehouses {
            graph.check_node(node)?;
        }

        let mut incoming: Vec<Vec<(NodeId, ResourceVector)>> = vec![Vec::new(); graph.node_count()];
        for (from, edges) in graph.adjacency.iter().enumerate() {
            for edge in edges {
                incoming[edge.to].push((from, edge.costs.at(risk)));
            }
        }

        let mut result = Self {
            labels: vec![Vec::new(); graph.node_count()],
            arena: Vec::new(),
            risk,
        };
        let mut pending = VecDeque::new();

        for &safehouse in safehouses {
            let id = result.arena.len();
            result.arena.push(ParetoLabel {
                node: safehouse,
                cost: ResourceVector::ZERO,
                parent: None,
            });
            if insert_label(&result.arena, &mut result.labels[safehouse], id) {
                pending.push_back(id);
            }
        }

        while let Some(id) = pending.pop_front() {
            let (node, label_cost) = {
                let label = &result.arena[id];
                (label.node, label.cost)
            };
            // The label may have been removed after it was queued.
            if !result.labels[node].contains(&id) {
                continue;
            }
            for &(predecessor, edge_cost) in &incoming[node] {
                let candidate_id = result.arena.len();
                result.arena.push(ParetoLabel {
                    node: predecessor,
                    cost: edge_cost.plus(label_cost),
                    parent: Some(id),
                });
                if insert_label(&result.arena, &mut result.labels[predecessor], candidate_id) {
                    pending.push_back(candidate_id);
                }
            }
        }
        Ok(result)
    }

    pub fn risk_level(&self) -> RiskLevel {
        self.risk
    }

    pub fn is_returnable(&self, node: NodeId, remaining: ResourceVector) -> bool {
        self.labels.get(node).is_some_and(|labels| {
            labels
                .iter()
                .any(|&id| self.arena[id].cost.fits_within(remaining))
        })
    }

    /// Returns a concrete safehouse path whose full resource vector fits.
    pub fn return_path(&self, node: NodeId, remaining: ResourceVector) -> Option<Vec<NodeId>> {
        self.feasible_return(node, remaining).map(|(path, _)| path)
    }

    /// Returns a concrete feasible safehouse path and its resource cost.
    pub fn feasible_return(
        &self,
        node: NodeId,
        remaining: ResourceVector,
    ) -> Option<(Vec<NodeId>, ResourceVector)> {
        let id = self
            .labels
            .get(node)?
            .iter()
            .copied()
            .find(|&id| self.arena[id].cost.fits_within(remaining))?;
        Some((self.build_path(id), self.arena[id].cost))
    }

    /// Nondominated return costs available from `node`. This is the numerical
    /// form of the local returnability envelope.
    pub fn return_frontier(&self, node: NodeId) -> Vec<ResourceVector> {
        self.labels
            .get(node)
            .map(|labels| labels.iter().map(|&id| self.arena[id].cost).collect())
            .unwrap_or_default()
    }

    /// Boolean projection of the resource-dependent safe region, useful for
    /// drawing a map overlay at a particular remaining-resource state.
    pub fn safe_region(&self, remaining: ResourceVector) -> Vec<bool> {
        self.labels
            .iter()
            .map(|labels| {
                labels
                    .iter()
                    .any(|&id| self.arena[id].cost.fits_within(remaining))
            })
            .collect()
    }

    fn build_path(&self, mut id: LabelId) -> Vec<NodeId> {
        let mut path = Vec::new();
        loop {
            let label = &self.arena[id];
            path.push(label.node);
            match label.parent {
                Some(parent) => id = parent,
                None => break,
            }
        }
        path
    }
}

fn insert_label(arena: &[ParetoLabel], labels: &mut Vec<LabelId>, id: LabelId) -> bool {
    let cost = arena[id].cost;
    if labels.iter().any(|&old| arena[old].cost.dominates(cost)) {
        return false;
    }
    labels.retain(|&old| !cost.strictly_dominates(arena[old].cost));
    labels.push(id);
    true
}

fn enforce_label_cap(
    arena: &[ParetoLabel],
    labels: &mut Vec<LabelId>,
    max_labels: usize,
    weights: ResourceVector,
) {
    if max_labels == 0 || labels.len() <= max_labels {
        return;
    }
    let Some((worst, _)) = labels.iter().enumerate().max_by(|(_, a), (_, b)| {
        arena[**a]
            .cost
            .weighted_sum(weights)
            .total_cmp(&arena[**b].cost.weighted_sum(weights))
    }) else {
        return;
    };
    labels.swap_remove(worst);
}

fn build_forward_path(
    arena: &[ParetoLabel],
    mut id: LabelId,
) -> (Vec<NodeId>, Vec<ResourceVector>) {
    let mut reversed = Vec::new();
    loop {
        let label = &arena[id];
        reversed.push((label.node, label.cost));
        match label.parent {
            Some(parent) => id = parent,
            None => break,
        }
    }
    reversed.reverse();
    let path = reversed.iter().map(|(node, _)| *node).collect();
    let prefix_costs = reversed.iter().map(|(_, cost)| *cost).collect();
    (path, prefix_costs)
}

/// A science target. `expected_value` should already represent the expected
/// value of the experiment (including uncertainty and science significance).
/// `confidence` optionally discounts that value for model/data confidence.
#[derive(Clone, Debug)]
pub struct ScienceStop {
    pub id: usize,
    pub node: NodeId,
    pub expected_value: RiskValues,
    pub confidence: f64,
    pub visit_costs: RiskCosts,
}

impl ScienceStop {
    /// Confidence-weighted science value under a risk forecast.
    pub fn reward(&self, risk: RiskLevel) -> f64 {
        self.expected_value.at(risk) * self.confidence
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PlannerConfig {
    /// Forecast used to estimate outbound travel and visit costs.
    pub risk: RiskLevel,
    /// Forecast used to certify return paths. Normally pessimistic.
    pub return_risk: RiskLevel,
    /// Relative objective weights. They affect candidate leg selection only;
    /// all four resource constraints are always checked separately.
    pub path_weights: ResourceVector,
    /// Beam search is approximate; safety checks remain exact and mandatory.
    pub beam_width: usize,
    pub max_stops: usize,
    /// Per-node label cap for the resource-constrained leg fallback.
    /// `0` means no cap (exact, but potentially expensive).
    pub max_labels_per_leg: usize,
}

impl Default for PlannerConfig {
    fn default() -> Self {
        Self {
            risk: RiskLevel::Neutral,
            return_risk: RiskLevel::Pessimistic,
            path_weights: ResourceVector::new(1.0, 0.0, 0.0, 0.0),
            beam_width: 64,
            max_stops: 8,
            max_labels_per_leg: 512,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MissionPlan {
    pub stop_ids: Vec<usize>,
    /// Complete node sequence, ending at a safehouse. Consecutive duplicates
    /// at joined path boundaries are removed.
    pub route_nodes: Vec<NodeId>,
    pub expected_reward: f64,
    pub resources_used: ResourceVector,
    pub resources_remaining: ResourceVector,
    pub risk: RiskLevel,
    pub return_risk: RiskLevel,
}

impl MissionPlan {
    /// Converts the node route into the local metric coordinates expected by
    /// the renderer. Returns `None` if any node lacks a position.
    pub fn route_positions(&self, graph: &RouteGraph) -> Option<Vec<Position>> {
        self.route_nodes
            .iter()
            .map(|&node| graph.position(node))
            .collect()
    }
}

#[derive(Clone, Debug)]
struct SearchState {
    node: NodeId,
    remaining: ResourceVector,
    spent: ResourceVector,
    reward: f64,
    visited: Vec<bool>,
    stop_ids: Vec<usize>,
    route: Vec<NodeId>,
}

/// Plans science visits with a bounded beam search. Every expanded state is
/// admitted only if a concrete return path exists under `config.return_risk`
/// after travel and after the visit. Consequently, search approximation can
/// omit good plans, but cannot make an unsafe plan appear feasible.
pub fn plan_mission(
    graph: &RouteGraph,
    start: NodeId,
    safehouses: &[NodeId],
    stops: &[ScienceStop],
    resources: ResourceVector,
    reserve: ResourceVector,
    config: PlannerConfig,
) -> Result<MissionPlan, RedlineError> {
    graph.check_node(start)?;
    resources.validate("available")?;
    reserve.validate("safety reserve")?;
    config.path_weights.validate("path weight")?;
    if config.path_weights.components().iter().all(|v| *v == 0.0) {
        return Err(RedlineError::InvalidInput(
            "at least one path weight must be positive".into(),
        ));
    }
    if config.beam_width == 0 {
        return Err(RedlineError::InvalidInput(
            "beam width must be positive".into(),
        ));
    }
    for stop in stops {
        graph.check_node(stop.node)?;
        stop.expected_value.validate()?;
        if !stop.confidence.is_finite() || !(0.0..=1.0).contains(&stop.confidence) {
            return Err(RedlineError::InvalidInput(
                "science confidence must be between 0 and 1".into(),
            ));
        }
        stop.visit_costs.validate()?;
    }
    let mut ids = stops.iter().map(|s| s.id).collect::<Vec<_>>();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        return Err(RedlineError::InvalidInput(
            "science stop IDs must be unique".into(),
        ));
    }
    if !reserve.fits_within(resources) {
        return Err(RedlineError::InvalidInput(
            "safety reserve exceeds available resources".into(),
        ));
    }

    let available = resources.minus(reserve);
    let returnability = Returnability::compute(graph, safehouses, config.return_risk)?;
    if !returnability.is_returnable(start, available) {
        return Err(RedlineError::StartNotReturnable);
    }

    let mut paths = PathCache::new(graph, config.risk, config.path_weights);
    let initial = SearchState {
        node: start,
        remaining: available,
        spent: ResourceVector::ZERO,
        reward: 0.0,
        visited: vec![false; stops.len()],
        stop_ids: Vec::new(),
        route: vec![start],
    };
    let mut best = initial.clone();
    let mut frontier = vec![initial];
    let depth_limit = config.max_stops.min(stops.len());

    for _ in 0..depth_limit {
        let mut next_frontier = Vec::new();
        for state in &frontier {
            for (index, stop) in stops.iter().enumerate() {
                if state.visited[index] {
                    continue;
                }
                let Some(leg) = paths.best_leg(
                    state.node,
                    stop.node,
                    state.remaining,
                    config.max_labels_per_leg,
                ) else {
                    continue;
                };
                let leg_cost = leg.cost();
                if !leg_cost.fits_within(state.remaining) {
                    continue;
                }
                let after_travel = state.remaining.minus(leg_cost);

                // Check every traversed cell. This matters for directed or
                // asymmetric terrain edges: safety at the destination alone
                // does not prove that earlier cells on the chosen leg were safe.
                if leg
                    .path
                    .iter()
                    .zip(&leg.prefix_costs)
                    .any(|(&node, &spent)| {
                        !returnability.is_returnable(node, state.remaining.minus(spent))
                    })
                {
                    continue;
                }

                let visit_cost = stop.visit_costs.at(config.risk);
                if !visit_cost.fits_within(after_travel) {
                    continue;
                }
                let remaining = after_travel.minus(visit_cost);

                // The activity itself must not spend the resources needed to
                // leave the point of interest safely.
                if !returnability.is_returnable(stop.node, remaining) {
                    continue;
                }

                let mut candidate = state.clone();
                append_path(&mut candidate.route, &leg.path);
                candidate.node = stop.node;
                candidate.remaining = remaining;
                candidate.spent = state.spent.plus(leg_cost).plus(visit_cost);
                candidate.reward += stop.reward(config.risk);
                candidate.visited[index] = true;
                candidate.stop_ids.push(stop.id);
                if is_better_state(&candidate, &best) {
                    best = candidate.clone();
                }
                next_frontier.push(candidate);
            }
        }
        if next_frontier.is_empty() {
            break;
        }
        frontier = prune_states(next_frontier, config.beam_width);
        if frontier.is_empty() {
            break;
        }
    }

    let (home, home_cost) = returnability
        .feasible_return(best.node, best.remaining)
        .ok_or(RedlineError::NoReturnPath)?;
    let mut route_nodes = best.route;
    append_path(&mut route_nodes, &home);
    let resources_used = best.spent.plus(home_cost);
    if !resources_used.fits_within(resources) {
        return Err(RedlineError::NoReturnPath);
    }
    let resources_remaining = resources.minus(resources_used);
    Ok(MissionPlan {
        stop_ids: best.stop_ids,
        route_nodes,
        expected_reward: best.reward,
        resources_used,
        resources_remaining,
        risk: config.risk,
        return_risk: config.return_risk,
    })
}

/// Plans once per forecast so the UI can show optimistic, neutral, and
/// pessimistic alternatives. One infeasible scenario does not hide the others.
pub fn plan_all_scenarios(
    graph: &RouteGraph,
    start: NodeId,
    safehouses: &[NodeId],
    stops: &[ScienceStop],
    resources: ResourceVector,
    reserve: ResourceVector,
    config: PlannerConfig,
) -> Vec<(RiskLevel, Result<MissionPlan, RedlineError>)> {
    RiskLevel::ALL
        .into_iter()
        .map(|risk| {
            let mut scenario_config = config;
            scenario_config.risk = risk;
            (
                risk,
                plan_mission(
                    graph,
                    start,
                    safehouses,
                    stops,
                    resources,
                    reserve,
                    scenario_config,
                ),
            )
        })
        .collect()
}

/// Plans on a coarse graph first, then re-plans the selected stops on the fine
/// graph. `fine_to_coarse[fine_node]` identifies the coarse node that contains
/// a fine node. The coarse graph is only used to screen which science stops are
/// promising; the returned route, safety checks, and resource accounting all
/// come from the fine graph.
///
/// If the coarse plan is infeasible, or the fine re-plan rejects its stop set,
/// the function falls back to planning all stops directly on the fine graph.
#[allow(clippy::too_many_arguments)]
pub fn plan_coarse_to_fine(
    coarse: &RouteGraph,
    fine: &RouteGraph,
    fine_to_coarse: &[NodeId],
    start: NodeId,
    safehouses: &[NodeId],
    stops: &[ScienceStop],
    resources: ResourceVector,
    reserve: ResourceVector,
    coarse_config: PlannerConfig,
    fine_config: PlannerConfig,
) -> Result<MissionPlan, RedlineError> {
    if fine_to_coarse.len() != fine.node_count() {
        return Err(RedlineError::InvalidInput(
            "fine_to_coarse must have one entry per fine node".into(),
        ));
    }
    for &coarse_node in fine_to_coarse {
        coarse.check_node(coarse_node)?;
    }

    let map_node = |fine_node: NodeId| -> Result<NodeId, RedlineError> {
        fine.check_node(fine_node)?;
        let coarse_node = fine_to_coarse[fine_node];
        coarse.check_node(coarse_node)?;
        Ok(coarse_node)
    };

    let coarse_start = map_node(start)?;
    let coarse_safehouses = safehouses
        .iter()
        .map(|&node| map_node(node))
        .collect::<Result<Vec<_>, _>>()?;
    let coarse_stops = stops
        .iter()
        .map(|stop| {
            Ok(ScienceStop {
                id: stop.id,
                node: map_node(stop.node)?,
                expected_value: stop.expected_value,
                confidence: stop.confidence,
                visit_costs: stop.visit_costs,
            })
        })
        .collect::<Result<Vec<_>, RedlineError>>()?;

    let selected = plan_mission(
        coarse,
        coarse_start,
        &coarse_safehouses,
        &coarse_stops,
        resources,
        reserve,
        coarse_config,
    )
    .ok()
    .map(|plan| plan.stop_ids.into_iter().collect::<HashSet<_>>());

    if let Some(selected) = selected {
        let fine_stops = stops
            .iter()
            .filter(|stop| selected.contains(&stop.id))
            .cloned()
            .collect::<Vec<_>>();
        if let Ok(plan) = plan_mission(
            fine,
            start,
            safehouses,
            &fine_stops,
            resources,
            reserve,
            fine_config,
        ) {
            return Ok(plan);
        }
        if fine_stops.len() != stops.len() {
            return plan_mission(
                fine,
                start,
                safehouses,
                stops,
                resources,
                reserve,
                fine_config,
            );
        }
    }

    plan_mission(
        fine,
        start,
        safehouses,
        stops,
        resources,
        reserve,
        fine_config,
    )
}

fn is_better_state(candidate: &SearchState, current: &SearchState) -> bool {
    candidate.reward > current.reward
        || (candidate.reward == current.reward
            && candidate.remaining.sum_components() > current.remaining.sum_components())
}
/// Removes states that cannot lead to a better plan than a state already kept.
/// A state dominates another when it is at the same node, has visited a
/// superset of the stops, has at least as much reward, and has at least as much
/// of every resource left.
fn prune_states(mut states: Vec<SearchState>, beam_width: usize) -> Vec<SearchState> {
    states.sort_by(|a, b| {
        b.reward
            .total_cmp(&a.reward)
            .then_with(|| {
                b.remaining
                    .sum_components()
                    .total_cmp(&a.remaining.sum_components())
            })
            .then_with(|| a.node.cmp(&b.node))
    });

    let mut kept: Vec<SearchState> = Vec::new();
    for state in states {
        if kept.iter().any(|other| state_dominates(other, &state)) {
            continue;
        }
        kept.retain(|other| !state_dominates(&state, other));
        kept.push(state);
    }
    kept.sort_by(|a, b| {
        b.reward
            .total_cmp(&a.reward)
            .then_with(|| {
                b.remaining
                    .sum_components()
                    .total_cmp(&a.remaining.sum_components())
            })
            .then_with(|| a.node.cmp(&b.node))
    });
    kept.truncate(beam_width);
    kept
}
fn state_dominates(a: &SearchState, b: &SearchState) -> bool {
    a.node == b.node
        && visited_superset(&a.visited, &b.visited)
        && a.reward >= b.reward
        && b.remaining.fits_within(a.remaining)
}
fn visited_superset(superset: &[bool], subset: &[bool]) -> bool {
    superset
        .iter()
        .zip(subset)
        .all(|(&has, &needs)| has || !needs)
}
fn append_path(route: &mut Vec<NodeId>, path: &[NodeId]) {
    if path.is_empty() {
        return;
    }
    route.extend_from_slice(&path[usize::from(route.last() == path.first())..]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rv(time: f64, oxygen: f64, rover: f64, equipment: f64) -> ResourceVector {
        ResourceVector::new(time, oxygen, rover, equipment)
    }

    fn flat(time: f64) -> RiskCosts {
        RiskCosts::new(
            rv(time, 0.0, 0.0, 0.0),
            rv(time, 0.0, 0.0, 0.0),
            rv(time, 0.0, 0.0, 0.0),
        )
    }

    fn config() -> PlannerConfig {
        PlannerConfig {
            risk: RiskLevel::Neutral,
            return_risk: RiskLevel::Pessimistic,
            path_weights: rv(1.0, 0.0, 0.0, 0.0),
            beam_width: 16,
            max_stops: 4,
            max_labels_per_leg: 512,
        }
    }

    fn stop(id: usize, node: NodeId, value: f64, visit_cost: RiskCosts) -> ScienceStop {
        ScienceStop {
            id,
            node,
            expected_value: RiskValues::new(value, value, value),
            confidence: 1.0,
            visit_costs: visit_cost,
        }
    }

    #[test]
    fn returnability_uses_a_feasible_return_path() {
        let mut graph = RouteGraph::new(4);
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        graph.add_edge(0, 2, flat(3.0)).unwrap();
        graph.add_edge(2, 1, flat(1.0)).unwrap();

        let safety = Returnability::compute(&graph, &[1], RiskLevel::Neutral).unwrap();
        assert!(safety.is_returnable(0, rv(2.0, 0.0, 0.0, 0.0)));
        assert!(!safety.is_returnable(0, rv(0.5, 0.0, 0.0, 0.0)));
        assert!(safety.is_returnable(2, rv(1.0, 0.0, 0.0, 0.0)));

        let (path, cost) = safety.feasible_return(0, rv(2.0, 0.0, 0.0, 0.0)).unwrap();
        assert_eq!(path, vec![0, 1]);
        assert_eq!(cost, rv(1.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn returnability_handles_multiple_safehouses() {
        let mut graph = RouteGraph::new(4);
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        graph.add_edge(0, 2, flat(5.0)).unwrap();
        graph.add_edge(3, 0, flat(1.0)).unwrap();

        let safety = Returnability::compute(&graph, &[1, 2], RiskLevel::Neutral).unwrap();
        assert!(safety.is_returnable(0, rv(1.0, 0.0, 0.0, 0.0)));
        assert!(safety.is_returnable(3, rv(2.0, 0.0, 0.0, 0.0)));
        assert!(!safety.is_returnable(3, rv(1.5, 0.0, 0.0, 0.0)));
        // A safehouse is always returnable, even with no resources left.
        assert!(safety.is_returnable(2, ResourceVector::ZERO));

        let region = safety.safe_region(rv(2.0, 0.0, 0.0, 0.0));
        assert_eq!(region, vec![true, true, true, true]);
    }

    #[test]
    fn planner_visits_a_rewarding_stop_and_returns_home() {
        let mut graph = RouteGraph::new(3);
        graph
            .add_bidirectional_edge(0, 1, flat(1.0), flat(1.0))
            .unwrap();
        graph
            .add_bidirectional_edge(0, 2, flat(1.0), flat(1.0))
            .unwrap();
        graph
            .add_bidirectional_edge(2, 1, flat(1.0), flat(1.0))
            .unwrap();

        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(7, 2, 5.0, flat(1.0))],
            rv(10.0, 0.0, 0.0, 0.0),
            rv(1.0, 0.0, 0.0, 0.0),
            config(),
        )
        .unwrap();

        assert_eq!(plan.stop_ids, vec![7]);
        assert_eq!(plan.expected_reward, 5.0);
        assert_eq!(plan.route_nodes.first(), Some(&0));
        assert_eq!(plan.route_nodes.last(), Some(&1));
        assert_eq!(plan.resources_used, rv(3.0, 0.0, 0.0, 0.0));
        assert_eq!(plan.resources_remaining, rv(7.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn planner_skips_a_stop_that_would_strand_the_astronaut() {
        let mut graph = RouteGraph::new(3);
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        graph.add_edge(0, 2, flat(5.0)).unwrap();
        graph.add_edge(2, 1, flat(1.0)).unwrap();

        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(1, 2, 100.0, flat(0.0))],
            rv(5.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
        )
        .unwrap();

        assert!(plan.stop_ids.is_empty());
        assert_eq!(plan.expected_reward, 0.0);
        assert_eq!(plan.route_nodes, vec![0, 1]);
    }

    #[test]
    fn safety_forecast_is_independent_of_outbound_forecast() {
        let costs = RiskCosts::new(
            rv(1.0, 0.0, 0.0, 0.0),
            rv(2.0, 0.0, 0.0, 0.0),
            rv(10.0, 0.0, 0.0, 0.0),
        );
        let mut graph = RouteGraph::new(2);
        graph.add_edge(0, 1, costs).unwrap();

        let mut cfg = config();
        cfg.risk = RiskLevel::Optimistic;
        cfg.return_risk = RiskLevel::Pessimistic;
        let error = plan_mission(
            &graph,
            0,
            &[1],
            &[],
            rv(8.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            cfg,
        )
        .unwrap_err();
        assert_eq!(error, RedlineError::StartNotReturnable);

        cfg.return_risk = RiskLevel::Optimistic;
        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[],
            rv(8.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            cfg,
        )
        .unwrap();
        assert_eq!(plan.route_nodes, vec![0, 1]);
        assert_eq!(plan.return_risk, RiskLevel::Optimistic);
    }

    #[test]
    fn return_trip_uses_the_safety_forecast() {
        let outbound = RiskCosts::new(
            rv(1.0, 0.0, 0.0, 0.0),
            rv(1.0, 0.0, 0.0, 0.0),
            rv(5.0, 0.0, 0.0, 0.0),
        );
        let mut graph = RouteGraph::new(3);
        graph.add_edge(0, 1, outbound).unwrap();
        graph.add_edge(0, 2, outbound).unwrap();
        graph.add_edge(2, 1, outbound).unwrap();

        let mut cfg = config();
        cfg.risk = RiskLevel::Optimistic;
        cfg.return_risk = RiskLevel::Pessimistic;
        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(1, 2, 1.0, flat(0.0))],
            rv(20.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            cfg,
        )
        .unwrap();

        assert_eq!(plan.route_nodes, vec![0, 2, 1]);
        // Outbound is optimistic (1), but the return is priced pessimistically (5).
        assert_eq!(plan.resources_used, rv(6.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn reserve_is_never_spent() {
        let mut graph = RouteGraph::new(2);
        graph.add_edge(0, 1, flat(4.0)).unwrap();

        let error = plan_mission(
            &graph,
            0,
            &[1],
            &[],
            rv(5.0, 0.0, 0.0, 0.0),
            rv(2.0, 0.0, 0.0, 0.0),
            config(),
        )
        .unwrap_err();
        assert_eq!(error, RedlineError::StartNotReturnable);

        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[],
            rv(5.0, 0.0, 0.0, 0.0),
            rv(1.0, 0.0, 0.0, 0.0),
            config(),
        )
        .unwrap();
        assert_eq!(plan.resources_used, rv(4.0, 0.0, 0.0, 0.0));
        assert_eq!(plan.resources_remaining, rv(1.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn planner_can_leave_a_stop_unvisited_when_its_visit_cost_is_too_high() {
        let mut graph = RouteGraph::new(3);
        graph
            .add_bidirectional_edge(0, 1, flat(1.0), flat(1.0))
            .unwrap();
        graph
            .add_bidirectional_edge(0, 2, flat(1.0), flat(1.0))
            .unwrap();
        graph
            .add_bidirectional_edge(2, 1, flat(1.0), flat(1.0))
            .unwrap();

        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(1, 2, 100.0, flat(4.0))],
            rv(5.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
        )
        .unwrap();

        assert!(plan.stop_ids.is_empty());
        assert_eq!(plan.route_nodes, vec![0, 1]);
    }

    #[test]
    fn astar_uses_positions_without_changing_the_optimal_path() {
        let mut graph = RouteGraph::new(3);
        graph.set_position(0, Position::new(0.0, 0.0)).unwrap();
        graph.set_position(1, Position::new(1.0, 0.0)).unwrap();
        graph.set_position(2, Position::new(2.0, 0.0)).unwrap();
        graph.add_edge(0, 2, flat(10.0)).unwrap();
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        graph.add_edge(1, 2, flat(1.0)).unwrap();

        let weights = rv(1.0, 0.0, 0.0, 0.0);
        assert!(graph.heuristic(0, 2, RiskLevel::Neutral, weights) > 0.0);
        let leg = graph
            .shortest_path(0, 2, RiskLevel::Neutral, weights)
            .unwrap();
        assert_eq!(leg.path, vec![0, 1, 2]);
        assert_eq!(leg.cost(), rv(2.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn resource_constrained_search_finds_a_feasible_detour() {
        let mut graph = RouteGraph::new(4);
        graph
            .add_edge(
                0,
                2,
                RiskCosts::new(
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                ),
            )
            .unwrap();
        graph.add_edge(0, 3, flat(2.0)).unwrap();
        graph
            .add_edge(
                3,
                2,
                RiskCosts::new(
                    rv(2.0, 1.0, 0.0, 0.0),
                    rv(2.0, 1.0, 0.0, 0.0),
                    rv(2.0, 1.0, 0.0, 0.0),
                ),
            )
            .unwrap();

        let leg = graph
            .shortest_feasible_path(
                0,
                2,
                rv(20.0, 5.0, 0.0, 0.0),
                RiskLevel::Neutral,
                rv(1.0, 0.0, 0.0, 0.0),
                0,
            )
            .unwrap();
        assert_eq!(leg.path, vec![0, 3, 2]);
        assert_eq!(leg.cost(), rv(4.0, 1.0, 0.0, 0.0));
    }

    #[test]
    fn coarse_plan_screens_stops_before_fine_routing() {
        let mut coarse = RouteGraph::new(3);
        coarse.add_edge(0, 1, flat(1.0)).unwrap();
        coarse.add_edge(1, 2, flat(1.0)).unwrap();

        let mut fine = RouteGraph::new(5);
        for node in 0..4 {
            fine.add_edge(node, node + 1, flat(1.0)).unwrap();
        }
        let fine_to_coarse = [0, 0, 1, 1, 2];

        let plan = plan_coarse_to_fine(
            &coarse,
            &fine,
            &fine_to_coarse,
            0,
            &[4],
            &[stop(42, 3, 10.0, flat(0.0))],
            rv(20.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
            config(),
        )
        .unwrap();

        assert_eq!(plan.stop_ids, vec![42]);
        assert_eq!(plan.route_nodes, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn path_costs_accumulate_edges_in_route_order() {
        let mut graph = RouteGraph::new(3);
        graph.add_edge(0, 1, flat(2.0)).unwrap();
        graph.add_edge(1, 2, flat(3.0)).unwrap();

        let costs = graph
            .path_costs(&[0, 1, 2], RiskLevel::Neutral)
            .expect("the route is connected");
        assert_eq!(costs[0], ResourceVector::ZERO);
        assert_eq!(costs[1], rv(2.0, 0.0, 0.0, 0.0));
        assert_eq!(costs[2], rv(5.0, 0.0, 0.0, 0.0));

        // A missing edge makes the cost profile unavailable.
        assert!(graph.path_costs(&[0, 2], RiskLevel::Neutral).is_none());
    }

    #[test]
    fn returnability_respects_directed_edges() {
        let mut graph = RouteGraph::new(2);
        // This is a one-way descent: node 1 cannot climb back to the safehouse.
        graph.add_edge(0, 1, flat(1.0)).unwrap();

        let safety = Returnability::compute(&graph, &[0], RiskLevel::Neutral).unwrap();
        assert!(safety.is_returnable(0, ResourceVector::ZERO));
        assert!(!safety.is_returnable(1, rv(10.0, 10.0, 10.0, 10.0)));
    }

    #[test]
    fn returnability_keeps_tradeoffs_between_resources() {
        let mut graph = RouteGraph::new(3);
        graph
            .add_edge(
                0,
                1,
                RiskCosts::new(
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                ),
            )
            .unwrap();
        graph.add_edge(0, 2, flat(2.0)).unwrap();
        graph
            .add_edge(
                2,
                1,
                RiskCosts::new(
                    rv(1.0, 1.0, 0.0, 0.0),
                    rv(1.0, 1.0, 0.0, 0.0),
                    rv(1.0, 1.0, 0.0, 0.0),
                ),
            )
            .unwrap();

        let safety = Returnability::compute(&graph, &[1], RiskLevel::Neutral).unwrap();
        // The fast path needs too much oxygen; the slower path is the only fit.
        assert!(safety.is_returnable(0, rv(3.0, 1.0, 0.0, 0.0)));
        assert!(!safety.is_returnable(0, rv(2.0, 1.0, 0.0, 0.0)));
        assert_eq!(safety.return_frontier(0).len(), 2);
    }

    #[test]
    fn leg_search_tries_alternative_weightings() {
        let mut graph = RouteGraph::new(4);
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        graph
            .add_edge(
                0,
                2,
                RiskCosts::new(
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                    rv(1.0, 10.0, 0.0, 0.0),
                ),
            )
            .unwrap();
        graph.add_edge(0, 3, flat(2.0)).unwrap();
        graph
            .add_edge(
                3,
                2,
                RiskCosts::new(
                    rv(2.0, 1.0, 0.0, 0.0),
                    rv(2.0, 1.0, 0.0, 0.0),
                    rv(2.0, 1.0, 0.0, 0.0),
                ),
            )
            .unwrap();
        graph.add_edge(2, 1, flat(1.0)).unwrap();

        let plan = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(1, 2, 10.0, flat(0.0))],
            rv(20.0, 5.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
        )
        .unwrap();

        assert_eq!(plan.stop_ids, vec![1]);
        assert_eq!(plan.route_nodes, vec![0, 3, 2, 1]);
    }

    #[test]
    fn all_scenarios_are_planned_independently() {
        let mut graph = RouteGraph::new(2);
        graph.add_edge(0, 1, flat(1.0)).unwrap();

        let results = plan_all_scenarios(
            &graph,
            0,
            &[1],
            &[],
            rv(2.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
        );
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].0, RiskLevel::Optimistic);
        assert!(results.iter().all(|(_, plan)| plan.is_ok()));
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        let graph = RouteGraph::new(2);
        assert_eq!(
            Returnability::compute(&graph, &[], RiskLevel::Neutral).unwrap_err(),
            RedlineError::NoSafehouse
        );

        let mut graph = RouteGraph::new(2);
        graph.add_edge(0, 1, flat(1.0)).unwrap();
        let error = plan_mission(
            &graph,
            0,
            &[1],
            &[stop(1, 0, 1.0, flat(0.0)), stop(1, 1, 1.0, flat(0.0))],
            rv(5.0, 0.0, 0.0, 0.0),
            ResourceVector::ZERO,
            config(),
        )
        .unwrap_err();
        assert!(matches!(error, RedlineError::InvalidInput(_)));
    }
}
