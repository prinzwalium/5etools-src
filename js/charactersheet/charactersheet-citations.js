/**
 * Which rule explains a number.
 *
 * The breakdowns already say *what* went into a value ("Dexterity +3, Proficiency +2, Archery +2").
 * This says *why* each of those is allowed to be there, by pointing at the rule's own entry in the
 * data — so the sheet can show the paragraph rather than paraphrase it.
 *
 * Two kinds of citation:
 *
 *  - a **key** into `CITATIONS` below, for the core rules that are prose in a chapter
 *    ("Proficiency", "Armor Class", "Passive Perception"). These are real, addressable entries in
 *    `variantrules.json` / `conditionsdiseases.json`, not curated text of our own.
 *  - a **descriptor** `{name, source, page}` built at derivation time, for the things the character
 *    actually has: a worn item, a feat, a fighting style.
 *
 * Pure and DOM-free: it says which entity to show, never how to fetch or render it. Resolving a
 * citation to a hash and loading it belongs to the page (`CharacterPageBase`), because that needs
 * `UrlUtil` and the `DataLoader`.
 */

const PG_VARIANT_RULES = "variantrules.html";
const PG_CONDITIONS = "conditionsdiseases.html";

export const PG_ITEMS = "items.html";
export const PG_FEATS = "feats.html";
export const PG_OPT_FEATURES = "optionalfeatures.html";

/**
 * The core rules a character sheet's arithmetic leans on. Sourced from the 2024 rules glossary
 * (`XPHB`), which states each of these as its own short entry — the 2014 books bury the same text
 * in chapter prose, where there is nothing to link to.
 */
export const CITATIONS = {
	proficiency: {name: "Proficiency", source: "XPHB", page: PG_VARIANT_RULES},
	abilityModifier: {name: "Ability Score and Modifier", source: "XPHB", page: PG_VARIANT_RULES},
	abilityCheck: {name: "Ability Check", source: "XPHB", page: PG_VARIANT_RULES},
	savingThrow: {name: "Saving Throw", source: "XPHB", page: PG_VARIANT_RULES},
	skill: {name: "Skill", source: "XPHB", page: PG_VARIANT_RULES},
	d20Test: {name: "D20 Test", source: "XPHB", page: PG_VARIANT_RULES},
	attackRoll: {name: "Attack Roll", source: "XPHB", page: PG_VARIANT_RULES},
	armorClass: {name: "Armor Class", source: "XPHB", page: PG_VARIANT_RULES},
	initiative: {name: "Initiative", source: "XPHB", page: PG_VARIANT_RULES},
	passivePerception: {name: "Passive Perception", source: "XPHB", page: PG_VARIANT_RULES},
	carryingCapacity: {name: "Carrying Capacity", source: "XPHB", page: PG_VARIANT_RULES},
	deathSavingThrow: {name: "Death Saving Throw", source: "XPHB", page: PG_VARIANT_RULES},
	exhaustion: {name: "Exhaustion", source: "XPHB", page: PG_CONDITIONS},
};

/**
 * The rule behind a whole derived number, by what the sheet calls it. The parts carry their own
 * citations; this is the one for the value they add up to.
 */
const _BREAKDOWN_CITATIONS = {
	abilityCheck: "abilityCheck",
	save: "savingThrow",
	skill: "skill",
	ac: "armorClass",
	initiative: "initiative",
	passivePerception: "passivePerception",
	attack: "attackRoll",
	spellAttack: "attackRoll",
	spellDc: "savingThrow",
	encumbrance: "carryingCapacity",
	deathSave: "deathSavingThrow",
};

/** @return the citation for a whole derived number ("save", "ac", …), or null. */
export function getBreakdownCitation (kind) {
	return resolveCitation(_BREAKDOWN_CITATIONS[kind]);
}

/**
 * Normalise whatever a part carries in `cite` into a `{name, source, page}` descriptor.
 * Accepts a key into `CITATIONS`, an already-built descriptor, or nothing.
 */
export function resolveCitation (cite) {
	if (!cite) return null;
	if (typeof cite === "string") return CITATIONS[cite] || null;
	if (!cite.name || !cite.page) return null;
	return {name: cite.name, source: cite.source || "PHB", page: cite.page};
}

/** A citation for an item the character owns, so a magic bonus can point at the thing granting it. */
export function getItemCitation (item) {
	if (!item?.name) return null;
	return {name: item.name, source: item.source || "PHB", page: PG_ITEMS};
}

/** A citation for an optional feature (a fighting style, an invocation). */
export function getOptionalFeatureCitation (feature) {
	if (!feature?.name) return null;
	return {name: feature.name, source: feature.source || "PHB", page: PG_OPT_FEATURES};
}

/** Two citations are the same rule when they point at the same entity. */
export function isSameCitation (a, b) {
	const ra = resolveCitation(a);
	const rb = resolveCitation(b);
	if (!ra || !rb) return false;
	return ra.name === rb.name && ra.source === rb.source && ra.page === rb.page;
}

/**
 * The citations behind a set of parts, in order and without repeats — what a "sources" footer would
 * list. A part with no citation simply contributes nothing.
 */
export function getPartCitations (parts) {
	const out = [];
	(parts || []).forEach(part => {
		const cite = resolveCitation(part?.cite);
		if (!cite) return;
		if (out.some(it => isSameCitation(it, cite))) return;
		out.push(cite);
	});
	return out;
}
