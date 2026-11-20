<script lang="ts">
	import { onMount } from 'svelte';
	import { Ellipsis, RefreshCw } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { cover, errorMessage, type Album } from './catalog';
	import type { Action, Viewer } from './requestActions';
	import { wanted, watchActions, clearFinished } from './wanted';

	let {
		session,
		viewer,
		onopen,
		onaction,
		ondownloads,
		launchWeb
	}: {
		session: Session;
		viewer: Viewer | null;
		onopen: (album: Album) => void;
		onaction: (title: string, actions: Action[]) => void;
		ondownloads: () => void;
		launchWeb: (event: MouseEvent) => void;
	} = $props();
	let data = $state<Awaited<ReturnType<typeof wanted>> | null>(null);
	let busy = $state(true),
		error = $state(''),
		count = $state(30);
	let target: HTMLElement,
		sequence = 0;
	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	const finished = $derived(data?.items.filter((item) => item.state !== 'watching').length ?? 0);
	const states = { watching: 'Watching', stopped: 'Stopped', fulfilled: 'Found' };
	async function load() {
		const ticket = ++sequence;
		busy = true;
		error = '';
		try {
			const reply = await wanted(session);
			if (ticket === sequence) data = reply;
		} catch (e) {
			if (ticket === sequence) error = errorMessage(e);
		} finally {
			if (ticket === sequence) busy = false;
		}
	}
	function openActions(title: string, options: Action[]) {
		onaction(
			title,
			options.map((option) => ({
				...option,
				async run() {
					try {
						return await option.run();
					} finally {
						await load();
					}
				}
			}))
		);
	}
	onMount(() => {
		void load();
		const refresh = () => {
			if (
				!document.hidden &&
				target?.getClientRects().length &&
				!busy &&
				!document.querySelector('dialog[open]')
			)
				void load();
		};
		const timer = setInterval(refresh, 30_000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			sequence++;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});
</script>

<section bind:this={target} aria-label="Wanted watchlist">
	<header>
		<span
			>{viewer?.role === 'admin'
				? 'All listeners’ watches'
				: viewer
					? 'Your watches'
					: 'Watches'}</span
		><button class="icon-button" aria-label="Refresh wanted watches" disabled={busy} onclick={load}
			><RefreshCw size={17} /></button
		>
	</header>
	{#if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={load}>Retry watchlist</button>
	{:else if !data}<p role="status">Loading wanted watches…</p>
	{:else}
		{#if data.retrying?.length}
			<h3>Scheduled download retries</h3>
			<ul>
				{#each data.retrying.slice(0, count) as item (item.musicbrainz_id)}
					<li>
						<strong>{item.album_title}</strong><small
							>{item.artist_name}{#if viewer?.role === 'admin' && item.user_name}
								· Requested by {item.user_name}{/if}</small
						>
						<small
							>Retry {Math.min(item.retry_count + 1, item.max_attempts)} of {item.max_attempts}{#if item.next_retry_at}
								· {date.format(item.next_retry_at * 1000)}{/if}</small
						>
					</li>{/each}
			</ul>
			<button class="text-button" onclick={ondownloads}>Manage retries in Downloads</button>
		{/if}
		{#if data.items.length}
			<h3>Album watches</h3>
			<ul>
				{#each data.items.slice(0, count) as item (item.musicbrainz_id)}
					{@const options = watchActions(session, viewer, item)}
					<li>
						<div class="item">
							<button
								class="title"
								onclick={() =>
									onopen({
										title: item.album_title,
										artist: item.artist_name,
										year: item.year,
										group: item.musicbrainz_id,
										art: cover(item.musicbrainz_id)
									})}>{item.album_title}</button
							>
							{#if options.length}<button
									class="icon-button"
									aria-label={'Watch actions for ' + item.album_title}
									onclick={() => openActions(item.album_title, options)}
									><Ellipsis size={18} /></button
								>{/if}
						</div>
						<small
							>{[
								item.artist_name,
								item.year,
								viewer?.role === 'admin' && item.user_name ? 'Watched for ' + item.user_name : null
							]
								.filter(Boolean)
								.join(' · ')}</small
						>
						<span class="state"
							>{states[item.state] +
								(item.kind === 'partial' && item.state !== 'fulfilled'
									? ' · Missing tracks'
									: '')}</span
						>
						<small
							>{item.check_count}
							{item.check_count === 1
								? 'check'
								: 'checks'}{#if item.next_check_at && item.state === 'watching'}
								· Next check {date.format(item.next_check_at * 1000)}{/if}</small
						>
						{#if item.new_candidate_count > 0}<a
								class="text-button"
								href={session.serverUrl + '/album/' + encodeURIComponent(item.musicbrainz_id)}
								target="_blank"
								rel="noopener noreferrer"
								onclick={launchWeb}
								>Review {item.new_candidate_count} new {item.new_candidate_count === 1
									? 'match'
									: 'matches'} in browser</a
							>{/if}
					</li>{/each}
			</ul>
			{#if finished && viewer?.id}<button
					class="text-button"
					onclick={() =>
						viewer && openActions('Clear finished watches', [clearFinished(session, viewer)])}
					>Clear finished watches</button
				>{/if}
		{/if}
		{#if Math.max(data.items.length, data.retrying?.length || 0) > count}<button
				class="secondary"
				onclick={() => (count += 30)}>Show more watches</button
			>{/if}
		{#if !data.items.length && !data.retrying?.length}<p>Nothing on the watchlist.</p>{/if}
	{/if}
</section>

<style>
	header,
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	header span,
	h3 {
		font-weight: 650;
	}
	h3 {
		font-size: 1rem;
		margin: 0.8rem 0 0.4rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	li {
		padding: 0.6rem 0.8rem;
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.title {
		text-align: left;
		font-weight: 650;
		text-decoration: underline;
		text-underline-offset: 0.15em;
		min-height: 44px;
	}
	small {
		color: var(--muted);
	}
	.state {
		justify-self: start;
		border: 1px solid currentColor;
		border-radius: 99rem;
		padding: 0.1rem 0.45rem;
		font-size: 0.8rem;
		font-weight: 650;
	}
</style>
