/**
 * Re-rendering a panel when the character changes.
 *
 * Every panel used to name the props it cared about, and the rule was that a panel watches every
 * prop it renders. That rule was broken four separate times — a lineage, a class-granted feat, a
 * size, an origin feat — each time producing the same bug: the panel shows yesterday's answer until
 * the page is reloaded. The list is invisible from the render code that depends on it, nothing
 * checks the two agree, and a new field is added to the render half far more often than to the hook
 * half. A convention that fails that reliably is not a convention worth keeping.
 *
 * So a panel watches the *whole* state instead, and the cost of over-rendering is bought off with a
 * frame's debounce: a burst of writes (applying a species touches a dozen props) collapses into one
 * render, and a render token already guards the async ones against landing out of order.
 *
 * Use `bindPanelRender` for the small panels — species, background, the build audit — whose render
 * is a few dozen elements. The big ones (the class panel, inventory, spells) keep their explicit
 * lists: their renders load entity data, so re-running one on every hit-point change is real work,
 * and their props are stable enough that the lists have not gone stale.
 */

/** Roughly one frame; long enough to collapse a burst, short enough to feel immediate. */
const _DEBOUNCE_MS = 16;

/**
 * Re-render `fnRender` whenever anything on the component's state changes.
 *
 * @param comp the `CharacterModel`.
 * @param fnRender called with no arguments; may be async.
 * @param [opts.propsImmediate] props to also render *synchronously*, for the rare case where a test
 *   or a caller reads the DOM in the same tick as the write.
 * @return the hook, so a caller can remove it.
 */
export function bindPanelRender (comp, fnRender, {propsImmediate = []} = {}) {
	let handle = null;

	const doRenderDebounced = () => {
		if (handle != null) return;
		handle = setTimeout(() => {
			handle = null;
			fnRender();
		}, _DEBOUNCE_MS);
	};

	propsImmediate.forEach(prop => comp._addHookBase(prop, () => fnRender()));

	const hook = comp._addHookAllBase(doRenderDebounced);
	fnRender();
	return hook;
}
