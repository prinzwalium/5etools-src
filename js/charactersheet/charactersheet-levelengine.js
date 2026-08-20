/**
 * The leveling engine: pure rules derivation from class/subclass entities.
 *
 * Everything here reads the class data (`classTableGroups`/`rowsSpellProgression`,
 * `cantripProgression`, `spellsKnownProgression`, `casterProgression`,
 * `optionalfeatureProgression`, `multiclassing`) rather than hardcoding per-class rules.
 * The one deliberate exception is the PHB multiclass spellcaster slot table, which is a
 * fixed core rule, not per-class data.
 *
 * All functions are deterministic and side-effect-free; class/subclass entities are inputs.
 */

/** PHB multiclass spellcaster table: combined caster level → slots per spell level (1st–9th). */
export const MULTICLASS_SLOT_TABLE = [
	[2, 0, 0, 0, 0, 0, 0, 0, 0],
	[3, 0, 0, 0, 0, 0, 0, 0, 0],
	[4, 2, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 2, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 1, 0, 0, 0, 0, 0],
	[4, 3, 3, 2, 0, 0, 0, 0, 0],
	[4, 3, 3, 3, 1, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const _clampLevel = level => Math.min(20, Math.max(1, Number(level) || 1));

/**
 * A class's contribution to combined multiclass caster level (PHB p.164; artificer rounds up).
 * Pact magic does not contribute; its slots stack separately.
 */
export function getCasterLevelContribution (casterProgression, level) {
	level = _clampLevel(level);
	switch (casterProgression) {
		case "full": return level;
		case "1/2": return Math.floor(level / 2);
		case "1/3": return Math.floor(level / 3);
		case "artificer": return Math.ceil(level / 2);
		default: return 0;
	}
}

const _getTableGroups = clsOrSc => clsOrSc?.classTableGroups || clsOrSc?.subclassTableGroups || [];

/**
 * Spell slots at `level` from an entity's own class/subclass table (`rowsSpellProgression`).
 * @return {?Array<number>} Slots per spell level (1st–9th, zero-padded), or null if the entity has no slot table.
 */
export function getSingleClassSlots (clsOrSc, level) {
	level = _clampLevel(level);
	const group = _getTableGroups(clsOrSc).find(g => g.rowsSpellProgression);
	if (!group) return null;
	const row = group.rowsSpellProgression[level - 1];
	if (!row) return null;
	return [...new Array(9)].map((_, i) => Number(row[i]) || 0);
}

// Matches e.g. "{@filter 3rd|spells|...}" → "3rd"; the engine avoids a renderer dependency
const _stripTags = str => String(str).replace(/\{@\w+ ([^|}]+)[^}]*\}/g, "$1");

/**
 * Pact Magic slots at `level`, parsed from the "Spell Slots"/"Slot Level" table columns.
 * @return {?{count: number, level: number}}
 */
export function getPactSlots (cls, level) {
	if (cls?.casterProgression !== "pact") return null;
	level = _clampLevel(level);
	for (const group of _getTableGroups(cls)) {
		if (!group.colLabels || !group.rows) continue;
		const labels = group.colLabels.map(l => _stripTags(l).trim().toLowerCase());
		const ixCount = labels.indexOf("spell slots");
		const ixSlotLevel = labels.indexOf("slot level");
		if (ixCount < 0 || ixSlotLevel < 0) continue;
		const row = group.rows[level - 1];
		if (!row) return null;
		const slotLevel = Number(_stripTags(row[ixSlotLevel]).replace(/\D/g, ""));
		return {count: Number(row[ixCount]) || 0, level: slotLevel || 0};
	}
	return null;
}

/** Read a per-level progression array (e.g. `cantripProgression`) off a class or its subclass. */
const _getProgressionValue = (clsOrSc, prop, level) => {
	const arr = clsOrSc?.[prop];
	if (!arr) return null;
	return arr[_clampLevel(level) - 1] ?? null;
};

export function getCantripsKnown (clsOrSc, level) { return _getProgressionValue(clsOrSc, "cantripProgression", level); }
export function getSpellsKnown (clsOrSc, level) { return _getProgressionValue(clsOrSc, "spellsKnownProgression", level); }

/**
 * Human-readable form of the prepared-spell allowance.
 *
 * The 2024 classes give it as a by-level table (`preparedSpellsProgression`) rather than the 2014
 * formula, so there is nothing to spell out: the number *is* the rule.
 */
