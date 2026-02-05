# knex-prepared Benchmark Results

**Generated:** 2026-02-05T02:33:18.010Z

**Iterations per test:** 1,000
**Warmup iterations:** 50 (excluded from measurements to ensure stable results)
**Connection pool:** Single connection (min: 1, max: 1) for consistent results
**Test Data:** 1,000 users, 5,000 posts

## Simple SELECT by ID

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 4.042 | 3.976 | -1.6% |
| P90 | 4.920 | 4.832 | -1.8% |
| P99 | 10.169 | 7.759 | -23.7% |
| Avg | 4.307 | 4.181 | -2.9% |

## SELECT with static WHERE clause

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 5.306 | 5.317 | +0.2% |
| P90 | 7.454 | 7.212 | -3.2% |
| P99 | 10.705 | 9.143 | -14.6% |
| Avg | 5.773 | 5.745 | -0.5% |

## Multiple WHERE Conditions

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 5.131 | 5.149 | +0.3% |
| P90 | 6.934 | 7.118 | +2.6% |
| P99 | 9.756 | 17.541 | +79.8% |
| Avg | 5.585 | 5.834 | +4.5% |

## Simple JOIN

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 4.215 | 4.418 | +4.8% |
| P90 | 5.358 | 5.807 | +8.4% |
| P99 | 16.958 | 21.946 | +29.4% |
| Avg | 4.787 | 5.108 | +6.7% |

## Complex JOIN with Conditions

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 9.724 | 10.655 | +9.6% |
| P90 | 13.243 | 16.900 | +27.6% |
| P99 | 40.649 | 46.642 | +14.7% |
| Avg | 11.158 | 12.780 | +14.5% |

## Aggregation with GROUP BY

| Metric | Regular (ms) | Prepared (ms) | Change |
|--------|--------------|---------------|--------|
| P50 | 11.433 | 11.221 | -1.9% |
| P90 | 12.920 | 13.323 | +3.1% |
| P99 | 30.573 | 25.074 | -18.0% |
| Avg | 12.285 | 12.127 | -1.3% |

## IN Clauses with rewriteInClauses Option

The `rewriteInClauses` option enables prepared statement name generation that accounts for IN clause size. 
This test cycles through sizes 1-20 (1 iterations each, 20 total queries). 
**Default**: No prepared statements. 
**Prepared**: Uses prepared statements, creates 20 different statements (one per size). 
**Prepared + Rewrite**: Uses prepared statements with `rewriteInClauses`, creates only 1 statement and reuses it.

### whereIn (mixed sizes 1-20)

| Metric | Default (ms) | Prepared (ms) | Prepared + Rewrite (ms) | Prepared Change | Rewrite Change |
|--------|--------------|---------------|-------------------------|-----------------|----------------|
| P50 | 12.668 | 13.919 | 13.939 | +9.9% | +10.0% |
| P90 | 15.104 | 17.327 | 21.786 | +14.7% | +44.2% |
| P99 | 36.932 | 34.796 | 54.673 | -5.8% | +48.0% |
| Avg | 13.482 | 14.642 | 15.652 | +8.6% | +16.1% |

### whereNotIn (mixed sizes 1-20)

| Metric | Default (ms) | Prepared (ms) | Prepared + Rewrite (ms) | Prepared Change | Rewrite Change |
|--------|--------------|---------------|-------------------------|-----------------|----------------|
| P50 | 52.131 | 54.145 | 53.794 | +3.9% | +3.2% |
| P90 | 65.847 | 65.080 | 58.984 | -1.2% | -10.4% |
| P99 | 86.024 | 91.246 | 84.435 | +6.1% | -1.8% |
| Avg | 54.740 | 56.816 | 55.025 | +3.8% | +0.5% |

---

*Benchmark run with knex-prepared on PostgreSQL*