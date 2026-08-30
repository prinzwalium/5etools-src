import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "../consts.js";

/**
 * A builder for classes.
 *
 * The deepest thing here, and the one where "produces valid JSON" is not the bar. A class is read
 * back by `charactersheet-levelengine.js` for twenty levels of hit points, proficiency, spell slots,
 * resources and features — so the bar is that *it* reads what this writes.
 *
 * Three things follow from that, and they are the whole design of this builder:
 *
 * **Features are inline, and indexed by level.** As with a subclass, `classFeatures` in the books is
 * a list of string refs into a `classFeature[]` array that a one-entity brew document has nowhere to
 * put. The loader's legacy short-circuit lets them be carried inline instead. But where a subclass's
 * features are read with `.flat().filter(level)`, a class's are read as
 * `classFeatures[level - 1]` — a by-level array, index 0 being level 1 — so this builder writes
 * twenty buckets rather than one flat list.
 *
 * **A feature can be the one that opens the subclass.** `gainSubclassFeature` is the marker the
 * timeline splices subclass features in at; without it, a homebrew class's subclass is never asked
 * for and never appears.
 *
 * **The class table is where resources live.** Rages, Ki Points, Sneak Attack, Bardic Inspiration —
 * none of these is a feature field, all of them are columns of `classTableGroups`. A class whose
 * table is empty grants no resources however much its prose says otherwise.
 */

const _SKILLS = Object.keys(Parser.SKILL_TO_ATB_ABV);
const _CASTER_PROGRESSIONS = ["1/3", "1/2", "full", "pact", "artificer"];
const _ARMOR_PROFICIENCIES = ["light", "medium", "heavy", "shield"];
const _WEAPON_PROFICIENCIES = ["simple", "martial"];
const _HIT_DIE_FACES = [4, 6, 8, 10, 12];
const _MAX_LEVEL = 20;

