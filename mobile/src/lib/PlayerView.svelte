<script lang="ts">
	import {
		ChevronDown,
		ListMusic,
		Pause,
		Play,
		SkipBack,
		SkipForward,
		AudioLines,
		ArrowUp,
		ArrowDown,
		Minus,
		Repeat,
		Repeat1,
		Settings2,
		Shuffle
	} from '@lucide/svelte';
	import { player, type PlayerTrack } from './player';
	import { accountId, defaults, loadLayout, sectionTitle } from './boards/layout';
	import TrackTools from './player/TrackTools.svelte';
	import AddToPlaylist from './catalog/AddToPlaylist.svelte';
	import type { Session } from './connection';
	import Cover from './catalog/Cover.svelte';
	import PlayerLyrics from './PlayerLyrics.svelte';
	let {
		session,
		expanded,
		queueOpen = false,
		ontogglequeue,
		onsettings,
		onexpand,
		oncollapse,
		onerror
	}: {
		session: Session;
		expanded: boolean;
		queueOpen?: boolean;
		ontogglequeue?: () => void;
		onsettings?: () => void;
		onexpand: () => void;
		oncollapse: () => void;
		onerror: (error: unknown) => void;
	} = $props();
	let editing = $state(false),
		saveQueue = $state<PlayerTrack[] | null>(null);
	let sections = $state(defaults('player'));
	$effect(() => {
		if (!expanded) return;
		const current = session;
		let live = true,
			owner = '';
		sections = defaults('player');
		accountId(current)
			.then((id) => {
				if (!live) return;
				owner = id;
				sections = loadLayout(current.serverUrl, id, 'player');
			})
			.catch(() => {
				/* The default controls stay available while the account is offline. */
			});
		function changed(event: Event) {
			const scope = (event as CustomEvent).detail;
			if (scope.board === 'player' && scope.user === owner && scope.server === current.serverUrl) {
				sections = loadLayout(current.serverUrl, owner, 'player');
			}
		}
		window.addEventListener('dn-layout-change', changed);
		return () => {
			live = false;
			window.removeEventListener('dn-layout-change', changed);
		};
	});
	let pending = $state(false);
	let preview = $state<number | null>(null);
	const track = $derived($player.tracks[$player.index]);
	const duration = $derived($player.duration || track?.duration || 0);
	const art = $derived(
		track?.artworkUrl?.startsWith(session.serverUrl + '/')
			? track.artworkUrl.slice(session.serverUrl.length)
			: track?.artworkUrl
	);
	const stamp = (s: number) =>
		Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
	async function edit(call: () => Promise<void>) {
		if (pending) return;
		pending = true;
		try {
			await call();
			if (!$player.tracks.length) oncollapse();
		} catch (error) {
			onerror(error);
		} finally {
			pending = false;
		}
	}
	function action(call: () => Promise<void>) {
		void call().catch(onerror);
	}
</script>

