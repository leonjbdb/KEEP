# Security

KEEP is cryptographic software that stands between someone and their
password. If you find a weakness, report it privately before publishing
anything.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability**
on this repository. The report goes to the maintainer only.

Describe what you found, where in the code, and how to reproduce it.
A proof of concept against `dist/keep.html` or a kit file helps, but is
not required.

## Scope

- `keep.html` and the `RECOVERY.html` a ceremony produces
- The byte-level format in [docs/RECOVERY-SPEC.md](docs/RECOVERY-SPEC.md)
- [tools/recover.py](tools/recover.py)

Attacks that require handing the victim a tampered file are out of
scope: the README treats any unverified file as compromised, and the
hash check is part of the ceremony.

## No bounty

This is a free MIT-licensed tool. There is no bug bounty — only credit
in the release notes, if you want it.
