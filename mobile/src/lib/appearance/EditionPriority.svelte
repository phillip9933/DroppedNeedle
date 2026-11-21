<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { ArrowDown, ArrowUp, ChevronDown, X } from '@lucide/svelte';
	import { tr, uiText } from '../i18n';
	import { openChoice, releaseChoice } from '../controls/inlineChoices';
	import { editionOptions, type EditionList } from './editionOptions';

	let {
		kind,
		title,
		saved,
		values,
		disabled,
		onchange
	}: {
		kind: EditionList;
		title: string;
		saved: string[];
		values: string[];
		disabled: boolean;
		onchange: (values: string[]) => void;
	} = $props();
	const id = $props.id();
	let open = $state(false),
		filter = $state('');
	let picker: HTMLDivElement, trigger: HTMLButtonElement;
	const preset = $derived(editionOptions(kind, tr('en', 'ja')));
	const choices = $derived.by(() => {
		const options = new SvelteMap(preset.map((o) => [o.value, o.label]));
		for (const value of [...saved, ...values]) if (!options.has(value)) options.set(value, value);
		return options;
	});
	const query = $derived(filter.trim().toLowerCase());
	const matches = $derived(
		[...choices].filter(
			([value, label]) =>
				!values.includes(value) && (value + ' ' + label).toLowerCase().includes(query)
		)
	);
	const custom = $derived(kind === 'countries' ? filter.trim().toUpperCase() : query);
	const canAddCustom = $derived(
		!!custom &&
			(kind === 'countries'
				? /^[A-Za-z]{2}$/.test(filter.trim())
				: new TextEncoder().encode(custom).length <= 64) &&
			!choices.has(custom) &&
			![...choices.values()].some((label) => label.toLowerCase() === query)
	);
	const add = $derived(
		kind === 'countries'
			? tr('Add country', '国を追加')
			: kind === 'format_order'
				? tr('Add format', '形式を追加')
				: tr('Add release status', 'リリース状態を追加')
	);
	const search = $derived(
		kind === 'countries'
			? tr('Find a country', '国を検索')
			: kind === 'format_order'
				? tr('Find a format', '形式を検索')
				: tr('Find a release status', 'リリース状態を検索')
	);

	function dismiss(focus = false) {
		open = false;
		filter = '';
		releaseChoice(dismiss);
		if (focus) trigger?.focus({ preventScroll: true });
	}
	function toggle() {
		if (open) return dismiss();
		openChoice(dismiss);
		open = true;
	}
	onDestroy(() => releaseChoice(dismiss));
	$effect(() => {
		if (!open) return;
		const events = new AbortController();
		function outside(event: Event) {
			if (event.target instanceof Node && !picker.contains(event.target)) dismiss();
		}
		document.addEventListener('click', outside, { capture: true, signal: events.signal });
		document.addEventListener('focusin', outside, { signal: events.signal });
		return () => events.abort();
	});
	function append(value: string) {
		if (!disabled && !values.includes(value)) onchange([...values, value]);
		dismiss(true);
	}
	function move(at: number, by: number) {
		const next = [...values];
		[next[at], next[at + by]] = [next[at + by], next[at]];
		onchange(next);
	}
</script>

<h2 id={id + '-title'}>{kind === 'countries' ? tr('Countries', '国・地域') : uiText(title)}</h2>
<fieldset class="settings-panel" data-surface="panel" aria-labelledby={id + '-title'} {disabled}>
	{#if values.length}
		<ol>
			{#each values as value, index (value)}
				{@const label = choices.get(value) ?? value}
				<li>
					<span class="rank" aria-hidden="true">{index + 1}</span>
					<span class="name">{label}</span>
					<button
						type="button"
						disabled={index === 0}
						aria-label={tr('Move ' + label + ' up', label + 'を上へ')}
						onclick={() => move(index, -1)}><ArrowUp size={17} /></button
					>
					<button
						type="button"
						disabled={index === values.length - 1}
						aria-label={tr('Move ' + label + ' down', label + 'を下へ')}
						onclick={() => move(index, 1)}><ArrowDown size={17} /></button
					>
					<button
						type="button"
						aria-label={tr('Remove ' + label, label + 'を削除')}
						onclick={() => onchange(values.filter((v) => v !== value))}><X size={17} /></button
					>
				</li>
			{/each}
		</ol>
	{:else}
		<p>
			{kind === 'countries'
				? tr('Store region, then worldwide.', 'ストアの地域、次に全世界。')
				: tr('No preference.', '指定なし。')}
		</p>
	{/if}
	<div class="picker" bind:this={picker}>
		<button
			class="add secondary"
			type="button"
			aria-expanded={open}
			aria-controls={id + '-options'}
			bind:this={trigger}
			disabled={kind !== 'countries' && values.length >= 32}
			onclick={toggle}
		>
			{add}<ChevronDown size={17} />
		</button>
		<div id={id + '-options'} hidden={!open}>
			{#if open}
				<input type="search" aria-label={search} placeholder={search} bind:value={filter} />
				<div class="options">
					{#each matches as [value, label] (value)}
						<button type="button" onclick={() => append(value)}>{label}</button>
					{/each}
					{#if canAddCustom}
						<button type="button" onclick={() => append(custom)}
							>{tr('Use custom value “' + custom + '”', '「' + custom + '」を追加')}</button
						>
					{:else if !matches.length}
						<p>{tr('No available choices match.', '追加できる候補はありません。')}</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</fieldset>

<style>
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) repeat(3, 44px);
		align-items: center;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.rank {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		margin-inline-end: 0.55rem;
	}
	.name {
		overflow-wrap: anywhere;
	}
	li button {
		display: grid;
		place-items: center;
		width: 44px;
		min-height: 44px;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.add[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}
	.picker input {
		margin-block: 0.5rem;
		width: 100%;
	}
	.options {
		display: grid;
		max-height: min(42dvh, 18rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.options button {
		min-height: 44px;
		padding: 0.4rem 0.6rem;
		text-align: start;
		overflow-wrap: anywhere;
		border-block-end: 1px solid var(--line);
	}
</style>
