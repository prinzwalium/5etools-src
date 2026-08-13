import {
	getAsiCount,
	getCantripsKnown,
	getExpertiseSkillCount,
	getFeatProgressionCounts,
	getOptionalFeatureCounts,
	getSpellsKnown,
	getWeaponMasteryCount,
} from "./charactersheet-levelengine.js";
import {CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE} from "./charactersheet-consts.js";
import {getChoiceSignature, getChoiceWithoutHeld, getGrantedFeatCategories, getGrantedFeats, getHeldProficiencyNames, getPendingChoices} from "./charactersheet-choices.js";
import {getTraitChoices} from "./charactersheet-traitchoices.js";

/**
 * Everything still to decide before a character can be played, as one list.
 *
 * The guided setup used to stop after species, class, background, abilities, the origin choices and
 * equipment — which leaves a level-3 Rogue with no subclass, no Expertise, no weapon masteries and,
 * if it casts, no spells. Those decisions were all *available*, spread across the class panel, and a
 * new player had no way to know which of them were owed.
 *
 * So they are enumerated here instead, from the same data the panels read, and the guide walks
 * them. Pure: this says what is outstanding and how much of it, never how to ask. The asking lives
 * in `charactersheet-buildwalk.js`, which has the pickers.
 *
 * Each decision is `{key, label, detail, count, kind, ctx}` — `kind` names the flow that resolves
 * it, and `ctx` carries whatever that flow needs (which class entry, which progression).
 */

export const STEP_SUBCLASS = "subclass";
export const STEP_ASI = "asi";
export const STEP_EXPERTISE = "expertise";
export const STEP_MASTERY = "mastery";
export const STEP_OPTIONAL_FEATURE = "optionalFeature";
export const STEP_CLASS_FEAT = "classFeat";
export const STEP_ORIGIN_CHOICE = "originChoice";
export const STEP_ORIGIN_FEAT = "originFeat";
export const STEP_TRAIT_CHOICE = "traitChoice";
export const STEP_SPELLS = "spells";
export const STEP_HP = "hp";

/**
 * @param state the character state.
 * @param loaded `[{entry, cls, sc}]` — the character's classes with their data, as the panels load them.
 * @param speciesEnt/backgroundEnt the picked entities, or null.
 * @return {Array<{key, kind, label, detail, count, ctx}>} in the order somebody should answer them.
 */
