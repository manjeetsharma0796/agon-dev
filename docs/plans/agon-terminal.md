# The Agon terminal: one trading screen on the web, in opencode, in Claude Code and in the agent

Status: design, 2026-10-03, for review. Not public. Decided in conversation by jishnu-baruah.

## Goal

A Binance-style trading screen for an Agon vault, with as many of its features as each surface can
honestly carry. Three things make it Agon's rather than a Binance copy:

1. **Every surface works with no LLM.** A person sees everything and does everything themselves, in
   the terminal or on the web. The agent is optional.
2. **The agent is a copilot on the same page.** At any point the person can hand the agent what they
   are looking at, or let the agent do the action. Everything either of them does lands in one
   shared record that both read.
3. **Every action passes one guard.** A trade from a button, a terminal key or the agent runs the
   same function: `check_trade` first, fail closed, signed inside the limits, recorded.

Success, measured:

- Every action in the parity table (section 7) marked "yes" for a surface can be done on that
  surface with 0 LLM calls, checked by a test per action per surface.
- An action taken on any surface appears in the agent's `get_activity` answer, and an action the
  agent takes appears in every surface's Activity panel, within 1 refresh (at most 15 s).
- The same number (P&L, cap used, a candle close) is identical on all 4 surfaces for the same slot,
  because exactly 1 place computes it (section 3).

## 1. Principles

- **1 calculator.** The MCP server computes every number. The web page, the opencode plugin and the
  Claude Code plugin fetch it and draw it. No surface does money arithmetic. This is CLAUDE.md's
  pure-core rule carried to the screens, and it removes the drift risk found on 2026-10-03: the Claude
  Code plugin cannot import code from the repo or npm, so a copied calculation would diverge.
- **1 action layer.** Each action is 1 function in the daemon and the MCP server. Buttons, keys and
  agent tools are callers. The LLM is one more caller with no extra power.
- **1 journal.** Every action, verdict, proposal, approval and failure is a row with who did it.
- **Honest parity.** Where a surface cannot carry a feature, it says so and links to where it can.
  Where Solana has no equivalent of a Binance feature, we show the true thing under its own name
  (section 7, order book).
- **Mints, never token text.** Token names reach no agent and no shared context (OP-38). Screens
  may show a name to the person; anything handed to the agent carries the mint only.

## 2. Who signs

Decided 2026-10-03: chosen per action.

| Caller | Inside the agent's remaining cap, verdict pass | Over the cap, or an owner-only job |
|---|---|---|
| Terminal (opencode, Claude Code) | The agent key the daemon holds signs | The terminal opens a web link with the order filled in; the owner's Phantom signs there |
| Web | The owner's Phantom signs | The owner's Phantom signs |
| Agent | The agent key signs | Refused with the cap, the amount and "the owner can do this on the web" |

Owner-only jobs are arm, change a cap, deposit, withdraw, revoke and Trigger orders placed by root
(OP-29). The agent key never holds `manageAuthority`, so these are never offered to it.

Every path runs `check_trade` first. A `block` stops it. An `unsure` stops it unless the person
confirms on that surface, and the confirmation is a journal row. Owner trades are not bounded by
the Swig cap, so the screen says that before Phantom opens: "Signed by your wallet, outside the
agent's 0.5 SOL limit. check_trade still applies."

Fork only until `TASKS.md` T-D04 has all 8 boxes and 2 sign-offs. The network banner stays on
every screen.

## 3. Data: what the MCP server answers

Read-only HTTP on the MCP server the compose file already runs, beside the MCP tools. Each answer
carries a stamp: network, data slot, rule version, and for every price its source, pool and time.

- `GET /overview?wallet=` (Portfolio): balances, open positions and realised and open P&L from
  T-C27's `vaultReport`; the return in SOL against holding SOL; the equity curve; the cap meter;
  rules.
- `GET /market?mint=&range=` (Trade view): candles, indicators, recent trades, depth by price impact,
  24h stats.
- `GET /activity?wallet=` (journal, section 4): signed read, below.

Methods, all arithmetic:

- **Against holding SOL.** Holding SOL scores 0 in SOL, so the vault's return in SOL is the
  comparison. Time-weighted, revalued at each deposit and withdrawal at its own slot's price, then
  chained. Money-weighted return is not used: it scores the owner's deposit timing, not the agent.
  Printed beside it: "In SOL; holding SOL scores 0. Net of N lamports of network fees paid by the
  agent key. K deposits and withdrawals adjusted at their own slot. Slots A to B." Below 30 trades:
  "6 trades is too few to judge a strategy."
