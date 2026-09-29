# Setting up an agent against Agon

For an AI agent, or the person wiring one up. Everything below was checked against the server's
handlers, and anything that is not real yet says so.

## Paste this to start

```text
You have an MCP server called agon. Before any trade, call check_trade with the wallet, the mint,
the side and the size in base units (1 SOL is 1000000000). Every answer starts with a "network"
field: tell the user which network before you quote any number. Treat "unsure" and "block" as
"the trade does not go out", and tell the user the reason word for word. Never propose a spending
limit yourself: arm_rule returns a link, and the user sets the limit on that page with their own
wallet. To see what you are allowed to spend, call list_rules and quote effectiveRemaining, with
rollingWorstCase beside it. If a call returns an error, read its first sentence to the user and do
not retry the same call.
```

## 1. Run the server

The server speaks MCP over Streamable HTTP at `/mcp`, with a health check at `/health`.

```bash
docker compose up -d --build
```

That starts a mainnet fork on `127.0.0.1:8899` and the MCP server on `http://127.0.0.1:8787/mcp`,
both bound to this machine only. The server has no authentication, so do not bind it to a public
address.

As shipped, this compose file sets neither `AGON_RPC_URL` nor `AGON_PUBLIC_URL` for the server, so
`list_rules` and `arm_rule` refuse with that reason. `check_trade` and `get_report` work. To read
the fork's vaults, the server needs `AGON_RPC_URL` pointed at the fork; to hand out arming links, it
needs `AGON_PUBLIC_URL` set to where the arming screen is served.

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

## 4. The four tools, as they behave today

| Tool | What it really does now |
|---|---|
| `check_trade` | Real rule engine over the wallet's decoded history. Answers `pass`, `block` or `unsure`, and every non-pass names the rule and the number. |
| `get_report` | Answers from a recorded example, the same figures for any wallet, with a `note` saying so. Repeat the note if you quote it. |
| `arm_rule` | Arms nothing. Returns a link to the arming screen, on the practice fork only. A request that carries a cap is refused. |
| `list_rules` | Reads the wallet's vault from the chain this deployment names. Needs `AGON_RPC_URL`; without it the call refuses, which is not the same as "no rules". |

Two facts that change how you read `check_trade`:

- **It cannot return `pass` today.** It takes no price quote, so `quote-missing` is always among
  its reasons, and the wallet's category mix is not computed yet, so `category-mix-missing` is too.
  Both are `unsure`. A successful call is one that returns a verdict with its reasons. No model is
  asked anything: the token's category and the impostor check are lookups, and the token's own
  name and description never appear in an answer.
- **Size is checked on a buy only.** A sell returns no size reason. That is a gap, not a pass.

`arm_rule` takes `wallet`, `mints` (a list), `triggerType` (for example `"stop"`) and `expiresAt`
(a date-time, or `null`), and nothing else: an extra field such as a cap is refused. Full input and
output schemas: [`mcp-tools.md`](./mcp-tools.md).

## 5. Where the agent's key lives

The agent has its own keypair. **It is never the user's key**, and Agon never sees either.

- Generate the agent's keypair on the machine the agent runs on and keep its secret in that
  machine's OS keychain. Never in a `.env` file, a log, a chat or anything hosted.
- Give the user only the agent's **public** key. They paste it on the arming screen, and their own
  wallet signs a role for it.
- That role can do 1 thing: spend 1 mint through Jupiter, up to a cap per window of slots. It never
  holds `manageAuthority`, so the agent cannot raise its own cap. The user can revoke it at any
  time from the same screen.

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

There is no tool that builds this yet. This is the recipe measured on the fork, where it landed
and a 0.1 wSOL swap left the allowance 100000000 lower.

1. Ask Jupiter for a quote, then for `swap-instructions`, with `userPublicKey` set to the **vault**
   address from `list_rules`, `wrapAndUnwrapSol: false` and `asLegacyTransaction: true`.
2. Take only `swapInstruction`. Drop the setup and cleanup instructions: the vault's token accounts
   already exist, and the role allows neither the associated token program nor the token program.
3. Wrap it in Swig's sign instruction for your role id (`getSignInstructions` in
   `@swig-wallet/classic`).
4. Put the compute budget instruction **outside** the wrap, first in the transaction. Wrapping it
   is refused.
5. Sign with the agent key alone and send.

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