export function getOutstandingDecisions ({state, loaded = [], speciesEnt = null, backgroundEnt = null} = {}) {
	const out = [];
	const st = state || {};

	/* ---------- what a species and a background still ask ---------- */

	[[speciesEnt, "species"], [backgroundEnt, "background"]].forEach(([ent, kind]) => {
		if (!ent) return;

		const held = getHeldProficiencyNames(st);

		getPendingChoices(kind === "species" ? {race: ent} : {background: ent})
			.filter(choice => !(st.choiceLog || []).some(it => it.sig === getChoiceSignature(choice) && it.picks.length))
			// A choice whose every option the character already has is spent, not owed — asking again
			// would only offer an empty list
			.filter(choice => !!getChoiceWithoutHeld(choice, held))
			.forEach(choice => out.push({
				key: `${STEP_ORIGIN_CHOICE}:${getChoiceSignature(choice)}`,
				kind: STEP_ORIGIN_CHOICE,
				label: choice.label,
				detail: ent.name,
				count: choice.count || 1,
				ctx: {ent, kind, choice},
			}));

		// Origin feats, named and "one of your choice" alike
		const taken = (st.originFeats || []);
		const takenKeys = new Set(taken.map(it => `${it.name}|${it.source}`.toLowerCase()));
		const named = getGrantedFeats(ent.feats);

		named
			.filter(it => !takenKeys.has(`${it.name}|${it.source}`.toLowerCase()))
			.forEach(feat => out.push({
				key: `${STEP_ORIGIN_FEAT}:${ent.name}:${feat.name}`,
				kind: STEP_ORIGIN_FEAT,
				label: `Origin feat: ${feat.displayName || feat.name}`,
				detail: ent.name,
				count: 1,
				ctx: {ent},
			}));

		const nChoice = getGrantedFeatCategories(ent.feats).reduce((acc, it) => acc + it.count, 0);
		const nFromHere = taken.filter(it => it.from === ent.name).length;
		const owed = nChoice - Math.max(0, nFromHere - named.length);
		if (owed > 0) {
			out.push({
				key: `${STEP_ORIGIN_FEAT}:${ent.name}:choice`,
				kind: STEP_ORIGIN_FEAT,
				label: `Origin feat of your choice`,
				detail: ent.name,
				count: owed,
				ctx: {ent},
			});
		}

		// "Choose one of the following" traits — an Elf's Lineage, a Dragonborn's Ancestry, a Goliath's
		// Giant Ancestry. These decide a cantrip, a damage type, a breath weapon; a character without
		// one is not playable, and nothing was listing them
		const level = (st.classes || []).reduce((acc, it) => acc + (Number(it.level) || 0), 0) || 1;
		getTraitChoices(ent)
			.filter(choice => (choice.level || 1) <= level)
			.filter(choice => !(st.traitChoices || []).some(it => it.source === ent.name && it.trait === choice.trait))
			.forEach(choice => out.push({
				key: `${STEP_TRAIT_CHOICE}:${ent.name}:${choice.trait}`,
				kind: STEP_TRAIT_CHOICE,
				label: choice.trait,
				detail: ent.name,
				count: 1,
				ctx: {ent, choice},
			}));
	});

	/* ---------- what each class still asks ---------- */

	loaded.forEach(({entry, cls, sc}) => {
		if (!cls) return;

		// The subclass, once its level has arrived — a Rogue 3 with no subclass is not playable
		const gainLevel = _getSubclassGainLevel(cls);
		if (gainLevel != null && entry.level >= gainLevel && !entry.subclass) {
			out.push({
				key: `${STEP_SUBCLASS}:${entry.id}`,
				kind: STEP_SUBCLASS,
				label: cls.subclassTitle ? `${cls.subclassTitle}` : "Subclass",
				detail: entry.name,
				count: 1,
				ctx: {entry, cls},
			});
		}

		const asiTotal = getAsiCount(cls, entry.level);
		const asiTaken = (entry.asiFeatChoices || []).filter(Boolean).length;
		if (asiTotal > asiTaken) {
			out.push({
				key: `${STEP_ASI}:${entry.id}`,
				kind: STEP_ASI,
				label: "Ability Score Improvement or feat",
				detail: entry.name,
				count: asiTotal - asiTaken,
				ctx: {entry, cls},
			});
		}

		// A feat the class table grants by category — the 2024 Fighting Style (Fighter 1, Paladin and
		// Ranger 2) and the Epic Boon at 19. These live in `featProgression`, not
		// `optionalfeatureProgression`, which is why a 2024 Fighter was never asked for its style
		[...getFeatProgressionCounts(cls, entry.level), ...(sc ? getFeatProgressionCounts(sc, entry.level) : [])]
			.forEach(prog => {
				// Counted by *category*, not by a key: the class panel already offers these from the
				// feature card that mentions them, under a key of its own. What matters is that a
				// Fighting Style was taken for this class, not which chooser recorded it
				const taken = (st.featureFeats || [])
					.filter(it => it.entryId === entry.id && prog.categories.includes(String(it.category || "").toUpperCase())).length;
				if (taken >= prog.count) return;
				out.push({
					key: `${STEP_CLASS_FEAT}:${entry.id}:${prog.name}`,
					kind: STEP_CLASS_FEAT,
					label: prog.name,
					detail: entry.name,
					count: prog.count - taken,
					ctx: {entry, prog},
				});
			});

		getOptionalFeatureCounts(cls, entry.level).forEach(prog => {
			const chosen = (entry.optionalFeatures || []).filter(it => it.progressionName === prog.name).length;
			if (chosen >= prog.count) return;
			out.push({
				key: `${STEP_OPTIONAL_FEATURE}:${entry.id}:${prog.name}`,
				kind: STEP_OPTIONAL_FEATURE,
				label: prog.name,
				detail: entry.name,
				count: prog.count - chosen,
				ctx: {entry, prog},
			});
		});

		const cantrips = getCantripsKnown(sc, entry.level) ?? getCantripsKnown(cls, entry.level);
		const known = getSpellsKnown(sc, entry.level) ?? getSpellsKnown(cls, entry.level);
		const isCaster = !!(cls.casterProgression || sc?.casterProgression || cls.spellcastingAbility || cantrips || known);
		if (isCaster) {
			const have = (st.spellsKnown || []).filter(it => !it.className || it.className === entry.name);
			const nCantrips = have.filter(it => !it.level).length;
			const nLeveled = have.filter(it => it.level).length;
			const owedCantrips = Math.max(0, (cantrips || 0) - nCantrips);
			const owedKnown = Math.max(0, (known || 0) - nLeveled);

			// A prepared caster has no fixed "known" count, so having nothing at all is the signal
			const isNothingAtAll = !have.length;
			if (owedCantrips || owedKnown || isNothingAtAll) {
				out.push({
					key: `${STEP_SPELLS}:${entry.id}`,
					kind: STEP_SPELLS,
					label: _getSpellLabel({owedCantrips, owedKnown, isNothingAtAll}),
					detail: entry.name,
					count: owedCantrips + owedKnown,
					ctx: {entry, cls},
				});
			}
		}
	});

	/* ---------- pools that span the classes ---------- */

	const expertiseTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getExpertiseSkillCount(cls, entry.level) : 0), 0);
	const expertiseTaken = CHAR_SHEET_SKILLS.filter(({key}) => Number(st[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;
	if (expertiseTotal > expertiseTaken) {
		out.push({
			key: STEP_EXPERTISE,
			kind: STEP_EXPERTISE,
			label: "Expertise",
			detail: "double your proficiency in a skill",
			count: expertiseTotal - expertiseTaken,
			ctx: {},
		});
	}

	const masteryTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getWeaponMasteryCount(cls, entry.level) : 0), 0);
	const masteryTaken = (st.weaponMasteries || []).length;
	if (masteryTotal > masteryTaken) {
		out.push({
			key: STEP_MASTERY,
			kind: STEP_MASTERY,
			label: "Weapon mastery",
			detail: "which weapons' mastery properties you can use",
			count: masteryTotal - masteryTaken,
			ctx: {},
		});
	}

	// Last, because it depends on Constitution, which the decisions above can still change
	if (!(Number(st.hpMax) > 0)) {
		out.push({key: STEP_HP, kind: STEP_HP, label: "Hit points", detail: "roll, average, or maximum", count: 1, ctx: {}});
	}

	return out;
}

const _getSpellLabel = ({owedCantrips, owedKnown, isNothingAtAll}) => {
	const parts = [];
	if (owedCantrips) parts.push(`${owedCantrips} cantrip${owedCantrips === 1 ? "" : "s"}`);
	if (owedKnown) parts.push(`${owedKnown} spell${owedKnown === 1 ? "" : "s"}`);
	if (!parts.length && isNothingAtAll) return "Spells";
	return `Spells: ${parts.join(" and ")} to choose`;
};

/** The level a class's subclass arrives at, read from where the feature says so. */
function _getSubclassGainLevel (cls) {
	const byLevel = cls?.classFeatures || [];
	for (let i = 0; i < byLevel.length; ++i) {
		const isGain = (byLevel[i] || []).some(f => f?.gainSubclassFeature);
		if (isGain) return i + 1;
	}
	return null;
}
