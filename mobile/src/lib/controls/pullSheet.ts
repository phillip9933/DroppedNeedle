type Pull = { dismiss: () => void; disabled?: boolean };

/** Pull the heading, or pull down from the top of the sheet's scrollable content. */
export function pullSheet(sheet: HTMLDialogElement, options: Pull) {
	const cleanup = new AbortController();
	const passive = { passive: true, signal: cleanup.signal };
	const active = { passive: false, signal: cleanup.signal };
	let pointer: { id: number; y: number } | undefined;
	let touch: Touch | undefined;
	function finish() {
		pointer = undefined;
		touch = undefined;
		sheet.style.removeProperty('--sheet-pull');
	}
	function move(y: number) {
		sheet.style.setProperty('--sheet-pull', Math.max(0, y) + 'px');
	}
	function release(y: number) {
		finish();
		if (!options.disabled && y >= 52) options.dismiss();
	}
	function target(event: Event) {
		const el = event.target;
		return !options.disabled && el instanceof Element && el.closest('dialog') === sheet ? el : null;
	}
	sheet.addEventListener(
		'pointerdown',
		(event) => {
			const el = target(event);
			if (
				!event.isPrimary ||
				event.button !== 0 ||
				el?.closest('button,a,input,select,textarea') ||
				!el?.closest('[data-sheet-handle]')
			)
				return;
			pointer = { id: event.pointerId, y: event.clientY };
			sheet.setPointerCapture(event.pointerId);
		},
		passive
	);
	sheet.addEventListener(
		'pointermove',
		(event) => {
			if (pointer?.id === event.pointerId) move(event.clientY - pointer.y);
		},
		passive
	);
	sheet.addEventListener(
		'pointerup',
		(event) => {
			if (pointer?.id === event.pointerId) release(event.clientY - pointer.y);
		},
		passive
	);
	sheet.addEventListener(
		'pointercancel',
		(event) => {
			if (pointer?.id === event.pointerId) finish();
		},
		passive
	);

	sheet.addEventListener(
		'touchstart',
		(event) => {
			if (pointer) return;
			finish();
			const el = target(event);
			if (
				!el ||
				event.touches.length !== 1 ||
				el.closest(
					'input,select,textarea,[contenteditable=true],[role=slider],[data-sheet-handle],[data-reorder-grip]'
				)
			)
				return;
			for (let node: Element | null = el; node && node !== sheet; node = node.parentElement) {
				if (node.scrollTop > 1) return;
			}
			touch = event.touches[0];
		},
		passive
	);
	function distance(point: Touch) {
		if (!touch || touch.identifier !== point.identifier) return 0;
		const x = Math.abs(point.clientX - touch.clientX),
			y = point.clientY - touch.clientY;
		if (y < -6 || (x > 10 && x > Math.abs(y) * 0.85)) {
			finish();
			return 0;
		}
		return y;
	}
	sheet.addEventListener(
		'touchmove',
		(event) => {
			if (!touch) return;
			if (event.touches.length !== 1 || !event.cancelable) return finish();
			const y = distance(event.touches[0]);
			if (y <= 12) return;
			event.preventDefault();
			move(y);
		},
		active
	);
	sheet.addEventListener(
		'touchend',
		(event) => {
			if (!touch) return;
			const y = event.changedTouches.length === 1 ? distance(event.changedTouches[0]) : 0;
			if (y >= 52 && event.cancelable) event.preventDefault();
			release(y);
		},
		active
	);
	sheet.addEventListener(
		'touchcancel',
		() => {
			if (touch) finish();
		},
		passive
	);
	return {
		update(next: Pull) {
			options = next;
			if (next.disabled) finish();
		},
		destroy() {
			cleanup.abort();
			finish();
		}
	};
}
