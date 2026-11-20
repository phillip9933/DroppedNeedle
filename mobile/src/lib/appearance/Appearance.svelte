<script lang="ts">
	import { onMount, tick } from 'svelte';
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
		onback,
		onsignout,
		initial = 'menu'
	}: {
		session: Session | null;
		onback: () => void;
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
		offset = root?.closest('main')?.scrollTop ?? 0;
		page = next;
		focus();
		if (next === 'about') void readVersion();
	}
	export function goBack() {
		if (page === 'menu') return false;
		page = 'menu';
		focus(offset);
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
		if (initial !== 'menu') open(initial);
		void readRole();
	});
</script>

<section class="settings" bind:this={root}>
	{#if session && (page === 'home' || page === 'discover' || page === 'library' || page === 'player')}
		{#key page}<BoardSettings {session} board={page} onback={back} />{/key}
	{:else}
		<button aria-label="Back" class="text-button back" onclick={back}
			><ChevronLeft size={18} />{page === 'menu' ? 'Back' : 'Settings'}</button
		>
		<h1>{page === 'menu' ? 'Settings' : title}</h1>
		{#if page === 'menu'}
			{#if session}<h2>Screen layouts</h2>
				<div class="menu">
					{#each layouts as item (item.id)}<button
							class="entry"
							aria-label={'Edit ' + item.label + ' layout'}
							onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>{/if}
			<h2>Appearance</h2>
			<div class="menu">
				<button class="entry" onclick={() => open('themes')}
					><Palette size={19} /><span>Themes</span><ChevronRight size={16} /></button
				>
			</div>
			{#if session}
				<h2>Your account</h2>
				<div class="menu">
					{#each personal as item (item.id)}<button class="entry" onclick={() => open(item.id)}
							><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
						>{/each}
				</div>
				{#if admin}<h2>Server administration</h2>
					<div class="menu">
						{#each administration as item (item.id)}<button
								class="entry"
								onclick={() => open(item.id)}
								><item.icon size={19} /><span>{item.label}</span><ChevronRight size={16} /></button
							>{/each}
					</div>{/if}
				{#if roleError}<p role="alert">{roleError}</p>
					<button class="text-button" onclick={readRole}>Reload permissions</button>{/if}
			{/if}
			<h2>App</h2>
			<div class="menu">
				<button class="entry" onclick={() => open('about')}
					><Info size={19} /><span>About</span><ChevronRight size={16} /></button
				>
			</div>
			{#if session}<p class="server">{session.serverUrl}</p>
				<button class="secondary" disabled={busy} onclick={signOut}>Sign out</button>{/if}
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
