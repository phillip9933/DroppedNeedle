<script lang="ts">
	import { tr, uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import EditionPriority from './EditionPriority.svelte';
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
		{ key: 'countries', label: 'Countries' }
	] as const;
	const editionUrl = path('/api/v3/settings/edition-preferences'),
		releaseUrl = path('/api/v3/settings/preferences');
	let original = $state<S['EditionPreferences']>(),
		draft = $state<S['EditionPreferences']>(),
		releases = $state<S['UserPreferences']>(),
		oldReleases = $state<S['UserPreferences']>();
	let busy = $state(false),
		error = $state(''),
		message = $state('');
	function setEdition(e: S['EditionPreferences']) {
		original = e;
		draft = structuredClone(e);
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
	const releaseTypes = new Map([
		['album', ['Album', 'アルバム']],
		['ep', ['EP', 'EP']],
		['single', ['Single', 'シングル']],
		['broadcast', ['Broadcast', '放送']],
		['other', ['Other', 'その他']],
		['studio', ['Studio', 'スタジオ']],
		['compilation', ['Compilation', 'コンピレーション']],
		['soundtrack', ['Soundtrack', 'サウンドトラック']],
		['spokenword', ['Spoken word', '朗読']],
		['interview', ['Interview', 'インタビュー']],
		['audio drama', ['Audio drama', 'オーディオドラマ']],
		['live', ['Live', 'ライブ']],
		['remix', ['Remix', 'リミックス']],
		['dj-mix', ['DJ mix', 'DJ ミックス']],
		['mixtape/street', ['Mixtape/street', 'ミックステープ']],
		['demo', ['Demo', 'デモ']]
	]);
	function releaseType(value: string) {
		const pair = releaseTypes.get(value);
		return pair ? tr(pair[0], pair[1]) : value;
	}
	const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
	const dirty = $derived(editions ? changed(original, draft) : changed(oldReleases, releases));
	async function save() {
		if (!dirty || busy) return;
		busy = true;
		error = message = '';
		try {
			if (draft && original) {
				const latest = await getJson<S['EditionPreferences']>(session, editionUrl);
				const edits = Object.fromEntries(
					Object.entries(draft).filter(([k, v]) =>
						changed(v, original![k as keyof S['EditionPreferences']])
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
			message = tr('Server preferences saved.', 'サーバー設定を保存しました。');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if draft && original}
	<p>
		{tr(
			'Put your preferred choices first. DroppedNeedle uses this order when more than one edition fits.',
			'優先したい項目を上に並べてください。該当するエディションが複数ある場合、この順序で選ばれます。'
		)}
	</p>
	{#each lists as f (f.key)}
		<EditionPriority
			kind={f.key}
			title={f.label}
			saved={original[f.key]}
			values={draft[f.key]}
			disabled={busy}
			onchange={(values) => {
				if (draft) draft[f.key] = values;
			}}
		/>
	{/each}
	<h2 id="edition-selection">{uiText('Edition selection')}</h2>
	<fieldset
		class="settings-panel"
		data-surface="panel"
		aria-labelledby="edition-selection"
		disabled={busy}
	>
		<label
			>{uiText('Release date')}<InlineChoice selected={draft.date}
				><select bind:value={draft.date}
					><option value="earliest">{uiText('Earliest')}</option><option value="latest"
						>{uiText('Latest')}</option
					><option value="any">{uiText('Any')}</option></select
				></InlineChoice
			></label
		>
		<label
			>{uiText('Version')}<InlineChoice selected={draft.version}
				><select bind:value={draft.version}
					><option value="standard">{uiText('Standard')}</option><option value="deluxe"
						>{uiText('Deluxe')}</option
					><option value="any">{uiText('Any')}</option></select
				></InlineChoice
			></label
		>
	</fieldset>
	<h2 id="avoided-types">{uiText('Types to avoid')}</h2>
	<fieldset
		class="settings-panel"
		data-surface="panel"
		aria-labelledby="avoided-types"
		disabled={busy}
	>
		{#each [...new Set([...avoids, ...original.avoid_types, ...draft.avoid_types])] as t (t)}<label
				class="check"
				><input type="checkbox" value={t} bind:group={draft.avoid_types} />{releaseType(t)}</label
			>{/each}
		<label class="check"
			><input type="checkbox" bind:checked={draft.manage_unconfirmed} />{uiText(
				'Apply edition management to unconfirmed matches'
			)}</label
		>
	</fieldset>
{:else if releases && oldReleases}
	<p>{uiText('Choose which release types appear in server searches and on artist pages.')}</p>
	{#each groups as g (g.key)}<h2 id={g.key}>{uiText(g.label)}</h2>
		<fieldset class="settings-panel" data-surface="panel" aria-labelledby={g.key} disabled={busy}>
			{#each [...new Set([...g.options, ...oldReleases[g.key], ...releases[g.key]])] as t (t)}<label
					class="check"
					><input type="checkbox" value={t} bind:group={releases[g.key]} />{releaseType(t)}</label
				>{/each}
		</fieldset>{/each}
{:else if busy}<p role="status">{uiText('Loading server preferences…')}</p>{/if}
{#if draft || releases}<button class="secondary" disabled={busy || !dirty} onclick={save}
		>{uiText('Save server preferences')}</button
	>{/if}
{#if error}<p role="alert">{error}</p>
	{#if !draft && !releases}<button class="text-button" onclick={read}>{uiText('Try again')}</button
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
