<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import InterfaceSettings from './InterfaceSettings.svelte';
	import './settings.css';
	import { shortcuts, changeScreen, type Destination } from './interface';
	import Outputs from '../player/Outputs.svelte';
	import OfflineSettings from '../offline/OfflineSettings.svelte';
	import { offlineSupported, preferredOffline } from '../offline/media';
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
		onnavigate,
		onback,
		onplayerlayoutclose,
		onsignout,
		initial = 'menu'
	}: {
		session: Session | null;
		onnavigate: (destination: Destination) => void;
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
		if (
			!session ||
			!navigator.onLine ||
			(offlineSupported && (await preferredOffline(session).catch(() => false)))
		)
			return;
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

{#snippet groupHeading(label: string)}
	<svelte:element this={session ? 'h3' : 'h2'} class="settings-group-heading"
		>{label}</svelte:element
	>
{/snippet}

<section class="settings" data-part="settings" bind:this={root}>
	{#if session && (page === 'home' || page === 'discover' || page === 'library' || page === 'player')}
		{#key page}<BoardSettings {session} board={page} onback={back} />{/key}
	{:else}
		<button aria-label="Back" class="text-button back" data-screen-link onclick={back}
			><ChevronLeft size={18} />{page === 'menu' ? 'Back' : 'Settings'}</button
		>
		<h1 class="settings-title">
			{page === 'menu' ? (session ? 'Navigation' : 'Settings') : title}
		</h1>
		{#if page === 'menu'}
			{#if session}
				<nav class="shortcuts" aria-label="Navigation shortcuts">
					{#each shortcuts as item (item.id)}<button
							class="shortcut"
							data-surface="panel"
							data-screen-link
							onclick={() => onnavigate(item.id)}
							><item.icon size={21} /><span>{item.label}</span></button
						>{/each}
				</nav>
				<h2 class="settings-heading">Settings</h2>
				{@render groupHeading('Screen layouts')}
				<div class="settings-list" data-surface="panel">
					{#each layouts as item (item.id)}<button
							class="settings-entry"
							data-screen-link
							aria-label={'Edit ' + item.label + ' layout'}
							onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>{/if}
			{@render groupHeading('Appearance')}
			<div class="settings-list" data-surface="panel">
				<button class="settings-entry" data-screen-link onclick={() => open('themes')}
					><Palette size={19} /><span>Themes</span><ChevronRight size={16} /></button
				>
				<button class="settings-entry" data-screen-link onclick={() => open('interface')}
					><SlidersHorizontal size={19} /><span>Interface and navigation</span><ChevronRight
						size={16}
					/></button
				>
			</div>
			{#if session}
				{@render groupHeading('Playback')}
				<div class="settings-list" data-surface="panel">
					<Outputs settingsEntry />
					<button class="settings-entry" data-screen-link onclick={() => open('playback')}
						><Music2 size={19} /><span>Streaming and fades</span><ChevronRight size={16} /></button
					>
					{#if offlineSupported}<button
							class="settings-entry"
							data-screen-link
							onclick={() => open('offline')}
							><Layers size={19} /><span>Offline and cache</span><ChevronRight size={16} /></button
						>{/if}
					{#if Capacitor.getPlatform() === 'android'}<button
							class="settings-entry"
							data-screen-link
							onclick={() => open('equalizer')}
							><SlidersHorizontal size={19} /><span>Equalizer</span><ChevronRight
								size={16}
							/></button
						>{/if}
				</div>
			{/if}
			{#if session}
				{@render groupHeading('Your account')}
				<div class="settings-list" data-surface="panel">
					{#each personal as item (item.id)}<button
							class="settings-entry"
							data-screen-link
							onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>
				{#if admin}{@render groupHeading('Server administration')}
					<div class="settings-list" data-surface="panel">
						{#each administration as item (item.id)}<button
								class="settings-entry"
								data-screen-link
								onclick={() => open(item.id)}
								><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
							>{/each}
					</div>{/if}
				{#if roleError}<p role="alert">{roleError}</p>
					<button class="text-button" onclick={readRole}>Reload permissions</button>{/if}
			{/if}
			{@render groupHeading('App')}
			<div class="settings-list" data-surface="panel">
				<button class="settings-entry" data-screen-link onclick={() => open('about')}
					><Info size={19} /><span>About</span><ChevronRight size={16} /></button
				>
			</div>
			{#if session}<p class="server">{session.serverUrl}</p>
				<button class="secondary" disabled={busy} onclick={signOut}>Sign out</button>{/if}
		{:else}
			<div class="settings-content">
				{#if page === 'equalizer' && session && Capacitor.getPlatform() === 'android'}<EqualizerSettings
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
				{:else if page === 'about'}<dl class="settings-facts" data-surface="panel">
						<div>
							<dt>Mobile app</dt>
							<dd>{pkg.version}</dd>
						</div>
						{#if session}<div>
								<dt>Connected server</dt>
								<dd>{session.serverUrl}</dd>
							</div>
							<div>
								<dt>DN version</dt>
								<dd>{version || '—'}</dd>
							</div>{/if}
					</dl>
					{#if versionError}<p role="alert">{versionError}</p>
						<button class="text-button" onclick={readVersion}>Reload server version</button>{/if}
				{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	.settings {
		max-width: 42rem;
		margin: auto;
		padding-bottom: var(--gap);
	}
	.back {
		margin-inline-start: -0.25rem;
	}
	.settings:has(> .shortcuts) {
		container-type: inline-size;
	}
	.shortcuts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.shortcuts .shortcut {
		flex: 1 0 max-content;
	}
	@container (max-width: 21.5em) {
		.shortcuts .shortcut {
			flex-basis: calc((100% - 0.8rem) / 3);
		}
	}
	@container (max-width: 15em) {
		.shortcuts .shortcut {
			flex-basis: calc((100% - 0.4rem) / 2);
		}
	}
	.shortcut {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0.35rem;
		min-height: 4.25rem;
		padding: 0.5rem 0.15rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.25;
		white-space: nowrap;
	}
	.shortcut :global(svg) {
		color: var(--accent);
	}
	.settings-heading {
		margin: 1.65rem 0 0;
		color: var(--heading);
		font-size: 1.6rem;
	}
	.settings-heading + :global(.settings-group-heading) {
		margin-top: 0.85rem;
	}
	.server {
		margin: 1rem 0 0.35rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
</style>
