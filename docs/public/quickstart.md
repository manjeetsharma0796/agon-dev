# Quickstart

Agon reads a wallet's own trading history, finds the rules it actually follows, and can turn them
into a spending cap enforced on Solana. The key never leaves the wallet, and the agent's role is
capped and revocable.

There are two ways in. Both start read only.

## As a person: from nothing to a report

1. Open the site.
2. Paste a Solana address and press **Read my history**.

The report page shows the shape of the answer: how a wallet sizes trades, how long it holds,
whether it cuts losses at a consistent point, and what breaking its own rules has cost. **Today it
shows a recorded example, not the wallet you pasted,** and says so at the top. The rule engine
behind `check_trade` below is real; the report page is not wired to it yet.

**No account, no login, nothing to sign.** An address is public information, and pasting one tells
Agon nothing the chain does not already say. No signature is requested and no wallet connection is
made, because reading a history needs neither.

Every number on the report says what it is based on. If only part of a history could be read, the
report says so and says why, rather than presenting a partial answer as a complete one.

## As an agent: the seven MCP tools

The server exposes exactly seven tools, documented with their full schemas in
[`mcp-tools.md`](./mcp-tools.md):

| Tool | What it does |
|---|---|
| `get_report` | the trading profile, from a recorded example today, labelled as one |
| `check_trade` | whether one proposed trade fits the wallet's own rules, from its real history |
| `arm_rule` | a link to the arming screen, where the user sets the cap and signs; practice fork only |
| `list_rules` | the agent roles armed on the wallet's vault, read from the chain |
| `prepare_swap` | 1 unsigned swap from the vault for the agent to sign, built only when `check_trade` passes with the real quote |
| `vault_status` | the vault's P&L, first in first out: realised from its sells, unrealised on what it still holds at what selling it fetches now, in SOL and dollars, each price with its source |
| `sync_fork` | practice fork only: refreshes a stale pool and moves a lagging fork clock forward |

To connect an agent, start with [`agent-setup.md`](./agent-setup.md).

The list is stable on purpose: an agent's prompt cache is keyed on it, so adding or reordering a
tool costs every user a cache miss.

`get_report` and `check_trade` are read only and sign nothing. `arm_rule` signs nothing either: it
returns a link, and the user's own wallet signs on that page. An agent never names the cap, and a
request that carries one is refused.

## What Agon will not do

- **It never holds your key.** The agent gets a Swig role scoped to one program and one capped
  recurring limit. It never holds `manageAuthority`, so it cannot widen its own permissions.
- **It fails closed on anything that can move funds.** If a token cannot be verified,
  `check_trade` answers `unsure`, which means the trade does not go out, and says which check
  failed. That answer binds an agent that follows it; what the chain itself enforces is the cap.
- **It never invents a number.** A stop rule needs 20 closed trades and 5 losses before Agon claims
  you follow it. Below that it says how many you have and shows the statistics it can stand behind
  instead.

## Rerunning the numbers

Any claim in the pitch should be checkable by someone who does not trust us. `benchmark/` holds the
scenarios and the harness; the feasibility spikes record what was measured, when, and against which
slot. A spike that has not run says "not run" rather than nothing.
