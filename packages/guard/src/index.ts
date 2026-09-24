// check_trade: arithmetic first, a model only for the 3 non-numeric questions. Owned by T-C06.

// The verdict itself. Pure: it composes the 3 reads below and makes none of its own.
export {
  LIMITS,
  RULE_VERSION as CHECK_TRADE_RULE_VERSION,
  STOP_TOLERANCE_POINTS,
  checkTrade,
  type Quote,
  type SpendAsset,
  type TradeFacts,
} from './check-trade.js'

// The mint check is the primary token-safety path and reads the chain itself. T-C04.
export {
  checkMints,
  RULE_VERSION,
  type MintCheck,
  type MintCheckDeps,
  type MintFacts,
} from './mint-check.js'

// The Jev client and the injection screen, T-C05. The only part of the guard that asks a model
// anything, and the only 3 questions it is allowed to ask.
export * from './jev/index.js'
