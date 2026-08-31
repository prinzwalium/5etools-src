import {ForkBuilderBase} from "./makebrew-forkbase.js";
import {BuilderUi} from "./makebrew-builderui.js";

/**
 * A builder for items.
 *
 * The deepest of the shallow kinds, and the one where writing prose costs the most: an equipped
 * magic item feeds *derivations* — armour class, saving throws, spell save DC, spell attack, weapon
 * attack and damage, resistances — and every one of those is read from a field. A *+1 Longsword*
 * whose bonus lives in its name is a longsword; the same item with `bonusWeapon: "+1"` is a +1
 * longsword everywhere on the sheet.
 *
 * The fields offered here are the ones the character sheet actually reads, rather than everything
 * `items.json` can hold. Loot tables, tiers and reference sources are for the item browser, and a
 * table inventing an item does not need them; charges and recharge, on the other hand, are what the
 * sheet's inventory rows track per click, so they are here.
 *
 * The type and property vocabularies are read from `data/items-base.json` at start-up rather than
 * curated, because they are per-edition and upstream adds to them.
 */

const _RECHARGES = Object.keys(Parser.ITEM_RECHARGE_TO_FULL);
const _DMG_TYPES = Object.keys(Parser.DMGTYPE_JSON_TO_FULL);
const _WEAPON_CATEGORIES = ["simple", "martial"];

/** Copper, because that is the unit `value` is in; a price is quoted in gold. */
const _CP_PER_GP = 100;

export class ItemBuilder extends ForkBuilderBase {
	constructor () {
		super({
			prop: "item",
		});

		this._itemTypes = [];
		this._itemProperties = [];

		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	/**
	 * The renderer needs the property and type look-ups populated before it can render an item at
	 * all, and the vocabularies are wanted for the pickers — so load the base items once, here.
	 */
	async _pInit () {
		await Renderer.item.pBuildList();

		const baseItemData = await DataUtil.loadJSON(`${Renderer.get().baseUrl}data/items-base.json`);

		const dedupe = (arr, fnGetName) => {
			const seen = new Set();
			return (arr || [])
				.map(it => ({
					// Always `ABBR|SOURCE`: the abbreviations are cased, and a uid without a source
					// silently means PHB, which is wrong for every DMG type
					uid: DataUtil.itemType.getUid(it, {isMaintainCase: true, isRetainDefault: true}),
					display: `${fnGetName(it)} (${Parser.sourceJsonToAbv(it.source)})`,
				}))
				.filter(it => it.uid && !seen.has(it.uid) && seen.add(it.uid))
				.sort((a, b) => SortUtil.ascSortLower(a.display, b.display));
		};

		this._itemTypes = dedupe(baseItemData.itemType, it => it.name || it.abbreviation);
		this._itemProperties = dedupe(baseItemData.itemProperty, it => it.entries?.[0]?.name || it.abbreviation);
	}

	async pHandleClickLoadExisting () {
		const result = await SearchWidget.pGetUserItemSearch();
		if (!result) return;
		const item = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(item);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			name: "New Item",
			rarity: "none",
			entries: [],
			source: this._ui ? this._ui.source : "",
		};
	}

	/* -------------------------------------------- */