export function getPreparedSpellsDisplay (cls, level = null) {
	if (cls?.preparedSpellsProgression) {
		const n = _getProgressionValue(cls, "preparedSpellsProgression", level ?? 1);
		return n == null ? null : `${n} (class table)`;
	}
	if (!cls?.preparedSpells) return null;
	return cls.preparedSpells
		.replace(/<\$level\$>/g, "class level")
		.replace(/<\$level_half_round_up\$>/g, "half class level (round up)")
		.replace(/<\$level_half_round_down\$>/g, "half class level (round down)")
		.replace(/<\$(\w{3})_mod\$>/g, (_, abv) => `${abv.toUpperCase()} modifier`);
}

/**
 * Number of spells a prepared caster can prepare.
 *
 * Two shapes, one per edition. 2014 gives a **formula** (`preparedSpells`, "class level + WIS
 * modifier"); 2024 replaced it with an exact **by-level table** (`preparedSpellsProgression`) that
 * no longer depends on the ability modifier at all. Reading only the formula left every 2024
 * prepared caster — Cleric, Druid, Wizard, Bard, Paladin, Ranger, Sorcerer, Warlock — with no
 * prepared limit whatsoever, so nothing could say how many spells they were owed.
 *
 * Returns at least 1 (you always prepare something), or `null` when the class does not prepare.
 */
export function getPreparedSpellCount (cls, level, abilityMod = 0) {
	if (cls?.preparedSpellsProgression) {
		const n = _getProgressionValue(cls, "preparedSpellsProgression", level);
		return n == null ? null : Math.max(1, n);
	}
	if (!cls?.preparedSpells) return null;
	level = _clampLevel(level);
	const expr = String(cls.preparedSpells)
		.replace(/<\$level_half_round_up\$>/g, `${Math.ceil(level / 2)}`)
		.replace(/<\$level_half_round_down\$>/g, `${Math.floor(level / 2)}`)
		.replace(/<\$level\$>/g, `${level}`)
		.replace(/<\$\w{3}_mod\$>/g, `${abilityMod}`);
	const parts = expr.split("+").map(s => Number(s.trim()));
	if (parts.some(n => isNaN(n))) return null;
	return Math.max(1, parts.reduce((a, b) => a + b, 0));
}

/**
 * How many prepared spells may be swapped when this class gains a level (2024 `preparedSpellsChange`).
 * `null` when the class does not say — which is every 2014 class.
 */
export function getPreparedSpellsChange (cls, level) {
	if (!cls?.preparedSpellsChange) return null;
	const n = _getProgressionValue(cls, "preparedSpellsChange", level);
	return n || null;
}

/**
 * Combined spellcasting for a set of leveled classes.
 * @param classEntries [{cls, sc, level}] — class entity, optional subclass entity, class level
 * @return {{slots: ?Array<number>, casterLevel: number, pact: ?{count: number, level: number}, casters: Array}}
 */
export function getSpellcastingMeta (classEntries) {
	const casters = [];
	let pact = null;

	classEntries.forEach(({cls, sc, level}) => {
		const pactSlots = getPactSlots(cls, level);
		if (pactSlots) {
			// Multiple pact classes stack their levels (rare, homebrew); recompute off the summed level
			pact = pact
				? getPactSlots(cls, _clampLevel(level + pact._srcLevel))
				: pactSlots;
			if (pact) pact._srcLevel = level;
			return;
		}

		const casterEnt = cls?.casterProgression ? cls : (sc?.casterProgression ? sc : null);
		if (!casterEnt) return;
		casters.push({
			ent: casterEnt,
			cls,
			level,
			contribution: getCasterLevelContribution(casterEnt.casterProgression, level),
		});
	});

	if (pact) delete pact._srcLevel;

	const casterLevel = casters.reduce((acc, c) => acc + c.contribution, 0);

	let slots = null;
	if (casters.length === 1) {
		// Single (non-pact) caster: use its own class/subclass table, which handles
		// e.g. paladin's "no slots at level 1" and artificer's rounding natively
		slots = getSingleClassSlots(casters[0].ent, casters[0].level);
	} else if (casters.length > 1 && casterLevel > 0) {
		slots = [...MULTICLASS_SLOT_TABLE[_clampLevel(casterLevel) - 1]];
	}

	return {slots, casterLevel, pact, casters};
}

/**
 * Cumulative optional-feature picks (Fighting Styles, Invocations, Maneuvers, ...) available at `level`.
 * Reads `optionalfeatureProgression`, whose `progression` is either a 20-entry array of cumulative
 * counts or a `{level: cumulativeCount}` object.
 * @return {Array<{name: string, featureTypes: Array<string>, count: number}>}
 */
