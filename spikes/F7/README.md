# F7, pre-signed expiry

**FAIL, and the one clause that could run changes the design.**

The acceptance has four clauses. One is answerable by reading the SDK and is answered below. The
other three each need a transaction to land on devnet, and there is no funded key, so **0 runs
happened** and "the agent key held `manageAuthority` in 0 of the runs" is true only in the useless
sense that there were no runs. That is a FAIL, not a pass on a quarter of a spike.

## Clause 1: Swig has a native expiry, and T-D02 may not be needed

T-D02 builds expiry out of a transaction the user pre-signs at arm time, anchored to a durable
nonce, held by a daemon and submitted when the rule is due. That is a lot of machinery, and it
carries a sharp edge the PR had to write down: the signed bytes are a bearer instrument, so anyone
holding them can end the rule early, and refusing to is policy rather than enforcement.

**The program already has expiry.** `@swig-wallet/lib` defines `SessionBasedAuthority`, which
carries:

- `expirySlot`, the slot the session stops working at
- `maxDuration`, a ceiling on how long any session may last
- `createSession({ roleId, newSessionKey, sessionDuration })`

So the shape Agon wants already exists: give the agent a **session key** rather than an authority of
its own, with a duration. When the session expires the agent simply cannot sign. No pre-signed
transaction, no durable nonce, no daemon that has to be running at the right moment, and no bearer
instrument to steal.

Why this was not obvious: **the wrapper SDK hides it.** `@swig-wallet/classic`, which is what
`packages/chain` imports and what T-D01 and T-D02 were written against, exposes no expiry concept at
all. Grepping it for `expiry`, `ttl`, `deadline` or `validUntil` returns nothing, and the `Actions`
builder has 26 permission methods and no expiry among them. Looking only there is exactly how a team
concludes there is no native expiry and goes and builds one, which is what happened.

## How far the evidence goes, and where it stops

Seven checks, all as expected, all reading the installed `.d.ts` files, all reproducible by
`node scripts/spike.mjs F7` with no keys.

The decisive question for the design is **whether the agent could renew its own session**, because a
self-renewing session is not an expiry. The SDK says it cannot:
`getCreateSessionV1BaseAccountMetasWithAuthority` puts the **authority** in the signer slot, and the
new session key is a parameter of the instruction rather than a signer of it.

**That is an inference from the SDK's shape, not proof from the program.** It is the single thing
most worth confirming on devnet: hold only a session key, call `createSession`, and check the
program refuses. Until that runs, the native mechanism is promising and unproven.

## What should happen at CP2

This is a threshold question and a design question, not a code fix:

1. **Try the native path first.** An agent holding a session key with a duration is simpler than
   T-D02 in every direction, and the failure modes are the program's rather than ours.
2. **Confirm the renewal question on devnet** before committing to it. If a session key can renew
   itself, the native path is not an expiry and T-D02 is back.
3. **Keep T-D02 either way until then.** It is merged, tested and honest about its limits, and it is
   the fallback if the session model turns out not to carry the actions Agon needs. Nothing here
   argues for deleting it; it argues for not building further on it yet.

## Not run, and why

`OP-19`. The Helius devnet faucet is capped at 1 SOL per project per day and was already spent, and
`api.devnet.solana.com` answers `requestAirdrop` with an internal error. Every remaining clause of
this spike needs a signature that lands.

## Running it

```
node scripts/spike.mjs F7
```

Reads the installed SDK only. It records the three package versions in `result.json`, because the
answer is true of `2.1.0` and a future version could move it. If any check stops matching, the run
exits 1 rather than quietly reporting the old conclusion.
