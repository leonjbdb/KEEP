import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fromHex } from "../src/crypto.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function python3Available() {
  try {
    execFileSync("python3", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

test("python reference recovers the golden vector", { skip: !python3Available() }, async () => {
  const src = await readFile(join(root, "test/vault.test.mjs"), "utf8");
  const hex = src
    .match(/GOLDEN_BYTES_HEX =\s*\n?\s*"([\s\S]*?);/)[1]
    .replace(/[^0-9a-f]/g, "");
  const dir = await mkdtemp(join(tmpdir(), "pkr-"));
  const pkrPath = join(dir, "golden.pkr");
  await writeFile(pkrPath, fromHex(hex));

  const out = execFileSync("python3", [
    join(root, "tools/recover.py"),
    pkrPath,
    // deliberately unsorted, spaced and upper-cased inputs
    "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
    "psr1 pq9h hr5f qdu4 wdz4 685c nnph ge6m rzfc hlwt na29 l3wl 8x2c zkz0 pngw qghs qep",
    "psr1pq4hhzayl5hal66l2eq56aghw334z67s8rsst30wxwawm2zaqvak3aw6wx6vqg7",
  ], { encoding: "utf8" });
  assert.equal(out.trim(), "CORRECT HORSE BATTERY STAPLE");
});

test("python reference rejects a tampered vault", { skip: !python3Available() }, async () => {
  const src = await readFile(join(root, "test/vault.test.mjs"), "utf8");
  const hex = src
    .match(/GOLDEN_BYTES_HEX =\s*\n?\s*"([\s\S]*?);/)[1]
    .replace(/[^0-9a-f]/g, "");
  const bytes = fromHex(hex);
  bytes[270] ^= 0xff;
  const dir = await mkdtemp(join(tmpdir(), "pkr-"));
  const pkrPath = join(dir, "tampered.pkr");
  await writeFile(pkrPath, bytes);

  assert.throws(() =>
    execFileSync("python3", [
      join(root, "tools/recover.py"),
      pkrPath,
      "psr1pq9hhr5fqdu4wdz4685cnnphge6mrzfchlwtna29l3wl8x2czkz0pngwqghsqep",
      "psr1pqdhhzq6xa63nvv6709s3ncyu8gp3xrdyg5reptnq47wvrwug5lxxxchxdnw5py",
      "psr1pq4hhzayl5hal66l2eq56aghw334z67s8rsst30wxwawm2zaqvak3aw6wx6vqg7",
    ], { encoding: "utf8", stdio: "pipe" })
  );
});
