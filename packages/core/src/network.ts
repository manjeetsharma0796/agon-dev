// Which chain this deployment points at, said the same way everywhere it is shown: the banner on
// every web page and the first field of every MCP tool result. One env var, AGON_NETWORK, read by
// both, so a person and an agent can never be told two different things.
//
// Fail closed: anything but an exact known value is "not set", never mainnet. A typo must not be
// how someone ends up believing test money is real, or real money is test.

export type NetworkId = 'fork' | 'devnet' | 'mainnet' | 'unset'

export interface Network {
  id: NetworkId
  /** For people: the banner sentence. */
  text: string
  /** For agents: the compact form that leads every MCP result. */
  short: string
  /** test: no real value. real: real funds. warn: not configured. */
  tone: 'test' | 'real' | 'warn'
}

const NETWORKS: Record<Exclude<NetworkId, 'unset'>, Network> = {
  fork: {
    id: 'fork',
    text: 'Local mainnet fork. Nothing here touches the real chain or real funds.',
    short: 'fork, a local test copy of mainnet, no real funds',
    tone: 'test',
  },
  devnet: {
    id: 'devnet',
    text: 'Devnet. Test tokens with no real value.',
    short: 'devnet, test tokens with no real value',
    tone: 'test',
  },
  mainnet: {
    id: 'mainnet',
    text: 'Mainnet. Real funds.',
    short: 'mainnet, real funds',
    tone: 'real',
  },
}

const UNSET: Network = {
  id: 'unset',
  text: 'Network not set. Treat nothing on this page as real until it is.',
  short: 'not set, treat nothing here as real',
  tone: 'warn',
}

export const network = (value: string | undefined): Network =>
  Object.hasOwn(NETWORKS, value ?? '') ? NETWORKS[value as keyof typeof NETWORKS] : UNSET
