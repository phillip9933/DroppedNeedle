<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { labels, asTheme, type Mode, type Palette, type Theme } from './theme';
	import type { PaletteReview } from './webPalette';
	type CssSave = components['schemas']['CssSave'];
	let {
		session,
		css,
		mode,
		onapply
	}: { session: Session; css: string; mode: Mode; onapply: (theme: Theme) => void } = $props();
	let open = $state(false),
		picked = $state('current'),
		palette = $state<Palette>('dark'),
		history = $state<CssSave[]>([]),
		historyError = $state(''),
		reload = $state(0),
		review = $state<PaletteReview | null>(null),
		problem = $state('');
	$effect(() => {
		const current = mode;
		palette = asTheme({ mode: current }).base ?? 'dark';
	});
	$effect(() => {
		if (!open) return;
		const account = session;
		void reload;
		let live = true;
		history = [];
		historyError = '';
		void getJson<CssSave[]>(account, '/api/v3/me/appearance/css-saves').then(
			(rows) => {
				if (live) history = rows;
			},
			(cause) => {
				if (live)
					historyError = cause instanceof Error ? cause.message : 'Could not load saved styles.';
			}
		);
		return () => {
			live = false;
		};
	});
	const source = $derived(
		picked === 'current' ? css : (history.find((row) => String(row.id) === picked)?.css ?? '')
	);
	$effect(() => {
		if (!open) return;
		const text = source,
			base = palette;
		let live = true;
		review = null;
		problem = '';
		if (text.trim())
			void import('./webPalette')
				.then(({ reviewPalette }) => {
					if (live) review = reviewPalette(text, base);
				})
				.catch(() => {
					if (live) problem = 'This stylesheet could not be read.';
				});
		return () => {
			live = false;
		};
	});
</script>

<details class="settings-disclosure" data-surface="panel" bind:open>
	<summary>Import colors from a web style</summary>
	{#if open}
		<label
			>Web style<InlineChoice selected={picked}
				><select bind:value={picked}
					><option value="current">Current account CSS</option
					>{#each history as row (row.id)}<option value={String(row.id)}
							>Saved {new Date(row.saved_at).toLocaleString()} · #{row.id}</option
						>{/each}</select
				></InlineChoice
			></label
		>
		<label
			>Palette to import<InlineChoice selected={palette}
				><select bind:value={palette}
					>{#each ['dark', 'light', 'midnight'] as name (name)}<option value={name}
							>{labels[name as Palette]}</option
						>{/each}</select
				></InlineChoice
			></label
		>
		{#if historyError}<p role="alert">{historyError}</p>
			<button class="text-button" onclick={() => reload++}>Reload saved styles</button>{/if}
		{#if !source.trim()}<p>This style has no saved CSS.</p>{:else if problem}<p role="alert">
				{problem}
			</p>
		{:else if review}{#if review.applied.length}<p>
					{review.applied.length} compatible {review.applied.length === 1
						? 'variable'
						: 'variables'} in the {labels[palette]} palette.
				</p>
				<ul>
					{#each review.applied as entry (entry.key)}<li>
							{#if entry.value.startsWith('#')}<i
									style:background-color={entry.value}
									aria-hidden="true"
								></i>{/if}<code>{entry.key}</code>
							{entry.value}
						</li>{/each}
				</ul>
			{:else}<p>No compatible palette variables found.</p>{/if}
			{#if review.skipped.length}<p>Skipped web-only rules or unsupported values</p>
				<ul>
					{#each review.skipped as text (text)}<li><code>{text}</code></li>{/each}
				</ul>{/if}
			{#if review.otherModes.length}<p>
					Rules for other themes were excluded from this palette.
				</p>{/if}
			{#if review.applied.length}<button
					class="secondary"
					onclick={() => {
						if (review) onapply(review.theme);
					}}>Apply palette to this device</button
				>{/if}{/if}
	{/if}
</details>

<style>
	label {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.65rem;
	}
	select {
		min-width: 0;
		max-width: 100%;
	}
	ul {
		list-style: none;
		padding: 0;
		margin-block: 0.5rem 1rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	li code {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	i {
		display: inline-block;
		width: 1.05rem;
		height: 1.05rem;
		border-radius: 0.2rem;
		border: 1px solid var(--line);
	}
</style>
