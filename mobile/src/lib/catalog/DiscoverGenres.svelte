<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from './catalog';
	import type { DiscoverArtistRef } from './discovery';
	import GenreDetail from './GenreDetail.svelte';
	let {
		session,
		onopen,
		onartist,
		onplay,
		names,
		active
	}: {
		session: Session;
		onopen: (a: Album) => void;
		onartist: (a: DiscoverArtistRef) => void;
		onplay: OnPlay;
		names: string[];
		active: boolean;
	} = $props();
	let name = $state(''),
		term = $state('');
	function choose(genre: string) {
		name = genre;
		term = '';
	}
	function back(event: Event) {
		if (active && name && !event.defaultPrevented) {
			event.preventDefault();
			choose('');
		}
	}
	onMount(() => {
		window.addEventListener('dn-back', back, true);
		return () => window.removeEventListener('dn-back', back, true);
	});
</script>

<section data-part="genres">
	{#if name}<button class="secondary" onclick={() => choose('')}>{uiText('All genres')}</button>
		{#key name}<GenreDetail {session} {name} {onopen} {onartist} {onplay} />{/key}
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (term.trim()) choose(term.trim());
			}}
		>
			<input
				type="search"
				aria-label={uiText('Genre name')}
				placeholder={uiText('Find a genre')}
				bind:value={term}
			/><button class="secondary" disabled={!term.trim()}>{uiText('Browse genre')}</button>
		</form>
		<div class="preview-items">
			{#each names.filter((g) => g
					.toLowerCase()
					.includes(term.trim().toLowerCase())) as g (g)}<button
					class="secondary"
					onclick={() => choose(g)}>{g}</button
				>{/each}
		</div>
	{/if}
</section>

<style>
	form {
		display: flex;
		align-items: center;
		gap: var(--gap);
		flex-wrap: wrap;
		margin-block: var(--gap);
	}
	form input {
		min-width: 0;
		flex: 1;
	}
	.preview-items button {
		min-height: var(--preview-height);
		padding: var(--preview-padding);
		text-align: start;
	}
</style>
