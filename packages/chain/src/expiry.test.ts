import { expect, test } from 'vitest'
import { agentRoleActions, type RoleActions } from './swig/index.js'
import {
  expiryExplanation,
  faultsInAuthorisation,
  faultsInRole,
  isSpent,
  shouldSubmit,
  type ExpiryAuthorisation,
} from './expiry.js'

const USER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const AGENT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SWIG = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const NONCE_ACCOUNT = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const auth = (over: Partial<ExpiryAuthorisation> = {}): ExpiryAuthorisation => ({
  swigAddress: SWIG,
  roleId: 1,
  nonceAccount: NONCE_ACCOUNT,
  nonce: 'HhXe2PbtXQHzZ5Ch46MBXf7rEbMgnYsCGaEhktyKGZNT',
  expiresAtSlot: 450_100_000,
  signers: [USER],
  owner: USER,
  ...over,
})

test('a well formed authorisation has nothing wrong with it', () => {
  expect(faultsInAuthorisation(auth(), AGENT)).toEqual([])
})

test('the agent never signs its own expiry, which is the entire point', () => {
  // An expiry the agent signed is an expiry the agent controls, and a key that can end its own
  // constraint is not constrained.
  const faults = faultsInAuthorisation(auth({ signers: [USER, AGENT] }), AGENT)
  expect(faults.join(' ')).toContain('The agent key')
  expect(faults.join(' ')).toContain('only you can authorise')
})

test('an expiry the user did not sign is refused', () => {
  const faults = faultsInAuthorisation(auth({ signers: ['someone-else'] }), AGENT)
  expect(faults.join(' ')).toContain('did not sign this expiry')
})

test('exactly 1 signature, because every extra signer is another veto on your own rule ending', () => {
  const faults = faultsInAuthorisation(auth({ signers: [USER, 'co-signer'] }), AGENT)
  expect(faults.join(' ')).toContain('needs exactly 1')
})

test('an expiry with no durable nonce is refused, because it would be dead in 2 minutes', () => {
  // The whole scheme rests on this. A blockhash-anchored transaction signed at arm time is refused
  // by the chain long before the rule is due, and the rule would simply never end.
  expect(faultsInAuthorisation(auth({ nonce: '' }), AGENT).join(' ')).toContain('durable nonce')
  expect(faultsInAuthorisation(auth({ nonceAccount: '' }), AGENT).join(' ')).toContain('2 minutes')
})

test('the nonce account is not the Swig account', () => {
  const faults = faultsInAuthorisation(auth({ nonceAccount: SWIG }), AGENT)
  expect(faults.join(' ')).toContain('owned by the system program')
})

test('the role being removed has to be the agent role and nothing else', () => {
  const agent = agentRoleActions({ mint: USDC, recurringAmount: 1_000n, window: 100n })
  expect(faultsInRole(agent, USDC)).toEqual([])

  const rootish = {
    count: 5,
    isRoot: () => true,
    canManageAuthority: () => true,
    canCloseSwigAuthority: () => true,
    canUseProgram: () => true,
    canSpendTokenMax: () => true,
    tokenSpendLimit: () => null,
  } satisfies RoleActions
  expect(faultsInRole(rootish, USDC).join(' ')).toContain('not an Agon agent role')
})

test('the daemon does not submit before the rule is due, and says how early it would be', () => {
  const decision = shouldSubmit(auth(), 450_099_000, AGENT)
  expect(decision.submit).toBe(false)
  expect(decision.submit === false && decision.reason).toContain('1000 slots early')
})

test('it submits at the due slot, and after it', () => {
  expect(shouldSubmit(auth(), 450_100_000, AGENT).submit).toBe(true)
  expect(shouldSubmit(auth(), 450_200_000, AGENT).submit).toBe(true)
})

test('a faulty authorisation is never submitted, however overdue it is', () => {
  const decision = shouldSubmit(auth({ signers: [USER, AGENT] }), 999_999_999, AGENT)
  expect(decision.submit).toBe(false)
  expect(decision.submit === false && decision.reason).toContain('The agent key')
})

test('a moved nonce means the authorisation is spent, and that is not a failure', () => {
  // The user revoking by hand first is the common case. The role is gone, which is what they asked
  // for, and reading that off a submit error instead would report a working expiry as broken.
  expect(isSpent(auth(), auth().nonce)).toBe(false)
  expect(isSpent(auth(), 'a-different-nonce')).toBe(true)
  expect(isSpent(auth(), null)).toBe(true)
})

test('the user is told both limits before signing, not after', () => {
  const text = expiryExplanation(auth())
  // Early submission is possible and the explanation must not pretend otherwise.
  expect(text).toContain('send it early')
  // And expiry is best effort: if the daemon is down, nothing happens.
  expect(text).toContain('if Agon is not running')
  expect(text).toContain('end the rule yourself from your wallet')
  expect(text).toContain('gains no permission')
})