- **Equity curve.** Holdings at each point rebuilt from the vault's events, times past closes from
  GeckoTerminal (mint USD over SOL USD). A missing price is a gap with its reason, never a line
  drawn across it. No snapshot job is needed.
- **Cap meter.** `used = recurringLimit - effectiveRemaining` per mint per window
  (`packages/chain/src/swig/index.ts`), the slot it refills at, and the burst worst case of 2 times
  the cap. Wording: "Spent 0.35 of 1.00 wSOL this window. This limits what the agent can spend, not
  what you can lose." Never "maximum loss", "safe", or "left today".
- **Indicators.** MA, EMA, Bollinger, RSI, MACD and volume, computed from the candles in the server,
  each with its parameters printed.
- **Order book and depth, by where the token trades** (research 2026-10-03):
  - Real books (Manifest, Phoenix, Hyperliquid perps): the book itself, stamped with its slot.
  - Concentrated liquidity (Meteora DLMM bins via `getBinsAroundActiveBin`, Raydium CLMM via
    `api-v3.raydium.io/pools/line/position`, measured at 9,100 levels for SOL/USDC, Orca tick arrays
    over RPC): liquidity at each price level, labelled "AMM liquidity, not resting orders".
  - Constant product and bonding curves: "cost to move the price 1, 2, 5, 10%" from the reserves,
    exact arithmetic, never drawn as a fake ladder.
  - Any token, as a cross-check: Jupiter quotes at 0.1, 1 and 10 SOL each side.
- **Live data.** `GET /stream` (server-sent events) fans out what the server holds upstream: Helius
  websockets (`slotSubscribe`, `accountSubscribe` on the pools on screen, `signatureSubscribe` for
  landing), so the order book and depth recompute on every pool account change. Upstream keys stay
  on the server; browsers and terminals only see our stream. Free tier first; Helius Developer
  ($49) adds `transactionSubscribe` for a pushed trades feed, CoinGecko Basic ($35) pushed candles.
- **Caching** by how often data changes: candles about 60 s per pool and range, balances 10 to 15 s,
  mint and freeze authority never.

## 4. The journal

One table in the Neon Postgres decided in `DECISIONS.md`. Row: id, time, slot, network, wallet,
actor (`owner-web`, `owner-terminal`, `agent`) and its public key, action, mint, amounts in base
units, verdict with reasons and rule version, transaction signature, status (`checked` and
`refused` for a `check_trade` call, then `proposed`, `approved`, `declined`, `expired`, `sent`,
`confirmed`, `failed`, `uncertain` for an action), and an optional note the person wrote. No token
names or descriptions.

- **Writing.** The action layer writes every row. A failed write never changes a verdict and never
  blocks a trade that already passed; the failure is itself reported by name on the next read.
- **Reading.** On-chain facts (balances, trades, P&L, cap) are public, so `/overview` needs no proof.
  The journal reveals what the agent tried and was refused, so `/activity` needs proof of the
  wallet: on the web the owner signs a short message in Phantom (no transaction, checked on the
  server); in the terminal and for the agent, a signature by a key the vault has hired. The agent
  reads it through a new MCP tool, `get_activity`, inside a token budget set with it.
- **Built (T-C30, 2026-10-03).** `GET /activity?wallet=` and `get_activity` share 1 function: the
  wallet alone gets a 60 s single-use nonce and the text to sign; the signer, nonce and an ed25519
  signature over it (checked with node:crypto) get rows only if the signer is the wallet or a key its
  vault hires on chain now. Budget 4,000 tokens at 10 rows, 3,478 measured. On Neon from this
  machine a write p50 is 279 ms and a read p50 278 ms over 20 calls each; the first write on a cold
  connection took 4,727 ms. Over MCP, `check_trade` carries no caller key, so its rows have
  `actorKey` null until the action layer (T-C32) passes who acted.

## 5. The copilot on every panel

- **Ask the agent.** Every panel has it. It builds a context packet: mint, range, position, the
  latest verdict, the numbers on screen and journal row ids, never token text, under 400 tokens like
  `check_trade`. In a terminal it fills the prompt. On the web it saves the packet as a journal note
  the agent reads with `get_activity`, and shows the line to paste.
