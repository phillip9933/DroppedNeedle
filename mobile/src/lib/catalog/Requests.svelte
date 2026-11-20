<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight, RefreshCw } from '@lucide/svelte';
	import type { Session } from '../connection';
	import {
		activeRequests,
		requestHistory,
		requestedAlbum,
		statusLabel,
		errorMessage,
		type Album,
		type RequestItem
	} from './catalog';
	let { session, onopen }: { session: Session; onopen: (a: Album) => void } = $props();
	let active = $state<RequestItem[]>([]),
		history = $state<RequestItem[]>([]);
	let busy = $state(false),
		error = $state(''),
		page = $state(1),
		pages = $state(1);
	let mounted = true;
	async function refresh(wanted = page) {
		if (busy) return;
		busy = true;
		try {
			const [live, past] = await Promise.all([
				activeRequests(session),
				requestHistory(session, wanted)
			]);
			if (!mounted) return;
			active = live.items;
			history = past.items;
			page = past.page;
			pages = past.total_pages;
			error = '';
		} catch (e) {
			if (mounted) error = errorMessage(e);
		} finally {
			if (mounted) busy = false;
		}
	}
	onMount(() => {
		const visible = () => {
			if (!document.hidden) void refresh();
		};
		void refresh();
		const timer = setInterval(visible, 15000);
		document.addEventListener('visibilitychange', visible);
		return () => {
			mounted = false;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', visible);
		};
	});
</script>

<div class="heading">
	<h1>Requests</h1>
	<button
		class="icon-button"
		aria-label="Refresh requests"
		disabled={busy}
		onclick={() => refresh()}><RefreshCw size={20} /></button
	>
</div>
{#if error}<p role="alert">{error}</p>{/if}
{#snippet rows(items: RequestItem[])}
	<div data-part="request-list">
		{#each items as r (r)}
			{@const album = requestedAlbum(r)}
			<button class="request" disabled={!album} onclick={() => album && onopen(album)}>
				<span
					><strong>{r.track_title || r.album_title}</strong><small
						>{r.artist_name} · {statusLabel(
							r
						)}{#if r.progress != null && r.status === 'downloading'}
							· {Math.round(r.progress)}%{/if}</small
					>
					{#if r.error_message}<small>{r.error_message}</small>{/if}</span
				>
				{#if album}<ChevronRight size={18} aria-hidden="true" />{/if}
			</button>
		{/each}
	</div>
{/snippet}
{#if active.length}<h2>Active</h2>
	{@render rows(active)}{/if}
{#if history.length}<h2>History</h2>
	{@render rows(history)}{/if}
{#if pages > 1}
	<div class="pagination">
		<button class="secondary" disabled={busy || page < 2} onclick={() => refresh(page - 1)}
			>Previous</button
		>
		<span>{page} / {pages}</span><button
			class="secondary"
			disabled={busy || page >= pages}
			onclick={() => refresh(page + 1)}>Next</button
		>
	</div>
{/if}
{#if !active.length && !history.length && !error}<p role="status">
		{busy ? 'Loading requests…' : 'No requests yet.'}
	</p>{/if}

<style>
	.heading,
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
	}
	.pagination {
		margin-block: var(--gap);
	}
	.request {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		background: transparent;
		color: var(--text);
		border: 0;
		border-bottom: 1px solid var(--line);
		width: 100%;
		text-align: start;
		padding: 0.8rem 0;
		min-height: 3.4rem;
	}
	.request span {
		min-width: 0;
	}
	.request strong,
	.request small {
		display: block;
		overflow-wrap: anywhere;
	}
	.request small {
		color: var(--muted);
		margin-top: 0.2rem;
	}
</style>
