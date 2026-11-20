interface Options {
	count: number;
	columns: number;
	compact: boolean;
	active: boolean;
	layout: 'list' | 'grid';
	onwindow: (window: BrowseWindow) => void;
}
export interface BrowseWindow {
	start: number;
	end: number;
	pitch: number;
	gap: number;
	width: number;
	columnGap: number;
}
export const initialWindow: BrowseWindow = {
	start: 0,
	end: 48,
	pitch: 0,
	gap: 0,
	width: 0,
	columnGap: 0
};
export function browseViewport(node: HTMLElement, initial: Options) {
	const main = node.closest('main');
	if (!main) return;
	let options = initial,
		frame = 0,
		sample: HTMLElement | null = null;
	let last = initialWindow;
	const resize = new ResizeObserver(schedule);
	resize.observe(main);
	resize.observe(node);
	function schedule() {
		if (!frame) frame = requestAnimationFrame(measure);
	}
	function measure() {
		frame = 0;
		if (!options.active || document.hidden || !node.clientWidth) return;
		const cell = node.querySelector<HTMLElement>('.entry');
		if (!cell) return;
		if (cell !== sample) {
			if (sample) resize.unobserve(sample);
			sample = cell;
			resize.observe(cell);
		}
		const style = getComputedStyle(node),
			gap = parseFloat(style.rowGap) || 0,
			columnGap = parseFloat(style.columnGap) || 0;
		const width = (node.clientWidth - columnGap * (options.columns - 1)) / options.columns,
			pitch = cell.getBoundingClientRect().height + gap;
		if (!pitch) return;
		const top = main!.getBoundingClientRect().top - node.getBoundingClientRect().top;
		const rows = Math.ceil(options.count / options.columns);
		// Move the window in four-row increments with at least a viewport of overscan on each side.
		const overscan = Math.max(4, Math.ceil(main!.clientHeight / pitch));
		const first = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor(top / pitch)));
		const start = Math.max(0, Math.floor((first - overscan) / 4) * 4) * options.columns;
		const end = Math.min(
			options.count,
			(Math.ceil((first + 2 * overscan) / 4) * 4 + 2) * options.columns
		);
		const next = { start, end, pitch, gap, width, columnGap };
		if (
			last.start !== start ||
			last.end !== end ||
			last.pitch !== pitch ||
			last.width !== width ||
			last.columnGap !== columnGap ||
			last.gap !== gap
		) {
			last = next;
			options.onwindow(next);
		}
	}
	main.addEventListener('scroll', schedule, { passive: true });
	document.addEventListener('visibilitychange', schedule);
	schedule();
	return {
		update(next: Options) {
			options = next;
			schedule();
		},
		destroy() {
			cancelAnimationFrame(frame);
			resize.disconnect();
			main.removeEventListener('scroll', schedule);
			document.removeEventListener('visibilitychange', schedule);
		}
	};
}

interface LoadOptions {
	active: boolean;
	enabled: boolean;
	load: () => void;
}
export function loadNearEnd(button: HTMLElement, initial: LoadOptions) {
	const main = button.closest('main');
	if (!main) return;
	let options = initial,
		previous = main.scrollTop,
		frame = 0,
		gesture = false,
		edgeIntent = false;
	// Layout adjustments and restoring detail scroll positions also dispatch scroll events.
	// Only an input gesture can advance the browse cursor.
	function begin() {
		gesture = true;
	}
	function wheel(e: WheelEvent) {
		if (e.deltaY > 0) {
			gesture = true;
			edgeIntent = true;
			moved();
		}
	}
	function keys(e: KeyboardEvent) {
		if (['ArrowDown', 'PageDown', 'End', ' '].includes(e.key)) {
			gesture = true;
			edgeIntent = true;
			moved();
		}
	}
	main.addEventListener('wheel', wheel, { passive: true });
	main.addEventListener('pointerdown', begin, { passive: true });
	main.addEventListener('touchmove', begin, { passive: true });
	main.addEventListener('keydown', keys);
	function check() {
		frame = 0;
		const y = main!.scrollTop,
			forward = y > previous;
		previous = y;
		const approach = forward || edgeIntent;
		edgeIntent = false;
		if (
			(!gesture && !main!.hasAttribute('data-range-scrolling')) ||
			!approach ||
			!options.active ||
			!options.enabled ||
			document.hidden ||
			document.querySelector('dialog[open]') ||
			!button.getClientRects().length
		)
			return;
		const distance = button.getBoundingClientRect().top - main!.getBoundingClientRect().bottom;
		if (distance < Math.min(380, main!.clientHeight * 0.55)) {
			gesture = false;
			options.load();
		}
	}
	function moved() {
		if (!frame) frame = requestAnimationFrame(check);
	}
	main.addEventListener('scroll', moved, { passive: true });
	return {
		update(next: LoadOptions) {
			if (next.active !== options.active) {
				previous = main.scrollTop;
				gesture = false;
			}
			options = next;
		},
		destroy() {
			cancelAnimationFrame(frame);
			main.removeEventListener('scroll', moved);
			main.removeEventListener('wheel', wheel);
			main.removeEventListener('pointerdown', begin);
			main.removeEventListener('touchmove', begin);
			main.removeEventListener('keydown', keys);
		}
	};
}
