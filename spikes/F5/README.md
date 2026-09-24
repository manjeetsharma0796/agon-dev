# F5, does the Swig role actually enforce the cap

**Ran on devnet, 0 of 7 cases exercised. Blocked on two people, OP-19 and OP-20.** The threshold is
in `thresholds.json`, written before the run, per the feasibility bar. `result.json` is what the run
measured.

```
node scripts/spike.mjs F5 --devnet
DEVNET_KEYPAIR=<64-number json array, or a path to one> node scripts/spike.mjs F5 --devnet
```

This is the existential one. If the cap does not hold on-chain then the custody story is gone and
CP1 decides whether Agon ships read-only, so nothing here is worth softening. Nothing in
`result.json` says the cap holds, and nothing says it does not. No case was exercised.

**The headline is not the empty payer.** That is a faucet problem and it costs 0.0015 SOL to fix.
The headline is that **the pinned Jupiter program id is not a program on devnet**: it is a 0-byte
account owned by the system program, `executable: false`. An agent role scoped to
`programLimit({ programId: JUPITER })` therefore scopes to something that cannot execute there, so
the 7 cases cannot be exercised on devnet however well funded the payer is. Live arming on devnet
cannot show the cap stopping a swap, because on devnet there is no swap to stop.

The alternative, named and not implemented here: a **Surfpool mainnet fork** carries the real
Jupiter program and the real Swig program, costs nothing and needs no mainnet funds, and F9 already
showed that a committed Surfpool snapshot replays offline with no key. That is a CP1 decision,
OP-20, not a thing this task should quietly pivot to.

## What the run does prove

Read from devnet in the same process that wrote `result.json`, at slot 503595691:

| checked | answer |
|---|---|
| Swig program `swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB` | `executable: true`, owned by `BPFLoaderUpgradeab1e11111111111111111111111` |
| the agent role from `packages/chain` | builds, and passes `assertAgentRoleShape` |
| transaction 1 of 7, `createSwig`, built for real | 351 bytes, reaches devnet, refused with "Attempt to debit an account but found no record of a prior credit" |

So the code path is not the blocker. The transaction serialises, the blockhash is accepted, the
program loads, and devnet refuses it for exactly one reason: the payer holds 0 lamports.

## The smaller blocker, OP-19: no devnet lamports, and the ask is 1,295 times too big

Every faucet reachable without a browser refuses. The spike asks all of them on every run and puts
the answers in `result.json` under `funding.faucetAttempts`, so a rerun on a better day needs no
argument about which ones were tried:

| endpoint | `requestAirdrop` answer |
|---|---|
| `api.devnet.solana.com` | `429`, "either reached your airdrop limit today or the airdrop faucet has run dry" |
| `devnet.helius-rpc.com` | `-32403`, "the devnet faucet has a limit of 1 SOL per project per day" |
| `solana-devnet.g.alchemy.com/v2/demo` | `429`, empty body |
| `solana-devnet-rpc.publicnode.com` | `404` |
| `solana-devnet.drpc.org` | `35`, devnet is not on the free plan |
| `api.blockeden.xyz/solana/devnet` | `401`, access key required |
| `solana-devnet.gateway.tatum.io` | answers `getVersion`, rejects `requestAirdrop` as an invalid request |

The Helius row is only in `result.json` when `HELIUS_API_KEY` is set, which is how the nightly job
runs it. The row above was measured with the local key, and a key never reaches the recorded answer.

0.1 SOL was refused as flatly as 1 SOL, so the limit is per day and not per amount. The web faucet at
`faucet.solana.com` wants a browser and a captcha, which is a person's job, not a script's.

**The whole spike needs 1,543,680 lamports, 0.0015 SOL.** Measured, not estimated: devnet quotes
1,503,680 lamports of rent for a 168-byte account, and a Swig carrying a root role and the agent
role is 168 bytes. That last number is read off devnet rather than off the struct: of the 59,948
Swig accounts there, 49,693 sit at 104 bytes (one role) and 8,661 at 168 bytes (two), confirmed by
fetching one account from each tier. Add 5,000 lamports a transaction for the 8 transactions the 7
cases take and the total is 0.0015 SOL.

OP-19 asks for about 2 SOL. It needs 0.0015, and 0.01 SOL would cover several reruns. That matters
because it changes who can unblock this: not a faucet with a big allowance, just anyone holding a
dusting of devnet SOL.

A side note worth having: existing Swig accounts hold 1,614,720 lamports at the 104-byte tier while
devnet now quotes 1,178,560 for the same size. The rent rate dropped from 3,480 to 2,540 lamports
per byte-year at some point, so reading an existing account's balance overstates what a new one
costs by about 37%.

## The blocker that decides the demo, OP-20: Jupiter is not on devnet

The pinned Jupiter id `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` **is not a program on devnet.**
It is a plain wallet: `executable: false`, owned by the system program, 0 bytes, holding 4.51 SOL.
On mainnet the same id is `executable: true`, owned by the BPF upgradeable loader, 36 bytes.

The PRD already said devnet has no Jupiter liquidity and no keepers, and this spike was written
expecting that, so case (a) was only ever going to mean "the Swig program let an instruction through
to Jupiter's id". That part still works: the authorisation check runs before the inner instruction,
so (a) is measurable as authorisation.

(b) and (e) are not. Both are checks on a spending limit, and Swig applies a `tokenRecurringLimit`
by comparing the Swig account's token balances **after** the inner instructions run. With no program
at the Jupiter id, the inner instruction cannot run at all, so the transaction fails before the limit
is ever consulted. A run would record a rejection and it would be the wrong rejection: the cap would
read as holding when it was never asked. That is an unexpected success wearing a pass, which is the
one outcome this spike exists to prevent.

So funding alone does not make the 7 cases runnable. CP1 has to decide one of:

1. run (b) and (e) against a program that is deployed on devnet and moves the capped mint, and say
   plainly that the Jupiter leg was substituted;
2. run the whole thing on a **Surfpool mainnet fork**, which carries the real Jupiter program and
   the real Swig program, costs nothing and needs no mainnet funds. F9 already showed a committed
   Surfpool snapshot replays offline with no key, so the tooling is in the repo. This is the option
   that also gives the demo a beat where the cap visibly stops a swap;
3. run the cap cases in mainnet simulation, which is already T-F05c, and let T-F05a cover only the
   cases that need no Jupiter execution: (c), (d), (f) and (a) as authorisation;
4. deploy a Jupiter build to devnet, which nobody on this team controls.

The case sequence for (c), (d) and (f) is deliberately not written yet. Those three do not need
Jupiter and would run today given lamports, but writing them against a 7-case shape CP1 is about to
change means writing them twice, and the spike cannot report a number either way until OP-19 lands.

## What (g) needs, and why it is not this script

Case (g) is "removal done from Phantom, not only our CLI". A human has to click it. It is an operator
step in OP-19 and this script will never assert it, because a script asserting that a person used a
wallet is exactly the kind of green row the board refuses.
