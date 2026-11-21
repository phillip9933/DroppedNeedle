<script lang="ts">
	import { uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { errorMessage } from './catalog';
	import {
		playlistPeople,
		playlistMembers,
		playlistVisibility,
		sharePlaylist,
		type Member,
		type Playlist
	} from './playlists';
	import PlaylistDialog from './PlaylistDialog.svelte';
	let {
		session,
		playlist,
		onclose,
		onvisibility
	}: {
		session: Session;
		playlist: Playlist;
		onclose: () => void;
		onvisibility: (item: Playlist) => void;
	} = $props();
	let loading = $state(true),
		ready = $state(false),
		saving = $state(false);
	let error = $state(''),
		receipt = $state(''),
		query = $state('');
	let known = $state<Awaited<ReturnType<typeof playlistPeople>>['users']>([]);
	let members = $state<Member[]>([]),
		saved = $state<Member[]>([]);
	let everyone = $state(false);
	const matches = $derived(
		query.trim()
			? known
					.filter(
						(person) =>
							!members.some((m) => m.user_id === person.id) &&
							person.display_name.toLowerCase().includes(query.trim().toLowerCase())
					)
					.slice(0, 8)
			: []
	);
	function memberKey(entries: Member[]) {
		return JSON.stringify(
			entries
				.map((m) => [m.user_id, m.can_edit])
				.sort(([a], [b]) => String(a).localeCompare(String(b)))
		);
	}
	async function load() {
		loading = true;
		error = '';
		ready = false;
		try {
			const reply = await playlistPeople(session, playlist.id);
			saved = reply.members;
			members = reply.members.map((m) => ({ ...m }));
			known = reply.users;
			everyone = playlist.is_public;
			ready = true;
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function saveAccess() {
		if (saving) return;
		saving = true;
		error = '';
		receipt = '';
		try {
			const item = await playlistVisibility(session, playlist.id, everyone);
			onvisibility(item);
			receipt = item.is_public
				? 'Everyone on this server can listen.'
				: 'Access is limited to you and the people listed below.';
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			saving = false;
		}
	}
	async function savePeople() {
		if (saving) return;
		saving = true;
		error = '';
		receipt = '';
		try {
			// DN replaces the full membership list. Keep another device's intervening edits.
			const fresh = await playlistMembers(session, playlist.id);
			if (memberKey(fresh.members) !== memberKey(saved)) {
				saved = fresh.members;
				members = fresh.members.map((m) => ({ ...m }));
				throw new Error(
					'Sharing changed on another device. Review the updated list before saving.'
				);
			}
			const result = await sharePlaylist(session, playlist.id, members);
			saved = result.members;
			members = result.members.map((m) => ({ ...m }));
			receipt = 'Shared listeners updated.';
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			saving = false;
		}
	}
</script>

<PlaylistDialog title={uiText('Share playlist')} {onclose} busy={saving}>
	{#if loading}<p role="status">{uiText('Loading sharing…')}</p>
	{:else if ready}
		<label
			>{uiText('Who can listen')}<InlineChoice selected={everyone}
				><select bind:value={everyone} disabled={saving}>
					<option value={false}>{uiText('You and selected listeners')}</option>
					<option value={true}>{uiText('Everyone on this server')}</option>
				</select></InlineChoice
			></label
		>
		<button
			class="secondary"
			disabled={saving || everyone === playlist.is_public}
			onclick={saveAccess}>{uiText('Save visibility')}</button
		>
		<h3>{uiText('Selected listeners')}</h3>
		{#each members as person (person.user_id)}
			<div class="person">
				<label
					>{person.display_name}<InlineChoice
						selected={person.can_edit}
						label={'Access for ' + person.display_name}
						><select bind:value={person.can_edit} disabled={saving}>
							<option value={false}>{uiText('Can listen')}</option><option value={true}
								>{uiText('Can edit tracks')}</option
							>
						</select></InlineChoice
					></label
				>
				<button
					class="text-button"
					disabled={saving}
					aria-label={'Remove ' + person.display_name + ' from shared listeners'}
					onclick={() => {
						members = members.filter((m) => m.user_id !== person.user_id);
						receipt = '';
					}}>{uiText('Remove')}</button
				>
			</div>
		{/each}
		<label
			>{uiText('Find a listener')}<input
				type="search"
				bind:value={query}
				disabled={saving}
			/></label
		>
		{#each matches as user (user.id)}
			<button
				class="text-button"
				disabled={saving}
				onclick={() => {
					members = [
						...members,
						{ user_id: user.id, display_name: user.display_name, can_edit: false }
					];
					query = '';
					receipt = '';
				}}>{uiText('Add')} {user.display_name}</button
			>
		{:else}
			{#if query.trim()}<p>{uiText('No matching listeners.')}</p>{/if}
		{/each}
		<button
			class="secondary"
			disabled={saving || memberKey(members) === memberKey(saved)}
			onclick={savePeople}>{uiText('Save listeners')}</button
		>
	{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	{#if receipt}<p role="status">{receipt}</p>{/if}
	<div class="actions">
		{#if !ready && !loading}<button class="secondary" onclick={load}>{uiText('Try again')}</button
			>{/if}
		<button class="primary" disabled={saving} onclick={onclose}>{uiText('Done')}</button>
	</div>
</PlaylistDialog>

<style>
	.person {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}
	.person label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	h3 {
		margin-block: 1.2rem 0.5rem;
	}
</style>
