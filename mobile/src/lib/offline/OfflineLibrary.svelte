<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckSquare, Download, Music2, Play, Trash2 } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { player, type PlayerTrack } from '../player';
	import {
		watchOfflineMedia,
		offlineSnapshot,
		removeOffline,
		saveOfflineTracks,
		storageSize,
		type OfflineItem
	} from './media';
	let {
		session,
		onplay
	}: { session: Session; onplay: (tracks: PlayerTrack[], index: number) => void | Promise<void> } =
		$props();
	let items = $state<OfflineItem[]>([]),
		view = $state<'downloaded' | 'automatic' | 'cached'>('downloaded'),
		filter = $state(''),
		selected = $state<string[] | null>(null),
		remove = $state<string[] | null>(null),
		busy = $state(false),
		loading = $state(true),
		notice = $state(''),
		error = $state('');
	let section: HTMLElement;
	const matching = $derived(
		items.filter(
			(i) =>
				view === i.origin &&
				[i.track.title, i.track.artist, i.track.album]
					.join(' ')
					.toLocaleLowerCase()
					.includes(filter.trim().toLocaleLowerCase())
		)
	);
	const picked = $derived(items.filter((i) => selected?.includes(i.track.id)).map((i) => i.track));
	async function read() {
		try {
			items = (await offlineSnapshot(session)).items;
			if (selected) selected = selected.filter((id) => items.some((i) => i.track.id === id));
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not read offline music.';
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void read();
		const stop = watchOfflineMedia(read);
		function back(event: Event) {
			if (!section?.getClientRects().length || (!remove && !selected)) return;
			if (remove) remove = null;
			else selected = null;
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		window.addEventListener('dn-back', back, true);
		return () => {
			stop();
			window.removeEventListener('dn-back', back, true);
		};
	});
	function choose(next: typeof view) {
		if (busy) return;
		view = next;
		filter = '';
		selected = null;
		remove = null;
		notice = '';
	}
	function toggle(id: string) {
		if (selected)
			selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}
	async function run(action: () => Promise<unknown> | void, receipt = '') {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
			selected = null;
			remove = null;
			notice = receipt;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not complete this action.';
		} finally {
			busy = false;
		}
	}
</script>

