<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onMount } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, putJson, type Session } from '../connection';
	import { path, errorMessage } from '../catalog/catalog';
	type S = components['schemas'];
	let { session, editions }: { session: Session; editions: boolean } = $props();
	const groups = [
		{
			key: 'primary_types',
			label: 'Primary types',
			options: ['album', 'ep', 'single', 'broadcast', 'other']
		},
		{
			key: 'secondary_types',
			label: 'Secondary types',
			options: [
				'studio',
				'compilation',
				'soundtrack',
				'spokenword',
				'interview',
				'audio drama',
				'live',
				'remix',
				'dj-mix',
				'mixtape/street',
				'demo'
			]
		}
	] as const;
	const lists = [
		{ key: 'status_order', label: 'Release statuses' },
		{ key: 'format_order', label: 'Formats' },
		{ key: 'countries', label: 'Country codes' }
	] as const;
	const editionUrl = path('/api/v3/settings/edition-preferences'),
		releaseUrl = path('/api/v3/settings/preferences');
	let original = $state<S['EditionPreferences']>(),
		draft = $state<S['EditionPreferences']>(),
		releases = $state<S['UserPreferences']>(),
		oldReleases = $state<S['UserPreferences']>();
	let listText = $state({ status_order: '', format_order: '', countries: '' });
	let busy = $state(false),
		error = $state(''),
		message = $state('');
	function setEdition(e: S['EditionPreferences']) {
		original = e;
		draft = structuredClone(e);
		for (const f of lists) listText[f.key] = e[f.key].join(', ');
	}
	function setReleases(p: S['UserPreferences']) {
		oldReleases = p;
		releases = structuredClone(p);
	}
	async function read() {
		busy = true;
		error = '';
		try {
			if (editions) setEdition(await getJson(session, editionUrl));
			else setReleases(await getJson(session, releaseUrl));
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void read();
	});
	const avoids = ['live', 'compilation', 'remix', 'soundtrack', 'demo', 'dj-mix'];
	const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
	function parsed(value: string) {
		return [
			...new Set(
				value
					.split(',')
					.map((v) => v.trim())
					.filter(Boolean)
			)
		];
	}
	const edition = $derived(
		draft
			? {
					...draft,
					status_order: parsed(listText.status_order),
					format_order: parsed(listText.format_order),
					countries: parsed(listText.countries).map((v) => v.toUpperCase())
				}
			: undefined
	);
	const dirty = $derived(editions ? changed(original, edition) : changed(oldReleases, releases));
	async function save() {
		if (!dirty || busy) return;
		busy = true;
		error = message = '';
		try {
			if (edition && original) {
				if (edition.countries.some((c) => !/^[A-Z]{2}$/.test(c)))
					throw Error('Use a two-letter code for each country.');
				const latest = await getJson<S['EditionPreferences']>(session, editionUrl);
				const edits = Object.fromEntries(
					Object.entries(edition).filter(([k, v]) =>
						changed(v, original![k as keyof typeof edition])
					)
				);
				setEdition(await putJson(session, editionUrl, { ...latest, ...edits }));
			} else if (releases && oldReleases) {
				const latest = await getJson<S['UserPreferences']>(session, releaseUrl);
				for (const { key } of groups) {
					const added = releases[key].filter((t) => !oldReleases![key].includes(t));
					const removed = oldReleases[key].filter((t) => !releases![key].includes(t));
					latest[key] = [
						...new Set([...latest[key].filter((t) => !removed.includes(t)), ...added])
					];
				}
				setReleases(await putJson(session, releaseUrl, latest));
			}
			message = 'Server preferences saved.';
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if draft}
	<p>
		Set how this server chooses an edition. Put preferred values first in each comma-separated list.
	</p>
	<fieldset
		class="settings-panel"
		data-surface="panel"
		aria-label="Edition selection"
		disabled={busy}
	>
		{#each lists as f (f.key)}<label>{f.label}<input bind:value={listText[f.key]} /></label>{/each}
		<label
			>Release date<InlineChoice selected={draft.date}
				><select bind:value={draft.date}
					><option value="earliest">Earliest</option><option value="latest">Latest</option><option
						value="any">Any</option
					></select
				></InlineChoice
			></label
		>
		<label
			>Version<InlineChoice selected={draft.version}
				><select bind:value={draft.version}
					><option value="standard">Standard</option><option value="deluxe">Deluxe</option><option
						value="any">Any</option
					></select
				></InlineChoice
			></label
		>
	</fieldset>
	<h2 id="avoided-types">Types to avoid</h2>
	<fieldset
		class="settings-panel"
		data-surface="panel"
		aria-labelledby="avoided-types"
		disabled={busy}
	>
		{#each [...new Set([...avoids, ...draft.avoid_types])] as t (t)}<label class="check"
				><input type="checkbox" value={t} bind:group={draft.avoid_types} />{t}</label
			>{/each}
		<label class="check"
			><input type="checkbox" bind:checked={draft.manage_unconfirmed} />Apply edition management to
			unconfirmed matches</label
		>
	</fieldset>
{:else if releases}
	<p>Choose which release types appear in server searches and on artist pages.</p>
	{#each groups as g (g.key)}<h2 id={g.key}>{g.label}</h2>
		<fieldset class="settings-panel" data-surface="panel" aria-labelledby={g.key} disabled={busy}>
			{#each [...new Set([...g.options, ...releases[g.key]])] as t (t)}<label class="check"
					><input type="checkbox" value={t} bind:group={releases[g.key]} />{t === 'ep'
						? 'EP'
						: t[0].toUpperCase() + t.slice(1)}</label
				>{/each}
		</fieldset>{/each}
{:else if busy}<p role="status">Loading server preferences…</p>{/if}
{#if draft || releases}<button class="secondary" disabled={busy || !dirty} onclick={save}
		>Save server preferences</button
	>{/if}
{#if error}<p role="alert">{error}</p>
	{#if !draft && !releases}<button class="text-button" onclick={read}>Try again</button
		>{/if}{/if}{#if message}<p role="status">{message}</p>{/if}

<style>
	label {
		display: grid;
		gap: 0.3rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 44px;
		margin: 0;
	}
	input {
		accent-color: var(--accent);
		min-width: 0;
	}
</style>
