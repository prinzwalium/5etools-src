import {CHAR_SHEET_SKILLS, getSkillKeyByName, getSkillNameByKey} from "./charactersheet-consts.js";

/**
 * The "choice queue": pure extraction of unresolved choices (skill/language/tool picks) from
 * race/background/class data, as generic descriptors a UI can walk the user through.
 * Fixed (non-choice) proficiencies are not part of the queue; they are applied directly.
 */

// Fixed core lists (PHB); referenced by the `anyGamingSet`/`anyMusicalInstrument`/`anyArtisansTool` choice keys
export const GAMING_SETS = ["Dice set", "Dragonchess set", "Playing card set", "Three-Dragon Ante set"];
export const MUSICAL_INSTRUMENTS = ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan flute", "Shawm", "Viol"];
export const ARTISANS_TOOLS = [
	"Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools", "Cartographer's tools",
	"Cobbler's tools", "Cook's utensils", "Glassblower's tools", "Jeweler's tools", "Leatherworker's tools",
	"Mason's tools", "Painter's supplies", "Potter's tools", "Smith's tools", "Tinker's tools",
	"Weaver's tools", "Woodcarver's tools",
];
/** Everything `{any: n}` may draw from — the artisan's tools plus the other tool groups and the loose tools. */
export const OTHER_TOOLS = ["Disguise kit", "Forgery kit", "Herbalism kit", "Navigator's tools", "Poisoner's kit", "Thieves' tools", "Vehicles (land)", "Vehicles (water)"];

export const CHOICE_TYPE_SKILL = "skill";
export const CHOICE_TYPE_LANGUAGE = "language";
export const CHOICE_TYPE_TOOL = "tool";
export const CHOICE_TYPE_ABILITY = "ability";
export const CHOICE_TYPE_EXPERTISE = "expertise";

let _ID = 0;
const _nextId = () => `csc-${_ID++}`;

const _titleCase = str => String(str).replace(/\w\S*/g, txt => txt[0].toUpperCase() + txt.slice(1));

/**
 * Human-readable summary of a proficiency group array
 * (used for the "apply the structured fields, render the rest as text" path).
 * @param [opts.isFixedOnly] Drop the "N of your choice" entries, keeping only outright grants.
 * @param [opts.isChoiceOnly] The inverse: keep only the choices, for when the grants are stored structurally.
 */
export function getProfListDisplay (arr, {isFixedOnly = false, isChoiceOnly = false} = {}) {
	if (!arr || !arr.length) return "";
	const out = [];
	arr.forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (v === true) return isChoiceOnly ? undefined : out.push(_titleCase(k));
			if (isFixedOnly) return;
			if (k === "choose" && v && v.from) out.push(`${v.count || 1} of your choice`);
			else if (typeof v === "number") out.push(/^any/i.test(k) ? `${v} of your choice` : `${v}× ${_titleCase(k)}`);
			else if (/^any/i.test(k)) out.push("one of your choice");
		});
	});
	return out.join(", ");
}

const _ALL_SKILL_NAMES = () => CHAR_SHEET_SKILLS.map(({name}) => name);

/** Skill choices from a `skillProficiencies`-style group array. Option values are display names. */
export function getSkillChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_SKILL,
					sourceName,
					count: v.count || 1,
					from: v.from.map(name => getSkillNameByKey(getSkillKeyByName(name)) || _titleCase(name)),
					label: `Choose ${v.count || 1} skill${(v.count || 1) > 1 ? "s" : ""}`,
				});
			} else if (k === "any" && typeof v === "number") {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_SKILL,
					sourceName,
					count: v,
					from: _ALL_SKILL_NAMES(),
					label: `Choose ${v} skill${v > 1 ? "s" : ""} (any)`,
				});
			}
		});
	});
	return out;
}

/**
 * Expertise choices from an `expertise`-style group array (feats such as Prodigy / Skill Expert).
 * `{choose: {from, count}}` and `{any: n}` list skills directly; `{anyProficientSkill: n}` draws
 * from the character's currently-proficient skills, passed in as `proficientSkillNames`.
 * Fixed `{"skill": true}` grants are applied elsewhere and are not queued here.
 */
export function getExpertiseChoices ({groups, sourceName, proficientSkillNames = []}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_EXPERTISE,
					sourceName,
					count: v.count || 1,
					from: v.from.map(name => getSkillNameByKey(getSkillKeyByName(name)) || _titleCase(name)),
					label: `Expertise: choose ${v.count || 1} skill${(v.count || 1) > 1 ? "s" : ""}`,
				});
			} else if ((k === "any" || k === "anyProficientSkill") && typeof v === "number") {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_EXPERTISE,
					sourceName,
					count: v,
					from: k === "anyProficientSkill" ? [...proficientSkillNames] : _ALL_SKILL_NAMES(),
					label: `Expertise: choose ${v}${k === "anyProficientSkill" ? " proficient" : ""} skill${v > 1 ? "s" : ""}`,
				});
			}
		});
	});
	return out;
}

