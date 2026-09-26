// Which installed wallets we offer, and which address we read from one. Pure, so it is tested
// without a browser or an extension.
//
// Only the shape we read is typed here, so any Wallet Standard wallet fits it. Connection only:
// nothing in this folder reads a signing feature, and a test fails the build if one appears.

export interface ConnectableWallet {
  readonly name: string
  readonly icon: string
  readonly chains: readonly string[]
  readonly features: Readonly<Record<string, unknown>>
}

export interface ConnectedAccount {
  readonly address: string
  readonly chains: readonly string[]
}

const isSolana = (chain: string): boolean => chain.startsWith('solana:')

/** Wallets that speak Solana and can connect. Phantom and Backpack both register this way. */
export const connectable = <W extends ConnectableWallet>(wallets: readonly W[]): W[] =>
  wallets.filter((w) => w.chains.some(isSolana) && 'standard:connect' in w.features)

/** The Solana address the wallet shared, or null. Never typed by the user, never guessed. */
export const solanaAddress = (accounts: readonly ConnectedAccount[]): string | null =>
  accounts.find((a) => a.chains.some(isSolana))?.address ?? null
