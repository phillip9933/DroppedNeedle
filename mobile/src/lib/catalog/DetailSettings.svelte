<script module lang="ts">
	import { createContext } from 'svelte';
	export const [getDetailSettings, setDetailSettings] = createContext<() => void>();
</script>

<script lang="ts">
	import { Menu } from '@lucide/svelte';
	import { interfacePreferences } from '../appearance/interface';
	import { uiText } from '../i18n';
	const open = getDetailSettings();
</script>

{#if !$interfacePreferences.tabs.includes('settings')}
	<button
		type="button"
		class="icon-button"
		data-settings-shortcut
		data-screen-link
		aria-label={uiText('Settings')}
		onclick={open}><Menu size={21} /></button
	>
{/if}

<style>
	button {
		color: white;
		background: rgb(12 15 12 / 72%);
		border: 0;
		border-radius: 50%;
		min-width: 44px;
		min-height: 44px;
	}
</style>
