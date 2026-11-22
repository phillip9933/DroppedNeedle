<script lang="ts">
	import '../../../auth.css';
	import { page } from '$app/state';
	import { Smartphone } from 'lucide-svelte';
	import { createDeviceSessionMutation } from '$lib/features/profile/queries/sessions.svelte';
	import { framed, handBack } from '$lib/features/auth/state/appHandBack';
	import { authStore } from '$lib/stores/authStore.svelte';
	import AuthCard from '$lib/ui/AuthCard.svelte';
	import AuthFrame from '$lib/ui/AuthFrame.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { freshPairing, readPairing, recipient, sealToken } from './handoff';

	const mint = createDeviceSessionMutation();
	const request = readPairing(page.url.searchParams);
	const available = request && !framed() && globalThis.isSecureContext;
	let busy = $state(false);
	let error = $state('');
	let destination = $state('');

	async function allow() {
		if (!available || !request || busy || destination) return;
		busy = true;
		error = '';
		try {
			if (!freshPairing(Number(request.started)))
				throw new Error('This sign-in has expired. Start again from your phone.');
			const key = await recipient(request);
			const { token } = await mint.mutateAsync('OtoHari ' + request.device);
			destination = await sealToken(request, key, token);
			handBack(destination);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not connect this phone.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Connect your phone - DroppedNeedle</title></svelte:head>
<AuthFrame kicker="Mobile sign-in">
	<AuthCard icon={Smartphone} centred>
		{#if !available}
			<p>Open sign-in from OtoHari using your server's HTTPS address.</p>
		{:else if destination}
			<p>Your phone can now access DroppedNeedle.</p>
			<Button href={destination} variant="primary">Return to the app</Button>
		{:else}
			<h2>Connect this phone?</h2>
			<p>
				Continue as <strong>{authStore.user?.display_name}</strong> on this DroppedNeedle server.
			</p>
			<p>
				Only approve if you started sign-in in OtoHari on this phone. Revoke access from Profile →
				Sessions.
			</p>
			{#if error}<p role="alert">{error}</p>{/if}
			<Button variant="primary" loading={busy} onclick={allow}>Connect this phone</Button>
		{/if}
	</AuthCard>
</AuthFrame>
