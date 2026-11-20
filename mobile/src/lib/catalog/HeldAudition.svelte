<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Capacitor, CapacitorHttp } from '@capacitor/core';
	import { serverAddress, type Session } from '../connection';
	import { errorMessage, path } from './catalog';
	let { session, fileId, name }: { session: Session; fileId: number; name: string } = $props();
	let src = $state(''),
		busy = $state(false),
		error = $state(''),
		audio: HTMLAudioElement;
	const controller = new AbortController();
	const bytes = 2 * 1024 * 1024;
	async function listen() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			if (!src) {
				const url =
					serverAddress(session.serverUrl) +
					path('/api/v3/held/files/{file_id}/audio', { file_id: String(fileId) });
				const headers = {
					Authorization: 'Bearer ' + session.token,
					Range: 'bytes=0-' + (bytes - 1)
				};
				let blob: Blob;
				if (Capacitor.isNativePlatform()) {
					const result = await CapacitorHttp.get({
						url,
						headers,
						disableRedirects: true,
						responseType: 'arraybuffer',
						connectTimeout: 10000,
						readTimeout: 15000
					});
					controller.signal.throwIfAborted();
					if (
						result.status !== 206 ||
						typeof result.data !== 'string' ||
						result.data.length > 4 * Math.ceil(bytes / 3)
					)
						throw Error('DN did not return a playable preview.');
					const type =
						Object.entries(result.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ||
						'application/octet-stream';
					blob = new Blob([Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))], { type });
				} else {
					const response = await fetch(url, {
						headers,
						credentials: 'omit',
						redirect: 'error',
						cache: 'no-store',
						signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
					});
					if (response.status !== 206 || Number(response.headers.get('content-length')) > bytes) {
						await response.body?.cancel();
						throw Error('DN did not return a playable preview.');
					}
					blob = await response.blob();
				}
				controller.signal.throwIfAborted();
				if (!blob.size || blob.size > bytes) throw Error('DN did not return a playable preview.');
				src = URL.createObjectURL(blob);
				audio.src = src;
			}
			for (const other of audio.closest('dialog')?.querySelectorAll('audio') ?? []) {
				if (other !== audio) other.pause();
			}
			await audio.play();
		} catch (e) {
			if (!controller.signal.aborted) error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onDestroy(() => {
		controller.abort();
		audio?.pause();
		if (src) URL.revokeObjectURL(src);
	});
</script>

<button class="text-button" disabled={busy} aria-label={'Preview ' + name} onclick={listen}
	>{busy ? 'Loading preview…' : 'Preview opening audio'}</button
>
<audio
	bind:this={audio}
	controls
	hidden={!src}
	aria-label={'Audio preview of ' + name}
	onerror={() => {
		if (src) error = 'This file’s opening audio could not be played.';
	}}
></audio>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	audio {
		width: 100%;
		max-width: 28rem;
	}
</style>
