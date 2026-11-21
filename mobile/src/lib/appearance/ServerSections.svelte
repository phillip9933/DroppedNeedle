<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onMount } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, putJson, type Session } from '../connection';
	import { forgetDiscoveryPage } from '../catalog/discoveryWidgets';
	import { errorMessage, path } from '../catalog/catalog';
	type S = components['schemas'];
	let { session, admin }: { session: Session; admin: boolean } = $props();
	let page = $state<S['SectionPage']>('home'),
		data = $state<S['SectionPrefsResponse']>(),
		changes = $state<Record<string, boolean>>({}),
		busy = $state(false),
		error = $state(''),
		message = $state('');
	const pages = $derived(
		admin ? (['home', 'discover', 'sidebar'] as const) : (['home', 'discover'] as const)
	);
	const rows = $derived(data?.pages[page] ?? []);
	const endpoint = path('/api/v3/me/section-prefs');
	async function load() {
		busy = true;
		error = '';
		try {
			data = await getJson(session, endpoint);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
	function toggle(row: S['SectionPrefItem']) {
		const next = { ...changes };
		if (row.key in next) delete next[row.key];
		else next[row.key] = !row.enabled;
		changes = next;
		message = '';
	}
	async function save() {
		if (busy) return;
		busy = true;
		error = message = '';
		try {
			// DN replaces the whole page. Merge this device's edits with the current
			// account settings, including unavailable and newly registered sections.
			const latest = await getJson<S['SectionPrefsResponse']>(session, endpoint);
			const current = latest.pages[page];
			if (!current) throw Error('This page is unavailable.');
			const saved = await putJson<S['SectionPrefsResponse']>(session, endpoint, {
				page,
				sections: current.map((s) => ({
					key: s.key,
					enabled: s.available ? (changes[s.key] ?? s.enabled) : s.enabled
				}))
			} satisfies S['SectionPrefsUpdate']);
			data = { pages: { ...latest.pages, ...saved.pages } };
			changes = {};
			message = 'Section preferences saved.';
			if (page === 'discover') forgetDiscoveryPage(session);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<p>Choose the sections your DN account receives. These settings also apply to the web app.</p>
<label
	>Page<InlineChoice selected={page}
		><select
			disabled={busy || !!Object.keys(changes).length}
			bind:value={page}
			onchange={() => (message = '')}
			>{#each pages as p (p)}<option value={p}>{p[0].toUpperCase() + p.slice(1)}</option
				>{/each}</select
		></InlineChoice
	></label
>
{#if data}
	{#if rows.length}<div class="settings-list" data-surface="panel">
			{#each rows as row (row.key)}<label class="choice"
					><input
						type="checkbox"
						checked={changes[row.key] ?? row.enabled}
						disabled={busy || !row.available}
						onchange={() => toggle(row)}
					/><span
						><strong>{row.title}</strong><small>{row.description}</small>{#if !row.available}<small
								>{row.turned_off
									? 'Disabled on this server.'
									: row.requires
										? 'Requires ' + row.requires + '.'
										: 'Unavailable on this server.'}</small
							>{/if}</span
					></label
				>{/each}
		</div>{/if}
	{#if !rows.length}<p>No sections for this page.</p>{/if}
	<button class="secondary" disabled={busy || !Object.keys(changes).length} onclick={save}
		>Save section preferences</button
	>
	{#if Object.keys(changes).length}<button
			class="text-button"
			disabled={busy}
			onclick={() => (changes = {})}>Discard changes</button
		>{/if}
{:else if busy}<p role="status">Loading section preferences…</p>{/if}
{#if error}<p role="alert">{error}</p>
	{#if !data}<button class="text-button" onclick={load}>Try again</button>{/if}{/if}
{#if message}<p role="status">{message}</p>{/if}

<style>
	label {
		display: grid;
		gap: 0.3rem;
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		min-height: 48px;
		padding: 0.7rem var(--gap);
	}
	input {
		margin-top: 0.35rem;
		accent-color: var(--accent);
	}
	strong,
	small {
		display: block;
	}
	small {
		color: var(--muted);
	}
</style>
