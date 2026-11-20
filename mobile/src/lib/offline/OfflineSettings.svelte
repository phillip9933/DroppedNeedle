<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import ViewedMediaSettings from './ViewedMediaSettings.svelte';
	import {
		cacheSizes,
		clearAutomatic,
		configureOffline,
		nativeOffline,
		offlineDefaults,
		offlineSnapshot,
		runAutoDownloads,
		watchOfflineMedia,
		storageSize,
		type OfflineOptions
	} from './media';
	let { session }: { session: Session } = $props();
	let options = $state<OfflineOptions>({ ...offlineDefaults }),
		saved = $state(0),
		cached = $state(0),
		automatic = $state(0),
		loading = $state(true),
		busy = $state(false),
		syncing = $state(false),
		confirming = $state(false),
		error = $state(''),
		receipt = $state('');
	async function read() {
		error = '';
		try {
			const state = await offlineSnapshot(session);
			options = state.options;
			const bytes = (origin: 'downloaded' | 'automatic' | 'cached') =>
				state.items.reduce((n, i) => n + (i.origin === origin ? i.bytes : 0), 0);
			saved = bytes('downloaded');
			cached = bytes('cached');
			automatic = bytes('automatic');
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
			const changedSource =
				options.autoDownload !== next.autoDownload ||
				options.downloadMiB !== next.downloadMiB ||
				(options.offlineOnly && !next.offlineOnly) ||
				(options.unmeteredOnly && !next.unmeteredOnly);
			await configureOffline(session, next);
			await read();
			busy = false;
			if (changedSource && next.autoDownload !== 'off' && !next.offlineOnly) await sync();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not save this setting.';
		} finally {
			busy = false;
		}
	}
	let syncVisit = 0;
	async function sync() {
		const visit = ++syncVisit;
		syncing = true;
		error = '';
		receipt = '';
		try {
			if (!navigator.onLine) throw Error('Reconnect to update automatic downloads.');
			const n = await runAutoDownloads(session);
			if (visit !== syncVisit) return;
			receipt = n
				? n + (n === 1 ? ' automatic download added.' : ' automatic downloads added.')
				: 'No automatic downloads added.';
		} catch (e) {
			if (visit === syncVisit && !(e instanceof DOMException && e.name === 'AbortError'))
				error = e instanceof Error ? e.message : 'Could not update automatic downloads.';
		} finally {
			if (visit === syncVisit) syncing = false;
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
		return watchOfflineMedia(read);
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
	<fieldset disabled={busy}>
		<legend>Automatic downloads</legend>
		<label
			>Download source<select
				value={options.autoDownload}
				onchange={(e) =>
					change({
						...options,
						autoDownload: e.currentTarget.value as OfflineOptions['autoDownload']
					})}
			>
				<option value="off">Off</option>
				<option value="recent">Recently added songs</option>
				<option value="favorites">Favorite songs</option>
			</select></label
		>
		{#if options.autoDownload !== 'off'}
			<p>
				Keep up to 25 of the most recently added songs from this source while the app is open. Songs
				you remove stay excluded until you save them yourself.
			</p>
			<label
				>Automatic download limit<select
					value={options.downloadMiB}
					onchange={(e) => change({ ...options, downloadMiB: Number(e.currentTarget.value) })}
				>
					{#each cacheSizes as size (size)}<option value={size}
							>{size >= 1024 ? size / 1024 + ' GiB' : size + ' MiB'}</option
						>{/each}
				</select></label
			>
			<button class="secondary" disabled={options.offlineOnly || syncing} onclick={sync}
				>Update automatic downloads</button
			>
		{/if}
	</fieldset>
	<ViewedMediaSettings {session} kind="artwork" />
	<ViewedMediaSettings {session} kind="lyrics" />
	<h2>On this device</h2>
	<dl>
		<div>
			<dt>Saved downloads</dt>
			<dd>{storageSize(saved)}</dd>
		</div>
		<div>
			<dt>Automatic downloads</dt>
			<dd>{storageSize(automatic)}</dd>
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
