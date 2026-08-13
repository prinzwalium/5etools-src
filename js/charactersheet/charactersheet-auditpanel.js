import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE} from "./charactersheet-consts.js";
import {getEncumbrance} from "./charactersheet-derive.js";
import {getAsiCount, getCantripsKnown, getExpertiseSkillCount, getFeatProgressionCounts, getSpellsKnown, getWeaponMasteryCount} from "./charactersheet-levelengine.js";
import {AUDIT_BROKEN, auditCharacter, groupFindings} from "./charactersheet-audit.js";
import {getGrantedFeatCategories, getGrantedFeats} from "./charactersheet-choices.js";
import {getTraitChoices} from "./charactersheet-traitchoices.js";

/**
 * The build audit, on the builder: what breaks a rule, and what the character is owed but has not
 * taken. It reports and never blocks — a DM ruling beats it, and a character with findings is
 * still perfectly playable.
 *
 * The counts come from the same pure functions the class panel uses to *offer* those choices, so
 * the audit cannot drift from what the panel asks for.
 */
export class CharacterAuditPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		[
			"classes", "level", "inventory", "weaponMasteries", "pendingAbilityOffers",
			"refSpecies", "refBackground", "speciesText", "backgroundText", "hpMax",
			// Taking the background's origin feat is one of the things this panel asks for, so it
			// has to notice when it happens — and the same goes for picking a lineage or an ancestry
			// …and a Fighting Style or Epic Boon taken from the class panel, which this panel counts
			"originFeats", "spellsKnown", "traitChoices", "featureFeats",
			...CHAR_SHEET_SKILLS.map(({key}) => `skill_${key}`),
			"abil_str", "abil_dex", "abil_con", "abil_int", "abil_wis", "abil_cha",
		].forEach(prop => this._comp._addHookBase(prop, () => this._pRender()));
		this._pRender();
	}

	/** What the character's classes grant, and how much of it has been taken. */
	async _pGetCounts (loaded) {
		const state = this._comp._getState();

		const asiTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getAsiCount(cls, entry.level) : 0), 0);
		const asiTaken = (state.classes || [])
			.reduce((acc, entry) => acc + (entry.asiFeatChoices || []).filter(Boolean).length, 0);

		const expertiseTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getExpertiseSkillCount(cls, entry.level) : 0), 0);
		const expertiseTaken = CHAR_SHEET_SKILLS.filter(({key}) => Number(state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;

		const masteryTotal = loaded.reduce((acc, {entry, cls}) => acc + (cls ? getWeaponMasteryCount(cls, entry.level) : 0), 0);
		const masteryTaken = (state.weaponMasteries || []).length;

		// Feats the class table grants by category — the 2024 Fighting Style and the Epic Boon at 19
		let classFeatTotal = 0; let classFeatTaken = 0;
		loaded.forEach(({entry, cls, sc}) => {
			[...getFeatProgressionCounts(cls, entry.level), ...(sc ? getFeatProgressionCounts(sc, entry.level) : [])]
				.forEach(prog => {
					classFeatTotal += prog.count;
					classFeatTaken += (state.featureFeats || [])
						.filter(it => it.entryId === entry.id && prog.categories.includes(String(it.category || "").toUpperCase())).length;
				});
		});

		// Spells a caster is owed. Per class, since a multiclass caster's counts are separate, and
		// summed here because what somebody wants to know is "how many am I short"
		let cantripsTotal = 0; let cantripsTaken = 0; let spellsKnownTotal = 0; let spellsKnownTaken = 0;
		loaded.forEach(({entry, cls, sc}) => {
			if (!cls) return;
			const nCantrips = getCantripsKnown(sc, entry.level) ?? getCantripsKnown(cls, entry.level);
			const nKnown = getSpellsKnown(sc, entry.level) ?? getSpellsKnown(cls, entry.level);
			if (!nCantrips && !nKnown) return;

			const mine = (state.spellsKnown || []).filter(it => !it.className || it.className === entry.name);
			cantripsTotal += nCantrips || 0;
			cantripsTaken += mine.filter(it => !it.level).length;
			spellsKnownTotal += nKnown || 0;
			spellsKnownTaken += mine.filter(it => it.level).length;
		});

		return {
			asiTotal,
			asiTaken,
			expertiseTotal,
			expertiseTaken,
			masteryTotal,
			classFeatTotal,
			classFeatTaken,
			masteryTaken,
			cantripsTotal,
			cantripsTaken,
			spellsKnownTotal,
			spellsKnownTaken,
		};
	}

	/**
	 * The Origin feats the species and background grant — by name, and as "one of your choice".
	 * Only their entities know, so they are loaded here rather than guessed from the state.
	 */
	async _pGetOriginFeatGrants () {
		const {refSpecies, refBackground} = this._comp._state;
		const ents = await Promise.all([
			refBackground?.name ? CharacterSheetClassData.pGetBackground(refBackground).catch(() => null) : null,
			refSpecies?.name ? CharacterSheetClassData.pGetSpecies(refSpecies).catch(() => null) : null,
		]);

		const grantedOriginFeats = ents.flatMap(ent => getGrantedFeats(ent?.feats).map(it => ({...it, from: ent.name})));
		const grantedFeatChoices = ents
			.filter(Boolean)
			.map(ent => ({from: ent.name, count: getGrantedFeatCategories(ent.feats).reduce((a, it) => a + it.count, 0)}))
			.filter(it => it.count);

		const level = this._comp.getLevelNumber();
		const openTraitChoices = ents
			.filter(Boolean)
			.flatMap(ent => getTraitChoices(ent)
				.filter(choice => (choice.level || 1) <= level)
				.filter(choice => !this._comp.getTraitChoice(ent.name, choice.trait))
				.map(choice => ({from: ent.name, trait: choice.trait})));

		return {grantedOriginFeats, grantedFeatChoices, openTraitChoices};
	}

	async _pRender () {
		const token = ++this._renderToken;
		const loaded = await CharacterSheetClassData.pGetLoadedClasses(this._comp._state.classes).catch(() => []);
		if (token !== this._renderToken) return;

		const state = this._comp._getState();
		const findings = auditCharacter(state, {
			encumbrance: getEncumbrance(state),
			classInfos: loaded.map(({entry, cls}) => ({
				name: entry.name,
				level: entry.level,
				requirements: cls?.multiclassing?.requirements || null,
			})),
			counts: await this._pGetCounts(loaded),
			...(await this._pGetOriginFeatGrants()),
		});

		this._wrp.innerHTML = "";
		if (!findings.length) {
			this._wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Nothing to flag &mdash; no rule broken, nothing left to choose.</div>`);
			return;
		}

		groupFindings(findings).forEach(grp => {
			const wrpGrp = document.createElement("div");
			wrpGrp.className = "ve-mb-1";

			const hdr = document.createElement("div");
			hdr.className = "cs__lbl";
			hdr.textContent = grp.label;
			wrpGrp.appendChild(hdr);

			grp.items.forEach(finding => {
				const row = document.createElement("div");
				row.className = `cs__audit-row${grp.severity === AUDIT_BROKEN ? " cs__audit-row--broken" : ""}`;
				row.innerHTML = `<span>${finding.message.qq()}</span>`;
				if (finding.hint) row.title = finding.hint;
				wrpGrp.appendChild(row);
			});

			this._wrp.appendChild(wrpGrp);
		});
	}
}
