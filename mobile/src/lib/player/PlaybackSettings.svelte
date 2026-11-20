<script lang="ts">
	import { onMount } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import type { Session } from '../connection';
	import { errorMessage } from '../catalog/catalog';
	import {
		conversionState,
		browserConnection,
		streamNetwork,
		original,
		rates,
		saveProfiles,
		streamProfiles,
		readTrackFade,
		setTrackFade,
		fadeLengths,
		type Format,
		type Network,
		type Profile,
		type Profiles
	} from './streaming';
	let { session }: { session: Session } = $props();
	const connections = [
		{ id: 'wifi', name: 'Wi-Fi' },
		{ id: 'cellular', name: 'Cellular data' }
	] as const;
	let profiles = $state<Profiles>({ wifi: { ...original }, cellular: { ...original } }),
		network = $state<Network>('unknown'),
		profileError = $state(''),
		savingProfile = $state(false),
		conversion = $state<'on' | 'off' | 'unavailable' | null>(null);
	let serviceError = $state(''),
		fadeError = $state(''),
		milliseconds = $state(0),
		loadingFades = $state(true),
		saving = $state(false);
	let checks = 0;
	async function readConversion() {
		const check = ++checks;
		serviceError = '';
		try {
			const state = await conversionState(session);
			if (check === checks) conversion = state.conversion;
		} catch (e) {
			if (check === checks) serviceError = errorMessage(e);
		}
	}
	async function configure(profile: Profile, format: Format, rate: number) {
		if (savingProfile) return;
		const next = { ...profiles, [profile]: { format, rate } };
		savingProfile = true;
		profileError = '';
		try {
			await saveProfiles(session, next);
			profiles = next;
		} catch (e) {
			profileError = errorMessage(e);
		} finally {
			savingProfile = false;
		}
	}
	async function fade(value: number) {
		if (saving) return;
		saving = true;
		fadeError = '';
		try {
			await setTrackFade(value);
			milliseconds = value;
		} catch (e) {
			fadeError = errorMessage(e);
		} finally {
			saving = false;
		}
	}
	onMount(() => {
		profiles = streamProfiles(session);
		void readConversion();
		let generation = 0;
		async function detect() {
			if (document.hidden) return;
			const id = ++generation;
			const value = await streamNetwork().catch(() => 'unknown' as const);
			if (id === generation) network = value;
		}
		const controller = new AbortController();
		const options = { signal: controller.signal };
		const connection = browserConnection();
		connection?.addEventListener('change', detect, options);
		window.addEventListener('online', detect, options);
		window.addEventListener('offline', detect, options);
		document.addEventListener('visibilitychange', detect, options);
		void detect();
		// Some native WebViews don't emit a browser connection-change event.
		const timer = setInterval(detect, 5000);
		void readTrackFade()
			.then((v) => (milliseconds = v))
			.catch((e) => (fadeError = errorMessage(e)))
			.finally(() => (loadingFades = false));
		return () => {
			checks++;
			generation++;
			clearInterval(timer);
			controller.abort();
		};
	});
</script>

<section class="playback" aria-label="Playback preferences">
	<h2>Mobile stream quality</h2>
	<p class="connection" role="status">
		{#if network === 'wifi'}Connected through Wi-Fi or Ethernet.
		{:else if network === 'cellular'}Connected through cellular data.
		{:else if network === 'offline'}Device is offline.
		{:else}Connection type unknown. Streaming uses the cellular profile.{/if}
	</p>
	{#each connections as entry (entry.id)}
		{@const q = profiles[entry.id]}
		<fieldset disabled={savingProfile}>
			<legend>{entry.name}</legend>
			<label
				>Audio format<select
					aria-label={entry.name + ' audio format'}
					value={q.format}
					onchange={(e) => configure(entry.id, e.currentTarget.value as Format, q.rate)}
				>
					<option value="original">Original file</option><option value="mp3">MP3</option><option
						value="opus">Opus</option
					>
				</select></label
			>
			{#if q.format !== 'original'}<label
					>Requested bitrate<select
						aria-label={entry.name + ' requested bitrate'}
						value={q.rate}
						onchange={(e) => configure(entry.id, q.format, Number(e.currentTarget.value))}
					>
						{#each rates as rate (rate)}<option value={rate}>{rate} kbps</option>{/each}
					</select></label
				>{/if}
		</fieldset>
	{/each}
	{#if Capacitor.getPlatform() === 'ios' && (profiles.wifi.format === 'opus' || profiles.cellular.format === 'opus')}<p
		>
			If this device cannot play Ogg Opus, DN sends MP3 at your selected bitrate.
		</p>{/if}
	{#if profileError}<p role="alert">{profileError}</p>{/if}
	<p>
		Each track uses the connection available when it starts loading. If DN falls back to an original
		file, it plays at its source bitrate.
	</p>
	{#if serviceError}<p role="status">Could not check DN conversion. {serviceError}</p>
		<button class="secondary" onclick={readConversion}>Check conversion again</button>
	{:else if conversion === 'off'}<p>
			Conversion is turned off. Your format choices take effect when On-the-fly transcoding is
			enabled in DN’s Settings → Connect Apps.
		</p>
		<button class="text-button" onclick={readConversion}>Check conversion again</button>
	{:else if conversion === 'unavailable'}<p>
			DN reports that ffmpeg is unavailable. Original files can still play.
		</p>
		<button class="text-button" onclick={readConversion}>Check conversion again</button>
	{:else if conversion === 'on'}<p>DN can convert streams for both profiles.</p>
	{:else}<p role="status">Checking server conversion…</p>{/if}
	<h2>Track fades</h2>
	<label
		>Fade in and out<select
			aria-label="Fade in and out"
			value={milliseconds}
			disabled={loadingFades || saving}
			onchange={(e) => fade(Number(e.currentTarget.value))}
			>{#each fadeLengths as ms (ms)}<option value={ms}
					>{ms ? ms / 1000 + ' seconds' : 'Off'}</option
				>{/each}</select
		></label
	>
	<p>Gradually raise the volume at the start of a track and lower it at the end.</p>
	{#if fadeError}<p role="alert">{fadeError}</p>{/if}
</section>

<style>
	.playback {
		display: grid;
		gap: 0.65rem;
	}
	h2,
	p {
		margin: 0;
	}
	h2:not(:first-child) {
		margin-top: 1.2rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	p {
		color: var(--muted);
	}
	fieldset {
		display: grid;
		gap: 0.65rem;
		min-width: 0;
		padding: 0.65rem 0.85rem 0.85rem;
		margin: 0;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
	}
	legend {
		font-weight: 650;
		padding-inline: 0.2rem;
	}
	.connection {
		color: var(--text);
	}
	button {
		justify-self: start;
	}
</style>
