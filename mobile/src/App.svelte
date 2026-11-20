<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { Capacitor } from '@capacitor/core';
	import { App as NativeApp } from '@capacitor/app';
	import { Menu } from '@lucide/svelte';
	import Navigation from './lib/Navigation.svelte';
	import {
		changeScreen,
		interfacePreferences,
		libraryDestinations,
		readStartScreen,
		type BrowseDestination,
		type Destination
	} from './lib/appearance/interface';
	import {
		offlineSupported,
		preferredOffline,
		runAutoDownloads,
		stopAutoDownloads
	} from './lib/offline/media';
	import OfflineLibrary from './lib/offline/OfflineLibrary.svelte';
	import { nativeMedia } from './lib/offline/nativeMedia';
	import { connectTrackFeedback } from './lib/offline/feedback';
	import Connect from './lib/auth/Connect.svelte';
	import { restoreSession, signOut, forgetSession, type Session } from './lib/connection';
	import type { LibraryContinuation } from './lib/player/libraryWindow';
	import { player, type PlayerTrack } from './lib/player';
	import PlayerView from './lib/PlayerView.svelte';
	import PlayerLibraryDetail from './lib/player/PlayerLibraryDetail.svelte';
	import {
		rememberQueueSource,
		restoredQueueSource,
		type Credit,
		type PlayerCredit,
		type SavedScope
	} from './lib/player/related';
	import Catalog from './lib/catalog/Catalog.svelte';
	import type { Category } from './lib/catalog/libraryBrowse';
	import Appearance from './lib/appearance/Appearance.svelte';
	import brand from '../../frontend/static/logo_icon.png';
	let session = $state<Session | null>(null);
	let loading = $state(true);
	let tab = $state<BrowseDestination>('home');
	let initialCategory = $state<Category>();
	let panel = $state<'catalog' | 'player' | 'queue' | 'settings'>('catalog');
	let catalogScroll = 0;
	let offlineLibrary = $state<OfflineLibrary>();
	let queueScope: SavedScope | undefined;
	let related = $state.raw<PlayerCredit>();
	let relatedScroll = 0,
		creditControl: HTMLElement | undefined;
	let fromPlayer = $state(false);
	let playerScroll = 0;
	type MiniAction = 'player' | 'queue';
	let miniReturn: MiniAction | undefined;
	let queueFromMini = false;
	let settingsOrigin: 'catalog' | 'player' | 'queue' = 'catalog';
	let settingsVisit = $state(0);
	let catalogVisit = $state(0);
	const inPlayer = $derived(panel === 'player' || panel === 'queue');
	let issue = $state('');
	let main: HTMLElement;
	let shell = $state<HTMLElement>();
	let footerHeight = $state(0);
	let settings = $state<{ goBack: () => boolean }>();
	let catalog = $state<Catalog>();
	const catalogHeader = $derived(panel === 'catalog' && session ? catalog?.getHeader() : undefined);
	const dockDestination = $derived.by((): Destination => {
		if (panel === 'settings') return 'settings';
		const category = related
			? related.kind === 'album'
				? 'Albums'
				: 'Artists'
			: catalog?.getActiveCategory();
		const direct = libraryDestinations.find((item) => item.label === category);
		if (direct && $interfacePreferences.tabs.includes(direct.id)) return direct.id;
		return related || (tab === 'offline' && !$interfacePreferences.tabs.includes('offline'))
			? 'library'
			: tab;
	});
	function report(error: unknown) {
		issue = error instanceof Error ? error.message : 'The app could not finish that action.';
	}
	function navigate(to: BrowseDestination, category?: Category) {
		changeScreen(() => {
			clearRelated();
			catalogVisit++;
			initialCategory = category;
			tab = to;
			panel = 'catalog';
			issue = '';
			focusMain();
		});
	}
	function choose(to: Destination) {
		if (to === 'settings' && panel === 'settings') {
			fromPlayer = false;
			settingsVisit++;
			focusMain();
		} else if (to === 'settings') openPanel('settings');
		else if (
			to === 'playlists' ||
			to === 'artists' ||
			to === 'albums' ||
			to === 'tracks' ||
			to === 'genres'
		)
			navigate('library', libraryDestinations.find((d) => d.id === to)?.label);
		else navigate(to);
	}
	async function openDownloadNotification() {
		const owner = session;
		if (!owner?.userId || !offlineSupported || Capacitor.getPlatform() !== 'android') return;
		const pending = await nativeMedia.takeDownloadNotification().catch(() => undefined);
		if (pending?.open && session === owner) {
			navigate('offline');
		}
	}
	function focusMain(offset = 0, miniAction?: MiniAction, settingsFocus = false) {
		void tick().then(() => {
			main?.scrollTo(0, offset);
			const footerButton =
				miniAction &&
				(shell?.querySelector<HTMLElement>(`footer [data-mini-action="${miniAction}"]`) ??
					shell?.querySelector<HTMLElement>('footer [data-mini-action="player"]'));
			(
				(settingsFocus &&
					shell?.querySelector<HTMLElement>(
						'[data-settings-shortcut], [data-destination="settings"]'
					)) ||
				footerButton ||
				main
			)?.focus({ preventScroll: true });
		});
	}
	function clearRelated() {
		related = undefined;
		creditControl = undefined;
	}
	function openCredit(kind: Credit, track: PlayerTrack, control: HTMLElement) {
		if (!inPlayer || !session || related) return;
		changeScreen(() => {
			relatedScroll = main?.scrollTop ?? 0;
			creditControl = control;
			related = { kind, track, scope: queueScope };
			focusMain();
		});
	}
	function returnToPlayer() {
		const control = creditControl,
			offset = relatedScroll;
		changeScreen(() => {
			panel = 'player';
			queueFromMini = false;
			clearRelated();
			void tick().then(() => {
				main?.scrollTo(0, offset);
				(control?.isConnected && !control.closest('[hidden]') ? control : main)?.focus({
					preventScroll: true
				});
			});
		});
	}
	function openPanel(
		next: 'player' | 'queue' | 'settings',
		fromMini = false,
		returnOffset?: number
	) {
		changeScreen(() => {
			if (next !== 'settings') clearRelated();
			fromPlayer = false;
			if (panel === 'catalog') {
				catalogScroll = returnOffset ?? main?.scrollTop ?? 0;
				miniReturn = fromMini && next !== 'settings' ? next : undefined;
				queueFromMini = miniReturn === 'queue';
			}
			if (next === 'player') queueFromMini = false;
			if (next === 'settings') {
				settingsOrigin = panel === 'player' || panel === 'queue' ? panel : 'catalog';
				if (settingsOrigin !== 'catalog') playerScroll = main?.scrollTop ?? 0;
			}
			panel = next;
			focusMain();
		});
	}
	function playerSettings() {
		changeScreen(() => {
			playerScroll = main?.scrollTop ?? 0;
			fromPlayer = true;
			settingsOrigin = panel === 'queue' ? 'queue' : 'player';
			panel = 'settings';
			focusMain();
		});
	}
	function finishPlayerLayout() {
		changeScreen(() => {
			queueFromMini = false;
			panel = 'player';
			focusMain(fromPlayer ? playerScroll : 0);
			fromPlayer = false;
		});
	}
	function closePanel() {
		changeScreen(() => {
			const closingSettings = panel === 'settings';
			const target = closingSettings ? settingsOrigin : 'catalog';
			if (target === 'catalog') clearRelated();
			settingsOrigin = 'catalog';
			panel = target;
			focusMain(
				target === 'catalog' ? catalogScroll : playerScroll,
				target === 'catalog' ? miniReturn : undefined,
				closingSettings && target === 'catalog'
			);
			if (target === 'catalog') {
				miniReturn = undefined;
				queueFromMini = false;
			}
		});
	}
	function toggleQueue() {
		if (panel === 'queue' && queueFromMini) {
			closePanel();
			return;
		}
		changeScreen(() => {
			panel = panel === 'queue' ? 'player' : 'queue';
			focusMain();
		});
	}
	function back() {
		if (!window.dispatchEvent(new CustomEvent('dn-back', { cancelable: true }))) return true;
		if (related && inPlayer) {
			returnToPlayer();
			return true;
		}
		if (panel === 'settings' && settings?.goBack()) return true;
		if (panel === 'queue') {
			toggleQueue();
			return true;
		}
		if (panel !== 'catalog') {
			closePanel();
			return true;
		}
		if (tab === 'offline') {
			navigate('library');
			return true;
		}
		if (catalog?.backToBoard()) return true;
		if (tab !== 'home') {
			navigate('home');
			return true;
		}
		return false;
	}
	$effect(() => {
		const owner = session;
		if (!owner || !offlineSupported) return;
		const controller = new AbortController();
		const stopFeedback = connectTrackFeedback(owner);
		const sync = () => {
			if (!document.hidden && navigator.onLine)
				void runAutoDownloads(owner, controller.signal).catch(() => {});
		};
		sync();
		window.addEventListener('online', sync);
		document.addEventListener('visibilitychange', sync);
		return () => {
			controller.abort();
			stopFeedback();
			void stopAutoDownloads(owner).catch(() => {});
			window.removeEventListener('online', sync);
			document.removeEventListener('visibilitychange', sync);
		};
	});
	async function connected(next: Session) {
		let restoreError: unknown;
		let hasCurrentTrack = false;
		try {
			await player.restore(next);
			const queue = get(player);
			hasCurrentTrack = !!queue.tracks[queue.index];
			queueScope = await restoredQueueSource(next, queue.tracks);
		} catch (error) {
			restoreError = error;
		}
		const start = readStartScreen(next);
		if (start === 'automatic') {
			const offline =
				offlineSupported &&
				(!navigator.onLine || (await preferredOffline(next).catch(() => false)));
			tab = offline ? 'offline' : 'home';
		} else tab = start === 'player' ? 'library' : start;
		session = next;
		miniReturn = undefined;
		queueFromMini = false;
		panel = start === 'player' && hasCurrentTrack ? 'player' : 'catalog';
		catalogVisit++;
		focusMain();
		await openDownloadNotification();
		if (restoreError) report(restoreError);
	}
	async function start(tracks: PlayerTrack[], index: number, continuation?: LibraryContinuation) {
		const account = session;
		if (!account) return;
		const originVisit = catalogVisit,
			offset = panel === 'catalog' ? main?.scrollTop : undefined;
		const origin = related
			? related.scope
			: panel === 'catalog'
				? tab === 'offline'
					? offlineLibrary?.getPlaybackAvailability()
					: catalog?.getPlaybackAvailability()
				: undefined;
		try {
			await player.setQueue(tracks, index, account, continuation);
			if (session === account) {
				queueScope = origin;
				rememberQueueSource(account, origin, tracks);
				issue = '';
				openPanel('player', false, originVisit === catalogVisit ? offset : undefined);
			}
		} catch (error) {
			report(error);
		}
	}
	async function disconnect(expired = false) {
		const previous = session;
		if (!previous) return;
		session = null;
		clearRelated();
		rememberQueueSource(previous);
		queueScope = undefined;
		initialCategory = undefined;
		panel = 'catalog';
		tab = 'home';
		issue = '';
		const outcomes = await Promise.allSettled([
			...(Capacitor.getPlatform() === 'android' && previous.userId
				? [nativeMedia.cancelManual({ serverUrl: previous.serverUrl, userId: previous.userId })]
				: []),
			player.clear(),
			expired ? forgetSession() : signOut(previous)
		]);
		const failure = outcomes.find((item) => item.status === 'rejected');
		if (failure?.status === 'rejected') report(failure.reason);
		else if (expired) issue = 'Your session ended. Sign in again.';
	}
	onMount(() => {
		void restoreSession()
			.then(async (result) => {
				if (result) await connected(result);
				else if (Capacitor.getPlatform() === 'android') await player.clear();
			})
			.catch(report)
			.finally(() => (loading = false));
		function expired(event: Event) {
			const old = (event as CustomEvent<Session>).detail;
			if (session && session.serverUrl === old.serverUrl && session.token === old.token)
				void disconnect(true);
		}
		function key(event: KeyboardEvent) {
			if (event.key === 'Escape' && back()) event.preventDefault();
		}
		const listener =
			Capacitor.getPlatform() === 'android'
				? NativeApp.addListener('backButton', () => {
						if (!back()) void NativeApp.minimizeApp().catch(report);
					})
				: null;
		const openOffline = () => {
			if (session && offlineSupported) navigate('offline');
		};
		window.addEventListener('dn-open-offline', openOffline);
		window.addEventListener('dn-download-notification', openDownloadNotification);
		window.addEventListener('dn-session-expired', expired);
		window.addEventListener('keydown', key);
		return () => {
			void listener?.then((handle) => handle.remove());
			window.removeEventListener('dn-open-offline', openOffline);
			window.removeEventListener('dn-download-notification', openDownloadNotification);
			window.removeEventListener('dn-session-expired', expired);
			window.removeEventListener('keydown', key);
		};
	});
