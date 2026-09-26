import { expect, test } from 'vitest'
import { connectable, solanaAddress } from './wallets.js'

const account = (address: string, chains: string[]) => ({ address, chains })
const wallet = (name: string, chains: string[], features: string[]) => ({
  name,
  icon: 'data:image/svg+xml;base64,',
  chains,
  accounts: [],
  features: Object.fromEntries(features.map((f) => [f, {}])),
})

test('Phantom and Backpack are offered, a wallet with no Solana chain or no connect is not', () => {
  const offered = connectable([
    wallet('Phantom', ['solana:mainnet', 'solana:devnet'], ['standard:connect']),
    wallet('Backpack', ['solana:mainnet'], ['standard:connect', 'standard:disconnect']),
    wallet('MetaMask', ['eip155:1'], ['standard:connect']),
    wallet('Half', ['solana:mainnet'], ['solana:signMessage']),
  ])
  expect(offered.map((w) => w.name)).toEqual(['Phantom', 'Backpack'])
})

test('the address shown is the Solana account the wallet returned, never a guess', () => {
  const address = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  expect(
    solanaAddress([account('0xabc', ['eip155:1']), account(address, ['solana:mainnet'])]),
  ).toBe(address)
  // A wallet that connects but shares no Solana account gives no address, so nothing is invented.
  expect(solanaAddress([account('0xabc', ['eip155:1'])])).toBeNull()
  expect(solanaAddress([])).toBeNull()
})