<section bind:this={section} aria-label="Offline music" data-part="offline-music">
	<h1>Offline music</h1>
	<div class="bar" role="group" aria-label="Offline collection">
		<button aria-pressed={view === 'downloaded'} onclick={() => choose('downloaded')}
			>Saved downloads</button
		><button aria-pressed={view === 'automatic'} onclick={() => choose('automatic')}
			>Automatic downloads</button
		><button aria-pressed={view === 'cached'} onclick={() => choose('cached')}
			>Playback cache</button
		>
	</div>
	{#if loading}<p role="status">Reading offline music…</p>
	{:else}
		<div class="actions">
			{#if selected}
				<button
					class="secondary"
					onclick={() => {
						selected = null;
						remove = null;
					}}>Cancel selection</button
				>
				<button class="secondary" onclick={() => (selected = matching.map((i) => i.track.id))}
					>Select all</button
				>
			{:else if matching.length}
				<button
					class="secondary"
					onclick={() =>
						onplay(
							matching.map((i) => i.track),
							0
						)}><Play size={16} />Play all</button
				>
				<button class="secondary" onclick={() => (selected = [])}
					><CheckSquare size={16} />Select songs</button
				>
			{/if}
		</div>
		{#if selected}<div class="actions" role="group" aria-label="Selected offline songs">
				<strong>{selected.length} selected</strong>
				<button
					class="secondary"
					disabled={!picked.length || busy}
					onclick={() => run(() => onplay(picked, 0))}>Play selected</button
				>
				<button
					class="secondary"
					disabled={!picked.length || busy}
					onclick={() => run(() => player.enqueue(picked, session, 'next'), 'Added to play next.')}
					>Play next</button
				>
				{#if view !== 'downloaded'}<button
						class="secondary"
						disabled={!picked.length || busy}
						onclick={() =>
							run(async () => {
								const result = await saveOfflineTracks(session, picked);
								if (result.failed) throw Error(result.message);
							}, 'Saved offline.')}>Keep downloads</button
					>{/if}
				<button
					class="secondary"
					disabled={!picked.length || busy}
					onclick={() => (remove = Array.from(selected ?? []))}>Remove selected</button
				>
			</div>{/if}
		{#if remove}<div class="confirm" role="group" aria-label="Remove offline music">
				<p>
					Remove {remove.length}
					{remove.length === 1 ? 'offline copy' : 'offline copies'} from this device?
				</p>
				<button class="secondary" disabled={busy} onclick={() => (remove = null)}>Keep music</button
				>
				<button
					class="primary"
					disabled={busy}
					onclick={() => {
						const ids = remove ?? [];
						void run(() => removeOffline(session, ids), 'Removed from this device.');
					}}>Confirm removal</button
				>
			</div>{/if}
		<label
			><span class="sr-only">Filter offline songs</span><input
				type="search"
				placeholder="Filter offline songs"
				bind:value={filter}
			/></label
		>
		<ul>
			{#each matching as entry (entry.track.id)}
				<li>
					<button
						class="song"
						aria-pressed={selected !== null ? selected.includes(entry.track.id) : undefined}
						onclick={() =>
							selected
								? toggle(entry.track.id)
								: onplay(
										matching.map((i) => i.track),
										matching.indexOf(entry)
									)}
					>
						{#if selected !== null}<span class="check"
								>{selected.includes(entry.track.id) ? '✓' : '○'}</span
							>{:else}<Music2 size={20} />{/if}
						<span
							><strong>{entry.track.title}</strong><small
								>{[entry.track.artist, entry.track.album, storageSize(entry.bytes)]
									.filter(Boolean)
									.join(' · ')}</small
							></span
						></button
					>
					{#if !selected}{#if !entry.pinned}<button
								class="icon-button"
								aria-label={'Keep ' + entry.track.title + ' offline'}
								disabled={busy}
								onclick={() =>
									run(async () => {
										const result = await saveOfflineTracks(session, [entry.track]);
										if (result.failed) throw Error(result.message);
									}, 'Saved offline.')}><Download size={18} /></button
							>{/if}
						<button
							class="icon-button"
							aria-label={'Remove offline copy of ' + entry.track.title}
							disabled={busy}
							onclick={() => (remove = [entry.track.id])}><Trash2 size={17} /></button
						>{/if}
				</li>
			{:else}<li class="empty">
					{filter
						? 'No matching songs.'
						: view === 'downloaded'
							? 'Choose Save offline on a library song or selection to keep it here.'
							: view === 'automatic'
								? 'Choose a download source in Offline settings to keep songs here automatically.'
								: 'Enable caching in Offline settings to keep completed streams here.'}
				</li>{/each}
		</ul>
	{/if}
	{#if error}<p role="alert">{error}</p>
		<button class="text-button" onclick={read}>Try again</button>{/if}
	{#if notice}<p role="status">{notice}</p>{/if}
</section>

<style>
	.bar,
	.actions,
	.confirm {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
		margin-block: 0.6rem;
	}
	.bar button {
		min-height: 44px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		padding: 0.4rem 0.75rem;
	}
	.bar [aria-pressed='true'] {
		background: var(--accent);
		color: var(--on-accent);
	}
	input {
		width: 100%;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--line);
		gap: 0.35rem;
	}
	.song {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 58px;
		min-width: 0;
		flex: 1;
		text-align: start;
	}
	.song span {
		min-width: 0;
	}
	.song strong,
	.song small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	small,
	.empty {
		color: var(--muted);
	}
	.empty {
		padding-block: 0.75rem;
	}
	.check {
		font-size: 1.3rem;
	}
</style>
