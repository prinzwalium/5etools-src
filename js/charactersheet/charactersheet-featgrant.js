import {
	CHOICE_TYPE_SKILL,
	CHOICE_TYPE_TOOL,
	CHOICE_TYPE_LANGUAGE,
	getAbilityPackages,
	getChoiceWithoutHeld,
	getExpertiseChoices,
	getFixedAbilityBonuses,
	getHeldProficiencyNames,
	getLanguageChoices,
	getProfListDisplay,
	getSkillChoices,
	getSkillToolLanguageChoices,
	getToolChoices,
	getWeaponChoices,
} from "./charactersheet-choices.js";
import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {getDynamicSpellGrants, getOptionalFeatureCounts, getSpellGrantGroups, isSpellMatchingFilter} from "./charactersheet-levelengine.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getEntityProficiencies, PROF_KIND_LANGUAGE, PROF_KIND_TOOL, PROF_KIND_WEAPON} from "./charactersheet-proficiencies.js";
import {getEntityDefenses} from "./charactersheet-defenses.js";

/**
 * Shared, interactive resolution of a feat's grants — used by the class panel (ASI/feat slots) and
 * the background origin-feat grant. Applies fixed and choice-based skills/Expertise and returns the
 * feat's ability-score bonuses; tool/language grants have no structured store, so they become notes.
 */

/** Sequentially pick `count` distinct items from `from` (strings); returns picks, or null if none chosen. */
export async function pPickList ({count, from, title}) {
	if (!from?.length) return null;
	const out = [];
	for (let i = 0; i < count; ++i) {
		const remaining = from.filter(it => !out.includes(it));
		if (!remaining.length) break;
		const picked = await InputUiUtil.pGetUserEnum({
			values: remaining,
			isResolveItem: true,
			fnDisplay: it => it,
			title: count > 1 ? `${title} (${i + 1} of ${count})` : title,
			placeholder: "Select...",
		});
		if (picked == null) return out.length ? out : null;
		out.push(picked);
	}
	return out;
}

/** Sequentially pick `count` distinct abilities (by abv) from `from`; null on cancel. */
export async function pPickAbilities ({count, from, title}) {
	const out = [];
	for (let i = 0; i < count; ++i) {
		const remaining = from.filter(abv => !out.includes(abv));
		const abv = await InputUiUtil.pGetUserEnum({
			values: remaining,
			isResolveItem: true,
			fnDisplay: it => Parser.attAbvToFull(it),
			title: count > 1 ? `${title} (${i + 1} of ${count})` : title,
			placeholder: "Select an ability...",
		});
		if (abv == null) return null;
		out.push(abv);
	}
	return out;
}

/** Apply a feat's fixed skill/Expertise/tool/language grants. */
export function applyFeatFixedGrants (comp, feat) {
	(feat.skillProficiencies || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_PROFICIENT); });
	});
	(feat.expertise || []).forEach(grp => {
		Object.entries(grp).forEach(([k, v]) => { if (v === true) comp.setSkillProfByName(k, PROF_STATE_EXPERTISE); });
	});

	comp.setProficienciesFromSource(feat.name, getEntityProficiencies(feat));
	comp.setDefensesFromSource(feat.name, getEntityDefenses(feat));
}

/**
 * Whatever a feat's tool and language choices could not be asked for — the shapes this code does
 * not understand — left as a note, so a grant is never silently dropped. Everything `getToolChoices`
 * and `getLanguageChoices` *do* understand is picked properly instead, by `pResolveFeatSkillChoices`.
 */
function _noteUnresolvedProfChoices (comp, feat, resolved) {
	const pts = [];
	if (!resolved.has(CHOICE_TYPE_LANGUAGE)) {
		const langs = getProfListDisplay(feat.languageProficiencies, {isChoiceOnly: true});
		if (langs) pts.push(`Languages: ${langs}`);
	}
	if (!resolved.has(CHOICE_TYPE_TOOL)) {
		const tools = getProfListDisplay(feat.toolProficiencies, {isChoiceOnly: true});
		if (tools) pts.push(`Tools: ${tools}`);
	}
	if (pts.length) comp.appendToTextProp("proficienciesText", `${feat.name}: ${pts.join("; ")}`);
}

/**
 * Interactively resolve everything a feat asks the player to pick: skills, Expertise, tools and
 * languages, plus the few whose choice the book states only in prose.
 *
 * Tools and languages used to be written into a notes box instead of being chosen — Crafter's three
 * artisan's tools and Musician's three instruments are structured data, and both arrived as a line
 * of text that nothing counted. A proficiency as prose is invisible to everything, exactly as an
 * origin feat as prose was.
 *
 * @return {Set<string>} the choice types that were actually offered, so the caller knows what is
 *   left to fall back to a note.
 */
