# Which region we deploy in, and the numbers that decided it

T-C03. Measured 2026-09-24. Re-measure when hosting exists (OP-17) and when Jev has credentials
(OP-4), because half of the second question below is still unanswered.

## The answer

`iad1`. Deploy in the United States, not in India, and not near our users.

Every report is a chain of sequential calls to Helius and to Jev. Nothing in that chain talks to
the user until it is finished, so what we pay per report is our distance to those two services,
multiplied by the number of calls. Our distance to the user is paid once. The two are not close:

| Leg | From India | From the US | Ratio |
|---|---|---|---|
| Helius RPC, p50 | 136.3 ms | 23.5 ms | 5.8x |
| Helius RPC, p95 | 267.5 ms | 39.6 ms | 6.8x |
| Cloudflare edge, p50 | 210.8 ms | 12.9 ms | 16.3x |
| Cloudflare edge, p95 | 267.7 ms | 14.7 ms | 18.2x |

A 2,000 transaction report at 1 page per 100 transactions is 20 sequential history calls. That is
2.7 s of pure network from India against 0.5 s from the US, before a single transaction is decoded.
The user in Mumbai waits 2.2 s longer for a report served closer to them.

## What was measured, exactly

100 calls per target per region, 60 ms apart, `performance.now()` around a `fetch`, p50 and p95 from
the sorted sample. 0 failures anywhere.

**Region 1, India.** Kolkata, Reliance Jio, Cloudflare colo MAA. Run from a workstation.

| Target | n | p50 | p95 | min | max |
|---|---|---|---|---|---|
| Helius RPC, with our key | 100 | 140.4 ms | 259.3 ms | 125.2 ms | 401.9 ms |
| Helius RPC, no key | 40 | 136.3 ms | 267.5 ms | 118.0 ms | 369.8 ms |
| Cloudflare edge, `cdn-cgi/trace` | 100 | 210.8 ms | 267.7 ms | 171.0 ms | 1621.6 ms |

**Region 2, United States.** GitHub Actions runner, Phoenix Arizona, Cloudflare colo LAX.
Evidence: https://github.com/manjeetsharma0796/agon-dev/actions/runs/35996972613

| Target | n | p50 | p95 | min | max |
|---|---|---|---|---|---|
| Helius RPC, no key | 100 | 23.5 ms | 39.6 ms | 18.7 ms | 257.0 ms |
| Cloudflare edge, `cdn-cgi/trace` | 100 | 12.9 ms | 14.7 ms | 12.0 ms | 38.2 ms |

## Three things the numbers are not

**The Helius probe in region 2 carries no key.** A key cannot go into CI before OP-2 issues a CI
key, so the second region is measured with a request that comes back 401. That is only honest if
the 401 travels the same path as the real call, so it was checked rather than assumed: from the
same machine, in the same minute, keyed p50 140.4 ms against unkeyed 136.3 ms, and p95 259.3 ms
against 267.5 ms. Inside 3 percent on both. The unkeyed probe measures the network leg, and the
network leg is the whole question here, because Helius does the same work wherever we sit.

**The Cloudflare number is the edge, not Jev.** Workers AI runs at the edge, and `cdn-cgi/trace` is
answered by the colo that received the request, so this is the network leg Jev will pay. It does
not include inference. The first attempt used `api.cloudflare.com` and read 442.2 ms p50 from
India, 2.1x the edge number, because that host is the control plane and is not served from the
nearest colo. A probe that looks reasonable and measures the wrong machine is worth less than no
probe, so it was thrown away. **The real Jev round trip is still unmeasured and blocked on OP-4.**

**`iad1` is chosen, not measured.** What is measured is US against India, and that gap is 5.8x, far
wider than any gap between two US regions could be. Which US region is a smaller question that this
data does not answer: the region 2 sample is a runner in Phoenix, which is US West, while `iad1` is
US East. `iad1` is the pick because Solana RPC and validator infrastructure concentrates in
Ashburn, and because it is Vercel's default, so it is the cheapest thing to be wrong about. When
OP-17 gives us real deployments, measure `iad1` against `sfo1` from the deployments themselves and
correct this file. Do not carry the Phoenix number forward as if it were `iad1`.

## Reproducing it

Ad hoc on purpose. T-C03's kill criterion is that this is a setting and not code, measured once, so
no harness is committed. 100 `fetch` calls in a loop, 60 ms apart, sort, take p50 and p95. The
second region was a workflow on a throwaway branch that was deleted once the run had printed;
the run above is the surviving record.