- **Proposals.** When the agent proposes a trade, it is a `proposed` row. Every surface shows it as
  Approve or Decline with the verdict and the numbers. Unanswered after 120 s it becomes `expired`
  and does nothing. Approve runs the same action function as a direct trade.
- **Agent sees the person.** The agent's `get_activity` lists the person's own actions, so it can
  answer "why did I sell" and does not repeat or undo them.

## 6. Parts, in order

Each part ships on every surface before the next starts. Each later part gets its own spec.

1. **Foundation:** journal, action layer, `/overview`, `/market`, `/stream` and the status bar
   data. No screen.
2. **Portfolio:** section 8.
3. **Markets and the Trade view:** market list, search, favourites, 24h stats, chart with
   indicators, recent trades, depth by price impact. Read-only.
4. **Orders and copilot:** order panel (market, limit, stop, take-profit and stop-loss, percent of
   balance), open orders, history, cancel, pause, Approve and Decline, Ask the agent.
5. **Later, once bots exist:** bots (grid, DCA), alerts, a public P&L proof page, copy trading,
   leaderboard.

## 7. Parity table

| Feature | Web | opencode | Claude Code | Agent |
|---|---|---|---|---|
| Market list, search, favourites, 24h stats | yes | yes | yes | text; the web page itself in hosts with MCP Apps |
| Candles 1m to 1W | full | half-block, 68 to 128 candles by 32 px | half-block; SVG on desktop | MCP Apps |
| Crosshair readout | mouse and keys | mouse | desktop hover; terminal lists trades under the chart (a Raster takes no pointer) | n/a |
| Your trades on the chart | yes | yes | yes | listed |
| Indicators | all 6 | 2 overlays and 1 lower panel | same | numbers |
| Drawing tools, several charts, custom layouts | yes | no | no | no |
| Order book or depth (section 3, by pool type) | ladder and depth chart | ladder | ladder | top levels as numbers |
| Status bar (section 7b) | yes | yes | yes, in the band | `status` on request |
| Recent trades | yes | polled | polled | last N |
| Order entry | Phantom | agent key inside cap, else web link | same | agent key inside cap |
| Open orders, history, positions, assets | yes | yes | yes | yes |
| Portfolio, against holding SOL, equity curve | yes | yes | yes | text |
| Daily P&L calendar | yes | yes | desktop only | text |
| Alerts | browser notification | toast | toast | it tells you |
| Approve or Decline a proposal | yes | yes | yes | proposes |
| Ask the agent | journal note | fills prompt | fills prompt | n/a |

## 7b. What a standard terminal has out of the box

From 5 research passes on 2026-10-03 (Binance, Bybit, OKX; Axiom, Photon, GMGN, BullX, Padre,
Fomo, Jupiter, DexScreener, Birdeye, Hyperliquid; TradingView, MT5, QuantConnect, Freqtrade,
3Commas, Pionex, GIPS; Bloomberg, Eikon, k9s, lazygit, btop, cointop, hummingbot). "Std" means 3
or more of them have it, so a trader will look for it. Part says where we build it.

**Status bar** (every surface, always visible; Part 1)

| Item | Source | Refresh |
|---|---|---|
| Connection state: Live, Reconnecting (attempt n), Offline since hh:mm | our `/stream` | live |
| RPC ping in ms | timed `getSlot` | 5 s |
| Slot and slot lag against a second source | `slotSubscribe` | live |
| Data age of each panel ("prices 12 s old") | stamps | live |
| TPS | `getRecentPerformanceSamples` | 60 s |
| Priority fee levels for the pool on screen (accounts passed, or it reads 0) | `getRecentPrioritizationFees` | 10 s |
| Jito tip floor | Jito tip floor API | 10 s |
| SOL price | Jupiter Price v3, via our server | 10 s |
| Network (fork, devnet, mainnet) | `AGON_NETWORK` | static |
| Agent: on, paused, proposals waiting | journal | live |
| Ticker of favourites with price and change (Binance's bottom bar, checked live) | `/market` | 10 s |

Binance's live page shows only "Stable connection" and the ticker, no ms; Axiom reportedly lists
ping by region, unverified (403). We show the ms because it is free and it is what our users judge
landing by.

**Market and token header** (Part 3): price, market cap, FDV, liquidity, change 5m/1h/6h/24h,
volume, trades, makers, buys against sells, 24h high and low. Std. Token safety, all lookups and
arithmetic, never a model: holders, top 10 %, dev %, snipers %, insiders %, bundled %, LP burned or
locked, mint and freeze authority, bonding curve % and migration, age, the dev's past tokens.
Std. Shown to the person; the agent gets the mint and the guard's verdict only (OP-38).

**Discovery** (Part 3): market list with search, favourites, sort and filters (std); 3 columns new,
about to graduate, graduated (std on Solana); trending; top movers with a reason tag (Binance
"Pullback", "New High"); buy from the list (std, Part 4).

**Chart** (Part 3): candles from 1s to 1W (std), price or market cap, SOL or USD; indicators MA, EMA,
Bollinger, RSI, MACD, volume; crosshair; your trades and average entry line on the chart (std); dev
and tracked wallets' trades marked; open orders and TP/SL as lines (std, draggable in Part 4 on the
web); depth chart tab. Web only: drawing tools, multi-chart up to 4, saved layouts.

