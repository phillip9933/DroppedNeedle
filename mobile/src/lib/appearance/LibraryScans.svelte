<script lang="ts">
	import { onMount } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, postJson, type Session } from '../connection';
	import { path, errorMessage } from '../catalog/catalog';
	type S = components['schemas'];
	let { session }: { session: Session } = $props();
	let settings = $state<S['LibrarySettingsResponse']>(),
		stats = $state<S['StatsView']>(),
		runs = $state<S['ScanRunCurrentResponse']>(),
		history = $state<S['ScanRunView'][]>([]);
	let loading = $state(false),
		sending = $state(false),
		ask = $state(false),
		message = $state(''),
		error = $state('');
	async function read() {
		if (loading) return;
		loading = true;
		error = '';
		try {
			[settings, stats, runs, { items: history }] = await Promise.all([
				getJson<S['LibrarySettingsResponse']>(session, path('/api/v3/settings/library')),
				getJson<S['StatsView']>(session, path('/api/v3/library/stats')),
				getJson<S['ScanRunCurrentResponse']>(session, path('/api/v3/library/scan/runs/current')),
				getJson<S['Page_ScanRunView']>(
					session,
					path('/api/v3/library/scan/runs/history', {}, { limit: 5 })
				)
			]);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	async function scan() {
		if (!settings?.policy_revision || sending) return;
		ask = false;
		sending = true;
		message = '';
		error = '';
		try {
			const answer = await postJson<S['ScanRunRequestedResponse']>(
				session,
				path('/api/v3/library/scan/runs'),
				{
					kind: 'incremental',
					scope_ids: [],
					expected_policy_revision: settings.policy_revision
				} satisfies S['ScanRunRequestBody']
			);
			message =
				answer.disposition === 'conflict'
					? 'Another scan is already using the worker.'
					: 'Scan ' + answer.disposition + '.';
			await read();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			sending = false;
		}
	}
	onMount(() => {
		void read();
		const timer = setInterval(() => {
			if (!document.hidden && (runs?.active || runs?.queued) && !sending) void read();
		}, 15000);
		return () => clearInterval(timer);
	});
</script>

<h2>Library scans</h2>
<div class="settings-panel" data-surface="panel">
	{#if stats}<p>
			{stats.total_artists.toLocaleString()} artists · {stats.total_albums.toLocaleString()} albums ·
			{stats.total_tracks.toLocaleString()}
			songs
		</p>{/if}
	{#if runs}<p>
			{runs.active ? 'Current scan: ' + runs.active.state : 'No scan running.'}{runs.queued
				? ' A scan is queued.'
				: ''}
		</p>{/if}
	<div class="settings-actions">
		{#if ask}<p>Scan all configured library roots for new and changed files?</p>
			<button class="primary" onclick={scan}>Start scan</button>
			<button class="text-button" onclick={() => (ask = false)}>Cancel</button>
		{:else}<button
				class="secondary"
				disabled={!settings?.policy_revision || !settings.enabled || sending || loading}
				onclick={() => (ask = true)}>Scan for changes</button
			>{/if}
		<button class="text-button" disabled={loading || sending} onclick={read}>Refresh scans</button>
	</div>
</div>
{#if history.length}<h2>Recent scans</h2>
	<ul class="settings-list" data-surface="panel">
		{#each history as run (run.id)}<li>
				{run.kind.replaceAll('_', ' ')} · {run.state} · {new Date(
					run.queued_at * 1000
				).toLocaleString()}
			</li>{/each}
	</ul>{/if}
{#if error}<p role="alert">{error}</p>{/if}{#if message}<p role="status">
		{message}
	</p>{:else if loading}<p role="status">Loading scans…</p>{/if}

<style>
	ul {
		padding: 0;
		list-style: none;
	}
	li {
		padding: 0.7rem var(--gap);
		overflow-wrap: anywhere;
	}
</style>
