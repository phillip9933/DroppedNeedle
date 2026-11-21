import { motionDuration } from '../appearance/interface';
import type { PullDirection } from './playerGestures';

export type PlayerSurface = 'base' | 'player' | 'queue';
type Passage = {
	from: PlayerSurface;
	to: PlayerSurface;
	direction: PullDirection;
	height: number;
};

/** Keep the same pair of screens under a finger until the pull settles or is interrupted. */
export class PanelPull {
	route = $state.raw<Passage | null>(null);
	distance = $state(0);
	private frame = 0;

	includes(surface: PlayerSurface) {
		return this.route?.from === surface || this.route?.to === surface;
	}

	start(from: PlayerSurface, to: PlayerSurface, direction: PullDirection, height: number) {
		cancelAnimationFrame(this.frame);
		if (!this.route) {
			this.route = { from, to, direction, height };
			this.distance = 0;
		}
		return this.distance;
	}

	top(surface: PlayerSurface) {
		const route = this.route;
		if (!route) return 0;
		if (route.direction === 'up' && surface === route.to) return route.height - this.distance;
		if (route.direction === 'down' && surface === route.from) return this.distance;
		return 0;
	}

	settle(commit: boolean, navigate: () => void) {
		const route = this.route;
		if (!route) return;
		cancelAnimationFrame(this.frame);
		const start = this.distance;
		const end = commit ? route.height : 0;
		const fraction = Math.min(1, Math.abs(end - start) / route.height);
		const duration = motionDuration() * Math.sqrt(fraction);
		const finish = () => {
			if (commit) navigate();
			this.clear();
		};
		if (duration < 1 || Math.abs(start - end) < 1) return finish();
		const began = performance.now();
		const step = (now: number) => {
			if (this.route !== route) return;
			const time = Math.min(1, (now - began) / duration);
			this.distance = end + (start - end) * (1 - time) ** 3;
			if (time === 1) finish();
			else this.frame = requestAnimationFrame(step);
		};
		this.frame = requestAnimationFrame(step);
	}

	clear() {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.route = null;
		this.distance = 0;
	}
}
