import { savedSections } from '../boards/layout';
import type { FilterSection } from '../boards/filteredSections';
import { requestFilters } from '../catalog/trackFilters';
import type { OfflineAccount, OfflinePin } from './tracks';

export function filterPin(rule: FilterSection): OfflinePin {
	const filters = requestFilters({
		...rule,
		q: rule.query,
		order: ['album_count', 'date_added', 'year'].includes(rule.sort) ? 'desc' : 'asc'
	});
	return {
		id: rule.id,
		name: rule.name,
		kind: 'filter',
		group: rule.kind,
		filters: Object.fromEntries(
			Object.entries(filters)
				.filter(([, v]) => v !== undefined)
				.map(([k, v]) => [k, String(v)])
		)
	};
}

export function refreshPinRules(account: OfflineAccount, pins: OfflinePin[]) {
	const rules = new Map(
		savedSections(account.serverUrl, account.userId ?? '').map((rule) => [rule.id, rule])
	);
	return pins.map((pin) => {
		const rule = pin.kind === 'filter' ? rules.get(pin.id) : undefined;
		return rule ? filterPin(rule) : pin;
	});
}
