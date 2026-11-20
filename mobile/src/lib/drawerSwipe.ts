import { Capacitor, registerPlugin } from '@capacitor/core';

const nativeDrawer = registerPlugin<{ setMenuEdge(options: { enabled: boolean }): Promise<void> }>(
	'DNDrawer'
);

// A narrow start zone keeps the rest of the screen available for browsing, scrubbing and layout edits.
export function drawerSwipe(
	shell: HTMLElement,
	dialog: () => HTMLDialogElement | undefined,
	show: () => void,
	close: () => void
) {
	let swipe: { x: number; y: number; finger: number; closing: boolean } | undefined;
	const stop = () => {
		swipe = undefined;
	};

	function start(e: TouchEvent) {
		stop();
		const target = e.target;
		if (e.touches.length !== 1 || !(target instanceof Element)) return;
		const sheet = dialog(),
			closing = !!sheet?.open;
		if (closing) {
			if (!sheet?.contains(target) || sheet.querySelector('dialog[open]')) return;
		} else {
			if (!shell.contains(target) || document.querySelector('dialog[open]')) return;
			if (
				target.closest(
					'input, textarea, select, [contenteditable="true"], [draggable="true"], [data-layout-drag]'
				)
			)
				return;
		}
		const touch = e.touches[0],
			edge = touch.clientX - shell.getBoundingClientRect().left;
		if (!closing && (edge < 0 || edge > 36)) return;
		if (!closing) {
			for (
				let parent: Element | null = target;
				parent && parent !== shell;
				parent = parent.parentElement
			) {
				if (
					parent.scrollWidth > parent.clientWidth + 1 &&
					['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)
				)
					return;
			}
		}
		swipe = { x: touch.clientX, y: touch.clientY, finger: touch.identifier, closing };
	}
	function delta(t: Touch) {
		if (!swipe || swipe.finger !== t.identifier) return 0;
		const dx = (t.clientX - swipe.x) * (swipe.closing ? -1 : 1),
			dy = Math.abs(t.clientY - swipe.y);
		if (dx < -10 || (dy > 10 && dy > dx * 0.75)) {
			stop();
			return 0;
		}
		return dx;
	}
	function move(e: TouchEvent) {
		if (!swipe || e.touches.length !== 1) {
			stop();
			return;
		}
		if (delta(e.touches[0]) >= 14 && e.cancelable) e.preventDefault();
	}
	function end(e: TouchEvent) {
		if (!swipe || e.touches.length !== 0 || e.changedTouches.length !== 1) {
			stop();
			return;
		}
		const closing = swipe.closing;
		if (delta(e.changedTouches[0]) >= 60) {
			if (e.cancelable) e.preventDefault();
			if (closing) close();
			else show();
		}
		stop();
	}
	const listeners = new AbortController();
	const options = { capture: true, signal: listeners.signal };
	document.addEventListener('touchstart', start, { ...options, passive: true });
	document.addEventListener('touchmove', move, { ...options, passive: false });
	document.addEventListener('touchend', end, { ...options, passive: false });
	document.addEventListener('touchcancel', stop, options);
	let changes: MutationObserver | undefined;
	let reserved = false;
	function setEdge(enabled: boolean) {
		if (enabled === reserved) return;
		reserved = enabled;
		void nativeDrawer.setMenuEdge({ enabled }).catch(() => {});
	}
	if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('DNDrawer')) {
		const sync = () =>
			setEdge(shell.getBoundingClientRect().left < 1 && !document.querySelector('dialog[open]'));
		changes = new MutationObserver(sync);
		changes.observe(shell, { subtree: true, attributes: true, attributeFilter: ['open'] });
		window.addEventListener('resize', sync, options);
		document.addEventListener('focusin', sync, options);
		sync();
	}
	return () => {
		listeners.abort();
		changes?.disconnect();
		setEdge(false);
	};
}
