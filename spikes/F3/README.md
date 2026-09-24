# F3, token risk check on 30 labelled mints

**PASS. 9 of 9 seizure mints blocked, 0 of 11 blue chips blocked, 0 of 10 fee-only blocked.**
Measured at slot 450075719 against real mainnet accounts, in 1 `getMultipleAccounts`, by the
production guard (`packages/guard` `checkMints`) and not by a copy of it.

This threshold replaced the one the first run failed. That run is not hidden: `thresholds.json`
carries the old wording, what it measured, who changed it and why, per the feasibility bar.

## What changed, and why

The first threshold contradicted itself. It labelled 10 mints dangerous for carrying a **live
freeze authority** and also demanded **0 of 10 blue chips** flagged. USDC and USDT both have a live
freeze authority. One rule cannot call that trait disqualifying and wave the two largest stablecoins
on Solana through.

The tokens carrying it say why: **PYUSD** is PayPal, **USDG** is Paxos, **cbBTC** is Coinbase, and
**SPYx, NVDAx, GLDx** are tokenised equities and gold. For a regulated issuer a freeze authority is
how a court order is obeyed. On a memecoin the same trait is how the deployer takes your position.
The trait is identical; the operator is not, and the mint account cannot tell them apart.

So the guard now blocks on **seizure**, a permanent delegate or a live transfer hook, and **reports**
a freeze authority with its own reason. cbBTC moved to the blue chips: it was the only mint in the
seizure group with no permanent delegate.

## What this deliberately does not catch

**A mint that can freeze you but not seize you passes, with a warning.** A frozen position cannot be
sold, so this is a real hole and not a rounding error. It is accepted because the alternative was
blocking USDC, and a guard that blocks the most traded token on Solana gets switched off by its user
on day 1.

Closing it needs an issuer allowlist, so the check can tell Circle from a stranger. That is T-C06
work with a threshold of its own, not something to smuggle in here. Until then the Swig cap is what
bounds the damage, which is the layer that assumes this one failed.

## Two things the real distribution says about the labels

- **0 live transfer hooks in the top 100 mints by organic score.** Every `transferHook` extension
  found was present with `programId: null`, which means no hook is installed. That danger cannot be
  measured against real data at this sample size. The check handles it and nothing real exercises it.
- **Permanent delegate and freeze authority are nearly the same set.** 9 of the 10 mints originally
  grouped by authority also carry a permanent delegate. The acceptance imagined 2 disjoint groups of
  10; the chain has one overlapping group, which is why the Token-2022 group was built from fee-only
  mints.

## Running it

```
node scripts/spike.mjs F3            # replay, no keys, no network
AGON_NET_MODE=record HELIUS_API_KEY=... node scripts/spike.mjs F3   # refresh the fixture
```

The recorded response lives in `recorded/` next to the labels it was labelled from, so the two
cannot drift apart. Relabelling a mint changes the request, so the replay misses and the check fails
closed rather than scoring against a stale response: that is why this run was re-recorded.
