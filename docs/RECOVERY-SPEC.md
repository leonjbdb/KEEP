# KEEP: PKR v1/v2 recovery specification

This document lets a technically skilled person recover the protected
password **without any of this project's code**, using only standard
cryptographic primitives. A tested reference implementation accompanies
it in `tools/recover.py` (Python 3, standard library only).

A copy of this document and of `recover.py` travels inside every
`keep.html` and `RECOVERY.html`, in an HTML comment a browser never
shows: open the file in a text editor and search for `MANUAL RECOVERY`.

## 1. What exists

Naming: this spec and the source code say "card"; the app's interface
calls the same thing a "key". They are one and the same object.

- **n share cards** (default 5), handwritten, held by n different people.
  Each is a 67-character `bech32m` string starting `PSR1`.
- **A kit file** `RECOVERY.html` (the owner's USB sticks). It embeds a
  binary **PKR vault** (base64) inside:
  `<script type="application/json" id="pkr-vault">BASE64</script>`
- **Format v2 only: an owner's key**, a 67-character `bech32m` string
  starting `KEEP1`, kept by the owner separately from the kit file. It
  carries the K_app key half that a v1 vault stores at offset 54.
- Recovery needs the vault **plus any k cards** (threshold k, default 3;
  the actual k and n are stored in the vault header) — and for a v2
  vault **the owner's key as well**. Fewer than k cards carry
  mathematically zero information about the password. The vault without
  cards is protected by AES-256 with half of its key missing; a v2 vault
  is missing that half even with all n cards present, until the owner's
  key supplies it.

## 2. Card format (bech32m, BIP-350)

```
PSR1 <version:1 symbol> <payload:56 symbols> <checksum:6 symbols>
```

- Human-readable part `psr`, separator `1`, then 63 data characters in
  the bech32 charset `qpzry9x8gf2tvdw0s3jn54khce6mua7l`, checksum
  constant `0x2BC830A3` (bech32m).
- First data symbol: format version, value `1`.
- Remaining 56 symbols: 5-bit groups of a 35-byte payload
  (big-endian bit packing, BIP-173 `convertbits(8→5, pad)`):

| bytes | field |
|---|---|
| 1 | card index x (1..n) |
| 2 | set_id (matches vault header) |
| 32 | Shamir share y |

Input normalization: strip whitespace/hyphens, uppercase, then map
`O` → `0` (the letter is not in the charset, so it can only be a
misread zero). The checksum detects any error touching ≤ 4 characters.

The canonical form is uppercase; handwriting adds groups of 4
(`PSR1 XXXX …`). Uppercase avoids the l/1/I lookalikes, and the
charset contains no `O`, `I` or `B`, so every round glyph is the
digit `0` and every `1` is the digit one. Decoders accept any case:
the bech32m checksum arithmetic runs over the lowercased string.

### 2b. Owner's key format (v2 kits only)

```
KEEP1 <version:1 symbol> <payload:55 symbols> <checksum:6 symbols>
```

Same bech32m machinery and normalization as the cards, with
human-readable part `keep`. First data symbol: version, value `1`.
Remaining 55 symbols: the 5-bit groups of a 34-byte payload (same
`convertbits(8→5, pad)` — the final 3 padding bits are zero):

| bytes | field |
|---|---|
| 2 | set_id (matches vault header) |
| 32 | K_app |

Total length is 67 characters, like a card; the `KEEP1` prefix and HRP
tell the two kinds apart.

## 3. PKR vault container (all integers little-endian)

| offset | len | field |
|---|---|---|
| 0 | 8 | magic `89 50 4B 52 0D 0A 1A 0A` (`\x89PKR\r\n\x1a\n`) |
| 8 | 2 | format_version = 1 or 2 |
| 10 | 8 | created_at (unix seconds, u64) |
| 18 | 1 | threshold k |
| 19 | 1 | number of cards n |
| 20 | 2 | set_id |
| 22 | 32 | hkdf_salt |
| 54 | 32 | v1: K_app (random key half stored only in the kit file). v2: owner commitment (below); K_app lives only on the owner's key |
| 86 | 12 | AES-GCM nonce |
| 98 | 32·n | share commitments, i = 1..n |
| 98+32n | 4 | ct_len (u32) |
| 102+32n | ct_len | ciphertext ‖ 16-byte GCM tag |
| end−32 | 32 | file_digest = SHA-256 of all preceding bytes |

The two versions differ **only** in what the 32 bytes at offset 54 mean;
every other field, offset, and domain string is identical.

Valid parameters: v1 requires `2 ≤ k ≤ n ≤ 10` — with K_app in the
file, a single card plus any file copy would be the whole secret. v2
allows `1 ≤ k ≤ n ≤ 10`: k = 1 is the constant polynomial (every share
IS K_share), acceptable only because the owner's key still gates
recovery. Parsers reject headers outside these bounds for their
version.

- Commitment i = `SHA-256("PKRv1 share-commit" ‖ hkdf_salt ‖ index_byte ‖ share_y)` —
  lets you identify a wrong-but-well-formed card before decryption.
  (The v1 domain string is kept in v2 vaults: the mechanism is unchanged.)
- Owner commitment (v2) = `SHA-256("PKRv2 owner-commit" ‖ hkdf_salt ‖ K_app)` —
  the same idea for the owner's key. A preimage over the 256 random bits
  of K_app, so storing it reveals nothing.
- **Kit fingerprint** (shown in the app, written on the letter) = first
  4 bytes of file_digest, upper-case hex.
- **AAD** for the AEAD = bytes 0 .. 102+32n (magic through ct_len).

## 4. Recovery algorithm

1. Extract base64 from the `pkr-vault` script block; decode to bytes
   (or use a raw `.pkr` file directly).
2. Check magic, version, and `SHA-256(file[:-32]) == file[-32:]`.
3. Decode k cards (§2). Verify each card's set_id equals the header's,
   and its commitment matches slot `index` in the header.
4. Obtain K_app. **v1**: read it from offset 54. **v2**: decode the
   owner's key (§2b), verify its set_id equals the header's and that
   `SHA-256("PKRv2 owner-commit" ‖ hkdf_salt ‖ K_app)` equals the 32
   bytes at offset 54.
5. **Shamir combine** over GF(256) with the AES polynomial
   `x⁸+x⁴+x³+x+1` (0x11B): the 32 secret bytes were split byte-wise with
   independent random polynomials of degree k−1; share y for card x is
   the polynomial evaluated at x. Reconstruct each secret byte by
   Lagrange interpolation at x = 0:
   `K_share[b] = Σᵢ yᵢ[b] · Πⱼ≠ᵢ ( xⱼ / (xⱼ ⊕ xᵢ) )` (all arithmetic in GF(256)).
6. `key = HKDF-SHA256(salt = hkdf_salt, IKM = K_app ‖ K_share, info = "PKRv1 vault-key", L = 32)`
   (IKM order fixed: the 32 K_app bytes first). The info string keeps
   its v1 name in v2 vaults: the derivation itself is identical, only
   where K_app is stored differs.
7. AES-256-GCM decrypt `ct` with `key`, `nonce`, AAD = header (§3),
   96-bit IV semantics per SP 800-38D. Authentication failure means a
   wrong card set or corrupted vault. (The AAD covers the version
   bytes, so rewriting a v2 vault as v1 — or vice versa — fails here
   even with a recomputed trailing digest.)
8. Un-pad the plaintext: first 2 bytes = password length L (u16 LE),
   next L bytes = password, UTF-8. (Plaintext is zero-padded to a
   multiple of 64 bytes, minimum 128, to hide the exact length.)

## 5. Worked example (golden vector)

Frozen in `test/vault.test.mjs` (`GOLDEN_BYTES_HEX`, 438 bytes) and
reproduced by `tools/recover.py`:

- Vault: 3-of-5, set_id `6F71`, created 1755500000, fingerprint `0F7AB044`
- Cards 1, 3, 5:
  - `PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP`
  - `PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY`
  - `PSR1PQ4HHZAYL5HAL66L2EQ56AGHW334Z67S8RSST30WXWAWM2ZAQVAK3AW6WX6VQG7`
- Recovered password: `CORRECT HORSE BATTERY STAPLE`

### v2 (separate owner's key)

Frozen in `test/vault.test.mjs` (`GOLDEN2_BYTES_HEX`, 438 bytes):

- Vault: 3-of-5, set_id `0EDF`, created 1755600000, fingerprint `3A1DB668`
- Owner's key:
  - `KEEP1PPM0M8YXPPMVR224XJRMMNUS45UU5T7XQH39GN8XKSE498D0AGC5DLTQML6JJL`
- Cards 1, 3, 5:
  - `PSR1PQY8D77ZXGL48A0CPYKJWJRDY6G2UMJ35VF404XZMWSKPC4SZ8WS4CXAKKQF0N2`
  - `PSR1PQV8D7N7Q6JT8ZN4VALS99JP5XQGE4JSDTKEJQKE26RTTUR2J6D3U7ZRQYWG603`
  - `PSR1PQ58D75JJY8XPKCAA5TVTG6SU4FERQDYT3E8YGZJETGGUWV5GQJRKQZ6AVNFNUE`
- Recovered password: `CORRECT HORSE BATTERY STAPLE`

Any reimplementation MUST reproduce these results before being trusted
with a real kit.

## 6. Security notes (honest limits)

- **Threat model.** Holders without the kit file: information-theoretic
  zero knowledge below threshold k. Kit-file thief without cards:
  AES-256 with 256 missing key bits — no brute-force check is even
  possible without the key. **v1: k colluding holders + any kit copy =
  password**: holder selection and kit placement are the control, and
  card holders must never be given the kit file.
- **v2 threat model.** The owner's key moves the always-with-the-owner
  key half out of the kit file: k colluding holders + any kit copy
  still face AES-256 with the 256 bits of K_app missing. The price is
  an availability risk — a lost owner's key makes the vault permanently
  undecryptable, with no quorum able to override. The owner's key alone
  (without the file) recovers nothing, and alone with the file
  (without k cards) recovers nothing.
- In a v2 kit with k = 1, each card carries K_share itself rather than
  a below-threshold share — there is no information-theoretic claim on
  the holders' side. Confidentiality against holders then rests
  entirely on the missing K_app, which is the design: the owner's key
  is a required factor no quorum can bypass.
- The ciphertext length leaks only a coarse password-length bucket
  (64-byte buckets, 128-byte floor).
- The commitments are SHA-256 preimages over ≥256 bits of secret
  entropy; they identify wrong cards without weakening the scheme.
- The fingerprint covers only the embedded vault bytes. The **file
  hash** (SHA-256 of the whole RECOVERY.html, shown at every save and
  recorded on the letter) additionally covers the app code around it:
  verifying it with an independent tool (`shasum -a 256`, `Get-FileHash`)
  detects tampering with the tool itself, which a tampered file could
  otherwise hide. Neither proves the password inside is current —
  rotation discipline does that.
- Browser JS cannot reliably zeroize memory: strings are immutable and
  the GC may copy them. Mitigations are procedural (short session,
  reload after use, offline machine). This is the accepted trade-off
  for the any-OS single-file design; the same limitation applies to
  the Python reference.
- After any real recovery, treat the password as exposed: change it and
  issue a fresh kit (new ceremony).

## 7. The kit file and its app code

A kit file is the blank `keep.html` of the release that made it, with
exactly two spans changed:

- the content of the `pkr-vault` script block: `null` becomes the base64
  vault (§1);
- the content of the first `<title>` element: `KEEP — Create Recovery Kit`
  becomes `KEEP — Recovery`.

To check a kit's app code without any of this project's code, change both
spans back and take the SHA-256 of the result, as UTF-8 bytes exactly as
they stand. For a kit made by 1.1.0 or later this equals the SHA-256 that
release published for its `keep.html` (the README at its tag). Kits made
by 1.0.x were written from the browser's re-serialized copy of the page,
so theirs equal the `kit` value recorded for that release in
`src/releases.js` instead. Any other result means the code is not a
published release: the vault can still be read (§4), and moved into a
verified copy of the tool with its *Upgrade a Recovery Kit* screen.
