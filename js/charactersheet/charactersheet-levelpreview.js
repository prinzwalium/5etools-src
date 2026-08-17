import {
	getAsiCount,
	getCantripsKnown,
	getClassResources,
	getExpertiseSkillCount,
	getFeatProgressionCounts,
	getOptionalFeatureCounts,
	getPreparedSpellCount,
	getSingleClassSlots,
	getSpellsKnown,
	getLevelUpHp,
	getWeaponMasteryCount,
} from "./charactersheet-levelengine.js";

/**
 * What a level actually gains you, worked out before you commit to it.
 *
 * Every sheet walks you through a level-up; none tells you the outcome first, so the way to find out
 * what 5th level gives a Fighter is to become 5th level and look. That is fine until it is wrong —
 * a mis-typed level, the wrong class in a multiclass — and then the only way back is undoing a
 * scatter of changes by hand.
 *
 * The whole answer is already derivable: the level engine reads everything *by level*, so the diff
 * is derive-at-N, derive-at-N+1, subtract. That is all this is. It reports; it never writes, which
 * is what lets the caller show it and then do nothing.
 *
 * Pure and DOM-free: entities in, a list of lines out.
 */

/** "1st", "2nd", ... — local rather than borrowed, so this module needs nothing but its inputs. */
const _ordinal = n => {
	const rem100 = n % 100;
	if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
	switch (n % 10) {
		case 1: return `${n}st`;
		case 2: return `${n}nd`;
		case 3: return `${n}rd`;
		default: return `${n}th`;
	}
};

/** A gain worth mentioning. `detail` is the "0 → 2" half, where there is one. */
const _mkLine = (label, detail = null) => ({label, detail});

/**
 * @param cls the class entity, dereferenced as the panels load it.
 * @param sc its subclass entity, or null.
 * @param levelFrom the class level now; `levelTo` the level being considered.
 * @param opts.conMod Constitution modifier, for the hit-point line.
 * @param opts.hpPerLevel anything adding hit points per level (Tough, Dwarven Toughness).
 * @param opts.abilityMod the spellcasting ability modifier, for a 2014 prepared caster's formula.
 * @return {{levelFrom, levelTo, lines: Array<{label, detail}>, decisions: Array<{label, detail}>}}
 *   `lines` is what you gain; `decisions` is what you will have to choose afterwards.
 */
export function getLevelUpPreview ({cls, sc = null, levelFrom, levelTo, conMod = 0, hpPerLevel = 0, abilityMod = 0} = {}) {
	const lines = [];
	const decisions = [];
	if (!cls || !(levelTo > levelFrom)) return {levelFrom, levelTo, lines, decisions};

	const numLevels = levelTo - levelFrom;

	/* ---------- hit points ---------- */

	// The average, because that is what the prompt offers first; the prompt still lets you roll
	const hp = getLevelUpHp({faces: cls.hd?.faces || 8, conMod: conMod + hpPerLevel, numLevels});
	if (hp?.total) {
		const ptCon = conMod ? `, Constitution ${conMod > 0 ? "+" : "−"}${Math.abs(conMod)} per level` : "";
		lines.push(_mkLine(`+${hp.total} hit points`, `${numLevels}d${cls.hd?.faces || 8} average${ptCon}`));
	}

	/* ---------- proficiency bonus ---------- */

	// Character level, not class level — but a single-class character is the common case, and saying
	// "unchanged" is the point: it stops somebody expecting it to move
	const pbFrom = Math.floor((levelFrom - 1) / 4) + 2;
	const pbTo = Math.floor((levelTo - 1) / 4) + 2;
	if (pbTo !== pbFrom) lines.push(_mkLine("Proficiency bonus", `+${pbFrom} → +${pbTo}`));

	/* ---------- features ---------- */

	_getFeatureNamesBetween(cls, levelFrom, levelTo).forEach(name => lines.push(_mkLine(name, "class feature")));
	if (sc) _getFeatureNamesBetween(sc, levelFrom, levelTo, {isSubclass: true}).forEach(name => lines.push(_mkLine(name, sc.name)));

	/* ---------- spell slots ---------- */

	const slotsFrom = getSingleClassSlots(cls, levelFrom) || [];
	const slotsTo = getSingleClassSlots(cls, levelTo) || [];
	slotsTo.forEach((n, ix) => {
		const was = Number(slotsFrom[ix]) || 0;
		if (n === was) return;
		lines.push(_mkLine(`${_ordinal(ix + 1)}-level spell slots`, `${was} → ${n}`));
	});

	/* ---------- what casts, and how much of it ---------- */

	_addCountLine({lines, label: "cantrips known", from: getCantripsKnown(sc, levelFrom) ?? getCantripsKnown(cls, levelFrom), to: getCantripsKnown(sc, levelTo) ?? getCantripsKnown(cls, levelTo), decisions});
	_addCountLine({lines, label: "spells known", from: getSpellsKnown(sc, levelFrom) ?? getSpellsKnown(cls, levelFrom), to: getSpellsKnown(sc, levelTo) ?? getSpellsKnown(cls, levelTo), decisions});

	const prepFrom = getPreparedSpellCount(cls, levelFrom, abilityMod);
	const prepTo = getPreparedSpellCount(cls, levelTo, abilityMod);
	if (prepTo != null && prepFrom != null && prepTo !== prepFrom) {
		lines.push(_mkLine("spells prepared", `${prepFrom} → ${prepTo}`));
	}

	/* ---------- what the class table hands out ---------- */

	getClassResources(cls, levelTo).forEach(res => {
		const was = (getClassResources(cls, levelFrom).find(it => it.label === res.label) || {}).value;
		if (was === res.value) return;
		lines.push(_mkLine(res.label, `${was ?? "—"} → ${res.value}`));
	});

	/* ---------- and what it will then ask you to choose ---------- */

	_addDecision({decisions, label: "Ability Score Improvement or feat", from: getAsiCount(cls, levelFrom), to: getAsiCount(cls, levelTo)});
	_addDecision({decisions, label: "Expertise", from: getExpertiseSkillCount(cls, levelFrom), to: getExpertiseSkillCount(cls, levelTo), detail: "skills to double"});
	_addDecision({decisions, label: "Weapon mastery", from: getWeaponMasteryCount(cls, levelFrom), to: getWeaponMasteryCount(cls, levelTo)});

	[[cls, null], [sc, sc?.name]].filter(([ent]) => ent).forEach(([ent, from]) => {
		getOptionalFeatureCounts(ent, levelTo).forEach(prog => {
			const was = (getOptionalFeatureCounts(ent, levelFrom).find(it => it.name === prog.name) || {}).count || 0;
			_addDecision({decisions, label: prog.name, from: was, to: prog.count, detail: from});
		});
		getFeatProgressionCounts(ent, levelTo).forEach(prog => {
			const was = (getFeatProgressionCounts(ent, levelFrom).find(it => it.name === prog.name) || {}).count || 0;
			_addDecision({decisions, label: prog.name, from: was, to: prog.count, detail: from});
		});
	});

	// A subclass arriving is itself a decision, and the biggest one
	const gainLevel = _getSubclassGainLevel(cls);
	if (!sc && gainLevel != null && levelFrom < gainLevel && levelTo >= gainLevel) {
		decisions.push(_mkLine(cls.subclassTitle || "Subclass", "choose one"));
	}

	return {levelFrom, levelTo, lines, decisions};
}

