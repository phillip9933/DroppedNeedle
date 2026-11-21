<script lang="ts">
	import { onMount } from 'svelte';
	import { ListPlus } from '@lucide/svelte';
	import { player, type PlayerTrack } from '../player';
	import { tr } from '../i18n';
	import type { Session } from '../connection';
	import { preferredOffline } from '../offline/media';
	import { errorMessage } from '../catalog/catalog';
	import { similarTracks } from './autoplay';

	let { session, tracks }: { session: Session; tracks: PlayerTrack[] } = $props();
	let suggestions = $state<PlayerTrack[]>([]);
	let loading = $state(true),
		adding = $state(''),
		problem = $state(''),
		receipt = $state('');
	let controller: AbortController | undefined;
	const inQueue = $derived(new Set(tracks.map((track) => track.id)));
	const available = $derived(suggestions.filter((track) => !inQueue.has(track.id)));
	async function load() {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		problem = receipt = '';
		loading = true;
		suggestions = [];
		try {
			if (!navigator.onLine || (await preferredOffline(session)))
				throw Error(
					tr(
						'Go online to preview similar music.',
						'似た曲を表示するにはオンラインにしてください。'
					)
				);
			request.signal.throwIfAborted();
			const items = await similarTracks(session, tracks, request.signal);
			if (!request.signal.aborted) suggestions = items;
		} catch (error) {
			if (!request.signal.aborted) problem = errorMessage(error);
		} finally {
			if (!request.signal.aborted) loading = false;
		}
	}
	async function add(track: PlayerTrack) {
		if (adding || inQueue.has(track.id)) return;
		adding = track.id;
		problem = receipt = '';
		try {
			await player.enqueue([track], session, 'upNext');
			receipt = track.title + ' · ' + tr('Added to Up Next.', '次の再生リストに追加しました。');
		} catch (error) {
			problem = errorMessage(error);
		} finally {
			adding = '';
		}
	}
	onMount(() => {
		void load();
		window.addEventListener('offline', load);
		window.addEventListener('dn-offline-policy', load);
		return () => {
			controller?.abort();
			window.removeEventListener('offline', load);
			window.removeEventListener('dn-offline-policy', load);
		};
	});
</script>

{#if loading}<p role="status">
		{tr('Finding similar library tracks…', 'ライブラリで似た曲を検索中…')}
	</p>{/if}
{#if problem}<p role="alert">{problem}</p>{/if}
{#if receipt}<p role="status">{receipt}</p>{/if}
{#if !loading}
	{#each available as track (track.id)}
		<div class="candidate">
			<span><strong>{track.title}</strong><small>{track.artist}</small></span>
			<button
				class="icon-button"
				disabled={!!adding}
				aria-label={tr('Add to Up Next', '次の再生リストに追加') + ' · ' + track.title}
				onclick={() => add(track)}><ListPlus size={20} /></button
			>
		</div>
	{/each}
	<button class="text-button" disabled={!!adding} onclick={load}
		>{tr('Refresh suggestions', '候補を更新')}</button
	>
{/if}

<style>
	.candidate {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-block: 0.4rem;
		border-bottom: 1px solid var(--line);
	}
	.candidate span {
		display: grid;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	small {
		color: var(--muted);
	}
</style>
