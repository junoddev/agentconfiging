#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function validatePublishTag(ref, version) {
  const prefix = 'refs/tags/';
  if (!ref.startsWith(prefix)) throw new Error(`publish ref must be a tag, received ${ref}`);
  const tag = ref.slice(prefix.length);
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(
      `publish tag ${tag} does not exactly match package version ${version} (${expected})`,
    );
  }
  return tag;
}

export function main(argv = process.argv.slice(2)) {
  const [ref, packagePath = 'package.json'] = argv;
  if (!ref) throw new Error('usage: validate-publish-tag.mjs <git-ref> [package.json]');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`${packagePath} has no valid version`);
  }
  const tag = validatePublishTag(ref, pkg.version);
  process.stdout.write(`Publish tag validated: ${tag} === package.json version ${pkg.version}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Publish tag validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
