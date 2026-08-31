import {BuilderBase} from "./makebrew-builder-base.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {TagCondition} from "../converter/converterutils-tags.js";

/**
 * What every builder this fork adds needs, and upstream's `BuilderBase` does not provide.
 *
 * Upstream has three builders and each is a world of its own, so the boilerplate between them was
 * never worth lifting out. The fork is adding one per entity kind — feat, language, background,
 * species, item — and by the second it was the same forty lines each time: the tab skeleton, the
 * output pane, the load-a-template strip, and a handful of input widgets for the shapes 5etools
 * data actually takes (a set of things, a count, a list of rows).
 *
 * The rule for what belongs here: it must be true of every kind. Anything that knows what a feat or
 * a background *is* belongs in that builder.
 */
export class ForkBuilderBase extends BuilderBase {
	/**
	 * Claims about the printing a template was copied *from*, which the copy has no right to make.
	 * `_copy` and `_versions` go too: both are resolved at load time, so what reaches a builder is
	 * already the finished entity and keeping the instruction would apply it a second time.
	 */
	static _TEMPLATE_STRIP_PROPS = [
		"srd", "srd52", "basicRules", "basicRules2024",
		"reprintedAs", "additionalSources", "otherSources",
		"hasFluff", "hasFluffImages",
		"uniqueId", "_copy", "_versions", "_versionBase_isVersion",
	];

	/* -------------------------------------------- */

	/**
	 * @param ent
	 * @param [opts]
	 * @param [opts.meta]
	 */
	async pHandleLoadExistingData (ent, opts) {
		opts = opts || {};

		ent.name = `${ent.name} (Copy)`;
		ent.source = this._ui.source;

		this.constructor._TEMPLATE_STRIP_PROPS.forEach(prop => delete ent[prop]);
		Object.keys(ent).filter(k => k.startsWith("_")).forEach(k => delete ent[k]);

		const meta = {...(opts.meta || {}), ...this._getInitialMetaState({nameOriginal: ent.name, isModified: true})};

		this.setStateFromLoaded({s: ent, m: meta});

		this.renderInput();
		this.renderOutput();
	}

	setStateFromLoaded (state) {
		if (!state?.s || !state?.m) return;

		this._doResetProxies();

		if (!state.s.uniqueId) state.s.uniqueId = CryptUtil.uid();

		this.__state = state.s;
		this.__meta = state.m;
	}

	doHandleSourcesAdd () { /* No-op */ }

	_renderInputImpl () {
		this._doCreateProxies();
		this._doBindHeaderElements();
		this._renderInputMain();
	}

	/* -------------------------------------------- */

	/** A field that is absent means something different from a field that is null, so remove it. */
	_setOrDelete (prop, val) {
		if (val == null) delete this._state[prop];
		else this._state[prop] = val;
	}

	/** The single-entry arrays most of these fields are. */
	_getFirstEntry (prop) {
		const val = this._state[prop];
		return (val instanceof Array ? val[0] : val) || null;
	}

	/* -------------------------------------------- */

	/**
	 * The change callback every builder's inputs share: normalise the page, tag conditions in the
	 * prose, re-render the preview, and mark the entity dirty.
	 */
	_getRenderCallback () {
		const _cb = () => {
			// Prefer numerical pages if possible
			if (!isNaN(this._state.page)) this._state.page = Number(this._state.page);

			TagCondition.tryTagConditions(this._state, {isTagInflicted: true, isInflictedAddOnly: true, styleHint: this._meta.styleHint});

			this.renderOutput();
			this.doUiSave();
			this._meta.isModified = true;
		};
		const cb = MiscUtil.debounce(_cb, 33);
		this._cbCache = cb;
		return cb;
	}

	/** The input pane's tab strip. Returns the tabs in the order named. */
	_renderForkInputTabs ({wrp, names}) {
		this._resetTabs({tabGroup: "input"});

		const tabOptsShared = {hasBorder: true, hasBackground: true};
		const tabs = this._renderTabs(
			names.map(name => new TabUiUtil.TabMeta({...tabOptsShared, name})),
			{tabGroup: "input", cbTabChange: this.doUiSave.bind(this)},
		);
		veT`<div class="ve-flex-v-center ve-w-100 ve-no-shrink ve-ui-tab__wrp-tab-heads--border">${tabs.map(it => it.btnTab)}</div>`.vee.appendTo(wrp);
		tabs.forEach(it => it.wrpTab.vee.appendTo(wrp));
		return tabs;
	}

