<script lang="ts">
	import { uiText } from '../i18n';
	import { App } from '@capacitor/app';
	import { onMount } from 'svelte';
	import { nativeMedia, type DownloadNotificationState } from './nativeMedia';

	const statuses: Record<DownloadNotificationState, string> = {
		appOff: 'Off for OtoHari.',
		appOn: 'On for OtoHari. The download channel appears after your first download starts.',
		channelOff: 'Off for offline downloads.',
		on: 'On for offline downloads.'
	};
	let status = $state('Checking Android notification settings…'),
		opening = $state(false),
		error = $state('');
	let revision = 0;

	async function refresh() {
		const request = ++revision;
		try {
			const { state } = await nativeMedia.downloadNotificationSettings();
			if (request === revision) status = statuses[state];
		} catch {
			if (request === revision) status = 'Could not read Android notification settings.';
		}
	}

	onMount(() => {
		const resumed = App.addListener('resume', refresh);
		void refresh();
		return () => {
			revision++;
			void resumed.then((listener) => listener.remove()).catch(() => {});
		};
	});

	async function open() {
		opening = true;
		error = '';
		try {
			await nativeMedia.openDownloadNotificationSettings();
		} catch {
			error = 'Could not open Android notification settings.';
		} finally {
			opening = false;
		}
	}
</script>

<p role="status">{uiText(status)}</p>
<button class="secondary" disabled={opening} onclick={open}
	>{uiText('Open Android notification settings')}</button
>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	p {
		color: var(--muted);
		margin: 0;
		line-height: 1.45;
	}
</style>