**Order book and trades** (Part 3): book or depth per section 3 with price grouping, depth bars, the
buy and sell ratio, spread row, own orders highlighted, click a level to fill the price (std);
trades feed with wallet labels dev, sniper, insider, tracked, you (std); holders and top traders
tabs (std).

**Order entry** (Part 4): market, limit, stop, TP/SL attached, trailing stop, DCA (std); quick-buy
presets in SOL and sells in % of position (std); 25/50/75/100% slider (std); saved fee presets
holding priority fee, tip, slippage and MEV mode (std); available balance, cap left, fee and price
impact before sending; confirmation on by default, one-tap trading only as an explicit setting (std).
A hotkey or button prepares an order; sending is a separate step.

**Bottom tabs** (Part 2 and 4): positions (size, average entry, mark, open P&L, realised P&L, share of
portfolio), open orders, order history with average fill and status, trade history with fee and
transaction link, assets, the journal. Std. CSV export (std on exchanges).

**Alerts** (Part 5): price, P&L and verdict alerts; browser notification, toast, sound as a setting.

**Wallet tracking, copy trading, X monitor** (Part 5, after bots).

**Performance numbers** (Part 2; formulas from TradingView, MT5, QuantConnect, Freqtrade, GIPS).
Every number shows its sample size and stays greyed with "too few to judge" below its minimum.

| Group | Numbers | Minimum before shown as meaningful |
|---|---|---|
| Returns | net P&L (realised + open - fees), realised, open, return in SOL time-weighted, against holding SOL, daily/weekly/monthly P&L and the calendar, cumulative P&L, equity curve | none, always shown with the method |
| Risk | max drawdown (value and %), drawdown duration, volatility, Sharpe, Sortino, Calmar | 30 return periods; Sharpe with its periods named |
| Trades | win rate, profit factor, expectancy, average win and loss, largest win and loss, payoff ratio, streaks | 30 closed trades; 100 to rely on |
| Execution | fees paid, slippage against quote in bps, fill rate, average holding time, trades per day, time in market | none |
| Portfolio | allocation, largest position share, open positions at risk | none |

Never shown: a realised-only total without open P&L beside it (the Pionex grid profit trap); a
return % that a deposit can move (we use time-weighted); win rate without payoff ratio; annualised
figures from under 30 days.

**Terminal keys** (opencode and Claude Code; only while the pane has focus, no Ctrl, Alt, Tab or F
keys, all of which the hosts or terminals already use):

| Key | Action | Key | Action |
|---|---|---|---|
| `j` `k` / arrows | move | `b` `s` | open buy or sell ticket, never sends |
| `g` `G` | top, bottom | `y` `n` | approve or decline the ticket or proposal |
| `h` `l` | previous, next panel | `x` / `X` | cancel order / cancel all, confirms |
| `[` `]`, `1` to `9` | tabs | `p` | pause the agent: no new entries, rules keep running |
| `/` | filter as you type | `a` | ask the agent about the selected row |
| `:` | command line | `o` | cycle sort |
| `?` | help | `R` | refresh |
| `Enter` / `Esc` | open / back | `q` | close the pane |

`Space` and `Enter` never send an order. Up and down are never colour alone: a sign, an arrow or a
word every time, and the 16 standard ANSI colours so the user's theme applies; `NO_COLOR` respected.

## 8. Part 2 in detail: Portfolio

Built on T-E20's `/vault?wallet=`. Order, chosen so the first look answers "what can it still spend",
then "am I up or down", then "what just happened":

