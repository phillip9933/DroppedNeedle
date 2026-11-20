<script lang="ts">
	import { Pencil, Plus } from '@lucide/svelte';
	import { sectionTitle, type Section } from '../boards/layout';
	import { isPlayerSlot, maxPlayerColumns, rowName } from './composition';
	let {
		rows,
		measured,
		r,
		close,
		resize,
		setWidth,
		select,
		move,
		height,
		setHeight,
		gap,
		setGap,
		remove
	}: {
		rows: Section[][];
		measured: Record<string, number>;
		r: number;
		close: () => void;
		resize: (n: number) => void;
		setWidth: (c: number, n: number) => void;
		select: (id: string) => void;
		move: (to: number) => void;
		height: number;
		gap?: number;
		setGap: (n: number | undefined) => void;
		setHeight: (n: number) => void;
		remove: () => void;
	} = $props();
	const row = $derived(rows[r] ?? []);
	const total = $derived(row.reduce((n, c) => n + (c.width ?? 1), 0));
</script>

<div
	class="row-tools"
	data-inspector
	tabindex="-1"
	role="group"
	aria-label={'Edit ' + rowName(r).toLowerCase()}
>
	<div class="head">
		<strong>{rowName(r)}</strong><button aria-label="Finish editing row" onclick={close}
			>Done</button
		>
	</div>
	<div class="basics">
		<label
			>Number of columns<select
				value={row.length}
				onchange={(e) => resize(Number(e.currentTarget.value))}
			>
				{#each Array.from({ length: maxPlayerColumns }, (_, i) => i + 1) as n (n)}<option value={n}
						>{n}</option
					>{/each}</select
			></label
		>
		<label
			>Row position<select value={r} onchange={(e) => move(Number(e.currentTarget.value))}>
				{#each rows.keys() as i (i)}<option value={i}>{rowName(i)}</option>{/each}</select
			></label
		>
		{#if row.length > 1}<label
				>Column spacing (px)<input
					type="number"
					min="0"
					max="32"
					placeholder="Default"
					value={gap ?? ''}
					onchange={(e) =>
						setGap(
							Number.isFinite(e.currentTarget.valueAsNumber)
								? Math.min(32, Math.max(0, Math.round(e.currentTarget.valueAsNumber)))
								: undefined
						)}
				/></label
			>{/if}
		<label
			>Minimum row height (px)<input
				aria-label="Minimum row height"
				min="0"
				max="640"
				type="number"
				value={height}
				oninput={(e) => setHeight(e.currentTarget.valueAsNumber)}
			/></label
		>
	</div>
	{#if row.length > 1}
		<div class="width-label">
			<strong>Column widths</strong><button
				class="text-button"
				onclick={() => row.forEach((_, i) => setWidth(i, 1))}>Equal widths</button
			>
		</div>
		<div
			class="ratio"
			aria-hidden="true"
			style:grid-template-columns={row
				.map((s) => (measured[s.id] ?? (100 * (s.width ?? 1)) / total) + 'fr')
				.join(' ')}
		>
			{#each row as s, c (s.id)}<span>{c + 1}</span>{/each}
		</div>
	{/if}
	{#each row as s, c (s.id)}
		<div class="cell">
			<button
				data-edit-column={s.id}
				aria-label={'Open column ' + (c + 1) + ', ' + sectionTitle(s)}
				onclick={() => select(s.id)}
				><small>{c + 1}</small><span>{sectionTitle(s)}</span>{#if isPlayerSlot(s.id)}<Plus
						size={16}
					/>{:else}<Pencil size={14} />{/if}</button
			>
			{#if row.length > 1}<div class="size">
					<input
						aria-label={'Column ' + (c + 1) + ' width'}
						type="range"
						min="1"
						max="12"
						step="1"
						value={s.width ?? 1}
						oninput={(e) => setWidth(c, e.currentTarget.valueAsNumber)}
					/>
					<output>{Math.round(measured[s.id] ?? ((s.width ?? 1) / total) * 100)}%</output>
				</div>{/if}
		</div>
	{/each}
	<button class="text-button remove" onclick={remove}
		>{r === 0 ? 'Clear header' : 'Remove row'}</button
	>
</div>

<style>
	.row-tools {
		display: grid;
		gap: 0.45rem;
		padding: var(--gap);
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		min-width: 0;
	}
	.head,
	.width-label,
	.cell button,
	.size {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.head,
	.width-label {
		justify-content: space-between;
	}
	.head button,
	.cell button {
		min-height: 44px;
	}
	.head button {
		min-width: 44px;
		display: grid;
		place-items: center;
	}
	.basics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
		gap: 0.45rem;
	}
	label {
		display: grid;
		gap: 0.18rem;
		min-width: 0;
	}
	select,
	input {
		min-width: 0;
		width: 100%;
	}
	.ratio {
		display: grid;
		gap: 2px;
		overflow: hidden;
		border-radius: var(--radius);
		min-width: 0;
	}
	.ratio span {
		min-width: 0;
		background: var(--accent);
		color: var(--on-accent, var(--bg));
		font-size: 0.75rem;
		text-align: center;
	}
	.cell {
		padding: 0.25rem 0.4rem;
		border-top: 1px solid var(--line);
	}
	.cell button {
		width: 100%;
		min-width: 0;
		text-align: start;
	}
	.cell span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.size input {
		min-height: 32px;
		height: 32px;
		flex: 1;
		padding: 0;
	}
	.size output {
		min-width: 3ch;
		color: var(--muted);
		font-size: 0.82rem;
		text-align: end;
	}
	.remove {
		justify-self: start;
	}
</style>
