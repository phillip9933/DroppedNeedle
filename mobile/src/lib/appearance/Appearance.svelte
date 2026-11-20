<script lang="ts">
	import type { DrawerControl } from '../NavigationDrawer.svelte';
	import { onMount, tick } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import InterfaceSettings from './InterfaceSettings.svelte';
	import { changeScreen } from './interface';
	import OfflineSettings from '../offline/OfflineSettings.svelte';
	import { offlineSupported } from '../offline/media';
	import PlaybackSettings from '../player/PlaybackSettings.svelte';
	import EqualizerSettings from '../player/EqualizerSettings.svelte';
	import {
		ChevronLeft,
		ChevronRight,
		House,
		LibraryBig,
		Compass,
		Disc3,
		Palette,
		UserRound,
		SlidersHorizontal,
		Globe,
		Activity,
		Info,
		Layers,
		Music2
	} from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path } from '../catalog/catalog';
	import { type Board } from '../boards/layout';
	import BoardSettings from '../boards/BoardSettings.svelte';
	import ThemeSettings from './ThemeSettings.svelte';
	import Account from './Account.svelte';
	import LibraryScans from './LibraryScans.svelte';
	import ReleaseSettings from './ReleaseSettings.svelte';
	import WebTools from './WebTools.svelte';
	import Statistics from './Statistics.svelte';
	import ServerSections from './ServerSections.svelte';
	import pkg from '../../../package.json';
	type Page =
		| Board
		| 'player'
		| 'themes'
		| 'interface'
		| 'offline'
		| 'playback'
		| 'equalizer'
		| 'account'
		| 'content'
		| 'tools'
		| 'editions'
		| 'releases'
		| 'stats'
		| 'diagnostics'
		| 'scans'
		| 'about'
		| 'menu';
	let {
		session,
		navigation,
		onback,
		onplayerlayoutclose,
		onsignout,
		initial = 'menu'
	}: {
		session: Session | null;
		navigation: DrawerControl;
		onback: () => void;
		onplayerlayoutclose: () => void;
		onsignout: () => Promise<void>;
		initial?: Page;
	} = $props();
	let page = $state<Page>('menu'),
		root: HTMLElement,
		offset = 0,
		busy = $state(false),
		admin = $state(false),
		roleError = $state(''),
		version = $state(''),
		versionError = $state('');
	const layouts = [
		{ id: 'home', label: 'Home', icon: House },
		{ id: 'library', label: 'Library', icon: LibraryBig },
		{ id: 'discover', label: 'Discover', icon: Compass },
		{ id: 'player', label: 'Now Playing', icon: Disc3 }
	] as const;
	const personal = [
		{ id: 'account', label: 'Account on DroppedNeedle', icon: UserRound },
		{ id: 'stats', label: 'Library statistics', icon: LibraryBig },
		{ id: 'content', label: 'Content preferences', icon: SlidersHorizontal },
		{ id: 'tools', label: 'Web tools', icon: Globe }
	] as const;
	const administration = [
		{ id: 'diagnostics', label: 'Server diagnostics', icon: Activity },
		{ id: 'scans', label: 'Library health and scans', icon: Activity },
		{ id: 'releases', label: 'Release types', icon: Music2 },
		{ id: 'editions', label: 'Edition preferences', icon: Layers }
	] as const;
	const title = $derived(
		[
			...personal,
			...administration,
			{ id: 'themes', label: 'Themes' },
			{ id: 'interface', label: 'Interface and navigation' },
			{ id: 'offline', label: 'Offline and cache' },
			{ id: 'playback', label: 'Streaming and fades' },
			{ id: 'equalizer', label: 'Equalizer' },
			{ id: 'about', label: 'About' }
		].find((i) => i.id === page)?.label ?? 'Settings'
	);
	async function readRole() {
		if (!session) return;
		roleError = '';
		try {
			admin =
				(await getJson<components['schemas']['UserResponse']>(session, path('/api/v3/me'))).role ===
				'admin';
		} catch (e) {
			roleError = errorMessage(e);
		}
	}
	async function readVersion() {
		if (!session) return;
		versionError = '';
		try {
			version = (
				await getJson<components['schemas']['VersionInfo']>(session, path('/api/v3/version'))
			).version;
		} catch (e) {
			versionError = errorMessage(e);
		}
	}
	function focus(y = 0) {
		void tick().then(() => {
			const m = root?.closest('main');
			m?.scrollTo(0, y);
			m?.focus({ preventScroll: true });
		});
	}
	function open(next: Page) {
		changeScreen(() => {
			offset = root?.closest('main')?.scrollTop ?? 0;
			page = next;
			focus();
			if (next === 'about') void readVersion();
		});
	}
	export function goBack() {
		if (page === 'menu') return false;
		if (page === 'player') {
			onplayerlayoutclose();
			return true;
		}
		changeScreen(() => {
			page = 'menu';
			focus(offset);
		});
		return true;
	}
	function back() {
		if (!goBack()) onback();
	}
	async function signOut() {
		busy = true;
		try {
			await onsignout();
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		if (initial !== 'menu') page = initial;
		void readRole();
	});
</script>

