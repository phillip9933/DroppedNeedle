<script lang="ts">
	import { uiText } from '../i18n';
	import { onDestroy } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, postJson, mutateJson, type Session } from '../connection';
	import { path, errorMessage, type Album } from './catalog';
	import PreviewItem from '../boards/PreviewItem.svelte';
	import type { DeckCard } from './discoveryWidgets';
	type S = components['schemas'];
	let {
		session,
		cards,
		queue,
		onopen,
		onrefresh
	}: {
		session: Session;
		cards: DeckCard[];
		queue: boolean;
		onopen: (a: Album) => void;
		onrefresh: () => void;
	} = $props();
	let busy = $state(false),
		hidden = $state(false),
		denied = $state<string[]>([]),
		ledger = $state<S['IgnoredRelease'][]>([]),
		message = $state(''),
		error = $state('');
	let live = true,
		timer: ReturnType<typeof setTimeout>;
	onDestroy(() => {
		live = false;
		clearTimeout(timer);
	});
	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = message = '';
		try {
			await action();
		} catch (cause) {
			if (live) error = errorMessage(cause);
		} finally {
			if (live) busy = false;
		}
	}
	async function showHidden() {
		const result = await getJson<S['IgnoredReleasesResponse']>(
			session,
			path('/api/v3/discover/queue/ignored')
		);
		if (live) {
			ledger = result.items;
			hidden = true;
		}
	}
	async function hide(card: DeckCard) {
		if (!card.album.group || !card.artistId) return;
		await postJson(session, path('/api/v3/discover/queue/ignore'), {
			release_group_mbid: card.album.group,
			artist_mbid: card.artistId,
			artist_name: card.album.artist,
			release_name: card.album.title
		} satisfies S['QueueIgnoreRequest']);
		if (live) {
			denied = [...denied, card.album.group];
			message = 'Album hidden from discovery.';
		}
	}
	async function restore(id: string) {
		await mutateJson(
			session,
			path('/api/v3/discover/queue/ignored/{release_group_mbid}', { release_group_mbid: id }),
			'DELETE'
		);
		if (live) {
			ledger = ledger.filter((a) => a.release_group_mbid !== id);
			denied = denied.filter((i) => i !== id);
			message = 'Album restored to discovery.';
		}
	}
	async function checkStatus(remaining: number) {
		try {
			const state = await getJson<S['DiscoverQueueStatusResponse']>(
				session,
				path('/api/v3/discover/queue/status')
			);
			if (!live) return;
			if (state.status === 'building' && remaining > 0) {
				timer = setTimeout(() => void checkStatus(remaining - 1), 4000);
				return;
			}
			if (state.status === 'ready') {
				message = 'Queue updated.';
				onrefresh();
			} else if (state.status === 'error') {
				error = state.error || 'DroppedNeedle could not build the discovery queue.';
				message = '';
			} else {
				message = 'The queue is still being prepared. Open it again to check.';
			}
		} catch (cause) {
			if (live) {
				error = errorMessage(cause);
				message = '';
			}
		}
	}
	async function refresh() {
		clearTimeout(timer);
		const result = await postJson<S['QueueGenerateResponse']>(
			session,
			path('/api/v3/discover/queue/generate'),
			{ force: true } satisfies S['QueueGenerateRequest']
		);
		if (!live) return;
		if (result.status === 'ready') {
			onrefresh();
			message = 'Queue updated.';
		} else if (result.status === 'building') {
			message = 'DroppedNeedle is updating your queue.';
			timer = setTimeout(() => void checkStatus(12), 4000);
		} else {
			error = result.error || 'DroppedNeedle could not build the discovery queue.';
		}
	}
	const shown = $derived(
		cards.filter((card) => !card.album.group || !denied.includes(card.album.group))
	);
</script>

<div class="tools">
	{#if queue}<button class="secondary" disabled={busy} onclick={() => run(refresh)}
			>{uiText('Refresh queue')}</button
		>{/if}<button
		class="secondary"
		disabled={busy}
		aria-pressed={hidden}
		onclick={() => (hidden ? (hidden = false) : run(showHidden))}
		>{hidden ? uiText('Show recommendations') : uiText('Hidden albums')}</button
	>
</div>
<div class="preview-items">
	{#if hidden}{#each ledger as row (row.release_group_mbid)}
			<PreviewItem {session} title={row.release_name} subtitle={row.artist_name}>
				{#snippet actions()}<button
						class="text-button"
						disabled={busy}
						onclick={() => run(() => restore(row.release_group_mbid))}
						>{uiText('Restore')} {row.release_name}</button
					>{/snippet}
			</PreviewItem>
		{:else}<p>{uiText('No hidden albums.')}</p>{/each}
	{:else}{#each shown as card, i (`${i}-${card.album.group ?? card.album.title}`)}
			<PreviewItem
				{session}
				part="album-card"
				title={card.album.title}
				subtitle={card.album.artist}
				detail={card.reason}
				artwork={card.album.art}
				coverSeed={card.album.group || card.album.localId || card.album.title}
				onclick={() => onopen(card.album)}
			>
				{#snippet actions()}{#if card.album.group && card.artistId}<button
							class="text-button"
							disabled={busy}
							onclick={() => run(() => hide(card))}>{uiText('Hide')} {card.album.title}</button
						>{/if}{/snippet}
			</PreviewItem>
		{:else}<p>{uiText('No recommended albums yet.')}</p>{/each}{/if}
</div>
{#if message}<p role="status">{message}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}

<style>
	.tools {
		display: flex;
		gap: 0.55rem;
		flex-wrap: wrap;
		margin-bottom: var(--gap);
	}
</style>