	_renderInputMain () {
		this._adoptUiSource();

		const wrp = this._ui.wrpInput.vee.empty();
		const cb = this._getRenderCallback();
		const [infoTab, weaponTab, magicTab, textTab] = this._renderForkInputTabs({wrp, names: ["Info", "Weapon & Armor", "Magic", "Text"]});

		// ---------- INFO ----------
		BuilderUi.getStateIptString("Name", cb, this._state, {nullable: false}, "name").vee.appendTo(infoTab.wrpTab);
		this._selSource = this.getSourceInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptString("Page", cb, this._state, {type: "number"}, "page").vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptEnum(
			"Type",
			cb,
			this._state,
			{
				vals: this._itemTypes.map(it => it.uid),
				fnDisplay: uid => this._itemTypes.find(it => it.uid === uid)?.display || uid,
				nullable: true,
			},
			"type",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptEnum(
			"Rarity",
			cb,
			this._state,
			{vals: Parser.ITEM_RARITIES, fnDisplay: it => it.toTitleCase(), nullable: false},
			"rarity",
		).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptBoolean(
			"Wondrous Item",
			cb,
			this._state,
			{},
			"wondrous",
		).vee.appendTo(infoTab.wrpTab);
		this._getAttunementInput(cb).vee.appendTo(infoTab.wrpTab);
		BuilderUi.getStateIptNumber("Weight (lb)", cb, this._state, {}, "weight").vee.appendTo(infoTab.wrpTab);
		this._getValueInput(cb).vee.appendTo(infoTab.wrpTab);
		this._getBaseItemInput(cb).vee.appendTo(infoTab.wrpTab);

		// ---------- WEAPON & ARMOR ----------
		this._getWeaponInput(cb).vee.appendTo(weaponTab.wrpTab);
		this._getArmorInput(cb).vee.appendTo(weaponTab.wrpTab);

		// ---------- MAGIC ----------
		this._getBonusesInput(cb).vee.appendTo(magicTab.wrpTab);
		this._getChargesInput(cb).vee.appendTo(magicTab.wrpTab);
		this._getDefencesInput(cb).vee.appendTo(magicTab.wrpTab);

		// ---------- TEXT ----------
		BuilderUi.getStateIptEntries(
			"Text",
			cb,
			this._state,
			{placeholder: "What the item does. Anything stated as a field above is already read by the sheet; the books restate it here anyway."},
			"entries",
		).vee.appendTo(textTab.wrpTab);
	}

	/* -------------------------------------------- */

	/** `true`, or a phrase naming who may attune — "by a druid", "by a creature of good alignment". */
	_getAttunementInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Attunement",
			{isMarked: true, title: "Leave the phrase empty for plain attunement; fill it in to restrict who may attune."},
		);

		const existing = this._state.reqAttune;

		const doUpdate = () => {
			if (!cbReq.vee.prop("checked")) {
				this._setOrDelete("reqAttune", null);
				ipt.vee.prop("disabled", true);
			} else {
				ipt.vee.prop("disabled", false);
				this._setOrDelete("reqAttune", this.constructor._getIptStr(ipt) || true);
			}
			cb();
		};

		const cbReq = veT`<input class="mkbru__ipt-cb ve-mr-2" type="checkbox">`
			.vee.prop("checked", !!existing)
			.vee.onn("change", () => doUpdate());
		const ipt = this.constructor._getTextIpt({
			initial: typeof existing === "string" ? existing : null,
			placeholder: "e.g. by a druid",
			onChange: doUpdate,
		});

		veT`<div class="ve-flex-v-center"><label class="ve-flex-v-center ve-mb-0 ve-mr-2 ve-no-wrap">${cbReq}<span>Requires attunement</span></label>${ipt}</div>`.vee.appendTo(rowInner);

		ipt.vee.prop("disabled", !existing);

