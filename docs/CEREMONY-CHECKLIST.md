# KEEP ceremony checklist (owner's runbook)

## Before

- [ ] Pick your n holders (default 5). Spread them across households and
      social circles — people unlikely to conspire, likely to outlive
      you, reachable in an emergency. Anyone living with you counts as
      having access to your home stick: don't also give them a key
      unless you accept that their key + home stick still needs
      k−1 more holders.
- [ ] Decide k-of-n (default 3-of-5). k=2 is weak against collusion;
      k=n means one lost key kills the kit. With a separate owner's key
      a low k — even 1-of-1 — is acceptable: holders can never decrypt
      without your key. Without one, 2-of-2 is the minimum.
- [ ] Use the key holder's instruction paper or blank index cards (n of them), a pen, n envelopes,
      or prepare to share them in a secure manner digitally.
- [ ] Two USB sticks, freshly formatted.
- [ ] A computer you trust. Best: freshly rebooted, no remote-access
      software running. Disconnect from the network once the page is open.
- [ ] (Optional) A **secure** password vault to store a backup of the recovery file in.

## Ceremony (the app forces the marked steps)

- [ ] Verify the `keep.html` file on your local disk with the hash located on GitHub.
  - Make sure they are identical, not just the beginning and ends.
  - `shasum -a 256 keep.html` (macOS, Linux).
  - `Get-FileHash keep.html` (Windows PowerShell).
  - Compare the whole 64 characters, not just the ends. 
  - A mismatch means the file was corrupted or tampered with.
- [ ] Open the `keep.html` file, from your local disk, in a trusted browser.
- [ ] Run **Self-test**. It is important every step passes.
- [ ] **Create a recovery kit** → Follow the wizard:
  - recommended precautions (optional, explained in the wizard)
  - choose k-of-n
  - choose where your half of the key lives: inside the kit file
    (standard), or as a separate owner's key (`KEEP1…`) the wizard adds.
    The owner's key means recovery needs file + owner's key + k keys —
    and that losing the owner's key loses the secret for good.
  - enter the secret twice
  - write or copy each key, then re-type it (the owner's key comes
    first, if chosen; the rail counts it as one of the keys)
  - test recovery from k keys (plus the owner's key, if chosen)
  - save RECOVERY.html in your desired location (USB sticks and your vault is recommended)
- [ ] Verify every RECOVERY.html file against the letter's hash: 
  - `shasum -a 256 RECOVERY.html` (macOS, Linux).
  - `Get-FileHash RECOVERY.html` (Windows PowerShell). 
  - Compare the whole 64 characters, not just the ends. 
  - A mismatch means the file was corrupted or tampered with.
- [ ] Open every RECOVERY.html and verify:
  - Fingerprint matches.
  - Self-Test runs successfully.
  - Test the decryption and verify that the secret is correct.
- [ ] In `keep.html`, **Verify a Recovery Kit** on every RECOVERY.html: it should
      say *Genuine*, and the file hash it shows must match the letter.
- [ ] Print, from inside RECOVERY.html ("Print"), all three documents:
      the USB note (one per stick — it already carries the fingerprint and
      the file hash; fill in holder names and contacts by hand), your
      owner's instructions (write both stick locations on it), and one key
      holder's page per holder (write that holder's key on it by hand).
- [ ] Close the browser entirely (all windows) when done.

## After

- [ ] Kits with a separate owner's key: store the owner's key where you decided (password
      manager or paper), never on the USB sticks or with a key holder;
      write its location on the USB note.
- [ ] (Optional) Store a copy of the holders' keys in your password
      vault: the yearly decryption test and secret changes then need no
      key holders. It is paramount that these copies are stored safely,
      and never together with the recovery file itself.

- [ ] Seal each key in its envelope; write the key number and the
      release rules on the envelope. Hand-deliver to holders; explain the
      in-person/live-video rule face to face.
- [ ] Stick 1: your chosen spot at home. Stick 2: somewhere else you
      control (office drawer, parents' house, safe-deposit box).
      **Never with a key holder.**
- [ ] USB note: on the stick with the stick. Owner's instructions: with
      your will / estate documents; tell your executor they exist.
- [ ] Delete RECOVERY.html from the computer's Downloads folder
      (it's on the sticks now; extra copies only widen exposure —
      though harmless without k keys).

## Yearly (put it in your calendar)

- [ ] Verify every RECOVERY.html file against the letter's hash: 
  - `shasum -a 256 RECOVERY.html` (macOS, Linux).
  - `Get-FileHash RECOVERY.html` (Windows PowerShell)
  - Compare the whole 64 characters, not just the ends 
  - A mismatch means the file was corrupted or tampered with
- [ ] Open every RECOVERY.html and verify: 
  - Fingerprint matches.
  - Self-Test runs successfully.
  - Test the decryption and verify that the secret is correct.
- [ ] Download the latest `keep.html`, verify its hash, and run **Verify a Recovery
      Kit** on every RECOVERY.html: it names the version that made the file and
      checks its code against every published release.
- [ ] Confirm each key holder still has their key stored safely.
- [ ] Kits with a separate owner's key: confirm you can still find and read the owner's key
      (it is part of "test the decryption" above — a kit that needs it
      cannot be tested without it).
- [ ] (Optional) Replace the USB sticks every ~3–5 years as flash memory fades over time.

## When the secret changes

- [ ] Verify every RECOVERY.html file against the letter's hash: 
  - `shasum -a 256 RECOVERY.html` (macOS, Linux)
  - `Get-FileHash RECOVERY.html` (Windows PowerShell)
  - Compare the whole 64 characters, not just the ends
  - A mismatch means the file was corrupted or tampered with
- [ ] Open RECOVERY.html → **Change the Protected Secret** → enter any
      k keys (+ the owner's key, if the kit uses one) + the new secret →
      save both new copies → replace the files on BOTH sticks → update
      the fingerprint and file hash on the letter (both change with
      every rotation).
- [ ] Keys do not change. Old RECOVERY.html files recover the old secret —
      delete and update them.

## After any real recovery

- [ ] Treat the recovered secret as exposed.
- [ ] Change the secret.
- [ ] Run a fresh ceremony (new keys, new kit) and destroy the old
      keys and sticks.