export function getOptionalFeatureCounts (clsOrSc, level) {
	level = _clampLevel(level);
	return (clsOrSc?.optionalfeatureProgression || [])
		.map(({name, featureType, progression}) => {
			let count = 0;
			if (Array.isArray(progression)) count = Number(progression[level - 1]) || 0;
			else {
				Object.entries(progression || {}).forEach(([lvl, cnt]) => {
					if (Number(lvl) <= level) count = Math.max(count, Number(cnt) || 0);
				});
			}
			return {name, featureTypes: featureType || [], count};
		})
		.filter(it => it.count > 0);
}

/**
 * Feats a class grants by level, as *categories* to choose from.
 *
 * The 2024 classes moved two things out of `optionalfeatureProgression` and into `featProgression`:
 * a **Fighting Style** (Fighter 1, Paladin 2, Ranger 2, Champion 7) — which is a feat of category
 * `FS` now, not an optional feature — and an **Epic Boon** at 19, for all thirteen. Reading only
 * `optionalfeatureProgression` meant a 2024 Fighter was never once asked for its Fighting Style.
 *
 * The shape matches `optionalfeatureProgression` deliberately, so the panels can treat the two
 * alike; `categories` replaces `featureTypes`, and names a feat category rather than a feature type.
 *
 * @return {Array<{name, categories: Array<string>, count: number}>}
 */
export function getFeatProgressionCounts (clsOrSc, level) {
	level = _clampLevel(level);
	return (clsOrSc?.featProgression || [])
		.map(({name, category, progression}) => {
			let count = 0;
			if (Array.isArray(progression)) count = Number(progression[level - 1]) || 0;
			else {
				// Cumulative by level, as the class tables read: the highest entry at or below `level`
				Object.entries(progression || {}).forEach(([lvl, cnt]) => {
					if (Number(lvl) <= level) count = Math.max(count, Number(cnt) || 0);
				});
			}
			return {name, categories: [category].flat().filter(Boolean).map(it => String(it).toUpperCase()), count};
		})
		.filter(it => it.count > 0);
}

/**
 * The abilities the class says matter most, as abbreviations.
 *
 * `primaryAbility` is a list of `{str: true}`-style maps — a list because a few classes name two,
 * and 2024 Ranger names one of two. It is the answer to the question every new player asks at the
 * ability-score step ("where does the 15 go?"), and it was sitting in the data unread.
 */
export function getPrimaryAbilities (cls) {
	const out = [];
	[cls?.primaryAbility].flat().filter(Boolean).forEach(grp => {
		if (typeof grp === "string") { out.push(grp.toLowerCase()); return; }
		Object.entries(grp).forEach(([abv, isPrimary]) => { if (isPrimary === true) out.push(abv.toLowerCase()); });
	});
	return [...new Set(out)];
}

/**
 * Number of Ability Score Improvement features gained by `level` (dereferenced class data).
 * These are the "ASI or feat" slots.
 */
export function getAsiCount (cls, level) {
	level = _clampLevel(level);
	return (cls?.classFeatures || [])
		.slice(0, level)
		.reduce((acc, lvlFeatures) => acc + (lvlFeatures || []).filter(f => f.name === "Ability Score Improvement").length, 0);
}

/**
 * How many proficiencies a class can mark as Expertise by `level`. Detected data-drivenly from the
 * class's "Expertise" features (Rogue, Bard, ...); each such feature grants two picks in the PHB.
 */
export function getExpertiseSkillCount (cls, level) {
	level = _clampLevel(level);
	return (cls?.classFeatures || [])
		.slice(0, level)
		.reduce((acc, lvlFeatures) => acc + (lvlFeatures || []).filter(f => f.name === "Expertise").length, 0) * 2;
}

/*
 * A class table's columns are three different things wearing one shape, and reading them as one was
 * wrong in both directions: Eldritch Invocations appeared as something a Warlock could *spend*, and
 * a Rogue's Sneak Attack appeared as nothing at all.
 *
 * - **Uses** are spent and given back: Rages, Channel Divinity, Second Wind, Ki, Sorcery Points.
 * - **Values** are a number the character *has*: Sneak Attack 2d6, Martial Arts d6, Rage Damage +2,
 *   Unarmored Movement +10 ft. They are read off the sheet, never ticked off it.
 * - **Counts of choices** — Invocations, Infusions, Weapon Mastery, anything "Known" — are answered
 *   in the builder and belong to the pickers that ask them, not to the resource list.
 *
 * The shape of the cell decides the first two: a plain integer is a use, a die or a bonus is a
 * value. The third has to be named, because "Invocations: 5" and "Rages: 5" are the same cell.
 */
