<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
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

<h2 id={kind + '-cache-settings'}>{art ? 'Cover artwork' : 'Lyrics'}</h2>
<fieldset
	class="settings-panel"
	data-surface="panel"
	aria-labelledby={kind + '-cache-settings'}
	disabled={busy}
>
	{#if info}
		<label
			>{label} cache limit<InlineChoice selected={info.limit}
				><select value={info.limit} onchange={(e) => change(Number(e.currentTarget.value))}
					>{#each mediaLimits[kind] as limit (limit)}<option value={limit}
							>{limit ? limit + ' MiB' : 'Off (remove cached ' + contents + ')'}</option
						>{/each}</select
				></InlineChoice
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
			<div class="settings-actions">
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
