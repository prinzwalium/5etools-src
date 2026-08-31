import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "../consts.js";

/**
 * A builder for backgrounds.
 *
 * A background is the densest of the shallow kinds, because the 2024 books moved so much onto it:
 * it now decides two of your ability scores, hands you an origin feat, and carries the starting
 * equipment. All of that is structured, and all of it is read structurally by the character builder
 * — so a background written as prose gives a character nothing at all, however well it reads.
 *
 * The ability increase is the one place this builder knows a rule rather than a field. Every 2024
 * background states the same pair: +2/+1 among three named abilities, or +1 to each. That is not a
 * choice an author makes, it is the shape the books use, so the UI asks for the three abilities and
 * writes both options.
 */

const _SKILLS = Object.keys(Parser.SKILL_TO_ATB_ABV);

/** Copper, because that is the unit `{value}` is in; a background states gold. */
const _CP_PER_GP = 100;

export class BackgroundBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "background",
			pFnGetFluff: Renderer.background.pGetFluff.bind(Renderer.background),
		});

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	async pHandleClickLoadExisting () {
		const result = await SearchWidget.pGetUserBackgroundSearch();
		if (!result) return;
		const bg = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(bg);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Background",
			edition: SITE_STYLE__ONE,
			entries: [],
			source: this._ui ? this._ui.source : "",
		};
	}

	/** The 2024 books capitalise the equipment option keys and the 2014 ones do not. */
	get _isModern () { return this._state.edition !== SITE_STYLE__CLASSIC; }

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, benefitsTab, equipmentTab, textTab] = this._renderForkInputTabs({wrp, names: ["Info", "Benefits", "Equipment", "Text"]});

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
				title: "A 2024 background sets ability scores and grants an origin feat; a 2014 one does neither.",
			},
			"edition",
		).vee.appendTo(infoTab.wrpTab);

		// ---------- BENEFITS ----------
		this._getAbilityInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getSkillProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getToolProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getLanguageProficiencyInput(cb).vee.appendTo(benefitsTab.wrpTab);
		this._getFeatInput(cb).vee.appendTo(benefitsTab.wrpTab);

		// ---------- EQUIPMENT ----------
		this._getEquipmentInput(cb).vee.appendTo(equipmentTab.wrpTab);

		// ---------- TEXT ----------
		BuilderUi.getStateIptEntries(
			"Text",
			cb,
			this._state,
			{placeholder: "The background's description. What it grants is stated in the fields above; the books restate it here in prose, and so may you."},
			"entries",
		).vee.appendTo(textTab.wrpTab);
	}

	/* -------------------------------------------- */

	/**
	 * Three abilities in, two options out: +2 to one and +1 to another, or +1 to each. Nothing in
	 * the books deviates from that, so it is not worth asking the author to state it twice.
	 */
	_getAbilityInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Ability Scores",
			{isMarked: true, title: "Tick three. The background then offers +2/+1 among them, or +1 to each — the pair every 2024 background states."},
		);

		const existingFrom = this._getFirstEntry("ability")?.choose?.weighted?.from || [];

		const dispStatus = veT`<div class="ve-muted ve-italic ve-mb-2"></div>`.vee.appendTo(rowInner);

		const doUpdate = () => {
			const abvs = getAbvs();
			dispStatus.vee.html(abvs.length === 3
				? ""
				: `Ticked ${abvs.length} of 3 — a background states three, and grants nothing until it does.`);

			this._setOrDelete("ability", abvs.length === 3
				? [
					{choose: {weighted: {from: abvs, weights: [2, 1]}}},
					{choose: {weighted: {from: abvs, weights: [1, 1, 1]}}},
				]
				: null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getAbvs = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.ABIL_ABVS,
			fnDisplay: it => Parser.attAbvToFull(it),
			initial: existingFrom,
			onChange: doUpdate,
		});

		doUpdate();

		return row;
	}

	/* -------------------------------------------- */

	/** A background grants its skills outright; none in the books offers a choice of them. */
	_getSkillProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Skill Proficiencies", {isMarked: true});

		const existing = this._getFirstEntry("skillProficiencies") || {};

		const doUpdate = () => {
			const skills = getSkills();
			this._setOrDelete("skillProficiencies", skills.length ? [skills.mergeMap(it => ({[it]: true}))] : null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getSkills = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: _SKILLS,
			fnDisplay: it => it.toTitleCase(),
			initial: Object.keys(existing).filter(it => _SKILLS.includes(it)),
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * Tools are named by their item name, lowercased — "calligrapher's supplies", "thieves' tools".
	 * `anyArtisansTool` is the count when the background lets you pick instead.
	 */
	_getToolProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Tool Proficiencies", {isMarked: true});

		const existing = this._getFirstEntry("toolProficiencies") || {};
		const named = Object.keys(existing).filter(it => existing[it] === true);

		const doUpdate = () => {
			const out = {};
			list.getValues().forEach(it => out[it.toLowerCase()] = true);

			const anyCount = this.constructor._getIptNum(iptAny);
			if (anyCount != null && anyCount > 0) out.anyArtisansTool = anyCount;

			this._setOrDelete("toolProficiencies", Object.keys(out).length ? [out] : null);
			cb();
		};

		const iptAny = this.constructor._getNumberIpt({initial: existing.anyArtisansTool, placeholder: "How many", onChange: doUpdate});
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Artisan's tools (any)</span>${iptAny}</div>`.vee.appendTo(rowInner);

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: named,
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const ipt = this.constructor._getTextIpt({initial, placeholder: "A tool by name, e.g. calligrapher's supplies", onChange});
				return {ele: ipt, getValue: () => this.constructor._getIptStr(ipt)};
			},
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Tool</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { list.add(); doUpdate(); });

		return row;
	}

	/* -------------------------------------------- */

	_getLanguageProficiencyInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Languages",
			{isMarked: true, title: "How many languages of the player's choosing this background grants."},
		);

		const existing = this._getFirstEntry("languageProficiencies") || {};

		const doUpdate = () => {
			const count = this.constructor._getIptNum(ipt);
			this._setOrDelete("languageProficiencies", count != null && count > 0 ? [{anyStandard: count}] : null);
			cb();
		};

		const ipt = this.constructor._getNumberIpt({
			initial: existing.anyStandard ?? existing.any,
			placeholder: "How many",
			onChange: doUpdate,
		});
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-200p">Standard languages (any)</span>${ipt}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * The origin feat. It is picked rather than typed because the uid has to match a real feat
	 * exactly — a background whose feat does not resolve grants nothing, silently.
	 */
	_getFeatInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Origin Feat",
			{isMarked: true, title: "The feat this background grants. 2024 backgrounds all grant one."},
		);

		const existing = Object.keys(this._getFirstEntry("feats") || {});

		const doUpdate = () => {
			const uids = list.getValues();
			this._setOrDelete("feats", uids.length ? [uids.mergeMap(it => ({[it.toLowerCase()]: true}))] : null);
			cb();
		};

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: existing,
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const ipt = this.constructor._getTextIpt({initial, placeholder: "name|source", onChange});
				return {ele: ipt, getValue: () => this.constructor._getIptStr(ipt)};
			},
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Choose Feat...</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", async () => {
				const result = await SearchWidget.pGetUserFeatSearch();
				if (!result) return;
				const feat = await DataLoader.pCacheAndGet(result.page, result.source, result.hash);
				list.add(`${feat.name}|${feat.source}`.toLowerCase());
				doUpdate();
			});

		return row;
	}

	/* -------------------------------------------- */

	_getEquipmentInput (cb) {
		return this._getEquipmentGroupsInput({
			label: "Starting Equipment",
			groups: (this._state.startingEquipment || [])[0],
			isModern: this._isModern,
			fnSet: nxt => this._setOrDelete("startingEquipment", nxt ? [nxt] : null),
			cb,
		});
	}

	/* -------------------------------------------- */

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		this._renderForkOutput({
			name: "Background",
			fnRender: cpy => Renderer.background.getCompactRenderedString(cpy),
		});
	}
}
