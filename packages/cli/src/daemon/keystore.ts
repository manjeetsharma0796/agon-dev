// The agent's key lives in the OS keychain and nowhere else: Keychain on macOS, Credential Manager
// on Windows, Secret Service on Linux. It is generated here, on the user's machine, the first time
// it is asked for, and every later call reads it back. Nothing in this file writes it to a file,
// reads it from an environment variable, logs it or returns it as text.
//
// It is never the user's wallet key. It is a separate keypair whose only power is the capped Swig
// role the user signs for it on the arming screen, which never includes manageAuthority.

import { Entry } from '@napi-rs/keyring'
import { Keypair } from '@solana/web3.js'

const SERVICE = 'agon'
const ACCOUNT = 'agent-key'

/**
 * A keychain entry, pinned on Linux to the Secret Service (gnome-keyring, KWallet). Unpinned, the
 * binding silently falls back to the kernel keyring, which lives in memory: measured 2026-10-01 in
 * a Linux container, a key written there read back in a new process and was gone after a restart.
 * `agentKey()` would then quietly make a new key while the armed role names the old one. Pinned, a
 * machine with no Secret Service refuses instead. On macOS and Windows the option does nothing.
 */
export const keychainEntry = (service: string, account: string): Entry =>
  new Entry(service, account, { linux: { store: 'secret-service' } })

/** The agent keypair, created in the keychain on first use. `service` is a seam for tests only. */
export function agentKey(service: string = SERVICE): Keypair {
  const entry = keychainEntry(service, ACCOUNT)
  const stored = entry.getSecret()
  if (stored !== null) {
    if (stored.length !== 64) {
      throw new Error(
        `The agent key in the OS keychain is ${stored.length} bytes where 64 were expected, so it ` +
          `was not used. Delete the "${service}" entry named "${ACCOUNT}" and run again to make a new one.`,
      )
    }
    return Keypair.fromSecretKey(Uint8Array.from(stored))
  }
  const fresh = Keypair.generate()
  entry.setSecret(fresh.secretKey)
  return fresh
}
