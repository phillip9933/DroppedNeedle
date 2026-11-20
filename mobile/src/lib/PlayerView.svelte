<script lang="ts">
	import {
		Cast,
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
	import type { Snippet } from 'svelte';
	import { samplePlayer } from './player/samplePlayer';
	import sampleArt from './player/tidal-memory.webp';
	import Outputs from './player/Outputs.svelte';
	import PlayerHeader from './player/PlayerHeader.svelte';
	import { isNavigation, trackToolFields, type NavigationId } from './player/layout';
	import { player, type PlayerTrack } from './player';
	import { accountId, defaults, loadLayout, sectionTitle, type Section } from './boards/layout';
	import { formatPlayerText, isPlayerText, playerRows } from './player/composition';
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
		onerror,
		editor
	}: {
		session: Session;
		expanded: boolean;
		queueOpen?: boolean;
		ontogglequeue?: () => void;
		onsettings?: () => void;
		onexpand: () => void;
		oncollapse: () => void;
		onerror: (error: unknown) => void;
		editor?: {
			sections: Section[];
			selected: string;
			selectNavigation: (id: NavigationId) => void;
			overlay: Snippet<[Section, number, number]>;
			inspector: Snippet<[number]>;
		};
	} = $props();
	let editing = $state(false),
		saveQueue = $state<PlayerTrack[] | null>(null);
	let loaded = $state(defaults('player'));
	const sections = $derived(editor?.sections ?? loaded);
	const store = $derived(editor ? samplePlayer : player);
	$effect(() => {
		if (!expanded || editor) return;
		const current = session;
		let live = true,
			owner = '';
		loaded = defaults('player');
		accountId(current)
			.then((id) => {
				if (!live) return;
				owner = id;
				loaded = loadLayout(current.serverUrl, id, 'player');
			})
			.catch(() => {
				/* The default controls stay available while the account is offline. */
			});
		function changed(event: Event) {
			const scope = (event as CustomEvent).detail;
			if (scope.board === 'player' && scope.user === owner && scope.server === current.serverUrl) {
				loaded = loadLayout(current.serverUrl, owner, 'player');
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
	const track = $derived($store.tracks[$store.index]);
	const duration = $derived($store.duration || track?.duration || 0);
	const art = $derived(
		track?.artworkUrl?.startsWith(session.serverUrl + '/')
			? track.artworkUrl.slice(session.serverUrl.length)
			: track?.artworkUrl
	);
	const stamp = (s: number) =>
		Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
	const rows = $derived(playerRows(sections));
	const clock = $derived(preview ?? $store.position);
	const fields = $derived({
		title: track?.title ?? '',
		artist: track?.artist ?? '',
		album: track?.album ?? '',
		elapsed: stamp(clock),
		duration: stamp(duration),
		remaining: stamp(Math.max(0, duration - clock)),
		position: String($store.index + 1),
		count: String($store.tracks.length)
	});
	async function edit(call: () => Promise<void>) {
		if (pending || editor) return;
		pending = true;
		try {
			await call();
			if (!$store.tracks.length) oncollapse();
		} catch (error) {
			onerror(error);
		} finally {
			pending = false;
		}
	}
	function action(call: () => Promise<void>) {
		if (!editor) void call().catch(onerror);
	}
</script>

{#snippet previous()}
	<button class="skip" aria-label="Previous track" onclick={() => action(player.previous)}
		><SkipBack size={28} /></button
	>
{/snippet}
{#snippet toggle()}
	<button
		class="play"
		aria-label={$store.playing ? 'Pause' : 'Play'}
		onclick={() => action(player.toggle)}
	>
		{#if $store.playing}<Pause fill="currentColor" />{:else}<Play fill="currentColor" />{/if}
	</button>
{/snippet}
{#snippet nextTrack()}
	<button
		class="skip"
		aria-label="Next track"
		disabled={$store.index + 1 >= $store.tracks.length && $store.repeat !== 'all'}
		onclick={() => action(player.next)}><SkipForward size={28} /></button
	>
{/snippet}
{#snippet repeat(label: boolean)}
	<button
		class="repeat"
		aria-label={'Repeat ' + $store.repeat + '. Change repeat mode'}
		aria-pressed={$store.repeat !== 'off'}
		onclick={() => action(player.cycleRepeat)}
	>
		{#if $store.repeat === 'one'}<Repeat1 size={18} />{:else}<Repeat size={18} />{/if}
		{#if label}<span>Repeat {$store.repeat}</span>{/if}
	</button>
{/snippet}
{#snippet shuffle(label: boolean)}
	<button
		class="repeat"
		aria-label="Shuffle upcoming"
		disabled={$store.tracks.length - $store.index <= 2 || pending}
		onclick={() => edit(player.shuffleUpcoming)}
	>
		<Shuffle size={18} />{#if label}<span>Shuffle upcoming</span>{/if}
	</button>
{/snippet}

{#if track && expanded}
	<section
		class="now"
		class:sample={!!editor}
		data-part={editor ? 'sample-player' : 'now-playing'}
		aria-label="Now playing"
	>
		<PlayerHeader
			{sections}
			title={track.title}
			playing={$store.playing}
			{queueOpen}
			onclose={oncollapse}
			onqueue={ontogglequeue}
			{onsettings}
			ontoggle={() => action(player.toggle)}
			onselect={editor?.selectNavigation}
		/>

		{#if queueOpen}
			<div class="queue-tools">
				<button
					class="secondary"
					disabled={$store.tracks.length - $store.index <= 2 || pending}
					onclick={() => edit(player.shuffleUpcoming)}
					><Shuffle size={16} /> Shuffle upcoming</button
				>
				<button class="text-button" aria-pressed={editing} onclick={() => (editing = !editing)}
					>{editing ? 'Done' : 'Edit queue'}</button
				>
			</div>
			{#if editing}<div class="queue-options">
					<button class="text-button" onclick={() => (saveQueue = [...$store.tracks])}
						>Save queue to playlist</button
					>
					<button
						class="text-button"
						disabled={pending || $store.index + 1 >= $store.tracks.length}
						onclick={() => edit(player.clearUpcoming)}>Clear upcoming</button
					>
				</div>{/if}
			<div class="queue" data-part="play-queue">
				<h1>Play queue</h1>
				<ol>
					{#each $store.tracks as item, i (item.id + ':' + i)}
						<li>
							<button
								class:current={i === $store.index}
								aria-current={i === $store.index ? 'true' : undefined}
								onclick={() => action(() => player.skipTo(i))}
							>
								{#if i === $store.index}<AudioLines size={18} />{:else}<span>{i + 1}</span>{/if}
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
										disabled={pending || i + 1 === $store.tracks.length}
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
			{#each rows as row, r (row[0].id)}
				<div
					class="player-row"
					class:composed={row.length > 1}
					class:editing-row={!!editor && row.some((cell) => cell.id === editor.selected)}
					data-part="player-row"
					data-player-row={editor ? r : undefined}
					style:min-height={Math.max(0, ...row.map((s) => s.minHeight ?? 0)) + 'px'}
					style:grid-template-columns={row
						.map((cell) => 'minmax(44px, ' + (cell.width ?? 1) + 'fr)')
						.join(' ')}
				>
					{#each row as section, c (section.id)}
						<div
							class="player-section"
							class:editing-field={!!editor}
							class:active-field={editor?.selected === section.id}
							data-section-id={section.id}
							data-align={section.align}
							data-text-size={section.textSize}
						>
							<div
								class="content"
								style:width={section.contentWidth
									? 'max(44px, ' + section.contentWidth + '%)'
									: undefined}
								inert={!!editor}
							>
								{#if section.title && !['player-tools', 'player-lyrics', 'player-up-next'].includes(section.id)}<h2
									>
										{section.title}
									</h2>{/if}
								{#if section.id === 'player-artwork'}
									<div class="hero" class:compact={!section.preview}>
										{#if editor}<img
												class="sample-art"
												alt="Tidal Memory album cover"
												src={sampleArt}
											/>{:else}<Cover {session} path={art} seed={track.album || track.id} />{/if}
									</div>
								{:else if section.id === 'player-track'}
									<div class="track-meta">
										<h1>{track.title}</h1>
										<p>{track.artist}</p>
										{#if section.preview && track.album}<small>{track.album}</small>{/if}
									</div>
								{:else if section.id === 'player-timeline' || section.id === 'player-seek'}
									<div class="timeline">
										<input
											type="range"
											aria-label="Playback position"
											aria-valuetext={stamp(preview ?? $store.position)}
											min="0"
											max={duration || 1}
											step="1"
											value={preview ?? $store.position}
											disabled={!duration}
											oninput={(e) => (preview = Number(e.currentTarget.value))}
											onpointercancel={() => (preview = null)}
											onchange={(e) => {
												const position = Number(e.currentTarget.value);
												preview = null;
												action(() => player.seek(position));
											}}
										/>
										{#if section.id === 'player-timeline' && section.preview}<div>
												<span>{stamp(preview ?? $store.position)}</span><span
													>{stamp(duration)}</span
												>
											</div>{/if}
									</div>
								{:else if section.id === 'player-transport'}
									<div class="transport" data-part="transport" class:compact={!section.preview}>
										{@render previous()}
										{@render toggle()}
										{@render nextTrack()}
									</div>
								{:else if section.id === 'player-modes'}
									<div class="modes">
										{@render repeat(section.preview)}
										{@render shuffle(section.preview)}
									</div>
								{:else if section.id === 'player-title'}
									<h1 class="field-title">{fields.title}</h1>
								{:else if section.id === 'player-artist'}
									<p class="field-artist">{fields.artist}</p>
								{:else if section.id === 'player-album'}
									<p class="field-album">{fields.album}</p>
								{:else if isPlayerText(section.id)}
									<p class="field-text">{formatPlayerText(section.template, fields)}</p>
								{:else if section.id === 'player-elapsed' || section.id === 'player-duration' || section.id === 'player-remaining'}
									<p class="field-time">
										{section.id === 'player-elapsed'
											? fields.elapsed
											: section.id === 'player-duration'
												? fields.duration
												: fields.remaining}
									</p>
								{:else if section.id === 'player-previous' || section.id === 'player-next' || section.id === 'player-toggle' || section.id === 'player-repeat' || section.id === 'player-shuffle'}
									<div class="field-controls" class:compact={!section.preview}>
										{#if section.id === 'player-previous'}{@render previous()}
										{:else if section.id === 'player-next'}{@render nextTrack()}
										{:else if section.id === 'player-toggle'}{@render toggle()}
										{:else if section.id === 'player-repeat'}{@render repeat(false)}
										{:else}{@render shuffle(false)}{/if}
									</div>
								{:else if isNavigation(section.id)}<div class="field-controls">
										{#if section.id === 'player-output'}
											{#if editor}<button
													class="icon-button"
													aria-label="Customize Cast and audio output"
													onclick={() => editor?.selectNavigation('player-output')}><Cast /></button
												>
											{:else}<Outputs compact />{/if}
										{:else}
											<button
												class="icon-button"
												aria-label={section.id === 'player-close'
													? 'Close player'
													: section.id === 'player-settings'
														? 'Player settings'
														: 'Show play queue'}
												onclick={section.id === 'player-close'
													? oncollapse
													: section.id === 'player-settings'
														? onsettings
														: ontogglequeue}
												>{#if section.id === 'player-close'}<ChevronDown
													/>{:else if section.id === 'player-settings'}<Settings2
													/>{:else}<ListMusic />{/if}</button
											>
										{/if}
									</div>
								{:else if trackToolFields.some((f) => f.id === section.id)}{#key section.id + track.id}<TrackTools
											{session}
											{track}
											title={sectionTitle(section)}
											startOpen={true}
											sample={!!editor}
											mode="field"
											fields={[section.id]}
										/>{/key}
								{:else if section.id === 'player-lyrics'}
									{#key section.preview}<PlayerLyrics
											{session}
											trackId={track.id}
											sample={!!editor}
											position={$store.position}
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
											sample={!!editor}
											fields={trackToolFields
												.map((a) => a.id)
												.filter((id) => !sections.some((s) => s.id === id))}
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
											{#each $store.tracks.slice($store.index + 1, $store.index + 4) as next, offset (next.id + ':' + offset)}
												<button
													class="up-track"
													onclick={() => action(() => player.skipTo($store.index + offset + 1))}
												>
													<strong>{next.title}</strong><small>{next.artist}</small>
												</button>
											{:else}<p>End of the queue.</p>{/each}
										{/if}
									</div>
								{/if}
							</div>
							{#if editor}{@render editor.overlay(section, r, c)}{/if}
						</div>
					{/each}
				</div>
				{#if editor}{@render editor.inspector(r)}{/if}
			{/each}
		{/if}
		{#if $store.error}<p role="alert">{$store.error}</p>{/if}
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
		<button
			class="open-mini"
			data-screen-link
			onclick={onexpand}
			aria-label={'Open player for ' + track.title}
		>
			<span class="mini-art"><Cover {session} path={art} seed={track.album || track.id} /></span>
			<span class="mini-meta"><strong>{track.title}</strong><small>{track.artist}</small></span>
		</button>
		<button
			class="mini-control"
			aria-label={$store.playing ? 'Pause' : 'Play'}
			onclick={() => action(player.toggle)}
			>{#if $store.playing}<Pause />{:else}<Play />{/if}</button
		>
		<button
			class="mini-control"
			aria-label="Next track"
			disabled={$store.index + 1 >= $store.tracks.length && $store.repeat !== 'all'}
			onclick={() => action(player.next)}><SkipForward /></button
		>
	</section>
{/if}

<style>
	.content {
		max-width: 100%;
		margin-inline: var(--art-start, auto) var(--art-end, auto);
	}
	.editing-row {
		margin-bottom: 44px;
	}
	.editing-field {
		container-type: inline-size;
		position: relative;
		min-height: 44px;
		align-self: stretch;
		align-content: center;
		outline: 1px dashed var(--line);
		outline-offset: 2px;
		border-radius: var(--radius);
	}
	.active-field {
		outline: 2px solid var(--accent);
	}
	.sample-art {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius);
	}
	.now.sample {
		padding-inline: min(2vw, 0.5rem);
	}
	.sample :global(.player-header) {
		position: relative;
		top: auto;
		z-index: 0;
	}

	.queue-options {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
		flex-wrap: wrap;
	}
	.player-row {
		display: grid;
		min-width: 0;
		align-items: center;
		gap: min(var(--gap), 3vw);
	}
	.player-section {
		min-width: 0;
		overflow-wrap: anywhere;
		--cell-scale: 1;
		font-size: calc(1rem * var(--cell-scale));
		text-align: var(--cell-align, start);
	}
	.player-section[data-align='start'] {
		--cell-justify: flex-start;
		--cell-align: start;
		--art-start: 0;
		--art-end: auto;
	}
	.player-section[data-align='center'] {
		--cell-justify: center;
		--cell-align: center;
		--art-start: auto;
		--art-end: auto;
	}
	.player-section[data-align='end'] {
		--cell-justify: flex-end;
		--cell-align: end;
		--art-start: auto;
		--art-end: 0;
	}
	.player-section[data-text-size='small'] {
		--cell-scale: 0.82;
	}
	.player-section[data-text-size='large'] {
		--cell-scale: 1.35;
	}
	.field-title,
	.field-artist,
	.field-album,
	.field-time,
	.field-text {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.field-text {
		white-space: pre-wrap;
	}
	.field-time,
	.field-album {
		color: var(--muted);
	}
	.field-time {
		font-variant-numeric: tabular-nums;
	}
	.field-controls {
		display: flex;
		align-items: center;
		justify-content: var(--cell-justify, center);
	}
	.field-controls button {
		min-width: 44px;
		min-height: 44px;
		max-width: 100%;
	}
	.composed .transport {
		gap: min(0.35rem, 1vw);
	}
	.composed .modes {
		column-gap: min(0.4rem, 1vw);
	}
	.composed .repeat span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.composed .repeat {
		flex-wrap: wrap;
		justify-content: center;
		max-width: 100%;
	}
	.composed .up-next .text-button {
		flex-wrap: wrap;
	}
	.player-section :global(details) {
		min-width: 0;
		max-width: 100%;
	}
	.composed .player-section :global(.secondary) {
		max-width: 100%;
		overflow-wrap: anywhere;
		padding-inline: min(0.8em, 8%);
	}

	.player-section h2 {
		font-size: 1em;
		margin: 0 0 0.4rem;
	}
	.hero.compact {
		width: min(45%, 13rem);
		min-width: 0;
	}
	.transport.compact .play,
	.field-controls.compact .play {
		width: 48px;
		height: 48px;
	}
	.modes {
		display: flex;
		align-items: center;
		justify-content: var(--cell-justify, center);
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
		justify-content: var(--cell-justify, space-between);
		font-weight: 600;
	}
	.up-track {
		text-align: var(--cell-align, start);
		min-height: 44px;
		align-content: center;
	}
	.up-next p {
		color: var(--muted);
	}
	.now {
		max-width: 32rem;
		width: 100%;
		margin: auto;
		padding: 0 min(var(--gap), 5vw) max(1.5rem, env(safe-area-inset-bottom));
		grid-template-columns: minmax(0, 1fr);
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
	.hero {
		width: min(100%, 52dvh);
		min-width: min(100%, 10rem);
		margin-block: clamp(0.2rem, 2vh, 2rem);
		margin-inline: var(--art-start, auto) var(--art-end, auto);
	}
	.track-meta h1,
	.track-meta p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.track-meta h1,
	.field-title {
		font-size: calc(clamp(1.75rem, 7vw, 2.45rem) * var(--cell-scale));
	}
	.track-meta p,
	.field-artist {
		font-size: 1.15em;
	}
	small,
	.timeline div {
		color: var(--muted);
	}
	.timeline input {
		min-width: 0;
		width: 100%;
		padding: 0;
		min-height: 44px;
		margin: 0;
	}
	.timeline div {
		display: flex;
		justify-content: space-between;
		font-size: 0.8em;
		font-variant-numeric: tabular-nums;
	}
	.transport {
		display: flex;
		justify-content: var(--cell-justify, center);
		flex-wrap: wrap;
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
		width: min(100%, 4.5rem);
		height: auto;
		aspect-ratio: 1;
		min-width: 44px;
		min-height: 44px;
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
		min-width: 44px;
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
