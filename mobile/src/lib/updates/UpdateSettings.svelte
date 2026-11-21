<script lang="ts">
	import { storageSize } from '../offline/media';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { nativeUpdates, type AndroidUpdateState } from './androidUpdates';

	let {
		snapshot,
		readError,
		onrefresh
	}: {
		snapshot: AndroidUpdateState | null;
		readError: string;
		onrefresh: () => Promise<void> | undefined;
	} = $props();

	let pending = $state('');
	let actionError = $state('');
	let command = 0;
	const release = $derived(snapshot?.available);
	const error = $derived(actionError || readError || snapshot?.error);
	const working = $derived(Boolean(pending || snapshot?.checking || snapshot?.downloading));

	async function run(name: string, action: () => Promise<void>) {
		const id = ++command;
		pending = name;
		actionError = '';
		try {
			await action();
		} catch (e) {
			if (id === command)
				actionError = e instanceof Error ? e.message : 'Could not complete the update.';
		} finally {
			if (id === command) {
				await onrefresh();
				if (id === command) pending = '';
			}
		}
	}
</script>

{#if snapshot}
	<dl class="settings-facts" data-surface="panel">
		<div>
			<dt>Installed version</dt>
			<dd>{snapshot.installedVersion}</dd>
		</div>
		{#if snapshot.supported}
			<div>
				<dt>Last checked</dt>
				<dd>
					{#if snapshot.lastChecked}<time datetime={new Date(snapshot.lastChecked).toISOString()}
							>{new Date(snapshot.lastChecked).toLocaleString(undefined, {
								dateStyle: 'medium',
								timeStyle: 'short'
							})}</time
						>{:else}Never{/if}
				</dd>
			</div>
		{/if}
	</dl>
	{#if snapshot.supported}
		{#if snapshot.checking || pending === 'check'}
			<p role="status">Checking GitHub for updates…</p>
		{:else if !release && snapshot.lastChecked && !error}
			<p role="status">You’re up to date on the {snapshot.channel} channel.</p>
		{/if}
		<button
			class="secondary"
			disabled={working}
			onclick={() => run('check', () => nativeUpdates.check())}>Check for updates</button
		>

		{#if release}
			{@const tag = release.tag}
			<h2>Version {release.version}</h2>
			<div class="settings-panel" data-surface="panel">
				{#if snapshot.ready}
					<p role="status">Verified and ready to install.</p>
					{#if snapshot.canInstall}
						<button
							class="primary"
							disabled={working}
							onclick={() => run('install', () => nativeUpdates.install({ tag }))}
							>Install update</button
						>
					{:else}
						<p>
							Allow DroppedNeedle to install apps in Android settings, then return here to install
							this update.
						</p>
						<button
							class="secondary"
							disabled={working}
							onclick={() => run('permission', () => nativeUpdates.openInstallSettings())}
							>Allow app installs</button
						>
					{/if}
				{:else if snapshot.downloading}
					<span class="download-size"
						>{storageSize(snapshot.bytesDownloaded)} of {storageSize(release.sizeBytes)}</span
					>
					<progress
						aria-label="Update download"
						max={release.sizeBytes}
						value={snapshot.bytesDownloaded}
					></progress>
					<button
						class="secondary"
						disabled={pending === 'cancel'}
						onclick={() => run('cancel', () => nativeUpdates.cancelDownload())}
						>Cancel download</button
					>
				{:else}
					<p>Android download · {storageSize(release.sizeBytes)}</p>
					<button
						class="primary"
						disabled={working}
						onclick={() => run('download', () => nativeUpdates.download({ tag }))}
						>Download update</button
					>
				{/if}
				{#if snapshot.offer && !snapshot.downloading}
					<button
						class="text-button"
						disabled={working}
						onclick={() => run('dismiss', () => nativeUpdates.dismiss({ tag }))}
						>Dismiss reminder</button
					>
				{/if}
			</div>
			{#if release.notes?.trim()}
				<details class="settings-disclosure" data-surface="panel">
					<summary>Release notes</summary>
					<p class="notes" dir="auto">{release.notes.slice(0, 8000)}</p>
				</details>
			{/if}
		{/if}
	{:else}
		<p>Installing updates from GitHub requires Android 8 or later.</p>
	{/if}
{:else if !error}
	<p role="status">Reading installed version…</p>
{/if}

{#if error}
	<p role="alert">{error}</p>
	{#if readError}<button class="secondary" onclick={onrefresh}>Reload update status</button>{/if}
{/if}

{#if snapshot?.supported}
	<h2>GitHub updates</h2>
	<div class="settings-panel" data-surface="panel">
		<label
			>Release channel
			<InlineChoice selected={snapshot.channel} label="Release channel">
				<select
					value={snapshot.channel}
					disabled={working}
					onchange={(event) => {
						const channel = event.currentTarget.value === 'beta' ? 'beta' : 'stable';
						void run('preferences', () => nativeUpdates.setPreferences({ channel }));
					}}
				>
					<option value="stable">Stable</option>
					<option value="beta">Beta</option>
				</select>
			</InlineChoice>
		</label>
		<label
			><input
				type="checkbox"
				checked={snapshot.automaticChecks}
				disabled={working}
				onchange={(event) => {
					const automaticChecks = event.currentTarget.checked;
					void run('preferences', () => nativeUpdates.setPreferences({ automaticChecks }));
				}}
			/>Check automatically</label
		>
		<label
			><input
				type="checkbox"
				checked={snapshot.wifiDownload}
				disabled={working}
				onchange={(event) => {
					const wifiDownload = event.currentTarget.checked;
					void run('preferences', () => nativeUpdates.setPreferences({ wifiDownload }));
				}}
			/>Download automatically on Wi-Fi</label
		>
	</div>
{/if}

<style>
	progress {
		width: 100%;
		accent-color: var(--accent);
	}
	.download-size {
		font-variant-numeric: tabular-nums;
	}
	.notes {
		white-space: pre-line;
	}
</style>
