/**
 * Structured damage resistances, immunities, vulnerabilities, condition immunities and senses.
 *
 * All five are real fields in the data rather than prose, in the same three places a character
 * gets anything from:
 *
 *  - **Species** hold `resist`/`immune`/`vulnerable`/`conditionImmune` arrays and a `darkvision`
 *    (or `blindsight`/`tremorsense`/`truesight`) range in feet.
 *  - **Feats** hold the same arrays, and express senses as `senses: [{blindsight: 10}]`.
 *  - **Items** hold the same arrays, and apply only while the item is equipped — so those are
 *    derived on the fly rather than stored, the way magic bonuses are.
 *
 * Every value is normalised here into a `{kind, name}` entry the sheet can store, group and
 * attribute to a source. `{choose}` entries are picks rather than grants and are left to the
 * choice engine (`charactersheet-choices.js`).
 *
 * Kept DOM-free and dependency-free so it can be unit-tested.
 */

export const DEFENSE_KIND_RESIST = "resist";
export const DEFENSE_KIND_IMMUNE = "immune";
export const DEFENSE_KIND_VULNERABLE = "vulnerable";
export const DEFENSE_KIND_CONDITION_IMMUNE = "conditionImmune";
export const DEFENSE_KIND_SENSE = "sense";

export const DEFENSE_KINDS = [
	{kind: DEFENSE_KIND_RESIST, label: "Resistances"},
	{kind: DEFENSE_KIND_IMMUNE, label: "Immunities"},
	{kind: DEFENSE_KIND_VULNERABLE, label: "Vulnerabilities"},
	{kind: DEFENSE_KIND_CONDITION_IMMUNE, label: "Condition Immunities"},
	{kind: DEFENSE_KIND_SENSE, label: "Senses"},
];

/** The data's own key for each kind, shared by species, feats and items. */
const _DATA_KEY_TO_KIND = {
	resist: DEFENSE_KIND_RESIST,
	immune: DEFENSE_KIND_IMMUNE,
	vulnerable: DEFENSE_KIND_VULNERABLE,
	conditionImmune: DEFENSE_KIND_CONDITION_IMMUNE,
};

/** Senses given as a range in feet, wherever they appear. */
const _SENSE_KEYS = ["darkvision", "blindsight", "tremorsense", "truesight"];

const _titleCase = str => String(str).replace(/\w\S*/g, txt => txt[0].toUpperCase() + txt.slice(1));

/** "Darkvision 60 ft." — a sense reads as its name and its range. */
export function formatSense (name, rangeFt) {
	const ft = Number(rangeFt);
	return ft ? `${_titleCase(name)} ${ft} ft.` : _titleCase(name);
}

/**
 * Flatten one `resist`/`immune`/... array into names.
 *
 * The data uses four shapes: a plain string, a `{choose}` pick, a `{special}` clause the rules
 * state in words, and a nested `{resist: [...], note}` group for a conditional set ("while
 * raging"). Anything conditional keeps its note, so the sheet does not claim it applies always.
 */
function _readDefenseList (vals, kind) {
	const out = [];

	const walk = (val, curKind, note) => {
		if (val == null) return;

		if (typeof val === "string") return void out.push({kind: curKind, name: _titleCase(val), note});
		if (Array.isArray(val)) return void val.forEach(it => walk(it, curKind, note));
		if (typeof val !== "object") return;

		// A pick, not a grant — the choice engine offers it
		if (val.choose) return;
		if (val.special) return void out.push({kind: curKind, name: String(val.special), note});

		// A conditional group: `{resist: ["fire"], note: "while raging"}`, whose inner key names
		// the kind — a `vulnerable` group nested under `resist` is still a vulnerability
		const nxtNote = val.note || note;
		Object.entries(_DATA_KEY_TO_KIND)
			.forEach(([key, innerKind]) => walk(val[key], innerKind, nxtNote));
	};

	walk(vals, kind, null);
	return out;
}

/**
 * Everything a species, feat or item grants outright.
 * @return {Array<{kind: string, name: string, note: string|null}>}
 */
