import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {SITE_STYLE__CLASSIC, SITE_STYLE__ONE} from "../consts.js";

/**
 * A builder for subclasses.
 *
 * The first kind with **by-level structure**, and the first that cannot be written the way the
 * books write it. In `data/class/class-*.json` a subclass's `subclassFeatures` is a list of *string
 * refs* — `"Rakish Audacity|Rogue|PHB|Swashbuckler|SCAG|3"` — pointing into a `subclassFeature[]`
 * array in the same file. A brew document saved from here holds one entity in one property, so
 * there is nowhere for that second array to live and every ref would dangle.
 *
 * The loader has a way through. `_pGetDereferencedSubclassData` short-circuits — "gracefully handle
 * legacy class data" — when no element of `subclassFeatures` is a string or carries a
 * `subclassFeature` key, and hands the list back untouched. So a subclass may carry its features
 * **inline**, and this builder writes them that way: one flat list of feature objects, each with the
 * level it is gained at. The character sheet reads them by `level` regardless of nesting, so the
 * flat form and the books' nested form behave identically.
 *
 * Spellcasting is the other thing worth knowing. A third-caster subclass — Eldritch Knight, Arcane
 * Trickster — states its own `casterProgression` and `cantripProgression`; the slots come from that,
 * not from the parent class, which has none.
 */

const _CASTER_PROGRESSIONS = ["1/3", "1/2", "full", "pact", "artificer"];

