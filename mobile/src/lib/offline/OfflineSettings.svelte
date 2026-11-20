<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import {
		cacheSizes,
		clearAutomatic,
		configureOffline,
		nativeOffline,
		offlineDefaults,
		offlineSnapshot,
		storageSize,
		type OfflineOptions
	} from './media';
	let { session }: { session: Session } = $props();
	let options = $state<OfflineOptions>({ ...offlineDefaults }),
		saved = $state(0),
		cached = $state(0),
		loading = $state(true),
		busy = $state(false),
		confirming = $state(false),
		error = $state(''),
		receipt = $state('');
	async function read() {
		error = '';
		try {
			const state = await offlineSnapshot(session);
			options = state.options;
			saved = state.items.reduce((n, i) => n + (i.pinned ? i.bytes : 0), 0);
			cached = state.items.reduce((n, i) => n + (i.pinned ? 0 : i.bytes), 0);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not read offline storage.';
		} finally {
			loading = false;
		}
	}
	async function change(next: OfflineOptions) {
		if (busy) return;
		busy = true;
		receipt = '';
		try {
			await configureOffline(session, next);
			await read();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not save this setting.';
		} finally {
			busy = false;
		}
	}
	async function clear() {
		busy = true;
		confirming = false;
		try {
			await clearAutomatic(session);
			await read();
			receipt = 'Playback cache cleared.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not clear the playback cache.';
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void read();
	});
</script>

{#if loading}<p role="status">Reading device storage…</p>
{:else}
	<fieldset disabled={busy}>
		<legend>Playback</legend>
		<label
			><input
				type="checkbox"
				checked={options.offlineOnly}
				onchange={(e) => change({ ...options, offlineOnly: e.currentTarget.checked })}
			/>Play only offline music</label
		>
		<label
			><input
				type="checkbox"
				checked={options.autoCache}
				onchange={(e) => change({ ...options, autoCache: e.currentTarget.checked })}
			/>Cache songs during playback</label
		>
		<p>
			Completed streams stay available offline. Older cached songs are removed when the cache fills.
		</p>
		<label
			>Playback cache limit<select
				value={options.cacheMiB}
				onchange={(e) => change({ ...options, cacheMiB: Number(e.currentTarget.value) })}
				>{#each cacheSizes as size (size)}<option value={size}
						>{size >= 1024 ? size / 1024 + ' GiB' : size + ' MiB'}</option
					>{/each}</select
			></label
		>
		{#if nativeOffline}<label
				><input
					type="checkbox"
					checked={options.unmeteredOnly}
					onchange={(e) => change({ ...options, unmeteredOnly: e.currentTarget.checked })}
				/>Download and cache only on unmetered networks</label
			>{/if}
	</fieldset>
	<h2>On this device</h2>
	<dl>
		<div>
			<dt>Saved downloads</dt>
			<dd>{storageSize(saved)}</dd>
		</div>
		<div>
			<dt>Playback cache</dt>
			<dd>{storageSize(cached)}</dd>
		</div>
	</dl>
	<button
		class="secondary"
		disabled={busy}
		onclick={() => window.dispatchEvent(new Event('dn-open-offline'))}>Open offline music</button
	>
	{#if confirming}<p>
			Clear {storageSize(cached)} of cached music? Saved downloads will stay on this device.
		</p>
		<button class="secondary" onclick={() => (confirming = false)}>Cancel</button><button
			class="primary"
			onclick={clear}>Confirm clear cache</button
		>
	{:else}<button class="text-button" disabled={busy || !cached} onclick={() => (confirming = true)}
			>Clear playback cache</button
		>{/if}
{/if}
{#if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={read}>Try again</button>{/if}
{#if receipt}<p role="status">{receipt}</p>{/if}

<style>
	fieldset {
		border: 0;
		padding: 0;
		display: grid;
		gap: 0.65rem;
		margin: 1rem 0;
	}
	legend,
	h2 {
		font-weight: 700;
		font-size: 1.1rem;
		margin: 0 0 0.6rem;
		padding: 0;
	}
	label,
	dl div {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		min-height: 44px;
	}
	select,
	dd {
		margin-inline-start: auto;
	}
	dl {
		padding: 0;
		margin: 0;
	}
	p {
		color: var(--muted);
		margin: 0;
		line-height: 1.45;
	}
</style>
