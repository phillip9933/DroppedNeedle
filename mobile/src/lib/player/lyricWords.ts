export interface LyricPhrase {
	text: string;
	start?: number;
	end?: number;
}

// Enhanced LRC uses absolute word starts inside the text of a timed line.
// A final empty stamp ends the preceding word before the instrumental break.
export function lyricPhrases(
	text: string,
	lineStart: number | null | undefined,
	nextStart?: number
): LyricPhrase[] {
	const matcher = /<(\d{1,4}):([0-5]\d)(?:\.(\d{1,3}))?>/g;
	const pieces: LyricPhrase[] = [];
	let cursor = 0;
	let start: number | undefined = lineStart ?? undefined;
	let valid = true;
	let stamped = false;
	for (const match of text.matchAll(matcher)) {
		const time = Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || '0'));
		const chunk = text.slice(cursor, match.index);
		if ((start !== undefined && time < start) || (nextStart !== undefined && time > nextStart))
			valid = false;
		if (chunk) pieces.push({ text: chunk, start, end: time });
		start = time;
		cursor = match.index + match[0].length;
		stamped = true;
	}
	if (!stamped) return [{ text }];
	if (cursor < text.length) pieces.push({ text: text.slice(cursor), start, end: nextStart });
	return valid ? pieces : [{ text: pieces.map((piece) => piece.text).join('') }];
}
