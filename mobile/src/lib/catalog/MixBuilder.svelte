<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Plus, X, Play, Pencil, Trash2, ListMusic } from '@lucide/svelte';
	import { tr } from '../i18n';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { errorMessage, type OnPlay } from './catalog';
	import {
		collectionKey,
		watchHome,
		maxSeeds,
		mixPin,
		rememberPlan,
		saveMix,
		removeMix,
		devicePinTracks,
		type HomeCollection,
		type Mix,
		type MixSeed
	} from './homePins';
	import { findMixSeeds, playMix } from './mixBuilder';
	import { beginPlaybackPreparation } from './browseActions';
	import HomePinButton from './HomePinButton.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import InlineChoice from '../controls/InlineChoice.svelte';

	let {
		session,
		owner,
		onplay,
		offline,
		available
	}: {
		session: Session;
		owner: string;
		onplay: OnPlay;
		offline: boolean;
		available?: PlayerTrack[];
	} = $props();
	const key = $derived(collectionKey(session.serverUrl, owner));
	let opened = $state(false),
		list = $state.raw<HomeCollection>(),
		id = $state(''),
		title = $state('');
	let mode = $state<Mix['mode']>('artists'),
		seeds = $state<MixSeed[]>([]),
		query = $state(''),
		focused = $state<Mix>();
	let results = $state.raw<MixSeed[]>([]),
		next = $state<string | null>(),
		busy = $state(false),
		deleting = $state(false),
		notice = $state(''),
		error = $state('');
	let cursor = $state<string>(),
		searchError = $state(''),
		searching = $state(false);
	let playback: AbortController | undefined;
	$effect(() =>
		watchHome(key, (data) => {
			list = data;
		})
	);
	function edit(m?: Mix) {
		focused = undefined;
		id = m?.id ?? '';
		title = m?.title ?? '';
		seeds = m ? [...m.seeds] : [];
		mode = m?.mode ?? 'artists';
		query = '';
		error = '';
		notice = '';
		deleting = false;
	}
	function show(m: Mix) {
		edit(m);
		focused = m;
	}
	function close() {
		playback?.abort();
		busy = false;
		opened = false;
		edit();
	}
	onDestroy(() => playback?.abort());
	$effect(() => {
		const account = session,
			term = query.trim(),
			kind = mode,
			after = cursor;
		if (!opened || focused || offline || !term) {
			results = [];
			next = null;
			searching = false;
			searchError = '';
			return;
		}
		const job = new AbortController();
		if (!after) results = [];
		next = null;
		searching = true;
		searchError = '';
		const timer = setTimeout(() => {
			void findMixSeeds(account, kind, term, job.signal, after)
				.then((page) => {
					if (job.signal.aborted) return;
					results = after
						? [...new Map([...results, ...page.seeds].map((s) => [s.id, s])).values()]
						: page.seeds;
					next = page.next !== after ? page.next : undefined;
				})
				.catch((e) => {
					if (!job.signal.aborted) searchError = errorMessage(e);
				})
				.finally(() => {
					if (!job.signal.aborted) searching = false;
				});
		}, 220);
		return () => {
			clearTimeout(timer);
			job.abort();
		};
	});
	function changeMode(value: string) {
		mode = value === 'albums' ? 'albums' : 'artists';
		seeds = [];
		query = '';
		cursor = undefined;
	}
	function save() {
		if (!seeds.length || !title.trim()) return;
		try {
			const m = { id: id || crypto.randomUUID(), title: title.trim(), mode, seeds: [...seeds] };
			saveMix(key, m);
			show(m);
		} catch (e) {
			error = errorMessage(e);
		}
	}
	async function play() {
		if (busy || !seeds.length || !list) return;
		playback = new AbortController();
		const job = playback,
			finish = beginPlaybackPreparation(() => job.abort());
		const m = { id, title, mode, seeds };
		busy = true;
		error = '';
		notice = '';
		try {
			const tracks = offline
				? await devicePinTracks(session, mixPin(m), list, available ?? [], job.signal)
				: await playMix(session, m, job.signal);
			if (job.signal.aborted) return;
			if (!tracks.length) {
				notice = offline
					? tr(
							'None of these tracks are on this device.',
							'この端末に保存されている曲はありません。'
						)
					: tr(
							'No playable tracks for these selections.',
							'選択した項目には再生可能な曲がありません。'
						);
				return;
			}
			if (id && !offline) rememberPlan(key, mixPin(m), tracks);
			finish();
			await onplay(tracks, 0);
			if (!job.signal.aborted) close();
		} catch (e) {
			if (!job.signal.aborted) error = errorMessage(e);
		} finally {
			finish();
			if (job === playback) busy = false;
		}
	}
</script>

<button
	class="secondary launch"
	onclick={() => {
		edit();
		opened = true;
	}}><ListMusic size={18} />{tr('Mix Builder', 'ミックスを作る')}</button
