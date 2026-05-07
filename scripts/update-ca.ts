#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://portal.singlestore.com/static/ca/singlestore_bundle.pem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const target = resolve(__dirname, '..', 'src', 'ca', 'singlestore-bundle.pem');

async function main(): Promise<void> {
  process.stderr.write(`fetching ${SOURCE_URL}\n`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`unexpected status ${res.status} ${res.statusText}`);

  const pem = await res.text();
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('downloaded payload does not look like a PEM bundle');
  }

  writeFileSync(target, pem, { encoding: 'utf8', mode: 0o644 });
  process.stderr.write(`wrote ${pem.length} bytes to ${target}\n`);
  process.stderr.write('Commit src/ca/singlestore-bundle.pem to capture the refresh.\n');
}

main().catch((err: unknown) => {
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`update-ca failed: ${reason}\n`);
  process.exit(1);
});
