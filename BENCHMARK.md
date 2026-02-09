# knex-prepared Benchmark Results

**Generated:** 2026-02-05T18:33:03.507Z

**Iterations per test:** 1,000
**Warmup iterations:** 10 (excluded from measurements to ensure stable results)
**Connection pool:** Single connection (min: 1, max: 1) for consistent results
**Test Data:** 1,000 users, 5,000 posts

**Methodology:** Each iteration executes all query variants to properly test prepared statement caching. 
With named prepared statements, each distinct query is cached and reused. Without names, PostgreSQL must reparse/replan for each different query.

## Simple SELECT Queries

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 1.837 | 1.732 | -5.7% |
| P90 | 2.312 | 2.897 | +25.3% |
| P99 | 3.506 | 7.692 | +119.4% |
| Avg | 1.950 | 2.089 | +7.1% |

## SELECT with WHERE Clause

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 92.564 | 94.201 | +1.8% |
| P90 | 120.442 | 136.978 | +13.7% |
| P99 | 278.841 | 266.068 | -4.6% |
| Avg | 102.668 | 106.339 | +3.6% |

## Multiple WHERE Conditions

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 38.289 | 37.250 | -2.7% |
| P90 | 54.736 | 56.332 | +2.9% |
| P99 | 131.383 | 154.494 | +17.6% |
| Avg | 43.363 | 43.438 | +0.2% |

## Simple JOIN

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 123.402 | 130.697 | +5.9% |
| P90 | 163.913 | 161.850 | -1.3% |
| P99 | 408.446 | 334.307 | -18.2% |
| Avg | 137.662 | 141.266 | +2.6% |

## Complex JOIN with Conditions

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 44.235 | 69.615 | +57.4% |
| P90 | 49.089 | 87.632 | +78.5% |
| P99 | 77.428 | 255.932 | +230.5% |
| Avg | 46.963 | 77.440 | +64.9% |

## Aggregation with GROUP BY

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 27.514 | 27.628 | +0.4% |
| P90 | 30.567 | 32.414 | +6.0% |
| P99 | 70.135 | 81.637 | +16.4% |
| Avg | 29.872 | 30.121 | +0.8% |

## IN Clauses with rewriteInClauses Option

The `rewriteInClauses` option enables prepared statement name generation that accounts for IN clause size. 
This test uses 10 different IN clause sizes. Each iteration executes all 10 queries. 
**Default**: No prepared statements. 
**Prepared**: Uses prepared statements, creates 10 different statements (one per size). 
**Prepared + Rewrite**: Uses prepared statements with `rewriteInClauses`, creates only 1 statement and reuses it.

### whereIn (sizes 1-10)

| Metric | Default (ms) | Prepared (ms) | Prepared + Rewrite (ms) | Prepared Change | Rewrite Change |
|--------|--------------|---------------|-------------------------|-----------------|----------------|
| P50 | 2.023 | 1.800 | 2.074 | -11.0% | +2.5% |
| P90 | 2.307 | 2.043 | 4.387 | -11.5% | +90.1% |
| P99 | 5.642 | 5.842 | 17.944 | +3.5% | +218.1% |
| Avg | 2.163 | 2.084 | 3.318 | -3.7% | +53.4% |

### whereNotIn (sizes 1-10)

| Metric | Default (ms) | Prepared (ms) | Prepared + Rewrite (ms) | Prepared Change | Rewrite Change |
|--------|--------------|---------------|-------------------------|-----------------|----------------|
| P50 | 12.178 | 15.139 | 15.099 | +24.3% | +24.0% |
| P90 | 25.126 | 24.255 | 24.852 | -3.5% | -1.1% |
| P99 | 39.298 | 43.477 | 52.056 | +10.6% | +32.5% |
| Avg | 14.286 | 15.727 | 16.814 | +10.1% | +17.7% |

---

*Benchmark run with knex-prepared on PostgreSQL*