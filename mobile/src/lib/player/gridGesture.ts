// Allow native page scrolling until a deliberate hold. A visible resize handle can
// start immediately because its only purpose is adjusting the selected tile.
type Gesture = {
	begin: (id: string, resize: boolean) => void;
	move: (dx: number, dy: number) => void;
	end: (commit: boolean) => void;
};
export function gridGesture(node: HTMLElement, events: Gesture) {
	let cleanup: (() => void) | undefined;
	let blockUntil = 0;
	function start(e: TouchEvent | PointerEvent) {
		if (!(e.target instanceof Element)) return;
		const handle = e.target.closest<HTMLElement>('[data-grid-handle]');
		const pointer = 'pointerId' in e ? e : undefined;
		if (
			!handle ||
			(pointer && (pointer.pointerType === 'touch' || pointer.button !== 0 || !pointer.isPrimary))
		)
			return;
		cleanup?.();
		const touch = 'touches' in e ? e.touches[0] : undefined;
		if ('touches' in e && e.touches.length !== 1) return;
		const origin = touch ?? pointer;
		if (!origin) return;
		const x = origin.clientX,
			y = origin.clientY;
		const listeners = new AbortController();
		let active = false,
			moved = false;
		const resize = handle.dataset.gridHandle === 'resize';
		const fieldId = handle.dataset.fieldId;
		if (!fieldId) return;
		function begin() {
			if (active) return;
			active = true;
			events.begin(fieldId!, resize);
		}
		const timer = window.setTimeout(begin, 410);
		function finish(commit: boolean) {
			clearTimeout(timer);
			listeners.abort();
			cleanup = undefined;
			if (active) {
				if (!resize || moved) blockUntil = performance.now() + 420;
				events.end(commit);
			}
		}
		cleanup = () => finish(false);
		function move(event: Event, p: { clientX: number; clientY: number }) {
			const dx = p.clientX - x,
				dy = p.clientY - y;
			if (!active) {
				if (Math.hypot(dx, dy) > 8) finish(false);
				return;
			}
			if (Math.hypot(dx, dy) > 3) moved = true;
			if (event.cancelable) event.preventDefault();
			events.move(dx, dy);
		}
		const opts = { capture: true, signal: listeners.signal };
		if (touch) {
			const id = touch.identifier;
			document.addEventListener(
				'touchmove',
				(event) => {
					const p = [...event.touches].find((v) => v.identifier === id);
					if (p && event.touches.length === 1) move(event, p);
					else finish(false);
				},
				{ ...opts, passive: false }
			);
			document.addEventListener(
				'touchend',
				(event) => {
					if (![...event.changedTouches].some((p) => p.identifier === id)) return;
					if (active && (!resize || moved) && event.cancelable) event.preventDefault();
					finish(true);
				},
				{ ...opts, passive: false }
			);
			document.addEventListener('touchcancel', cleanup, opts);
			document.addEventListener(
				'touchstart',
				(event) => {
					if (event.touches.length > 1) finish(false);
				},
				opts
			);
		} else if (pointer) {
			document.addEventListener(
				'pointermove',
				(event) => {
					if (event.pointerId === pointer.pointerId) move(event, event);
				},
				opts
			);
			document.addEventListener(
				'pointerup',
				(event) => {
					if (event.pointerId === pointer.pointerId) finish(true);
				},
				opts
			);
			document.addEventListener('pointercancel', cleanup, opts);
		}
		window.addEventListener('blur', cleanup, { signal: listeners.signal });
		if (resize) begin();
	}
	function click(e: MouseEvent) {
		if (e.detail && performance.now() < blockUntil) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}
	function context(e: Event) {
		if (e.target instanceof Element && e.target.closest('[data-grid-handle]')) e.preventDefault();
	}
	node.addEventListener('touchstart', start, { passive: true });
	node.addEventListener('pointerdown', start);
	node.addEventListener('contextmenu', context);
	node.addEventListener('click', click, true);
	return {
		destroy() {
			cleanup?.();
			node.removeEventListener('touchstart', start);
			node.removeEventListener('pointerdown', start);
			node.removeEventListener('contextmenu', context);
			node.removeEventListener('click', click, true);
		}
	};
}
