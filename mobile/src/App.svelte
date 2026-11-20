<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import { App as NativeApp } from '@capacitor/app';
	import { House, LibraryBig, Compass, Search, ListChecks, Settings2 } from '@lucide/svelte';
	import Connect from './lib/auth/Connect.svelte';
	import { restoreSession, signOut, forgetSession, type Session } from './lib/connection';
	import { player, type PlayerTrack } from './lib/player';
	import PlayerView from './lib/PlayerView.svelte';
	import Catalog from './lib/catalog/Catalog.svelte';
	import type { CatalogTab } from './lib/catalog/catalog';
	import Appearance from './lib/appearance/Appearance.svelte';
	import brand from '../../frontend/static/android-chrome-192x192.png';
	let session = $state<Session | null>(null);
	let loading = $state(true);
	let tab = $state<CatalogTab>('home');
	let panel = $state<'catalog' | 'player' | 'queue' | 'settings'>('catalog');
	let catalogScroll = 0;
	let catalogVisit = $state(0);
	const inPlayer = $derived(panel === 'player' || panel === 'queue');
	let issue = $state('');
	let main: HTMLElement;
	let catalog = $state<{ backToBoard: () => boolean }>();
	const tabs = [
		{ id: 'home', label: 'Home', icon: House },
		{ id: 'library', label: 'Library', icon: LibraryBig },
		{ id: 'search', label: 'Search', icon: Search },
		{ id: 'discover', label: 'Discover', icon: Compass },
		{ id: 'requests', label: 'Requests', icon: ListChecks }
	] as const;
	function report(error: unknown) {
		issue = error instanceof Error ? error.message : 'The app could not finish that action.';
	}
	function navigate(to: CatalogTab) {
		catalogVisit++;
		tab = to;
		panel = 'catalog';
		issue = '';
		focusMain();
	}
	function focusMain(offset = 0) {
		void tick().then(() => {
			main?.scrollTo(0, offset);
			main?.focus({ preventScroll: true });
		});
	}
	function openPanel(next: 'player' | 'settings') {
		catalogScroll = main?.scrollTop ?? 0;
		panel = next;
		focusMain();
	}
	function closePanel() {
		panel = 'catalog';
		focusMain(catalogScroll);
	}
	function toggleQueue() {
		panel = panel === 'queue' ? 'player' : 'queue';
		focusMain();
	}
	function back() {
		if (panel === 'queue') {
			toggleQueue();
			return true;
		}
		if (panel !== 'catalog') {
			closePanel();
			return true;
		}
		if (!window.dispatchEvent(new CustomEvent('dn-back', { cancelable: true }))) return true;
		if (catalog?.backToBoard()) return true;
		if (tab !== 'home') {
			navigate('home');
			return true;
		}
		return false;
	}
	async function connected(next: Session) {
		let restoreError: unknown;
		try {
			await player.restore(next);
		} catch (error) {
			restoreError = error;
		}
		session = next;
		navigate('home');
		if (restoreError) report(restoreError);
	}
	async function start(tracks: PlayerTrack[], index: number) {
		const account = session;
		if (!account) return;
		try {
			await player.setQueue(tracks, index, account);
			if (session === account) {
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
		panel = 'catalog';
		tab = 'home';
		issue = '';
		const outcomes = await Promise.allSettled([
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
		window.addEventListener('dn-session-expired', expired);
		window.addEventListener('keydown', key);
		return () => {
			void listener?.then((handle) => handle.remove());
			window.removeEventListener('dn-session-expired', expired);
			window.removeEventListener('keydown', key);
		};
	});
</script>

<div class="shell" data-part="app">
	{#if !inPlayer}
		<header class="mast">
			<span class="wordmark"><img src={brand} alt="" /> DroppedNeedle</span>
			{#if panel !== 'settings'}
				<button class="icon-button" aria-label="Settings" onclick={() => openPanel('settings')}
					><Settings2 size={19} /></button
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
					{#key catalogVisit}<Catalog
							bind:this={catalog}
							{session}
							active={panel === 'catalog'}
							{tab}
							onplay={start}
							onnavigate={navigate}
						/>{/key}
				</div>
			{:else if panel !== 'settings'}
				<div class="pad"><Connect onconnected={connected} /></div>
			{/if}
			{#if panel === 'settings'}
				<div class="pad">
					<Appearance {session} onback={() => back()} onsignout={() => disconnect()} />
				</div>
			{/if}
			{#if inPlayer && session}
				<PlayerView
					{session}
					expanded={true}
					queueOpen={panel === 'queue'}
					ontogglequeue={toggleQueue}
					onexpand={() => {}}
					oncollapse={closePanel}
					onerror={report}
				/>
			{/if}
		{/if}
	</main>
	{#if session && panel === 'catalog'}
		<footer>
			<PlayerView
				{session}
				expanded={false}
				onexpand={() => openPanel('player')}
				oncollapse={() => {}}
				onerror={report}
			/>
			<nav aria-label="Music">
				{#each tabs as item (item.id)}
					<button
						aria-current={tab === item.id ? 'page' : undefined}
						onclick={() => navigate(item.id)}
						><item.icon size={21} /><span>{item.label}</span></button
					>
				{/each}
			</nav>
		</footer>
	{/if}
</div>

<style>
	.shell {
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
		justify-content: space-between;
		min-height: 3.75rem;
		margin: 0 var(--gap);
	}
	.wordmark {
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
	nav {
		display: flex;
		align-items: center;
		justify-content: space-evenly;
		padding: 0.1rem 0 0.22rem;
	}
	nav button {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.2rem;
		min-height: 52px;
		min-width: 0;
		flex: 1;
		color: var(--muted);
	}
	nav span {
		font-size: 0.77rem;
	}
	nav [aria-current='page'] {
		color: var(--accent);
		font-weight: 700;
	}
</style>
