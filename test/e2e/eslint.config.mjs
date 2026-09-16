import {
	ESLINT_CONFIG_BASE,
	ESLINT_CONFIG_BROWSER,
	ESLINT_CONFIG_NODE,
	ESLINT_CONFIG_VETOOLS,
} from "5etools-utils/eslint/eslint-config.js";
import {CONFIG_IGNORES} from "../eslint/eslint-config.js";

/**
 * Lint config for the fork's browser tests.
 *
 * These files are **Node and browser at once**, which nothing above them can express: the suite runs
 * in Node and drives Playwright, and everything handed to `page.evaluate` runs in the page — so
 * `document`, `window`, `getComputedStyle` and the fork's own `Renderer` / `BrewUtil2` globals are
 * all legitimate here, beside `process` and `URL`.
 *
 * It exists as a file rather than as a block in the root config because ESLint resolves the
 * **nearest** `eslint.config.*` to each file it lints. `test/eslint.config.mjs` is upstream's, and
 * declares Node and Jest only — right for upstream's tests, which never touch a page. Putting the
 * fork's answer here rather than editing either shared config keeps it in a directory upstream has
 * no version of, so it can never conflict on a merge.
 *
 * (Before ESLint 10 this was not needed: the root config governed every file, and the fork's block
 * there covered `**\/*.mjs`. The nested lookup is what changed, and 172 `no-undef` errors is what it
 * looked like.)
 */
export default [
	...ESLINT_CONFIG_BASE,
	ESLINT_CONFIG_NODE,
	// After Node, so the page's globals are present too. A test asserting on the rendered sheet is
	// written in both languages in one file
	ESLINT_CONFIG_BROWSER,
	ESLINT_CONFIG_VETOOLS,
	CONFIG_IGNORES,
];
