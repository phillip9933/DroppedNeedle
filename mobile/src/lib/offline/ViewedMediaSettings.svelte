<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { mediaLimits, cacheUsage, setCacheLimit, type MediaKind } from './viewedMedia';
	import { storageSize } from './media';
	let { session, kind }: { session: Session; kind: MediaKind } = $props();
	const art = $derived(kind === 'artwork');
	const label = $derived(art ? 'Artwork' : 'Lyrics');
	const contents = $derived(art ? 'covers' : 'lyrics');
	let info = $state<Awaited<ReturnType<typeof cacheUsage>>>(),
		busy = $state(false),
		confirming = $state(false),
		error = $state('');
	async function refresh() {
		try {
			info = await cacheUsage(session, kind);
		} catch {
			error = 'Storage is unavailable on this device.';
		}
	}
	async function change(limit: number, clear = false) {
		busy = true;
		error = '';
		try {
			await setCacheLimit(session, kind, limit, clear);
			confirming = false;
			await refresh();
		} catch {
			error = 'Could not update the cache.';
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void refresh();
	});
</script>

<fieldset disabled={busy}>
	<legend>{art ? 'Cover artwork' : 'Lyrics'}</legend>
	{#if info}
		<label
			>{label} cache limit<select
				value={info.limit}
				onchange={(e) => change(Number(e.currentTarget.value))}
				>{#each mediaLimits[kind] as limit (limit)}<option value={limit}
						>{limit ? limit + ' MiB' : 'Off (remove cached ' + contents + ')'}</option
					>{/each}</select
			></label
		>
		<p>
			{info.count.toLocaleString()}
			{art ? (info.count === 1 ? 'cover' : 'covers') : info.count === 1 ? 'track' : 'tracks'} · {storageSize(
				info.bytes
			)}. {#if info.limit}{art
					? 'Covers you’ve viewed are available offline.'
					: 'Lyrics you’ve opened are available offline.'}{/if}
		</p>
		{#if confirming}<p>Remove the cached {contents} for this account from this device?</p>
			<div>
				<button class="secondary" onclick={() => (confirming = false)}>Cancel</button><button
					class="secondary"
					onclick={() => change(info!.limit, true)}>Remove cached {contents}</button
				>
			</div>
		{:else}<button class="text-button" disabled={!info.count} onclick={() => (confirming = true)}
				>Clear {kind} cache</button
			>{/if}
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</fieldset>

<style>
	fieldset {
		display: grid;
		gap: 0.6rem;
		padding: 0;
		margin: 1rem 0;
		border: 0;
	}
	legend {
		font-size: 1.1rem;
		font-weight: 700;
	}
	label,
	div {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
	}
	select {
		margin-inline-start: auto;
		min-width: 0;
	}
	p {
		color: var(--muted);
		margin: 0;
	}
	.text-button {
		justify-self: start;
	}
</style>
