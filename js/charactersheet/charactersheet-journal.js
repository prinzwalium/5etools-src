/**
 * The session journal.
 *
 * The sheet already sees everything worth remembering — every hit point lost, death save, rest,
 * spent slot, condition and arrow — and until now threw all of it away. This keeps it, groups it
 * into sessions, and writes the session up afterwards:
 *
 *   "Took 47 damage across three fights, went down once, burned six slots, two long rests,
 *    gained a level, fired 23 arrows and recovered 11."
 *
 * Pure and DOM-free. Events are recorded by the model as they happen; everything here is a function
 * of the log.
 *
 * Events are deliberately terse — `{t, k, v, n}` — because they live in `localStorage` alongside the
 * character and a chatty shape would cost more than the feature is worth.
 */

/** Kinds of event. Short strings: these are written thousands of times. */
export const EV_DAMAGE = "dmg";
export const EV_HEAL = "heal";
export const EV_DOWN = "down";
export const EV_DEATH_SAVE = "death";
export const EV_REST = "rest";
export const EV_SLOT = "slot";
export const EV_RESOURCE = "res";
export const EV_CONDITION = "cond";
export const EV_CHARGE = "charge";
export const EV_AMMO_FIRED = "ammo";
export const EV_AMMO_RECOVERED = "ammoRec";
export const EV_LEVEL = "level";
export const EV_SESSION = "session";

/** A character is played for an evening, then put down. A gap this long starts a new session. */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

/** Damage lands in bursts. A quiet spell this long means the last fight ended. */
export const ENCOUNTER_GAP_MS = 20 * 60 * 1000;

/** Enough for many sessions of play; past this the oldest go, so the store cannot grow forever. */
export const JOURNAL_MAX_EVENTS = 1000;

/**
 * Add an event, dropping the oldest once the log is full. Returns a new array — the model swaps it
 * in, so the usual change detection applies.
 */
export function appendJournalEvent (log, event, {maxEvents = JOURNAL_MAX_EVENTS} = {}) {
	if (!event?.k) return log || [];
	const next = [...(log || []), {t: event.t ?? Date.now(), ...event}];
	return next.length > maxEvents ? next.slice(next.length - maxEvents) : next;
}

/**
 * Split the log into sessions: on an explicit marker (the player pressed *New session*), or on a
 * long enough silence. Explicit wins, because a player who says a session ended knows better than
 * a clock does.
 */
export function groupIntoSessions (log, {gapMs = SESSION_GAP_MS} = {}) {
	const events = (log || []).filter(it => it?.k).sort((a, b) => (a.t || 0) - (b.t || 0));
	const sessions = [];
	let cur = null;

	events.forEach(ev => {
		const isBreak = ev.k === EV_SESSION
			|| !cur
			|| (ev.t - cur.endedAt) > gapMs;
		if (isBreak) {
			cur = {startedAt: ev.t, endedAt: ev.t, events: []};
			sessions.push(cur);
		}
		// The marker itself is a boundary, not something that happened
		if (ev.k === EV_SESSION) return;
		cur.events.push(ev);
		cur.endedAt = ev.t;
	});

	// A marker with nothing after it is a session that has not started yet
	return sessions.filter(it => it.events.length);
}

const _sum = (events, kind) => events.filter(it => it.k === kind).reduce((acc, it) => acc + (Number(it.v) || 1), 0);
const _count = (events, kind, pred = null) => events.filter(it => it.k === kind && (!pred || pred(it))).length;

/**
 * How many separate fights the damage fell into: a burst of damage, then quiet (or a rest), then
 * another burst. Approximate by design — the sheet is not told when initiative is rolled.
 */
export function countEncounters (events) {
	const hits = events.filter(it => it.k === EV_DAMAGE);
	if (!hits.length) return 0;
	const rests = events.filter(it => it.k === EV_REST).map(it => it.t);
	let n = 1;
	for (let i = 1; i < hits.length; ++i) {
		const gap = hits[i].t - hits[i - 1].t;
		const isRestBetween = rests.some(t => t > hits[i - 1].t && t < hits[i].t);
		if (gap > ENCOUNTER_GAP_MS || isRestBetween) ++n;
	}
	return n;
}

/** The numbers behind a session, before any of it is turned into a sentence. */
export function getSessionStats (events) {
	const evs = events || [];
	return {
		damage: _sum(evs, EV_DAMAGE),
		healing: _sum(evs, EV_HEAL),
		encounters: countEncounters(evs),
		timesDown: _count(evs, EV_DOWN),
		deathSaveFails: _count(evs, EV_DEATH_SAVE, it => it.n === "fail"),
		slots: _sum(evs, EV_SLOT),
		shortRests: _count(evs, EV_REST, it => it.n === "short"),
		longRests: _count(evs, EV_REST, it => it.n === "long"),
		levelsGained: _count(evs, EV_LEVEL),
		ammoFired: _sum(evs, EV_AMMO_FIRED),
		ammoRecovered: _sum(evs, EV_AMMO_RECOVERED),
		charges: _sum(evs, EV_CHARGE),
		conditions: [...new Set(evs.filter(it => it.k === EV_CONDITION && it.v).map(it => it.n))],
		resources: _sum(evs, EV_RESOURCE),
	};
}

const _WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** Small counts read better as words; large ones as numerals. */
function _n (count, singular, plural = `${singular}s`) {
	const word = count <= 10 ? _WORDS[count] : `${count}`;
	return `${word} ${count === 1 ? singular : plural}`;
}

const _times = count => count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;

/**
 * The session in a sentence. Only what actually happened is mentioned — a session with no damage
 * does not report taking none.
 */
export function summariseSession (events) {
	const st = getSessionStats(events);
	const parts = [];

	if (st.damage) {
		const where = st.encounters > 1 ? ` across ${_n(st.encounters, "fight")}` : "";
		parts.push(`took ${st.damage} damage${where}`);
	}
	if (st.healing) parts.push(`healed ${st.healing}`);
	if (st.timesDown) parts.push(`went down ${_times(st.timesDown)}`);
	if (st.deathSaveFails) parts.push(`failed ${_n(st.deathSaveFails, "death save")}`);
	if (st.slots) parts.push(`burned ${_n(st.slots, "slot")}`);
	if (st.resources) parts.push(`spent ${_n(st.resources, "class resource")}`);
	if (st.charges) parts.push(`used ${_n(st.charges, "charge")}`);
	if (st.shortRests) parts.push(`${_n(st.shortRests, "short rest")}`);
	if (st.longRests) parts.push(`${_n(st.longRests, "long rest")}`);
	if (st.levelsGained) parts.push(st.levelsGained === 1 ? "gained a level" : `gained ${_n(st.levelsGained, "level")}`);
	if (st.ammoFired) {
		const back = st.ammoRecovered ? ` and recovered ${st.ammoRecovered}` : "";
		parts.push(`fired ${_n(st.ammoFired, "piece", "pieces")} of ammunition${back}`);
	}
	if (st.conditions.length) parts.push(`was ${st.conditions.join(", ").toLowerCase()}`);

	if (!parts.length) return {stats: st, sentence: "Nothing worth writing down."};

	const sentence = parts.length === 1
		? parts[0]
		: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
	return {stats: st, sentence: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`};
}

/** Every session, newest first, each already written up. */
export function getJournal (log, {gapMs = SESSION_GAP_MS} = {}) {
	return groupIntoSessions(log, {gapMs})
		.map((session, ix) => ({...session, number: ix + 1, ...summariseSession(session.events)}))
		.reverse();
}
