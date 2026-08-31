/**
 * A character at a glance, from its state alone.
 *
 * This is what a GM sees when they open a player's sheet, and it is deliberately *read-only by
 * construction* rather than by a flag: it takes a plain state object, computes from the same pure
 * modules the sheet uses, and returns values. There is no model, no store and no way for a view
 * built on it to write anything back.
 *
 * It is also the groundwork for the party sheet, which is the same question asked of several
 * characters at once — "who here has darkvision, who resists fire, what is the best passive
 * Perception". Building it once means the two cannot disagree.
 *
 * DOM-free and tested.
 */

import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {getAllDefenses, mergeDefenses} from "./charactersheet-defenses.js";
import {deriveCharacterSheet} from "./charactersheet-derive.js";

/** `Fighter 5 / Rogue 2`, or the typed line when there are no structured classes. */
export function getClassLine (state) {
	const classes = (state?.classes || []).filter(it => it?.name);
	// A subclass is `{name, shortName, source}`, not a string. Interpolating it printed
	// "Wizard ([object Object]) 11" on every card that shows a character's class — and the test that
	// should have caught it wrote the fixture as a string, which is a shape the model never produces.
	// Both are accepted now, because a character saved long enough ago may hold either.
	const subclassOf = it => (typeof it.subclass === "string"
		? it.subclass
		: it.subclass?.shortName || it.subclass?.name || null);
	if (classes.length) {
		return classes
			.map(it => `${it.name}${subclassOf(it) ? ` (${subclassOf(it)})` : ""} ${it.level || 1}`)
			.join(" / ");
	}
	return (state?.classText || state?.classLevel || "").trim() || "—";
}

const _formatMod = mod => `${mod >= 0 ? "+" : "−"}${Math.abs(mod)}`;

/**
 * @return everything a card needs, already formatted where a formatted value is what gets shown.
 *         Nothing here is a promise or a lookup: a caller can render it synchronously.
 */
export function getCharacterSummary (state) {
	const st = state || {};
	const derived = deriveCharacterSheet(st);
	const defenses = mergeDefenses(getAllDefenses(st));

	const byKind = kind => defenses.filter(it => it.kind === kind).map(it => it.name);

	return {
		name: (st.name || "").trim() || "Unnamed Character",
		classLine: getClassLine(st),
		level: derived.totalLevel,
		// The model spells these `speciesText` and `backgroundText`; `race` and `background` are the
		// pre-2024 names and are not on a character, so every summary reported neither
		species: (st.speciesText || st.race || "").trim() || null,
		background: (st.backgroundText || st.background || "").trim() || null,

		armorClass: derived.armorClass.ac,
		hpMax: Number(st.hpMax) || 0,
		hpCur: st.hpCur == null ? null : Number(st.hpCur),
		speed: (st.speed || "").toString().trim() || null,
		initiative: derived.initiative,
		passivePerception: derived.passivePerception,
		profBonus: derived.pb,
		spellSaveDc: derived.spell?.dc ?? null,

		abilities: CHAR_SHEET_ABILITIES.map(([abv, label]) => ({
			abv,
			label,
			score: derived.abilities[abv].score,
			mod: derived.abilities[abv].mod,
			modText: _formatMod(derived.abilities[abv].mod),
		})),

		// Only what is proficient: a card listing all eighteen skills is a table, not a glance
		saves: CHAR_SHEET_ABILITIES
			.filter(([abv]) => derived.saves[abv].isProf)
			.map(([abv, label]) => ({abv, label, mod: derived.saves[abv].mod, modText: _formatMod(derived.saves[abv].mod)})),

		skills: CHAR_SHEET_SKILLS
			.filter(({key}) => derived.skills[key].profState)
			.map(({key, name}) => ({
				key,
				name,
				mod: derived.skills[key].mod,
				modText: _formatMod(derived.skills[key].mod),
				isExpertise: derived.skills[key].profState === PROF_STATE_EXPERTISE,
				isProficient: derived.skills[key].profState === PROF_STATE_PROFICIENT,
			})),

		senses: byKind("sense"),
		resistances: byKind("resist"),
		immunities: byKind("immune"),
		vulnerabilities: byKind("vulnerable"),
		conditionImmunities: byKind("conditionImmune"),

		languages: ((st.proficiencies || []).filter(it => it?.kind === "language").map(it => it.name)),
		exhaustion: derived.exhaustion.level,
	};
}

/**
 * The lines a card actually prints, in order, with the empty ones already dropped.
 *
 * Kept here rather than in the view so that "what a GM is shown" is a tested decision instead of
 * whatever the markup happened to include.
 */
export function getSummaryLines (summary) {
	const join = list => (list || []).join(", ");
	return [
		{label: "Class", value: summary.classLine},
		{label: "Species", value: summary.species},
		{label: "Background", value: summary.background},
		{label: "Armor Class", value: summary.armorClass},
		{label: "Hit Points", value: summary.hpCur == null ? summary.hpMax : `${summary.hpCur} / ${summary.hpMax}`},
		{label: "Speed", value: summary.speed},
		{label: "Initiative", value: _formatMod(summary.initiative)},
		{label: "Passive Perception", value: summary.passivePerception},
		{label: "Proficiency", value: _formatMod(summary.profBonus)},
		{label: "Spell save DC", value: summary.spellSaveDc},
		{label: "Saves", value: join(summary.saves.map(it => `${it.label} ${it.modText}`))},
		{label: "Skills", value: join(summary.skills.map(it => `${it.name} ${it.modText}${it.isExpertise ? " (ex)" : ""}`))},
		{label: "Senses", value: join(summary.senses)},
		{label: "Resistances", value: join(summary.resistances)},
		{label: "Immunities", value: join(summary.immunities)},
		{label: "Vulnerabilities", value: join(summary.vulnerabilities)},
		{label: "Condition immunities", value: join(summary.conditionImmunities)},
		{label: "Languages", value: join(summary.languages)},
		{label: "Exhaustion", value: summary.exhaustion || null},
		// Armor Class is always worth a line, even at 0 — an absent AC is itself something to see
	].filter(it => it.label === "Armor Class" || (it.value != null && it.value !== "" && it.value !== 0));
}

export {PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT};
