<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { boardDisplay } from './display';
	import { playerWidgets } from '../player/layout';
	import { ArrowUp, ArrowDown, Minus, Plus, SlidersHorizontal } from '@lucide/svelte';
	import {
		available,
		boardNames,
		defaults,
		sectionTitle,
		type LayoutTarget,
		type Section
	} from './layout';
	let {
		board,
		sections,
		onsave,
		onback
	}: {
		board: LayoutTarget;
		sections: Section[];
		onsave: (items: Section[]) => void;
		onback: () => void;
	} = $props();
	function editable(section: Section): Section {
		return board === 'player'
			? { ...section }
			: { ...section, display: boardDisplay(section.id, section.display) };
	}
	let draft = $state<Section[]>(untrack(() => sections.map(editable)));
	let options = $state('');
	let filter = $state('');
	let error = $state('');
	let list: HTMLOListElement;
	const choices = $derived(
		available(board).filter(
			(w) =>
				!draft.some((s) => s.id === w.id) &&
				w.label.toLowerCase().includes(filter.trim().toLowerCase())
		)
	);
	function move(index: number, target: number) {
		const next = [...draft];
		const [item] = next.splice(index, 1);
		next.splice(target, 0, item);
		draft = next;
	}
	async function add(id: string) {
		draft = [
			...draft,
			editable({ id, title: '', preview: playerWidgets.find((w) => w.id === id)?.enabled ?? true })
		];
		options = id;
		await tick();
		const row = list.querySelector<HTMLElement>('[data-section-id="' + CSS.escape(id) + '"]');
		row?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus({ preventScroll: true });
		row?.scrollIntoView({ block: 'center' });
	}
	function save() {
		try {
			onsave(draft);
		} catch {
			error = 'Could not save this layout on the device. Your edits are still here.';
		}
	}
</script>

<div class="editor" data-part="layout-editor">
	<div class="bar">
		<button class="text-button" onclick={onback}>Cancel</button>
		<button class="primary" onclick={save}>Save layout</button>
	</div>
	<h1>Edit {boardNames[board]}</h1>
	{#if error}<p role="alert">{error}</p>{/if}
	<h2>On this screen</h2>
	{#if draft.length === 0}<p>Add a section below to start your layout.</p>{/if}
	<ol bind:this={list}>
		{#each draft as item, i (item.id)}
			{@const name = sectionTitle(item)}
			<li data-section-id={item.id}>
				<div class="row">
					<strong>{name}</strong>
					<button
						class="tool"
						aria-label={'Move ' + name + ' up'}
						disabled={i === 0}
						onclick={() => move(i, i - 1)}><ArrowUp size={18} /></button
					>
					<button
						class="tool"
						aria-label={'Move ' + name + ' down'}
						disabled={i === draft.length - 1}
						onclick={() => move(i, i + 1)}><ArrowDown size={18} /></button
					>
					<button
						class="tool"
						aria-label={'Customize ' + name}
						aria-expanded={options === item.id}
						onclick={() => (options = options === item.id ? '' : item.id)}
						><SlidersHorizontal size={17} /></button
					>
					<button
						class="tool"
						aria-label={'Remove ' + name}
						onclick={() => {
							draft = draft.filter((s) => s.id !== item.id);
							if (options === item.id) options = '';
						}}><Minus size={18} /></button
					>
				</div>
				{#if options === item.id}<div class="fields">
						<label
							>Section title<input
								maxlength="64"
								placeholder={available(board).find((w) => w.id === item.id)?.label}
								bind:value={item.title}
							/></label
						>
						<label
							>Position<select
								value={i}
								onchange={(event) => move(i, Number(event.currentTarget.value))}
							>
								{#each draft as position, n (position.id)}<option value={n}>{n + 1}</option>{/each}
							</select></label
						>
						<label class="check"
							><input type="checkbox" bind:checked={item.preview} />{playerWidgets.find(
								(w) => w.id === item.id
							)?.option ?? 'Show a preview'}</label
						>
						{#if item.display}
							{@const columnField = item.display.layout === 'grid' ? 'columns' : 'listColumns'}
							<div class="display-options">
								<label
									>Display<select bind:value={item.display.layout}
										><option value="list">List</option><option value="grid">Grid</option></select
									></label
								>
								<label
									>Preview rows<select bind:value={item.display.rows}
										>{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option
											>{/each}</select
									></label
								>
								<label
									>Maximum columns<select bind:value={item.display[columnField]}
										>{#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{n}</option
											>{/each}</select
									></label
								>
								<label
									>Column size<select bind:value={item.display.columnSize}
										><option value="small">Small</option><option value="medium">Medium</option
										><option value="large">Large</option></select
									></label
								>
								<label
									>Row density<select bind:value={item.display.density}
										><option value="compact">Compact</option><option value="normal">Normal</option
										><option value="spacious">Spacious</option></select
									></label
								>
							</div>
						{/if}
					</div>{/if}
			</li>
		{/each}
	</ol>
	<h2>Add sections</h2>
	<input
		type="search"
		aria-label="Find a section"
		placeholder="Find a section"
		bind:value={filter}
	/>
	{#each board === 'player' ? ['player'] : ['library', 'discover'] as group (group)}
		{@const matches = choices.filter((w) => w.id.startsWith(group + '-'))}
		{#if matches.length}
			{#if board === 'home'}<h3>{group === 'library' ? 'Library' : 'Discover'}</h3>{/if}
			{#each matches as widget (widget.id)}
				<button class="add" aria-label={'Add ' + widget.label} onclick={() => add(widget.id)}
					><span>{widget.label}</span><Plus size={18} /></button
				>
			{/each}
		{/if}
	{/each}
	{#if !choices.length}<p>
			{filter ? 'No matching sections.' : 'All available sections are on this screen.'}
		</p>{/if}
	<button
		class="text-button reset"
		onclick={() => {
			draft = defaults(board).map(editable);
			options = '';
			filter = '';
		}}>Restore default layout</button
	>
</div>

<style>
	.editor {
		max-width: 40rem;
		margin: auto;
	}
	.bar,
	.row,
	.add,
	.check {
		display: flex;
		align-items: center;
	}
	.bar,
	.add {
		justify-content: space-between;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		padding-block: 0.3rem;
		background: var(--bg);
		margin-bottom: var(--gap);
	}
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li,
	.add {
		border-bottom: 1px solid var(--line);
	}
	.row {
		min-height: 52px;
	}
	.row strong,
	.add span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		text-align: left;
	}
	.tool,
	.add {
		min-height: 44px;
	}
	.tool {
		width: 44px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
	}
	.tool:disabled {
		opacity: 0.25;
	}
	.fields {
		display: grid;
		gap: 0.55rem;
		margin: 0.3rem 0 var(--gap);
	}
	.fields label:not(.check) {
		display: grid;
		gap: 0.25rem;
	}
	.display-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
		gap: 0.65rem;
	}
	.display-options select {
		min-height: 44px;
		width: 100%;
	}
	.check {
		gap: 0.55rem;
		min-height: 44px;
	}
	.check input {
		accent-color: var(--accent);
	}
	.add {
		width: 100%;
		padding-block: 0.3rem;
	}
	h3 {
		font-size: 0.92rem;
		margin: 1.1rem 0 0.2rem;
		color: var(--muted);
	}
	.reset {
		margin-top: 1.2rem;
	}
</style>
