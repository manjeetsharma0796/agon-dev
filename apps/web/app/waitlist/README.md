# The beta waitlist

T-E02. Recruiting is the slowest part of CP3, so this exists to start collecting on day 1 rather
than to be elegant. It is 3 files and 0 dependencies, and it goes live on any static host.

- `index.html`, the page. No framework, no build, no login, no wallet connection.
- `validate.mjs`, what a signup has to look like. Plain `.mjs` so the browser imports it directly
  today and the server route T-E03 adds imports the same file, rather than the rule being written
  twice and drifting.
- `validate.test.ts`, 20 cases, including 6 real mainnet addresses.

## It is not live yet

`ENDPOINT` in `index.html` is empty, so the form validates and then tells the visitor plainly that
nothing was sent. That is deliberate. A waitlist that looks like it accepted you and dropped you is
the one failure this task cannot recover from, because the person does not come back. **OP-18**
covers the host and the inbox.

## Putting it live

1. Stand up somewhere to receive a POST of `{ "email": "...", "address": "..." }` that returns 2xx
   and sends 1 confirmation email. Any form backend does; a Neon table (OP-6) is not needed to
   start and should not hold this up.
2. Set `ENDPOINT` in `index.html` to that URL.
3. Deploy this directory as static files. The 3 files sit next to each other and `index.html`
   imports `./validate.mjs` relatively, so nothing needs rewriting.
4. Submit once yourself and confirm the email arrives, then paste the live URL into T-E02's
   `Evidence:` line. Recruiting starts the same day.

When T-E03 turns `apps/web` into a real Next app, this becomes a route and a route handler. The
handler must call `checkSignup` from `validate.mjs` server side: the browser check is a courtesy to
the person typing and is not a trust boundary.

## What it validates, and what it cannot

A Solana address has no checksum, so a typo that still decodes to 32 bytes is indistinguishable
from a real address. The shape is all that can be rejected: base58 with no `0`, `O`, `I` or `l`,
decoding to exactly 32 bytes. Leading `1`s are leading zero bytes and are counted once, which is
what makes `11111111111111111111111111111111` 32 bytes and not 33.

The email check is shallow on purpose. The only proof an address receives mail is mail arriving at
it, so the confirmation email is the real check and the code rejects only what cannot possibly
work. Every message names the cause, the number and what to do next, and both fields report at
once so nobody fixes one error per submit.
