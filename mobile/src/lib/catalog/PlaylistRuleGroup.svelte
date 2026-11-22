<script lang="ts">
	import { Pencil, Plus, Trash2 } from '@lucide/svelte';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { tr } from '../i18n';
	import type { RuleGroup, TrackRule } from './smartRules';
	import { fields, ruleLabel } from './ruleLabels';
	import PlaylistRuleGroup from './PlaylistRuleGroup.svelte';
	let {
		group,
		depth = 0,
		pick,
		addGroup,
		changeMode,
		remove
	}: {
		group: RuleGroup;
		depth?: number;
		pick: (group: RuleGroup, item?: TrackRule) => void;
		addGroup: (group: RuleGroup) => void;
		changeMode: (group: RuleGroup, mode: RuleGroup['match']) => void;
		remove: (item: RuleGroup) => void;
	} = $props();
</script>

<div class="rule-group" class:nested={depth > 0}>
	{#if depth || group.rules.length > 1 || group.match === 'any'}
		<div class="mode">
			<InlineChoice selected={group.match} label={tr('Match rules', '条件の組み合わせ')}>
				<select
					value={group.match}
					onchange={(e) => changeMode(group, e.currentTarget.value as RuleGroup['match'])}
				>
					<option value="all">{tr('Match all of these', 'すべての条件に一致')}</option>
					<option value="any">{tr('Match any of these', 'いずれかの条件に一致')}</option>
				</select>
			</InlineChoice>
			{#if depth}<button
					class="icon-button"
					aria-label={tr('Remove group', 'グループを削除')}
					onclick={() => remove(group)}><Trash2 size={17} /></button
				>{/if}
		</div>
	{/if}
	{#each group.rules as item, i (i)}
		{#if 'rules' in item}
			{#if i > 0}<small class="join"
					>{group.match === 'all' ? tr('AND', 'かつ') : tr('OR', 'または')}</small
				>{/if}
			<PlaylistRuleGroup group={item} depth={depth + 1} {pick} {addGroup} {changeMode} {remove} />
		{:else}
			{@const Icon = fields[item.field].icon}
			<button class="rule" onclick={() => pick(group, item)}>
				<Icon size={19} /><span>{ruleLabel(item)}</span><Pencil size={16} />
			</button>
		{/if}
	{/each}
	<div class="actions-row">
		<button class="text-button" onclick={() => pick(group)}
			><Plus size={16} />{tr('Add rule', '条件を追加')}</button
		>
		{#if depth < 7}<button class="text-button" onclick={() => addGroup(group)}
				><Plus size={16} />{tr('Add group', 'グループを追加')}</button
			>{/if}
	</div>
</div>

<style>
	.rule-group {
		min-width: 0;
	}
	.nested {
		padding-inline-start: min(0.8rem, 3vw);
		border-inline-start: 2px solid var(--line);
		margin: 0.2rem 0 0.45rem;
	}
	.nested :global(.nested) {
		padding-inline-start: 0.45rem;
	}
	.mode,
	.actions-row,
	.rule {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.mode {
		justify-content: space-between;
	}
	.mode :global(select) {
		background: transparent;
		border: 0;
		padding-inline-start: 0;
	}
	.mode :global(.inline-choice) {
		max-width: calc(100% - 2.5rem);
	}
	.rule {
		text-align: start;
		min-height: 48px;
		width: 100%;
		padding: 0.4rem 0.15rem;
		border-bottom: 1px solid var(--line);
		border-radius: 0;
		background: transparent;
		color: var(--text);
	}
	.rule span {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.rule :global(svg) {
		flex: none;
	}
	.rule :global(svg:last-child),
	.mode .icon-button {
		color: var(--muted);
	}
	.mode .icon-button {
		background: transparent;
		box-shadow: none;
		border: 0;
	}
	.actions-row {
		flex-wrap: wrap;
		gap: 0.2rem 0.7rem;
	}
	.actions-row button {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding-inline: 0.2rem;
	}
	.join {
		display: block;
		color: var(--muted);
		font-weight: 600;
		margin-block: 0.55rem 0;
	}
</style>