export async function pResolveFeatSkillChoices (comp, feat) {
	const held = getHeldProficiencyNames(comp._getState());
	const resolved = new Set();

	/** One choice, minus what the character already has — the same rule every other chooser follows. */
	const pResolve = async (choice, pApply) => {
		const offered = getChoiceWithoutHeld(choice, held);
		if (!offered) return;
		const picked = await pPickList({
			count: offered.count,
			from: offered.from,
			title: `${feat.name}: ${offered.label.replace(/^Choose /, "choose ")}`,
		});
		(picked || []).forEach(name => {
			held[choice.type]?.add(name);
			pApply(name);
		});
		if (picked?.length) resolved.add(choice.type);
	};

	/**
	 * The mixed pool is subtracted per kind, not per choice type: a pick spendable on a skill *or* a
	 * tool has to lose the skills you have and the tools you have, and each pick then narrows
	 * whichever pool it came from.
	 */
	const pResolveMixed = async choice => {
		const from = choice.from.filter(name => !_getMixedType(choice, name, held).isHeld);
		if (!from.length) return;
		const picked = await pPickList({
			count: Math.min(choice.count, from.length),
			from,
			title: `${feat.name}: ${choice.label.replace(/^Choose /, "choose ")}`,
		});
		(picked || []).forEach(name => {
			const {type} = _getMixedType(choice, name, held);
			held[type]?.add(name);
			if (type === CHOICE_TYPE_SKILL) comp.setSkillProfByName(name, PROF_STATE_PROFICIENT);
			else if (type === CHOICE_TYPE_TOOL) comp.addProficiency({kind: PROF_KIND_TOOL, name, source: feat.name});
			else comp.addProficiency({kind: PROF_KIND_LANGUAGE, name, source: feat.name});
		});
		if (picked?.length) [CHOICE_TYPE_SKILL, CHOICE_TYPE_TOOL, CHOICE_TYPE_LANGUAGE].forEach(t => resolved.add(t));
	};

	for (const choice of getSkillChoices({groups: feat.skillProficiencies, sourceName: feat.name})) {
		await pResolve(choice, name => comp.setSkillProfByName(name, PROF_STATE_PROFICIENT));
	}

	for (const choice of getToolChoices({groups: feat.toolProficiencies, sourceName: feat.name})) {
		await pResolve(choice, name => comp.addProficiency({kind: PROF_KIND_TOOL, name, source: feat.name}));
	}

	for (const choice of getLanguageChoices({groups: feat.languageProficiencies, sourceName: feat.name})) {
		await pResolve(choice, name => comp.addProficiency({kind: PROF_KIND_LANGUAGE, name, source: feat.name}));
	}

	// A saving-throw proficiency of your choice — Resilient, and nothing else in the books. Its own
	// field, unread until now, so taking Resilient did nothing at all to the sheet
	for (const grp of (feat.savingThrowProficiencies || [])) {
		const from = [grp?.choose?.from].flat().filter(Boolean)
			.filter(abv => !comp._state[`save_${abv}`]);
		if (!from.length) continue;
		const picked = await pPickAbilities({
			count: grp.choose.count || 1,
			from,
			title: `${feat.name}: proficiency in which saving throw?`,
		});
		(picked || []).forEach(abv => comp.setSaveProficiency(abv, true));
	}

	// "Any combination of three skills or tools" — one pool, spendable either way
	const toolNames = await CharacterSheetClassData.pGetToolProficiencyNames();
	for (const choice of getSkillToolLanguageChoices({groups: feat.skillToolLanguageProficiencies, sourceName: feat.name, toolNames})) {
		await pResolveMixed(choice);
	}

	const proficientNames = CHAR_SHEET_SKILLS
		.filter(({key}) => (Number(comp._state[`skill_${key}`]) || 0) >= PROF_STATE_PROFICIENT)
		.map(({name}) => name);
	for (const choice of getExpertiseChoices({groups: feat.expertise, sourceName: feat.name, proficientSkillNames: proficientNames})) {
		const picked = await pPickList({count: choice.count, from: choice.from, title: `${feat.name}: choose Expertise skill${choice.count > 1 ? "s" : ""}`});
		(picked || []).forEach(name => comp.setSkillProfByName(name, PROF_STATE_EXPERTISE));
	}

	return resolved;
}