export class SubclassBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "subclass",
			pFnGetFluff: Renderer.subclass.pGetFluff.bind(Renderer.subclass),
		});

		this._classes = [];

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	/** The parent class has to be picked from what exists, because the link is by name and source. */
	async _pInit () {
		const {class: classes} = await DataUtil.class.loadJSON();
		this._classes = (classes || [])
			.map(cls => ({
				uid: `${cls.name}|${cls.source}`,
				display: `${cls.name} (${Parser.sourceJsonToAbv(cls.source)})`,
			}))
			.sort((a, b) => SortUtil.ascSortLower(a.display, b.display));
	}

	/** Upstream has no subclass search widget, so offer the loaded list instead. */
	async pHandleClickLoadExisting () {
		const {subclass: subclasses} = await DataUtil.class.loadJSON();
		const sorted = (subclasses || [])
			.map(sc => ({sc, display: `${sc.className}: ${sc.name} (${Parser.sourceJsonToAbv(sc.source)})`}))
			.sort((a, b) => SortUtil.ascSortLower(a.display, b.display));

		const ix = await InputUiUtil.pGetUserEnum({
			values: sorted.map(it => it.display),
			title: "Select Subclass",
			isResolveItem: false,
		});
		// Cancelled, or the modal's "skip", which resolves to a symbol
		if (typeof ix !== "number") return;

		return this.pHandleLoadExistingData(MiscUtil.copy(sorted[ix].sc));
	}

	/**
	 * A loaded subclass arrives with its features already dereferenced and nested by level. Flatten
	 * them, because that is the shape this builder edits — and it is the shape that survives being
	 * saved on its own, with no `subclassFeature[]` array behind it.
	 */
	async pHandleLoadExistingData (sc, opts) {
		sc.subclassFeatures = (sc.subclassFeatures || [])
			.flat()
			.filter(it => it && typeof it === "object" && !it.subclassFeature);

		return super.pHandleLoadExistingData(sc, opts);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Subclass",
			shortName: "New",
			className: "Fighter",
			classSource: Parser.SRC_XPHB,
			edition: SITE_STYLE__ONE,
			subclassFeatures: [],
			source: this._ui ? this._ui.source : "",
		};
	}

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, featuresTab, spellsTab] = this._renderForkInputTabs({wrp, names: ["Info", "Features", "Spellcasting"]});

		// ---------- INFO ----------
		BuilderUi.getStateIptString("Name", cb, this._state, {nullable: false}, "name").vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString(
			"Short Name",
			cb,
			this._state,
			{
				nullable: false,
				title: "What the class table's column calls it — \"Swashbuckler\" for the College of Swashbucklers. Features are keyed by it, so changing it later orphans them.",
			},
			"shortName",
		).vee.appendTo(infoTab.wrpTab);
		this._selSource = this.getSourceInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString("Page", cb, this._state, {type: "number"}, "page").vee.appendTo(infoTab.wrpTab);
		this._getClassInput(cb).vee.appendTo(infoTab.wrpTab);
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

		// ---------- FEATURES ----------
		this._getFeaturesInput(cb).vee.appendTo(featuresTab.wrpTab);

		// ---------- SPELLCASTING ----------
		this._getSpellcastingInput(cb).vee.appendTo(spellsTab.wrpTab);
	}

	/* -------------------------------------------- */

	/** Two fields, one choice: a subclass names its parent by name *and* source. */
	_getClassInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Class",
			{isMarked: true, title: "The class this subclass belongs to. Its spell slots, and the level its features arrive at, come from here."},
		);

		const doUpdate = () => {
			const uid = sel.vee.val();
			const [className, classSource] = (uid || "|").split("|");
			this._state.className = className;
			this._state.classSource = classSource;
			cb();
		};

		const sel = veT`<select class="ve-form-control ve-input-xs form-control--minimal"></select>`;
		this._classes.forEach(it => sel.vee.appends(`<option value="${it.uid.escapeQuotes()}">${it.display.escapeQuotes()}</option>`));
		sel.vee.val(`${this._state.className}|${this._state.classSource}`).vee.onn("change", () => doUpdate());

		veT`<div class="ve-flex-v-center ve-w-100">${sel}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * The features, as a list of rows. Each is a level, a name and its text — which is all a
	 * subclass feature is once the refs are resolved away.
	 */
	_getFeaturesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Features",
			{isMarked: true, title: "What this subclass grants, and when. The level is what the sheet's timeline reads; nothing else orders them."},
		);

		const doUpdate = () => {
			const features = list.getValues()
				.sort((a, b) => a.level - b.level);
			this._setOrDelete("subclassFeatures", features.length ? features : null);
			cb();
		};

		const list = this.constructor._getRowList({
			wrp: rowInner,
			initial: this._state.subclassFeatures || [],
			onChange: doUpdate,
			fnGetRow: (initial, onChange) => this._getFeatureRow(initial, onChange),
		});

		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Add Feature</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", () => { list.add({level: 3}); doUpdate(); });

		return row;
	}

	/**
	 * One feature. The identity fields — which class, which subclass, which source — are carried
	 * rather than asked for: they are already answered on the Info tab, and a feature that disagrees
	 * with its subclass is a feature nothing will find.
	 */
	_getFeatureRow (initial, onChange) {
		const iptLevel = this.constructor._getNumberIpt({initial: initial?.level ?? 3, placeholder: "Level", onChange});
		iptLevel.vee.addClass("ve-w-70p");

		const iptName = this.constructor._getTextIpt({initial: initial?.name, placeholder: "Feature name", onChange});

		const iptEntries = veT`<textarea class="ve-form-control form-control--minimal ve-resize-vertical ve-mr-2" placeholder="What it does"></textarea>`
			.vee.val(UiUtil.getEntriesAsText(initial?.entries))
			.vee.onn("change", () => onChange());

		const ele = veT`<div class="ve-flex-col ve-w-100 ve-mr-2">
			<div class="ve-flex-v-center ve-mb-1">${iptLevel}${iptName}</div>
			${iptEntries}
		</div>`;

		return {
			ele,
			getValue: () => {
				const name = this.constructor._getIptStr(iptName);
				const level = this.constructor._getIptNum(iptLevel);
				if (!name || level == null) return null;

				return {
					name,
					source: this._state.source,
					className: this._state.className,
					classSource: this._state.classSource,
					subclassShortName: this._state.shortName,
					subclassSource: this._state.source,
					level,
					entries: UiUtil.getTextAsEntries(`${iptEntries.vee.val() ?? ""}`),
				};
			},
		};
	}

	/* -------------------------------------------- */

	/**
	 * Only for a subclass that casts on its own — the third-casters, and nothing else in the books.
	 * A subclass of a class that already casts leaves all of this empty and inherits its slots.
	 */
	_getSpellcastingInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Spellcasting",
			{isMarked: true, title: "Only for a subclass that grants spellcasting a class does not already have — Eldritch Knight, Arcane Trickster. Otherwise leave empty."},
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

			dispStatus.vee.html(progression || (!cantrips && !known)
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

		const iptCantrips = this.constructor._getTextIpt({
			initial: (this._state.cantripProgression || []).join(", ") || null,
			placeholder: "One number per level, 1 to 20",
			onChange: doUpdate,
		});
		const iptKnown = this.constructor._getTextIpt({
			initial: (this._state.spellsKnownProgression || []).join(", ") || null,
			placeholder: "One number per level, 1 to 20",
			onChange: doUpdate,
		});

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Caster progression</span>${selProgression}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Spellcasting ability</span>${selAbility}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Cantrips known</span>${iptCantrips}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-200p">Spells known</span>${iptKnown}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/**
	 * Twenty numbers, one per class level. Anything shorter is padded, because a progression that
	 * stops at level 12 reads as "no cantrips at 13" rather than "unspecified".
	 */
	static _parseProgression (ipt) {
		const raw = this._getIptStr(ipt);
		if (!raw) return null;

		const nums = raw.split(/[,\s]+/)
			.filter(Boolean)
			.map(it => Number(it))
			.filter(it => !isNaN(it));
		if (!nums.length) return null;

		return [...new Array(20)].map((_, i) => nums[i] ?? nums[nums.length - 1]);
	}

	/* -------------------------------------------- */

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		this._renderForkOutput({
			name: "Subclass",
			fnRender: cpy => {
				// The renderer expects the books' nesting — a list of per-level groups — while this
				// builder keeps one flat list. Group it for the preview only
				const byLevel = {};
				(cpy.subclassFeatures || []).forEach(it => (byLevel[it.level] ||= []).push(it));
				cpy.subclassFeatures = Object.keys(byLevel)
					.map(Number)
					.sort(SortUtil.ascSort)
					.map(lvl => byLevel[lvl]);

				return Renderer.subclass.getCompactRenderedString(cpy);
			},
		});
	}
}
