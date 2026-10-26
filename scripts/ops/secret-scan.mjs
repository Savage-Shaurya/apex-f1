// Narrow recognizable-credential checks. This is not arbitrary secret discovery.
// No path exemption: even test files containing complete real-looking keys fail.
const detectors=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['huggingface-token',/\bhf_[A-Za-z0-9]{20,}\b/],
  ['groq-token',/\bgsk_[A-Za-z0-9]{20,}\b/],
  ['resend-token',/\bre_[A-Za-z0-9]{20,}\b/],
  ['openai-token',/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['stripe-live-secret',/\bsk_live_[A-Za-z0-9]{20,}\b/],
  ['google-api-key',/\bAIza[A-Za-z0-9_-]{35}\b/],
  ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
export function scanRecognizableSecrets(body,relativePath) {
  const text=Buffer.isBuffer(body)?body.toString('utf8'):String(body);
  return detectors.filter(([,pattern])=>pattern.test(text)).map(([category])=>({path:relativePath,category}));
}
export class ReleaseSecretError extends Error {
  constructor(findings){super('Recognizable credentials must be removed before release.');this.findings=findings;}
}
