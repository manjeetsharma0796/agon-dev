// What the waitlist accepts, in one place. Plain .mjs with 0 dependencies on purpose: the same
// module is imported by the static page in the browser and by whatever server route T-E03 puts in
// front of it, so the rule that decides a signup cannot drift between the two. Client side
// validation is a courtesy to the person typing; the server calls the same functions and is the
// one that actually decides.

// Bitcoin base58: no 0, no O, no I, no l, because those are what people misread and mistype.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]))
const ADDRESS_BYTES = 32
const MAX_EMAIL = 254 // RFC 5321 path limit, and a cheap bound on what we store
// 32 bytes of base58 is 43 or 44 characters. The bound is here because decoding is quadratic in
// the length of the input, and this runs on whatever someone pastes into a public form.
const MAX_ADDRESS = 64

/** Decodes base58, or returns the first character that is not base58. */
export function decodeBase58(text) {
  // Leading '1's are leading zero bytes and carry no value, so they are counted and removed before
  // the number is decoded. Decoding them as digits and then adding the zero bytes counts each one
  // twice over, which is how the System Program address, 32 '1's and nothing else, came out as 33
  // bytes and got rejected as malformed.
  let zeros = 0
  while (zeros < text.length && text[zeros] === '1') zeros++

  const bytes = []
  for (const char of text.slice(zeros)) {
    const value = INDEX.get(char)
    if (value === undefined) return { ok: false, badChar: char }
    let carry = value
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  bytes.reverse()

  const out = new Uint8Array(zeros + bytes.length)
  out.set(bytes, zeros)
  return { ok: true, bytes: out }
}

/**
 * A Solana address is 32 bytes of base58. It is not checksummed, so a typo that still decodes to
 * 32 bytes is indistinguishable from a real address: we can reject the shape and nothing more.
 */
export function checkAddress(input) {
  const value = String(input ?? '').trim()
  if (value === '') {
    return { ok: false, reason: 'Enter your Solana address. It is the one your wallet shows you.' }
  }
  if (value.length > MAX_ADDRESS) {
    return {
      ok: false,
      reason:
        `That is ${value.length} characters. A Solana address is 44 at most, so this is not one. ` +
        `Paste just the address.`,
    }
  }
  const decoded = decodeBase58(value)
  if (!decoded.ok) {
    return {
      ok: false,
      reason:
        `"${decoded.badChar}" is not part of a Solana address. Addresses never contain 0, O, I ` +
        `or l, because they are too easy to misread. Check that character and try again.`,
    }
  }
  if (decoded.bytes.length !== ADDRESS_BYTES) {
    return {
      ok: false,
      reason:
        `That is ${decoded.bytes.length} bytes and a Solana address is ${ADDRESS_BYTES}. ` +
        `Paste the whole address rather than typing it, in case a character was dropped.`,
    }
  }
  return { ok: true, value }
}

/**
 * Deliberately shallow. The only proof an address can receive mail is mail arriving at it, so the
 * confirmation email is the real check and this rejects what cannot possibly work.
 */
export function checkEmail(input) {
  const value = String(input ?? '').trim()
  if (value === '') return { ok: false, reason: 'Enter your email so we can send you your report.' }
  if (value.length > MAX_EMAIL) {
    return {
      ok: false,
      reason: `That email is ${value.length} characters and the limit is ${MAX_EMAIL}.`,
    }
  }
  const parts = value.split('@')
  if (parts.length !== 2) {
    return {
      ok: false,
      reason: `An email needs exactly 1 "@" and that has ${parts.length - 1}.`,
    }
  }
  const [local, domain] = parts
  if (local === '') return { ok: false, reason: 'There is nothing before the "@".' }
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return {
      ok: false,
      reason: `"${domain}" is not a domain we can send to. Check what is after the "@".`,
    }
  }
  if (/\s/.test(value)) return { ok: false, reason: 'That email contains a space. Remove it.' }
  return { ok: true, value: value.toLowerCase() }
}

/** One signup, checked. Returns every problem at once, so nobody fixes one field at a time. */
export function checkSignup({ email, address }) {
  const checked = { email: checkEmail(email), address: checkAddress(address) }
  const errors = Object.fromEntries(
    Object.entries(checked)
      .filter(([, result]) => !result.ok)
      .map(([field, result]) => [field, result.reason]),
  )
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { email: checked.email.value, address: checked.address.value } }
}