{#if track && expanded}
	<section class="now" data-part="now-playing" aria-label="Now playing">
		<header class="player-header">
			<button class="icon-button" aria-label="Close player" onclick={oncollapse}
				><ChevronDown /></button
			>
			<strong
				>{queueOpen
					? 'Now playing'
					: !sections.some((s) => s.id === 'player-track')
						? track.title
						: 'Now playing'}</strong
			>
			{#if !queueOpen && !sections.some((s) => s.id === 'player-transport')}
				<button
					class="icon-button"
					aria-label={$player.playing ? 'Pause' : 'Play'}
					onclick={() => action(player.toggle)}
				>
					{#if $player.playing}<Pause />{:else}<Play />{/if}
				</button>
			{/if}
			<div class="header-actions">
				{#if onsettings}<button
						class="icon-button"
						aria-label="Player settings"
						onclick={onsettings}><Settings2 size={20} /></button
					>{/if}
				<button
					class="icon-button"
					aria-label={queueOpen ? 'Hide play queue' : 'Show play queue'}
					aria-pressed={queueOpen}
					onclick={ontogglequeue}><ListMusic /></button
				>
			</div>
		</header>
		{#if queueOpen}
			<div class="queue-tools">
				<button
					class="secondary"
					disabled={$player.tracks.length - $player.index <= 2 || pending}
					onclick={() => edit(player.shuffleUpcoming)}
					><Shuffle size={16} /> Shuffle upcoming</button
				>
				<button class="text-button" aria-pressed={editing} onclick={() => (editing = !editing)}
					>{editing ? 'Done' : 'Edit queue'}</button
				>
			</div>
			{#if editing}<div class="queue-options">
					<button class="text-button" onclick={() => (saveQueue = [...$player.tracks])}
						>Save queue to playlist</button
					>
					<button
						class="text-button"
						disabled={pending || $player.index + 1 >= $player.tracks.length}
						onclick={() => edit(player.clearUpcoming)}>Clear upcoming</button
					>
				</div>{/if}
			<div class="queue" data-part="play-queue">
				<h1>Play queue</h1>
				<ol>
					{#each $player.tracks as item, i (item.id + ':' + i)}
						<li>
							<button
								class:current={i === $player.index}
								aria-current={i === $player.index ? 'true' : undefined}
								onclick={() => action(() => player.skipTo(i))}
							>
								{#if i === $player.index}<AudioLines size={18} />{:else}<span>{i + 1}</span>{/if}
								<span><strong>{item.title}</strong><small>{item.artist}</small></span>
							</button>
							{#if editing}
								<div class="edit-tools">
									<button
										disabled={pending || i === 0}
										aria-label={'Move ' + item.title + ' up'}
										onclick={() => edit(() => player.move(i, i - 1))}><ArrowUp size={18} /></button
									>
									<button
										disabled={pending || i + 1 === $player.tracks.length}
										aria-label={'Move ' + item.title + ' down'}
										onclick={() => edit(() => player.move(i, i + 1))}
										><ArrowDown size={18} /></button
									>
									<button
										disabled={pending}
										aria-label={'Remove ' + item.title + ' from queue'}
										onclick={() => edit(() => player.remove(i))}><Minus size={18} /></button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</div>
		{:else}
			{#each sections as section (section.id)}
				<div class="player-section" data-section-id={section.id}>
					{#if section.title && !['player-tools', 'player-lyrics', 'player-up-next'].includes(section.id)}<h2
						>
							{section.title}
						</h2>{/if}
					{#if section.id === 'player-artwork'}
						<div class="hero" class:compact={!section.preview}>
							<Cover {session} path={art} seed={track.album || track.id} />
						</div>
					{:else if section.id === 'player-track'}
						<div class="track-meta">
							<h1>{track.title}</h1>
							<p>{track.artist}</p>
							{#if section.preview && track.album}<small>{track.album}</small>{/if}
						</div>
					{:else if section.id === 'player-timeline'}
						<div class="timeline">
							<input
								type="range"
								aria-label="Playback position"
								aria-valuetext={stamp(preview ?? $player.position)}
								min="0"
								max={duration || 1}
								step="1"
								value={preview ?? $player.position}
								disabled={!duration}
								oninput={(e) => (preview = Number(e.currentTarget.value))}
								onpointercancel={() => (preview = null)}
								onchange={(e) => {
									const position = Number(e.currentTarget.value);
									preview = null;
									action(() => player.seek(position));
								}}
							/>
							{#if section.preview}<div>
									<span>{stamp(preview ?? $player.position)}</span><span>{stamp(duration)}</span>
								</div>{/if}
						</div>
					{:else if section.id === 'player-transport'}
						<div class="transport" data-part="transport" class:compact={!section.preview}>
							<button
								class="skip"
								aria-label="Previous track"
								onclick={() => action(player.previous)}><SkipBack size={28} /></button
							>
							<button
								class="play"
								aria-label={$player.playing ? 'Pause' : 'Play'}
								onclick={() => action(player.toggle)}
								>{#if $player.playing}<Pause fill="currentColor" />{:else}<Play
										fill="currentColor"
									/>{/if}</button
							>
							<button
								class="skip"
								aria-label="Next track"
								disabled={$player.index + 1 >= $player.tracks.length && $player.repeat !== 'all'}
								onclick={() => action(player.next)}><SkipForward size={28} /></button
							>
						</div>
					{:else if section.id === 'player-modes'}
						<div class="modes">
							<button
								class="repeat"
								aria-label={'Repeat ' + $player.repeat + '. Change repeat mode'}
								aria-pressed={$player.repeat !== 'off'}
								onclick={() => action(player.cycleRepeat)}
							>
								{#if $player.repeat === 'one'}<Repeat1 size={18} />{:else}<Repeat size={18} />{/if}
								{#if section.preview}Repeat {$player.repeat}{/if}
							</button>
							<button
								class="repeat"
								aria-label="Shuffle upcoming"
								disabled={$player.tracks.length - $player.index <= 2 || pending}
								onclick={() => edit(player.shuffleUpcoming)}
								><Shuffle size={18} />{#if section.preview}Shuffle upcoming{/if}</button
							>
						</div>
					{:else if section.id === 'player-lyrics'}
						{#key section.preview}<PlayerLyrics
								{session}
								trackId={track.id}
								position={$player.position}
								title={sectionTitle(section)}
								startOpen={section.preview}
								onseek={(p) => action(() => player.seek(p))}
							/>{/key}
					{:else if section.id === 'player-tools'}
						{#key JSON.stringify([track.id, section.preview])}<TrackTools
								{session}
								{track}
								title={sectionTitle(section)}
								startOpen={section.preview}
							/>{/key}
					{:else if section.id === 'player-up-next'}
						<div class="up-next">
							<button
								class="text-button"
								onclick={ontogglequeue}
								aria-label={'Open play queue from ' + sectionTitle(section)}
							>
								{sectionTitle(section)} <ListMusic size={18} /></button
							>
							{#if section.preview}
								{#each $player.tracks.slice($player.index + 1, $player.index + 4) as next, offset (next.id + ':' + offset)}
									<button
										class="up-track"
										onclick={() => action(() => player.skipTo($player.index + offset + 1))}
									>
										<strong>{next.title}</strong><small>{next.artist}</small>
									</button>
								{:else}<p>End of the queue.</p>{/each}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
		{#if $player.error}<p role="alert">{$player.error}</p>{/if}
	</section>
	{#if saveQueue}<AddToPlaylist
			{session}
			tracks={saveQueue}
			onclose={() => (saveQueue = null)}
		/>{/if}
{:else if expanded}
	<section class="now" data-part="now-playing" aria-label="Now playing">
		<header class="player-header">
			<button class="icon-button" aria-label="Close player" onclick={oncollapse}
				><ChevronDown /></button
			>
			{#if onsettings}<button class="icon-button" aria-label="Player settings" onclick={onsettings}
					><Settings2 size={20} /></button
				>{/if}
		</header>
		<h1>Nothing playing</h1>
		<button class="secondary" onclick={oncollapse}>Browse music</button>
	</section>
{:else if track}
	<section data-part="mini-player" class="mini" aria-label="Current track">
		<button class="open-mini" onclick={onexpand} aria-label={'Open player for ' + track.title}>
			<span class="mini-art"><Cover {session} path={art} seed={track.album || track.id} /></span>
			<span class="mini-meta"><strong>{track.title}</strong><small>{track.artist}</small></span>
		</button>
		<button
			class="mini-control"
			aria-label={$player.playing ? 'Pause' : 'Play'}
			onclick={() => action(player.toggle)}
			>{#if $player.playing}<Pause />{:else}<Play />{/if}</button
		>
		<button
			class="mini-control"
			aria-label="Next track"
			disabled={$player.index + 1 >= $player.tracks.length && $player.repeat !== 'all'}
			onclick={() => action(player.next)}><SkipForward /></button
		>
	</section>
{/if}

<style>
	.queue-options {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
		flex-wrap: wrap;
	}
	.header-actions {
		display: flex;
		align-items: center;
	}
	.player-header {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg);
	}
	.player-section {
		min-width: 0;
	}
	.player-section h2 {
		font-size: 1rem;
		margin: 0 0 0.4rem;
	}
	.hero.compact {
		width: min(45%, 13rem);
		min-width: 0;
	}
	.transport.compact .play {
		width: 48px;
		height: 48px;
	}
	.modes {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--gap);
		flex-wrap: wrap;
	}
	.up-next,
	.up-track {
		display: grid;
	}
	.up-next .text-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: space-between;
		font-weight: 600;
	}
	.up-track {
		text-align: start;
		min-height: 44px;
		align-content: center;
	}
	.up-next p {
		color: var(--muted);
	}
	.player-header strong {
		min-width: 0;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
	.now {
		max-width: 32rem;
		width: 100%;
		margin: auto;
		padding: 0 var(--gap) max(1.5rem, env(safe-area-inset-bottom));
		display: grid;
		gap: var(--gap);
		align-content: start;
	}
	.player-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 3.8rem;
	}
	.player-header strong {
		font-size: 0.87rem;
		letter-spacing: 0.03em;
	}
	.hero {
		width: min(100%, 52dvh);
		min-width: min(100%, 10rem);
		margin: clamp(0.2rem, 2vh, 2rem) auto;
	}
	.track-meta h1,
	.track-meta p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.track-meta h1 {
		font-size: clamp(1.75rem, 7vw, 2.45rem);
	}
	.track-meta p {
		font-size: 1.15rem;
	}
	small,
	.timeline div {
		color: var(--muted);
	}
	.timeline input {
		width: 100%;
		padding: 0;
		min-height: 44px;
		margin: 0;
	}
	.timeline div {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	.transport {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: clamp(0.8rem, 6vw, 3rem);
	}
	.skip,
	.play,
	.mini-control {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
	}
	.play {
		border-radius: 50%;
		width: 4.5rem;
		height: 4.5rem;
		color: var(--dn-action-content, var(--on-accent));
		background: var(--dn-action, var(--accent));
		border: 1px solid var(--dn-action-edge, transparent);
	}
	.queue ol {
		list-style: none;
		padding: 0;
	}
	.queue-tools,
	.edit-tools,
	.queue li,
	.queue-tools .secondary,
	.repeat {
		display: flex;
		align-items: center;
	}
	.queue-tools {
		justify-content: space-between;
		gap: 0.5rem;
	}
	.queue-tools .secondary,
	.repeat {
		gap: 0.4rem;
	}
	.repeat {
		justify-self: center;
		color: var(--muted);
		min-height: 44px;
	}
	.repeat[aria-pressed='true'] {
		color: var(--accent);
	}
	.edit-tools button {
		min-width: 44px;
		min-height: 44px;
	}
	.queue li {
		border-bottom: 1px solid var(--line);
	}
	.queue li > button {
		display: flex;
		width: 100%;
		gap: var(--gap);
		align-items: center;
		text-align: start;
		padding: 0.5rem 0;
		min-height: 3.6rem;
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.queue li > button > span:first-child {
		min-width: 1.1rem;
		text-align: center;
	}
	.queue strong,
	.queue small,
	.mini-meta > * {
		display: block;
	}
	.queue .current {
		color: var(--accent);
	}
	.mini {
		display: flex;
		align-items: center;
		margin: 0.3rem var(--gap);
		padding: 0.3rem;
		border-radius: var(--radius);
		background: var(--raised);
	}
	.open-mini {
		display: flex;
		text-align: start;
		gap: 0.7rem;
		align-items: center;
		min-width: 0;
		flex: 1;
	}
	.mini-art {
		width: 46px;
		flex-shrink: 0;
	}
	.mini-control {
		flex-shrink: 0;
		width: 44px;
	}
	.mini-meta {
		min-width: 0;
	}
	.mini-meta > * {
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}
</style>
