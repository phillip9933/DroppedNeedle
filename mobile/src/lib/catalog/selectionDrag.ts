/** Keep the gesture on the scroll container when a virtual row leaves the DOM. */
export function selectionDrag() {
	let stopContact: (() => void) | undefined;
	let releaseClick: (() => void) | undefined;

	function stop() {
		stopContact?.();
		releaseClick?.();
	}

	function start(
		node: HTMLElement,
		event: PointerEvent | TouchEvent,
		begin: () => ((target: HTMLElement) => void) | undefined
	) {
		const touch = 'changedTouches' in event ? event.changedTouches[0] : undefined;
		if (
			'pointerId' in event &&
			(!event.isPrimary || event.button !== 0 || event.pointerType === 'touch')
		)
			return;
		if ('touches' in event && event.touches.length !== 1) return;
		stop();
		const point = touch ?? (event as PointerEvent);
		const x0 = point.clientX,
			y0 = point.clientY;
		const root = node.closest<HTMLElement>('[data-selection-group]'),
			main = node.closest('main');
		if (!root || !main) return;
		const listeners = new AbortController(),
			opts = { capture: true, signal: listeners.signal };
		let x = x0,
			y = y0,
			frame = 0,
			moved = false,
			previousFrame = 0,
			alive = true;
		let visit: ReturnType<typeof begin>;
		const timer = setTimeout(() => {
			if (!node.isConnected) return cleanup();
			const before = node.getBoundingClientRect().top;
			visit = begin();
			if (!visit) return cleanup();
			node.dispatchEvent(new CustomEvent('dn-selection-anchor', { bubbles: true, detail: true }));
			// Showing the action bar must not move the pressed item out from under the finger.
			queueMicrotask(() => {
				if (visit && node.isConnected) main.scrollTop += node.getBoundingClientRect().top - before;
			});
		}, 480);
		function cleanup() {
			alive = false;
			if (visit)
				node.dispatchEvent(
					new CustomEvent('dn-selection-anchor', { bubbles: true, detail: false })
				);
			clearTimeout(timer);
			if (main) delete main.dataset.rangeScrolling;
			cancelAnimationFrame(frame);
			listeners.abort();
			stopContact = undefined;
		}
		stopContact = cleanup;
		function update(time: number) {
			frame = 0;
			if (!alive || !visit || !moved || !root || !main) return;
			if (!node.isConnected) return cleanup();
			const bounds = main.getBoundingClientRect();
			const bar = root
				.querySelector<HTMLElement>('[data-selection-toolbar]')
				?.getBoundingClientRect();
			const top = bar && bar.top <= bounds.top + 1 ? Math.max(bounds.top, bar.bottom) : bounds.top;
			const bottom = bounds.bottom;
			const zone = Math.min(56, (bottom - top) / 4);
			const available = Math.max(0, main.scrollHeight - main.clientHeight);
			const velocity =
				y < top + zone
					? -Math.min(1, (top + zone - y) / zone)
					: y > bottom - zone
						? Math.min(1, (y - bottom + zone) / zone)
						: 0;
			const step = Math.min(32, previousFrame ? time - previousFrame : 16);
			previousFrame = time;
			if (velocity) main.dataset.rangeScrolling = '';
			else delete main.dataset.rangeScrolling;
			if (
				velocity &&
				((velocity < 0 && main.scrollTop > 0) || (velocity > 0 && main.scrollTop < available))
			) {
				main.scrollTop += Math.sign(velocity) * Math.max(1, Math.abs(velocity) * step * 0.7);
				frame = requestAnimationFrame(update);
			} else if (velocity > 0 && root.querySelector('[data-selection-more]')) {
				frame = requestAnimationFrame(update);
			}
			const hit = document.elementFromPoint(
				Math.min(bounds.right - 2, Math.max(bounds.left + 2, x)),
				Math.min(bottom - 2, Math.max(top + 2, y))
			);
			const item = hit?.closest<HTMLElement>('[data-selectable]');
			if (item && root.contains(item)) visit(item);
		}
		function move(next: { clientX: number; clientY: number }, e: Event) {
			x = next.clientX;
			y = next.clientY;
			if (Math.hypot(x - x0, y - y0) > 8) moved = true;
			if (!visit) {
				if (moved) cleanup();
				return;
			}
			if (e.cancelable) e.preventDefault();
			if (!frame) frame = requestAnimationFrame(update);
		}
		function end(e: Event) {
			if (visit) {
				if (e.cancelable && touch) e.preventDefault();
				if (frame) {
					cancelAnimationFrame(frame);
					update(performance.now());
				}
				// Mouse and some WebViews dispatch a compatibility click after a held press.
				const swallow = new AbortController(),
					options = { capture: true, signal: swallow.signal };
				const expire = setTimeout(() => releaseClick?.(), 450);
				releaseClick = () => {
					clearTimeout(expire);
					swallow.abort();
					releaseClick = undefined;
				};
				document.addEventListener(
					'click',
					(click) => {
						if (!click.detail || !(click.target instanceof Node) || !root?.contains(click.target))
							return;
						click.preventDefault();
						click.stopImmediatePropagation();
						releaseClick?.();
					},
					options
				);
				document.addEventListener('pointerdown', () => releaseClick?.(), options);
				document.addEventListener('touchstart', () => releaseClick?.(), {
					...options,
					passive: true
				});
			}
			cleanup();
		}
		if (touch) {
			const find = (list: TouchList) =>
				Array.from(list).find((t) => t.identifier === touch.identifier);
			document.addEventListener(
				'touchmove',
				(e) => {
					const next = find(e.changedTouches);
					if (e.touches.length !== 1) cleanup();
					else if (next) move(next, e);
				},
				{ ...opts, passive: false }
			);
			document.addEventListener(
				'touchend',
				(e) => {
					if (find(e.changedTouches)) end(e);
				},
				{ ...opts, passive: false }
			);
			document.addEventListener('touchcancel', cleanup, opts);
		} else {
			const pointer = event as PointerEvent;
			document.addEventListener(
				'pointermove',
				(e) => {
					if (e.pointerId === pointer.pointerId) move(e, e);
				},
				opts
			);
			document.addEventListener(
				'pointerup',
				(e) => {
					if (e.pointerId === pointer.pointerId) end(e);
				},
				opts
			);
			document.addEventListener('pointercancel', cleanup, opts);
		}
		// Pressing a row focuses it. Only a window blur should interrupt its hold.
		window.addEventListener('blur', cleanup, { signal: listeners.signal });
		document.addEventListener('visibilitychange', cleanup, opts);
	}
	return { start, stop };
}