const _RESOURCE_SKIP_LABEL = /cantrip|spells known|prepared spells|spells prepared|spell slots|slot level|known$|^\d+(st|nd|rd|th)$/i;

/** Something spent and given back by a rest. */
export const RESOURCE_KIND_USES = "uses";
/** A number the character has — Sneak Attack 2d6, Rage Damage +2. Read, never ticked. */
export const RESOURCE_KIND_VALUE = "value";

/** Columns that count choices rather than uses, and are answered elsewhere. */
const _RESOURCE_CHOICE_LABEL = /^(invocations|infusions|infused items|weapon mastery|magic items|plans|psi limit|die size|number)$/i;

/**
 * Which rest gives a resource back.
 *
 * Curated, because the class tables do not carry it — the rule lives in the feature's prose. Only
 * the unambiguous ones; anything unlisted is assumed to return on a long rest, which is both the
 * commoner case and the safer guess to be wrong about.
 */
const _RESOURCE_SHORT_REST = new Set([
	"second wind", "action surge", "channel divinity", "ki points", "focus points",
	"superiority dice", "bardic inspiration", "wild shape", "arcane recovery",
]);

/** Format a class-table cell (string / number / `{type:"dice"|"bonus"|"bonusSpeed"}`) to display text, or null. */
function _fmtResourceCell (cell) {
	if (cell == null) return null;
	if (typeof cell === "number") return cell ? `${cell}` : null;
	if (typeof cell === "string") return cell.trim() || null;
	if (cell.type === "dice") {
		const r = cell.toRoll?.[0];
		return r ? `${r.number}d${r.faces}` : null;
	}
	if (cell.type === "bonus") return `${cell.value >= 0 ? "+" : ""}${cell.value}`;
	if (cell.type === "bonusSpeed") return cell.value ? `+${cell.value} ft.` : null;
	return null;
}

// Classes whose Weapon Mastery count is fixed in feature prose ("two kinds") rather than a table column.
const _WEAPON_MASTERY_FIXED = {Rogue: 2, Ranger: 2, Paladin: 2};

/** How many weapon masteries the class grants at `level` (the "Weapon Mastery" table column, or a fixed prose count). */
export function getWeaponMasteryCount (cls, level) {
	level = _clampLevel(level);
	for (const group of _getTableGroups(cls)) {
		if (!group.colLabels || !group.rows) continue;
		const ix = group.colLabels.findIndex(l => /weapon mastery/i.test(_stripTags(l)));
		if (ix < 0) continue;
		const val = Number(_fmtResourceCell(group.rows[level - 1]?.[ix]));
		return isNaN(val) ? 0 : val;
	}
	// Fixed-count classes: only if the class actually has a Weapon Mastery feature (2024 classes)
	const hasWmFeature = (cls?.classFeatures || []).slice(0, level).some(lvl => (lvl || []).some(f => f.name === "Weapon Mastery"));
	return hasWmFeature ? (_WEAPON_MASTERY_FIXED[cls?.name] || 0) : 0;
}

/**
 * Spell uids ("cure wounds|phb") a class/subclass grants automatically via `additionalSpells`
 * (domain/patron/circle spells, always-prepared or expanded lists) up to `level`. Only the
 * numeric class-level keys and plain uid entries are returned; dynamic `{choose}`/`{all}` filter
 * entries and spell-slot-keyed (`s6`) grants are skipped.
 */
export function getGrantedSpellUids (clsOrSc, level) {
	level = _clampLevel(level);
	const out = [];
	(clsOrSc?.additionalSpells || []).forEach(grp => {
		["prepared", "known", "expanded", "innate"].forEach(bucket => {
			const byLevel = grp[bucket];
			if (!byLevel || typeof byLevel !== "object") return;
			Object.entries(byLevel).forEach(([lk, spells]) => {
				const lvl = Number(lk);
				if (isNaN(lvl) || lvl > level) return;
				(Array.isArray(spells) ? spells : [spells]).forEach(sp => {
					if (typeof sp === "string") out.push(sp.toLowerCase());
				});
			});
		});
	});
	return [...new Set(out)];
}

/**
 * Parse an `additionalSpells` filter string ("level=0;1;2|class=Cleric;Druid") into a matcher spec.
 * Unknown keys are preserved but unused; `levels`/`classes` are what the sheet can match on.
 * @return {{levels: number[], classes: string[]}}
 */
