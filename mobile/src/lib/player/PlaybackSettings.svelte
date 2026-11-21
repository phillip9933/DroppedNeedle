<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import SoundSettings from './SoundSettings.svelte';
	import { onMount } from 'svelte';
	import { player } from '../player';
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
		defaultFades,
		type TrackFades,
		type Format,
		type Network,
		type Profile,
		type Profiles
	} from './streaming';
	let { session }: { session: Session } = $props();
	const fadeEdges = [
		{ key: 'fadeInMs', label: 'Fade in' },
		{ key: 'fadeOutMs', label: 'Fade out' }
	] as const;
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
		fades = $state<TrackFades>({ ...defaultFades }),
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
	async function fade(change: Partial<TrackFades>) {
		if (saving) return;
		saving = true;
		fadeError = '';
		try {
			const next = { ...fades, ...change };
			await setTrackFade(next);
			fades = next;
		} catch (e) {
			fadeError = errorMessage(e);
		} finally {
			saving = false;
		}
	}
	let autoplay = $state(false),
		autoplayBusy = $state(true),
		autoplayError = $state('');
	async function autoplaySetting(enabled?: boolean) {
		autoplayBusy = true;
		try {
			autoplay = (await player.autoplaySetting(session, enabled)).enabled;
			autoplayError = '';
		} catch (e) {
			autoplayError = errorMessage(e);
		} finally {
			autoplayBusy = false;
		}
	}
	onMount(() => {
		if (Capacitor.getPlatform() !== 'ios') void autoplaySetting();
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
			.then((v) => (fades = v))
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

<section class="settings-stack" aria-label={uiText('Playback preferences')}>
	<h2>{uiText('Mobile stream quality')}</h2>
	<p class="connection" role="status">
		{#if network === 'wifi'}{uiText('Connected through Wi-Fi or Ethernet.')}
		{:else if network === 'cellular'}{uiText('Connected through cellular data.')}
		{:else if network === 'offline'}{uiText('Device is offline.')}
		{:else}{uiText('Connection type unknown. Streaming uses the cellular profile.')}{/if}
	</p>
	{#each connections as entry (entry.id)}
		{@const q = profiles[entry.id]}
		<h3 class="settings-subheading" id={'stream-' + entry.id}>{uiText(entry.name)}</h3>
		<fieldset
			class="settings-panel"
			data-surface="panel"
			aria-labelledby={'stream-' + entry.id}
			disabled={savingProfile}
		>
			<label
				>{uiText('Audio format')}<InlineChoice
					selected={q.format}
					label={entry.name + ' audio format'}
					><select
						value={q.format}
						onchange={(e) => configure(entry.id, e.currentTarget.value as Format, q.rate)}
					>
						<option value="original">{uiText('Original file')}</option><option value="mp3"
							>MP3</option
						><option value="opus">Opus</option>
					</select></InlineChoice
				></label
			>
			{#if q.format !== 'original'}<label
					>{uiText('Requested bitrate')}<InlineChoice
						selected={q.rate}
						label={entry.name + ' requested bitrate'}
						><select
							value={q.rate}
							onchange={(e) => configure(entry.id, q.format, Number(e.currentTarget.value))}
						>
							{#each rates as rate (rate)}<option value={rate}>{rate} kbps</option>{/each}
						</select></InlineChoice
					></label
				>{/if}
		</fieldset>
	{/each}
	{#if Capacitor.getPlatform() === 'ios' && (profiles.wifi.format === 'opus' || profiles.cellular.format === 'opus')}<p
		>
			{uiText('If this device cannot play Ogg Opus, DN sends MP3 at your selected bitrate.')}
		</p>{/if}
	{#if profileError}<p role="alert">{profileError}</p>{/if}
	<p>
		{uiText(
			'Each track uses the connection available when it starts loading. If DN falls back to an original file, it plays at its source bitrate.'
		)}
	</p>
	{#if serviceError}<p role="status">{uiText('Could not check DN conversion.')} {serviceError}</p>
		<button class="secondary" onclick={readConversion}>{uiText('Check conversion again')}</button>
	{:else if conversion === 'off'}<p>
			{uiText(
				'Conversion is turned off. Your format choices take effect when On-the-fly transcoding is enabled in DN’s Settings → Connect Apps.'
			)}
		</p>
		<button class="text-button" onclick={readConversion}>{uiText('Check conversion again')}</button>
	{:else if conversion === 'unavailable'}<p>
			{uiText('DN reports that ffmpeg is unavailable. Original files can still play.')}
		</p>
		<button class="text-button" onclick={readConversion}>{uiText('Check conversion again')}</button>
	{:else if conversion === 'on'}<p>{uiText('DN can convert streams for both profiles.')}</p>
	{:else}<p role="status">{uiText('Checking server conversion…')}</p>{/if}
	{#if Capacitor.getPlatform() !== 'ios'}
		<h2 id="audio-playback">{uiText('Audio playback')}</h2>
		<SoundSettings />
		<h2 id="similar-autoplay">{uiText('Play queue')}</h2>
		<div
			class="settings-panel"
			data-surface="panel"
			role="group"
			aria-labelledby="similar-autoplay"
		>
			<label class="smart-fades"
				><input
					type="checkbox"
					checked={autoplay}
					disabled={autoplayBusy}
					onchange={(e) => void autoplaySetting(e.currentTarget.checked)}
				/>
				{uiText('Autoplay similar library music')}</label
			>
			<p>
				{uiText(
					'When the queue ends, continue with related songs from your DroppedNeedle library.'
				)}
			</p>
			{#if autoplayError}<p role="alert">{autoplayError}</p>{/if}
		</div>
	{/if}
	<h2 id="track-fades-settings">{uiText('Track fades')}</h2>
	<div
		class="settings-panel"
		data-surface="panel"
		role="group"
		aria-labelledby="track-fades-settings"
	>
		{#each fadeEdges as edge (edge.key)}
			<label>
				{uiText(edge.label)}
				<InlineChoice selected={fades[edge.key]} label={uiText(edge.label)}
					><select
						value={fades[edge.key]}
						disabled={loadingFades || saving}
						onchange={(e) => fade({ [edge.key]: Number(e.currentTarget.value) })}
					>
						{#each fadeLengths as ms (ms)}<option value={ms}
								>{ms ? ms / 1000 + ' seconds' : uiText('Off')}</option
							>{/each}
					</select></InlineChoice
				>
			</label>
		{/each}
		<label class="smart-fades"
			><input
				type="checkbox"
				checked={fades.smart}
				disabled={loadingFades || saving}
				onchange={(e) => {
					const requested = e.currentTarget.checked;
					e.currentTarget.checked = fades.smart;
					void fade({ smart: requested });
				}}
			/>
			{uiText('Smart fades')}</label
		>
		<p>
			{uiText(
				'Overlap quiet endings and intros, or line up a clear, steady beat between tracks. Transitions last up to eight seconds. Consecutive album tracks play through. If analysis is unavailable, your manual fades apply.'
			)}
		</p>
	</div>
	{#if fadeError}<p role="alert">{fadeError}</p>{/if}
</section>

<style>
	label {
		display: grid;
		gap: 0.35rem;
	}
	.smart-fades {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.connection {
		color: var(--text);
	}
	button {
		justify-self: start;
	}
</style>
