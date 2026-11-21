export type EditionList = 'status_order' | 'format_order' | 'countries';
type Choice = { value: string; label: string };

const statuses = [
	['official', 'Official', '公式'],
	['promotion', 'Promotional', 'プロモーション'],
	['bootleg', 'Bootleg', 'ブートレグ'],
	['pseudo-release', 'Pseudo-release', '疑似リリース'],
	['withdrawn', 'Withdrawn', '回収済み'],
	['cancelled', 'Cancelled', '発売中止']
];

const formats = [
	['digital media', 'Digital media', 'デジタル配信'],
	['cd', 'CD', 'CD'],
	['vinyl', 'Vinyl', 'レコード'],
	['cassette', 'Cassette', 'カセット'],
	['sacd', 'SACD', 'SACD'],
	['blu-ray', 'Blu-ray', 'Blu-ray'],
	['dvd', 'DVD', 'DVD'],
	['minidisc', 'MiniDisc', 'ミニディスク'],
	['dat', 'DAT', 'DAT'],
	['reel-to-reel', 'Reel-to-reel', 'オープンリール']
];

const countries = (
	'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
	'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
	'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
	'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS ' +
	'MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU ' +
	'RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
	'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

export function editionOptions(kind: EditionList, locale: string): Choice[] {
	if (kind !== 'countries') {
		return (kind === 'status_order' ? statuses : formats).map(([value, en, ja]) => ({
			value,
			label: locale === 'ja' ? ja : en
		}));
	}
	const names =
		typeof Intl.DisplayNames === 'function'
			? new Intl.DisplayNames(locale, { type: 'region', fallback: 'none' })
			: undefined;
	const named = countries.map((value) => {
		const name = names?.of(value);
		return { value, label: name ? name + ' (' + value + ')' : value };
	});
	return [
		{ value: 'XW', label: locale === 'ja' ? '全世界 (XW)' : 'Worldwide (XW)' },
		{ value: 'XE', label: locale === 'ja' ? 'ヨーロッパ (XE)' : 'Europe (XE)' },
		{ value: 'XU', label: locale === 'ja' ? '国不明 (XU)' : 'Unknown country (XU)' },
		...named.sort((a, b) => a.label.localeCompare(b.label, locale))
	];
}