>
{#if opened}
	<PlaylistDialog title={tr('Mix Builder', 'ミックスを作る')} onclose={close}>
		{#if focused}
			<h3>{focused.title}</h3>
			<p>{focused.seeds.map((s) => s.title).join(' · ')}</p>
			<div class="actions">
				<button class="primary" disabled={busy} onclick={play}
					><Play size={16} />{tr('Play mix', 'ミックスを再生')}</button
				>
				<HomePinButton {session} pin={mixPin(focused)} />
				<button class="secondary" onclick={() => edit(focused)}
					><Pencil size={16} />{tr('Edit mix', 'ミックスを編集')}</button
				>
				<button class="secondary" onclick={() => (deleting = true)}
					><Trash2 size={16} />{tr('Delete mix', 'ミックスを削除')}</button
				>
			</div>
			{#if deleting}<div class="actions">
					<button class="secondary" onclick={() => (deleting = false)}
						>{tr('Cancel', 'キャンセル')}</button
					>
					<button
						class="primary"
						onclick={() => {
							if (focused) {
								try {
									removeMix(key, focused);
									edit();
								} catch (e) {
									error = errorMessage(e);
								}
							}
						}}>{tr('Confirm delete', '削除を確定')}</button
					>
				</div>{/if}
			<button class="text-button" onclick={() => edit()}
				>{tr('Back to mixes', 'ミックス一覧に戻る')}</button
			>
		{:else}
			{#if list?.mixes.length && !id}<h3>{tr('Saved mixes', '保存したミックス')}</h3>
				{#each list.mixes as m (m.id)}<button class="result" onclick={() => show(m)}
						><ListMusic size={17} />{m.title}</button
					>{/each}{/if}
			<h3>{id ? tr('Edit mix', 'ミックスを編集') : tr('New mix', '新しいミックス')}</h3>
			<label>{tr('Mix name', 'ミックス名')}<input maxlength="120" bind:value={title} /></label>
			<InlineChoice selected={mode} label={tr('Build from', '選択元')}
				><select value={mode} onchange={(e) => changeMode(e.currentTarget.value)}>
					<option value="artists">{tr('Artists', 'アーティスト')}</option><option value="albums"
						>{tr('Albums', 'アルバム')}</option
					>
				</select></InlineChoice
			>
			{#if seeds.length}<ul class="seeds">
					{#each seeds as seed (seed.id)}<li>
							<span>{seed.title}</span><button
								aria-label={tr('Remove ' + seed.title, '「' + seed.title + '」をミックスから外す')}
								onclick={() => (seeds = seeds.filter((s) => s.id !== seed.id))}
								><X size={16} /></button
							>
						</li>{/each}
				</ul>{/if}
			{#if offline}<p>
					{tr(
						'Connect to DroppedNeedle to find more music.',
						'音楽を検索するにはDroppedNeedleに接続してください。'
					)}
				</p>
			{:else}
				<label
					>{mode === 'artists'
						? tr('Find artists', 'アーティストを探す')
						: tr('Find albums', 'アルバムを探す')}
					<input
						type="search"
						value={query}
						oninput={(e) => {
							query = e.currentTarget.value;
							cursor = undefined;
						}}
					/>
				</label>
				{#if query.trim()}
					<div class="results">
						{#each results as seed (seed.id)}
							<button
								class="result"
								disabled={seeds.length >= maxSeeds || seeds.some((s) => s.id === seed.id)}
								aria-label={tr('Add ' + seed.title, '「' + seed.title + '」をミックスに追加')}
								onclick={() => (seeds = [...seeds, seed])}
							>
								<Plus size={16} /><span
									>{seed.title}{#if mode === 'albums'}<small>{seed.artist}</small>{/if}</span
								>
							</button>{/each}
					</div>
					{#if searching}<p role="status">
							{tr('Searching…', '検索中…')}
						</p>{:else if !results.length && !searchError}<p>
							{tr(
								'No MusicBrainz-linked matches in your library.',
								'ライブラリにMusicBrainzとリンクした一致項目はありません。'
							)}
						</p>{/if}
					{#if next}<button class="text-button" onclick={() => (cursor = next ?? undefined)}
							>{tr('More results', 'さらに表示')}</button
						>{/if}
					{#if seeds.length >= maxSeeds}<p>
							{tr(
								'A mix can include up to eight selections.',
								'ミックスには最大8件まで追加できます。'
							)}
						</p>{/if}
				{/if}
			{/if}
			{#if searchError}<p role="alert">{searchError}</p>{/if}
			<div class="actions">
				<button class="primary" disabled={!seeds.length || !title.trim() || busy} onclick={save}
					>{tr('Save mix', 'ミックスを保存')}</button
				>
				<button class="secondary" disabled={!seeds.length || offline || busy} onclick={play}
					><Play size={16} />{tr('Play mix', 'ミックスを再生')}</button
				>
			</div>
		{/if}
		{#if error}<p role="alert">{error}</p>{:else if notice}<p role="status">{notice}</p>{/if}
		<button class="text-button" onclick={close}>{tr('Close', '閉じる')}</button>
	</PlaylistDialog>
{/if}

<style>
	.launch {
		margin-block-end: 0.7rem;
	}
	.result,
	.seeds li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
	}
	.result {
		width: 100%;
		text-align: start;
		border-bottom: 1px solid var(--line);
	}
	.results {
		max-height: 30dvh;
		overflow: auto;
	}
	.result small {
		display: block;
		color: var(--muted);
	}
	.seeds {
		list-style: none;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.seeds li {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding-inline-start: 0.55rem;
	}
	.seeds li button {
		min-height: 44px;
		min-width: 38px;
	}
</style>
