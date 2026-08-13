import {CHAR_SHEET_SKILLS, getSkillKeyByName, getSkillNameByKey} from "./charactersheet-consts.js";
import {getEntityProficiencies, PROF_KIND_LANGUAGE, PROF_KIND_TOOL} from "./charactersheet-proficiencies.js";

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
/** One pick that may be spent on a skill, a tool *or* a language — see `getSkillToolLanguageChoices`. */
export const CHOICE_TYPE_SKILL_TOOL_LANGUAGE = "skillToolLanguage";
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

/**
 * A stable name for one choice, so that "has this been answered?" has an answer.
 *
 * The `id`s handed out above are per-render and cannot be stored; what identifies a choice across
 * sessions is where it came from and what it asks. Everything that resolves a choice — the guided
 * setup, the species and background pickers — records it under this key, and everything that asks
 * what is left reads the same one. Without it the guide and the panels each kept their own idea of
 * what had been done, and disagreed.
 */
export function getChoiceSignature (choice) {
	return `${choice?.sourceName || ""}|${choice?.type || ""}|${choice?.label || ""}`;
}

const _ALL_SKILL_NAMES = () => CHAR_SHEET_SKILLS.map(({name}) => name);

/**
 * What the character already holds, keyed by the choice type that could offer it again.
 *
 * Nothing is gained by taking the same proficiency twice, and the sheet cannot say so afterwards: a
 * skill records a state, not a count, so a second grant lands on a box that is already ticked and
 * the pick is simply lost. A Human Fighter offered Acrobatics by both its species and its class can
 * spend two of its three skills on one. So every chooser subtracts this set first.
 */
export function getHeldProficiencyNames (state) {
	const out = {
		[CHOICE_TYPE_SKILL]: new Set(),
		[CHOICE_TYPE_TOOL]: new Set(),
		[CHOICE_TYPE_LANGUAGE]: new Set(),
	};

	CHAR_SHEET_SKILLS.forEach(({key, name}) => {
		if (Number(state?.[`skill_${key}`]) > 0) out[CHOICE_TYPE_SKILL].add(name);
	});

	(state?.proficiencies || []).forEach(prof => {
		const bucket = prof?.kind === PROF_KIND_TOOL
			? out[CHOICE_TYPE_TOOL]
			: prof?.kind === PROF_KIND_LANGUAGE ? out[CHOICE_TYPE_LANGUAGE] : null;
		if (!bucket) return;
		(Array.isArray(prof.entries) ? prof.entries : []).forEach(name => bucket.add(name));
	});

	return out;
}

/**
 * The same, for entities that are *picked but not yet applied* — the guided setup's draft. Its
 * choices are all answered before anything reaches the sheet, so the character cannot yet tell the
 * class chooser that the background hands it Stealth outright.
 */
export function getFixedProficiencyNames ({race = null, background = null, cls = null} = {}) {
	const out = {
		[CHOICE_TYPE_SKILL]: new Set(),
		[CHOICE_TYPE_TOOL]: new Set(),
		[CHOICE_TYPE_LANGUAGE]: new Set(),
	};

	[race, background, cls].filter(Boolean).forEach(ent => {
		(ent.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => {
				if (v !== true) return;
				const name = getSkillNameByKey(getSkillKeyByName(k));
				if (name) out[CHOICE_TYPE_SKILL].add(name);
			});
		});

		getEntityProficiencies(ent).forEach(prof => {
			if (prof.kind === PROF_KIND_TOOL) out[CHOICE_TYPE_TOOL].add(prof.name);
			else if (prof.kind === PROF_KIND_LANGUAGE) out[CHOICE_TYPE_LANGUAGE].add(prof.name);
		});
	});

	return out;
}

/** The union of two such maps. */
export function mergeHeldProficiencyNames (...maps) {
	const out = {
		[CHOICE_TYPE_SKILL]: new Set(),
		[CHOICE_TYPE_TOOL]: new Set(),
		[CHOICE_TYPE_LANGUAGE]: new Set(),
	};
	maps.filter(Boolean).forEach(map => {
		Object.entries(out).forEach(([type, set]) => (map[type] || []).forEach(name => set.add(name)));
	});
	return out;
}

/**
 * A choice with everything the character already has taken out of it, and its count clipped to what
 * is left. Returns `null` when nothing remains to offer — the grant is spent, not owed.
 */
export function getChoiceWithoutHeld (choice, held) {
	const taken = held?.[choice?.type];
	if (!taken?.size || !Array.isArray(choice?.from)) return choice;
	const from = choice.from.filter(name => !taken.has(name));
	if (!from.length) return null;
	return {...choice, from, count: Math.min(choice.count || 1, from.length)};
}

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

/**
 * Every tool a "choose any tool" may draw from.
 *
 * A static fallback, not the truth: the real list is the item data, read by
 * `CharacterSheetClassData.pGetToolProficiencyNames`. This is what callers that cannot await get,
 * and what applies when the item data will not load.
 */
export const ALL_TOOL_NAMES = [...ARTISANS_TOOLS, ...GAMING_SETS, ...MUSICAL_INSTRUMENTS, ...OTHER_TOOLS].sort();
const _ALL_TOOLS = ALL_TOOL_NAMES;

