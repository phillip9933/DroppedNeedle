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
	private navigate?: () => void;
	private committed = false;

	includes(surface: PlayerSurface) {
		return this.route?.from === surface || this.route?.to === surface;
	}

	start(from: PlayerSurface, to: PlayerSurface, direction: PullDirection, height: number) {
		cancelAnimationFrame(this.frame);
		this.committed = false;
		if (!this.route) {
			this.route = { from, to, direction, height };
			this.distance = 0;
		}
		return this.distance;
	}

	get exposure() {
		const route = this.route;
		if (!route) return 0;
		return route.direction === 'up' ? this.distance : route.height - this.distance;
	}

	top(surface: PlayerSurface) {
		const route = this.route;
		if (!route) return 0;
		const front = route.direction === 'up' ? route.to : route.from;
		if (surface === front) return route.height - this.exposure;
		if (surface === 'player') return -this.exposure;
		return 0;
	}

	settle(commit: boolean, navigate: () => void) {
		const route = this.route;
		if (!route) return;
		cancelAnimationFrame(this.frame);
		this.navigate ??= navigate;
		this.committed = commit;
		const start = this.distance;
		const end = commit ? route.height : 0;
		const fraction = Math.min(1, Math.abs(end - start) / route.height);
		const duration = motionDuration() * Math.sqrt(fraction);
		const finish = () => {
			if (!this.finishCommitted()) this.clear();
		};
		if (duration < 1 || Math.abs(start - end) < 1) return finish();
		// Mounting a custom player or a long queue can take a frame on a phone.
		// Start the release clock once the two screens are ready to paint.
		let began: number | undefined;
		const step = (now: number) => {
			if (this.route !== route) return;
			began ??= now;
			const time = Math.min(1, (now - began) / duration);
			this.distance = end + (start - end) * (1 - time) ** 3;
			if (time === 1) finish();
			else this.frame = requestAnimationFrame(step);
		};
		this.frame = requestAnimationFrame(step);
	}

	finishCommitted() {
		if (!this.route || !this.committed) return false;
		this.navigate?.();
		this.clear();
		return true;
	}

	clear() {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.navigate = undefined;
		this.committed = false;
		this.route = null;
		this.distance = 0;
	}
}
