# Quickstart

Agon reads a wallet's own trading history, finds the rules it actually follows, and can turn them
into a spending cap enforced on Solana. The key never leaves the wallet, and the agent's role is
capped and revocable.

There are two ways in. Both start read only.

## As a person: from nothing to a report

1. Open the site.
2. Paste a Solana address and press **Read my history**.

That is it. The report opens on its own and shows what the wallet actually does: how it sizes
trades, how long it holds, whether it cuts losses at a consistent point, and what breaking its own
rules has cost.

**No account, no login, nothing to sign.** An address is public information, and pasting one tells
Agon nothing the chain does not already say. No signature is requested and no wallet connection is
made, because reading a history needs neither.

Every number on the report says what it is based on. If only part of a history could be read, the
report says so and says why, rather than presenting a partial answer as a complete one.

## As an agent: the four MCP tools

The server exposes exactly four tools, documented with their full schemas in
[`mcp-tools.md`](./mcp-tools.md):

| Tool | What it does |
|---|---|
| `get_report` | the trading profile for a wallet |
| `check_trade` | whether one proposed trade fits that profile |
| `arm_rule` | turn a rule into an on-chain cap the user signs for |
| `list_rules` | the caps currently armed |

The list is stable on purpose: an agent's prompt cache is keyed on it, so adding or reordering a
tool costs every user a cache miss.

`get_report` and `check_trade` are read only and sign nothing. `arm_rule` is the only one that ever
asks for a signature, and it is the user who gives it.

## What Agon will not do

- **It never holds your key.** The agent gets a Swig role scoped to one program and one capped
  recurring limit. It never holds `manageAuthority`, so it cannot widen its own permissions.
- **It fails closed on anything that can move funds.** If a token cannot be verified, the trade does
  not go out. The message says which check failed and what you can do about it.
- **It never invents a number.** A rule needs 20 closed trades before Agon claims you follow it.
  Below that it says how many you have and shows the statistics it can stand behind instead.

## Rerunning the numbers

Any claim in the pitch should be checkable by someone who does not trust us. `benchmark/` holds the
scenarios and the harness; the feasibility spikes record what was measured, when, and against which
slot. A spike that has not run says "not run" rather than nothing.