	/**
	 * The output pane: the entity as the site renders it, beside the JSON that will be saved. The
	 * second is what makes the first trustworthy — a person can see that what they filled in became
	 * a field rather than a sentence.
	 *
	 * @param name Tab name for the rendered view.
	 * @param fnRender Called with a copy of the state; returns the rendered markup.
	 */
	_renderForkOutput ({name, fnRender}) {
		const wrp = this._ui.wrpOutput.vee.empty();

		this._resetTabs({tabGroup: "output"});
		const tabs = this._renderTabs(
			[new TabUiUtil.TabMeta({name}), new TabUiUtil.TabMeta({name: "Data"})],
			{tabGroup: "output", cbTabChange: this.doUiSave.bind(this)},
		);
		const [entTab, dataTab] = tabs;
		veT`<div class="ve-flex-v-center ve-w-100 ve-no-shrink">${tabs.map(it => it.btnTab)}</div>`.vee.appendTo(wrp);
		tabs.forEach(it => it.wrpTab.vee.appendTo(wrp));

		// The renderers cache derived entries on the entity they are handed, so they get a copy
		const tbl = veT`<table class="ve-w-100 ve-stats"></table>`.vee.appendTo(entTab.wrpTab);
		tbl.vee.appends(fnRender(MiscUtil.copy(this._state)));

		const asCode = Renderer.get().render({
			type: "entries",
			entries: [
				{
					type: "code",
					name: `Data`,
					preformatted: JSON.stringify(DataUtil.cleanJson(MiscUtil.copy(this._state)), null, "\t"),
				},
			],
		});
		veT`<table class="ve-stats ve-stats--book mkbru__wrp-output-tab-data">
			${Renderer.utils.getBorderTr()}
			<tr><td colspan="6">${asCode}</td></tr>
			${Renderer.utils.getBorderTr()}
		</table>`
			.vee.appendTo(dataTab.wrpTab);
	}

	/**
	 * The page tells only the *active* builder when the brew source changes, and a builder is
	 * constructed before the page exists — so a builder first opened after the source was made has
	 * never been told what it is, and saving would refuse for want of one.
	 */
	_adoptUiSource () {
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
		if (!this._state.source && this._ui.source) this._state.source = this._ui.source;
	}

	/* -------------------------------------------- */

	/**
	 * A column of checkboxes with a live read-back, for wherever the data names a *set* of things
	 * — skills, abilities, damage types — rather than one.
	 *
	 * @return A getter for the ticked values, in the order given.
	 */
	static _getCheckboxes ({wrp, vals, fnDisplay, initial, onChange}) {
		const inputs = vals.map(val => {
			const cb = veT`<input class="mkbru__ipt-cb" type="checkbox">`
				.vee.prop("checked", (initial || []).includes(val))
				.vee.onn("change", () => onChange());
			veT`<label class="ve-flex-v-center ve-split stripe-odd--faint"><span>${fnDisplay ? fnDisplay(val) : val}</span>${cb}</label>`.vee.appendTo(wrp);
			return {cb, val};
		});
		return () => inputs.filter(it => it.cb.vee.prop("checked")).map(it => it.val);
	}

	static _getNumberIpt ({initial, placeholder, onChange}) {
		return veT`<input class="ve-form-control ve-input-xs form-control--minimal ve-mr-2" type="number" min="0" ${placeholder ? `placeholder="${placeholder}"` : ""}>`
			.vee.val(initial ?? null)
			.vee.onn("change", () => onChange());
	}

	static _getTextIpt ({initial, placeholder, onChange}) {
		return veT`<input class="ve-form-control ve-input-xs form-control--minimal ve-mr-2" ${placeholder ? `placeholder="${placeholder}"` : ""}>`
			.vee.val(initial || null)
			.vee.onn("change", () => onChange());
	}

	static _getIptNum (ipt) {
		const raw = `${ipt.vee.val() ?? ""}`.trim();
		if (!raw) return null;
		const num = Number(raw);
		return isNaN(num) ? null : num;
	}

	static _getIptStr (ipt) {
		return `${ipt.vee.val() ?? ""}`.trim() || null;
	}

	/** Copper, because that is the unit `{value}` is in; a bundle is quoted in gold. */
	static _CP_PER_GP = 100;

	/**
	 * Starting equipment: two bundles and a purse.
	 *
	 * The books state either one bundle everybody gets (`_`) or a choice between two (`A`/`B`,
	 * lowercased before 2024) — and the second option is nearly always "take the money instead",
	 * which is why the coin field stands beside each list rather than below. A background states this
	 * at its top level and a class states it under `startingEquipment.defaultData`, so where the
	 * groups live is the caller's business and the shape of them is not.
	 *
	 * @param label Row label.
	 * @param groups The existing group object, or null.
	 * @param isModern Whether to write `A`/`B` (2024) or `a`/`b`.
	 * @param fnSet Called with the next group object, or null when everything is empty.
	 * @param cb The builder's render callback.
	 */
	_getEquipmentGroupsInput ({label, groups, isModern, fnSet, cb}) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(label, {isMarked: true});

		const existing = groups || {};
		const keyA = existing.A ? "A" : (existing.a ? "a" : "_");
		const keyB = existing.B ? "B" : (existing.b ? "b" : null);

		const parseGroup = key => {
			const entries = (key ? existing[key] : null) || [];
			return {
				items: entries.filter(it => typeof it === "string" || it?.item || it?.special),
				valueCp: entries.find(it => it?.value != null)?.value ?? null,
			};
		};

