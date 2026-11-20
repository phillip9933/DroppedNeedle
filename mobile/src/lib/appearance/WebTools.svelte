<script lang="ts">
	import { Browser } from '@capacitor/browser';
	import { ExternalLink } from '@lucide/svelte';
	import type { Session } from '../connection';
	let { session, admin }: { session: Session; admin: boolean } = $props();
	let filter = $state(''),
		error = $state('');
	const tab = (label: string, id: string) => ({ label, route: '/settings?tab=' + id });
	const groups = $derived(
		[
			{
				title: 'Your account',
				links: [
					{ label: 'Account security and avatar', route: '/profile#account' },
					{ label: 'Connect apps', route: '/profile#connect-apps' },
					{ label: 'Connected services', route: '/profile#connected-services' },
					{ label: 'Custom CSS and saved styles', route: '/profile#appearance' },
					{ label: 'Profile and linked media accounts', route: '/profile' },
					{ label: 'Listening and scrobbling', route: '/profile#scrobbling' },
					{ label: 'Spotify connection', route: '/profile#spotify' },
					{ label: 'Your libraries', route: '/profile#libraries' }
				]
			},
			...(admin
				? [
						{
							title: 'Library management',
							links: [
								{ label: 'Library settings and roots', route: '/settings/library' },
								{ label: 'Manage library', route: '/library/management' },
								{ label: 'Manage artists', route: '/library/management/artists' },
								{ label: 'Operation history', route: '/library/management/history' },
								{ label: 'Review matches', route: '/library/review' },
								{ label: 'Unmatched files', route: '/library/unmatched' },
								{ label: 'Duplicates', route: '/library/duplicates' },
								{ label: 'Recycle bin', route: '/library/recycle-bin' }
							]
						},
						{
							title: 'Server setup',
							links: [
								tab('Library', 'library'),
								tab('Editions', 'editions'),
								tab('Download client', 'download-client'),
								tab('Indexers and Prowlarr', 'indexers'),
								tab('Lidarr import', 'lidarr-import'),
								tab('Connected apps', 'connect-apps'),
								tab('Jellyfin', 'jellyfin'),
								tab('Navidrome', 'navidrome'),
								tab('Plex', 'plex'),
								tab('YouTube', 'youtube'),
								tab('Last.fm', 'lastfm'),
								tab('ListenBrainz', 'listenbrainz'),
								tab('Spotify', 'spotify'),
								tab('Live events', 'events'),
								tab('Get it', 'get-it')
							]
						},
						{
							title: 'Server personalization',
							links: [
								tab('Release types', 'settings'),
								tab('Web appearance', 'appearance'),
								tab('Music source', 'music-source'),
								tab('Sidebar', 'sidebar'),
								tab('Home', 'home'),
								tab('Discover', 'discover')
							]
						},
						{
							title: 'System',
							links: [
								tab('Cache', 'cache'),
								tab('MusicBrainz', 'musicbrainz'),
								tab('Users', 'users'),
								tab('Backups', 'backups'),
								tab('Security', 'security'),
								tab('Plugins', 'plugins'),
								tab('Wrapped API', 'wrapped'),
								tab('Diagnostics', 'diagnostics'),
								tab('Advanced', 'advanced'),
								tab('About server', 'about')
							]
						}
					]
				: [
						{
							title: 'Content preferences',
							links: [tab('Home', 'home'), tab('Discover', 'discover')]
						}
					])
		]
			.map((g) => ({
				...g,
				links: g.links.filter((l) =>
					(g.title + ' ' + l.label).toLowerCase().includes(filter.trim().toLowerCase())
				)
			}))
			.filter((g) => g.links.length)
	);
	async function open(e: MouseEvent, url: string) {
		e.preventDefault();
		error = '';
		try {
			await Browser.open({ url });
		} catch {
			error = 'Could not open the browser.';
		}
	}
</script>

<p>These tools open on your DroppedNeedle server in the browser.</p>
<input
	type="search"
	aria-label="Find a web tool"
	placeholder="Find a web tool"
	bind:value={filter}
/>
{#if error}<p role="alert">{error}</p>{/if}
{#each groups as group (group.title)}
	<h2>{group.title}</h2>
	{#each group.links as link (link.route)}<a
			href={session.serverUrl + link.route}
			target="_blank"
			rel="noopener noreferrer"
			onclick={(e) => open(e, session.serverUrl + link.route)}
			>{link.label}<ExternalLink size={15} /></a
		>{/each}
{/each}
{#if !groups.length}<p>No matching tools.</p>{/if}

<style>
	input {
		width: 100%;
	}
	a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--gap);
		color: var(--text);
		text-decoration: none;
		border-bottom: 1px solid var(--line);
		min-height: 46px;
	}
	a :global(svg) {
		color: var(--muted);
	}
</style>
