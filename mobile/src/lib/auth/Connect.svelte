<script lang="ts">
	import { onMount } from 'svelte';
	import {
		loginMethods,
		serverAddress,
		useToken,
		usePassword,
		type Session,
		type LoginMethods
	} from '../connection';
	import { cancelPairing, openSignIn, watchSignIn } from './pairing';

	let { onconnected }: { onconnected: (session: Session) => void } = $props();
	let address = $state('');
	let methods = $state<LoginMethods | null>(null);
	let busy = $state(false);
	let waiting = $state(false);
	let error = $state('');
	let method = $state<'password' | 'jellyfin' | 'token' | null>(null);
	let username = $state('');
	let secret = $state('');
	function failure(cause: unknown) {
		error = cause instanceof Error ? cause.message : 'Could not connect to DroppedNeedle.';
	}
	onMount(() => {
		address = localStorage.getItem('dn.lastServer') ?? '';
		let disposed = false;
		let remove: (() => void) | undefined;
		void watchSignIn(onconnected, failure)
			.then((stop) => {
				if (disposed) stop();
				else remove = stop;
			})
			.catch(failure);
		return () => {
			disposed = true;
			remove?.();
		};
	});
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			if (!methods) {
				address = serverAddress(address);
				methods = await loginMethods(address);
				localStorage.setItem('dn.lastServer', address);
				method = methods.pairing
					? null
					: methods.local
						? 'password'
						: methods.jellyfin
							? 'jellyfin'
							: 'token';
			} else if (method) {
				await cancelPairing();
				const session =
					method === 'token'
						? await useToken(address, secret)
						: await usePassword(address, username, secret, method === 'jellyfin');
				secret = '';
				onconnected(session);
			} else {
				await openSignIn(address);
				waiting = true;
			}
		} catch (cause) {
			failure(cause);
		} finally {
			busy = false;
		}
	}
	async function changeServer() {
		await cancelPairing();
		methods = null;
		method = null;
		error = secret = username = '';
		waiting = false;
	}
	function select(value: typeof method) {
		method = value;
		secret = '';
		error = '';
	}
</script>

<section class="connect" data-part="connect">
	<form
		onsubmit={(event) => {
			event.preventDefault();
			void submit();
		}}
	>
		<h1>{methods ? 'Sign in' : 'Connect your server'}</h1>
		{#if !methods}
			<label
				>Server address<input
					required
					bind:value={address}
					placeholder="https://music.example.com"
					autocomplete="url"
					inputmode="url"
					autocapitalize="none"
					spellcheck="false"
				/></label
			>
		{:else}
			<div class="server">
				<span>{address}</span><button
					type="button"
					class="text-button"
					disabled={busy}
					onclick={() => void changeServer()}>Change</button
				>
			</div>
			{#if method && method !== 'token'}
				<label
					>{method === 'jellyfin' ? 'Jellyfin username' : 'Username'}<input
						required
						bind:value={username}
						autocomplete="username"
						autocapitalize="none"
					/></label
				>
				<label
					>Password<input
						required
						type="password"
						bind:value={secret}
						autocomplete="current-password"
					/></label
				>
			{:else if method === 'token'}
				<label
					>Device session token<input
						required
						type="password"
						bind:value={secret}
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
					/></label
				>
				<p>
					Use a DroppedNeedle v3 device session token. Music-app passwords work only with Subsonic
					and Jellyfin.
				</p>
				{#if !methods.pairing && (methods.oidc || methods.plex)}<p>
						For browser sign-in with your existing account, your server needs the DroppedNeedle
						Mobile pairing page.
					</p>{/if}
			{:else}
				<p>
					{waiting
						? 'Finish signing in in your browser, then return to this app.'
						: 'Your server will open in your browser so you can use your usual sign-in method.'}
				</p>
			{/if}
		{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		<button class="primary" type="submit" disabled={busy}
			>{busy
				? 'Connecting…'
				: !methods
					? 'Continue'
					: !method
						? waiting
							? 'Restart browser sign-in'
							: 'Continue in browser'
						: 'Sign in'}</button
		>
	</form>
	{#if methods}
		<div class="methods">
			{#if methods.pairing && method}<button class="text-button" onclick={() => select(null)}
					>Use browser sign-in</button
				>{/if}
			{#if methods.local && method !== 'password'}<button
					class="text-button"
					onclick={() => select('password')}>Use server password</button
				>{/if}
			{#if methods.jellyfin && method !== 'jellyfin'}<button
					class="text-button"
					onclick={() => select('jellyfin')}>Use Jellyfin sign-in</button
				>{/if}
			{#if method !== 'token'}<button class="text-button" onclick={() => select('token')}
					>Use device session token</button
				>{/if}
		</div>
	{/if}
</section>

<style>
	.connect {
		margin: auto;
		width: min(100%, 32rem);
		padding: clamp(2rem, 8vh, 5rem) var(--gap, 1.2rem) 2rem;
	}
	.server {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	form {
		display: grid;
		gap: 1rem;
	}
	h1,
	p {
		margin: 0;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	.server {
		justify-content: space-between;
		overflow-wrap: anywhere;
	}
	.methods {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1rem;
		margin-top: 0.65rem;
	}
	p,
	.server span {
		color: var(--muted);
	}
</style>