		const options = [
			{label: "Option A", initial: parseGroup(keyA)},
			{label: "Option B", initial: parseGroup(keyB)},
		];

		const doUpdate = () => {
			const [a, b] = options.map(opt => {
				const out = [...opt.list.getValues()];
				const gp = this.constructor._getIptNum(opt.iptGp);
				if (gp != null && gp > 0) out.push({value: gp * this.constructor._CP_PER_GP});
				return out;
			});

			if (!a.length && !b.length) fnSet(null);
			else if (!b.length) fnSet({_: a});
			else {
				const [kA, kB] = isModern ? ["A", "B"] : ["a", "b"];
				fnSet({[kA]: a, [kB]: b});
			}
			cb();
		};

		options.forEach(opt => {
			veT`<div class="ve-bold ve-mb-1">${opt.label}</div>`.vee.appendTo(rowInner);

			opt.list = this.constructor._getRowList({
				wrp: rowInner,
				initial: opt.initial.items,
				onChange: doUpdate,
				fnGetRow: (initial, onChange) => this._getEquipmentRow(initial, onChange),
			});

			const wrpBtns = veT`<div class="ve-flex-v-center ve-mb-2"></div>`.vee.appendTo(rowInner);
			veT`<button class="ve-btn ve-btn-xs ve-btn-default ve-mr-2">Add Item...</button>`
				.vee.appendTo(wrpBtns)
				.vee.onn("click", async () => {
					const result = await SearchWidget.pGetUserItemSearch();
					if (!result) return;
					const item = await DataLoader.pCacheAndGet(result.page, result.source, result.hash);
					opt.list.add({item: `${item.name}|${item.source}`.toLowerCase()});
					doUpdate();
				});
			veT`<button class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Something with no item entry behind it — 'a set of vestments', 'a trophy from a fallen enemy'.">Add Anything</button>`
				.vee.appendTo(wrpBtns)
				.vee.onn("click", () => { opt.list.add({special: ""}); doUpdate(); });

			opt.iptGp = this.constructor._getNumberIpt({
				initial: opt.initial.valueCp == null ? null : opt.initial.valueCp / this.constructor._CP_PER_GP,
				placeholder: "Gold pieces",
				onChange: doUpdate,
			});
			veT`<div class="ve-flex-v-center ve-mb-3"><span class="ve-mr-2 ve-w-100p">Coin (gp)</span>${opt.iptGp}</div>`.vee.appendTo(rowInner);
		});

		return row;
	}

	/**
	 * One line of a bundle: a real item by uid, or a thing the books just name. Which it is was
	 * decided when the row was added, and stays decided — the two are different fields.
	 */
	_getEquipmentRow (initial, onChange) {
		const isSpecial = initial?.special != null;
		const initialText = isSpecial
			? initial.special
			: (typeof initial === "string" ? initial : initial?.item || "");

		const ipt = this.constructor._getTextIpt({
			initial: initialText,
			placeholder: isSpecial ? "Whatever it is, in words" : "name|source",
			onChange,
		});
		const iptQty = this.constructor._getNumberIpt({initial: initial?.quantity, placeholder: "Qty", onChange});
		iptQty.vee.addClass("ve-w-70p");

		const ele = veT`<div class="ve-flex-v-center ve-w-100 ve-mr-2">${ipt}${iptQty}</div>`;

		return {
			ele,
			getValue: () => {
				const text = this.constructor._getIptStr(ipt);
				if (!text) return null;

				const out = isSpecial ? {special: text} : {item: text.toLowerCase()};
				const qty = this.constructor._getIptNum(iptQty);
				if (qty != null && qty > 1) out.quantity = qty;
				return out;
			},
		};
	}

	/* -------------------------------------------- */

	/**
	 * A list of rows that can be added to and removed from, each row built by `fnGetRow`. Used
	 * wherever the data holds an open-ended list — equipment, dialects, features by name.
	 *
	 * `fnGetRow` is given the row's initial value and the update callback, and returns
	 * `{ele, getValue}`; a row whose `getValue` returns null is dropped from the result.
	 *
	 * @return A getter for the rows' values, plus `add` for a button to call.
	 */
	static _getRowList ({wrp, initial, fnGetRow, onChange}) {
		const rows = [];

		const wrpRows = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(wrp);

		const add = initialValue => {
			const wrpRow = veT`<div class="ve-flex-v-center ve-mb-2"></div>`.vee.appendTo(wrpRows);
			const {ele, getValue} = fnGetRow(initialValue, onChange);
			ele.vee.appendTo(wrpRow);

			const row = {getValue};
			veT`<button class="ve-btn ve-btn-xs ve-btn-danger" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>`
				.vee.appendTo(wrpRow)
				.vee.onn("click", () => {
					rows.splice(rows.indexOf(row), 1);
					wrpRow.vee.empty().remove();
					onChange();
				});

			rows.push(row);
		};

		(initial || []).forEach(it => add(it));

		return {
			getValues: () => rows.map(it => it.getValue()).filter(it => it != null),
			add,
		};
	}
}
