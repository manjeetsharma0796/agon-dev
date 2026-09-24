# The beta waitlist

A static page that collects an email and a Solana address for the Agon beta. No framework, no
build step, no dependencies, no login, no wallet connection. It runs on any static host and
becomes a route when `apps/web` grows into a Next app.

- `index.html`, the page.
- `validate.mjs`, what a signup has to look like. Plain `.mjs` so the browser imports it directly
  and a server route imports the same file, rather than the rule being written twice and drifting.
- `validate.test.ts`, 21 cases, including 6 real mainnet addresses.

`ENDPOINT` in `index.html` is empty until someone deploys this. While it is empty the form
validates and then tells the visitor plainly that nothing was sent, rather than accepting a signup
it cannot store. Setting it is the only step needed to go live.

Anything importing this server side must call `checkSignup` itself. The browser check is a
courtesy to the person typing and is not a trust boundary.

## What it validates, and what it cannot

A Solana address has no checksum, so a typo that still decodes to 32 bytes is indistinguishable
from a real address. The shape is all that can be rejected: base58 with no `0`, `O`, `I` or `l`,
decoding to exactly 32 bytes. Leading `1`s are leading zero bytes and are counted once, which is
what makes `11111111111111111111111111111111` 32 bytes and not 33.

The email check is shallow on purpose. The only proof an address receives mail is mail arriving at
it, so the confirmation email is the real check and the code rejects only what cannot possibly
work. Every message names the cause, the number and what to do next, and both fields report at
once so nobody fixes one error per submit.
