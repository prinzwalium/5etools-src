import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "../consts.js";

/**
 * A builder for species.
 *
 * The largest of the shallow kinds, because a species says more about a character than anything
 * else at level one: how fast it moves and in how many ways, how far it sees in the dark, what it
 * resists, how big it is. All of that is read structurally — by the sheet's movement line, its
 * defenses panel, its carrying capacity — so all of it is a field here.
 *
 * Two shapes are worth knowing about, because both cost the character sheet real bugs before they
 * were read properly. **Speed** is a number *or* an object, and a kind given as `true` means "equal
 * to your walking speed" — reading only `walk` cost thirty-two species the movement that defines
 * them. And **size** can be a question: thirty species offer Small *or* Medium, which decides
 * carrying capacity, grappling and squeezing, so it is a list rather than a value.
 *
 * Subspecies are not built here. The race loader merges them into their parent before anything sees
 * them, so what a homebrew author writes is a whole species — the merge has no seam to hook into.
 */

const _SKILLS = Object.keys(Parser.SKILL_TO_ATB_ABV);

/** The sizes a playable species uses. The rest of `SIZE_ABVS` is for monsters. */
const _SIZES = [Parser.SZ_SMALL, Parser.SZ_MEDIUM, Parser.SZ_LARGE];

/** Every kind of movement the data uses, walking first because the others may defer to it. */
const _SPEED_KINDS = ["walk", "fly", "swim", "climb", "burrow"];

