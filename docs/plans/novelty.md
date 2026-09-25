# OP-14, is anyone already doing this

**Verdict: the claim holds, and the wording needs tightening before a judge tests it.**
Searched 2026-09-25. Nothing found, on Solana or off it, derives an AI trading agent's spend cap
from a human trader's own historical swaps and enforces that number on-chain.

## The nearest miss, and it is nearer than expected

[SENTINEL](https://github.com/Sriram-J-CS/SENTINEL), an x402-track hackathon project on **Algorand**,
genuinely does derive a threshold from history and write the decision on-chain. It baselines the
**agent's own runtime payment behaviour** (a rolling mean and standard deviation per merchant
category) and stores allow/deny receipts in Box Storage.

It fails the claim on three axes, and those three axes are exactly what our wording has to say out
loud: whose history (the agent's own runtime, not a trader's past swaps), what domain (x402 API
micropayments, so no positions, no stops, no hold time), and what the output is (a per-transaction
anomaly score after the fact, not a capped revocable permission set before the agent trades).

## The two piles, and the gap between them

Everything else splits cleanly, and the two piles do not talk to each other.

**On-chain caps, all typed in by a human:** Swig, Coinbase Agentic Wallets, MetaMask Agent Wallet,
Solana's native Subscriptions and Allowances, and the hackathon project xorr-solana. Every one has
the enforcement half and none has the derivation half.

**Analysis you read, never a permission:** Nansen for Agents (sells wallet profiles over MCP, stops
at data supply), Solana Tracker's wallet analysis API, and BingX copy trading, which is the one
place a number is derived from somebody's own history, as a 1 to 9 risk label shown to a copier,
off-chain, capping nothing.

Two live World's Fair entries are close enough to name: **colosseum-pools** enforces daily loss,
drawdown and leverage on-chain, but from fixed challenge parameters a pool creator sets;
**SolAegis** sells institutional guardrails for Solana agents using Half-Kelly and parametric VaR,
the same formula for every user rather than that user's history.

## The wording that survives ten minutes of searching

> Agon sizes an AI trading agent's spending permission from the trader's own historical Solana
> swaps, their stop discipline, position size and hold time, not from the agent's own runtime
> behaviour and not from a generic market-risk model, and enforces that exact number on-chain as a
> revocable capped permission before the agent trades, rather than scoring transactions for
> anomalies after the fact.

Every clause earns its place against a specific near miss: "the trader's own historical swaps, not
the agent's own runtime behaviour" rules out SENTINEL, "not from a generic market-risk model" rules
out SolAegis, "before the agent trades, rather than scoring after the fact" rules out SENTINEL's
anomaly scoring and BingX's label, and "on-chain as a revocable capped permission" rules out every
manually configured wallet.

## What was not searched, so the gap is known rather than assumed

- **Colosseum's own project directory and Copilot** need an account, so the PRD's "2,992 entries
  searched via Copilot" remains unverified by anyone else. This is the biggest gap: Copilot is
  probably the right tool and its coverage is unconfirmed.
- **The February Agent Hackathon site is gone**, returning "page not found"; coverage of it is from
  search caches and press only.
- **The x402 hackathon has no public submission directory**; only the roughly 10 winners named in
  press were checked.
- **The current World's Fair is in progress** and its entrants are behind the same login. Two were
  found only because their repos happened to be indexed. Someone could be building this right now,
  invisibly, until they post a demo.
- **X and Discord were not searchable** from here, and that is where builders post first.

Worth a follow-up pass: Superteam Earn listings, and MagicBlock's Solana Blitz v5, a
trading-app-focused hackathon that sits close to the subject matter.
