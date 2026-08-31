import {getJournal} from "./charactersheet-journal.js";

/**
 * The session journal, newest session first: a written-up sentence per session, with the raw
 * numbers under it for anyone who wants them.
 *
 * Nothing here decides what a session *is* — that is `charactersheet-journal.js`, which is pure and
 * tested. This only draws the result.
 */
export class CharacterJournalPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
	}

	init () {
		if (!this._wrp) return;
		this._comp._addHookBase("journal", () => this.render());
		this._wrp.addEventListener("click", evt => {
			const btn = evt.target.closest("[data-cs-journal-act]");
			if (!btn) return;
			if (btn.dataset.csJournalAct === "new") this._comp.startJournalSession();
			else if (btn.dataset.csJournalAct === "clear") this._pClear();
		});
		this.render();
	}

	async _pClear () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Clear the journal",
			htmlDescription: "This erases every recorded session for this character. The character itself is untouched.",
			textYes: "Clear",
			textNo: "Cancel",
		})) return;
		this._comp.clearJournal();
	}

	render () {
		if (!this._wrp) return;
		const sessions = getJournal(this._comp._state.journal);

		const controls = `
			<div class="cs__journal-controls no-print">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-default" data-cs-journal-act="new" title="Start a new session here, rather than waiting for the gap to be noticed">New session</button>
				<button type="button" class="ve-btn ve-btn-xs ve-btn-danger" data-cs-journal-act="clear" title="Erase every recorded session">Clear</button>
			</div>`;

		if (!sessions.length) {
			this._wrp.innerHTML = `${controls}<div class="cs__journal-empty ve-muted">Nothing recorded yet. Damage, healing, rests, spent slots, conditions and ammunition are written down as they happen.</div>`;
			return;
		}

		this._wrp.innerHTML = controls + sessions.map(session => `
			<div class="cs__journal-session">
				<div class="cs__journal-head">
					<span class="cs__journal-num">Session ${session.number}</span>
					<span class="cs__journal-date">${CharacterJournalPanel._fmtWhen(session)}</span>
				</div>
				<div class="cs__journal-text">${session.sentence.qq()}</div>
			</div>
		`).join("");
	}

	/** A session is an evening: the date, and the times it ran between when they differ. */
	static _fmtWhen ({startedAt, endedAt}) {
		const start = new Date(startedAt);
		const date = start.toLocaleDateString(undefined, {day: "numeric", month: "short"});
		const hhmm = ts => new Date(ts).toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"});
		return endedAt - startedAt > 60000 ? `${date}, ${hhmm(startedAt)}–${hhmm(endedAt)}` : date;
	}
}
