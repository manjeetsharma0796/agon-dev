// On its own, with no imports, so the browser can show it without pulling node:fs into the bundle
// along with it. One definition: legs.ts re-exports this and the page reads it from here.

/** Said next to any number these legs produce. Analytics may fail open, but only if they state
 *  what they are based on, and none of this is based on the wallet that was pasted. */
export const FIXTURE_NOTE =
  'Built from a recorded fixture, not from this wallet. No chain data has been read.'
