# F1, decoding trades from balance changes: the 2-public-wallet half

**FAIL, and not because the decoder is wrong.** 0 of 50 transactions verified against a hand-built
ledger, which is what the acceptance asks for. What this run did establish is *why* an automated
substitute cannot settle it, and what a person now has to do instead. That is OP-20.

What did pass, mechanically: **100 transactions decoded across 2 wallets with 0 silent drops.**
Every transaction landed in exactly one bucket, swap, not-a-swap or undecoded, and each undecoded
one carries a reason and a program id.

## Finding 1: a busy address is not a trader

Helius `/addresses/{x}/transactions` returns every transaction **involving** x, not every
transaction **by** x. So a pool or routing account reads as a heavy swapper.

`7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU` showed 21 swaps per 100 transactions across 4 venues
and looked like an ideal F1 wallet. It decoded to **0 of 42**, correctly: it never appears as the
owner of any token balance in its own transactions. Nothing of that wallet moved.

The selection test has to be *is this address the owner of the balances that change*, not *does this
address appear in swaps*. That test is recorded in `wallets.json`.

## Finding 2: Helius `SWAP` and our `swap` are different questions

Even for an address that owns the balances, the two labels disagree **by definition rather than by
error**. On `5Q544fKr`, of 50 transactions Helius calls swaps, measured at the recorded slot:

| decoder outcome | n |
|---|---|
| swap | 29 |
| not-a-swap: both sides are quote assets, so no position was opened or closed | 14 |
| not-a-swap: no token balance of this wallet changed | 6 |
| undecoded: 2 mints left and 1 arrived, so the pairing is ambiguous | 1 |

The 14 are SOL to USDC rotations. A swap instruction ran, so Helius is right. No position opened or
closed, so the decoder is right. They are answering different questions, and **the enhanced API
therefore cannot be the oracle for F1.** The hand-built ledger the PRD asks for is not bureaucracy;
it is the only source that settles the question.

## Finding 3: neither wallet is a retail trader

`5CKAa7Wm` was picked because it owns the balances in 6 of 6 sampled swaps and shows 91 swaps per
100 transactions. It decodes to **50 of 50 "value only arrived the wallet"**: a payout address, not
somebody trading a position.

An automated heuristic keeps finding bots, routers and payout addresses. Choosing 2 wallets with a
real position history is a judgment call that needs a person who knows what one looks like, or the
team's own wallets once OP-1 has produced history. That is the other half of OP-20.

## What is genuinely unfinished

- 2 wallets with real position history, chosen by a person.
- A hand-built 50-row ledger per wallet: side, mint, amount in base units, for comparison field by
  field. The harness prints exactly those 50 rows, so this is verification, not construction.
- Only then can `50 of 50`, `amounts exact to base units` and the coverage share be claimed.

## Running it

```
node scripts/spike.mjs F1            # replay, no keys, no network
AGON_NET_MODE=record HELIUS_API_KEY=... node scripts/spike.mjs F1   # refresh the fixtures
```

The sample is drawn with a seed derived from the wallet address, so a rerun picks the same 50 and
"50 of 50" means the same 50 every time. The recorder paces and retries: a hundred `getTransaction`
calls back to back reset the connection on the free tier and left a half-written fixture.
