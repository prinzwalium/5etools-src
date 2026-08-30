import {BuilderBase} from "./makebrew-builder-base.js";
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
