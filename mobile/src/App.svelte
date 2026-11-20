<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import { App as NativeApp } from '@capacitor/app';
	import { LibraryBig, Search, ListChecks, Settings2 } from '@lucide/svelte';
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
	let tab = $state<CatalogTab>('library');
	let panel = $state<'catalog' | 'player' | 'settings'>('catalog');
	let issue = $state('');
	let main: HTMLElement;
	const tabs = [
		{ id: 'library', label: 'Library', icon: LibraryBig },
		{ id: 'search', label: 'Search', icon: Search },
		{ id: 'requests', label: 'Requests', icon: ListChecks }
	] as const;
	function report(error: unknown) {
		issue = error instanceof Error ? error.message : 'The app could not finish that action.';
	}
	function navigate(to: CatalogTab) {
		tab = to;
		panel = 'catalog';
		issue = '';
		focusMain();
	}
	function focusMain() {
		void tick().then(() => {
			main?.scrollTo(0, 0);
			main?.focus({ preventScroll: true });
		});
	}
	function back() {
		if (panel !== 'catalog') {
			panel = 'catalog';
			focusMain();
			return true;
		}
		if (!window.dispatchEvent(new CustomEvent('dn-back', { cancelable: true }))) return true;
		if (tab !== 'library') {
			navigate('library');
			return true;
		}
		return false;
	}
	function connected(next: Session) {
		session = next;
		navigate('library');
	}
	async function start(tracks: PlayerTrack[], index: number) {
		const account = session;
		if (!account) return;
		try {
			await player.setQueue(tracks, index, account);
			if (session === account) {
				panel = 'player';
				issue = '';
				focusMain();
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
		tab = 'library';
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
			.then((result) => (session = result))
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
	{#if panel !== 'player'}
		<header class="mast">
			<span class="wordmark"><img src={brand} alt="" /> DroppedNeedle</span>
			{#if panel !== 'settings'}
				<button
					class="icon-button"
					aria-label="Settings"
					onclick={() => {
						panel = 'settings';
						focusMain();
					}}><Settings2 size={19} /></button
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
					{#key tab}<Catalog {session} {tab} onplay={start} onnavigate={navigate} />{/key}
				</div>
			{:else if panel !== 'settings'}
				<div class="pad"><Connect onconnected={connected} /></div>
			{/if}
			{#if panel === 'settings'}
				<div class="pad">
					<Appearance
						server={session?.serverUrl ?? ''}
						onback={() => back()}
						onsignout={() => disconnect()}
					/>
				</div>
			{/if}
			{#if panel === 'player' && session}
				<PlayerView
					{session}
					expanded={true}
					onexpand={() => {}}
					oncollapse={() => back()}
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
				onexpand={() => {
					panel = 'player';
					focusMain();
				}}
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
		min-width: 25%;
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
