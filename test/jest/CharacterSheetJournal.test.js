import {describe, expect, it} from "@jest/globals";
import {
	ENCOUNTER_GAP_MS,
	EV_AMMO_FIRED,
	EV_AMMO_RECOVERED,
	EV_CONDITION,
	EV_DAMAGE,
	EV_DEATH_SAVE,
	EV_DOWN,
	EV_HEAL,
	EV_LEVEL,
	EV_REST,
	EV_SESSION,
	EV_SLOT,
	JOURNAL_MAX_EVENTS,
	SESSION_GAP_MS,
	appendJournalEvent,
	countEncounters,
	getJournal,
	getSessionStats,
	groupIntoSessions,
	summariseSession,
} from "../../js/charactersheet/charactersheet-journal.js";

const T0 = Date.parse("2026-08-02T19:00:00Z");
const min = n => n * 60 * 1000;
const hr = n => n * 60 * min(1);

/** An event at an offset from the session start. */
const ev = (k, offsetMs, extra = {}) => ({t: T0 + offsetMs, k, ...extra});

describe("Character Sheet — the session journal", () => {
	describe("appendJournalEvent", () => {
		it("Should append, stamping the time when none is given", () => {
			const out = appendJournalEvent([], {k: EV_DAMAGE, v: 7});
			expect(out).toHaveLength(1);
			expect(out[0].k).toBe(EV_DAMAGE);
			expect(out[0].v).toBe(7);
			expect(typeof out[0].t).toBe("number");
		});

		it("Should not mutate the log it was given", () => {
			const log = [];
			appendJournalEvent(log, {k: EV_DAMAGE, v: 1});
			expect(log).toHaveLength(0);
		});

		it("Should ignore an event with no kind", () => {
			expect(appendJournalEvent([], {v: 3})).toEqual([]);
			expect(appendJournalEvent([], null)).toEqual([]);
		});

		// The log lives in localStorage beside the character, so it cannot grow without bound
		it("Should drop the oldest once full, keeping the newest", () => {
			let log = [];
			for (let i = 0; i < 12; ++i) log = appendJournalEvent(log, {k: EV_DAMAGE, v: i, t: T0 + i}, {maxEvents: 10});
			expect(log).toHaveLength(10);
			expect(log[0].v).toBe(2);
			expect(log[9].v).toBe(11);
		});

		it("Should have a cap large enough to be worth having", () => {
			expect(JOURNAL_MAX_EVENTS).toBeGreaterThanOrEqual(500);
		});
	});

	describe("Session boundaries", () => {
		it("Should keep one evening's play in a single session", () => {
			const log = [ev(EV_DAMAGE, 0, {v: 5}), ev(EV_REST, min(40), {n: "short"}), ev(EV_DAMAGE, hr(2), {v: 9})];
			const sessions = groupIntoSessions(log);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].events).toHaveLength(3);
		});

		it("Should split on a long enough silence", () => {
			const log = [ev(EV_DAMAGE, 0, {v: 5}), ev(EV_DAMAGE, SESSION_GAP_MS + min(1), {v: 9})];
			expect(groupIntoSessions(log)).toHaveLength(2);
		});

		it("Should split where the player said to, however recently they played", () => {
			const log = [ev(EV_DAMAGE, 0, {v: 5}), ev(EV_SESSION, min(1)), ev(EV_DAMAGE, min(2), {v: 9})];
			const sessions = groupIntoSessions(log);
			expect(sessions).toHaveLength(2);
			// The marker is a boundary, not something that happened
			expect(sessions[0].events).toHaveLength(1);
			expect(sessions[1].events).toHaveLength(1);
		});

		it("Should not show a session that has been started but not played", () => {
			const log = [ev(EV_DAMAGE, 0, {v: 5}), ev(EV_SESSION, min(1))];
			expect(groupIntoSessions(log)).toHaveLength(1);
		});

		it("Should cope with events arriving out of order", () => {
			const log = [ev(EV_DAMAGE, hr(1), {v: 9}), ev(EV_DAMAGE, 0, {v: 5})];
			const [session] = groupIntoSessions(log);
			expect(session.startedAt).toBe(T0);
			expect(session.endedAt).toBe(T0 + hr(1));
		});

		it("Should be empty for an empty log", () => {
			expect(groupIntoSessions([])).toEqual([]);
			expect(groupIntoSessions(null)).toEqual([]);
		});
	});

	describe("countEncounters", () => {
		it("Should treat a burst of damage as one fight", () => {
			expect(countEncounters([ev(EV_DAMAGE, 0), ev(EV_DAMAGE, min(1)), ev(EV_DAMAGE, min(3))])).toBe(1);
		});

		it("Should start a new fight after a quiet spell", () => {
			expect(countEncounters([ev(EV_DAMAGE, 0), ev(EV_DAMAGE, ENCOUNTER_GAP_MS + min(1))])).toBe(2);
		});

		it("Should start a new fight after a rest, however soon the next hit lands", () => {
			const log = [ev(EV_DAMAGE, 0), ev(EV_REST, min(2), {n: "short"}), ev(EV_DAMAGE, min(4))];
			expect(countEncounters(log)).toBe(2);
		});

		it("Should count no fights when nothing hurt", () => {
			expect(countEncounters([ev(EV_REST, 0, {n: "long"})])).toBe(0);
		});
	});

	describe("getSessionStats", () => {
		it("Should total what happened", () => {
			const events = [
				ev(EV_DAMAGE, 0, {v: 12}), ev(EV_DAMAGE, min(1), {v: 9}),
				ev(EV_HEAL, min(2), {v: 7}),
				ev(EV_SLOT, min(3), {n: "1", v: 2}),
				ev(EV_REST, min(30), {n: "short"}),
				ev(EV_AMMO_FIRED, min(31), {n: "Arrows", v: 8}),
				ev(EV_AMMO_RECOVERED, min(32), {n: "Arrows", v: 4}),
			];
			const st = getSessionStats(events);
			expect(st.damage).toBe(21);
			expect(st.healing).toBe(7);
			expect(st.slots).toBe(2);
			expect(st.shortRests).toBe(1);
			expect(st.ammoFired).toBe(8);
			expect(st.ammoRecovered).toBe(4);
		});

		it("Should count a condition only when it was applied, not when it was cleared", () => {
			const events = [ev(EV_CONDITION, 0, {n: "Poisoned", v: 1}), ev(EV_CONDITION, min(5), {n: "Poisoned", v: 0})];
			expect(getSessionStats(events).conditions).toEqual(["Poisoned"]);
		});
	});

	describe("summariseSession", () => {
		it("Should write the session up the way the roadmap promised", () => {
			const events = [
				ev(EV_DAMAGE, 0, {v: 20}),
				ev(EV_DAMAGE, hr(1), {v: 15}),
				ev(EV_DAMAGE, hr(2), {v: 12}),
				ev(EV_DOWN, hr(2) + min(1)),
				ev(EV_SLOT, hr(2) + min(2), {n: "3", v: 6}),
				ev(EV_REST, hr(3), {n: "long"}),
				ev(EV_REST, hr(4), {n: "long"}),
				ev(EV_LEVEL, hr(4) + min(1), {v: 5}),
				ev(EV_AMMO_FIRED, hr(4) + min(2), {n: "Arrows", v: 23}),
				ev(EV_AMMO_RECOVERED, hr(4) + min(3), {n: "Arrows", v: 11}),
			];
			const {sentence} = summariseSession(events);
			expect(sentence).toContain("Took 47 damage across three fights");
			expect(sentence).toContain("went down once");
			expect(sentence).toContain("burned six slots");
			expect(sentence).toContain("two long rests");
			expect(sentence).toContain("gained a level");
			expect(sentence).toContain("fired 23 pieces of ammunition and recovered 11");
			expect(sentence.startsWith("Took")).toBe(true);
			expect(sentence.endsWith(".")).toBe(true);
		});

		it("Should mention only what happened", () => {
			const {sentence} = summariseSession([ev(EV_REST, 0, {n: "long"})]);
			expect(sentence).toBe("One long rest.");
			expect(sentence).not.toMatch(/damage/);
		});

		it("Should say so plainly when nothing happened", () => {
			expect(summariseSession([]).sentence).toBe("Nothing worth writing down.");
		});

		it("Should not claim fights when damage came in one burst", () => {
			const {sentence} = summariseSession([ev(EV_DAMAGE, 0, {v: 4}), ev(EV_DAMAGE, min(1), {v: 6})]);
			expect(sentence).toBe("Took 10 damage.");
		});

		it("Should count death saves that failed", () => {
			const events = [ev(EV_DEATH_SAVE, 0, {n: "fail"}), ev(EV_DEATH_SAVE, min(1), {n: "success"})];
			expect(summariseSession(events).sentence).toContain("Failed one death save");
		});
	});

	describe("getJournal", () => {
		it("Should number sessions in the order they happened but list the newest first", () => {
			const log = [
				ev(EV_DAMAGE, 0, {v: 5}),
				ev(EV_DAMAGE, SESSION_GAP_MS * 2, {v: 9}),
			];
			const out = getJournal(log);
			expect(out.map(it => it.number)).toEqual([2, 1]);
			expect(out[0].sentence).toBe("Took 9 damage.");
			expect(out[1].sentence).toBe("Took 5 damage.");
		});

		it("Should be empty for a character who has not played", () => {
			expect(getJournal([])).toEqual([]);
		});
	});
});
