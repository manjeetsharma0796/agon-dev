# F3, token risk check on 30 labelled mints

**FAIL. 10 of 20 dangerous flagged, 2 of 10 blue chips flagged.** Threshold was 20 and 0, written
in `thresholds.json` before the run. Measured at slot 450037708 against real mainnet accounts, in
1 `getMultipleAccounts`, by the production guard (`packages/guard` `checkMints`) and not by a copy
of it.

Both halves miss, and they miss for the same reason: **the labels the acceptance uses are not a
description of danger.**

## 1. USDC and USDT are flagged by the trait that defines the dangerous set

The acceptance labels 10 mints dangerous for having "live freeze or mint authority", and asks for
0 of 10 blue chips flagged. USDC and USDT have a live freeze authority. They are the 2 largest
stablecoins on Solana. One rule cannot say that trait is disqualifying and also wave those two
through.

This is not a bug in the check. It is the definition being wrong, and the tokens that carry the
trait say so plainly: **PYUSD** is PayPal's stablecoin, **USDG** is Paxos, **cbBTC** is Coinbase's
wrapped BTC, and **SPYx, NVDAx, GLDx** are tokenised equities and gold. Freeze authority and a
permanent delegate are how a regulated issuer meets a court order. On a memecoin the same two
traits are how the deployer takes your position. The trait is identical; the operator is not.

What the check can honestly say today is "this token has a live freeze authority", which is true
and useful. What it cannot say from the mint account alone is whether that is Circle or a stranger.
Deciding that needs an issuer allowlist, which is a T-C06 decision and not something to smuggle in
here.

## 2. A transfer fee is a cost, not a way to take the position

0 of the 10 fee-only Token-2022 mints are blocked. That is deliberate. A 3% transfer fee makes a
round trip expensive and the check reports it in those words, with the number, so the size rule can
price it. It does not let anyone move or freeze the balance. Grouping it with permanent delegate
and transfer hook, as the acceptance line does, puts a cost and a seizure in one bucket.

If the board wants fee-bearing mints blocked outright, that is a threshold to write down, not a
bug to fix: say at what basis points, and the check will enforce it.

## 3. Two things the real distribution says about the labels

- **0 live transfer hooks in the top 100 mints by organic score.** Every `transferHook` extension
  found was present with `programId: null`, which means no hook is installed. The third danger the
  acceptance names does not occur live at this end of the market, so it cannot be measured against
  real data at this sample size. The check handles it and nothing real exercises that path.
- **Permanent delegate and freeze authority are nearly the same set.** 8 of the 10 mints in the
  authority group also carry a permanent delegate. The acceptance imagines 2 disjoint groups of 10;
  the chain has one overlapping group, which is why the Token-2022 group here had to be built from
  fee-only mints.

## What should happen at CP1

The kill criterion says a miss on the 20 is a bug to fix, not a scope cut. Neither of these is a
bug in the code, so the decision is about the threshold:

1. Rewrite the F3 threshold so "dangerous" means what the guard blocks on, seizure and
   immobilisation, and keep the blue chips as they are. Under that wording this run is 10 of 10 and
   0 of 10, and USDC and USDT still block.
2. Or keep the blue chip clause and accept that USDC and USDT need an issuer allowlist, which is
   T-C06 work and a new threshold of its own.

Nothing here is worth softening the check for. A guard that passes USDC by loosening "freeze
authority" passes every memecoin that has one.

## Running it

```
node scripts/spike.mjs F3            # replay, no keys, no network
AGON_NET_MODE=record HELIUS_API_KEY=... node scripts/spike.mjs F3   # refresh the fixture
```

The recorded response lives in `recorded/` next to the labels it was labelled from, so the two
cannot drift apart. `mints.json` was committed before the run.