</script>

<div class="shell" data-part="app" bind:this={shell} style:--footer-height={footerHeight + 'px'}>
	{#if !inPlayer || related}
		<header class="mast">
			{#if catalogHeader}{@render catalogHeader()}{:else}
				<span
					class="brand-mark"
					role="img"
					aria-label="DroppedNeedle"
					style:--brand-mark={'url("' + brand + '")'}
				></span>
			{/if}
			{#if panel !== 'settings' && (!session || !$interfacePreferences.tabs.includes('settings'))}
				<button
					type="button"
					class="icon-button settings-shortcut"
					data-settings-shortcut
					aria-label="Settings"
					data-screen-link
					onclick={() => openPanel('settings')}><Menu size={24} /></button
				>
			{/if}
		</header>
	{/if}
	{#if issue}<div class="notice">
			<p role="alert">{issue}</p>
			<button class="text-button" onclick={() => (issue = '')}>Dismiss</button>
		</div>{/if}
	<main bind:this={main} tabindex="-1">
		{#if loading}<p role="status" class="pad">Opening DroppedNeedle…</p>
		{:else}
			{#if session}
				<div hidden={panel !== 'catalog'} class="pad">
					{#key catalogVisit}{#if tab === 'offline'}<OfflineLibrary
								bind:this={offlineLibrary}
								{session}
								onplay={start}
							/>{:else}<Catalog
								bind:this={catalog}
								{session}
								active={panel === 'catalog'}
								{tab}
								{initialCategory}
								onplay={start}
								onoffline={offlineSupported ? () => navigate('offline') : undefined}
								onnavigate={navigate}
							/>{/if}{/key}
				</div>
			{:else if panel !== 'settings'}
				<div class="pad"><Connect onconnected={connected} /></div>
			{/if}
			{#if panel === 'settings'}
				<div class="pad">
					{#key settingsVisit}<Appearance
							bind:this={settings}
							onnavigate={choose}
							initial={fromPlayer ? 'player' : 'menu'}
							{session}
							onback={closePanel}
							onplayerlayoutclose={finishPlayerLayout}
							onsignout={() => disconnect()}
						/>{/key}
				</div>
			{/if}
			{#if inPlayer && session}
				<div hidden={!!related}>
					<PlayerView
						oncredit={openCredit}
						{session}
						expanded={true}
						queueOpen={panel === 'queue'}
						ontogglequeue={toggleQueue}
						onsettings={playerSettings}
						onexpand={() => {}}
						oncollapse={closePanel}
						onerror={report}
					/>
				</div>
				{#if related}<div class="pad">
						<PlayerLibraryDetail
							{session}
							credit={related}
							onback={returnToPlayer}
							onplay={start}
							onnavigate={navigate}
						/>
					</div>{/if}
			{/if}
		{/if}
	</main>
	{#if session && (panel === 'catalog' || (inPlayer && related) || (panel === 'settings' && !fromPlayer && $interfacePreferences.tabs.includes('settings')))}
		<footer bind:clientHeight={footerHeight}>
			<PlayerView
				{session}
				expanded={false}
				onexpand={() => (related && inPlayer ? returnToPlayer() : openPanel('player', true))}
				ontogglequeue={() => openPanel('queue', true)}
				oncollapse={() => {}}
				onerror={report}
			/>
			<Navigation current={dockDestination} offline={offlineSupported} onnavigate={choose} />
		</footer>
	{/if}
</div>

<style>
	.shell {
		position: relative;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		max-width: 52rem;
		margin: auto;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
	}
	.mast {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 3.75rem;
		margin: 0 var(--gap);
	}
	.shell:has(:global([data-part='layout-preview'])) > .mast {
		display: none;
	}
	.brand-mark {
		width: 3.35rem;
		aspect-ratio: 641 / 334;
		background: linear-gradient(110deg, #76ab40 0%, #b8dc61 58%, #f3d66a 100%);
		mask: var(--brand-mark) left center / contain no-repeat;
		-webkit-mask: var(--brand-mark) left center / contain no-repeat;
	}
	@media (forced-colors: active) {
		.brand-mark {
			background: CanvasText;
			forced-color-adjust: none;
		}
	}
	.settings-shortcut {
		margin-inline-start: auto;
		flex: none;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}
	main:focus {
		outline: none;
	}
	.pad {
		padding: var(--gap) var(--gap) max(2rem, env(safe-area-inset-bottom));
	}
	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
		padding: 0 var(--gap);
		background: var(--surface);
	}
	footer {
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--bg);
	}
	:global(html[data-navigation='floating']) .shell:has(footer) .pad {
		padding-bottom: calc(var(--footer-height) + var(--gap));
	}
	:global(html[data-navigation='floating']) footer {
		position: absolute;
		inset: auto env(safe-area-inset-right) 0 env(safe-area-inset-left);
		background: transparent;
		pointer-events: none;
	}
	:global(html[data-navigation='floating']) footer :global(.mini),
	:global(html[data-navigation='floating']) footer :global(nav),
	:global(html[data-navigation='floating']) footer :global(dialog) {
		pointer-events: auto;
	}
</style>
