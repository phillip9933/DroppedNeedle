<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import { ChevronRight, EllipsisVertical, ExternalLink, RefreshCw } from '@lucide/svelte';
	import Cover from './Cover.svelte';
	import RequestStatus from './RequestStatus.svelte';
	import type { Session } from '../connection';
	import { cover, errorMessage, type Album } from './catalog';
	import type { Action, Viewer } from './requestActions';
	import { wanted, watchActions, clearFinished, type Watch } from './wanted';

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
	const scope = $props.id();
	const states = { watching: 'Watching', stopped: 'Stopped', fulfilled: 'Found' };
	function attribution(item: Pick<Watch, 'artist_name' | 'year' | 'user_name'>, retry = false) {
		const listener = viewer?.role === 'admin' && item.user_name;
		return [
			item.artist_name,
			!retry && item.year,
			listener ? (retry ? 'Requested by ' : 'Watched for ') + listener : null
		]
			.filter(Boolean)
			.join(' · ');
	}
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

{#snippet identity(title: string, metadata: string, group: string, descriptionId?: string)}
	<span class="art"><Cover {session} path={cover(group)} seed={group} /></span>
	<span class="name">
		<strong>{title}</strong>
		<small id={descriptionId}>{metadata}</small>
	</span>
{/snippet}

<section class="watches" bind:this={target} aria-label={uiText('Wanted watchlist')}>
	<header>
		<span
			>{viewer?.role === 'admin'
				? uiText('All listeners’ watches')
				: viewer
					? uiText('Your watches')
					: uiText('Watches')}</span
		>
		<button
			class="icon-button"
			aria-label={uiText('Refresh wanted watches')}
			disabled={busy}
			onclick={load}
		>
			<RefreshCw size={18} aria-hidden="true" />
		</button>
	</header>
	{#if error}
		<p role="alert">{error}</p>
		<button class="secondary" onclick={load}>{uiText('Retry watchlist')}</button>
	{:else if !data}
		<p role="status">{uiText('Loading wanted watches…')}</p>
	{:else}
		{#if data.retrying?.length}
			<section>
				<h3>{uiText('Scheduled download retries')}</h3>
				<ul>
					{#each data.retrying.slice(0, count) as item (item.musicbrainz_id)}
						<li>
							<div class="identity">
								{@render identity(item.album_title, attribution(item, true), item.musicbrainz_id)}
							</div>
							<div class="facts">
								<RequestStatus
									state="retrying"
									label={'Retry ' +
										Math.min(item.retry_count + 1, item.max_attempts) +
										' of ' +
										item.max_attempts}
								/>
								{#if item.next_retry_at}<small>{date.format(item.next_retry_at * 1000)}</small>{/if}
							</div>
						</li>
					{/each}
				</ul>
				<button class="text-button" onclick={ondownloads}>
					{uiText('Manage retries in Downloads')}<ChevronRight size={16} aria-hidden="true" />
				</button>
			</section>
		{/if}
		{#if data.items.length}
			<section>
				<h3>{uiText('Album watches')}</h3>
				<ul>
					{#each data.items.slice(0, count) as item (item.musicbrainz_id)}
						{@const options = watchActions(session, viewer, item)}
						{@const descriptionId = scope + '-' + item.musicbrainz_id}
						<li class:with-menu={options.length > 0}>
							<button
								class="identity"
								aria-label={item.album_title}
								aria-describedby={descriptionId}
								onclick={() =>
									onopen({
										title: item.album_title,
										artist: item.artist_name,
										year: item.year,
										group: item.musicbrainz_id,
										art: cover(item.musicbrainz_id)
									})}
							>
								{@render identity(
									item.album_title,
									attribution(item),
									item.musicbrainz_id,
									descriptionId
								)}
							</button>
							{#if options.length}
								<button
									class="more"
									aria-label={'Watch actions for ' + item.album_title}
									onclick={() => openActions(item.album_title, options)}
								>
									<EllipsisVertical size={18} aria-hidden="true" />
								</button>
							{/if}

							<div class="facts">
								<RequestStatus
									state={item.state}
									label={states[item.state] +
										(item.kind === 'partial' && item.state !== 'fulfilled'
											? ' · Missing tracks'
											: '')}
								/>
								<small
									>{item.check_count}
									{item.check_count === 1
										? uiText('check')
										: uiText('checks')}{#if item.next_check_at && item.state === 'watching'}
										{' · Next check ' + date.format(item.next_check_at * 1000)}{/if}</small
								>
							</div>
							{#if item.new_candidate_count > 0}
								<a
									class="text-button"
									href={session.serverUrl + '/album/' + encodeURIComponent(item.musicbrainz_id)}
									target="_blank"
									rel="noopener noreferrer"
									onclick={launchWeb}
								>
									{uiText('Review')}
									{item.new_candidate_count}
									{uiText('new')}
									{item.new_candidate_count === 1 ? uiText('match') : uiText('matches')}
									{uiText('in browser')}<ExternalLink size={15} aria-hidden="true" />
								</a>
							{/if}
						</li>
					{/each}
				</ul>
				{#if finished && viewer?.id}
					<button
						class="text-button"
						onclick={() =>
							viewer && openActions('Clear finished watches', [clearFinished(session, viewer)])}
					>
						{uiText('Clear finished watches')}
					</button>
				{/if}
			</section>
		{/if}
		{#if Math.max(data.items.length, data.retrying?.length || 0) > count}
			<button class="secondary" onclick={() => (count += 30)}>{uiText('Show more watches')}</button>
		{/if}
		{#if !data.items.length && !data.retrying?.length}<p role="status">
				{uiText('Nothing on the watchlist.')}
			</p>{/if}
	{/if}
</section>

<style>
	.watches {
		container: watchlist / inline-size;
		display: grid;
		gap: 0.75rem;
		padding-block: 0.25rem 0.5rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.watches > button {
		justify-self: start;
	}
	header,
	.identity {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}
	header {
		justify-content: space-between;
		color: var(--muted);
		font-size: 0.9rem;
	}
	header button {
		color: var(--text);
	}
	h3 {
		margin: 0 0 0.25rem;
		color: var(--heading, var(--text));
		font-size: 1rem;
		font-weight: 650;
		line-height: 1.35;
	}
	p,
	ul {
		margin: 0;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: grid;
		gap: 0.4rem;
		padding-block: 0.65rem;
		border-block-end: 1px solid var(--line);
	}
	.with-menu {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.with-menu .facts,
	.with-menu a {
		grid-column: 1 / -1;
	}
	.identity {
		text-align: start;
		min-height: 44px;
	}
	.art {
		width: min(2.75rem, 44px);
		flex: none;
	}
	.name {
		display: grid;
		min-width: 0;
	}
	.name strong {
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.3;
	}
	small,
	p[role='status'] {
		color: var(--muted);
	}
	small {
		font-size: 0.86rem;
		line-height: 1.4;
	}
	.more {
		min-width: 44px;
		min-height: 44px;
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.65rem;
		align-items: center;
	}
	.text-button {
		justify-self: start;
		text-align: start;
		text-decoration: none;
	}
	@container watchlist (max-width: 13em) {
		.identity {
			align-items: flex-start;
		}
		.with-menu .identity {
			grid-column: 1 / -1;
		}
		.with-menu .more {
			grid-area: 2 / 2;
			align-self: start;
		}
		.with-menu .facts {
			grid-area: 2 / 1;
		}
	}
</style>
