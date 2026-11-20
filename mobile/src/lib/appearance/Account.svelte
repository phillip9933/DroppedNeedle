<script lang="ts">
	import LibraryScans from './LibraryScans.svelte';
	import { Browser } from '@capacitor/browser';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, mutateJson, putJson, type Session } from '../connection';
	import { path, errorMessage } from '../catalog/catalog';
	type S = components['schemas'];
	let { session }: { session: Session } = $props();
	let view = $state<'Profile' | 'Listening' | 'Devices'>('Profile'),
		profile = $state<S['ProfileResponse']>(),
		prefs = $state<S['ScrobblePreferences']>(),
		devices = $state<S['SessionView'][]>([]);
	let name = $state(''),
		visibility = $state<S['NowPlayingVisibility']>('offline'),
		lastfm = $state(false),
		listenbrainz = $state(false),
		confirm = $state('');
	const nameTooLong = $derived(Array.from(name.trim()).length > 64);
	let scansOpen = $state(false);
	let busy = $state(true),
		saving = $state(false),
		error = $state(''),
		message = $state(''),
		retry = $state(0);
	const views = ['Profile', 'Listening', 'Devices'] as const;
	$effect(() => {
		const current = view,
			account = session;
		void retry;
		let active = true;
		busy = true;
		error = message = confirm = '';
		async function read() {
			try {
				if (current === 'Profile') {
					const p = await getJson<S['ProfileResponse']>(account, path('/api/v3/me'));
					if (active) {
						profile = p;
						name = p.display_name;
					}
				} else if (current === 'Listening') {
					const p = await getJson<S['ScrobblePreferences']>(
						account,
						path('/api/v3/me/scrobble-preferences')
					);
					if (active) {
						prefs = p;
						visibility = p.now_playing_visibility ?? 'offline';
						lastfm = !!p.scrobble_to_lastfm;
						listenbrainz = !!p.scrobble_to_listenbrainz;
					}
				} else {
					const p = await getJson<S['SessionListResponse']>(account, path('/api/v3/auth/sessions'));
					if (active) devices = p.sessions;
				}
			} catch (e) {
				if (active) error = errorMessage(e);
			} finally {
				if (active) busy = false;
			}
		}
		void read();
		return () => {
			active = false;
		};
	});
	async function save() {
		if (saving || (view === 'Profile' && (nameTooLong || !name.trim()))) return;
		saving = true;
		error = message = '';
		try {
			if (view === 'Profile') {
				const p = await mutateJson<S['UserResponse']>(session, path('/api/v3/me'), 'PATCH', {
					display_name: name.trim()
				});
				profile = p;
				name = p.display_name;
				message = 'Display name saved.';
			} else if (view === 'Listening' && prefs) {
				const body: Partial<S['ScrobblePreferencesUpdate']> = {};
				if (visibility !== prefs.now_playing_visibility) body.now_playing_visibility = visibility;
				if (lastfm !== !!prefs.scrobble_to_lastfm) body.scrobble_to_lastfm = lastfm;
				if (listenbrainz !== !!prefs.scrobble_to_listenbrainz)
					body.scrobble_to_listenbrainz = listenbrainz;
				prefs = await putJson<S['ScrobblePreferences']>(
					session,
					path('/api/v3/me/scrobble-preferences'),
					body
				);
				message = 'Listening preferences saved.';
			} else if (view === 'Devices' && confirm) {
				await mutateJson<void>(
					session,
					path('/api/v3/auth/sessions/{id}', { id: confirm }),
					'DELETE'
				);
				devices = devices.filter((d) => d.id !== confirm);
				confirm = '';
				message = 'Device signed out.';
			}
		} catch (e) {
			error = errorMessage(e);
		} finally {
			saving = false;
		}
	}
	async function web(route: string) {
		try {
			await Browser.open({ url: session.serverUrl + route });
		} catch (e) {
			error = errorMessage(e);
		}
	}
</script>

<div class="views" role="group" aria-label="Account views">
	{#each views as v (v)}<button
			class="secondary"
			aria-pressed={v === view}
			disabled={saving}
			onclick={() => (view = v)}>{v}</button
		>{/each}
</div>
{#if busy}<p role="status">Loading…</p>
{:else if view === 'Profile' && profile}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<label>Display name<input required bind:value={name} aria-invalid={nameTooLong} /></label
		><button
			class="secondary"
			disabled={saving || nameTooLong || !name.trim() || name.trim() === profile.display_name}
			>Save name</button
		>
		{#if nameTooLong}<p role="alert">Use up to 64 characters for your display name.</p>{/if}
	</form>
	{#if profile.role === 'admin'}<details bind:open={scansOpen}>
			<summary>Library health and scans</summary>{#if scansOpen}<LibraryScans {session} />{/if}
		</details>{/if}
	<h3>Open in web app</h3>
	<div class="links">
		<button class="text-button" onclick={() => web('/profile#connected-services')}
			>Connected services</button
		>
		<button class="text-button" onclick={() => web('/profile#account')}>Account and security</button
		>
		{#if profile.role === 'admin'}
			<button class="text-button" onclick={() => web('/settings')}>Server settings</button>
			<button class="text-button" onclick={() => web('/library/management')}
				>Library management</button
			>
		{/if}
	</div>
{:else if view === 'Listening' && prefs}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void save();
		}}
	>
		<label
			>Now playing visibility<select bind:value={visibility}
				><option value="full">Show track and artist</option><option value="track_hidden"
					>Show that I’m listening</option
				><option value="offline">Show me as offline</option></select
			></label
		>
		<label class="check"><input type="checkbox" bind:checked={lastfm} />Scrobble to Last.fm</label>
		<label class="check"
			><input type="checkbox" bind:checked={listenbrainz} />Scrobble to ListenBrainz</label
		>
		<button class="secondary" disabled={saving}>Save preferences</button>
	</form>
{:else if view === 'Devices'}
	{#each devices as d (d.id)}<div class="device">
			<strong>{d.label || 'Device'}</strong><small
				>{d.current
					? 'This session'
					: 'Last active ' + new Date(d.last_seen_at * 1000).toLocaleDateString()}</small
			>
			{#if !d.current}{#if d.id === confirm}<p>Sign this device out of DroppedNeedle?</p>
					<button class="secondary" disabled={saving} onclick={save}>Confirm sign out</button>
					<button class="text-button" disabled={saving} onclick={() => (confirm = '')}
						>Keep device</button
					>
				{:else}<button
						class="text-button"
						disabled={saving}
						aria-label={'Sign out ' + (d.label || 'device')}
						onclick={() => (confirm = d.id)}>Sign out device</button
					>{/if}{/if}
		</div>{/each}
{/if}
{#if error}<p role="alert">{error}</p>
	<button class="text-button" disabled={saving} onclick={() => retry++}>Reload account</button>{/if}
{#if message}<p role="status">{message}</p>{/if}

<style>
	.views,
	.links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-block: 0.7rem;
	}
	.views [aria-pressed='true'] {
		outline: 2px solid var(--accent);
	}
	form {
		display: grid;
		gap: 0.75rem;
	}
	form > button {
		justify-self: start;
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	input,
	select {
		min-width: 0;
	}
	.check {
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 0.5rem;
	}
	.check input {
		accent-color: var(--accent);
	}
	.device {
		padding-block: 0.6rem;
		border-bottom: 1px solid var(--line);
	}
	.device strong,
	.device small {
		display: block;
		overflow-wrap: anywhere;
	}
	.device small {
		color: var(--muted);
	}
	.links {
		flex-direction: column;
		align-items: flex-start;
	}
	h3 {
		margin-bottom: 0;
	}
</style>