export class SpeciesBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "race",
			pFnGetFluff: Renderer.race.pGetFluff.bind(Renderer.race),
		});

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	async pHandleClickLoadExisting () {
		const result = await SearchWidget.pGetUserRaceSearch();
		if (!result) return;
		const race = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(race);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Species",
			edition: SITE_STYLE__ONE,
			size: [Parser.SZ_MEDIUM],
			speed: 30,
			entries: [],
			source: this._ui ? this._ui.source : "",
		};
	}

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, bodyTab, traitsTab, textTab] = this._renderForkInputTabs({wrp, names: ["Info", "Body", "Traits", "Text"]});

		// ---------- INFO ----------
		BuilderUi.getStateIptString("Name", cb, this._state, {nullable: false}, "name").vee.appendTo(infoTab.wrpTab);
		this._selSource = this.getSourceInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString("Page", cb, this._state, {type: "number"}, "page").vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptEnum(
			"Edition",
			cb,
			this._state,
			{
				vals: [SITE_STYLE__ONE, SITE_STYLE__CLASSIC],
				fnDisplay: it => it === SITE_STYLE__ONE ? "2024" : "2014",
				nullable: false,
				title: "A 2014 species raises ability scores; a 2024 one leaves that to the background.",
			},
			"edition",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptStringArray(
			"Trait Tags",
			cb,
			this._state,
			{
				shortName: "Tag",
				title: "The data's own shorthand for what a species can do — \"Natural Weapon\", \"Sunlight Sensitivity\", \"Amphibious\". The sheet shows these beside the species.",
			},
			"traitTags",
		).vee.appendTo(infoTab.wrpTab);

		// ---------- BODY ----------
		this._getSizeInput(cb).vee.appendTo(bodyTab.wrpTab);
		this._getCreatureTypeInput(cb).vee.appendTo(bodyTab.wrpTab);
		this._getSpeedInput(cb).vee.appendTo(bodyTab.wrpTab);
		this._getSensesInput(cb).vee.appendTo(bodyTab.wrpTab);
		this._getAgeInput(cb).vee.appendTo(bodyTab.wrpTab);
		this._getHeightAndWeightInput(cb).vee.appendTo(bodyTab.wrpTab);

		// ---------- TRAITS ----------
		this._getAbilityInput(cb).vee.appendTo(traitsTab.wrpTab);
		this._getSkillProficiencyInput(cb).vee.appendTo(traitsTab.wrpTab);
		this._getLanguageProficiencyInput(cb).vee.appendTo(traitsTab.wrpTab);
		this._getDefencesInput(cb).vee.appendTo(traitsTab.wrpTab);

		// ---------- TEXT ----------
		BuilderUi.getStateIptEntries(
			"Traits",
			cb,
			this._state,
			{
				placeholder: `Each named trait as its own entry — {"name": "Keen Senses", "entries": ["..."]}. What is stated as a field above needs no entry; the books restate it anyway.`,
			},
			"entries",
		).vee.appendTo(textTab.wrpTab);
	}

	/* -------------------------------------------- */

	/**
	 * A list, not a value. Ticking two makes the size a question the character answers, which is how
	 * the thirty "Small or Medium" species work.
	 */
	_getSizeInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Size",
			{isMarked: true, title: "Tick more than one to let the player choose. Size decides carrying capacity, grappling and squeezing."},
		);

		const doUpdate = () => {
			const sizes = getSizes();
			this._setOrDelete("size", sizes.length ? sizes : null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getSizes = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: _SIZES,
			fnDisplay: it => Parser.sizeAbvToFull(it),
			initial: this._state.size || [],
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/** "Humanoid (Goblinoid)" is two fields: the type, and a tag that qualifies it. */
	_getCreatureTypeInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Creature Type",
			{isMarked: true, title: "What this species *is*, which decides what can target it — a Plasmoid is an Ooze."},
		);

		const doUpdate = () => {
			const types = getTypes();
			this._setOrDelete("creatureTypes", types.length ? types : null);

			const tags = listTags.getValues().map(it => it.toLowerCase());
			this._setOrDelete("creatureTypeTags", tags.length ? tags : null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100 ve-mb-2"></div>`.vee.appendTo(rowInner);
		const getTypes = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.MON_TYPES,
			fnDisplay: it => it.toTitleCase(),
			initial: this._state.creatureTypes || [],
			onChange: doUpdate,
		});

		veT`<div class="ve-bold ve-mb-1">Tags</div>`.vee.appendTo(rowInner);
		const listTags = this.constructor._getRowList({
			wrp: rowInner,
			initial: this._state.creatureTypeTags || [],
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const ipt = this.constructor._getTextIpt({initial, placeholder: "e.g. goblinoid, elf", onChange});
				return {ele: ipt, getValue: () => this.constructor._getIptStr(ipt)};
			},
		});
		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Tag</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { listTags.add(); doUpdate(); });

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * Walking, plus whatever else this species does. A kind can be a number or "the same as your
	 * walking speed", and the second is how the books state most flying and swimming — so it is a
	 * tickbox rather than a number the author has to keep in sync.
	 */
	_getSpeedInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Speed", {isMarked: true});

		const existing = typeof this._state.speed === "number"
			? {walk: this._state.speed}
			: (this._state.speed || {});

		const ipts = [];
		const doUpdate = () => {
			const out = {};
			ipts.forEach(({kind, ipt, cbSame}) => {
				if (cbSame && cbSame.vee.prop("checked")) return void (out[kind] = true);
				const val = this.constructor._getIptNum(ipt);
				if (val != null && val > 0) out[kind] = val;
			});

			const kinds = Object.keys(out);
			if (!kinds.length) this._setOrDelete("speed", null);
			// A species that only walks states a bare number, as 123 of them do
			else if (kinds.length === 1 && kinds[0] === "walk" && typeof out.walk === "number") this._setOrDelete("speed", out.walk);
			else this._setOrDelete("speed", out);

			ipts.forEach(({ipt, cbSame}) => { if (cbSame) ipt.vee.prop("disabled", !!cbSame.vee.prop("checked")); });
			cb();
		};

		_SPEED_KINDS.forEach(kind => {
			const val = existing[kind];
			const ipt = this.constructor._getNumberIpt({
				initial: typeof val === "number" ? val : null,
				placeholder: "Feet",
				onChange: doUpdate,
			});

			// Walking is what the others defer to, so it cannot itself defer
			const cbSame = kind === "walk"
				? null
				: veT`<input class="mkbru__ipt-cb ve-mr-1" type="checkbox">`
					.vee.prop("checked", val === true)
					.vee.onn("change", () => doUpdate());

			veT`<div class="ve-flex-v-center ve-mb-2">
				<span class="ve-mr-2 ve-w-70p">${kind.toTitleCase()}</span>
				${ipt}
				${cbSame ? veT`<label class="ve-flex-v-center ve-mb-0 ve-no-wrap" title="As fast as this species walks, whatever that is.">${cbSame}<span class="ve-muted">same as walking</span></label>` : ""}
			</div>`.vee.appendTo(rowInner);

			ipts.push({kind, ipt, cbSame});
		});

		doUpdate();

		return row;
	}

	/* -------------------------------------------- */

	_getSensesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Senses", {isMarked: true});

		const specs = [
			{label: "Darkvision", prop: "darkvision"},
			{label: "Blindsight", prop: "blindsight"},
		];

		const ipts = [];
		const doUpdate = () => {
			ipts.forEach(({spec, ipt}) => {
				const val = this.constructor._getIptNum(ipt);
				this._setOrDelete(spec.prop, val != null && val > 0 ? val : null);
			});
			cb();
		};

		specs.forEach(spec => {
			const ipt = this.constructor._getNumberIpt({initial: this._state[spec.prop], placeholder: "Feet", onChange: doUpdate});
			veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">${spec.label}</span>${ipt}</div>`.vee.appendTo(rowInner);
			ipts.push({spec, ipt});
		});

		return row;
	}

	/* -------------------------------------------- */

	_getAgeInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Age",
			{isMarked: true, title: "When this species reaches maturity, and how long it lives."},
		);

		const existing = this._state.age || {};

		const doUpdate = () => {
			const mature = this.constructor._getIptNum(iptMature);
			const max = this.constructor._getIptNum(iptMax);
			const out = {};
			if (mature != null) out.mature = mature;
			if (max != null) out.max = max;
			this._setOrDelete("age", Object.keys(out).length ? out : null);
			cb();
		};

		const iptMature = this.constructor._getNumberIpt({initial: existing.mature, placeholder: "Years", onChange: doUpdate});
		const iptMax = this.constructor._getNumberIpt({initial: existing.max, placeholder: "Years", onChange: doUpdate});
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Mature at</span>${iptMature}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-100p">Lives to</span>${iptMax}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/** What the sheet's *Roll* button rolls against. Heights are inches and weights pounds. */
	_getHeightAndWeightInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Height & Weight",
			{isMarked: true, title: "The random-build table. Height is in inches, weight in pounds; the modifiers are dice, e.g. 2d10."},
		);

		const existing = this._state.heightAndWeight || {};

		const doUpdate = () => {
			const out = {};
			const baseHeight = this.constructor._getIptNum(iptBaseHeight);
			const baseWeight = this.constructor._getIptNum(iptBaseWeight);
			const heightMod = this.constructor._getIptStr(iptHeightMod);
			const weightMod = this.constructor._getIptStr(iptWeightMod);
			if (baseHeight != null) out.baseHeight = baseHeight;
			if (heightMod) out.heightMod = heightMod;
			if (baseWeight != null) out.baseWeight = baseWeight;
			if (weightMod) out.weightMod = weightMod;

			// All four or none: the sheet rolls base + mod, and half a table rolls nonsense
			this._setOrDelete("heightAndWeight", Object.keys(out).length === 4 ? out : null);
			dispStatus.vee.html(!Object.keys(out).length || Object.keys(out).length === 4
				? ""
				: "All four are needed before the sheet can roll a height and weight.");
			cb();
		};

		const dispStatus = veT`<div class="ve-muted ve-italic ve-mb-2"></div>`.vee.appendTo(rowInner);

		const iptBaseHeight = this.constructor._getNumberIpt({initial: existing.baseHeight, placeholder: "Inches", onChange: doUpdate});
		const iptHeightMod = this.constructor._getTextIpt({initial: existing.heightMod, placeholder: "e.g. 2d10", onChange: doUpdate});
		const iptBaseWeight = this.constructor._getNumberIpt({initial: existing.baseWeight, placeholder: "Pounds", onChange: doUpdate});
		const iptWeightMod = this.constructor._getTextIpt({initial: existing.weightMod, placeholder: "e.g. 2d4", onChange: doUpdate});

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Base height</span>${iptBaseHeight}${iptHeightMod}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-100p">Base weight</span>${iptBaseWeight}${iptWeightMod}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/** The 2014 shape: fixed increases. A 2024 species raises nothing; its background does. */
	_getAbilityInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Ability Score Increases",
			{isMarked: true, title: "2014 only. The 2024 rules moved ability scores onto the background, so leave these empty for a modern species."},
		);

		const existing = this._getFirstEntry("ability") || {};

		const ipts = [];
		const doUpdate = () => {
			const out = {};
			ipts.forEach(({abv, ipt}) => {
				const val = this.constructor._getIptNum(ipt);
				if (val != null && val !== 0) out[abv] = val;
			});
			this._setOrDelete("ability", Object.keys(out).length ? [out] : null);
			cb();
		};

		const wrpIpts = veT`<div class="ve-flex-v-center ve-flex-wrap"></div>`.vee.appendTo(rowInner);
		Parser.ABIL_ABVS.forEach(abv => {
			const ipt = this.constructor._getNumberIpt({initial: existing[abv], placeholder: abv.toUpperCase(), onChange: doUpdate});
			veT`<div class="ve-flex-v-center ve-mr-2 ve-w-70p">${ipt}</div>`.vee.appendTo(wrpIpts);
			ipts.push({abv, ipt});
		});

		return row;
	}

	/* -------------------------------------------- */

	_getSkillProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Skill Proficiencies", {isMarked: true});

		const existing = this._getFirstEntry("skillProficiencies") || {};
		const isChoose = !!existing.choose;

		const doUpdate = () => {
			const skills = getSkills();
			const count = this.constructor._getIptNum(iptCount);

			if (!skills.length) this._setOrDelete("skillProficiencies", null);
			else if (count != null && count > 0 && count < skills.length) this._setOrDelete("skillProficiencies", [{choose: {from: skills, count}}]);
			else this._setOrDelete("skillProficiencies", [skills.mergeMap(it => ({[it]: true}))]);

			cb();
		};

		const iptCount = this.constructor._getNumberIpt({
			initial: isChoose ? (existing.choose.count ?? 1) : null,
			placeholder: "All of them",
			onChange: doUpdate,
		});
		veT`<div class="ve-flex-v-center ve-mb-2" title="Leave empty to grant every ticked skill; set a number to make it a choice of that many.">
			<span class="ve-mr-2">Choose</span>${iptCount}
		</div>`.vee.appendTo(rowInner);

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getSkills = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: _SKILLS,
			fnDisplay: it => it.toTitleCase(),
			initial: isChoose ? (existing.choose.from || []) : Object.keys(existing).filter(it => _SKILLS.includes(it)),
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/** Named tongues this species knows, plus however many of the player's choosing. */
	_getLanguageProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Languages", {isMarked: true});

		const existing = this._getFirstEntry("languageProficiencies") || {};
		const named = Object.keys(existing).filter(it => existing[it] === true);

		const doUpdate = () => {
			const out = {};
			list.getValues().forEach(it => out[it.toLowerCase()] = true);

			const anyCount = this.constructor._getIptNum(iptAny);
			if (anyCount != null && anyCount > 0) out.anyStandard = anyCount;

			this._setOrDelete("languageProficiencies", Object.keys(out).length ? [out] : null);
			cb();
		};

		const iptAny = this.constructor._getNumberIpt({
			initial: existing.anyStandard ?? existing.any,
			placeholder: "How many",
			onChange: doUpdate,
		});
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Standard languages (any)</span>${iptAny}</div>`.vee.appendTo(rowInner);

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: named,
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const ipt = this.constructor._getTextIpt({initial, placeholder: "A language by name, e.g. elvish", onChange});
				return {ele: ipt, getValue: () => this.constructor._getIptStr(ipt)};
			},
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Language</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { list.add(); doUpdate(); });

		return row;
	}

	/* -------------------------------------------- */

	/** Read structurally by the sheet's defenses panel, which is why they are ticked and not typed. */
	_getDefencesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Resistances & Immunities", {isMarked: true});

		const specs = [
			{label: "Resistance", prop: "resist", vals: Parser.DMG_TYPES},
			{label: "Immunity", prop: "immune", vals: Parser.DMG_TYPES},
			{label: "Vulnerability", prop: "vulnerable", vals: Parser.DMG_TYPES},
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
			name: "Species",
			fnRender: cpy => Renderer.race.getCompactRenderedString(cpy),
		});
	}
}
