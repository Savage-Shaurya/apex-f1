import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config, consuming eslint-config-next's native flat exports directly.
 *
 * This previously went through FlatCompat from @eslint/eslintrc, the bridge
 * that adapts legacy .eslintrc configs into flat config. eslint-config-next 16
 * ships real flat config arrays, so the bridge is unnecessary — and actively
 * harmful: under eslint 10 it dies with
 *
 *   TypeError: Converting circular structure to JSON
 *     property 'configs' -> 'flat' -> 'plugins' -> 'react' closes the circle
 *
 * because its validator JSON.stringify's the config to format errors, and the
 * plugin object graph is self-referential.
 *
 * @eslint/eslintrc is no longer a DIRECT dependency, but eslint still pulls it
 * transitively, so js-yaml and brace-expansion remain in the tree. The pnpm
 * overrides pinning them in the root package.json are still load-bearing — do
 * not delete them on the assumption this change orphaned them. Verified on
 * disk: @eslint/eslintrc 3.3.5 and 3.3.6, js-yaml 4.3.1, brace-expansion
 * 1.1.18 and 5.0.9 are all still installed.
 *
 * A config object carrying only `ignores` sets global ignores in flat config.
 */
const eslintConfig = [
  {
    ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    /**
     * eslint-config-next 16 pulls eslint-plugin-react-hooks 7, whose React
     * Compiler rules flagged 21 pre-existing violations across 16 files on
     * first run — code written before these rules existed.
     *
     * They are warnings, not errors, DELIBERATELY and TEMPORARILY. Bundling a
     * 16-file behavioural refactor into a dependency bump is how you break
     * production. They stay visible in every lint run. This is a tracked
     * backlog, not a permanent exemption.
     *
     * What the backlog actually holds, having read each one:
     *
     *   purity (12) — mostly `Date.now()` inside async Server Components
     *     (app/schedule, RaceBrief), which render once on the server, so the
     *     rule over-reaches there. But RaceTickerBar and TrackMap call it in
     *     CLIENT components, where server and client can disagree and produce
     *     a hydration mismatch. Those are real and should go first.
     *
     *   set-state-in-effect (4) — the reset-on-prop-change pattern. Works, but
     *     the derive-during-render or key-based form is what React wants.
     *
     *   refs (1) — Toast reads ref.current during render.
     *
     * Two violations from the original run are already fixed rather than
     * suppressed: the `refs` one I introduced in MegaNav's scroll handler, and
     * all four `static-components` in RaceTickerCountdown — which is why that
     * rule is absent from this list and stays at error.
     */
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    /**
     * Source-style policy belongs in lint, not in unit tests (R3-CODE-10):
     * no hand-set negative tracking in the design system, shell and home
     * components, no CSS text clipping and no clock-derived season on the
     * home page.
     */
    files: ['components/ds/**/*.tsx', 'components/home/**/*.tsx', 'components/brand-c/**/*.tsx'],
    // Type.tsx owns the display steps' tested tracking (CAPS_/SENTENCE_TRACKING).
    ignores: ['components/ds/Type.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/tracking-\\[-/]', message: 'No hand-set negative tracking (text must never feel cramped or clip).' },
        { selector: 'TemplateElement[value.raw=/tracking-\\[-/]', message: 'No hand-set negative tracking (text must never feel cramped or clip).' },
      ],
    },
  },
  {
    files: ['components/home/**/*.tsx', 'components/brand-c/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/tracking-\\[-/]', message: 'No hand-set negative tracking.' },
        { selector: 'TemplateElement[value.raw=/tracking-\\[-/]', message: 'No hand-set negative tracking.' },
        { selector: 'Literal[value=/(^|\\s)(line-clamp-\\S+|text-ellipsis|truncate)(\\s|$)/]', message: 'Home text is never clipped with CSS.' },
        { selector: 'TemplateElement[value.raw=/(^|\\s)(line-clamp-\\S+|text-ellipsis|truncate)(\\s|$)/]', message: 'Home text is never clipped with CSS.' },
        { selector: "CallExpression[callee.property.name=/^getU?T?C?FullYear$/]", message: 'Seasons come from lib/season.ts, never the clock.' },
      ],
    },
  },
];

export default eslintConfig;
