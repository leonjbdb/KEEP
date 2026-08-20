# KEEP: PKR v1 recovery specification

This document lets a technically skilled person recover the protected
password **without any of this project's code**, using only standard
cryptographic primitives. A tested reference implementation accompanies
it in `tools/recover.py` (Python 3, standard library only).

## 1. What exists

Naming: this spec and the source code say "card"; the app's interface
calls the same thing a "key". They are one and the same object.

- **n share cards** (default 5), handwritten, held by n different people.
  Each is a 67-character `bech32m` string starting `PSR1`.
- **A kit file** `RECOVERY.html` (the owner's USB sticks). It embeds a
  binary **PKR vault** (base64) inside:
  `<script type="application/json" id="pkr-vault">BASE64</script>`
- Recovery needs the vault **plus any k cards** (threshold k, default 3;
  the actual k and n are stored in the vault header). Fewer than k cards
  carry mathematically zero information about the password. The vault
  without cards is protected by AES-256 with half of its key missing.

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

## 3. PKR vault container (all integers little-endian)

| offset | len | field |
|---|---|---|
| 0 | 8 | magic `89 50 4B 52 0D 0A 1A 0A` (`\x89PKR\r\n\x1a\n`) |
| 8 | 2 | format_version = 1 |
| 10 | 8 | created_at (unix seconds, u64) |
| 18 | 1 | threshold k |
| 19 | 1 | number of cards n |
| 20 | 2 | set_id |
| 22 | 32 | hkdf_salt |
| 54 | 32 | K_app (random key half stored only in the kit file) |
| 86 | 12 | AES-GCM nonce |
| 98 | 32·n | share commitments, i = 1..n |
| 98+32n | 4 | ct_len (u32) |
| 102+32n | ct_len | ciphertext ‖ 16-byte GCM tag |
| end−32 | 32 | file_digest = SHA-256 of all preceding bytes |

- Commitment i = `SHA-256("PKRv1 share-commit" ‖ hkdf_salt ‖ index_byte ‖ share_y)` —
  lets you identify a wrong-but-well-formed card before decryption.
- **Kit fingerprint** (shown in the app, written on the letter) = first
  4 bytes of file_digest, upper-case hex.
- **AAD** for the AEAD = bytes 0 .. 102+32n (magic through ct_len).

## 4. Recovery algorithm

1. Extract base64 from the `pkr-vault` script block; decode to bytes
   (or use a raw `.pkr` file directly).
2. Check magic, version, and `SHA-256(file[:-32]) == file[-32:]`.
3. Decode k cards (§2). Verify each card's set_id equals the header's,
   and its commitment matches slot `index` in the header.
4. **Shamir combine** over GF(256) with the AES polynomial
   `x⁸+x⁴+x³+x+1` (0x11B): the 32 secret bytes were split byte-wise with
   independent random polynomials of degree k−1; share y for card x is
   the polynomial evaluated at x. Reconstruct each secret byte by
   Lagrange interpolation at x = 0:
   `K_share[b] = Σᵢ yᵢ[b] · Πⱼ≠ᵢ ( xⱼ / (xⱼ ⊕ xᵢ) )` (all arithmetic in GF(256)).
5. `key = HKDF-SHA256(salt = hkdf_salt, IKM = K_app ‖ K_share, info = "PKRv1 vault-key", L = 32)`
   (IKM order fixed: the 32 K_app bytes first).
6. AES-256-GCM decrypt `ct` with `key`, `nonce`, AAD = header (§3),
   96-bit IV semantics per SP 800-38D. Authentication failure means a
   wrong card set or corrupted vault.
7. Un-pad the plaintext: first 2 bytes = password length L (u16 LE),
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

Any reimplementation MUST reproduce this result before being trusted
with a real kit.

## 6. Security notes (honest limits)

- **Threat model.** Holders without the kit file: information-theoretic
  zero knowledge below threshold k. Kit-file thief without cards:
  AES-256 with 256 missing key bits — no brute-force check is even
  possible without the key. **k colluding holders + any kit copy =
  password**: holder selection and kit placement are the control, and
  card holders must never be given the kit file.
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