export function getEntityDefenses (ent) {
	const out = [];
	if (!ent) return out;

	Object.entries(_DATA_KEY_TO_KIND).forEach(([key, kind]) => {
		if (ent[key] != null) out.push(..._readDefenseList(ent[key], kind));
	});

	// A range in feet, given either at the top level (species) or in `senses` (feats)
	_SENSE_KEYS.forEach(key => {
		if (ent[key]) out.push({kind: DEFENSE_KIND_SENSE, name: formatSense(key, ent[key]), note: null});
	});
	// `senses` is the feat spelling; `bonusSenses` the one a feat uses when it *improves* a sense it
	// does not itself grant (Keenness of the Stone Giant's darkvision). Both are the same shape, and
	// reading only the first lost the second entirely.
	[ent.senses, ent.bonusSenses].forEach(arr => {
		(Array.isArray(arr) ? arr : []).forEach(grp => {
			if (!grp || typeof grp !== "object") return;
			Object.entries(grp).forEach(([key, range]) => {
				if (_SENSE_KEYS.includes(key)) out.push({kind: DEFENSE_KIND_SENSE, name: formatSense(key, range), note: null});
			});
		});
	});

	return out;
}

/**
 * What the character's *equipped* gear is granting right now. Held separately from the stored
 * entries because taking the ring off has to take the resistance with it.
 * @return {Array<{kind: string, name: string, note: string|null, source: string, isFromItem: boolean}>}
 */
export function getEquippedItemDefenses (state) {
	return (state?.inventory || [])
		.filter(it => it?.equipped)
		.flatMap(item => getEntityDefenses(item).map(it => ({...it, source: item.name, isFromItem: true})));
}

/**
 * The resistance a "choose one" species trait carries — a Dragonborn's ancestry, and the handful of
 * species built the same way. Derived from the pick rather than copied, so changing the ancestry
 * changes the resistance with it.
 * @return {Array<{kind: string, name: string, note: null, source: string}>}
 */
export function getTraitChoiceDefenses (state) {
	return (state?.traitChoices || [])
		.filter(it => it?.resist)
		.map(it => ({
			kind: DEFENSE_KIND_RESIST,
			name: _titleCase(it.resist),
			note: null,
			source: it.option ? `${it.source} (${it.option})` : it.source,
		}));
}

/**
 * Everything the sheet should show: what the character *has* (species, feats, hand-added), what its
 * trait picks imply, and what its equipped gear is granting right now.
 */
export function getAllDefenses (state) {
	return [
		...(state?.defenses || []),
		...getTraitChoiceDefenses(state),
		...getEquippedItemDefenses(state),
	];
}

/**
 * Merge entries, folding duplicates together and keeping every source that granted one — so a fire
 * resistance from both a species and a ring is listed once, crediting both.
 * @return {Array<{kind: string, name: string, note: string|null, sources: string[], ids: string[], isFromItem: boolean}>}
 */
export function mergeDefenses (entries) {
	const byKey = new Map();

	// Not just `|| []`: a hand-edited or ancient save file can have a *string* here, and a character
	// somebody sent you should fail to show a resistance rather than fail to open
	(Array.isArray(entries) ? entries : []).forEach(it => {
		if (!it?.name) return;
		const key = `${it.kind}|${it.name.toLowerCase()}`;
		if (!byKey.has(key)) byKey.set(key, {kind: it.kind, name: it.name, note: it.note || null, sources: [], ids: [], isFromItem: true});
		const cur = byKey.get(key);
		if (it.id) cur.ids.push(it.id);
		if (it.source && !cur.sources.includes(it.source)) cur.sources.push(it.source);
		if (it.note && !cur.note) cur.note = it.note;
		// Something granted by anything other than gear survives taking that gear off
		if (!it.isFromItem) cur.isFromItem = false;
	});

	return [...byKey.values()];
}

/** Group merged entries by kind, in display order, dropping the kinds a character has none of. */
export function groupDefensesByKind (entries) {
	const merged = mergeDefenses(entries);
	return DEFENSE_KINDS
		.map(({kind, label}) => ({
			kind,
			label,
			items: merged
				.filter(it => it.kind === kind)
				.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1),
		}))
		.filter(grp => grp.items.length);
}
