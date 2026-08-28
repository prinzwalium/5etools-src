import {getChoiceSignature} from "./charactersheet-choices.js";
import {getOutstandingDecisions, STEP_ASI, STEP_CLASS_FEAT, STEP_CLASS_PROFICIENCY, STEP_EXPERTISE, STEP_FIXED_SPELL, STEP_HP, STEP_LANGUAGE, STEP_MASTERY, STEP_OPTIONAL_FEATURE, STEP_ORIGIN_CHOICE, STEP_ORIGIN_FEAT, STEP_SIZE, STEP_SPELLS, STEP_SUBCLASS, STEP_TRAIT_CHOICE} from "./charactersheet-buildsteps.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {pPickList} from "./charactersheet-featgrant.js";
import {getLevelUpHp} from "./charactersheet-levelengine.js";
import {getHpBonusPerLevel} from "./charactersheet-features.js";

/**
 * Answering the decisions `charactersheet-buildsteps.js` lists.
 *
 * Every one of these questions already had a picker somewhere — on the class panel, on the spells
 * panel, in the page's own grant flows. What was missing was anything that *walked* them, so a new
 * character was finished only if its player already knew what to look for. This is that walk, and
 * it reuses those pickers rather than growing a second set: one place asks, one place decides.
 */
export class CharacterBuildWalk {
	/**
	 * @param page the page — for its class/spell panels and its origin-grant flows.
	 */
	constructor ({comp, page}) {
		this._comp = comp;
		this._page = page;
	}

	/** What is still owed, freshly computed. */
	async pGetDecisions () {
		const state = this._comp._getState();
		const loaded = await CharacterSheetClassData.pGetLoadedClasses(state.classes).catch(() => []);

		const [speciesEnt, backgroundEnt] = await Promise.all([
			state.refSpecies?.name ? CharacterSheetClassData.pGetSpecies(state.refSpecies).catch(() => null) : null,
			state.refBackground?.name ? CharacterSheetClassData.pGetBackground(state.refBackground).catch(() => null) : null,
		]);

		return getOutstandingDecisions({state, loaded, speciesEnt, backgroundEnt});
	}

	/**
	 * Ask the question behind one decision.
	 *
	 * Returns nothing: what changed is in the model, and the caller re-reads the list — which is also
	 * how one answer revealing another (a subclass that brings its own choices) stays honest.
	 */
	async pResolve (decision) {
		const {kind, ctx} = decision;

		switch (kind) {
			case STEP_ORIGIN_CHOICE:
				return this._page._pResolveProficiencyChoices({ent: ctx.ent, kind: ctx.kind === "species" ? "race" : "background"});

			case STEP_ORIGIN_FEAT:
				return this._page._pGrantOriginFeats(ctx.ent);

			case STEP_SIZE:
				return this._page._pResolveSizeChoice(ctx.ent);

			case STEP_TRAIT_CHOICE:
				return this._page._pResolveTraitChoices(ctx.ent);

			case STEP_SUBCLASS:
				return this._page._classPanel._pOnChooseSubclass({entry: ctx.entry, cls: ctx.cls});

			case STEP_ASI:
				return this._page._classPanel._pOnChooseAsiFeat({entry: ctx.entry});

			case STEP_OPTIONAL_FEATURE:
				return this._page._classPanel._pOnChooseOptionalFeature({entry: ctx.entry, prog: ctx.prog});

			// The class panel already offers these from the feature card that mentions them; the guide
			// reuses that picker, and the count is by category, so either route satisfies it
			case STEP_CLASS_FEAT:
				return this._page._classPanel._pOnChooseFeatureFeat({
					entry: ctx.entry,
					featureKey: `classprog:${ctx.prog.name}`,
					grant: {category: ctx.prog.categories[0], count: ctx.prog.count, name: ctx.prog.name},
				});

			case STEP_MASTERY:
				return this._page._classPanel._pOnChooseWeaponMastery();

			case STEP_EXPERTISE:
				return this._pResolveExpertise(decision);

			case STEP_SPELLS:
				return this._page._spellsPanel._pOnBrowseClassSpells();

			// The spells panel already offers this pick, filtered to the one spell level it allows
			case STEP_FIXED_SPELL:
				return this._page._spellsPanel._pOnChooseGrantedSpell({
					...ctx.grant,
					grantKey: ctx.grantKey,
					sourceName: ctx.grant.groupName || ctx.entry.name,
					className: ctx.cls.name,
				});

			case STEP_HP:
				return this._pResolveHp();

			// A class's own skills, tools and languages — the four a Rogue picks, the three
			// instruments a Bard does. The same resolver as a species', because it is the same
			// question; narrowed to the one choice this step names
			case STEP_CLASS_PROFICIENCY:
				return this._page._pResolveProficiencyChoices({
					ent: ctx.ent,
					kind: "cls",
					only: getChoiceSignature(ctx.choice),
				});

			case STEP_LANGUAGE:
				return this._page._pResolveLanguageChoice(ctx.choice);

			default:
				return null;
		}
	}

	/**
	 * Expertise, which on the class panel is a row of tick boxes rather than a picker — fine when you
	 * are looking at the panel, no use when something else is doing the asking.
	 */
	async _pResolveExpertise (decision) {
		const proficient = CHAR_SHEET_SKILLS
			.filter(({key}) => Number(this._comp._state[`skill_${key}`]) === PROF_STATE_PROFICIENT)
			.map(({name}) => name);

		if (!proficient.length) {
			JqueryUtil.doToast({type: "warning", content: "Expertise doubles a proficiency you already have — choose skills first."});
			return;
		}

		const picked = await pPickList({
			count: Math.min(decision.count, proficient.length),
			from: proficient,
			title: `Expertise: choose ${decision.count} skill${decision.count === 1 ? "" : "s"}`,
		});
		(picked || []).forEach(name => this._comp.setSkillProfByName(name, PROF_STATE_EXPERTISE));
	}

	/**
	 * Hit points at first level: the maximum die plus Constitution, per the rules — but a table that
	 * rolls from level one exists, so the roll is offered too rather than assumed away.
	 */
	async _pResolveHp () {
		const faces = Number(this._comp._state.classes?.[0]?.hdFaces) || 8;
		const conMod = Parser.getAbilityModNumber(Number(this._comp._state.abil_con) || 10);
		const level = this._comp.getLevelNumber();
		const perLevelBonus = getHpBonusPerLevel(this._comp._getState());

		const first = Math.max(1, faces + conMod + perLevelBonus);
		const rest = level > 1 ? getLevelUpHp({faces, conMod: conMod + perLevelBonus, numLevels: level - 1}).total : 0;
		const suggested = first + rest;

		const optAverage = `Average (${suggested} hit points)`;
		const optMax = `Maximum (${Math.max(1, level * (faces + conMod + perLevelBonus))} hit points)`;
		const optManual = "Enter it myself";

		const choice = await InputUiUtil.pGetUserEnum({
			values: [optAverage, optMax, optManual],
			isResolveItem: true,
			title: `Hit points at level ${level}`,
			placeholder: "How do you want them?",
		});
		if (choice == null) return;

		let hp = suggested;
		if (choice === optMax) hp = Math.max(1, level * (faces + conMod + perLevelBonus));
		else if (choice === optManual) {
			hp = await InputUiUtil.pGetUserNumber({title: "Hit point maximum", default: suggested, min: 1, int: true});
			if (hp == null) return;
		}

		this._comp._state.hpMax = hp;
		this._comp._state.hpCur = hp;
	}
}