export function parseSpellFilter (str) {
	const out = {levels: [], classes: [], schools: []};
	String(str || "").split("|").forEach(part => {
		const ix = part.indexOf("=");
		if (ix < 0) return;
		const key = part.slice(0, ix).trim().toLowerCase();
		const vals = part.slice(ix + 1).split(";").map(v => v.trim()).filter(Boolean);
		if (key === "level") out.levels.push(...vals.map(Number).filter(n => !isNaN(n)));
		else if (key === "class") out.classes.push(...vals.map(v => v.toLowerCase()));
		else if (key === "school") out.schools.push(...vals.map(v => v.toUpperCase()));
	});
	return out;
}

/** Whether a spell entity satisfies a parsed spell filter (empty criteria match everything). */
export function isSpellMatchingFilter (spell, filter) {
	if (!spell || !filter) return false;
	if (filter.levels?.length && !filter.levels.includes(Number(spell.level))) return false;
	if (filter.schools?.length && !filter.schools.includes(String(spell.school || "").toUpperCase())) return false;
	if (filter.classes?.length) {
		const spellClasses = (spell._csClassNames || []).map(c => String(c).toLowerCase());
		if (!filter.classes.some(c => spellClasses.includes(c))) return false;
	}
	return true;
}

/**
 * Dynamic (non-plain-uid) `additionalSpells` grants up to `level` — the `{choose}` entries a player
 * must resolve (a domain/patron "choose a spell of level ≤ X") and the `{all}` entries that widen
 * the learnable pool rather than granting spells outright.
 *
 * `choose` grants (found in the prepared/known/innate buckets) are picks: `count` spells matching
 * `filter`, or chosen from an explicit `from` uid list. `all` grants appear only in the `expanded`
 * bucket, where they mean "these spells become available to learn" (e.g. a Bard's Magical Secrets) —
 * they are reported as `type: "expanded"` and must never be auto-added.
 *
 * @return {Array<{id: string, type: "choose"|"expanded", bucket: string, atLevel: number, count: number,
 *                 filter: object|null, from: string[]|null}>}
 */
export function getDynamicSpellGrants (clsOrSc, level) {
	level = _clampLevel(level);
	const out = [];
	(clsOrSc?.additionalSpells || []).forEach((grp, ixGrp) => {
		["prepared", "known", "expanded", "innate"].forEach(bucket => {
			const byLevel = grp[bucket];
			if (!byLevel || typeof byLevel !== "object") return;
			Object.entries(byLevel).forEach(([lk, spells]) => {
				// `_` means "always", used by feats and other level-less sources; `s6`-style
				// spell-slot keys are not class levels and are skipped.
				const atLevel = lk === "_" ? 0 : Number(lk);
				if (isNaN(atLevel) || atLevel > level) return;
				_flattenSpellEntries(spells).forEach((sp, ixSp) => {
					if (!sp || typeof sp !== "object") return;
					const base = {
						id: `${ixGrp}:${bucket}:${lk}:${ixSp}`,
						bucket,
						atLevel,
						// Alternative grant groups are distinguished by name (Magic Initiate's
						// "Bard Spells" / "Cleric Spells" / ...): the player picks one group.
						groupIndex: ixGrp,
						groupName: grp.name || null,
					};
					if (sp.choose != null) {
						const isList = typeof sp.choose === "object";
						out.push({
							...base,
							type: "choose",
							count: Number(sp.count ?? (isList ? sp.choose.count : null)) || 1,
							filter: isList ? null : parseSpellFilter(sp.choose),
							from: isList ? (sp.choose.from || []).map(uid => String(uid).split("#")[0].toLowerCase()) : null,
						});
					} else if (sp.all != null) {
						out.push({...base, type: "expanded", count: 0, filter: parseSpellFilter(sp.all), from: null});
					}
				});
			});
		});
	});
	return out;
}

/** The distinct named alternative groups in an `additionalSpells` array (empty when there is no choice). */
export function getSpellGrantGroups (ent) {
	const groups = (ent?.additionalSpells || [])
		.map((grp, ix) => ({index: ix, name: grp.name || null}))
		.filter(it => it.name);
	return groups.length > 1 ? groups : [];
}

/** Flatten an `additionalSpells` level value, unwrapping the `_`/frequency wrappers around lists. */
function _flattenSpellEntries (spells) {
	const out = [];
	const walk = node => {
		if (node == null) return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (typeof node !== "object") return out.push(node);
		// Wrappers whose values are the real entries: `_`, and innate frequency keys (daily/rest/resource/ritual)
		if (node.choose != null || node.all != null) return out.push(node);
		Object.values(node).forEach(walk);
	};
	walk(spells);
	return out;
}

