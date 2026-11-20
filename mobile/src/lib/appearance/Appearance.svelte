<script lang="ts">
	import Account from './Account.svelte';
	import type { Session } from '../connection';
	import { Check, ChevronLeft } from '@lucide/svelte';
	import { presets, restoreTheme, saveTheme, readTheme, type Theme } from './theme';
	let {
		session,
		onback,
		onsignout
	}: { session: Session | null; onback: () => void; onsignout: () => Promise<void> } = $props();
	const initial = restoreTheme();
	let selected = $state(initial);
	let draft = $state(JSON.stringify(initial, null, 2));
	let feedback = $state('');
	let error = $state('');
	let busy = $state(false);
	let accountOpen = $state(false);
	function choose(theme: Theme) {
		try {
			saveTheme(theme);
			selected = theme;
			draft = JSON.stringify(theme, null, 2);
			feedback = 'Applied ' + theme.name + '.';
			error = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save your theme.';
		}
	}
	function importTheme() {
		try {
			choose(readTheme(draft));
		} catch (cause) {
			feedback = '';
			error =
				cause instanceof SyntaxError
					? 'Enter valid JSON.'
					: String(cause instanceof Error ? cause.message : cause);
		}
	}
	async function signOut() {
		busy = true;
		try {
			await onsignout();
		} finally {
			busy = false;
		}
	}
</script>

<section class="settings">
	<button class="text-button" onclick={onback}><ChevronLeft size={18} /> Back</button>
	<h1>Settings</h1>
	<h2>Appearance</h2>
	<div class="choices">
		{#each presets as theme (theme.name)}
			<button
				class="choice"
				aria-pressed={JSON.stringify(selected) === JSON.stringify(theme)}
				onclick={() => choose(theme)}
			>
				<span class="swatch" style:background={theme.colors.bg} style:color={theme.colors.accent}
					>Aa</span
				>
				{theme.name}
				{#if JSON.stringify(selected) === JSON.stringify(theme)}<Check size={16} />{/if}
			</button>
		{/each}
	</div>
	<details>
		<summary>Edit or share theme</summary>
		<p>Copy this theme to share it, or paste an edited theme to apply it.</p>
		<label for="theme-json">Theme JSON</label>
		<textarea id="theme-json" bind:value={draft} rows="9" spellcheck="false"></textarea>
		<button class="secondary" onclick={importTheme}>Apply theme</button>
	</details>
	{#if feedback}<p role="status">{feedback}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	{#if session}
		<details bind:open={accountOpen}>
			<summary>Account on DroppedNeedle</summary>{#if accountOpen}<Account {session} />{/if}
		</details>
		<h2>Connected server</h2>
		<p class="address">{session.serverUrl}</p>
		<button class="secondary" onclick={signOut} disabled={busy}>Sign out</button>
	{/if}
</section>

<style>
	.settings {
		display: grid;
		gap: var(--gap);
		align-content: start;
	}
	h1,
	h2,
	p {
		margin: 0;
	}
	h2 {
		margin-block-start: var(--gap);
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap);
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.4rem 0.75rem 0.4rem 0.4rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.choice[aria-pressed='true'] {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.swatch {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: calc(var(--radius) * 0.7);
		font-weight: 700;
	}
	details {
		padding-block: var(--gap);
		border-block: 1px solid var(--line);
	}
	summary {
		min-height: 44px;
		align-content: center;
		cursor: pointer;
	}
	details p,
	.address {
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	label {
		display: block;
		margin: 0.75rem 0 0.4rem;
	}
	textarea {
		width: 100%;
		font:
			0.85rem ui-monospace,
			monospace;
		margin-bottom: 0.75rem;
	}
	.secondary {
		justify-self: start;
	}
</style>
