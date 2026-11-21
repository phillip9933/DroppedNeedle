type Vertical = { up?: () => void; down?: () => void };
/** Leave sliders, scrollable content and interactive controls to their native gestures. */
export function playerGestures(node: HTMLElement, actions: Vertical | undefined) {
	let start: Touch | undefined;
	let edgeOnly = false;
	const cleanup = new AbortController();
	const passive = { passive: true, signal: cleanup.signal };
	const active = { passive: false, signal: cleanup.signal };
	const reset = () => {
		start = undefined;
		edgeOnly = false;
	};
	node.addEventListener(
		'touchstart',
		(e) => {
			reset();
			if (
				!actions ||
				e.touches.length !== 1 ||
				!(e.target instanceof Element) ||
				e.target.closest(
					'input,select,textarea,dialog,[data-inline-choice],[data-layout-drag],[data-reorder-grip]'
				)
			)
				return;
			const scroller = e.target.closest<HTMLElement>('[data-gesture-scroll]');
			if (scroller) {
				if (!scroller.hasAttribute('data-pull-dismiss') || scroller.scrollTop > 1) return;
				edgeOnly = true;
			} else if (e.target.closest('button,a,summary')) return;
			start = e.touches[0];
		},
		passive
	);
	function delta(t: Touch) {
		if (!start || t.identifier !== start.identifier) return 0;
		const x = Math.abs(t.clientX - start.clientX),
			y = t.clientY - start.clientY;
		if (x > 10 && x > Math.abs(y) * 0.85) {
			reset();
			return 0;
		}
		if (edgeOnly && y < -6) reset();
		return start ? y : 0;
	}
	node.addEventListener(
		'touchmove',
		(e) => {
			if (e.touches.length !== 1) return reset();
			const y = delta(e.touches[0]);
			if (Math.abs(y) > 12 && (y > 0 ? actions?.down : actions?.up) && e.cancelable)
				e.preventDefault();
		},
		active
	);
	node.addEventListener(
		'touchend',
		(e) => {
			const y =
				e.touches.length === 0 && e.changedTouches.length === 1 ? delta(e.changedTouches[0]) : 0;
			reset();
			const action = y >= 56 ? actions?.down : y <= -56 ? actions?.up : undefined;
			if (!action || e.defaultPrevented) return;
			if (e.cancelable) e.preventDefault();
			action();
		},
		active
	);
	node.addEventListener('touchcancel', reset, passive);
	return {
		update(next: Vertical | undefined) {
			// Native polls replace track objects while a finger is down. Only a change of screen actions cancels the swipe.
			if (actions?.up !== next?.up || actions?.down !== next?.down) reset();
			actions = next;
		},
		destroy() {
			cleanup.abort();
		}
	};
}
