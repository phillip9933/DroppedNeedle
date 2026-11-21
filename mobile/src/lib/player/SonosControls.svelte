<script lang="ts">
	import { onMount } from 'svelte';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { nativeOutput as player, type SonosRoom } from './native';
	let rooms = $state<SonosRoom[]>([]),
		targets = $state<Record<string, string>>({}),
		error = $state(''),
		busy = $state(false);
	let levels = $state<Record<string, number>>({});
	let attached = true,
		status = $state('');
	async function read() {
		const result = await player.sonosRooms();
		if (attached) {
			rooms = result.rooms;
			levels = Object.fromEntries(
				result.rooms.flatMap((room) => (room.volume === undefined ? [] : [[room.id, room.volume]]))
			);
			targets = Object.fromEntries(result.rooms.map((r) => [r.id, r.coordinator ?? '']));
		}
		return result.rooms;
	}
	async function run(change: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		error = '';
		status = '';
		try {
			await change();
		} catch (e) {
			if (attached) error = e instanceof Error ? e.message : 'Unable to update Sonos rooms.';
		} finally {
			if (attached) busy = false;
		}
	}
	async function setGroup(room: SonosRoom) {
		const target = targets[room.id];
		await run(async () => {
			await player.setSonosGroup({
				id: room.id,
				...(target === room.id ? {} : { coordinator: target })
			});
			for (const delay of [0, 350, 900]) {
				if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
				if (!attached) return;
				if ((await read()).find((r) => r.id === room.id)?.coordinator === target) return;
			}
			status = 'Sonos is updating the group. Refresh rooms to see the latest membership.';
		});
	}
	async function volume(room: SonosRoom, level: number) {
		await run(async () => {
			try {
				await player.setSonosVolume({ id: room.id, volume: level });
			} catch (cause) {
				if (room.volume !== undefined) levels[room.id] = room.volume;
				throw cause;
			}
			await read();
		});
	}
	onMount(() => {
		attached = true;
		void run(read);
		return () => {
			attached = false;
		};
	});
</script>

<h3>Sonos rooms</h3>
<div class="settings-panel" data-surface="panel">
	{#each rooms as room (room.id)}
		<div class="room">
			<strong>{room.name}</strong>
			<p>
				{room.members === 1
					? 'Standalone room'
					: room.coordinator === room.id
						? 'Group coordinator · ' + room.members + ' rooms'
						: 'Grouped with ' + room.groupName}
			</p>
			{#if room.volume !== undefined}
				<label
					>{room.name} volume <output>{levels[room.id] ?? room.volume}%</output>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={levels[room.id] ?? room.volume}
						disabled={busy}
						oninput={(e) => {
							levels[room.id] = Number(e.currentTarget.value);
						}}
						onchange={(e) => volume(room, Number(e.currentTarget.value))}
					/>
				</label>
			{/if}
			{#if room.coordinator && (room.coordinator !== room.id || room.members === 1) && rooms.length > 1}
				<label
					>Group for {room.name}<InlineChoice selected={targets[room.id]}
						><select bind:value={targets[room.id]} disabled={busy}>
							<option value={room.id}>Standalone</option>
							{#each rooms.filter((r) => r.id !== room.id && room.leaders.includes(r.id)) as group (group.id)}<option
									value={group.id}>{group.name}</option
								>{/each}
						</select></InlineChoice
					></label
				>
				{#if targets[room.id] !== room.coordinator}<button
						class="secondary"
						disabled={busy}
						onclick={() => setGroup(room)}>Apply group</button
					>{/if}
			{/if}
		</div>
	{/each}
	{#if status}<p role="status">{status}</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	<button class="secondary" disabled={busy} onclick={() => run(read)}
		>{busy ? 'Updating rooms…' : 'Refresh rooms'}</button
	>
</div>

<style>
	h3 {
		margin: 0.75rem 0 0;
		color: var(--heading, var(--text));
		font-size: 1.12rem;
	}
	.room {
		display: grid;
		gap: 0.45rem;
	}
	.room + .room {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	p {
		margin: 0;
		color: var(--muted);
	}
	label {
		display: block;
	}
	input[type='range'] {
		display: block;
		width: 100%;
	}
</style>
