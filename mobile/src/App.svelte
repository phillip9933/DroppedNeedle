<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { Capacitor } from '@capacitor/core';
	import { App as NativeApp } from '@capacitor/app';
	import { Menu, Settings2 } from '@lucide/svelte';
	import Navigation from './lib/Navigation.svelte';
	import NavigationDrawer from './lib/NavigationDrawer.svelte';
	import {
		changeScreen,
		interfacePreferences,
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
	import Appearance from './lib/appearance/Appearance.svelte';
	import brand from '../../frontend/static/android-chrome-192x192.png';
	let session = $state<Session | null>(null);
	let loading = $state(true);
	let tab = $state<BrowseDestination>('home');
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
	let drawer = $state<{ show: () => Promise<void>; back: () => boolean }>();
	let drawerOpen = $state(false);
	function visibleMenuButton() {
		return Array.from(shell?.querySelectorAll<HTMLButtonElement>('.menu-toggle') ?? []).find(
			(button) => button.getClientRects().length > 0
		);
	}
	let footerHeight = $state(0);
	let settings = $state<{ goBack: () => boolean }>();
	let catalog = $state<Catalog>();
	const catalogHeader = $derived(panel === 'catalog' && session ? catalog?.getHeader() : undefined);
	function report(error: unknown) {
		issue = error instanceof Error ? error.message : 'The app could not finish that action.';
	}
	function navigate(to: BrowseDestination) {
		changeScreen(() => {
			clearRelated();
			catalogVisit++;
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
		else navigate(to);
	}
	function focusMain(offset = 0, miniAction?: MiniAction) {
		void tick().then(() => {
			main?.scrollTo(0, offset);
			const footerButton =
				miniAction &&
				(shell?.querySelector<HTMLElement>(`footer [data-mini-action="${miniAction}"]`) ??
					shell?.querySelector<HTMLElement>('footer [data-mini-action="player"]'));
			(footerButton || main)?.focus({ preventScroll: true });
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
			clearRelated();
			void tick().then(() => {
				main?.scrollTo(0, offset);
				(control?.isConnected && !control.closest('[hidden]') ? control : main)?.focus({
					preventScroll: true
				});
			});
		});
	}
	function openPanel(next: 'player' | 'queue' | 'settings', fromMini = false) {
		changeScreen(() => {
			clearRelated();
			fromPlayer = false;
			if (panel === 'catalog') {
				catalogScroll = main?.scrollTop ?? 0;
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
			const target = panel === 'settings' ? settingsOrigin : 'catalog';
			settingsOrigin = 'catalog';
			panel = target;
			focusMain(
				target === 'catalog' ? catalogScroll : playerScroll,
				target === 'catalog' ? miniReturn : undefined
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
		if (drawer?.back()) return true;
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
		if (restoreError) report(restoreError);
	}
	async function start(tracks: PlayerTrack[], index: number, continuation?: LibraryContinuation) {
		const account = session;
		if (!account) return;
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
				openPanel('player');
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
		drawerOpen = false;
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
		window.addEventListener('dn-session-expired', expired);
		window.addEventListener('keydown', key);
		return () => {
			void listener?.then((handle) => handle.remove());
			window.removeEventListener('dn-open-offline', openOffline);
			window.removeEventListener('dn-session-expired', expired);
			window.removeEventListener('keydown', key);
		};
	});
</script>

{#snippet menuToggle()}
	<button
		type="button"
		class="icon-button menu-toggle"
		aria-label="Open navigation menu"
		aria-haspopup="dialog"
		aria-controls={drawerOpen ? 'navigation-drawer' : undefined}
		aria-expanded={drawerOpen}
		onclick={() => drawer?.show()}><Menu size={23} /></button
	>
{/snippet}

<div class="shell" data-part="app" bind:this={shell} style:--footer-height={footerHeight + 'px'}>
	{#if session && shell}
		<NavigationDrawer
			bind:this={drawer}
			bind:open={drawerOpen}
			{shell}
			trigger={visibleMenuButton}
			current={panel === 'catalog' ? tab : panel === 'settings' ? 'settings' : undefined}
			showAll={panel !== 'catalog'}
			offline={offlineSupported}
			onnavigate={choose}
		/>
	{/if}
	{#if !inPlayer || related}
		<header class="mast">
			{#if session}{@render menuToggle()}{/if}
			{#if catalogHeader}{@render catalogHeader()}{:else}
				<span class="wordmark"><img src={brand} alt="" /> DroppedNeedle</span>
				{#if panel !== 'settings' && (!session || $interfacePreferences.headerSettings)}
					<button
						class="icon-button"
						aria-label="Settings"
						data-screen-link
						onclick={() => openPanel('settings')}><Settings2 size={19} /></button
					>
				{/if}
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
							{menuToggle}
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
						{menuToggle}
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
	{#if session && panel === 'catalog'}
		<footer bind:clientHeight={footerHeight}>
			<PlayerView
				{session}
				expanded={false}
				onexpand={() => openPanel('player', true)}
				ontogglequeue={() => openPanel('queue', true)}
				oncollapse={() => {}}
				onerror={report}
			/>
			<Navigation current={tab} offline={offlineSupported} onnavigate={choose} />
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
	.wordmark {
		margin-inline-end: auto;
		font-size: 1.05rem;
		font-weight: 690;
		display: flex;
		gap: 0.55rem;
		align-items: center;
		letter-spacing: -0.04em;
	}
	.wordmark img {
		width: 1.85rem;
		height: 1.85rem;
		object-fit: contain;
	}
	.menu-toggle {
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