export class ClassBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "class",
			pFnGetFluff: Renderer.class.pGetFluff.bind(Renderer.class),
		});

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	/** Upstream has no class search widget, so offer the loaded list instead. */
	async pHandleClickLoadExisting () {
		const {class: classes} = await DataUtil.class.loadJSON();
		const sorted = (classes || [])
			.map(cls => ({cls, display: `${cls.name} (${Parser.sourceJsonToAbv(cls.source)})`}))
			.sort((a, b) => SortUtil.ascSortLower(a.display, b.display));

		const ix = await InputUiUtil.pGetUserEnum({
			values: sorted.map(it => it.display),
			title: "Select Class",
			isResolveItem: false,
		});
		// Cancelled, or the modal's "skip", which resolves to a symbol
		if (typeof ix !== "number") return;

		return this.pHandleLoadExistingData(MiscUtil.copy(sorted[ix].cls));
	}

	/**
	 * A loaded class arrives with its features dereferenced into by-level buckets already, which is
	 * the shape this builder edits — but the buckets can hold sub-feature refs the copy cannot
	 * resolve, so drop anything that is not a feature in its own right.
	 */
	async pHandleLoadExistingData (cls, opts) {
		cls.classFeatures = (cls.classFeatures || [])
			.map(atLevel => (atLevel instanceof Array ? atLevel : [atLevel])
				.filter(it => it && typeof it === "object" && !it.classFeature));

		return super.pHandleLoadExistingData(cls, opts);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Class",
			edition: SITE_STYLE__ONE,
			hd: {number: 1, faces: 8},
			proficiency: [],
			subclassTitle: "Subclass",
			classFeatures: [],
			source: this._ui ? this._ui.source : "",
		};
	}

	get _isModern () { return this._state.edition !== SITE_STYLE__CLASSIC; }

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, profTab, featuresTab, tableTab, spellsTab] = this._renderForkInputTabs({
			wrp,
			names: ["Info", "Proficiencies", "Features", "Table", "Spellcasting"],
		});

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
			},
			"edition",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString(
			"Subclass Title",
			cb,
			this._state,
			{title: "What this class calls its subclasses — \"Primal Path\", \"Divine Domain\", \"Martial Archetype\"."},
			"subclassTitle",
		).vee.appendTo(infoTab.wrpTab);
		this._getHitDieInput(cb).vee.appendTo(infoTab.wrpTab);
		this._getPrimaryAbilityInput(cb).vee.appendTo(infoTab.wrpTab);
		this._getSavingThrowInput(cb).vee.appendTo(infoTab.wrpTab);
		this._getMulticlassingInput(cb).vee.appendTo(infoTab.wrpTab);

		// ---------- PROFICIENCIES ----------
		this._getStartingProficienciesInput(cb).vee.appendTo(profTab.wrpTab);
		this._getStartingEquipmentInput(cb).vee.appendTo(profTab.wrpTab);

		// ---------- FEATURES ----------
		this._getFeaturesInput(cb).vee.appendTo(featuresTab.wrpTab);

		// ---------- TABLE ----------
		this._getClassTableInput(cb).vee.appendTo(tableTab.wrpTab);

		// ---------- SPELLCASTING ----------
		this._getSpellcastingInput(cb).vee.appendTo(spellsTab.wrpTab);
	}

	/* -------------------------------------------- */

	/** One die per level, so only its size is a question. */
	_getHitDieInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Hit Die", {isMarked: true});

		const doUpdate = () => {
			const faces = _HIT_DIE_FACES[Number(sel.vee.val())];
			this._state.hd = {number: 1, faces};
			cb();
		};

		const sel = veT`<select class="ve-form-control ve-input-xs form-control--minimal"></select>`;
		_HIT_DIE_FACES.forEach((v, i) => sel.vee.appends(`<option value="${i}">d${v}</option>`));
		sel.vee.val(`${Math.max(0, _HIT_DIE_FACES.indexOf(this._state.hd?.faces ?? 8))}`)
			.vee.onn("change", () => doUpdate());

		veT`<div class="ve-flex-v-center ve-w-100">${sel}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	_getPrimaryAbilityInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Primary Ability",
			{isMarked: true, title: "What the class runs on. Shown to a player choosing a class, and what the multiclass requirement is usually about."},
		);

		const doUpdate = () => {
			const abvs = getAbvs();
			this._setOrDelete("primaryAbility", abvs.length ? [abvs.mergeMap(it => ({[it]: true}))] : null);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getAbvs = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.ABIL_ABVS,
			fnDisplay: it => Parser.attAbvToFull(it),
			initial: Object.keys(this._getFirstEntry("primaryAbility") || {}),
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/** `proficiency` is the saving throws, and nothing else — two of them, in every class. */
	_getSavingThrowInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Saving Throws", {isMarked: true});

		const dispStatus = veT`<div class="ve-muted ve-italic ve-mb-2"></div>`.vee.appendTo(rowInner);

		const doUpdate = () => {
			const abvs = getAbvs();
			this._setOrDelete("proficiency", abvs.length ? abvs : null);
			dispStatus.vee.html(abvs.length === 2 || !abvs.length
				? ""
				: `Every class in the books grants exactly two; this grants ${abvs.length}.`);
			cb();
		};

		const wrpCbs = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getAbvs = this.constructor._getCheckboxes({
			wrp: wrpCbs,
			vals: Parser.ABIL_ABVS,
			fnDisplay: it => Parser.attAbvToFull(it),
			initial: this._state.proficiency || [],
			onChange: doUpdate,
		});

		doUpdate();

		return row;
	}

	/* -------------------------------------------- */

	/** What a character must already have to take a level in this class. */
	_getMulticlassingInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Multiclass Requirement",
			{isMarked: true, title: "The minimum ability scores needed to multiclass into this class. Leave empty for none."},
		);

		const existing = this._state.multiclassing?.requirements || {};

		const ipts = [];
		const doUpdate = () => {
			const out = {};
			ipts.forEach(({abv, ipt}) => {
				const val = this.constructor._getIptNum(ipt);
				if (val != null && val > 0) out[abv] = val;
			});

			const nxt = {...(this._state.multiclassing || {})};
			if (Object.keys(out).length) nxt.requirements = out;
			else delete nxt.requirements;

			this._setOrDelete("multiclassing", Object.keys(nxt).length ? nxt : null);
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

	_getStartingProficienciesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Starting Proficiencies", {isMarked: true});

		const existing = this._state.startingProficiencies || {};
		const existingSkills = (existing.skills || [])[0]?.choose || {};

		const doUpdate = () => {
			const out = {};

			const armor = getArmor();
			if (armor.length) out.armor = armor;

			const weapons = getWeapons();
			if (weapons.length) out.weapons = weapons;

			const tools = listTools.getValues().map(it => it.toLowerCase());
			if (tools.length) out.tools = tools;

			const skills = getSkills();
			const count = this.constructor._getIptNum(iptSkillCount);
			if (skills.length) {
				out.skills = count != null && count > 0 && count < skills.length
					? [{choose: {from: skills, count}}]
					: [skills.mergeMap(it => ({[it]: true}))];
			}

			this._setOrDelete("startingProficiencies", Object.keys(out).length ? out : null);
			cb();
		};

		veT`<div class="ve-bold ve-mb-1">Armor</div>`.vee.appendTo(rowInner);
		const wrpArmor = veT`<div class="ve-flex-col ve-w-100 ve-mb-2"></div>`.vee.appendTo(rowInner);
		const getArmor = this.constructor._getCheckboxes({
			wrp: wrpArmor,
			vals: _ARMOR_PROFICIENCIES,
			fnDisplay: it => it.toTitleCase(),
			initial: existing.armor || [],
			onChange: doUpdate,
		});

		veT`<div class="ve-bold ve-mb-1">Weapons</div>`.vee.appendTo(rowInner);
		const wrpWeapons = veT`<div class="ve-flex-col ve-w-100 ve-mb-2"></div>`.vee.appendTo(rowInner);
		const getWeapons = this.constructor._getCheckboxes({
			wrp: wrpWeapons,
			vals: _WEAPON_PROFICIENCIES,
			fnDisplay: it => it.toTitleCase(),
			initial: existing.weapons || [],
			onChange: doUpdate,
		});

		veT`<div class="ve-bold ve-mb-1">Tools</div>`.vee.appendTo(rowInner);
		const listTools = this.constructor._getRowList({
			wrp: rowInner,
			initial: (existing.tools || []).filter(it => typeof it === "string"),
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const ipt = this.constructor._getTextIpt({initial, placeholder: "A tool by name, e.g. thieves' tools", onChange});
				return {ele: ipt, getValue: () => this.constructor._getIptStr(ipt)};
			},
		});
		veT`<button class="ve-btn ve-btn-xs ve-btn-default ve-mb-2">Add Tool</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { listTools.add(); doUpdate(); });

		veT`<div class="ve-bold ve-mb-1">Skills</div>`.vee.appendTo(rowInner);
		const iptSkillCount = this.constructor._getNumberIpt({
			initial: existingSkills.count,
			placeholder: "All of them",
			onChange: doUpdate,
		});
		veT`<div class="ve-flex-v-center ve-mb-2" title="Leave empty to grant every ticked skill; set a number to make it a choice of that many.">
			<span class="ve-mr-2">Choose</span>${iptSkillCount}
		</div>`.vee.appendTo(rowInner);
		const wrpSkills = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getSkills = this.constructor._getCheckboxes({
			wrp: wrpSkills,
			vals: _SKILLS,
			fnDisplay: it => it.toTitleCase(),
			initial: existingSkills.from || Object.keys((existing.skills || [])[0] || {}).filter(it => _SKILLS.includes(it)),
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	/** A class states its bundles under `startingEquipment.defaultData`; a background states them flat. */
	_getStartingEquipmentInput (cb) {
		return this._getEquipmentGroupsInput({
			label: "Starting Equipment",
			groups: (this._state.startingEquipment?.defaultData || [])[0],
			isModern: this._isModern,
			fnSet: nxt => {
				const existing = {...(this._state.startingEquipment || {})};
				if (nxt) existing.defaultData = [nxt];
				else delete existing.defaultData;
				this._setOrDelete("startingEquipment", Object.keys(existing).length ? existing : null);
			},
			cb,
		});
	}

	/* -------------------------------------------- */

	/**
	 * Twenty buckets, because the sheet reads `classFeatures[level - 1]`. Rows are edited flat and
	 * bucketed on write, which is the only place the two shapes have to agree.
	 */
	_getFeaturesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Features",
			{isMarked: true, title: "What the class grants, and when. Tick \"opens the subclass\" on the level that first asks for one."},
		);

		const doUpdate = () => {
			const features = list.getValues();

			if (!features.length) this._setOrDelete("classFeatures", null);
			else {
				const maxLevel = Math.min(Math.max(...features.map(it => it.level)), _MAX_LEVEL);
				const byLevel = [...new Array(maxLevel)].map(() => []);
				features.forEach(it => byLevel[it.level - 1]?.push(it));
				this._setOrDelete("classFeatures", byLevel);
			}

			cb();
		};

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: (this._state.classFeatures || []).flat(),
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => this._getFeatureRow(initial, onChange),
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Feature</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { list.add({level: 1}); doUpdate(); });

		return row;
	}

	_getFeatureRow (initial, onChange) {
		const iptLevel = this.constructor._getNumberIpt({initial: initial?.level ?? 1, placeholder: "Level", onChange});
		iptLevel.vee.addClass("ve-w-70p");

		const iptName = this.constructor._getTextIpt({initial: initial?.name, placeholder: "Feature name", onChange});

		const cbSubclass = veT`<input class="mkbru__ipt-cb ve-mr-1" type="checkbox">`
			.vee.prop("checked", !!initial?.gainSubclassFeature)
			.vee.onn("change", () => onChange());

		const iptEntries = veT`<textarea class="ve-form-control form-control--minimal ve-resize-vertical" placeholder="What it does"></textarea>`
			.vee.val(UiUtil.getEntriesAsText(initial?.entries))
			.vee.onn("change", () => onChange());

		const ele = veT`<div class="ve-flex-col ve-w-100 ve-mr-2">
			<div class="ve-flex-v-center ve-mb-1">
				${iptLevel}${iptName}
				<label class="ve-flex-v-center ve-mb-0 ve-ml-2 ve-no-wrap" title="The feature that first asks for a subclass. Without this marker a subclass is never offered.">${cbSubclass}<span class="ve-muted">opens the subclass</span></label>
			</div>
			${iptEntries}
		</div>`;

		return {
			ele,
			getValue: () => {
				const name = this.constructor._getIptStr(iptName);
				const level = this.constructor._getIptNum(iptLevel);
				if (!name || level == null || level < 1 || level > _MAX_LEVEL) return null;

				const out = {
					name,
					source: this._state.source,
					className: this._state.name,
					classSource: this._state.source,
					level,
					entries: UiUtil.getTextAsEntries(`${iptEntries.vee.val() ?? ""}`),
				};
				if (cbSubclass.vee.prop("checked")) out.gainSubclassFeature = true;
				return out;
			},
		};
	}

	/* -------------------------------------------- */

	/**
	 * The class table's resource columns — Rages, Ki Points, Sneak Attack, Bardic Inspiration. None
	 * of these is a feature field: the sheet reads them off this table by column label, so a class
	 * with an empty table grants no resources however much its prose says otherwise.
	 */
	_getClassTableInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Class Table",
			{isMarked: true, title: "One column per resource, twenty values apiece — one for each level."},
		);

		const existing = (this._state.classTableGroups || [])[0] || {};
		const initialCols = (existing.colLabels || []).map((label, ix) => ({
			label,
			values: (existing.rows || []).map(r => {
				const cell = r?.[ix];
				return cell != null && typeof cell === "object" ? (cell.value ?? "") : (cell ?? "");
			}),
		}));

		const doUpdate = () => {
			const cols = list.getValues();

			if (!cols.length) this._setOrDelete("classTableGroups", null);
			else {
				// A column stated for fewer than twenty levels holds its last value, which is what
				// a table that stops changing actually means
				const rows = [...new Array(_MAX_LEVEL)]
					.map((_, lvl) => cols.map(col => col.values[lvl] ?? col.values[col.values.length - 1] ?? ""));
				this._setOrDelete("classTableGroups", [{colLabels: cols.map(it => it.label), rows}]);
			}

			cb();
		};

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: initialCols,
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => {
				const iptLabel = this.constructor._getTextIpt({initial: initial?.label, placeholder: "Column, e.g. Rages", onChange});
				const iptValues = this.constructor._getTextIpt({
					initial: (initial?.values || []).join(", ") || null,
					placeholder: "One value per level, 1 to 20",
					onChange,
				});

				const ele = veT`<div class="ve-flex-col ve-w-100 ve-mr-2">
					<div class="ve-mb-1">${iptLabel}</div>
					${iptValues}
				</div>`;

				return {
					ele,
					getValue: () => {
						const label = this.constructor._getIptStr(iptLabel);
						if (!label) return null;
						const raw = this.constructor._getIptStr(iptValues) || "";
						return {label, values: raw.split(",").map(it => it.trim()).filter(Boolean)};
					},
				};
			},
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Column</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { list.add(); doUpdate(); });

		return row;
	}

	/* -------------------------------------------- */

	_getSpellcastingInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Spellcasting",
			{isMarked: true, title: "Leave the progression empty for a class that does not cast. The slot table follows from it; nothing else needs stating."},
		);

		const doUpdate = () => {
			const ixProg = Number(selProgression.vee.val());
			const progression = ~ixProg ? _CASTER_PROGRESSIONS[ixProg] : null;
			this._setOrDelete("casterProgression", progression);

			const ixAbil = Number(selAbility.vee.val());
			this._setOrDelete("spellcastingAbility", ~ixAbil ? Parser.ABIL_ABVS[ixAbil] : null);

			const cantrips = this.constructor._parseProgression(iptCantrips);
			this._setOrDelete("cantripProgression", progression && cantrips ? cantrips : null);

			const known = this.constructor._parseProgression(iptKnown);
			this._setOrDelete("spellsKnownProgression", progression && known ? known : null);

			const prepared = this.constructor._parseProgression(iptPrepared);
			this._setOrDelete("preparedSpellsProgression", progression && prepared ? prepared : null);

			dispStatus.vee.html(progression || !(cantrips || known || prepared)
				? ""
				: "A progression only takes effect once a caster progression is chosen.");
			cb();
		};

		const dispStatus = veT`<div class="ve-muted ve-italic ve-mb-2"></div>`.vee.appendTo(rowInner);

		const mkSel = (vals, fnDisplay, initial) => {
			const sel = veT`<select class="ve-form-control ve-input-xs form-control--minimal"><option value="-1">(None)</option></select>`;
			vals.forEach((v, i) => sel.vee.appends(`<option value="${i}">${fnDisplay(v).qq()}</option>`));
			sel.vee.val(`${vals.indexOf(initial)}`).vee.onn("change", () => doUpdate());
			return sel;
		};

		const selProgression = mkSel(_CASTER_PROGRESSIONS, it => it, this._state.casterProgression);
		const selAbility = mkSel(Parser.ABIL_ABVS, it => Parser.attAbvToFull(it), this._state.spellcastingAbility);

		const mkProgIpt = (prop) => this.constructor._getTextIpt({
			initial: (this._state[prop] || []).join(", ") || null,
			placeholder: "One number per level, 1 to 20",
			onChange: doUpdate,
		});
		const iptCantrips = mkProgIpt("cantripProgression");
		const iptKnown = mkProgIpt("spellsKnownProgression");
		const iptPrepared = mkProgIpt("preparedSpellsProgression");

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Caster progression</span>${selProgression}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Spellcasting ability</span>${selAbility}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Cantrips known</span>${iptCantrips}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Spells known</span>${iptKnown}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-200p">Spells prepared</span>${iptPrepared}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/**
	 * Twenty numbers, one per class level. Anything shorter is padded with its own last value,
	 * because a progression that stops at level 12 reads as "none from 13" rather than "unspecified".
	 */
	static _parseProgression (ipt) {
		const raw = this._getIptStr(ipt);
		if (!raw) return null;

		const nums = raw.split(/[,\s]+/)
			.filter(Boolean)
			.map(it => Number(it))
			.filter(it => !isNaN(it));
		if (!nums.length) return null;

		return [...new Array(_MAX_LEVEL)].map((_, i) => nums[i] ?? nums[nums.length - 1]);
	}

	/* -------------------------------------------- */

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		this._renderForkOutput({
			name: "Class",
			fnRender: cpy => Renderer.class.getCompactRenderedString(cpy),
		});
	}
}
