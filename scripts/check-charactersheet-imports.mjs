#!/usr/bin/env node
/**
 * Catch a symbol used but never imported, in the Character Sheet modules.
 *
 * The repo's shared eslint config turns `no-undef` off, and has to: 5etools loads `Parser`,
 * `Renderer`, `UiUtil` and friends as script-tag globals, so every file would be one long list of
 * false positives. The cost is that a missing `import` in an ES module is not a lint error either —
 * it is a `ReferenceError` in the browser, at the moment somebody clicks the thing.
 *
 * That has now reached a running page twice (`getGrantedFeatCategories`, then
 * `getSkillToolLanguageChoices`), both times in a code path no unit test covers. So `no-undef` runs
 * here instead, over the fork's own modules only, with the real globals declared.
 *
 * Fork-owned on purpose: putting this in `eslint.config.mjs` would add a fifth upstream file the
 * fork edits, and the whole point of the four-file list is that it stays four.
 */

import {ESLint} from "eslint";
import globals from "globals";

/** 5etools' script-tag globals, as the Character Sheet modules use them. */
const SITE_GLOBALS = [
	"BrewUtil2", "CryptUtil", "DataLoader", "DataUtil", "ExcludeUtil", "Hist", "InputUiUtil",
	"JqueryUtil", "ListUtil", "MiscUtil", "Omnisearch", "Parser", "PrereleaseUtil", "Renderer",
	"RollerUtil", "SearchWidget", "SortUtil", "StorageUtil", "UiUtil", "UrlUtil", "VetoolsConfig",
	"BaseComponent", "ComponentUiUtil", "ProxyBase", "ManageBrewUi", "ScaleCreature", "Charges",
	"$", "jQuery", "PageFilterClasses", "PageFilterFeats", "PageFilterSpells", "PageFilterBestiary",
	"PageFilterItems", "PageFilterBackgrounds", "PageFilterRaces", "PageFilterOptionalFeatures",
	"FilterBox", "SourceUtil", "TabUiUtil", "ClassesPage", "ListPage", "e_", "ee",
	"RenderableCollectionBase", "SearchUiUtil",
];

const eslint = new ESLint({
	overrideConfigFile: true,
	overrideConfig: {
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.browser,
				...Object.fromEntries(SITE_GLOBALS.map(name => [name, "readonly"])),
			},
		},
		linterOptions: {reportUnusedDisableDirectives: "off"},
		rules: {"no-undef": "error"},
	},
});

const results = await eslint.lintFiles(["js/charactersheet/*.js", "js/charactersheet.js", "js/charbuilder.js", "js/sidekick.js"]);
const failures = results.filter(r => r.errorCount);

if (!failures.length) {
	// eslint-disable-next-line no-console
	console.log(`✓ no undefined symbols across ${results.length} Character Sheet modules`);
	process.exit(0);
}

const formatter = await eslint.loadFormatter("stylish");
// eslint-disable-next-line no-console
console.error(await formatter.format(failures));
// eslint-disable-next-line no-console
console.error("A symbol is used but never imported. This is a ReferenceError in the browser, not a style nit.");
process.exit(1);
