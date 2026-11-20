<script lang="ts">
	import {
		ListMusic,
		Menu,
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
		Shuffle
	} from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { samplePlayer } from './player/samplePlayer';
	import sampleArt from './player/tidal-memory.webp';
	import PlayerActionFace from './player/PlayerActionFace.svelte';
	import PlayerNavigationAction from './player/PlayerNavigationAction.svelte';
	import PlayerMetadata from './player/PlayerMetadata.svelte';
	import PlayerHeader from './player/PlayerHeader.svelte';
	import SleepTimer from './player/SleepTimer.svelte';
	import { isPlayerMetadata, isNavigation, trackToolFields } from './player/layout';
	import { player, type PlayerTrack } from './player';
	import { interfacePreferences } from './appearance/interface';
	import { swipeTracks } from './player/swipeTracks';
	import { accountId, defaults, loadLayout, sectionTitle, type Section } from './boards/layout';
	import {
		formatPlayerText,
		isPlayerSlot,
		isPlayerText,
		playerCanvas,
		playerRowGap
	} from './player/composition';
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
		menuToggle,
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
		menuToggle?: Snippet;
		onexpand: () => void;
		oncollapse: () => void;
		onerror: (error: unknown) => void;
		editor?: {
			sections: Section[];
			selected: string;
			overlay: Snippet<[Section, number, number]>;
			inspector?: Snippet<[number]>;
			rowControls?: Snippet<[number]>;
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
	const rows = $derived(playerCanvas(sections));
	const flushRows = $derived(rows.map((row) => row.every((s) => s.padding === 0)));
	const clock = $derived(preview ?? $store.position);
	const libraryWindow = $derived($store.libraryWindow);
	const canGoNext = $derived(
		$store.index + 1 < $store.tracks.length || !!libraryWindow?.more || $store.repeat === 'all'
	);
	const swipeAction = $derived(editor || !$interfacePreferences.swipeTracks ? undefined : skip);
	const queueOffset = $derived(libraryWindow?.offset ?? 0);
	const shuffleLabel = $derived(
		libraryWindow ? 'Shuffle loaded upcoming tracks' : 'Shuffle upcoming'
	);
	const fields = $derived({
		title: track?.title ?? '',
		artist: track?.artist ?? '',
		album: track?.album ?? '',
		elapsed: stamp(clock),
		duration: stamp(duration),
		remaining: stamp(Math.max(0, duration - clock)),
		position: String(queueOffset + $store.index + 1),
		count: String(libraryWindow?.total ?? $store.tracks.length)
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
	function skip(direction: 'previous' | 'next') {
		if (direction === 'previous' || canGoNext) action(player[direction]);
	}
</script>

{#snippet previous(section?: Section)}
	<button class="skip" aria-label="Previous track" onclick={() => action(player.previous)}>
		<PlayerActionFace {section} glyph={SkipBack} size={28} label="Previous" />
	</button>
{/snippet}
{#snippet toggle(section?: Section)}
	<button
		class="play"
		aria-label={$store.playing ? 'Pause' : 'Play'}
		onclick={() => action(player.toggle)}
	>
		<PlayerActionFace
			{section}
			glyph={$store.playing ? Pause : Play}
			label={$store.playing ? 'Pause' : 'Play'}
			fill
			playback={$store.playing ? 'pause' : 'play'}
		/>
	</button>
{/snippet}
{#snippet nextTrack(section?: Section)}
	<button
		class="skip"
		aria-label="Next track"
		disabled={!canGoNext}
		onclick={() => action(player.next)}
	>
		<PlayerActionFace {section} glyph={SkipForward} size={28} label="Next" />
	</button>
{/snippet}
{#snippet repeat(label: boolean, section?: Section)}
	<button
		class="repeat"
		aria-label={'Repeat ' + $store.repeat + '. Change repeat mode'}
		aria-pressed={$store.repeat !== 'off'}
		onclick={() => action(player.cycleRepeat)}
	>
		<PlayerActionFace
			{section}
			glyph={$store.repeat === 'one' ? Repeat1 : Repeat}
			size={18}
			label={'Repeat ' + $store.repeat}
			defaultLabel={label}
		/>
	</button>
{/snippet}
{#snippet shuffle(label: boolean, section?: Section)}
	<button
		class="repeat"
		aria-label={shuffleLabel}
		disabled={$store.tracks.length - $store.index <= 2 || pending}
		onclick={() => edit(player.shuffleUpcoming)}
	>
		<PlayerActionFace
			{section}
			glyph={Shuffle}
			size={18}
			label={shuffleLabel}
			defaultLabel={label}
		/>
	</button>
{/snippet}
{#if expanded}
	<section
		class="now"
		class:sample={!!editor}
		data-part={editor ? 'sample-player' : 'now-playing'}
		aria-label="Now playing"
	>
		{#each rows as row, r (r === 0 ? 'header' : row[0].id)}
			{#if r === 0 || (track && !queueOpen)}
				<svelte:element
					this={r === 0 ? 'header' : 'div'}
					class="row-group"
					class:player-header={r === 0}
					class:compact-header={r === 0 &&
						row.every(
							(s) =>
								![
									'player-artwork',
									'player-tools',
									'player-track',
									'player-lyrics',
									'player-up-next'
								].includes(s.id) && (s.minHeight ?? 0) <= 96
						)}
					class:flush-edge={r > 0 && flushRows[r] && (r === 1 || flushRows[r - 1])}
				>
					{@render editor?.rowControls?.(r)}
					<div class="row-surface" class:with-menu={r === 0 && (!!editor || !!menuToggle)}>
						{#if r === 0 && (editor || menuToggle)}<div class="app-menu-cell">
								{#if editor}<span class="icon-button sample-menu" aria-hidden="true"
										><Menu size={23} /></span
									>{:else}{@render menuToggle?.()}{/if}
							</div>{/if}
						<div
							class="player-row"
							class:composed={row.length > 1}
							data-part={r === 0 ? 'player-header-row' : 'player-row'}
							data-layout-row={editor ? r : undefined}
							data-player-row={editor && r > 0 ? r - 1 : undefined}
							style:min-height={Math.max(0, ...row.map((s) => s.minHeight ?? 0)) + 'px'}
							style:--row-gap={playerRowGap(row, r === 0)}
							style:grid-template-columns={row
								.map(
									(cell) =>
										'minmax(min(44px, ' + 100 / row.length + '%), ' + (cell.width ?? 1) + 'fr)'
								)
								.join(' ')}
						>
							{#each row as section, c (section.id)}
								<div
									class="player-section"
									class:editing-field={!!editor}
									class:active-field={editor?.selected === section.id}
									data-section-id={section.id}
									data-align={section.align}
									data-slot={isPlayerSlot(section.id) || undefined}
									data-padding={section.padding}
									style:--slot-height={section.minHeight === undefined
										? undefined
										: section.minHeight + 'px'}
									data-lines={section.maxLines ? section.maxLines : undefined}
									style:--field-lines={section.maxLines}
									style:--reserved-lines={section.reserveLines ? (section.maxLines ?? 0) : 0}
									style:--cell-v-align={section.vAlign}
									style:--field-padding={section.padding === undefined
										? undefined
										: section.padding + 'px'}
									data-text-size={section.textSize}
								>
									<div
										class="content"
										style:width={section.contentWidth
											? 'min(100%, max(44px, ' + section.contentWidth + '%))'
											: undefined}
										inert={!!editor}
										aria-hidden={editor ? true : undefined}
									>
										{#if section.title && !isPlayerSlot(section.id) && !['player-tools', 'player-lyrics', 'player-up-next'].includes(section.id)}<h2
											>
												{section.title}
											</h2>{/if}
										{#if isPlayerSlot(section.id)}
											<span class="empty-slot" aria-hidden="true"></span>
										{:else if isNavigation(section.id)}<div class="field-controls">
												<PlayerNavigationAction
													id={section.id}
													{section}
													{queueOpen}
													editing={!!editor}
													disabled={section.id === 'player-queue' && !track}
													onactivate={(id) => {
														if (editor) return;
														if (id === 'player-close') oncollapse();
														else if (id === 'player-settings') onsettings?.();
														else ontogglequeue?.();
													}}
												/>
											</div>
										{:else if section.id === 'player-heading'}<PlayerMetadata
												{section}
												value={queueOpen ||
												!track ||
												sections.some((s) => ['player-track', 'player-title'].includes(s.id))
													? 'Now playing'
													: track.title}
											/>
										{:else if !track}<span
												class="unavailable-field"
												aria-label={sectionTitle(section)}>—</span
											>
										{:else if section.id === 'player-sleep'}<div class="field-controls">
												<SleepTimer {section} timer={$store.sleepTimer} sample={!!editor} />
											</div>
										{:else if section.id === 'player-artwork'}
											<div
												class="hero"
												class:compact={!section.preview}
												use:swipeTracks={swipeAction}
											>
												{#if editor}<img
														class="sample-art"
														alt="Tidal Memory album cover"
														src={sampleArt}
													/>{:else}<Cover
														{session}
														path={art}
														seed={track.album || track.id}
													/>{/if}
											</div>
										{:else if section.id === 'player-track'}
											<div class="track-meta">
												<h1 class="lines">{track.title}</h1>
												<p class="lines">{track.artist}</p>
												{#if section.preview && track.album}<small class="lines"
														>{track.album}</small
													>{/if}
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
										{:else if isPlayerMetadata(section.id)}
											<PlayerMetadata
												{section}
												value={isPlayerText(section.id)
													? formatPlayerText(section.template, fields)
													: section.id === 'player-title'
														? fields.title
														: section.id === 'player-artist'
															? fields.artist
															: fields.album}
											/>
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
												{#if section.id === 'player-previous'}{@render previous(section)}
												{:else if section.id === 'player-next'}{@render nextTrack(section)}
												{:else if section.id === 'player-toggle'}{@render toggle(section)}
												{:else if section.id === 'player-repeat'}{@render repeat(false, section)}
												{:else}{@render shuffle(false, section)}{/if}
											</div>
										{:else if trackToolFields.some((f) => f.id === section.id)}{#key section.id + track.id}<TrackTools
													{section}
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
													{section}
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
													{section}
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
													<PlayerActionFace
														{section}
														glyph={ListMusic}
														size={18}
														label={sectionTitle(section)}
														defaultLabel
													/></button
												>
												{#if section.preview}
													{#each $store.tracks.slice($store.index + 1, $store.index + 4) as next, offset (next.id + ':' + offset)}
														<button
															class="up-track"
															onclick={() => action(() => player.skipTo($store.index + offset + 1))}
														>
															<strong>{next.title}</strong><small>{next.artist}</small>
														</button>
													{:else}<p>
															{libraryWindow?.more
																? 'Loading upcoming tracks…'
																: 'End of the queue.'}
														</p>{/each}
												{/if}
											</div>
										{/if}
									</div>
									{#if editor}{@render editor.overlay(section, r, c)}{/if}
								</div>
							{/each}
						</div>
					</div>
					{#if r === 0 && !editor}<PlayerHeader
							{row}
							{sections}
							{queueOpen}
							track={!!track}
							playing={$store.playing}
							onclose={oncollapse}
							onqueue={ontogglequeue}
							{onsettings}
							ontoggle={() => action(player.toggle)}
						/>{/if}
					{@render editor?.inspector?.(r)}
				</svelte:element>
			{/if}
		{/each}
		{#if libraryWindow?.problem}
			<div role="status">
				<p>{libraryWindow.problem}</p>
				<button class="secondary" onclick={() => action(player.retryLibraryWindow)}
					>Retry library queue</button
				>
			</div>
		{/if}

		{#if queueOpen && track}
			<div class="queue-tools">
				{#if !rows[0].some((s) => s.id === 'player-sleep')}<SleepTimer
						timer={$store.sleepTimer}
					/>{/if}
				<button
					class="secondary"
					disabled={$store.tracks.length - $store.index <= 2 || pending}
					onclick={() => edit(player.shuffleUpcoming)}><Shuffle size={16} /> {shuffleLabel}</button
				>
				<button class="text-button" aria-pressed={editing} onclick={() => (editing = !editing)}
					>{editing ? 'Done' : 'Edit queue'}</button
				>
			</div>
			{#if editing}<div class="queue-options">
					<button class="text-button" onclick={() => (saveQueue = [...$store.tracks])}
						>{libraryWindow ? 'Save loaded tracks to playlist' : 'Save queue to playlist'}</button
					>
					<button
						class="text-button"
						disabled={pending || ($store.index + 1 >= $store.tracks.length && !libraryWindow?.more)}
						onclick={() => edit(player.clearUpcoming)}>Clear upcoming</button
					>
				</div>{/if}
			<div class="queue" data-part="play-queue">
				<h1>Play queue</h1>
				{#if libraryWindow}
					<p>
						Tracks {queueOffset + 1}–{libraryWindow.loaded} of {libraryWindow.total.toLocaleString()}
					</p>
					{#if editing}<p>
							Editing this queue keeps the {$store.tracks.length} tracks shown here.
						</p>{/if}
				{/if}
				<ol>
					{#each $store.tracks as item, i (item.id + ':' + i)}
						<li>
							<button
								class:current={i === $store.index}
								aria-current={i === $store.index ? 'true' : undefined}
								onclick={() => action(() => player.skipTo(i))}
							>
								{#if i === $store.index}<AudioLines size={18} />{:else}<span
										>{queueOffset + i + 1}</span
									>{/if}
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
		{:else if !track}
			<h1>Nothing playing</h1>
			<button class="secondary" onclick={oncollapse}>Browse music</button>
		{/if}

		{#if $store.error}<p role="alert">{$store.error}</p>{/if}
	</section>
	{#if saveQueue}<AddToPlaylist
			{session}
			tracks={saveQueue}
			onclose={() => (saveQueue = null)}
		/>{/if}
{:else if track}
	<section data-part="mini-player" class="mini" aria-label="Current track">
		<button
			class="open-mini"
			use:swipeTracks={swipeAction}
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
			disabled={!canGoNext}
			onclick={() => action(player.next)}><SkipForward /></button
		>
	</section>
{/if}

<style>
	.content {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding-block: var(--field-padding, 0px);
		padding-inline: min(var(--field-padding, 0px), max(0px, calc((100% - 44px) / 2)));
		max-width: 100%;
		margin-inline: var(--art-start, auto) var(--art-end, auto);
	}
	.row-surface {
		min-width: 0;
	}
	.with-menu {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		gap: 5px;
		align-items: center;
	}
	.app-menu-cell {
		display: grid;
		align-content: start;
		align-self: stretch;
		padding-block: max(0px, calc((3.8rem - 44px) / 2));
	}
	.sample-menu {
		height: 44px;
	}
	@container (max-width:313px) {
		.with-menu:has(.player-section:nth-child(6)) {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}
	}
	@container (max-width:268px) {
		.with-menu:has(.player-section:nth-child(5)) {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}
	}
	.row-group {
		min-width: 0;
	}
	.flush-edge {
		margin-block-start: calc(0px - var(--gap));
	}
	.player-section[data-padding] .hero {
		margin-block: 0;
	}
	.player-section[data-padding] .field-controls :global(button),
	.player-section[data-padding] .transport button,
	.player-section[data-padding] .modes button,
	.player-section[data-padding] .content :global(summary),
	.player-section[data-padding] .up-next > button {
		padding: 0;
		min-height: 44px;
	}
	.player-section[data-padding] .content :global(summary) {
		align-content: center;
	}
	.player-section[data-padding] .content > h2 {
		margin: 0;
	}

	.editing-field {
		container-type: inline-size;
		position: relative;
		min-height: 0;
		align-self: stretch;
		align-content: var(--cell-v-align, center);
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
		gap: var(--row-gap, min(var(--gap), 3vw));
	}
	.lines {
		min-block-size: calc(var(--reserved-lines, 0) * 1lh);
	}
	.player-section[data-lines] .lines {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--field-lines);
		line-clamp: var(--field-lines);
		overflow: hidden;
	}
	.empty-slot {
		display: block;
		min-height: var(--slot-height, 44px);
	}
	.player-section {
		display: grid;
		align-self: stretch;
		align-content: var(--cell-v-align, center);

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
	.field-time {
		margin: 0;
		overflow-wrap: anywhere;
		color: var(--muted);
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
		container-type: inline-size;
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
		position: relative;
		top: 0;
		z-index: 1;
		align-self: start;
		min-height: 3.8rem;
		display: grid;
		align-content: center;
		background: var(--bg);
	}
	.compact-header {
		position: sticky;
	}
	.sample .player-header {
		position: relative;
		top: auto;
		z-index: 0;
	}
	.unavailable-field {
		color: var(--muted);
		text-align: center;
		display: block;
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
	.track-meta h1 {
		font-size: calc(clamp(1.75rem, 7vw, 2.45rem) * var(--cell-scale));
	}
	.track-meta p {
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
		flex-wrap: wrap;
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
