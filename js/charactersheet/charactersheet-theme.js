/**
 * A look, chosen per character.
 *
 * The site has one theme for the whole browser, which is the right default and the wrong thing for
 * a table: two characters open in two tabs are two different people, and a player who wants the
 * necromancer dark and the paladin bright cannot have both. So a character carries its own, stored
 * with the character — which means it travels with a saved file, an autosave, and the account sync,
 * for free, because it is an ordinary state field.
 *
 * Two things are folded into one choice on purpose. **Brightness** is the site's own night mode,
 * because the sheet's styling is built on it and half-lighting a page is worse than either. An
 * **accent** is fork-owned: it tints the sheet's own chrome — panel edges, headings, the dice
 * buttons — and nothing else, so it can never make the site's furniture unreadable.
 *
 * `site` overrides nothing, which is what makes it a safe default for every character that existed
 * before this did.
 *
 * Pure and DOM-free: this says what a theme *is*; applying it is the page's business.
 */

/** Follow the browser-wide setting — the default, and the only theme that changes nothing. */
export const THEME_SITE = "site";

/**
 * Every theme a character can carry.
 *
 * `isNight` is null for "leave the site alone"; `accent` is null for "no tint". Kept as data rather
 * than as branches so the picker, the CSS and the tests all read the same list.
 */
export const CHARACTER_THEMES = [
	{key: THEME_SITE, name: "Site default", desc: "Follow the browser-wide theme", isNight: null, accent: null},
	{key: "day", name: "Day", desc: "Light, whatever the site is set to", isNight: false, accent: null},
	{key: "night", name: "Night", desc: "Dark, whatever the site is set to", isNight: true, accent: null},
	{key: "parchment", name: "Parchment", desc: "Light, with a warm tint", isNight: false, accent: "parchment"},
	{key: "arcane", name: "Arcane", desc: "Dark, with a violet tint", isNight: true, accent: "arcane"},
	{key: "verdant", name: "Verdant", desc: "Dark, with a green tint", isNight: true, accent: "verdant"},
	{key: "crimson", name: "Crimson", desc: "Dark, with a red tint", isNight: true, accent: "crimson"},
];

const _BY_KEY = new Map(CHARACTER_THEMES.map(it => [it.key, it]));

/** The theme a key names, falling back to the site default for anything unrecognised. */
export function getThemeMeta (key) {
	return _BY_KEY.get(String(key || "")) || _BY_KEY.get(THEME_SITE);
}

/** Whether a stored value names a theme this version knows — an older save may not. */
export function isKnownTheme (key) {
	return _BY_KEY.has(String(key || ""));
}

/**
 * What a theme asks the page to do.
 *
 * @return {{isNight: ?boolean, accentClass: ?string}} `isNight` null means "do not touch the site's
 *   setting"; `accentClass` is the class to put on the sheet, or null for none.
 */
export function getThemeApplication (key) {
	const meta = getThemeMeta(key);
	return {
		isNight: meta.isNight,
		accentClass: meta.accent ? `cs-theme--${meta.accent}` : null,
	};
}

/** Every accent class this module can ask for, so a page can clear them without knowing the list. */
export function getAllAccentClasses () {
	return CHARACTER_THEMES
		.filter(it => it.accent)
		.map(it => `cs-theme--${it.accent}`);
}
