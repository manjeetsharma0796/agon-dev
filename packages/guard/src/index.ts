// check_trade: arithmetic first, a model only for the 3 non-numeric questions. Owned by T-C06.

// The mint check is the primary token-safety path and reads the chain itself. T-C04.
export {
  checkMints,
  RULE_VERSION,
  type MintCheck,
  type MintCheckDeps,
  type MintFacts,
} from './mint-check.js'
