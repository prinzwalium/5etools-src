import {
	ESLINT_CONFIG_BASE,
	ESLINT_CONFIG_NODE,
	ESLINT_CONFIG_VETOOLS,
} from "5etools-utils/eslint/eslint-config.js";
import {CONFIG_IGNORES} from "../test/eslint/eslint-config.js";

/**
 * Lint config for the fork's own tooling.
 *
 * `scripts/` is a directory upstream has no version of, and it is Node — `process`, `readFileSync`,
 * `console`. The root config hands every path it governs the *browser* globals, and `scripts/` is in
 * none of upstream's Node globs, so `process` read as undefined.
 *
 * Here rather than in the root config for the same reason as `test/e2e/eslint.config.mjs`: ESLint
 * resolves the nearest `eslint.config.*`, so a fork-owned directory can answer for itself and no
 * shared file has to carry a registration that could conflict on an upstream merge.
 */
export default [
	...ESLINT_CONFIG_BASE,
	ESLINT_CONFIG_NODE,
	ESLINT_CONFIG_VETOOLS,
	CONFIG_IGNORES,
];
