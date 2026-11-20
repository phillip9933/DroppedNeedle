// Leave the platform’s back-swipe area available on either side.
const systemBackInset = 36;

type Skip = (direction: 'previous' | 'next') => void;

export function swipeTracks(node: HTMLElement, skip: Skip | undefined) {
	let origin: Touch | undefined;
	const reset = () => (origin = undefined);
	const listeners = new AbortController();
	const passive = { signal: listeners.signal, passive: true };
	const active = { signal: listeners.signal, passive: false };
	node.addEventListener(
		'touchstart',
		(event) => {
			reset();
			if (!skip || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const bounds = node.closest('[data-part="app"]')?.getBoundingClientRect();
			if (
				touch.clientX <= (bounds?.left ?? 0) + systemBackInset ||
				touch.clientX >= (bounds?.right ?? window.innerWidth) - systemBackInset
			)
				return;
			origin = touch;
		},
		passive
	);
	function distance(touch: Touch) {
		if (!origin || origin.identifier !== touch.identifier) return 0;
		const dx = touch.clientX - origin.clientX;
		const dy = Math.abs(touch.clientY - origin.clientY);
		if (dy > 10 && dy > Math.abs(dx) * 0.7) {
			reset();
			return 0;
		}
		return dx;
	}
	node.addEventListener(
		'touchmove',
		(event) => {
			if (event.touches.length !== 1) return reset();
			if (Math.abs(distance(event.touches[0])) >= 14 && event.cancelable) event.preventDefault();
		},
		active
	);
	node.addEventListener(
		'touchend',
		(event) => {
			const dx =
				event.touches.length === 0 && event.changedTouches.length === 1
					? distance(event.changedTouches[0])
					: 0;
			reset();
			if (!skip || Math.abs(dx) < 52 || event.defaultPrevented) return;
			if (event.cancelable) event.preventDefault();
			skip(dx < 0 ? 'next' : 'previous');
		},
		active
	);
	node.addEventListener('touchcancel', reset, passive);
	return {
		update(next: Skip | undefined) {
			reset();
			skip = next;
		},
		destroy() {
			listeners.abort();
		}
	};
}
