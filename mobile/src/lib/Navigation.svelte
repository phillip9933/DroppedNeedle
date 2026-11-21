<script lang="ts">
	import { uiText } from './i18n';
	import { destinations, interfacePreferences, type Destination } from './appearance/interface';
	let {
		current,
		offline,
		onnavigate
	}: {
		current: Destination;
		offline: boolean;
		onnavigate: (id: Destination) => void;
	} = $props();
	const pinned = $derived(
		$interfacePreferences.tabs.flatMap((id) =>
			destinations.filter((d) => d.id === id && (d.id !== 'offline' || offline))
		)
	);
</script>

{#if pinned.length}
	<nav aria-label={uiText('Music')} class="navigation" data-part="bottom-bar">
		{#each pinned as item (item.id)}
			<button
				type="button"
				data-screen-link
				data-destination={item.id}
				aria-current={current === item.id ? 'page' : undefined}
				onclick={() => onnavigate(item.id)}
				><item.icon size={20} /><span>{uiText(item.label)}</span></button
			>
		{/each}
	</nav>
{/if}

<style>
	.navigation {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		justify-content: space-evenly;
		padding: 0.35rem;
		gap: 2px;
		border-top: 1px solid var(--line);
		background: var(--nav-fill, var(--bg));
	}
	nav button {
		flex: 1;
		min-width: max-content;
		min-height: 50px;
		padding-inline: 0.22rem;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.2rem;
		color: var(--muted);
		border-radius: calc(var(--radius) * 0.8);
	}
	nav span {
		font-size: clamp(0.65rem, 2.6vw, 0.78rem);
		font-weight: 600;
		line-height: 1.1;
	}
	nav [aria-current='page'] {
		color: var(--dn-action-content);
		background: var(--dn-action);
		box-shadow: inset 0 0 0 1px var(--dn-action-edge);
	}
	:global(html[data-navigation='floating']) nav {
		margin: 0.28rem max(0.55rem, env(safe-area-inset-right)) 0.48rem;
		border: 0;
		border-radius: calc(var(--radius) + 10px);
	}
	:global(html[data-navigation='floating']) nav button {
		border-radius: calc(var(--radius) + 5px);
	}
</style>
