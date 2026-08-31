/**
 * Structured armor / weapon / tool / language proficiencies.
 *
 * The data holds these in two different shapes, so both are normalised here into
 * `{kind, name}` entries the sheet can store, group and attribute to a source:
 *
 *  - **Classes** use `startingProficiencies`, whose values are arrays of plain strings
 *    ("light", "simple"), `{@item ...}` tags, or `{proficiency, full, optional}` objects.
 *  - **Backgrounds and species** use `armorProficiencies`/`weaponProficiencies`/... arrays of
 *    `{key: true}` maps, alongside `{choose}`/`{any}` entries that are picks rather than grants.
 *
 * Only *fixed* grants are returned here; the choice-shaped entries are surfaced by the choice
 * engine (`charactersheet-choices.js`) so the player resolves them.
 *
 * Kept DOM-free and dependency-free so it can be unit-tested.
 */

export const PROF_KIND_ARMOR = "armor";
export const PROF_KIND_WEAPON = "weapon";
export const PROF_KIND_TOOL = "tool";
export const PROF_KIND_LANGUAGE = "language";

export const PROF_KINDS = [
	{kind: PROF_KIND_ARMOR, label: "Armor"},
	{kind: PROF_KIND_WEAPON, label: "Weapons"},
	{kind: PROF_KIND_TOOL, label: "Tools"},
	{kind: PROF_KIND_LANGUAGE, label: "Languages"},
];

/** `startingProficiencies` key → our kind. */
const _CLASS_KEY_TO_KIND = {armor: PROF_KIND_ARMOR, weapons: PROF_KIND_WEAPON, tools: PROF_KIND_TOOL, languages: PROF_KIND_LANGUAGE};
/** Background/species key → our kind. */
const _ENTITY_KEY_TO_KIND = {
	armorProficiencies: PROF_KIND_ARMOR,
	weaponProficiencies: PROF_KIND_WEAPON,
	toolProficiencies: PROF_KIND_TOOL,
	languageProficiencies: PROF_KIND_LANGUAGE,
};

const _titleCase = str => String(str).replace(/\w\S*/g, txt => txt[0].toUpperCase() + txt.slice(1));
const _sentenceCase = str => str ? str[0].toUpperCase() + str.slice(1) : str;

/**
 * Display text for a proficiency value: `{@item thieves' tools|phb|Thieves' Tools}` → its display
 * text, a bare uid ("battleaxe|phb") → its name, and anything else cased for display.
 *
 * Short values are names ("light", "thieves' tools") and read best title-cased; a whole clause
 * ("martial weapons that have the Finesse or Light property") does not, so it only gets its first
 * letter capitalised.
 */
export function getProficiencyDisplay (val) {
	let str = String(val ?? "").trim();
	if (!str) return "";

	str = str.replace(/\{@(\w+)\s+([^}]+)\}/g, (_, tag, inner) => {
		const parts = inner.split("|");
		// `{@filter display|page|...}` leads with its display text; entity tags end with theirs
		if (tag.toLowerCase() === "filter") return (parts[0] || "").trim();
		return (parts[2] || parts[0] || "").trim();
	});
	// A bare "name|source" uid keeps only the name (names may contain spaces, e.g. "light hammer|phb")
	if (str.includes("|")) str = str.split("|")[0];

	str = str.trim();
	return str.split(/\s+/).length > 3 ? _sentenceCase(str) : _titleCase(str);
}

/**
 * Fixed proficiencies granted by a class's `startingProficiencies`.
 * Entries flagged `optional` in the data (e.g. firearms) are returned with `isOptional`.
 * @return {Array<{kind: string, name: string, isOptional: boolean}>}
 */
export function getClassProficiencies (cls) {
	const out = [];
	const sp = cls?.startingProficiencies || {};

	Object.entries(_CLASS_KEY_TO_KIND).forEach(([key, kind]) => {
		const vals = sp[key];
		if (!Array.isArray(vals)) return;
		vals.forEach(val => {
			if (val == null) return;
			// `{choose}` entries are picks, not grants — the choice engine surfaces those
			if (typeof val === "object" && val.choose) return;

			const raw = typeof val === "object" ? (val.full || val.proficiency) : val;
			const name = getProficiencyDisplay(raw);
			if (!name) return;
			out.push({kind, name, isOptional: !!(typeof val === "object" && val.optional)});
		});
	});

	return out;
}

/**
 * Fixed proficiencies gained when *multiclassing* into a class — a strict subset of the starting
 * ones (`multiclassing.proficienciesGained`), and empty for classes which grant none.
 * @return {Array<{kind: string, name: string, isOptional: boolean}>}
 */
export function getMulticlassProficiencies (cls) {
	return getClassProficiencies({startingProficiencies: cls?.multiclassing?.proficienciesGained});
}

/**
 * Fixed proficiencies granted by a background or species (`{key: true}` group maps).
 * `choose`/`any`/`anyStandard` entries are picks and are skipped.
 * @return {Array<{kind: string, name: string, isOptional: boolean}>}
 */
export function getEntityProficiencies (ent) {
	const out = [];

	Object.entries(_ENTITY_KEY_TO_KIND).forEach(([key, kind]) => {
		const groups = ent?.[key];
		if (!Array.isArray(groups)) return;
		groups.forEach(grp => {
			if (!grp || typeof grp !== "object") return;
			Object.entries(grp).forEach(([k, v]) => {
				if (v !== true) return; // numbers and `choose` objects are picks
				const name = getProficiencyDisplay(k);
				if (name) out.push({kind, name, isOptional: false});
			});
		});
	});

	return out;
}

/**
 * Merge proficiency entries, folding duplicates together and keeping every source that grants one
 * (so a proficiency from both class and background shows both, rather than appearing twice).
 * @param entries `[{id, kind, name, source}]`
 * @return {Array<{kind: string, name: string, sources: string[], ids: string[], isOptional: boolean}>}
 */
export function mergeProficiencies (entries) {
	const byKey = new Map();

	// See `mergeDefenses`: a save file is an input from outside, and a string here must not be fatal
	(Array.isArray(entries) ? entries : []).forEach(it => {
		if (!it?.name) return;
		const key = `${it.kind}|${it.name.toLowerCase()}`;
		if (!byKey.has(key)) byKey.set(key, {kind: it.kind, name: it.name, sources: [], ids: [], isOptional: !!it.isOptional});
		const cur = byKey.get(key);
		if (it.id) cur.ids.push(it.id);
		if (it.source && !cur.sources.includes(it.source)) cur.sources.push(it.source);
		// A proficiency granted unconditionally anywhere is no longer optional
		if (!it.isOptional) cur.isOptional = false;
	});

	return [...byKey.values()];
}

/** Group merged proficiencies by kind, in display order, dropping empty kinds. */
export function groupProficienciesByKind (entries) {
	const merged = mergeProficiencies(entries);
	return PROF_KINDS
		.map(({kind, label}) => ({
			kind,
			label,
			items: merged
				.filter(it => it.kind === kind)
				.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1),
		}))
		.filter(grp => grp.items.length);
}