/**
 * Per-level class resources read straight from the class/subclass table columns.
 *
 * Each carries what kind of thing it is (see `_RESOURCE_SKIP_LABEL` above): `"uses"` for something
 * spent and given back — Rages, Channel Divinity, Ki — and `"value"` for a number the character
 * simply has, like Sneak Attack 2d6 or Rage Damage +2. Spell-slot and known/prepared columns are
 * left to the spell panel, and columns that count *choices* are left to the pickers that ask them.
 *
 * `rest` says which rest returns a use, and is the one curated part: the class tables do not carry
 * it. Data-driven otherwise, so it needs no per-class rules.
 *
 * @return {Array<{label: string, value: string, kind: string, rest: string|null}>}
 */
export function getClassResources (clsOrSc, level) {
	level = _clampLevel(level);
	const out = [];
	for (const group of _getTableGroups(clsOrSc)) {
		if (!group.colLabels || !group.rows) continue;
		const row = group.rows[level - 1];
		if (!row) continue;
		group.colLabels.forEach((rawLabel, i) => {
			const label = _stripTags(rawLabel).trim();
			if (!label || _RESOURCE_SKIP_LABEL.test(label) || _RESOURCE_CHOICE_LABEL.test(label)) return;

			const value = _fmtResourceCell(row[i]);
			if (value == null) return;

			// A plain whole number is something you spend; a die, a bonus or a distance is not
			const isUses = /^\d+$/.test(value);
			out.push({
				label,
				value,
				kind: isUses ? RESOURCE_KIND_USES : RESOURCE_KIND_VALUE,
				rest: isUses ? (_RESOURCE_SHORT_REST.has(label.toLowerCase()) ? "short" : "long") : null,
			});
		});
	}
	return out;
}

/**
 * Check multiclassing ability requirements. Top-level ability keys are all required; keys within
 * an object inside `or` are alternatives (e.g. Fighter's `{or: [{str: 13, dex: 13}]}` means
 * "Strength 13 or Dexterity 13"), matching how the site renders these (see `render-class.js`).
 * @param requirements The class's `multiclassing.requirements`
 * @param abilityScores `{str: n, dex: n, ...}`
 */
export function isMulticlassRequirementMet (requirements, abilityScores) {
	if (!requirements) return true;
	const getScore = abv => Number(abilityScores?.[abv]) || 0;
	return Object.entries(requirements).every(([k, v]) => {
		if (k === "or") return v.every(grp => Object.entries(grp).some(([abv, min]) => getScore(abv) >= min));
		if (typeof v !== "number") return true; // ignore non-ability keys (e.g. "entries")
		return getScore(k) >= v;
	});
}

/** Display form of multiclass requirements, e.g. "Strength 13 or Dexterity 13". */
export function getMulticlassRequirementsDisplay (requirements) {
	if (!requirements) return "";
	const renderGrp = (obj, joiner) => Object.entries(obj)
		.filter(([, v]) => typeof v === "number")
		.map(([abv, min]) => `${Parser.attAbvToFull(abv)} ${min}`)
		.join(joiner);
	const orPart = (requirements.or || []).map(grp => renderGrp(grp, " or ")).join("; ");
	const basePart = renderGrp(requirements, ", ");
	return [orPart, basePart].filter(Boolean).join("; ");
}

/* -------------------------------------------- Feat prerequisites -------------------------------------------- */

// Prerequisite keys the sheet can meaningfully verify from character state; anything else
// (campaign, alignment, item, free-text "other", ...) is treated as unverifiable and never blocks.
const _FEAT_PREREQ_CHECKABLE = new Set(["level", "ability", "race", "feat", "background", "spellcasting", "spellcasting2020", "spellcastingFeature", "psionics"]);

const _normName = str => String(str || "").toLowerCase().trim();

/**
 * Evaluate one prerequisite entry against the character.
 * @return {"met"|"unmet"|"unknown"} met = all checkable clauses pass; unmet = a checkable clause
 *   fails; unknown = every checkable clause passes but an unverifiable clause remains.
 */
