# Setting up an agent against Agon

For an AI agent, or the person wiring one up. Everything below was checked against the server's
handlers, and anything that is not real yet says so.

## Paste this to start

```text
You have an MCP server called agon, on a practice copy of Solana mainnet with no real funds. If I
say "onboard me", follow the onboarding steps in your agon instructions in order: the arming page
already exists, so do not build one or read any source code. Every answer starts with a "network"
field: tell the user which network before you quote any number. Treat "unsure" and "block" as
"the trade does not go out", and tell the user the reason word for word. Never propose a spending
limit yourself: arm_rule returns a link, and the user sets the limit on that page with their own
wallet. To see what you are allowed to spend, call list_rules and quote effectiveRemaining, with
rollingWorstCase beside it. To trade, call prepare_swap and sign and send the transaction it
returns with the agent kit from your agon instructions; never build a swap another way. If a call returns an error, read its first
sentence to the user and do not retry the same call.
```

## 1. Run the server

The server speaks MCP over Streamable HTTP at `/mcp`, with a health check at `/health`.

```bash
docker compose up -d --build
```

That starts 3 services, all bound to this machine only: a mainnet fork on `127.0.0.1:8899`, the MCP
server on `http://127.0.0.1:8787/mcp`, and the arming screen on `http://127.0.0.1:3111/arm`, which
`arm_rule` links to. The server has no authentication, so do not bind it to a public address.

To build trades, put these in a `.env` beside `compose.yaml` (compose passes only these names into
the containers):

```text
HELIUS_API_KEY=...
JUPITER_API_KEY=...
AGON_NET_MODE=live
```

Without them the server reads recordings only: `list_rules` still reads the fork, but no trade can
be built. If port 8787 is taken (Cloudflare wrangler uses it), add `AGON_MCP_PORT=8788` and point
your client at `http://127.0.0.1:8788/mcp`.

## 2. Point your client at it

Claude Code:

```bash
claude mcp add --transport http agon http://127.0.0.1:8787/mcp
```

Any other client: use its Streamable HTTP option with the URL `http://127.0.0.1:8787/mcp`. A
client that only speaks stdio needs a bridge from stdio to HTTP.

Without a client, a raw call works too:

```bash
curl -s http://127.0.0.1:8787/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_trade","arguments":{"wallet":"HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC","mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","side":"buy","size":"2000000000"}}}'
```

## 3. Know which network you are on

Every result starts with `network`, and every error starts with `Network:`. Say it to the user
before quoting any number. The Docker image runs in **replay mode**: it reads committed recordings
and never reaches the network. It has 1 recorded wallet,
`HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC`, with USDC as the recorded mint. Any other wallet
is refused with the reason, not guessed at.

## 4. The seven tools, as they behave today

