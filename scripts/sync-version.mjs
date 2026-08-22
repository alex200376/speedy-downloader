// sync-version.mjs
// Keep the version in package.json, src-tauri/tauri.conf.json and
// src-tauri/Cargo.toml in sync.
//   Usage:
//     node scripts/sync-version.mjs          <- write package.json version to the others
//     node scripts/sync-version.mjs --check  <- fail (exit 1) if they differ
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const confVersion = conf.version;

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargoSrc = readFileSync(cargoPath, "utf8");
const m = cargoSrc.match(/^version\s*=\s*"([^"]+)"/m);
const cargoVersion = m ? m[1] : null;

const mismatches = [];
if (confVersion !== version) mismatches.push(`tauri.conf.json (${confVersion})`);
if (cargoVersion !== version) mismatches.push(`Cargo.toml (${cargoVersion})`);

if (mismatches.length > 0) {
  if (check) {
    console.error(`Version mismatch: package.json = ${version}, but ${mismatches.join(", ")}`);
    process.exit(1);
  }
  conf.version = version;
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
  const updatedCargo = cargoSrc.replace(
    /^version\s*=\s*"([^"]+)"/m,
    `version = "${version}"`,
  );
  writeFileSync(cargoPath, updatedCargo);
  console.log(`Synced version ${version} -> tauri.conf.json & Cargo.toml`);
} else {
  console.log(`Versions already in sync: ${version}`);
}