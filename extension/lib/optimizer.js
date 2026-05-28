// Combinatorial BOM price optimizer — JavaScript port of optimize.py
// Finds top N cheapest purchasing plans across distributors.
// Path: /root/bom-to-cart-phase4/lib/optimizer.js

/**
 * Optimize BOM purchasing: find cheapest platform combinations.
 *
 * @param {object} input
 * @param {Array<{name:string, quantity:number, prices:object}>} input.parts
 * @param {number} [input.shipping_per_platform=10]
 * @param {number} [input.top_n=5]
 * @returns {object} { plans, priced_parts, unpriced_parts, ... }
 */
export function optimize(input) {
  const parts = input.parts || [];
  const shipping = input.shipping_per_platform || 10;
  const topN = input.top_n || 5;

  if (!parts.length) {
    return { plans: [], error: 'No parts provided', total_platforms_considered: 0, total_parts: 0 };
  }

  const pricedParts = parts.filter(p => Object.keys(p.prices || {}).length > 0);
  const unpricedParts = parts.filter(p => !Object.keys(p.prices || {}).length);

  // Collect all unique platforms
  const allPlatforms = [...new Set(pricedParts.flatMap(p => Object.keys(p.prices)))].sort();
  const M = allPlatforms.length;
  const N = pricedParts.length;
  const INF = Infinity;

  const result = {
    total_parts: parts.length,
    priced_parts: N,
    unpriced_parts: unpricedParts.length,
    total_platforms_considered: M,
    unpriced_part_names: unpricedParts.map(p => p.name),
  };

  if (unpricedParts.length) {
    result.warning = `${unpricedParts.length} parts have no prices. Optimization covers only the ${N} priced parts.`;
  }

  if (M === 0) {
    result.plans = [];
    result.error = 'No platforms found for any priced part';
    return result;
  }

  // Build price matrix: part × platform
  const priceMatrix = pricedParts.map(part =>
    allPlatforms.map(p => part.prices[p] ?? INF)
  );

  // Pre-sort cheapest options per part
  const partOptions = priceMatrix.map(row =>
    row.map((price, j) => ({ j, price }))
       .filter(o => o.price < INF)
       .sort((a, b) => a.price - b.price)
  );

  const plans = M <= 20
    ? enumeratePlans(pricedParts, allPlatforms, partOptions, M, shipping, topN)
    : optimizeGreedy(pricedParts, allPlatforms, priceMatrix, shipping, topN);

  result.plans = plans.map((plan, idx) => ({ rank: idx + 1, ...plan }));
  result.algorithm = M <= 20 ? 'exhaustive' : 'greedy';
  return result;
}

/** Brute-force: enumerate all non-empty platform subsets. */
function enumeratePlans(parts, platforms, partOptions, M, shipping, topN) {
  const INF = Infinity;
  const allPlans = [];

  // Generate all non-empty subsets
  for (let r = 1; r <= M; r++) {
    for (const subset of combinations(M, r)) {
      const subsetSet = new Set(subset);
      let partsCost = 0;
      let feasible = true;
      const breakdown = [];

      for (let i = 0; i < parts.length; i++) {
        let bestPrice = INF;
        let bestJ = null;

        for (const { j, price } of partOptions[i]) {
          if (subsetSet.has(j)) {
            bestPrice = price;
            bestJ = j;
            break;
          }
        }

        if (bestPrice === INF) { feasible = false; break; }

        const qty = parts[i].quantity;
        const subtotal = bestPrice * qty;
        partsCost += subtotal;
        breakdown.push({
          part: parts[i].name,
          quantity: qty,
          platform: platforms[bestJ],
          unit_price: round4(bestPrice),
          subtotal: round2(subtotal),
        });
      }

      if (!feasible) continue;

      partsCost = round2(partsCost);
      const shippingTotal = round2(r * shipping);

      allPlans.push({
        platforms_used: subset.map(j => platforms[j]),
        num_platforms: r,
        parts_cost: partsCost,
        shipping: shippingTotal,
        total: round2(partsCost + shippingTotal),
        breakdown,
      });
    }
  }

  allPlans.sort((a, b) => a.total - b.total);
  return allPlans.slice(0, topN);
}

/** Greedy + local search for large M (>20). */
function optimizeGreedy(parts, platforms, priceMatrix, shipping, topN) {
  const N = parts.length;
  const M = platforms.length;
  const INF = Infinity;
  if (N === 0) return [];

  // Greedy: pick single cheapest platform per part
  const assignment = [];
  const used = new Set();
  for (let i = 0; i < N; i++) {
    let bestJ = null, bestPrice = INF;
    for (let j = 0; j < M; j++) {
      if (priceMatrix[i][j] < bestPrice) { bestPrice = priceMatrix[i][j]; bestJ = j; }
    }
    if (bestJ === null) return [];
    assignment.push(bestJ);
    used.add(bestJ);
  }

  const basePlatforms = [...used];
  const candidates = [basePlatforms];

  // Try removing each platform
  for (const removeJ of basePlatforms) {
    const reduced = basePlatforms.filter(p => p !== removeJ);
    if (!reduced.length) continue;
    const reducedSet = new Set(reduced);
    const feasible = Array.from({ length: N }, (_, i) =>
      reduced.some(j => priceMatrix[i][j] < INF)
    ).every(Boolean);
    if (feasible) candidates.push(reduced);
  }

  // Try single-platform solutions
  for (let j = 0; j < M; j++) {
    const feasible = Array.from({ length: N }, (_, i) => priceMatrix[i][j] < INF).every(Boolean);
    if (feasible && !candidates.some(c => c.length === 1 && c[0] === j)) {
      candidates.push([j]);
    }
  }

  // Evaluate each candidate
  const plans = [];
  for (const platSubset of candidates) {
    const platSet = new Set(platSubset);
    let partsCost = 0;
    const breakdown = [];
    let feasible = true;

    for (let i = 0; i < N; i++) {
      let bestPrice = INF, bestJ = null;
      for (const j of platSubset) {
        if (priceMatrix[i][j] < bestPrice) { bestPrice = priceMatrix[i][j]; bestJ = j; }
      }
      if (bestPrice === INF) { feasible = false; break; }
      const qty = parts[i].quantity;
      const subtotal = bestPrice * qty;
      partsCost += subtotal;
      breakdown.push({
        part: parts[i].name, quantity: qty,
        platform: platforms[bestJ],
        unit_price: round4(bestPrice),
        subtotal: round2(subtotal),
      });
    }

    if (!feasible) continue;

    partsCost = round2(partsCost);
    const s = round2(platSubset.length * shipping);
    plans.push({
      platforms_used: platSubset.map(j => platforms[j]),
      num_platforms: platSubset.length,
      parts_cost: partsCost, shipping: s,
      total: round2(partsCost + s), breakdown,
    });
  }

  plans.sort((a, b) => a.total - b.total);
  return plans.slice(0, topN);
}

// Combinatorial generator: all r-combinations from [0..n-1]
function* combinations(n, r) {
  const indices = Array.from({ length: r }, (_, i) => i);
  yield indices.slice();
  while (true) {
    let i = r - 1;
    while (i >= 0 && indices[i] === i + n - r) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < r; j++) indices[j] = indices[j - 1] + 1;
    yield indices.slice();
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }