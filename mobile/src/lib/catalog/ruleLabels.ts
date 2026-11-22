import { Album, CalendarDays, Clock3, Disc3, Heart, History, Search, Star } from '@lucide/svelte';
import { tr } from '../i18n';
import type { TrackRule } from './smartRules';

export type Field = TrackRule['field'];
export const fields = {
	genre: { name: ['Genre', 'ジャンル'], icon: Disc3, conditions: ['is', 'isNot'] },
	year: {
		name: ['Release year', '発売年'],
		icon: CalendarDays,
		conditions: ['is', 'atLeast', 'atMost']
	},
	format: { name: ['File format', 'ファイル形式'], icon: Album, conditions: ['is', 'isNot'] },
	query: { name: ['Search text', '検索テキスト'], icon: Search, conditions: ['contains'] },
	rating: { name: ['Rating', '評価'], icon: Star, conditions: ['is', 'atLeast', 'atMost'] },
	favorite: { name: ['Favorite', 'お気に入り'], icon: Heart, conditions: ['is'] },
	plays: {
		name: ['Play count', '再生回数'],
		icon: History,
		conditions: ['is', 'atLeast', 'atMost']
	},
	lastPlayed: {
		name: ['Last played', '最終再生'],
		icon: Clock3,
		conditions: ['olderThan', 'within']
	}
} as const;
export const fieldSets: { name: [string, string]; fields: Field[] }[] = [
	{ name: ['Track details', '曲の情報'], fields: ['genre', 'year', 'format', 'query'] },
	{ name: ['Your library', 'ライブラリ'], fields: ['rating', 'favorite'] },
	{ name: ['Listening history', '再生履歴'], fields: ['plays', 'lastPlayed'] }
];
export const fieldName = (field: Field) => tr(fields[field].name[0], fields[field].name[1]);
export function conditionName(op: TrackRule['op'], field: Field) {
	if (op === 'atLeast' && field === 'year') return tr('in or after', '以降');
	if (op === 'atMost' && field === 'year') return tr('in or before', '以前');
	if (op === 'is' && field === 'format') return tr('is any of', '次のいずれか');
	if (op === 'isNot' && field === 'format') return tr('is none of', '次のいずれでもない');
	const names: Record<TrackRule['op'], [string, string]> = {
		is: ['is', 'と一致'],
		isNot: ['is not', 'と一致しない'],
		atLeast: ['is at least', '以上'],
		atMost: ['is at most', '以下'],
		contains: ['contains', 'を含む'],
		olderThan: ['over', 'より前'],
		within: ['within', '以内']
	};
	return tr(...names[op]);
}
export function ruleLabel(rule: TrackRule) {
	const { field, op, value } = rule;
	const val = Array.isArray(value) ? value.join(', ').toUpperCase() : String(value);
	if (field === 'favorite')
		return value
			? tr('Is a favorite', 'お気に入りの曲')
			: tr('Is not a favorite', 'お気に入り以外の曲');
	if (field === 'lastPlayed')
		return op === 'within'
			? tr('Played in the last ' + val + ' days', '過去' + val + '日以内に再生')
			: tr('Not played in the last ' + val + ' days', '過去' + val + '日間未再生');
	const text =
		field === 'rating'
			? tr(val + (value === 1 ? ' star' : ' stars'), '星' + val)
			: field === 'query'
				? '“' + val + '”'
				: val;
	return tr(
		fieldName(field) + ' ' + conditionName(op, field) + ' ' + text,
		fieldName(field) + '：' + text + ' ' + conditionName(op, field)
	);
}
export function firstRule(field: Field): TrackRule {
	const defaults: Record<Field, TrackRule['value']> = {
		genre: '',
		year: new Date().getFullYear(),
		format: [],
		query: '',
		rating: 5,
		favorite: true,
		plays: 1,
		lastPlayed: 30
	};
	return { field, op: fields[field].conditions[0], value: defaults[field] };
}