function _evalFeatPrereqEntry (entry, ctx) {
	let hasUnknown = false;

	for (const [key, val] of Object.entries(entry)) {
		if (key === "note") continue;
		if (!_FEAT_PREREQ_CHECKABLE.has(key)) { hasUnknown = true; continue; }

		switch (key) {
			case "level": {
				const req = typeof val === "number" ? val : Number(val.level) || 0;
				const clsReq = typeof val === "object" ? val.class?.name : null;
				if (clsReq) {
					const cls = (ctx.classes || []).find(c => _normName(c.name) === _normName(clsReq));
					if (!cls || cls.level < req) return "unmet";
				} else if ((ctx.totalLevel || 0) < req) return "unmet";
				break;
			}
			case "ability": {
				// Array of alternative ability-sets; within a set all abilities are required
				const isMet = (val || []).some(set => Object.entries(set).every(([abv, min]) => (Number(ctx.abilityScores?.[abv]) || 0) >= min));
				if (!isMet) return "unmet";
				break;
			}
			case "race": {
				const names = new Set((ctx.raceNames || []).map(_normName));
				const isMet = (val || []).some(r => names.has(_normName(r.name)));
				if (!isMet) return "unmet";
				break;
			}
			case "background": {
				const isMet = (val || []).some(b => _normName(b.name) === _normName(ctx.backgroundName));
				if (!isMet) return "unmet";
				break;
			}
			case "feat": {
				const taken = new Set((ctx.featNames || []).map(_normName));
				// Uids look like "name|source|display"; match on the name segment
				const isMet = (val || []).some(uid => taken.has(_normName(String(uid).split("|")[0])));
				if (!isMet) return "unmet";
				break;
			}
			case "spellcasting":
			case "spellcasting2020":
			case "spellcastingFeature": {
				if (!ctx.isSpellcaster) return "unmet";
				break;
			}
			case "psionics": {
				if (!ctx.isSpellcaster) { hasUnknown = true; } // no structured psionics tracking
				break;
			}
			default: hasUnknown = true;
		}
	}

	return hasUnknown ? "unknown" : "met";
}

/**
 * Check a feat's `prerequisite` array against character context. Entries are alternatives (OR).
 * @return {{status: "met"|"unmet"|"unknown"}} `unmet` only when every alternative has a concrete
 *   failing requirement, so a warning is raised solely when the character definitely does not qualify.
 */
export function checkFeatPrerequisites (prerequisite, ctx) {
	if (!prerequisite?.length) return {status: "met"};
	const entryStatuses = prerequisite.map(entry => _evalFeatPrereqEntry(entry, ctx));
	if (entryStatuses.includes("met")) return {status: "met"};
	if (entryStatuses.includes("unknown")) return {status: "unknown"};
	return {status: "unmet"};
}

/* -------------------------------------------- Hit points -------------------------------------------- */

/** Average HP gained for a level of a given hit die (5e "fixed" value): ⌊faces/2⌋ + 1. */
export function getHitDieAverage (faces) {
	return Math.floor((Number(faces) || 0) / 2) + 1;
}

/**
 * Suggested HP gained across `numLevels` new levels of a `faces`-sided hit die.
 * @param [opts.fnRoll] If given, each level rolls `fnRoll(faces)`; otherwise the fixed average is used.
 * @return {{total: number, perLevel: Array<number>}} Each level contributes at least 1 HP.
 */
/**
 * The HP the rules would give a character, as a breakdown — the sheet's Max HP is a typed value
 * (players roll, or a DM grants extras), so this is a reference to compare against rather than a
 * replacement. The first level of the *first* class gets the full hit die; every later level gets
 * the fixed average. Constitution applies once per level, and each level yields at least 1 HP.
 * @return {{total: number, parts: Array<{label: string, value: number}>}}
 */
export function getExpectedHp ({classes = [], conMod = 0} = {}) {
	const parts = [];
	let total = 0;
	let isFirstLevelOverall = true;

	(classes || []).forEach(cls => {
		const faces = Number(cls.hdFaces) || 0;
		const level = Math.max(0, Number(cls.level) || 0);
		if (!faces || !level) return;

		if (isFirstLevelOverall) {
			const first = Math.max(1, faces + conMod);
			parts.push({label: `${cls.name} level 1 (d${faces} max)`, value: first, isRaw: true});
			total += first;
			isFirstLevelOverall = false;
			if (level > 1) {
				const rest = (level - 1) * Math.max(1, getHitDieAverage(faces) + conMod);
				parts.push({label: `${cls.name} levels 2\u2013${level} (${level - 1} \u00d7 avg ${getHitDieAverage(faces)})`, value: rest});
				total += rest;
			}
			return;
		}

		const gained = level * Math.max(1, getHitDieAverage(faces) + conMod);
		parts.push({label: `${cls.name} ${level} (${level} \u00d7 avg ${getHitDieAverage(faces)})`, value: gained});
		total += gained;
	});

	if (parts.length && conMod) {
		const totalLevels = (classes || []).reduce((acc, c) => acc + (Number(c.level) || 0), 0);
		parts.push({label: `Constitution ${conMod >= 0 ? "+" : "\u2212"}${Math.abs(conMod)} \u00d7 ${totalLevels} levels`, value: 0, isText: true});
	}

	return {total, parts};
}

