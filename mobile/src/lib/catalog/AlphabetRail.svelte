<script lang="ts">
	let {
		descending,
		onjump,
		notice
	}: { descending: boolean; onjump: (letter: string) => void; notice: string } = $props();
	const alphabet = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const letters = $derived(descending ? [...alphabet].reverse() : [...alphabet]);
	let index = $state(0),
		pressing = $state(false),
		bar: HTMLDivElement;
	function point(event: PointerEvent) {
		const rect = bar.getBoundingClientRect();
		index = Math.max(
			0,
			Math.min(
				letters.length - 1,
				Math.floor(((event.clientY - rect.top) / rect.height) * letters.length)
			)
		);
	}
	function key(event: KeyboardEvent) {
		let next: number;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowRight':
				next = index + 1;
				break;
			case 'ArrowUp':
			case 'ArrowLeft':
				next = index - 1;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = letters.length - 1;
				break;
			default:
				next = letters.indexOf(event.key.toUpperCase());
				if (next < 0) return;
		}
		event.preventDefault();
		event.stopPropagation();
		index = Math.min(letters.length - 1, Math.max(0, next));
		onjump(letters[index]);
	}
</script>

<div class="rail">
	<div
		class="letters"
		bind:this={bar}
		role="slider"
		tabindex="0"
		aria-label="Jump to letter"
		aria-orientation="vertical"
		aria-valuemin="1"
		aria-valuemax={letters.length}
		aria-valuenow={index + 1}
		aria-valuetext={letters[index]}
		onkeydown={key}
		onpointerdown={(e) => {
			if (!e.isPrimary || e.button !== 0) return;
			pressing = true;
			bar.setPointerCapture(e.pointerId);
			point(e);
		}}
		onpointermove={(e) => {
			if (pressing && bar.hasPointerCapture(e.pointerId)) point(e);
		}}
		onpointerup={(e) => {
			if (!pressing || !bar.hasPointerCapture(e.pointerId)) return;
			point(e);
			pressing = false;
			bar.releasePointerCapture(e.pointerId);
			onjump(letters[index]);
		}}
		onlostpointercapture={() => (pressing = false)}
		onpointercancel={() => (pressing = false)}
	>
		{#each letters as letter (letter)}<span
				aria-hidden="true"
				class:chosen={letters[index] === letter}>{letter}</span
			>{/each}
	</div>
	{#if pressing}<output aria-hidden="true">{letters[index]}</output>{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
</div>

<style>
	.rail {
		align-self: start;
		position: sticky;
		top: 0.25rem;
		z-index: 1;
	}
	.letters {
		height: clamp(190px, 53dvh, 405px);
		width: 28px;
		display: flex;
		flex-direction: column;
		justify-content: space-around;
		accent-color: var(--accent);
		color: var(--muted);
		cursor: pointer;
		text-align: center;
		touch-action: none;
		user-select: none;
	}
	span {
		font-size: clamp(8px, 1.35dvh, 12px);
		line-height: 1;
		font-weight: 600;
	}
	.chosen {
		color: var(--accent);
	}
	output,
	p {
		position: absolute;
		inset-inline-end: calc(100% + 0.3rem);
		background: var(--surface);
		border: 1px solid var(--line);
		color: var(--text);
		border-radius: var(--radius);
		padding: 0.35rem 0.6rem;
	}
	output {
		top: 40%;
		font-size: 1.4rem;
	}
	p {
		top: 0;
		width: max-content;
		max-width: 12rem;
		font-size: 0.85rem;
		margin: 0;
	}
</style>