<section class="settings" bind:this={root}>
	{#if session && (page === 'home' || page === 'discover' || page === 'library' || page === 'player')}
		{#key page}<BoardSettings {session} {navigation} board={page} onback={back} />{/key}
	{:else}
		<button aria-label="Back" class="text-button back" data-screen-link onclick={back}
			><ChevronLeft size={18} />{page === 'menu' ? 'Back' : 'Settings'}</button
		>
		<h1>{page === 'menu' ? 'Settings' : title}</h1>
		{#if page === 'menu'}
			{#if session}<h2>Screen layouts</h2>
				<div class="menu">
					{#each layouts as item (item.id)}<button
							class="entry"
							data-screen-link
							aria-label={'Edit ' + item.label + ' layout'}
							onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>{/if}
			<h2>Appearance</h2>
			<div class="menu">
				<button class="entry" data-screen-link onclick={() => open('themes')}
					><Palette size={19} /><span>Themes</span><ChevronRight size={16} /></button
				>
				<button class="entry" data-screen-link onclick={() => open('interface')}
					><SlidersHorizontal size={19} /><span>Interface and navigation</span><ChevronRight
						size={16}
					/></button
				>
			</div>
			{#if session}
				<h2>Playback</h2>
				<div class="menu">
					<button class="entry" data-screen-link onclick={() => open('playback')}
						><Music2 size={19} /><span>Streaming and fades</span><ChevronRight size={16} /></button
					>
					{#if offlineSupported}<button
							class="entry"
							data-screen-link
							onclick={() => open('offline')}
							><Layers size={19} /><span>Offline and cache</span><ChevronRight size={16} /></button
						>{/if}
					{#if Capacitor.getPlatform() === 'android'}<button
							class="entry"
							data-screen-link
							onclick={() => open('equalizer')}
							><SlidersHorizontal size={19} /><span>Equalizer</span><ChevronRight
								size={16}
							/></button
						>{/if}
				</div>
			{/if}
			{#if session}
				<h2>Your account</h2>
				<div class="menu">
					{#each personal as item (item.id)}<button
							class="entry"
							data-screen-link
							onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>
				{#if admin}<h2>Server administration</h2>
					<div class="menu">
						{#each administration as item (item.id)}<button
								class="entry"
								data-screen-link
								onclick={() => open(item.id)}
								><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
							>{/each}
					</div>{/if}
				{#if roleError}<p role="alert">{roleError}</p>
					<button class="text-button" onclick={readRole}>Reload permissions</button>{/if}
			{/if}
			<h2>App</h2>
			<div class="menu">
				<button class="entry" data-screen-link onclick={() => open('about')}
					><Info size={19} /><span>About</span><ChevronRight size={16} /></button
				>
			</div>
			{#if session}<p class="server">{session.serverUrl}</p>
				<button class="secondary" disabled={busy} onclick={signOut}>Sign out</button>{/if}
		{:else if page === 'equalizer' && session && Capacitor.getPlatform() === 'android'}<EqualizerSettings
			/>
		{:else if page === 'interface'}<InterfaceSettings {session} offline={offlineSupported} />
		{:else if page === 'offline' && session && offlineSupported}<OfflineSettings {session} />
		{:else if page === 'playback' && session}<PlaybackSettings {session} />
		{:else if page === 'themes'}<ThemeSettings {session} />
		{:else if page === 'account' && session}<Account {session} />
		{:else if page === 'content' && session}<ServerSections {session} {admin} />
		{:else if page === 'tools' && session}<WebTools {session} {admin} />
		{:else if session && (page === 'stats' || (page === 'diagnostics' && admin))}<Statistics
				{session}
				diagnostics={page === 'diagnostics'}
			/>
		{:else if page === 'scans' && session && admin}<LibraryScans {session} />
		{:else if (page === 'editions' || page === 'releases') && session && admin}<ReleaseSettings
				{session}
				editions={page === 'editions'}
			/>
		{:else if page === 'about'}<dl>
				<dt>Mobile app</dt>
				<dd>{pkg.version}</dd>
				{#if session}<dt>Connected server</dt>
					<dd>{session.serverUrl}</dd>
					<dt>DN version</dt>
					<dd>{version || '—'}</dd>{/if}
			</dl>
			{#if versionError}<p role="alert">{versionError}</p>
				<button class="text-button" onclick={readVersion}>Reload server version</button>{/if}
		{/if}
	{/if}
</section>

<style>
	.settings {
		max-width: 42rem;
		margin: auto;
		padding-bottom: 1rem;
	}
	.back {
		margin-bottom: 0.4rem;
	}
	.settings h1 {
		margin: 0.25rem 0 1.2rem;
	}
	.settings h2 {
		margin: 1.25rem 0 0.4rem;
		font-size: 1.12rem;
	}
	.menu {
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface);
		overflow: hidden;
	}
	.entry {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.6rem var(--gap);
		width: 100%;
		min-height: 48px;
		text-align: left;
	}
	.entry + .entry {
		border-top: 1px solid var(--line);
	}
	.entry span {
		flex: 1;
		font-weight: 600;
	}
	.entry :global(svg:last-child) {
		color: var(--muted);
	}
	.entry:focus-visible {
		outline-offset: -3px;
	}
	.server,
	dt {
		color: var(--muted);
	}
	.server,
	dd {
		overflow-wrap: anywhere;
	}
	dd {
		margin: 0 0 0.8rem;
	}
</style>
