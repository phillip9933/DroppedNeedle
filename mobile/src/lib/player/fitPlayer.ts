/** Reserve a usable artwork row, then fit unusually tall saved compositions into the available viewport. */
export function fitPlayer(frame: HTMLElement, enabled: boolean) {
	const canvas = frame.firstElementChild as HTMLElement;
	const player = frame.parentElement;
	const viewport = player?.dataset.part === 'now-playing' ? frame.closest('main') : null;
	let scale = 1,
		scheduled = 0;
	const observer = new ResizeObserver(() => {
		if (player && viewport?.clientHeight)
			player.style.setProperty('--player-viewport-height', viewport.clientHeight + 'px');
		schedule();
	});
	const mutations = new MutationObserver(() => {
		observe();
		schedule();
	});
	function observe() {
		observer.disconnect();
		observer.observe(frame);
		if (viewport) observer.observe(viewport);
		for (const row of canvas.children) observer.observe(row);
	}
	function measure() {
		scheduled = 0;
		if (!enabled || !frame.clientHeight || !canvas.children.length) return;
		const rows = Array.from(canvas.children) as HTMLElement[];
		const gap = parseFloat(getComputedStyle(canvas).rowGap) || 0;
		const needed = rows.reduce(
			(sum, row) => {
				const margin = parseFloat(getComputedStyle(row).marginBlockStart) || 0;
				if (!row.classList.contains('art-row')) return sum + margin + row.offsetHeight;
				const grid = row.querySelector<HTMLElement>('.player-row')!;
				const heights = Array.from(grid.children, (column) =>
					Array.from(column.children).reduce((height, field) => {
						const content = field.querySelector<HTMLElement>('.content');
						if (field.getAttribute('data-section-id') !== 'player-artwork')
							return height + (content?.offsetHeight ?? 0);
						return (
							height +
							76 +
							(content?.querySelector<HTMLElement>('.field-caption')?.offsetHeight ?? 0)
						);
					}, 0)
				);
				return sum + margin + Math.max(parseFloat(grid.style.minHeight) || 0, ...heights);
			},
			gap * (rows.length - 1)
		);
		const next = Math.min(1, frame.clientHeight / Math.max(1, needed));
		if (Math.abs(scale - next) < 0.002) return;
		// Keep the layout width used for measurement stable when shrinking a tall composition.
		scale = next;
		frame.style.setProperty('--player-fit', String(scale));
	}
	function schedule() {
		if (!scheduled && enabled) scheduled = requestAnimationFrame(measure);
	}
	function update(value: boolean) {
		enabled = value;
		scale = 1;
		frame.style.removeProperty('--player-fit');
		observe();
		schedule();
	}
	mutations.observe(canvas, { childList: true });
	update(enabled);
	return {
		update,
		destroy() {
			cancelAnimationFrame(scheduled);
			observer.disconnect();
			mutations.disconnect();
			if (viewport) player?.style.removeProperty('--player-viewport-height');
		}
	};
}