/* -------------------------------------------- how a maximum is arrived at -------------------------------------------- */

/** The fixed number the rules offer: maximum at 1st level, the die's average after. */
export const HP_MODE_AVERAGE = "average";
/** Every die at its maximum — the generous table's house rule, and the one nobody has to track. */
export const HP_MODE_MAX = "max";
/** The dice as they actually came up, typed in. */
export const HP_MODE_ROLLED = "rolled";

/**
 * A character's hit point maximum, by whichever of the three ways the table decided it.
 *
 * One function rather than three, because the *bonuses* are the same in all three cases and that is
 * where the mistakes were: Constitution is per level, and so is anything else that raises hit points
 * per level — Tough, a Dwarf's Dwarven Toughness. Typing a total into a box works right up until
 * Constitution changes, or a level is added, or Tough is taken, and then the number is a fossil
 * nobody can recompute. Here it is derived from what it is made of, and says so.
 *
 * @param opts.mode one of `HP_MODE_*`.
 * @param opts.rolled the dice total, for `HP_MODE_ROLLED`.
 * @param opts.perLevelBonus hit points a feature adds per level (`getHpBonusPerLevel`).
 * @return {{total: number, parts: Array, explanation: string}}
 */
export function getHitPointMaximum ({classes = [], conMod = 0, perLevelBonus = 0, mode = HP_MODE_AVERAGE, rolled = null} = {}) {
	const levels = (classes || []).reduce((acc, c) => acc + (Math.max(0, Number(c.level) || 0)), 0);
	const perLevel = conMod + perLevelBonus;

	const fmt = n => `${n >= 0 ? "+" : "\u2212"}${Math.abs(n)}`;
	const bonusParts = [];
	if (conMod) bonusParts.push({label: `Constitution ${fmt(conMod)} \u00d7 ${levels} level${levels === 1 ? "" : "s"}`, value: conMod * levels});
	if (perLevelBonus) bonusParts.push({label: `Features ${fmt(perLevelBonus)} \u00d7 ${levels} level${levels === 1 ? "" : "s"}`, value: perLevelBonus * levels});

	if (mode === HP_MODE_ROLLED) {
		const dice = Math.max(0, Number(rolled) || 0);
		const total = Math.max(1, dice + perLevel * levels);
		return {
			total,
			parts: [{label: "Rolled", value: dice, isRaw: true}, ...bonusParts],
			explanation: `${dice} rolled${bonusParts.length ? `, ${bonusParts.map(it => it.label).join(", ")}` : ""} = ${total}.`,
		};
	}

	if (mode === HP_MODE_MAX) {
		const dieParts = (classes || [])
			.filter(c => Number(c.hdFaces) && Number(c.level))
			.map(c => ({label: `${c.name} ${c.level} \u00d7 d${c.hdFaces} max`, value: Number(c.hdFaces) * Number(c.level), isRaw: true}));
		const dice = dieParts.reduce((acc, it) => acc + it.value, 0);
		const total = Math.max(1, dice + perLevel * levels);
		return {
			total,
			parts: [...dieParts, ...bonusParts],
			explanation: `${dice} from maximum dice${bonusParts.length ? `, ${bonusParts.map(it => it.label).join(", ")}` : ""} = ${total}.`,
		};
	}

	// The average, which is what `getExpectedHp` has always computed — Constitution included, so the
	// per-level feature bonus is the only thing left to add
	const expected = getExpectedHp({classes, conMod});
	const total = Math.max(1, expected.total + perLevelBonus * levels);
	return {
		total,
		parts: [...expected.parts, ...(perLevelBonus ? [{label: `Features ${fmt(perLevelBonus)} \u00d7 ${levels}`, value: perLevelBonus * levels}] : [])],
		explanation: `Maximum at 1st level, the die's average after${perLevelBonus ? `, plus features` : ""} = ${total}.`,
	};
}

export function getLevelUpHp ({faces, conMod = 0, numLevels = 1, fnRoll = null}) {
	const perLevel = [];
	for (let i = 0; i < numLevels; ++i) {
		const base = fnRoll ? fnRoll(faces) : getHitDieAverage(faces);
		perLevel.push(Math.max(1, base + conMod));
	}
	return {total: perLevel.reduce((a, b) => a + b, 0), perLevel};
}
