<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import { nativeMedia, type ManualStatus } from './nativeMedia';

	let { serverUrl, userId }: { serverUrl: string; userId: string } = $props();
	let status = $state<ManualStatus>(),
		error = $state(''),
		busy = $state(false);
	let revision = 0,
		active = true;
	const labels: Record<ManualStatus['state'], string> = {
		idle: '',
		queued: 'Queued for download',
		downloading: 'Downloading',
		waitingNetwork: 'Waiting for an allowed network',
		waitingOffline: 'Waiting for offline-only playback to be turned off',
		failed: 'Some downloads need attention',
		complete: 'Downloads complete'
	};

	async function refresh() {
		const request = ++revision;
		try {
			const result = await nativeMedia.manualStatus({ serverUrl, userId });
			if (active && request === revision) {
				status = result;
				error = '';
			}
		} catch {
			if (active && request === revision) error = 'Could not check your download queue.';
		}
	}

	onMount(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const handle = nativeMedia.addListener('manualChanged', () => {
			if (!active || document.hidden || timer !== undefined) return;
			timer = setTimeout(() => {
				timer = undefined;
				void refresh();
			}, 120);
		});
		const show = () => {
			if (active && !document.hidden) void refresh();
		};
		document.addEventListener('visibilitychange', show);
		void handle.then(show, show);
		return () => {
			active = false;
			revision++;
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', show);
			void handle.then((listener) => listener.remove()).catch(() => {});
		};
	});

	async function update(which: 'cancel' | 'retry') {
		busy = true;
		error = '';
		revision++;
		try {
			const owner = { serverUrl, userId };
			if (which === 'cancel') await nativeMedia.cancelManual(owner);
			else await nativeMedia.retryManual(owner);
			if (active) await refresh();
		} catch {
			if (active)
				error =
					which === 'cancel'
						? 'Could not clear your download queue.'
						: 'Could not retry these downloads.';
		} finally {
			if (active) busy = false;
		}
	}
</script>

{#if status?.total || error}
	<section class="downloads" aria-label={uiText('Download queue')}>
		<h2>{uiText('Download queue')}</h2>
		{#if status?.total}
			<p role="status">
				{labels[status.state]} · {status.saved.toLocaleString()}
				{uiText('of')}
				{status.total.toLocaleString()}
				{uiText('saved')}{status.failed ? ' · ' + status.failed.toLocaleString() + ' failed' : ''}
			</p>
			{#if status.current}<p class="current">
					{status.current.title}{status.current.artist ? ' · ' + status.current.artist : ''}
				</p>{/if}
			{#if status.pending}<progress
					aria-label={uiText('Songs saved')}
					value={status.saved}
					max={status.total}
				></progress>{/if}
			{#if status.failures?.length}
				<ul aria-label={uiText('Failed songs')}>
					{#each status.failures as song (song.id)}
						<li>
							<strong>{song.title}{song.artist ? ' · ' + song.artist : ''}</strong><span
								>{song.reason}</span
							>
						</li>
					{/each}
				</ul>
				{#if status.failed > status.failures.length}<p>
						{(status.failed - status.failures.length).toLocaleString()}
						{uiText('more failed.')}
					</p>{/if}
			{:else if status.failed && status.lastError}<p>{status.lastError}</p>{/if}
			<div class="actions">
				{#if status.failed}<button class="secondary" disabled={busy} onclick={() => update('retry')}
						>{uiText('Retry failed downloads')}</button
					>{/if}
				<button class="text-button" disabled={busy} onclick={() => update('cancel')}
					>{status.pending
						? uiText('Cancel remaining downloads')
						: uiText('Dismiss download summary')}</button
				>
			</div>
		{/if}
		{#if error}<p role="alert">{error}</p>
			<button class="text-button" onclick={refresh}>{uiText('Check again')}</button>{/if}
	</section>
{/if}

<style>
	.downloads {
		display: grid;
		gap: 0.4rem;
		padding-block: 0.65rem;
		border-bottom: 1px solid var(--line);
	}
	h2,
	p {
		margin: 0;
	}
	h2 {
		font-size: 1rem;
	}
	p {
		color: var(--muted);
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		display: grid;
		padding-block: 0.25rem;
		font-size: 0.9rem;
	}
	li,
	.current {
		overflow-wrap: anywhere;
	}
	li span {
		color: var(--muted);
	}
	progress {
		width: 100%;
		height: 0.4rem;
		accent-color: var(--accent);
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.text-button {
		justify-self: start;
	}
</style>
