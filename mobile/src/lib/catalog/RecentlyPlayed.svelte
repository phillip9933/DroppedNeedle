<script lang="ts">
	import { Play } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage, type OnPlay } from './catalog';
	import { findListen, recentListens, type Listen } from './libraryWidgets';

	let {
		session,
		onplay,
		active = true,
		preview = false
	}: {
		session: Session;
		onplay: OnPlay;
		active?: boolean;
		preview?: boolean;
	} = $props();
	let listens = $state<Listen[]>([]),
		refreshing = $state(false),
		disabled = $state(false),
		loading = $state(true),
		error = $state(''),
		retry = $state(0),
		notice = $state(''),
		resolving = $state<number | null>(null);
	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	function playedAt(value?: string | null) {
		const ms = value ? Date.parse(value) : NaN;
		return Number.isFinite(ms) ? date.format(ms) : '';
	}
	let selection = 0;
	let unavailable = $state<Record<number, string>>({});
	$effect(() => {
		const account = session;
		void retry;
		if (!active) return;
		let valid = true,
			timer: ReturnType<typeof setTimeout>;
		async function load() {
			try {
				const result = await recentListens(account);
				if (!valid) return;
				listens = result.listens;
				refreshing = result.refreshing;
				disabled = result.disabled;
				if (result.refreshing && !result.listens.length) timer = setTimeout(load, 10_000);
			} catch (e) {
				if (valid) error = errorMessage(e);
			} finally {
				if (valid) loading = false;
			}
		}
		error = '';
		listens = [];
		unavailable = {};
		loading = true;
		notice = '';
		resolving = null;
		void load();
		return () => {
			valid = false;
			selection++;
			clearTimeout(timer);
		};
	});
	async function play(listen: Listen, index: number) {
		const attempt = ++selection;
		notice = '';
		resolving = index;
		try {
			const track = await findListen(session, listen);
			if (attempt !== selection) return;
			if (typeof track === 'string') {
				listens.forEach((other, i) => {
					if (other.musicbrainz_id === listen.musicbrainz_id && other.title === listen.title)
						unavailable[i] = track;
				});
				notice = listen.title + ' · ' + track;
			} else await onplay([track], 0);
		} catch (e) {
			if (attempt === selection) notice = errorMessage(e);
		} finally {
			if (attempt === selection) resolving = null;
		}
	}
</script>

{#if error}
	<p role="alert">{error}</p>
	<button class="secondary" onclick={() => retry++}>Try again</button>
{:else if listens.length}
	<ol data-part="recent-listens">
		{#each listens.slice(0, preview ? 3 : undefined) as listen, i (i)}
			<li>
				<div>
					<strong>{listen.title}</strong><small
						>{[listen.artist_name, listen.album_name].filter(Boolean).join(' · ')}</small
					>
					{#if playedAt(listen.listened_at)}<time datetime={listen.listened_at ?? undefined}
							>{playedAt(listen.listened_at)}</time
						>{/if}
				</div>
				{#if listen.musicbrainz_id && !unavailable[i]}
					<button
						class="icon-button"
						aria-label={'Replay ' + listen.title}
						disabled={resolving !== null}
						onclick={() => play(listen, i)}><Play size={18} aria-hidden="true" /></button
					>
				{:else}<small>{unavailable[i] || 'Local copy unknown'}</small>{/if}
			</li>
		{/each}
	</ol>
{:else if loading || refreshing}
	<p role="status">Loading recent plays…</p>
{:else if disabled}<p>
		To see your recent plays, enable Recently Played under Settings → Content preferences → Home.
	</p>
{:else}<p>No recent plays available from DroppedNeedle.</p>{/if}
{#if resolving !== null}<p role="status">Finding the local track…</p>{:else if notice}<p
		role="status"
	>
		{notice}
	</p>{/if}

<style>
	ol {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--gap);
		border-bottom: 1px solid var(--line);
		padding: 0.6rem 0;
	}
	li > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	strong,
	small,
	time {
		display: block;
	}
	small,
	time {
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
