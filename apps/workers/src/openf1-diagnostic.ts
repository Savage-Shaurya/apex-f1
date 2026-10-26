/** One provider diagnostic, with at most five paced and bounded requests. */
import { runOpenF1Diagnostic } from './lib/openf1-diagnostic';

runOpenF1Diagnostic().then((summary) => {
  console.log(JSON.stringify(summary));
}).catch(() => {
  console.error('[openf1-diagnostic] Provider diagnostic failed; check access configuration and provider availability.');
  process.exitCode = 1;
});
