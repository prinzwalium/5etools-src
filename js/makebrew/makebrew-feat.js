import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";

/**
 * A builder for feats.
 *
 * Upstream's homebrew builder covers creatures, spells and legendary groups, and nothing else; a
 * feat is the shallowest of the things it does not cover, which is why it is first. Everything a
 * feat says is a small number of well-defined fields — an ability increase, some proficiencies, a
 * prerequisite — so the whole point is that a table writes those as *fields* rather than as prose.
 * A proficiency written into the entries is invisible to the character builder; the same
 * proficiency written into `skillProficiencies` ticks a box on a sheet.
 *
 * The fields here are the ones the books actually use (a survey of `data/feats.json`), and the
 * state is the feat itself, exactly as it will be saved — so what the Data tab shows is what the
 * brew holds.
 */

const _SKILLS = Object.keys(Parser.SKILL_TO_ATB_ABV);

/** The categories the books use. Every one is offered; a homebrew feat is usually Origin or General. */
const _CATEGORIES = Object.keys(Parser.FEAT_CATEGORY_TO_FULL);

export class FeatBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "feat",
			pFnGetFluff: Renderer.feat.pGetFluff.bind(Renderer.feat),
		});

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	async pHandleClickLoadExisting () {
		const result = await SearchWidget.pGetUserFeatSearch();
		if (!result) return;
		const feat = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(feat);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Feat",
			category: "G",
			// The shape every feat in the books has: a lead-in and a list. The renderer folds an
			// ability increase into that list, and warns when there is nowhere to fold it into, so
			// starting without one makes the first ability increase look like a bug
			entries: [
				"You gain the following benefits:",
				{type: "list", items: []},
			],
			source: this._ui ? this._ui.source : "",
		};
	}

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, benefitsTab, textTab] = this._renderForkInputTabs({wrp, names: ["Info", "Benefits", "Text"]});

		// ---------- INFO ----------
		BuilderUi.getStateIptString("Name", cb, this._state, {nullable: false}, "name").vee.appendTo(infoTab.wrpTab);
		this._selSource = this.getSourceInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString("Page", cb, this._state, {type: "number"}, "page").vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptEnum(
			"Category",
			cb,
			this._state,
			{vals: _CATEGORIES, fnDisplay: it => Parser.featCategoryToFull(it), nullable: true},
			"category",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptBoolean(
			"Repeatable",
			cb,
			this._state,
			{title: "Whether this feat may be taken more than once."},
			"repeatable",
		).vee.appendTo(infoTab.wrpTab);

		this._getPrerequisiteInput(cb).vee.appendTo(infoTab.wrpTab);

		// ---------- BENEFITS ----------
		this._getAbilityInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getSkillProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getSavingThrowProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getAnyProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getDefencesInput(cb).vee.appendTo(benefitsTab.wrpTab);

		// ---------- TEXT ----------
		BuilderUi.getStateIptEntries(
			"Text",
			cb,
			this._state,
			{nullable: false, placeholder: "What the feat does. Anything expressed as a field above does not need repeating here — but the books do repeat it, and so may you."},
			"entries",
		).vee.appendTo(textTab.wrpTab);
	}

	/* -------------------------------------------- */

	/**
	 * The books state up to four alternatives, any one of which qualifies; sixteen feats do. This
	 * offers the first, which is what a homebrew feat has, and leaves the rest untouched when one
	 * was loaded as a template — so a copy of a two-alternative feat does not silently lose one.
	 */
	_getPrerequisiteInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Prerequisite", {isMarked: true});

		const existing = (this._state.prerequisite || [])[0] || {};
		const rest = (this._state.prerequisite || []).slice(1);

		const doUpdate = () => {
			const out = {};

			const level = this.constructor._getIptNum(iptLevel);
			if (level != null) out.level = level;

			const abilityMins = {};
			iptsAbility.forEach(({abv, ipt}) => {
				const val = this.constructor._getIptNum(ipt);
				if (val != null) abilityMins[abv] = val;
			});
			if (Object.keys(abilityMins).length) out.ability = [abilityMins];

			if (cbSpellcasting.vee.prop("checked")) out.spellcasting = true;

			const features = getFeatures();
			if (features.length) out.feature = features;

			const other = `${iptOther.vee.val() ?? ""}`.trim();
			if (other) out.other = other;

			// Keys this UI does not offer, kept so a template's prerequisite survives a round trip
			Object.entries(existing)
				.filter(([k]) => !["level", "ability", "spellcasting", "feature", "other"].includes(k))
				.forEach(([k, v]) => out[k] = v);

			const nxt = [...(Object.keys(out).length ? [out] : []), ...rest];
			this._setOrDelete("prerequisite", nxt.length ? nxt : null);
			cb();
		};

		const iptLevel = this.constructor._getNumberIpt({initial: existing.level, placeholder: "Level", onChange: doUpdate});
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Level</span>${iptLevel}</div>`.vee.appendTo(rowInner);

		const existingAbility = (existing.ability || [])[0] || {};
		const wrpAbility = veT`<div class="ve-flex-v-center ve-flex-wrap ve-mb-2"></div>`.vee.appendTo(rowInner);
		veT`<span class="ve-mr-2 ve-w-100p">Score</span>`.vee.appendTo(wrpAbility);
		const iptsAbility = Parser.ABIL_ABVS.map(abv => {
			const ipt = this.constructor._getNumberIpt({initial: existingAbility[abv], placeholder: abv.toUpperCase(), onChange: doUpdate});
			veT`<div class="ve-flex-v-center ve-mr-2 ve-w-70p">${ipt}</div>`.vee.appendTo(wrpAbility);
			return {abv, ipt};
		});

		const cbSpellcasting = veT`<input class="mkbru__ipt-cb" type="checkbox">`
			.vee.prop("checked", !!existing.spellcasting)
			.vee.onn("change", () => doUpdate());
		veT`<label class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Spellcasting</span>${cbSpellcasting}</label>`.vee.appendTo(rowInner);

		// A class feature by name — "Fighting Style", "Pact Magic"
		const wrpFeatures = veT`<div class="ve-mb-2"></div>`.vee.appendTo(rowInner);
		const featureRows = [];
		const getFeatures = () => featureRows.map(it => `${it.ipt.vee.val() ?? ""}`.trim()).filter(Boolean);
		const addFeatureRow = initial => {
			const ipt = veT`<input class="ve-form-control ve-input-xs form-control--minimal ve-mr-2" placeholder="A feature by name, e.g. Fighting Style">`
				.vee.val(initial || null)
				.vee.onn("change", () => doUpdate());
			const btnRemove = veT`<button class="ve-btn ve-btn-xs ve-btn-danger" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>`
				.vee.onn("click", () => {
					featureRows.splice(featureRows.indexOf(out), 1);
					wrpRow.vee.empty().remove();
					doUpdate();
				});
			const wrpRow = veT`<div class="ve-flex-v-center ve-mb-2">${ipt}${btnRemove}</div>`.vee.appendTo(wrpFeatures);
			const out = {ipt};
			featureRows.push(out);
		};
		(existing.feature || []).forEach(it => addFeatureRow(it));
		veT`<button class="ve-btn ve-btn-xs ve-btn-default ve-mb-2">Add Feature</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { addFeatureRow(); doUpdate(); });

		const iptOther = veT`<input class="ve-form-control ve-input-xs form-control--minimal" placeholder="Anything the fields above cannot say">`
			.vee.val(existing.other || null)
			.vee.onn("change", () => doUpdate());
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-100p">Other</span>${iptOther}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * `[{"con": 1}]` — a fixed increase — or `[{"choose": {"from": [...], "amount": 1}}]`. The
	 * character builder resolves the second as a question, so which of the two is used matters.
	 */
	_getAbilityInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Ability Score Increase", {isMarked: true});

		const existing = this._getFirstEntry("ability") || {};
		// A new feat defaults to a choice, which is what the 2024 books state almost everywhere
		const isChoose = !!existing.choose || !Object.keys(existing).length;
		const initialAbvs = isChoose
			? (existing.choose?.from || [])
			: Object.keys(existing).filter(it => Parser.ABIL_ABVS.includes(it));
		const initialAmount = isChoose
			? (existing.choose?.amount ?? 1)
			: (initialAbvs.length ? existing[initialAbvs[0]] : 1);

		const doUpdate = () => {
			const abvs = getAbvs();
			const amount = this.constructor._getIptNum(iptAmount) ?? 1;

			if (!abvs.length) this._setOrDelete("ability", null);
			else if (selMode.vee.val() === "choose") this._setOrDelete("ability", [{choose: {from: abvs, amount}}]);
			else this._setOrDelete("ability", [abvs.mergeMap(abv => ({[abv]: amount}))]);

			cb();
		};

		const selMode = veT`<select class="ve-form-control ve-input-xs form-control--minimal ve-mb-2">
			<option value="choose">Choose one of the ticked</option>
			<option value="fixed">Increase every ticked</option>
		</select>`
			.vee.val(isChoose ? "choose" : "fixed")
			.vee.onn("change", () => doUpdate())
			.vee.appendTo(rowInner);

		const iptAmount = this.constructor._getNumberIpt({initial: initialAmount, placeholder: "By how much", onChange: doUpdate});
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2">By</span>${iptAmount}</div>`.vee.appendTo(rowInner);

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getAbvs = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.ABIL_ABVS,
			fnDisplay: it => Parser.attAbvToFull(it),
			initial: initialAbvs,
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * Ticking skills grants them; asking for fewer than were ticked makes it a choice. That is the
	 * same distinction the data draws between `{"perception": true}` and `{"choose": {...}}`, and
	 * it is the one a homebrew feat most often gets wrong by writing prose instead.
	 */
	_getSkillProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Skill Proficiencies", {isMarked: true});

		const existing = this._getFirstEntry("skillProficiencies") || {};
		const isChoose = !!existing.choose;
		const initialSkills = isChoose ? (existing.choose.from || []) : Object.keys(existing).filter(it => _SKILLS.includes(it));
		const initialCount = isChoose ? (existing.choose.count ?? 1) : null;

		const doUpdate = () => {
			const skills = getSkills();
			const count = this.constructor._getIptNum(iptCount);

			if (!skills.length) this._setOrDelete("skillProficiencies", null);
			else if (count != null && count > 0 && count < skills.length) this._setOrDelete("skillProficiencies", [{choose: {from: skills, count}}]);
			else this._setOrDelete("skillProficiencies", [skills.mergeMap(it => ({[it]: true}))]);

			cb();
		};

		const iptCount = this.constructor._getNumberIpt({initial: initialCount, placeholder: "All of them", onChange: doUpdate});
		veT`<div class="ve-flex-v-center ve-mb-2" title="Leave empty to grant every ticked skill; set a number to make it a choice of that many.">
			<span class="ve-mr-2">Choose</span>${iptCount}
		</div>`.vee.appendTo(rowInner);

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getSkills = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: _SKILLS,
			fnDisplay: it => it.toTitleCase(),
			initial: initialSkills,
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/** Resilient's shape, and only Resilient's: a choice of one saving throw from a named set. */
	_getSavingThrowProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Saving Throw Proficiency", {isMarked: true, title: "A choice of one saving throw from those ticked."});

		const existing = this._getFirstEntry("savingThrowProficiencies") || {};
		const initialAbvs = existing.choose?.from || Object.keys(existing).filter(it => Parser.ABIL_ABVS.includes(it));

		const doUpdate = () => {
			const abvs = getAbvs();
			this._setOrDelete("savingThrowProficiencies", abvs.length ? [{choose: {from: abvs}}] : null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getAbvs = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.ABIL_ABVS,
			fnDisplay: it => Parser.attAbvToFull(it),
			initial: initialAbvs,
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * "A tool of your choice", "a language of your choice", "expertise in a skill you are already
	 * proficient in" — the counts that name a *pool* rather than a list. A number, because that is
	 * all the data holds.
	 */
	_getAnyProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Choices from a Pool", {isMarked: true});

		const specs = [
			{label: "Tools (any)", prop: "toolProficiencies", key: "anyArtisansTool"},
			{label: "Languages (any)", prop: "languageProficiencies", key: "any"},
			{label: "Expertise (a skill you already have)", prop: "expertise", key: "anyProficientSkill"},
		];

		const ipts = [];
		const doUpdate = () => {
			ipts.forEach(({spec, ipt}) => {
				const val = this.constructor._getIptNum(ipt);
				this._setOrDelete(spec.prop, val != null && val > 0 ? [{[spec.key]: val}] : null);
			});
			cb();
		};

		specs.forEach(spec => {
			const existing = this._getFirstEntry(spec.prop) || {};
			const ipt = this.constructor._getNumberIpt({initial: existing[spec.key], placeholder: "How many", onChange: doUpdate});
			veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">${spec.label}</span>${ipt}</div>`.vee.appendTo(rowInner);
			ipts.push({spec, ipt});
		});

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * Resistances and immunities, read structurally by the sheet's defenses panel — which is the
	 * whole reason to tick them here rather than say so in the text.
	 */
	_getDefencesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Resistances & Immunities", {isMarked: true});

		const specs = [
			{label: "Resistance", prop: "resist", vals: Parser.DMG_TYPES},
			{label: "Immunity", prop: "immune", vals: Parser.DMG_TYPES},
			{label: "Condition Immunity", prop: "conditionImmune", vals: Parser.CONDITIONS},
		];

		const getters = [];
		const doUpdate = () => {
			getters.forEach(({spec, getVals}) => {
				const vals = getVals();
				this._setOrDelete(spec.prop, vals.length ? vals : null);
			});
			cb();
		};

		specs.forEach(spec => {
			// The books also state these as a choice; that shape is left to the Data tab
			const initial = (this._state[spec.prop] || []).filter(it => typeof it === "string");
			veT`<div class="ve-bold ve-mb-1">${spec.label}</div>`.vee.appendTo(rowInner);
			const wrpCbs = veT`<div class="ve-flex-col ve-w-100 ve-mb-2"></div>`.vee.appendTo(rowInner);
			getters.push({
				spec,
				getVals: this.constructor._getCheckboxes({
					wrp: wrpCbs,
					vals: spec.vals,
					fnDisplay: it => it.toTitleCase(),
					initial,
					onChange: doUpdate,
				}),
			});
		});

		return row;
	}

	/* -------------------------------------------- */

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		this._renderForkOutput({
			name: "Feat",
			fnRender: cpy => {
				// The renderer folds an ability increase into a list, and complains loudly when a
				// feat has nowhere to put one. A feat mid-authoring often does; that is not
				// something to shout at the person authoring it, so the *preview* gets somewhere to
				// put it. What is saved is untouched
				if (cpy.ability?.length && !(cpy.entries || []).some(ent => ent?.type === "list")) {
					cpy.entries = [...(cpy.entries || []), {type: "list", items: []}];
				}
				return Renderer.feat.getCompactRenderedString(cpy);
			},
		});
	}
}
