# KEEP ceremony checklist (owner's runbook)

## Before

- [ ] Pick your n holders (default 5). Spread them across households and
      social circles — people unlikely to conspire, likely to outlive
      you, reachable in an emergency. Anyone living with you counts as
      having access to your home stick: don't also give them a key
      unless you accept that their key + home stick still needs
      k−1 more holders.
- [ ] Decide k-of-n (default 3-of-5). k=2 is weak against collusion;
      k=n means one lost key kills the kit.
- [ ] Use the key holder's instruciton paper or blank index cards (n of them), a pen, n envelopes,
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
  - enter the secret twice
  - write or copy each key, then re-type it
  - test recovery from k keys
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
- [ ] Print, from inside RECOVERY.html ("Print"), all three documents:
      the USB note (one per stick — it already carries the fingerprint and
      the file hash; fill in holder names and contacts by hand), your
      owner's instructions (write both stick locations on it), and one key
      holder's page per holder (write that holder's key on it by hand).
- [ ] Close the browser entirely (all windows) when done.

## After

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
- [ ] Confirm each key holder still has their key stored safely.
- [ ] (Optional) Replace the USB sticks every ~3–5 years as flash memory fades over time.

## When the secret changes

- [ ] Verify every RECOVERY.html file against the letter's hash: 
  - `shasum -a 256 RECOVERY.html` (macOS, Linux)
  - `Get-FileHash RECOVERY.html` (Windows PowerShell)
  - Compare the whole 64 characters, not just the ends
  - A mismatch means the file was corrupted or tampered with
- [ ] Open RECOVERY.html → **Change the Protected Secret** → enter any
      k keys + the new secret → save both new copies → replace the
      files on BOTH sticks → update the fingerprint and file hash on
      the letter (both change with every rotation).
- [ ] Keys do not change. Old RECOVERY.html files recover the old secret —
      delete and update them them.

## After any real recovery

- [ ] Treat the recovered secret as exposed.
- [ ] Change the secret.
- [ ] Run a fresh ceremony (new keys, new kit) and destroy the old
      keys and sticks.