/**
 * `skillToolLanguageProficiencies` — one pick spendable across the three kinds.
 *
 * The books' "any combination of three skills or tools of your choice" (Skilled, a Half-Elf's Skill
 * Versatility) is not three skill picks *and* three tool picks; it is three picks from one pool. The
 * data says exactly that, in its own field, with `anySkill` / `anyTool` / `anyLanguage` as the pool
 * tokens — which is why nothing was found by reading `skillProficiencies` alone.
 *
 * Two shapes appear:
 *  - `{choose: [{from: ["anySkill", "anyTool"], count: 3}]}` — the mixed pool;
 *  - a bare `{anyTool: 1}` or `{anyLanguage: 1, anyTool: 1}` group, which is the same thing with one
 *    token per key.
 *
 * `toolNames` is injected rather than read here, so this stays pure and testable: callers that can
 * await pass the real item-data list, and the rest get the static fallback.
 *
 * @return {Array} choices whose `pools` say which kind each option in `from` belongs to.
 */
export function getSkillToolLanguageChoices ({groups, sourceName, toolNames = ALL_TOOL_NAMES} = {}) {
	const out = [];
	const _WHAT = {[CHOICE_TYPE_SKILL]: "skill", [CHOICE_TYPE_TOOL]: "tool", [CHOICE_TYPE_LANGUAGE]: "language"};

	const mkPools = tokens => {
		const pools = {[CHOICE_TYPE_SKILL]: [], [CHOICE_TYPE_TOOL]: [], [CHOICE_TYPE_LANGUAGE]: []};
		tokens.forEach(token => {
			switch (token) {
				case "anySkill": pools[CHOICE_TYPE_SKILL] = _ALL_SKILL_NAMES(); break;
				case "anyTool": pools[CHOICE_TYPE_TOOL] = [...toolNames]; break;
				case "anyLanguage": pools[CHOICE_TYPE_LANGUAGE] = (Parser.LANGUAGES_ALL || []).map(_titleCase); break;
				case "anyStandardLanguage": pools[CHOICE_TYPE_LANGUAGE] = (Parser.LANGUAGES_STANDARD || []).map(_titleCase); break;
				// An unknown token would silently shrink the pool, so it is skipped rather than guessed at
			}
		});
		return pools;
	};

	const push = ({tokens, count}) => {
		const pools = mkPools(tokens);
		const from = [...pools[CHOICE_TYPE_SKILL], ...pools[CHOICE_TYPE_TOOL], ...pools[CHOICE_TYPE_LANGUAGE]];
		if (!from.length) return;
		const n = count || 1;
		// "3 skills or tools", not "3 skill or tools" — each kind carries the plural
		const kinds = Object.entries(pools)
			.filter(([, list]) => list.length)
			.map(([type]) => `${_WHAT[type]}${n > 1 ? "s" : ""}`);
		out.push({
			id: _nextId(),
			type: CHOICE_TYPE_SKILL_TOOL_LANGUAGE,
			sourceName,
			count: n,
			from,
			pools,
			label: `Choose ${n} ${kinds.join(" or ")}`,
		});
	};

	(groups || []).forEach(grp => {
		Object.entries(grp || {}).forEach(([k, v]) => {
			if (k === "choose") {
				[v].flat().filter(Boolean).forEach(c => push({tokens: [c.from].flat().filter(Boolean), count: c.count}));
				return;
			}
			if (typeof v === "number") push({tokens: [k], count: v});
		});
	});

	return out;
}

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
			const [uidName, source] = uid.split("|");
			if (!uidName) return;
			// A uid may narrow the feat as well as name it — `"magic initiate; cleric|xphb"` is the
			// Magic Initiate feat, taken with the Cleric list. Only the part before the semicolon is
			// the feat's real name, and that is what a taken feat is stored under; keeping the whole
			// string here is what left an Acolyte's granted feat looking untaken forever.
			const [name, ...subs] = uidName.split(";").map(pt => pt.trim()).filter(Boolean);
			if (!name) return;
			out.push({
				name,
				source: source || "PHB",
				subChoice: subs.join(", ") || null,
				displayName: [name, ...subs].map(pt => _titleCase(pt)).join(" — "),
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
export function getPendingChoices ({race = null, background = null, cls = null, toolNames = ALL_TOOL_NAMES} = {}) {
	const out = [];

	if (race) {
		const sourceName = `Species: ${race.name}`;
		out.push(...getAbilityChoices({ability: race.ability, sourceName}));
		out.push(...getSkillChoices({groups: race.skillProficiencies, sourceName}));
		out.push(...getLanguageChoices({groups: race.languageProficiencies, sourceName}));
		out.push(...getToolChoices({groups: race.toolProficiencies, sourceName}));
		out.push(...getSkillToolLanguageChoices({groups: race.skillToolLanguageProficiencies, sourceName, toolNames}));
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
		out.push(...getSkillToolLanguageChoices({groups: background.skillToolLanguageProficiencies, sourceName, toolNames}));
	}

	return out;
}
