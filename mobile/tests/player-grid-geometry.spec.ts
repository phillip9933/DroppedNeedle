import { expect, test } from '@playwright/test';
import type { Section } from '../src/lib/boards/layout';
import {
	defaultGridLayout,
	emptyGridSpace,
	gridFits,
	isPlayerGrid,
	toPlayerGrid,
	validGridRect
} from '../src/lib/player/grid';
import { playerOptions } from '../src/lib/player/layout';

test('preset has a headerless grid, five equal controls and free space for another action', () => {
	const layout = defaultGridLayout();
	expect(isPlayerGrid(layout)).toBe(true);
	expect(layout.some(({ id }) => id === 'player-heading')).toBe(false);
	expect(layout.filter(({ grid }) => grid.y === 15).map(({ grid }) => grid.w)).toEqual([
		3, 3, 3, 3, 3
	]);
	expect(emptyGridSpace(layout, 3, 2)).toEqual({ x: 6, y: 18, w: 3, h: 2 });
	const play = layout.find(({ id }) => id === 'player-toggle')!;
	expect(gridFits(play.grid, layout)).toBe(false);
	expect(gridFits(play.grid, layout, play.id)).toBe(true);
	expect(toPlayerGrid(layout)).toEqual(layout);
	expect(toPlayerGrid(layout)[0].grid).not.toBe(layout[0].grid);
});

test('row conversion retains stacked content, relative column widths, custom text and hidden navigation', () => {
	const section = (id: string, fields: Partial<Section> = {}): Section => ({
		id,
		title: '',
		preview: true,
		...fields
	});
	const old = [
		section('player-artwork', { width: 3 }),
		section('player-text-2', {
			sameRow: true,
			width: 1,
			template: '{title} {artist}',
			maxLines: 2
		}),
		section('player-lyrics', { sameRow: true, stack: true, lyricsMode: 'sheet', padding: 7 }),
		section('player-close', { placement: 'hidden' })
	];
	const json = JSON.stringify(old);
	const converted = toPlayerGrid(old);
	expect(JSON.stringify(old)).toBe(json);
	expect(isPlayerGrid(converted)).toBe(true);
	const [art, text, lyrics] = old.slice(0, 3).map(({ id }) => converted.find((s) => s.id === id)!);
	expect(art.grid.w).toBeGreaterThan(text.grid.w);
	expect(text).toMatchObject({ template: '{title} {artist}', maxLines: 2 });
	expect(lyrics).toMatchObject({
		lyricsMode: 'sheet',
		padding: 7,
		grid: { x: text.grid.x, y: text.grid.y + text.grid.h, w: text.grid.w }
	});
	expect(converted.some(({ id }) => id === 'player-close')).toBe(false);
});

test('invalid coordinates and overlapping placements do not become an active grid', () => {
	const box = { x: 0, y: 0, w: 15, h: 20 };
	for (const invalid of [
		null,
		{},
		{ ...box, x: 1 },
		{ ...box, h: 0 },
		{ ...box, y: -1 },
		{ ...box, w: 2.5 }
	]) {
		expect(validGridRect(invalid)).toBe(false);
		expect(() => playerOptions({ grid: invalid }, true)).toThrow();
	}
	expect(playerOptions({ grid: box, iconMode: 'fill' }, true)).toEqual({
		grid: box,
		iconMode: 'fill'
	});
	const section = { title: '', preview: true, grid: box };
	expect(
		isPlayerGrid([
			{ ...section, id: 'player-artist' },
			{ ...section, id: 'player-title' }
		])
	).toBe(false);
});

test('large legacy layouts retain custom fields deterministically and reject an unrepresentable layout', () => {
	const old = Array.from({ length: 65 }, (_, i): Section => ({
		id: i ? 'player-text-' + (i + 1) : 'player-text',
		title: 'Line ' + i,
		template: 'Text {title} ' + i,
		preview: true
	}));
	const layout = toPlayerGrid(old);
	expect(isPlayerGrid(layout)).toBe(true);
	expect(toPlayerGrid(old)).toEqual(layout);
	expect(layout.map((s) => s.id)).toContain('player-close');
	expect(layout.filter((s) => s.id.startsWith('player-text')).map((s) => s.template)).toEqual(
		old.map((s) => s.template)
	);
	expect(() =>
		toPlayerGrid(
			Array.from({ length: 301 }, (_, i) => ({ ...old[0], id: 'player-text-' + (i + 2) }))
		)
	).toThrow('more items');
});
