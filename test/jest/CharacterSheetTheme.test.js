import {describe, expect, it} from "@jest/globals";
import {
	CHARACTER_THEMES,
	THEME_SITE,
	getAllAccentClasses,
	getThemeApplication,
	getThemeMeta,
	isKnownTheme,
} from "../../js/charactersheet/charactersheet-theme.js";

/**
 * A look chosen per character rather than per browser. The site has one theme for everything, which
 * is the right default and the wrong thing for a table: two characters open in two tabs are two
 * different people.
 */
describe("Character themes", () => {
	it("Defaults to following the site, which changes nothing", () => {
		expect(getThemeApplication(THEME_SITE)).toEqual({isNight: null, accentClass: null});
	});

	it("Treats an unknown or missing theme as the site default", () => {
		// An older save, or a file from a newer version than this one
		expect(getThemeApplication("chartreuse")).toEqual({isNight: null, accentClass: null});
		expect(getThemeApplication(null).isNight).toBeNull();
		expect(getThemeMeta(undefined).key).toBe(THEME_SITE);
	});

	it("Says which stored values it recognises", () => {
		expect(isKnownTheme("arcane")).toBe(true);
		expect(isKnownTheme("chartreuse")).toBe(false);
		expect(isKnownTheme(null)).toBe(false);
	});

	it("Forces brightness without an accent where that is all the theme is", () => {
		expect(getThemeApplication("day")).toEqual({isNight: false, accentClass: null});
		expect(getThemeApplication("night")).toEqual({isNight: true, accentClass: null});
	});

	it("Carries a brightness and a tint together", () => {
		expect(getThemeApplication("arcane")).toEqual({isNight: true, accentClass: "cs-theme--arcane"});
		expect(getThemeApplication("parchment")).toEqual({isNight: false, accentClass: "cs-theme--parchment"});
	});

	it("Lists every accent class, so a page can clear them without knowing the list", () => {
		const classes = getAllAccentClasses();
		expect(classes).toContain("cs-theme--arcane");
		expect(classes).not.toContain("cs-theme--null");
		// One per accented theme, and the site default has none
		expect(classes).toHaveLength(CHARACTER_THEMES.filter(it => it.accent).length);
	});

	it("Gives every theme a key, a name and a description", () => {
		CHARACTER_THEMES.forEach(it => {
			expect(typeof it.key).toBe("string");
			expect(it.name).toBeTruthy();
			expect(it.desc).toBeTruthy();
		});
		expect(new Set(CHARACTER_THEMES.map(it => it.key)).size).toBe(CHARACTER_THEMES.length);
	});
});
