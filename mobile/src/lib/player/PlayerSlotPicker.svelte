<script lang="ts">
	import { Check, Plus } from '@lucide/svelte';
	import { available, sectionTitle, type Section } from '../boards/layout';
	import { isPlayerText, splitAvailable, splitPlayerSection, rowName } from './composition';
	let {
		rows,
		choose,
		close,
		r,
		c
	}: {
		rows: Section[][];
		choose: (id: string) => void;
		close: () => void;
		r: number;
		c: number;
	} = $props();
	let query = $state('');
	const ordered = [
		'player-toggle',
		'player-previous',
		'player-next',
		'player-shuffle',
		'player-repeat',
		'player-seek',
		'player-title',
		'player-artist',
		'player-album',
		'player-artwork',
		'player-text'
	];
	const options = available('player')
		.filter((w) => w.id !== 'player-track')
		.sort((a, b) => {
			const rank = (id: string) => (ordered.includes(id) ? ordered.indexOf(id) : ordered.length);
			return rank(a.id) - rank(b.id);
		});
	const matches = $derived(
		options.filter((w) => w.label.toLowerCase().includes(query.trim().toLowerCase()))
	);
	function from(id: string) {
		if (isPlayerText(id)) return '';
		const row = rows.findIndex((row) => row.some((s) => s.id === id));
		if (row >= 0) return 'Move from ' + rowName(row).toLowerCase();
		for (const [index, cells] of rows.entries()) {
			const group = cells.find(
				(s) => splitAvailable(s.id) && splitPlayerSection(s).some((p) => p.id === id)
			);
			if (group) return sectionTitle(group) + ' · ' + rowName(index).toLowerCase();
		}
		return '';
	}
</script>

<div class="picker" tabindex="-1" data-inspector role="group" aria-label="Choose a player feature">
	<div class="head">
		<div><strong>Choose a feature</strong><small>{rowName(r)} · column {c + 1}</small></div>
		<button class="icon" aria-label="Close feature picker" onclick={close}>Back</button>
	</div>
	<input
		type="search"
		bind:value={query}
		aria-label="Find a feature"
		placeholder="Find a feature"
	/>
	<div class="choices">
		{#each matches as item (item.id)}
			{@const origin = from(item.id)}
			<button aria-label={'Use ' + item.label} onclick={() => choose(item.id)}
				><span
					>{item.label}{#if origin}<small>{origin}</small>{/if}</span
				>{#if origin}<Check size={16} />{:else}<Plus size={16} />{/if}</button
			>
		{:else}<p>No matching features.</p>{/each}
	</div>
</div>

<style>
	.picker {
		display: grid;
		gap: 0.35rem;
		padding: var(--gap);
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		min-width: 0;
	}
	.head,
	.choices button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.head strong,
	.head small,
	.choices span,
	.choices small {
		display: block;
	}
	small {
		font-size: 0.77rem;
		color: var(--muted);
	}
	.head button {
		min-width: 44px;
		min-height: 44px;
		display: grid;
		place-items: center;
	}
	input {
		min-width: 0;
		width: 100%;
	}
	.choices {
		max-height: min(40dvh, 17rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.choices button {
		width: 100%;
		min-height: 44px;
		text-align: start;
		border-bottom: 1px solid var(--line);
		padding: 0.4rem 0.2rem;
	}
	.choices button :global(svg) {
		flex: none;
	}
	.choices button:focus-visible {
		outline-offset: -2px;
	}
</style>