1. Top bar: vault address with copy, slot, network, and "Stale: last read 3 min ago at slot N" after
   60 s.
2. Cap meter, one per agent role, written out as well as drawn.
3. Return against holding SOL with its method line; realised and open P&L side by side; wins and
   losses counted.
4. Balances: mint, amount, value in SOL or "no quote at slot N"; native SOL and each agent key's fee
   SOL apart.
5. Activity: the journal plus chain trades, newest first, filters All, Trades, Refused, each row
   with its reason word for word and its transaction link.
6. Price chart of a held mint with buy and sell markers.
7. Equity curve.
8. Rules.

Desktop 1440: 2 columns (P&L, chart, curve left; cap, balances, rules right), activity full width.
Phone 375: 1 column, 16 px gutter, in the order above with activity limited to 10 rows.

- **Web drawing.** TradingView lightweight-charts 5 (Apache-2.0, about 62 KB gzip, its attribution
  link left on) for the price chart only, loaded on the client; hand-written SVG for the curve and
  meter. Each chart in a `figure` with a caption computed by arithmetic and a table of the same
  points; keyboard crosshair (Left, Right, Home, End) with a live readout; buy and sell as arrows
  with B and S, gains with a sign and "up" or "down", never colour alone. New tokens `--gain`,
  `--loss`, `--buy`, `--sell` in `globals.css`, light and dark.
- **Terminal drawing.** opencode: `ascii_font` for the headline, braille for the curve, half-block
  cells drawn with `setCell` for candles, mouse crosshair. Claude Code: the pane, braille and Raster;
  candles with no pointer on the terminal, trades listed beneath; SVG on desktop. The Claude Code
  plugin moves into the repo so it ships with Agon.
- **Every empty and failure state** has its own sentence naming the cause, the number and the next
  step. Examples: "No vault for this wallet yet. Create one on the vault screen."; "No quote for 1 of
  6 trades (mint 7xKX...gAsU). P&L covers the other 5."; "GeckoTerminal returned no candles for pool
  58oQ...YQo2 (HTTP 404). Your 6 trades are still in Activity."

## 9. Safety

- Anything that moves funds fails closed: no verdict, no quote, a stale blockhash or a journal
  that cannot say what was sent means the trade does not go out.
- The UI never holds a key. Terminal trades sign in the daemon; web trades in Phantom.
- A sent trade whose result is unknown is `uncertain` and is never retried blindly; it is shown with
  its signature until the chain answers.
- `/security-review` on the action layer, the journal's signed read and the order panel.

## 10. Testing

- Money arithmetic test-first: time-weighted return with 2 deposits and 1 withdrawal, cap used across
  a window edge, the equity curve with a missing candle, indicators against hand values, all on a
  recorded vault checked by hand.
- One test per action per surface with 0 LLM calls (the success bar).
- Journal round trip: an action on the web shows in `get_activity`; an agent action shows in both
  terminal panes.
- Screens at 1280 and 375 px, light and dark, with 0 console errors, and a walk over every empty and
  failure state against the banned list (blank, N/A, undefined, null, NaN, "something went wrong").

## 11. Board rows

| Row | Part | What | Depends on |
|---|---|---|---|
| T-C30 | 1 | The journal: table, writes from `check_trade`, signed read, `get_activity` tool | none |
| T-C31 | 1 | `/overview`: against holding SOL, equity curve, cap meter, from T-C27's report | T-C27 |
| T-C32 | 1 | The action layer: 1 function per action, signer chosen per section 2, journal rows | T-C30 |
| T-C33 | 1 | `/market`: candles, indicators, recent trades, order book or depth by pool type, 24h stats | none |
| T-C34 | 1 | `/stream` and the status bar data: Helius websockets fanned out, ping, slot lag, fees, tip | none |
| T-E20 | 2 | `/vault`, exists, grows into section 8 | T-C27, T-C31 |
| T-E21 | 2 | Portfolio in opencode | T-C31 |
| T-E22 | 2 | Portfolio in Claude Code, plugin moved into the repo | T-C31 |
| later | 3 to 5 | One row per part per surface, added when the previous part lands | |

## 12. Open, for a human

1. The 120 s proposal expiry.
2. The stale limit of 60 s.
3. Whether Part 3's market list starts from discovery's sources (Jupiter lists, GeckoTerminal) or a
   pinned watchlist.