		return row;
	}

	/* -------------------------------------------- */

	/** Stored in copper, quoted in gold — the same split a background's starting purse uses. */
	_getValueInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Value", {isMarked: true});

		const doUpdate = () => {
			const gp = this.constructor._getIptNum(ipt);
			this._setOrDelete("value", gp != null && gp > 0 ? Math.round(gp * _CP_PER_GP) : null);
			cb();
		};

		const ipt = this.constructor._getNumberIpt({
			initial: this._state.value == null ? null : this._state.value / _CP_PER_GP,
			placeholder: "Gold pieces",
			onChange: doUpdate,
		});
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-100p">Price (gp)</span>${ipt}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * What a magic variant is a variant *of*. The sheet reads the base item for everything the
	 * variant does not restate — damage dice, properties, weight — so a *+1 Longsword* with no base
	 * item is a wondrous object that happens to be called a longsword.
	 */
	_getBaseItemInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Base Item",
			{isMarked: true, title: "For a magic variant of an ordinary item. Everything this item does not restate is taken from it."},
		);

		const doUpdate = () => {
			this._setOrDelete("baseItem", this.constructor._getIptStr(ipt));
			cb();
		};

		const ipt = this.constructor._getTextIpt({initial: this._state.baseItem, placeholder: "name|source", onChange: doUpdate});

		veT`<div class="ve-flex-v-center ve-w-100">${ipt}</div>`.vee.appendTo(rowInner);
		veT`<button class="ve-btn ve-btn-xs ve-btn-default">Choose Item...</button>`
			.vee.appendTo(rowInner)
			.vee.onn("click", async () => {
				const result = await SearchWidget.pGetUserBasicItemSearch();
				if (!result) return;
				const base = await DataLoader.pCacheAndGet(result.page, result.source, result.hash);
				ipt.vee.val(`${base.name}|${base.source}`);
				doUpdate();
			});

		return row;
	}

	/* -------------------------------------------- */

	_getWeaponInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Weapon", {isMarked: true});

		const doUpdate = () => {
			const dmg1 = this.constructor._getIptStr(iptDmg1);
			const isWeapon = !!dmg1;

			// `weapon` is what marks it as one; without it the sheet will not offer it as an attack
			this._setOrDelete("weapon", isWeapon || null);
			this._setOrDelete("dmg1", dmg1);
			this._setOrDelete("dmg2", this.constructor._getIptStr(iptDmg2));
			this._setOrDelete("range", this.constructor._getIptStr(iptRange));

			const dmgType = selDmgType.vee.val();
			this._setOrDelete("dmgType", dmgType === "-1" ? null : _DMG_TYPES[Number(dmgType)]);

			const cat = selCategory.vee.val();
			this._setOrDelete("weaponCategory", cat === "-1" ? null : _WEAPON_CATEGORIES[Number(cat)]);

			const props = getProps();
			this._setOrDelete("property", props.length ? props : null);

			cb();
		};

		const mkSel = (vals, fnDisplay, initial) => {
			const sel = veT`<select class="ve-form-control ve-input-xs form-control--minimal ve-mr-2"><option value="-1">(None)</option></select>`;
			vals.forEach((v, i) => sel.vee.appends(`<option value="${i}">${fnDisplay(v).qq()}</option>`));
			sel.vee.val(`${vals.indexOf(initial)}`).vee.onn("change", () => doUpdate());
			return sel;
		};

		const iptDmg1 = this.constructor._getTextIpt({initial: this._state.dmg1, placeholder: "e.g. 1d8", onChange: doUpdate});
		const iptDmg2 = this.constructor._getTextIpt({initial: this._state.dmg2, placeholder: "Versatile, e.g. 1d10", onChange: doUpdate});
		const selDmgType = mkSel(_DMG_TYPES, it => Parser.dmgTypeToFull(it).toTitleCase(), this._state.dmgType);
		const selCategory = mkSel(_WEAPON_CATEGORIES, it => it.toTitleCase(), this._state.weaponCategory);
		const iptRange = this.constructor._getTextIpt({initial: this._state.range, placeholder: "e.g. 20/60", onChange: doUpdate});

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Damage</span>${iptDmg1}${selDmgType}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Two-handed</span>${iptDmg2}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Category</span>${selCategory}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-100p">Range</span>${iptRange}</div>`.vee.appendTo(rowInner);

		veT`<div class="ve-bold ve-mb-1">Properties</div>`.vee.appendTo(rowInner);
		const wrpProps = veT`<div class="ve-flex-col ve-w-100"></div>`.vee.appendTo(rowInner);
		const getProps = this.constructor._getCheckboxes({
			wrp: wrpProps,
			vals: this._itemProperties.map(it => it.uid),
			fnDisplay: uid => this._itemProperties.find(it => it.uid === uid)?.display || uid,
			initial: this._state.property || [],
			onChange: doUpdate,
		});

		return row;
	}

	/* -------------------------------------------- */

	_getArmorInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Armor", {isMarked: true});

		const doUpdate = () => {
			const ac = this.constructor._getIptNum(iptAc);
			this._setOrDelete("ac", ac);
			// As with `weapon`, `armor` is the flag the sheet's armour-class modes look for
			this._setOrDelete("armor", ac != null || null);
			this._setOrDelete("stealth", cbStealth.vee.prop("checked") || null);

			const str = this.constructor._getIptNum(iptStrength);
			// A string, oddly, and the data is consistent about it
			this._setOrDelete("strength", str != null && str > 0 ? `${str}` : null);
			cb();
		};

		const iptAc = this.constructor._getNumberIpt({initial: this._state.ac, placeholder: "Base AC", onChange: doUpdate});
		const cbStealth = veT`<input class="mkbru__ipt-cb" type="checkbox">`
			.vee.prop("checked", !!this._state.stealth)
			.vee.onn("change", () => doUpdate());
		const iptStrength = this.constructor._getNumberIpt({
			initial: this._state.strength == null ? null : Number(this._state.strength),
			placeholder: "Minimum score",
			onChange: doUpdate,
		});

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Armor Class</span>${iptAc}</div>`.vee.appendTo(rowInner);
		veT`<label class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Stealth disadvantage</span>${cbStealth}</label>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-200p">Strength requirement</span>${iptStrength}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/**
	 * The bonuses, which are the whole reason to write an item as data. Each is a signed string —
	 * "+1" — because the data stores it that way and the sheet parses it as one.
	 */
	_getBonusesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple(
			"Magic Bonuses",
			{isMarked: true, title: "What this item adds while equipped or attuned. Written here, they reach the armour class, the attack rolls and the spell save DC on their own."},
		);

		const specs = [
			{label: "Weapon attack & damage", prop: "bonusWeapon"},
			{label: "Weapon attack only", prop: "bonusWeaponAttack"},
			{label: "Armor Class", prop: "bonusAc"},
			{label: "Saving throws", prop: "bonusSavingThrow"},
			{label: "Spell attack", prop: "bonusSpellAttack"},
			{label: "Spell save DC", prop: "bonusSpellSaveDc"},
		];

		const ipts = [];
		const doUpdate = () => {
			ipts.forEach(({spec, ipt}) => {
				const raw = this.constructor._getIptStr(ipt);
				// A bare number is a bonus too; the data always signs it, so sign it for them
				const val = raw && /^\d/.test(raw) ? `+${raw}` : raw;
				this._setOrDelete(spec.prop, val);
				if (val !== raw) ipt.vee.val(val);
			});
			cb();
		};

		specs.forEach(spec => {
			const ipt = this.constructor._getTextIpt({initial: this._state[spec.prop], placeholder: "e.g. +1", onChange: doUpdate});
			veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">${spec.label}</span>${ipt}</div>`.vee.appendTo(rowInner);
			ipts.push({spec, ipt});
		});

		return row;
	}

	/* -------------------------------------------- */

	/** What the sheet's inventory rows spend per click, and what a rest gives back. */
	_getChargesInput (cb) {
		const [row, rowInner] = BuilderUi.getLabelledRowTuple("Charges", {isMarked: true});

		const doUpdate = () => {
			const charges = this.constructor._getIptNum(iptCharges);
			this._setOrDelete("charges", charges != null && charges > 0 ? charges : null);

			const ixRecharge = Number(selRecharge.vee.val());
			this._setOrDelete("recharge", ~ixRecharge ? _RECHARGES[ixRecharge] : null);

			this._setOrDelete("rechargeAmount", this.constructor._getIptStr(iptAmount));
			cb();
		};

		const iptCharges = this.constructor._getNumberIpt({initial: this._state.charges, placeholder: "How many", onChange: doUpdate});

		const selRecharge = veT`<select class="ve-form-control ve-input-xs form-control--minimal"><option value="-1">(Never)</option></select>`;
		_RECHARGES.forEach((v, i) => selRecharge.vee.appends(`<option value="${i}">${Parser.itemRechargeToFull(v).qq()}</option>`));
		selRecharge.vee.val(`${_RECHARGES.indexOf(this._state.recharge)}`).vee.onn("change", () => doUpdate());

		const iptAmount = this.constructor._getTextIpt({
			initial: this._state.rechargeAmount,
			placeholder: "All of them, or e.g. 1d6+4",
			onChange: doUpdate,
		});

		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Maximum charges</span>${iptCharges}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2 ve-w-200p">Regains</span>${selRecharge}</div>`.vee.appendTo(rowInner);
		veT`<div class="ve-flex-v-center"><span class="ve-mr-2 ve-w-200p">Regains how many</span>${iptAmount}</div>`.vee.appendTo(rowInner);

		return row;
	}

	/* -------------------------------------------- */

	/** Derived from what is *equipped*, never stored on the character — so the item must say it. */
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
			name: "Item",
			fnRender: cpy => {
				// The renderer reads properties the loader normally computes, so compute them here
				try {
					Renderer.item.enhanceItem(cpy);
				} catch (e) {
					// A half-built item can name a base item that does not resolve yet; the Data tab
					// still shows what is there, which is what the author needs to see
				}
				return Renderer.item.getCompactRenderedString(cpy);
			},
		});
	}
}
