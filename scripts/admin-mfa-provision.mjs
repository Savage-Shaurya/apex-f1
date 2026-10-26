import { randomBytes } from 'node:crypto';
import { open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
const capabilities = new Set(['read', 'write', 'publish', 'image', 'newsletter-reconcile']);
const run = promisify(execFile);
let createdPath;
try {
  if (process.argv.length !== 3 || process.stdin.isTTY || !output || !isAbsolute(output) || !/^[a-zA-Z0-9._-]+\.private\.json$/.test(basename(output))) throw new Error();
  const target = join(await realpath(dirname(output)), basename(output));
  const inside = relative(await realpath(root), target);
  if (!(inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside))) throw new Error();
  if (process.platform === 'win32') {
    // Privacy must exist at file creation. Tightening an initially public file
    // later cannot revoke a read handle opened during that earlier interval.
    const check = `$ErrorActionPreference='Stop'; $a=[IO.Directory]::GetAccessControl($env:APEX_MFA_ACL_PARENT); $s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($s,'S-1-5-18'); $ok=$a.AreAccessRulesProtected; foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if($r.AccessControlType -eq 'Allow' -and $allowed -notcontains $r.IdentityReference.Value) { $ok=$false } }; if(-not $ok -or $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $s) { exit 1 }; [Console]::Out.Write('private')`;
    const checked = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(check, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, APEX_MFA_ACL_PARENT: dirname(target) } });
    if (checked.stdout !== 'private') throw new Error();
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.byteLength; if (bytes > 65_536) throw new Error(); chunks.push(chunk);
  }
  const users = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (!Array.isArray(users) || users.length < 1 || users.length > 32) throw new Error();
  const names = new Set();
  for (const user of users) {
    if (!user || typeof user !== 'object' || Array.isArray(user) || Object.keys(user).some(key => !['username', 'passwordHash', 'capabilities'].includes(key)) || typeof user.username !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(user.username) || names.has(user.username) || typeof user.passwordHash !== 'string' || !/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(user.passwordHash) || !Array.isArray(user.capabilities) || !user.capabilities.length || user.capabilities.some(capability => !capabilities.has(capability)) || new Set(user.capabilities).size !== user.capabilities.length) throw new Error();
    names.add(user.username);
  }
  function factor() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', value = randomBytes(20);
    let accumulator = 0, bits = 0, result = '';
    for (const byte of value) {
      accumulator = (accumulator << 8) | byte; bits += 8;
      while (bits >= 5) { bits -= 5; result += alphabet[(accumulator >>> bits) & 31]; }
    }
    value.fill(0); return result;
  }
  const factors = Object.fromEntries(users.map(user => [user.username, factor()]));
  const material = { ADMIN_USERS_JSON: JSON.stringify(users), ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'), ADMIN_MFA_SECRETS_JSON: JSON.stringify(factors) };
  const file = await open(target, 'wx', 0o600); createdPath = target;
  try {
    if (process.platform === 'win32') {
      const identity = (await run('whoami.exe', [], { windowsHide: true })).stdout.trim();
      if (!identity || /[\r\n]/.test(identity)) throw new Error();
      // Establish the ACL while the newly created file is still empty.
      await run('icacls.exe', [target, '/inheritance:r', '/grant:r', `${identity}:(F)`, '*S-1-5-18:(F)'], { windowsHide: true });
    }
    await file.writeFile(JSON.stringify(material, null, 2) + '\n'); await file.sync();
  } finally { await file.close(); }
  for (const chunk of chunks) chunk.fill(0);
  createdPath = undefined;
  process.stdout.write('Private administrator session and MFA configuration created. Enroll each actor through a trusted private channel.\n');
} catch {
  if (createdPath) await unlink(createdPath).catch(() => {});
  process.stderr.write('Could not provision administrator MFA. Provide valid named profiles on stdin and a new absolute output path outside this repository ending in .private.json; its Windows parent folder must already be private to this account and SYSTEM.\n');
  process.exitCode = 1;
}