/**
 * Which kind a name in a mixed pool belongs to, and whether the character already has it.
 *
 * The pools come from the choice itself, so a name is classified by the data that offered it rather
 * than by guessing from its spelling.
 */
function _getMixedType (choice, name, held) {
	const type = [CHOICE_TYPE_SKILL, CHOICE_TYPE_TOOL, CHOICE_TYPE_LANGUAGE]
		.find(t => (choice.pools?.[t] || []).includes(name)) || CHOICE_TYPE_TOOL;
	return {type, isHeld: !!held[type]?.has(name)};
}

/** Resolve a feat's ability increases (fixed + a single choose group); returns bonuses, or null if cancelled. */
export async function pResolveFeatAbility (comp, feat) {
	const bonuses = {...getFixedAbilityBonuses(feat.ability)};
	const packages = getAbilityPackages(feat.ability);
	if (packages.length === 1 && packages[0].choose) {
		const {from, count, amount} = packages[0].choose;
		const picked = await pPickAbilities({count, from: from.length ? from : CHAR_SHEET_ABILITIES.map(([abv]) => abv), title: `${feat.name}: increase which ability?`});
		if (!picked) return null;
		picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + amount);
	}
	return bonuses;
}

/**
 * Resolve the spells an entity grants through `additionalSpells` — feats (Magic Initiate, Artificer
 * Initiate, ...) and species (an Elf's lineage cantrips, a Tiefling's legacy) share the shape, so
 * they share this resolver. An entity with several alternative groups offers them as a choice
 * ("Bard Spells" vs "Cleric Spells"; Drow vs High Elf vs Wood Elf): the player picks one group,
 * then picks the spells within it.
 */
