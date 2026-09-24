# F5, does the Swig role actually enforce the cap

**Not run yet. Blocked on OP-19, a funded devnet keypair.** The threshold is in
`thresholds.json`, written before the run, per the feasibility bar.

This is the existential one. If the cap does not hold on-chain then the custody story is gone and
CP1 decides whether Agon ships read-only, so nothing here is worth softening.

## Why it is blocked, and what was measured before giving up

The Swig program **is** deployed on devnet, checked at slot 503527368: `executable: true`, owned by
`BPFLoaderUpgradeab1e11111111111111111111111`. Devnet RPC answers, `solana-core 4.3.0`. So the
chain side is ready.

The missing piece is lamports. The public faucet is dry:

| endpoint | `requestAirdrop` answer |
|---|---|
| `api.devnet.solana.com` | `429`, "either reached your airdrop limit today or the airdrop faucet has run dry" |
| `devnet.helius-rpc.com` | `-32401`, missing api key |
| `rpc.ankr.com/solana_devnet` | `-32000`, unauthorized, api key required |

A spike cannot be written around that. Faking it, by asserting against a mocked program instead of
the real one, would produce a green row proving nothing, and this is the test the whole custody
claim rests on.

## What (g) needs, and why it is not this script

Case (g) is "removal done from Phantom, not only our CLI". A human has to click it. It is an
operator step in OP-19 and this script will never assert it, because a script asserting that a
person used a wallet is exactly the kind of green row the board refuses.

## Cases (a) to (f) test authorisation, not execution

Devnet has no Jupiter liquidity and no keepers, which the PRD already says. So (a) passing means
**the Swig program let an instruction through to Jupiter's program id**, not that a swap filled.
(b), (c) and (d) are the ones that matter most: they must be rejected by the program, before the
inner instruction runs, with our code doing nothing to help.