/** Language choices from a `languageProficiencies`-style group array. */
export function getLanguageChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_LANGUAGE,
					sourceName,
					count: v.count || 1,
					from: v.from.map(_titleCase),
					label: `Choose ${v.count || 1} language${(v.count || 1) > 1 ? "s" : ""}`,
				});
			} else if ((k === "anyStandard" || k === "any") && typeof v === "number") {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_LANGUAGE,
					sourceName,
					count: v,
					from: (k === "anyStandard" ? Parser.LANGUAGES_STANDARD : Parser.LANGUAGES_ALL).map(_titleCase),
					label: `Choose ${v}${k === "anyStandard" ? " standard" : ""} language${v > 1 ? "s" : ""}`,
				});
			}
		});
	});
	return out;
}

/** The `{anyX: n}` tool keys, and what each draws from. */
const _ALL_TOOLS = [...ARTISANS_TOOLS, ...GAMING_SETS, ...MUSICAL_INSTRUMENTS, ...OTHER_TOOLS].sort();
const _TOOL_ANY_KEYS = {
	anyGamingSet: {from: GAMING_SETS, what: "gaming set"},
	anyMusicalInstrument: {from: MUSICAL_INSTRUMENTS, what: "musical instrument"},
	anyArtisansTool: {from: ARTISANS_TOOLS, what: "artisan's tool"},
	any: {from: _ALL_TOOLS, what: "tool"},
	anyTool: {from: _ALL_TOOLS, what: "tool"},
};

/** Tool choices from a `toolProficiencies`-style group array; unrecognised keys are skipped (rendered as text elsewhere). */
export function getToolChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => {
			let from = null;
			if (k === "choose" && v?.from) {
				out.push({
					id: _nextId(),
					type: CHOICE_TYPE_TOOL,
					sourceName,
					count: v.count || 1,
					from: v.from.map(_titleCase),
					label: `Choose ${v.count || 1} tool${(v.count || 1) > 1 ? "s" : ""}`,
				});
				return;
			}
			if (typeof v !== "number") return;
			const spec = _TOOL_ANY_KEYS[k];
			if (!spec) return;
			out.push({
				id: _nextId(),
				type: CHOICE_TYPE_TOOL,
				sourceName,
				count: v,
				from: spec.from,
				label: `Choose ${v} ${spec.what}${v > 1 ? "s" : ""}`,
			});
		});
	});
	return out;
}

const _ABILITY_NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

/**
 * Normalise an `ability` array (race/background/feat) into packages of
 * `{fixed: {abv: n}, choose: {from, count, amount} | null, weighted: {from, weights} | null}`.
 * Multiple array entries are alternative packages ("choose one of these").
 */
export function getAbilityPackages (ability) {
	return (ability || []).map(pkg => {
		const fixed = {};
		Object.entries(pkg).forEach(([k, v]) => {
			if (k !== "choose" && typeof v === "number") fixed[k] = v;
		});
		const choose = pkg.choose && !pkg.choose.weighted
			? {from: pkg.choose.from || [], count: pkg.choose.count || 1, amount: pkg.choose.amount || 1}
			: null;
		const weighted = pkg.choose?.weighted
			? {from: pkg.choose.weighted.from || [], weights: pkg.choose.weighted.weights || []}
			: null;
		return {fixed, choose, weighted};
	});
}

/**
 * The fixed ability bonuses of an `ability` array, when unambiguous (exactly one package).
 * Alternative packages route through the choice queue instead.
 */
export function getFixedAbilityBonuses (ability) {
	const packages = getAbilityPackages(ability);
	if (packages.length !== 1) return {};
	return packages[0].fixed;
}

/** Short display for one ability package, e.g. "+2 Cha; +1 to 2 of Str, Dex" or "+2/+1 among Con, Int, Wis". */
export function getAbilityPackageDisplay (pkg) {
	const pts = [];
	Object.entries(pkg.fixed).forEach(([abv, n]) => pts.push(`${n >= 0 ? "+" : ""}${n} ${_ABILITY_NAMES[abv] || abv}`));
	if (pkg.choose) {
		const ptFrom = pkg.choose.from.length === 6 ? "any" : pkg.choose.from.map(abv => _ABILITY_NAMES[abv] || abv).join(", ");
		pts.push(`+${pkg.choose.amount} to ${pkg.choose.count} of ${ptFrom}`);
	}
	if (pkg.weighted) {
		const ptWeights = pkg.weighted.weights.map(w => `+${w}`).join("/");
		pts.push(`${ptWeights} among ${pkg.weighted.from.map(abv => _ABILITY_NAMES[abv] || abv).join(", ")}`);
	}
	return pts.join("; ");
}