export async function pResolveEntitySpellGrants (comp, feat, {grantKeyPrefix}) {
	if (!feat.additionalSpells?.length) return;

	// Pick which alternative group applies, when the entity offers a choice of spell lists
	let groupIndex = 0;
	const groups = getSpellGrantGroups(feat);
	if (groups.length) {
		const picked = await InputUiUtil.pGetUserEnum({
			values: groups,
			isResolveItem: true,
			fnDisplay: g => g.name,
			title: `${feat.name}: which spell list?`,
			placeholder: "Select...",
		});
		if (picked == null) return;
		groupIndex = picked.index;
	}

	const grants = getDynamicSpellGrants(feat, 20)
		.filter(g => g.type === "choose" && g.groupIndex === groupIndex);
	if (!grants.length) return;

	const allSpells = await CharacterSheetClassData.pGetAllSpells().catch(() => []);
	const byKey = new Map();
	const byName = new Map();
	allSpells.forEach(sp => {
		byKey.set(`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp);
		if (!byName.has(sp.name.toLowerCase())) byName.set(sp.name.toLowerCase(), sp);
	});
	const withClasses = sp => {
		if (!sp._csClassNames) {
			sp._csClassNames = [
				...Renderer.spell.getCombinedClasses(sp, "fromClassList"),
				...Renderer.spell.getCombinedClasses(sp, "fromClassListVariant"),
			].map(c => c.name).filter(Boolean);
		}
		return sp;
	};

	for (const grant of grants) {
		const pool = grant.from?.length
			? grant.from.map(uid => {
				const [name, source] = uid.split("|");
				return byKey.get(`${name}|${(source || "phb").toLowerCase()}`) || byName.get(name);
			}).filter(Boolean)
			: allSpells.filter(sp => isSpellMatchingFilter(withClasses(sp), grant.filter));
		if (!pool.length) continue;

		const grantKey = `${grantKeyPrefix}:${grant.id}`;
		// Exclude by name, not name+source: the same spell reprinted in two books is still one spell.
		const taken = new Set();
		for (let i = 0; i < grant.count; ++i) {
			const remaining = pool.filter(sp => !taken.has(sp.name.toLowerCase()));
			if (!remaining.length) break;
			const picked = await InputUiUtil.pGetUserEnum({
				values: remaining.sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name)),
				isResolveItem: true,
				fnDisplay: sp => `${sp.name} (${sp.level === 0 ? "cantrip" : Parser.spLevelToFull(sp.level)}, ${Parser.sourceJsonToAbv(sp.source)})`,
				title: grant.count > 1 ? `${feat.name}: choose a spell (${i + 1} of ${grant.count})` : `${feat.name}: choose a spell`,
				placeholder: "Select a spell...",
			});
			if (picked == null) break;
			taken.add(picked.name.toLowerCase());
			comp.addGrantedSpellChoice({grantKey, name: picked.name, source: picked.source, level: picked.level});
		}
	}
}

/**
 * The weapons a feat asks the player to be proficient with.
 *
 * Weapon Master, and only Weapon Master: "choose four weapons you become proficient with", written
 * as a `fromFilter` the choice engine could not read, so the four picks were dropped and the feat
 * granted nothing at all. Offered as base weapon *types* — proficiency is with the kind of weapon,
 * not with a particular one you happen to be carrying.
 */
export async function pResolveFeatWeaponChoices (comp, feat) {
	const choices = getWeaponChoices({groups: feat.weaponProficiencies, sourceName: feat.name});
	if (!choices.length) return;

	for (const choice of choices) {
		const held = new Set((comp._state.proficiencies || [])
			.filter(it => it.kind === PROF_KIND_WEAPON)
			.map(it => String(it.name).toLowerCase()));

		for (let i = 0; i < choice.count; ++i) {
			const pool = (await CharacterSheetClassData.pGetBaseWeapons({categories: choice.categories}))
				.filter(it => !held.has(it.name.toLowerCase()));
			if (!pool.length) break;

			const picked = await InputUiUtil.pGetUserEnum({
				values: pool,
				isResolveItem: true,
				fnDisplay: it => `${it.name} (${it.weaponCategory})`,
				title: `${feat.name}: weapon ${i + 1} of ${choice.count}`,
				placeholder: "Select a weapon...",
			});
			if (picked == null) break;
			comp.addProficiency({kind: PROF_KIND_WEAPON, name: picked.name, source: feat.name});
			held.add(picked.name.toLowerCase());
		}
	}
}

/**
 * The optional features a feat grants — Martial Adept's two Manoeuvres, Metamagic Adept's two
 * Metamagic options, Eldritch Adept's Invocation, Fighting Initiate's Fighting Style.
 *
 * Nothing read `optionalfeatureProgression` on a feat, so all four recorded a name and granted
 * nothing at all. They are stored against a *class entry*, because that is where the model keeps
 * optional features and where the class panel lists them; the progression's own name ("Maneuvers",
 * "Metamagic") is what tells a feat's from the class's own.
 *
 * @param [opts.entryId] which class entry to hang them on; the first class by default.
 */
export async function pResolveFeatOptionalFeatures (comp, feat, {entryId = null} = {}) {
	const progs = getOptionalFeatureCounts(feat).filter(it => it.featureTypes.length);
	if (!progs.length) return;

	const target = entryId || (comp._state.classes || [])[0]?.id;
	if (!target) {
		comp.appendToTextProp("proficienciesText", `${feat.name}: ${progs.map(it => `${it.count} ${it.name}`).join(", ")} — add a class to choose them.`);
		return;
	}

	for (const prog of progs) {
		for (let i = 0; i < prog.count; ++i) {
			const held = (comp._state.classes || []).find(it => it.id === target)?.optionalFeatures || [];
			const pool = (await CharacterSheetClassData.pGetOptionalFeaturesByTypes(prog.featureTypes))
				.filter(it => !held.some(ch => ch.name === it.name && ch.source === it.source));
			if (!pool.length) break;

			const picked = await InputUiUtil.pGetUserEnum({
				values: pool,
				isResolveItem: true,
				fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
				title: prog.count > 1 ? `${feat.name}: ${prog.name} (${i + 1} of ${prog.count})` : `${feat.name}: ${prog.name}`,
				placeholder: "Select...",
			});
			if (picked == null) break;
			comp.addOptionalFeatureForClass(target, {name: picked.name, source: picked.source, progressionName: prog.name});
		}
	}
}

/**
 * Fully resolve a feat: ability increases (interactive), fixed grants, skill/Expertise choices, the
 * optional features it grants, and any spells.
 * @return the feat's ability bonuses `{abv: n}`, or null if the player cancelled.
 */
export async function pResolveFeat (comp, feat, {grantKeyPrefix = null, entryId = null} = {}) {
	const bonuses = await pResolveFeatAbility(comp, feat);
	if (bonuses == null) return null;
	applyFeatFixedGrants(comp, feat);
	const resolved = await pResolveFeatSkillChoices(comp, feat);
	_noteUnresolvedProfChoices(comp, feat, resolved);
	await pResolveFeatWeaponChoices(comp, feat);
	await pResolveFeatOptionalFeatures(comp, feat, {entryId});
	await pResolveEntitySpellGrants(comp, feat, {grantKeyPrefix: grantKeyPrefix || `feat:${feat.name}|${feat.source}`});
	return bonuses;
}
