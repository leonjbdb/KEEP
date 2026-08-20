#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Leon Joachim Buverud De Backer
"""Reference recovery for KEEP (PKR v1) kits, Python standard library only.

This is the bit-rot fallback: if the RECOVERY.html tool will not run in
some future browser, any technically skilled person can recover with
this script (or reimplement it from docs/RECOVERY-SPEC.md).

Usage:
    python3 recover.py RECOVERY.html KEY1 KEY2 KEY3 [...]
    python3 recover.py vault.pkr    KEY1 KEY2 KEY3 [...]

Keys may be given with or without spaces, any letter case. The script
prints exactly one line: the recovered master password.

Everything is implemented from primary specifications (FIPS-197,
SP 800-38D, RFC 5869, BIP-350) and self-checks against known-answer
vectors on every run before touching your data.
"""

import base64
import hashlib
import hmac
import re
import struct
import sys

# --------------------------------------------------------------------------
# AES-256 (FIPS-197), encryption only — GCM needs nothing else
# --------------------------------------------------------------------------

SBOX = [
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
]

RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36, 0x6C, 0xD8]


def _xtime(a):
    a <<= 1
    if a & 0x100:
        a ^= 0x11B
    return a & 0xFF


def _expand_key_256(key):
    words = [list(key[i:i + 4]) for i in range(0, 32, 4)]
    for i in range(8, 60):
        temp = list(words[i - 1])
        if i % 8 == 0:
            temp = temp[1:] + temp[:1]
            temp = [SBOX[b] for b in temp]
            temp[0] ^= RCON[i // 8 - 1]
        elif i % 8 == 4:
            temp = [SBOX[b] for b in temp]
        words.append([a ^ b for a, b in zip(words[i - 8], temp)])
    return [sum(words[4 * r:4 * r + 4], []) for r in range(15)]


def _aes256_encrypt_block(round_keys, block):
    state = [block[r + 4 * c] for c in range(4) for r in range(4)]  # column-major
    state = [b ^ k for b, k in zip(state, _cols(round_keys[0]))]
    for rnd in range(1, 14):
        state = [SBOX[b] for b in state]
        state = _shift_rows(state)
        state = _mix_columns(state)
        state = [b ^ k for b, k in zip(state, _cols(round_keys[rnd]))]
    state = [SBOX[b] for b in state]
    state = _shift_rows(state)
    state = [b ^ k for b, k in zip(state, _cols(round_keys[14]))]
    return bytes(state[r + 4 * c] for c in range(4) for r in range(4))


def _cols(rk):
    return [rk[r + 4 * c] for c in range(4) for r in range(4)]


def _shift_rows(s):
    out = list(s)
    for r in range(1, 4):
        row = [s[r + 4 * c] for c in range(4)]
        row = row[r:] + row[:r]
        for c in range(4):
            out[r + 4 * c] = row[c]
    return out


def _mix_columns(s):
    out = []
    for c in range(4):
        col = s[4 * c:4 * c + 4]
        out.extend([
            _xtime(col[0]) ^ (_xtime(col[1]) ^ col[1]) ^ col[2] ^ col[3],
            col[0] ^ _xtime(col[1]) ^ (_xtime(col[2]) ^ col[2]) ^ col[3],
            col[0] ^ col[1] ^ _xtime(col[2]) ^ (_xtime(col[3]) ^ col[3]),
            (_xtime(col[0]) ^ col[0]) ^ col[1] ^ col[2] ^ _xtime(col[3]),
        ])
    return out


# --------------------------------------------------------------------------
# GCM (SP 800-38D)
# --------------------------------------------------------------------------

def _ghash_mult(x, y):
    """Multiply in GF(2^128), NIST bit order (R = 0xE1 || 0^120)."""
    z = 0
    v = y
    for i in range(127, -1, -1):
        if (x >> i) & 1:
            z ^= v
        if v & 1:
            v = (v >> 1) ^ (0xE1 << 120)
        else:
            v >>= 1
    return z


def _ghash(h_int, *chunks):
    y = 0
    for chunk in chunks:
        for i in range(0, len(chunk), 16):
            block = chunk[i:i + 16].ljust(16, b"\x00")
            y = _ghash_mult(y ^ int.from_bytes(block, "big"), h_int)
    return y


def _inc32(block):
    prefix, ctr = block[:12], int.from_bytes(block[12:], "big")
    return prefix + ((ctr + 1) & 0xFFFFFFFF).to_bytes(4, "big")


def aes_gcm_decrypt(key, iv, aad, ct_and_tag):
    if len(iv) != 12:
        raise ValueError("only 96-bit nonces supported")
    ct, tag = ct_and_tag[:-16], ct_and_tag[-16:]
    rk = _expand_key_256(key)
    h = int.from_bytes(_aes256_encrypt_block(rk, b"\x00" * 16), "big")
    j0 = iv + b"\x00\x00\x00\x01"
    lens = struct.pack(">QQ", len(aad) * 8, len(ct) * 8)
    s = _ghash(h, aad, ct, lens)
    expected_tag = bytes(
        a ^ b for a, b in zip(_aes256_encrypt_block(rk, j0), s.to_bytes(16, "big"))
    )
    if not hmac.compare_digest(expected_tag, tag):
        raise ValueError("authentication failed: wrong keys or corrupted vault")
    out = bytearray()
    counter = j0
    for i in range(0, len(ct), 16):
        counter = _inc32(counter)
        keystream = _aes256_encrypt_block(rk, counter)
        block = ct[i:i + 16]
        out.extend(a ^ b for a, b in zip(block, keystream))
    return bytes(out)


def _self_check():
    """NIST known-answer test; abort everything if this machine miscomputes."""
    out = aes_gcm_decrypt(
        b"\x00" * 32, b"\x00" * 12, b"",
        bytes.fromhex("cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919"),
    )
    assert out == b"\x00" * 16, "AES-GCM self-check failed"
    okm = hkdf_sha256(b"\x0b" * 22, bytes.fromhex("000102030405060708090a0b0c"),
                      bytes.fromhex("f0f1f2f3f4f5f6f7f8f9"), 42)
    assert okm.hex().startswith("3cb25f25faacd57a90434f64d0362f2a"), "HKDF self-check failed"


# --------------------------------------------------------------------------
# HKDF-SHA256 (RFC 5869)
# --------------------------------------------------------------------------

def hkdf_sha256(ikm, salt, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


# --------------------------------------------------------------------------
# bech32m (BIP-350) card decoding
# --------------------------------------------------------------------------

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
GEN = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
BECH32M_CONST = 0x2BC830A3


def _polymod(values):
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            if (top >> i) & 1:
                chk ^= GEN[i]
    return chk


def _hrp_expand(hrp):
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def decode_card(raw):
    # "o" is not in the charset: any o/O typed is a misread zero.
    s = re.sub(r"[\s\-.·_]", "", raw).lower().replace("o", "0")
    if len(s) != 67:
        raise ValueError(f"a key code is exactly 67 characters, got {len(s)}")
    hrp, data_part = s[:3], s[4:]
    if hrp != "psr" or s[3] != "1":
        raise ValueError("not a psr key code")
    data = [CHARSET.index(c) for c in data_part]
    if _polymod(_hrp_expand(hrp) + data) != BECH32M_CONST:
        raise ValueError("key checksum mismatch, there is a typo")
    data = data[:-6]
    if data[0] != 1:
        raise ValueError("unknown key version")
    bits = 0
    acc = 0
    payload = bytearray()
    for value in data[1:]:
        acc = (acc << 5) | value
        bits += 5
        if bits >= 8:
            bits -= 8
            payload.append((acc >> bits) & 0xFF)
    if len(payload) != 35:
        raise ValueError("key payload has the wrong size")
    return payload[0], bytes(payload[1:3]), bytes(payload[3:])  # index, set_id, share


# --------------------------------------------------------------------------
# Shamir combine over GF(256), AES polynomial 0x11B
# --------------------------------------------------------------------------

def _gf_mul(a, b):
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1B
        b >>= 1
    return p


def _gf_inv(a):
    r = 1
    for _ in range(254):  # a^254
        r = _gf_mul(r, a)
    return r


def shamir_combine(shares):
    xs = [s[0] for s in shares]
    length = len(shares[0][1])
    secret = bytearray()
    for byte_i in range(length):
        acc = 0
        for i, (xi, yi) in enumerate(shares):
            num, den = 1, 1
            for j, (xj, _) in enumerate(shares):
                if i == j:
                    continue
                num = _gf_mul(num, xj)
                den = _gf_mul(den, xj ^ xi)
            acc ^= _gf_mul(yi[byte_i], _gf_mul(num, _gf_inv(den)))
        secret.append(acc)
    return bytes(secret)


# --------------------------------------------------------------------------
# PKR v1 container
# --------------------------------------------------------------------------

MAGIC = b"\x89PKR\r\n\x1a\n"


def load_pkr(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    if blob.startswith(MAGIC):
        return blob
    m = re.search(
        rb'<script type="application/json" id="pkr-vault">([^<]+)</'
        rb"script>", blob)
    if not m or m.group(1).strip() == b"null":
        raise ValueError("no embedded vault found in this file")
    return base64.b64decode(m.group(1).strip())


def recover(pkr, card_strings):
    if len(pkr) < 200 or not pkr.startswith(MAGIC):
        raise ValueError("not a PKR vault file")
    version, = struct.unpack_from("<H", pkr, 8)
    if version != 1:
        raise ValueError(f"unsupported vault version {version}")
    k, n = pkr[18], pkr[19]
    set_id = pkr[20:22]
    salt = pkr[22:54]
    k_app = pkr[54:86]
    nonce = pkr[86:98]
    header_len = 102 + 32 * n
    ct_len, = struct.unpack_from("<I", pkr, 98 + 32 * n)
    if len(pkr) != header_len + ct_len + 32:
        raise ValueError("vault length mismatch — file truncated?")
    if hashlib.sha256(pkr[:-32]).digest() != pkr[-32:]:
        raise ValueError("vault integrity digest mismatch — corrupted copy")
    aad = pkr[:header_len]
    ct = pkr[header_len:header_len + ct_len]

    if len(card_strings) != k:
        raise ValueError(f"exactly {k} keys required, got {len(card_strings)}")
    shares = []
    seen = set()
    for pos, raw in enumerate(card_strings, 1):
        index, card_set, share = decode_card(raw)
        if card_set != set_id:
            raise ValueError(f"key {pos} belongs to a different key set")
        commit = hashlib.sha256(
            b"PKRv1 share-commit" + salt + bytes([index]) + share).digest()
        expected = pkr[98 + 32 * (index - 1):98 + 32 * index]
        if not hmac.compare_digest(commit, expected):
            raise ValueError(f"key {pos} does not belong to this vault file")
        if index in seen:
            raise ValueError(f"key {pos} was already entered")
        seen.add(index)
        shares.append((index, share))

    k_share = shamir_combine(shares)
    key = hkdf_sha256(k_app + k_share, salt, b"PKRv1 vault-key", 32)
    padded = aes_gcm_decrypt(key, nonce, aad, ct)
    pw_len = padded[0] | (padded[1] << 8)
    return padded[2:2 + pw_len].decode("utf-8")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    _self_check()
    pkr = load_pkr(sys.argv[1])
    print(recover(pkr, sys.argv[2:]))


if __name__ == "__main__":
    main()
