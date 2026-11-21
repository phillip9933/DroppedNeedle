<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { nativeMedia as journal, type HistoryStatus } from './nativeMedia';
	let { session }: { session: Session } = $props();
	const owner = $derived({ serverUrl: session.serverUrl, userId: session.userId ?? '' });
	let status = $state<HistoryStatus>(),
		confirming = $state(false),
		busy = $state(false),
		error = $state(''),
		notice = $state('');
	let serial = 0;

	async function read() {
		const request = ++serial;
		try {
			const value = await journal.historySettings(owner);
			if (request !== serial) return;
			status = value;
			if (!value.pending) confirming = false;
			error = '';
		} catch {
			if (request === serial) error = 'Could not read offline listening history.';
		}
	}
	onMount(() => {
		void read();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const handle = journal.addListener('historyChanged', () => {
			if (!timer)
				timer = setTimeout(() => {
					timer = undefined;
					void read();
				}, 150);
		});
		return () => {
			serial++;
			clearTimeout(timer);
			void handle.then((listener) => listener.remove()).catch(() => {});
		};
	});
	async function change(enabled?: boolean) {
		busy = true;
		serial++;
		notice = error = '';
		try {
			status =
				enabled === undefined
					? await journal.discardOfflineHistory(owner)
					: await journal.setOfflineHistory({ ...owner, enabled });
			confirming = false;
			if (enabled === undefined) notice = 'Pending listens discarded.';
		} catch {
			await read();
			error = 'Could not update offline listening history.';
		} finally {
			busy = false;
		}
	}
</script>

<h2 id="offline-listening">Offline listening history</h2>
<fieldset
	class="settings-panel"
	data-surface="panel"
	aria-labelledby="offline-listening"
	disabled={busy}
>
	{#if status}
		<label
			><input
				type="checkbox"
				checked={status.enabled}
				onchange={(e) => change(e.currentTarget.checked)}
			/>Record offline listens</label
		>
		<p>
			Completed offline listens sync to your DN history when you reconnect within 14 days. Turning
			this off also pauses pending submissions.
		</p>
		{#if status.pending}
			<p role="status">
				{status.pending}
				{status.pending === 1 ? 'listen waiting to sync.' : 'listens waiting to sync.'}
			</p>
			{#if confirming}
				<p>Discard all pending listens for this DN account?</p>
				<div class="settings-actions">
					<button class="secondary" onclick={() => (confirming = false)}>Cancel</button>
					<button class="primary" onclick={() => change()}>Confirm discard</button>
				</div>
			{:else}
				<button class="text-button" onclick={() => (confirming = true)}
					>Discard pending listens</button
				>
			{/if}
		{/if}
	{/if}
	{#if error}<p role="alert">{error}</p>
		<button class="text-button" onclick={read}>Try again</button>{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
</fieldset>
