<script lang="ts">
	import { onMount } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path } from '../catalog/catalog';
	type S = components['schemas'];
	let { session, diagnostics = false }: { session: Session; diagnostics?: boolean } = $props();
	let library = $state<S['StatsView']>(),
		workers = $state<S['QueueStatsResponse']>(),
		providers = $state<S['ProviderStatsResponse']>();
	let busy = $state(false),
		error = $state('');
	async function load() {
		busy = true;
		error = '';
		try {
			if (diagnostics) {
				[workers, providers] = await Promise.all([
					getJson<S['QueueStatsResponse']>(session, path('/api/v3/admin/queue-stats')),
					getJson<S['ProviderStatsResponse']>(session, path('/api/v3/admin/provider-stats'))
				]);
			} else library = await getJson<S['StatsView']>(session, path('/api/v3/library/stats'));
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
</script>

<button class="secondary" onclick={load} disabled={busy}>Refresh statistics</button>
{#if busy}<p role="status">Loading statistics…</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
{#if library}
	<h2>Collection</h2>
	<dl class="settings-facts" data-surface="panel">
		<div>
			<dt>Artists</dt>
			<dd>{library.total_artists.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Albums</dt>
			<dd>{library.total_albums.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Songs</dt>
			<dd>{library.total_tracks.toLocaleString()}</dd>
		</div>
		<div>
			<dt>Audio storage</dt>
			<dd>
				{(library.total_size_bytes / 1024 ** 3).toLocaleString(undefined, {
					maximumFractionDigits: 2
				})} GiB
			</dd>
		</div>
	</dl>
	<h2>Your favorites</h2>
	<p>
		{library.favorite_artists} artists · {library.favorite_albums} albums · {library.favorite_tracks}
		songs
	</p>
	<h2>Formats</h2>
	{#if Object.keys(library.format_breakdown).length}
		<dl class="settings-facts" data-surface="panel">
			{#each Object.entries(library.format_breakdown) as [format, count] (format)}<div>
					<dt>{format}</dt>
					<dd>{count.toLocaleString()}</dd>
				</div>{/each}
		</dl>{:else}<p>No audio formats reported.</p>{/if}
{:else if workers && providers}
	<h2>Work queues</h2>
	{#if workers.queues.length}<div class="settings-list" data-surface="panel">
			{#each workers.queues as queue (queue.kind)}<article>
					<strong>{queue.kind}</strong>
					<p>{queue.queued} queued · {queue.running} running · {queue.failed} failed</p>
				</article>{/each}
		</div>{:else}<p>No queued, running or failed jobs.</p>{/if}
	<h2>Background jobs</h2>
	{#if workers.jobs.length}<div class="settings-list" data-surface="panel">
			{#each workers.jobs as job (job.name)}<article>
					<strong>{job.name}</strong>
					<p>
						{job.state}{#if job.last_heartbeat_at}
							· {new Date(job.last_heartbeat_at).toLocaleString()}{/if}
					</p>
					{#if job.last_error}<p>{job.last_error}</p>{/if}
				</article>{/each}
		</div>{:else}<p>No background jobs reported.</p>{/if}
	<h2>Provider calls</h2>
	{#if providers.calls.length}<div class="settings-list" data-surface="panel">
			{#each providers.calls as row (JSON.stringify( [row.source, row.priority, row.outcome] ))}<article
				>
					<strong>{row.source}</strong>
					<p>
						{row.priority} · {row.outcome} · {row.calls.toLocaleString()} calls · {row.calls_last_minute}
						in the last minute
					</p>
				</article>{/each}
		</div>{:else}<p>No provider calls recorded.</p>{/if}
	<h2>Rate limits</h2>
	{#if providers.limiters.length}<div class="settings-list" data-surface="panel">
			{#each providers.limiters as row (row.source)}<article>
					<strong>{row.source}</strong>
					<p>{row.remaining} of {row.burst} tokens available · {row.per_second} per second</p>
				</article>{/each}
		</div>{:else}<p>No rate limits reported.</p>{/if}
{/if}

<style>
	article {
		padding: 0.7rem var(--gap);
		overflow-wrap: anywhere;
	}
	article p {
		color: var(--muted);
		margin: 0.25rem 0;
	}
</style>