| Tool | What it really does now |
|---|---|
| `check_trade` | Real rule engine over the wallet's decoded history. Answers `pass`, `block` or `unsure`, and every non-pass names the rule and the number. |
| `get_report` | Answers from a recorded example, the same figures for any wallet, with a `note` saying so. Repeat the note if you quote it. |
| `arm_rule` | Arms nothing. Returns a link to the arming screen, on the practice fork only. A request that carries a cap is refused. |
| `list_rules` | Reads the wallet's vault from the chain this deployment names. Needs `AGON_RPC_URL`; without it the call refuses, which is not the same as "no rules". |
| `prepare_swap` | Builds 1 unsigned swap from the vault, signed by nobody. Runs `check_trade` itself with the real quote, checks the amount against `effectiveRemaining` and simulates on the configured chain; returns the transaction only past all 3. Needs `AGON_RPC_URL`, and live mode for any wallet but the recorded one. |
| `vault_status` | The vault's P&L, first in first out over every trade with SOL as the quote: realised from the chain's own sells (needs no price), unrealised on what is still open, capped at what the vault holds on chain, at what selling it fetches now (a Jupiter sell quote, else Jupiter's price, else DexScreener, each named), and dollars at SOL/USD from Pyth and Jupiter. Starts with `summary`, lines to read to the user as they are; every amount comes as base units, a decimal and a unit. Also the 5 largest positions, balances, each agent's fee SOL, the latest 3 trades with explorer links, and what was not counted and why. The totals cover every trade. |
| `sync_fork` | Practice fork only, refused anywhere else. Refreshes the pools a SOL swap routes through from mainnet and moves a lagging fork clock forward; never resets a vault. Call it when a swap fails on a stale price or the clock lags. |

Two facts that change how you read `check_trade`:

- **On its own it cannot return `pass`.** It takes no price quote, so `quote-missing` is always
  among its reasons, and that is `unsure`. `prepare_swap` runs the same check with the quote it
  routes, and that is the only path to `pass`. A successful `check_trade` call is one that returns a
  verdict with its reasons. No model is asked anything: the token's category and the impostor check
  are lookups, and the token's own name and description never appear in an answer.
- **Size is checked on a buy only.** A sell returns no size reason. That is a gap, not a pass.

`arm_rule` takes `wallet`, `mints` (a list), `triggerType` (for example `"stop"`) and `expiresAt`
(a date-time, or `null`), and nothing else: an extra field such as a cap is refused. Full input and
output schemas: [`mcp-tools.md`](./mcp-tools.md).

## 4b. Onboarding a new user

What an agent does when the user says "onboard me". Nobody copies an address in either direction.

1. The agent downloads the [agent kit](#the-agent-kit) from the server and runs
   `node ~/.agon/agon-kit.mjs key`, which prints its public key. It never writes its own key or
   signing code. It does not ask for the user's address.
2. The user sets Phantom to **Settings, Developer Settings, Testnet Mode, Solana Localnet**, which
   points at the fork on `127.0.0.1:8899`.
3. The agent calls `arm_rule` with `agent` set to its public key,
   `mints: ["So11111111111111111111111111111111111111112"]`, `triggerType: "stop"` and
   `expiresAt: null`, and hands over the link. On the page the user connects Phantom (the agent's key
   is already filled in), takes free practice SOL if the wallet is short, picks a deposit and a cap,
   and approves 2 transactions. The second also sends the agent's key 0.01 SOL for its fees.
   Stopping halfway is fine: the same link resumes from what is on chain.
4. The agent calls `list_rules` with **its own public key**. The chain names the wallet that hired
   it: each rule carries `owner`, along with the vault, the cap and `effectiveRemaining`.

A user with no trading history can trade on the fork: `prepare_swap` builds the trade bounded only by
the cap they signed, and says so as the verdict's first reason, `no-trading-history`.

## 5. Where the agent's key lives

The agent has its own keypair. **It is never the user's key**, and Agon never sees either.

- Generate the agent's keypair on the machine the agent runs on and keep its secret in that
  machine's OS keychain. Never in a `.env` file, a log, a chat or anything hosted.
- On the practice fork, until the `agon` CLI's keychain signer ships, the agent kit's key file,
  which only the user can read (`chmod 600`), is the stopgap. Never reuse it on mainnet.
- The user sees only the agent's **public** key. The arming link carries it, and their own wallet
  signs a role for it.
- That role can do 1 thing: spend 1 mint through Jupiter, up to a cap per window of slots. It never
  holds `manageAuthority`, so the agent cannot raise its own cap. The user can revoke it at any
  time from the same screen.

### The agent kit

1 file, 0 dependencies, Node 18 or later, served by the MCP server at `/kit.mjs`. The agent runs it
on its own machine, so the server never sees a key:

```bash
curl -fsS --create-dirs -o ~/.agon/agon-kit.mjs http://127.0.0.1:8787/kit.mjs
```

| Command | What it does |
|---|---|
| `node ~/.agon/agon-kit.mjs key` | Makes the agent's key on first run, or reuses it, in `~/.agon/agent-key.json` (`chmod 600`, the 64-byte array Solana tools read), and prints only the public key. |
| `node ~/.agon/agon-kit.mjs send <base64>` | Signs a `prepare_swap` transaction, sends it to the fork on `127.0.0.1:8899` (`--rpc` for another) and prints the signature once confirmed. |

`send` refuses, with the cause, a transaction whose fee payer is not its key, that needs another
signer, or that calls anything but Swig's sign instruction and a compute unit limit (any other
Swig call, or a compute unit price, could spend the agent's SOL), and it sends only to an RPC that reports a Surfpool version, never
to mainnet. The instructions give the agent the kit's address as the agent reached the server, so
a remapped port such as 8788 needs no change; from any host but this machine that address is
`https`, since the file handles a key.

## 6. Find the vault and the cap

Call `list_rules` with the user's wallet. Each rule carries:

| Field | Meaning |
|---|---|
| `vault` | the address that holds the funds the agent may spend |
| `swigRole.authority` | the agent's public key; check it is yours |
| `swigRole.tokenRecurringLimit.amount` | the cap per window, in base units |
| `swigRole.tokenRecurringLimit.windowSlots` | the window length, in slots |
| `effectiveRemaining` | what can be spent right now. **Quote this one.** |
| `rollingWorstCase` | the most that can go out in a burst across a window edge: up to 2 windows' worth |

An empty list means no agent role is armed. An error means no chain was read.

## 7. The swap that lands

Call `prepare_swap` with:

| Field | Value |
|---|---|
| `owner` | the user's wallet, which owns the vault |
| `historyWallet` | the wallet whose history judges the trade, only read, never signed for: the owner. On the practice fork, a wallet with 0 closed trades on mainnet (fork activity never counts) is not refused: the trade is built unchecked against a history, bounded only by the cap the owner signed, and the verdict's first reason, `no-trading-history`, says so. Tell the user before signing. **Never suggest a real mainnet trade to create history** |
| `agent` | your **public** key |
| `inputMint`, `outputMint` | 1 of them must be wrapped SOL, `So11111111111111111111111111111111111111112` |
| `amount` | base units of `inputMint` |
| `slippageBps` | at most 100 |

It returns `transaction`, base64 and unsigned, with you as the fee payer and the only signer. Sign
and send it at once, before `lastValidBlockHeight`, with `node ~/.agon/agon-kit.mjs send
<transaction>`, which prints the signature once the fork confirms it. It holds Jupiter's swap alone,
wrapped in Swig's sign instruction for your role, so the chain's cap applies to it. Measured on the
fork on 2026-09-29: a 0.1 wSOL swap built this way landed and left the allowance 100000000 lower,
and a 0.45 request with 0.4 left was refused before anything was built.

Any refusal means no transaction exists. Do not build one by hand instead.

## 8. Reading a refusal

**From the server.** Every error names its cause and the number in its first sentence, then what
to do. Read that sentence to the user. An error is a refusal, not a glitch to retry.

**From the chain.** When a swap fails, the **innermost failing program decides who refused.**
Find the first log line that reads `Program <id> failed`:

- If it is Swig and the text is `insufficient funds for instruction`, the **spending limit**
  refused the trade. It does not mean the vault is empty. Nothing moved. Wait for the window to
  reset, or ask the user; never retry with a smaller amount on your own.
- If it is Jupiter, Jupiter refused it, **not the spending limit**. A custom program error there
  usually means the price moved past the slippage allowed: quote again. On a fork that has run for
  hours this also happens because the fork's pools drift from the live quote; a fresh fork fixes it.
