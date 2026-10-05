import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fromHex, randomBytes } from "../src/crypto.js";
import { createVault } from "../src/vault.js";

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

test("python reference recovers the v2 golden vector (owner key)", { skip: !python3Available() }, async () => {
  const src = await readFile(join(root, "test/vault.test.mjs"), "utf8");
  const hex = src
    .match(/GOLDEN2_BYTES_HEX =\s*\n?\s*"([\s\S]*?);/)[1]
    .replace(/[^0-9a-f]/g, "");
  const dir = await mkdtemp(join(tmpdir(), "pkr-"));
  const pkrPath = join(dir, "golden2.pkr");
  await writeFile(pkrPath, fromHex(hex));

  const out = execFileSync("python3", [
    join(root, "tools/recover.py"),
    pkrPath,
    // owner key deliberately in the middle, spaced and mixed-case
    "PSR1PQY8D77ZXGL48A0CPYKJWJRDY6G2UMJ35VF404XZMWSKPC4SZ8WS4CXAKKQF0N2",
    "keep1 ppm0 m8yx ppmv r224 xjrm mnus 45uu 5t7x qh39 gn8x kse4 98d0 agc5 dltq ml6j jl",
    "psr1pqv8d7n7q6jt8zn4vals99jp5xqge4jsdtkejqke26rttur2j6d3u7zrqywg603",
    "PSR1PQ58D75JJY8XPKCAA5TVTG6SU4FERQDYT3E8YGZJETGGUWV5GQJRKQZ6AVNFNUE",
  ], { encoding: "utf8" });
  assert.equal(out.trim(), "CORRECT HORSE BATTERY STAPLE");

  // without the owner key the same cards must be refused
  assert.throws(() =>
    execFileSync("python3", [
      join(root, "tools/recover.py"),
      pkrPath,
      "PSR1PQY8D77ZXGL48A0CPYKJWJRDY6G2UMJ35VF404XZMWSKPC4SZ8WS4CXAKKQF0N2",
      "psr1pqv8d7n7q6jt8zn4vals99jp5xqge4jsdtkejqke26rttur2j6d3u7zrqywg603",
      "PSR1PQ58D75JJY8XPKCAA5TVTG6SU4FERQDYT3E8YGZJETGGUWV5GQJRKQZ6AVNFNUE",
    ], { encoding: "utf8", stdio: "pipe" })
  );
});

test("python reference recovers a minimal 1-of-1 owner's-key kit", { skip: !python3Available() }, async () => {
  const res = await createVault("tiny secret ✓", 1, 1, randomBytes, 1, { separateOwnerKey: true });
  const dir = await mkdtemp(join(tmpdir(), "pkr-"));
  const pkrPath = join(dir, "tiny.pkr");
  await writeFile(pkrPath, res.bytes);

  const out = execFileSync("python3", [
    join(root, "tools/recover.py"),
    pkrPath,
    res.cards[0],
    res.ownerKey,
  ], { encoding: "utf8" });
  assert.equal(out.trim(), "tiny secret ✓");
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

test("the recover.py carried inside a kit, cut out at its markers, recovers that kit",
  { skip: !python3Available() }, async () => {
    // a scratch build: other test files rebuild dist/ at the same time
    const dir = await mkdtemp(join(tmpdir(), "pkr-manual-"));
    execFileSync(process.execPath, [join(root, "build.mjs"), "--out", dir], { stdio: "pipe" });
    const demo = (await readdir(dir)).find((f) => f.startsWith("RECOVERY-demo-v"));
    const kitPath = join(dir, demo);
    const kit = await readFile(kitPath, "utf8");

    // exactly what the manual tells a reader with a text editor to do
    const from = "==== recover.py: copy from the next line ====\n";
    const upTo = "\n==== recover.py: copy up to the line above ====";
    const start = kit.indexOf(from) + from.length;
    const program = kit.slice(start, kit.indexOf(upTo, start)) + "\n";
    assert.equal(program, await readFile(join(root, "tools/recover.py"), "utf8"));
    const pyPath = join(dir, "recover.py");
    await writeFile(pyPath, program);

    const out = execFileSync("python3", [
      pyPath,
      kitPath,
      "PSR1PQ9HHR5FQDU4WDZ4685CNNPHGE6MRZFCHLWTNA29L3WL8X2CZKZ0PNGWQGHSQEP",
      "PSR1PQDHHZQ6XA63NVV6709S3NCYU8GP3XRDYG5REPTNQ47WVRWUG5LXXXCHXDNW5PY",
      "PSR1PQ4HHZAYL5HAL66L2EQ56AGHW334Z67S8RSST30WXWAWM2ZAQVAK3AW6WX6VQG7",
    ], { encoding: "utf8" });
    assert.equal(out.trim(), "CORRECT HORSE BATTERY STAPLE");
    await rm(dir, { recursive: true, force: true });
  });
