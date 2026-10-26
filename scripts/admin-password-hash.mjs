import { randomBytes, scrypt } from 'node:crypto';

// Read from a private pipe/file; passwords must never appear in command-line arguments.
if (process.argv.length !== 2 || process.stdin.isTTY) {
  process.stderr.write('Provide one administrator password through standard input; command-line passwords are forbidden.\n');
  process.exitCode = 1;
} else {
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 514) throw new Error('Password input exceeds the permitted limit.');
      chunks.push(chunk);
    }
    let input = Buffer.concat(chunks);
    if (input.at(-1) === 10) input = input.subarray(0, -1);
    if (input.at(-1) === 13) input = input.subarray(0, -1);
    const password = new TextDecoder('utf-8', { fatal: true }).decode(input);
    if (input.length < 16 || input.length > 512 || /[\r\n]/.test(password)) throw new Error('Use 16 to 512 UTF-8 bytes on a single line.');
    const salt = randomBytes(16);
    const derived = await new Promise((resolve, reject) => scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
    input.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    process.stdout.write(`scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}\n`);
  } catch {
    process.stderr.write('Could not hash administrator password. Use a bounded UTF-8 password via standard input.\n');
    process.exitCode = 1;
  }
}