function _addCountLine ({lines, label, from, to, decisions}) {
	if (to == null || to === from) return;
	const was = from ?? 0;
	lines.push(_mkLine(label, `${was} → ${to}`));
	if (to > was) decisions.push(_mkLine(`${to - was} ${label} to choose`));
}

function _addDecision ({decisions, label, from, to, detail = null}) {
	const gained = (to || 0) - (from || 0);
	if (gained <= 0) return;
	decisions.push(_mkLine(gained > 1 ? `${label} ×${gained}` : label, detail));
}

/**
 * Feature names gained strictly after `levelFrom`, up to and including `levelTo`.
 *
 * Copes with both shapes the data takes. `DataLoader`'s class loader dereferences `classFeatures`
 * into resolved objects, which is what the pages hand in; the files themselves hold string refs
 * (`"Second Wind|Fighter||1"`) and `{classFeature, gainSubclassFeature}` wrappers, which is what a
 * test reading the JSON gets. Handling only the resolved form made this work in the app and throw
 * everywhere else — and a preview nobody can unit-test is a preview nobody can trust.
 */
function _getFeatureNamesBetween (ent, levelFrom, levelTo, {isSubclass = false} = {}) {
	const byLevel = (isSubclass ? ent?.subclassFeatures : ent?.classFeatures) || [];
	const out = [];

	const readOne = feature => {
		if (!feature) return;

		if (typeof feature === "string") {
			// "Name|Class|Source|Level" — the name is all a reader wants
			const name = feature.split("|")[0]?.trim();
			if (name) out.push(name);
			return;
		}

		// The generic "you gain a Subclass feature" markers say nothing a player wants read back
		if (feature.gainSubclassFeature) return;
		if (typeof feature.classFeature === "string" || typeof feature.subclassFeature === "string") {
			return readOne(feature.classFeature || feature.subclassFeature);
		}

		const name = feature.name || feature.entries?.[0]?.name;
		if (name) out.push(name);
	};

	for (let lvl = levelFrom + 1; lvl <= levelTo; ++lvl) {
		[byLevel[lvl - 1]].flat().filter(Boolean).forEach(readOne);
	}
	return out;
}

function _getSubclassGainLevel (cls) {
	const byLevel = cls?.classFeatures || [];
	for (let i = 0; i < byLevel.length; ++i) {
		if ((byLevel[i] || []).some(f => f?.gainSubclassFeature)) return i + 1;
	}
	return null;
}