/**
 * Ability score increase choices from an `ability` array. Fixed single-package bonuses are not
 * queued (apply them via `getFixedAbilityBonuses`); anything with alternatives or picks is.
 */
export function getAbilityChoices ({ability, sourceName}) {
	const packages = getAbilityPackages(ability);
	if (!packages.length) return [];
	const isChoice = packages.length > 1 || packages.some(pkg => pkg.choose || pkg.weighted);
	if (!isChoice) return [];

	return [{
		id: _nextId(),
		type: CHOICE_TYPE_ABILITY,
		sourceName,
		label: packages.length > 1
			? `Ability scores: choose ${packages.map(pkg => getAbilityPackageDisplay(pkg)).join(" — or — ")}`
			: `Ability scores: ${getAbilityPackageDisplay(packages[0])}`,
		packages,
	}];
}

export const CHOICE_TYPE_RESIST = "resist";

/**
 * Damage-resistance choices from a `resist`-style group array — a Dragonborn's draconic ancestry
 * ("choose acid, cold, fire, lightning or poison") and the handful of species built the same way.
 * Fixed resistances are applied directly elsewhere; only the picks are queued.
 */
export function getResistChoices ({groups, sourceName}) {
	const out = [];
	(groups || []).forEach(grp => {
		if (typeof grp !== "object" || !grp.choose?.from) return;
		const count = grp.choose.count || 1;
		out.push({
			id: _nextId(),
			type: CHOICE_TYPE_RESIST,
			sourceName,
			count,
			from: grp.choose.from.map(it => _titleCase(String(it))),
			label: `Choose ${count} damage resistance${count > 1 ? "s" : ""}`,
		});
	});
	return out;
}

/** Granted-feat entries (`feats` on 2024-style backgrounds/races) are `{"name|source": true}` maps. */
export function getGrantedFeats (feats) {
	const out = [];
	(feats || []).forEach(grp => {
		Object.entries(grp).forEach(([uid, v]) => {
			if (v !== true) return;
			const [name, source] = uid.split("|");
			if (!name) return;
			out.push({
				name,
				source: source || "PHB",
				displayName: name.split(";").map(pt => _titleCase(pt.trim())).join(" — "),
			});
		});
	});
	return out;
}

/**
 * Feats an entity grants as a *category* rather than by name — "you gain an Origin feat of your
 * choice", which is how the 2024 Human's Versatile is written and how several backgrounds work.
 *
 * Separate from `getGrantedFeats` because the two need different treatment: one is a feat to take,
 * the other is a choice to make. Missing this shape entirely is why a Human's Versatile granted
 * nothing at all.
 *
 * @return {Array<{category: string, count: number}>}
 */
export function getGrantedFeatCategories (feats) {
	const out = [];
	(feats || []).forEach(grp => {
		const any = grp?.anyFromCategory;
		if (!any) return;
		const categories = [any.category].flat().filter(Boolean);
		categories.forEach(category => out.push({category: String(category).toUpperCase(), count: any.count || 1}));
	});
	return out;
}

/**
 * All pending choices for a set of picked entities, in creation-flow order.
 * `cls` skill choices come from `startingProficiencies`; class tools/languages are
 * rendered text in the data, not structured choices, so they are not queued.
 */
export function getPendingChoices ({race = null, background = null, cls = null} = {}) {
	const out = [];

	if (race) {
		const sourceName = `Species: ${race.name}`;
		out.push(...getAbilityChoices({ability: race.ability, sourceName}));
		out.push(...getSkillChoices({groups: race.skillProficiencies, sourceName}));
		out.push(...getLanguageChoices({groups: race.languageProficiencies, sourceName}));
		out.push(...getToolChoices({groups: race.toolProficiencies, sourceName}));
	}

	if (cls) {
		const sourceName = `Class: ${cls.name}`;
		out.push(...getSkillChoices({groups: cls.startingProficiencies?.skills, sourceName}));
	}

	if (background) {
		const sourceName = `Background: ${background.name}`;
		out.push(...getAbilityChoices({ability: background.ability, sourceName}));
		out.push(...getSkillChoices({groups: background.skillProficiencies, sourceName}));
		out.push(...getLanguageChoices({groups: background.languageProficiencies, sourceName}));
		out.push(...getToolChoices({groups: background.toolProficiencies, sourceName}));
	}

	return out;
}
