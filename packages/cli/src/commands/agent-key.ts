// `agon agent-key`: the agent's public key, made in the OS keychain on first run and read back
// after. It prints the public key and nothing else, 1 line, so an agent can hand exactly that line
// to the user for the arming screen. The secret is never printed, logged, returned or written by
// this file; `agentKey()` keeps it in the keychain.

import { agentKey } from '../daemon/keystore.js'

type Write = (s: string) => void

/** Exit code 0 with the public key on `out`, or 1 with the cause and the next step on `err`. */
export function runAgentKey(
  out: Write = (s) => void process.stdout.write(s),
  err: Write = (s) => void process.stderr.write(s),
  service?: string,
): number {
  try {
    out(`${agentKey(service).publicKey.toBase58()}\n`)
    return 0
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    err(
      `Could not get the agent key from the OS keychain: ${cause}\n` +
        (/run again/.test(cause)
          ? ''
          : 'Tried to read the entry "agent-key" and, when it was missing, to create it. Unlock or ' +
            'enable the OS keychain (Credential Manager on Windows, Keychain on macOS, the Secret ' +
            'Service such as gnome-keyring on Linux) and run `agon agent-key` again. A Linux ' +
            'server with no desktop has no Secret Service, and the key is never kept anywhere ' +
            'that would lose it on a restart.\n'),
    )
    return 1
  }
}
