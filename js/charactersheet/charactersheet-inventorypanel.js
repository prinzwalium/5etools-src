import {getEncumbrance, getWeaponAttack} from "./charactersheet-derive.js";
import {getAmmoRecovered, getInventoryItemMeta, getRechargeRest} from "./charactersheet-equipment.js";
import {getEntityDefenses} from "./charactersheet-defenses.js";
import {pGetUserItemSearchFiltered} from "./charactersheet-sources.js";

// Anything whose effect depends on being worn or held: armor and weapons, the items that carry a
// bonus, the ring or cloak whose whole point is the resistance it grants while worn, and the wand
// whose charges are only usable with it in hand
const _isEquippable = it => it.isArmor || it.isWeapon
	|| it.bonusAc != null || it.bonusSavingThrow != null || it.bonusSpellSaveDc != null || it.bonusSpellAttack != null
	|| ["LA", "MA", "HA", "S", "M", "R"].includes(it.type)
	|| !!it.chargesMax
	|| !!getEntityDefenses(it).length;
const _isWeapon = it => it.isWeapon || ["M", "R"].includes(it.type);

class _InventoryRenderableCollection extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "inventory");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const tr = document.createElement("tr");
		tr.innerHTML = `
			<td class="cs__inv-name"></td>
			<td class="ve-text-center no-print cs__inv-flags" style="width: 96px;"></td>
			<td class="ve-text-center" style="width: 54px;"><input type="number" min="0" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__inv-qty"></td>
			<td class="ve-text-right ve-muted ve-small cs__inv-weight" style="width: 66px;"></td>
			<td class="ve-text-center no-print" style="width: 30px;">
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-danger cs__inv-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		const meta = {
			wrpRow: tr,
			dispName: tr.querySelector(".cs__inv-name"),
			wrpFlags: tr.querySelector(".cs__inv-flags"),
			iptQty: tr.querySelector(".cs__inv-qty"),
			dispWeight: tr.querySelector(".cs__inv-weight"),
		};

		meta.iptQty.addEventListener("change", () => this._comp.updateInventoryItem(entity.id, {quantity: Math.max(0, Number(meta.iptQty.value) || 0)}));
		tr.querySelector(".cs__inv-rm").addEventListener("click", () => this._comp.removeInventoryItem(entity.id));

		this._wrpRows.appendChild(tr);
		this.doUpdateExistingRender(meta, entity);
		return meta;
	}

	doUpdateExistingRender (meta, entity) {
		meta.dispName.innerHTML = Renderer.get().render(`{@item ${entity.name}${entity.source?.toLowerCase() !== "phb" ? `|${entity.source}` : ""}}`);
		if (document.activeElement !== meta.iptQty) meta.iptQty.value = `${entity.quantity ?? 1}`;
		const weight = (Number(entity.weightLb) || 0) * (Number(entity.quantity) || 0);
		meta.dispWeight.textContent = entity.weightLb != null ? `${Math.round(weight * 100) / 100} lb.` : "—";

		meta.wrpFlags.innerHTML = "";
		if (_isEquippable(entity)) meta.wrpFlags.appendChild(this._getFlagToggle(entity, "equipped", "Equip", "Equipped"));
		if (entity.requiresAttunement) meta.wrpFlags.appendChild(this._getFlagToggle(entity, "attuned", "Attune", "Attuned"));
		if (_isWeapon(entity)) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1 cs__inv-wield";
			btn.title = "Add this weapon to your attacks";
			btn.textContent = "Wield";
			btn.addEventListener("click", () => this._comp.addAttack(getWeaponAttack(this._comp._getState(), entity)));
			meta.wrpFlags.appendChild(btn);
		}

		if (entity.chargesMax) meta.wrpFlags.appendChild(this._getChargesControl(entity));
		if (entity.isAmmo) meta.wrpFlags.appendChild(this._getAmmoControl(entity));
	}

	/** "3/7 charges", spent and restored a click at a time; a rest gives back what the item says. */
	_getChargesControl (entity) {
		const used = Math.max(0, Number(entity.chargesUsed) || 0);
		const left = Math.max(0, entity.chargesMax - used);

		const wrp = document.createElement("span");
		wrp.className = "cs__inv-charges ve-flex-v-center";

		const restKind = getRechargeRest(entity.recharge);
		const ptRegain = entity.rechargeAmount != null ? Renderer.stripTags(`${entity.rechargeAmount}`) : "all";
		wrp.title = restKind
			? `Regains ${ptRegain} charges on a ${restKind} rest (${entity.recharge})`
			: `${entity.recharge === "special" ? "The item's own text says how these come back" : "No stated recharge"}`;

		const mkBtn = (label, delta, hint) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
			btn.textContent = label;
			btn.title = hint;
			btn.addEventListener("click", () => this._comp.adjustCharges(entity.id, delta));
			return btn;
		};

		const disp = document.createElement("span");
		disp.className = "cs__inv-charges-val";
		disp.textContent = `${left}/${entity.chargesMax}`;

		wrp.append(mkBtn("−", -1, "Spend a charge"), disp, mkBtn("+", 1, "Give a charge back"));
		return wrp;
	}

	/** Ammunition: one off the quiver per shot, and the battlefield search that gets half of it back. */
	_getAmmoControl (entity) {
		const spent = Math.max(0, Number(entity.ammoSpent) || 0);

		const wrp = document.createElement("span");
		wrp.className = "cs__inv-ammo ve-flex-v-center";

		const btnFire = document.createElement("button");
		btnFire.type = "button";
		btnFire.className = "ve-btn ve-btn-xxs ve-btn-default no-print cs__inv-fire";
		btnFire.textContent = "Fire";
		btnFire.title = "Spend one";
		btnFire.disabled = !(Number(entity.quantity) || 0);
		btnFire.addEventListener("click", () => this._comp.spendAmmo(entity.id));
		wrp.appendChild(btnFire);

		if (spent) {
			const btnRecover = document.createElement("button");
			btnRecover.type = "button";
			btnRecover.className = "ve-btn ve-btn-xxs ve-btn-default no-print cs__inv-recover";
			btnRecover.textContent = `Recover ${getAmmoRecovered(spent)}`;
			btnRecover.title = `${spent} spent — a minute searching the battlefield recovers half of them`;
			btnRecover.addEventListener("click", () => this._comp.recoverAmmo(entity.id));
			wrp.appendChild(btnRecover);
		}

		return wrp;
	}

	_getFlagToggle (entity, prop, labelOff, labelOn) {
		const lbl = document.createElement("label");
		lbl.className = "ve-flex-v-center ve-mr-1 ve-small";
		lbl.title = entity[prop] ? labelOn : labelOff;
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.className = "ve-mr-1";
		cb.checked = !!entity[prop];
		cb.addEventListener("change", () => this._comp.updateInventoryItem(entity.id, {[prop]: cb.checked}));
		const spn = document.createElement("span");
		spn.className = "ve-muted";
		spn.textContent = labelOff;
		lbl.append(cb, spn);
		return lbl;
	}

	doDeleteExistingRender (meta) {
		meta.wrpRow.remove();
	}
}

/** The tracked inventory: item rows with quantity and weight, plus encumbrance totals. */
export class CharacterInventoryPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._collection = null;
		this._dispTotals = null;
	}

	init () {
		this._wrp.innerHTML = `
			<div class="ve-flex-v-center ve-mb-1">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-default no-print" id="cs-inv-add"><span class="glyphicon glyphicon-search"></span> Add Item</button>
				<span class="ve-muted ve-small ve-ml-auto" id="cs-inv-totals"></span>
			</div>
			<table class="w-100 cs__inv-table"><tbody id="cs-inv-body"></tbody></table>
		`;
		this._dispTotals = this._wrp.querySelector("#cs-inv-totals");
		this._wrp.querySelector("#cs-inv-add").addEventListener("click", () => this._pOnAddItem());

		this._collection = new _InventoryRenderableCollection(this._comp, this._wrp.querySelector("#cs-inv-body"));
		this._comp._addHookBase("inventory", () => {
			this._collection.render();
			this._renderTotals();
		});
		this._comp._addHookBase("abil_str", () => this._renderTotals());

		this._collection.render();
		this._renderTotals();
	}

	_renderTotals () {
		const {totalWeightLb, capacityLb, isPowerfulBuild} = getEncumbrance(this._comp._getState());
		if (!this._comp._state.inventory.length) {
			this._dispTotals.textContent = "";
			return;
		}
		const isOver = totalWeightLb > capacityLb;
		// A doubled capacity looks like a bug unless it says what doubled it
		const ptWhy = isPowerfulBuild ? ` <span class="ve-muted" title="Powerful Build counts you as one size larger for carrying capacity">(Powerful Build)</span>` : "";
		const titleCap = `Strength × 15${isPowerfulBuild ? ", doubled by Powerful Build" : ""}`;
		this._dispTotals.innerHTML = `${totalWeightLb} / ${capacityLb} lb.${ptWhy}${isOver ? ` <span class="ve-text-danger" title="Over carrying capacity (${titleCap})">(encumbered)</span>` : ""}`;
	}

	async _pOnAddItem () {
		const doc = await pGetUserItemSearchFiltered(this._comp._getState());
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.addInventoryItem({
			name: doc.n,
			source: doc.source,
			quantity: 1,
			weightLb: ent?.weight ?? null,
			...getInventoryItemMeta(ent),
		});
	}
}
