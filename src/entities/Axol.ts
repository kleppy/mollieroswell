import Phaser from 'phaser';
import { Rect } from '../constants';
import { ROSWELL_CHASE_SPEED } from './Enemy';

export class Axol {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private shadow: Phaser.GameObjects.Ellipse;
  private alive = true;
  private scene: Phaser.Scene;
  private readonly speed = Math.round(ROSWELL_CHASE_SPEED * 1.01); // always 1% faster than Roswell
  private facingRight = true;
  // Tracked target — nulled immediately when the treat is collected/destroyed
  private currentTarget: Phaser.Physics.Arcade.Image | null = null;
  // Obstacle list used for embedded detection
  private obstacles: Rect[] = [];
  // Last confirmed safe (non-embedded) sprite centre; set in constructor
  private lastSafeX = 0;
  private lastSafeY = 0;
  // ── Stuck detection ──────────────────────────────────────────────────────────
  private lastX = 0;
  private lastY = 0;
  private stuckTimer = 0;
  private blockedCooldown = 0;
  // ── LOS detour state ─────────────────────────────────────────────────────────
  private detourPoint: { x: number; y: number } | null = null;
  private detourTimer = 0;
  private detourDir = 1; // +1 or -1 selects which perpendicular side to use

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;

    this.shadow = scene.add.ellipse(x, y + 6, 18, 6, 0x000000, 0.2);

    this.sprite = scene.physics.add.sprite(x, y, 'axol');
    this.sprite.setDisplaySize(48, 38);
    this.sprite.body.setSize(20, 14, true);
    this.sprite.setDepth(y);
    this.sprite.setCollideWorldBounds(true);

    this.lastSafeX = x;
    this.lastSafeY = y;
    this.smokeEffect(x, y);
  }

  setObstacles(obstacles: Rect[]): void {
    this.obstacles = obstacles;
  }

  isAlive(): boolean {
    return this.alive;
  }

  /** Disappear with a puff of smoke. Safe to call more than once. */
  poof(): void {
    if (!this.alive) return;
    this.alive = false;
    this.sprite.setVelocity(0, 0);
    this.sprite.body.enable = false; // stop physics immediately
    const x = this.sprite.x;
    const y = this.sprite.y;
    this.sprite.destroy();
    this.shadow.destroy();
    this.smokeEffect(x, y);
  }

  update(delta: number, treatGroup: Phaser.Physics.Arcade.StaticGroup): void {
    if (!this.alive) return;

    // Hard embedded check — must run before any movement logic
    if (this.obstacles.length > 0 && this.isEmbedded()) {
      this.snapToSafePosition();
    } else {
      this.lastSafeX = this.sprite.x;
      this.lastSafeY = this.sprite.y;
    }

    // Drop target if it was collected/destroyed since last frame
    if (this.currentTarget && !this.currentTarget.active) {
      this.currentTarget = null;
      this.detourPoint = null;
      this.detourTimer = 0;
    }

    // Always pick nearest when we have no target
    if (!this.currentTarget) {
      this.currentTarget = this.findNearest(treatGroup);
      this.detourPoint = null;
      this.detourTimer = 0;
    }

    if (!this.currentTarget) {
      this.sprite.setVelocity(0, 0);
      this.updateVisuals();
      return;
    }

    // LOS-aware steering: detour around obstacles if the direct path is blocked
    if (this.hasLOS(this.sprite.x, this.sprite.y, this.currentTarget.x, this.currentTarget.y)) {
      // Clear path — chase directly
      this.detourPoint = null;
      this.detourTimer = 0;
      this.steerToward(this.currentTarget.x, this.currentTarget.y);
    } else {
      // Try a different treat that has a clear path
      const alt = this.findNearestWithLOS(treatGroup);
      if (alt) {
        this.detourPoint = null;
        this.detourTimer = 0;
        this.steerToward(alt.x, alt.y);
      } else {
        // All treats blocked — side-step around the obstacle
        this.updateDetour(delta);
      }
    }
    this.updateStuck(delta);
    this.updateVisuals();
  }

  // ── Movement ─────────────────────────────────────────────────────────────────

  /** Set velocity toward (tx, ty) with an optional angle offset in radians. */
  private steerToward(tx: number, ty: number, angleOffset = 0): void {
    const dx = tx - this.sprite.x;
    const dy = ty - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
      this.sprite.setVelocity(0, 0);
      return;
    }
    const angle = Math.atan2(dy, dx) + angleOffset;
    this.sprite.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);
    this.facingRight = Math.cos(angle) >= 0;
  }

  private findNearest(treatGroup: Phaser.Physics.Arcade.StaticGroup): Phaser.Physics.Arcade.Image | null {
    const treats = treatGroup.getChildren() as Phaser.Physics.Arcade.Image[];
    let nearest: Phaser.Physics.Arcade.Image | null = null;
    let nearestDistSq = Infinity;
    for (const t of treats) {
      if (!t.active) continue;
      const dx = t.x - this.sprite.x;
      const dy = t.y - this.sprite.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearest = t;
      }
    }
    return nearest;
  }

  private updateVisuals(): void {
    this.sprite.setFlipX(!this.facingRight);
    this.sprite.setDepth(this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + 6);
    this.shadow.setDepth(this.sprite.y - 0.5);
  }

  // ── Stuck detection ──────────────────────────────────────────────────────────

  private updateStuck(delta: number): void {
    // Periodic snapshot: if < 2 px moved in 450 ms while chasing a target, unstick.
    this.stuckTimer += delta;
    if (this.stuckTimer >= 450) {
      const moved = Math.hypot(this.sprite.x - this.lastX, this.sprite.y - this.lastY);
      if (moved < 2 && this.currentTarget) {
        // ±30° offset from direct line to target
        const offset = (Math.random() - 0.5) * (Math.PI / 3);
        this.steerToward(this.currentTarget.x, this.currentTarget.y, offset);
      }
      this.lastX = this.sprite.x;
      this.lastY = this.sprite.y;
      this.stuckTimer = 0;
    }

    // Immediate response to wall collision; rate-limited to avoid jitter.
    this.blockedCooldown = Math.max(0, this.blockedCooldown - delta);
    if (this.blockedCooldown === 0) {
      const b = this.sprite.body.blocked;
      const vel = this.sprite.body.velocity;
      if ((b.left || b.right || b.up || b.down) &&
          (Math.abs(vel.x) > 10 || Math.abs(vel.y) > 10)) {
        this.nudgeAwayFromWall();
        this.blockedCooldown = 300;
      }
    }
  }

  /**
   * Push the physics body 3 px away from the blocked side, then re-steer
   * toward the current target with a ±30° random offset.
   */
  private nudgeAwayFromWall(): void {
    const b = this.sprite.body.blocked;
    const PUSH = 3;
    let nx = this.sprite.x;
    let ny = this.sprite.y;
    if (b.left)  nx += PUSH;
    if (b.right) nx -= PUSH;
    if (b.up)    ny += PUSH;
    if (b.down)  ny -= PUSH;
    // body.reset moves the physics body to the new position and zeroes velocity
    this.sprite.body.reset(nx, ny);

    if (this.currentTarget) {
      const offset = (Math.random() - 0.5) * (Math.PI / 3);
      this.steerToward(this.currentTarget.x, this.currentTarget.y, offset);
    }
  }

  // ── LOS and detour ───────────────────────────────────────────────────────────

  /** Nearest active treat that Axol can see without any obstacle in the way. */
  private findNearestWithLOS(treatGroup: Phaser.Physics.Arcade.StaticGroup): Phaser.Physics.Arcade.Image | null {
    const treats = treatGroup.getChildren() as Phaser.Physics.Arcade.Image[];
    let nearest: Phaser.Physics.Arcade.Image | null = null;
    let nearestDistSq = Infinity;
    for (const t of treats) {
      if (!t.active) continue;
      if (!this.hasLOS(this.sprite.x, this.sprite.y, t.x, t.y)) continue;
      const dx = t.x - this.sprite.x;
      const dy = t.y - this.sprite.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < nearestDistSq) { nearestDistSq = dSq; nearest = t; }
    }
    return nearest;
  }

  /** True if the segment (ax,ay)→(tx,ty) does not clip any obstacle rect. */
  private hasLOS(ax: number, ay: number, tx: number, ty: number): boolean {
    const INF = 4; // small inflation so tight corners still trigger a detour
    for (const r of this.obstacles) {
      if (this.segmentIntersectsAABB(
            ax, ay, tx, ty,
            r.x - INF, r.y - INF, r.x + r.w + INF, r.y + r.h + INF)) {
        return false;
      }
    }
    return true;
  }

  /** Liang-Barsky segment vs axis-aligned box intersection. */
  private segmentIntersectsAABB(
    x1: number, y1: number, x2: number, y2: number,
    left: number, top: number, right: number, bottom: number,
  ): boolean {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const checks: [number, number][] = [
      [-dx, x1 - left], [dx, right  - x1],
      [-dy, y1 - top],  [dy, bottom - y1],
    ];
    for (const [p, q] of checks) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else       t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return true;
  }

  /** Advance detour mode: recompute detour point when needed; steer toward it. */
  private updateDetour(delta: number): void {
    this.detourTimer += delta;
    const arrived = this.detourPoint !== null &&
      Math.hypot(this.sprite.x - this.detourPoint.x,
                 this.sprite.y - this.detourPoint.y) < 24;
    if (!this.detourPoint || arrived || this.detourTimer > 700) {
      this.computeDetourPoint();
      this.detourTimer = 0;
    }
    if (this.detourPoint) {
      this.steerToward(this.detourPoint.x, this.detourPoint.y);
    }
  }

  /**
   * Compute a perpendicular side-step point to bypass the blocked obstacle.
   * Tries both perp directions and picks the one that is walkable; flips if needed.
   */
  private computeDetourPoint(): void {
    if (!this.currentTarget) { this.detourPoint = null; return; }
    const dx = this.currentTarget.x - this.sprite.x;
    const dy = this.currentTarget.y - this.sprite.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) { this.detourPoint = null; return; }

    const px = -dy / len; // perpendicular unit vector
    const py =  dx / len;
    const D = 110;

    const c1 = { x: this.sprite.x + px * D,  y: this.sprite.y + py * D  };
    const c2 = { x: this.sprite.x - px * D,  y: this.sprite.y - py * D  };
    const ok1 = this.isSafePosition(c1.x, c1.y);
    const ok2 = this.isSafePosition(c2.x, c2.y);

    // Favour current direction; flip only when current side becomes blocked
    if (this.detourDir === 1 && ok1) {
      this.detourPoint = c1;
    } else if (ok2) {
      this.detourDir = -1;
      this.detourPoint = c2;
    } else if (ok1) {
      this.detourDir = 1;
      this.detourPoint = c1;
    } else {
      // Both perps blocked; push further out as a last resort
      this.detourPoint = { x: this.sprite.x + px * 160, y: this.sprite.y + py * 160 };
    }
  }

  // ── Embedded detection & correction ─────────────────────────────────────────

  /** Returns true if Axol's physics body overlaps any obstacle rect. */
  private isEmbedded(): boolean {
    const bx = this.sprite.body.x;
    const by = this.sprite.body.y;
    const bw = this.sprite.body.width;
    const bh = this.sprite.body.height;
    for (const r of this.obstacles) {
      if (bx < r.x + r.w && bx + bw > r.x &&
          by < r.y + r.h && by + bh > r.y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns true if placing Axol's centre at (cx, cy) produces no overlap
   * with any obstacle and stays inside world bounds.
   */
  private isSafePosition(cx: number, cy: number): boolean {
    const hw = this.sprite.body.halfWidth;
    const hh = this.sprite.body.halfHeight;
    const bx = cx - hw;
    const by = cy - hh;
    const bw = hw * 2;
    const bh = hh * 2;
    const wb = this.scene.physics.world.bounds;
    if (bx < wb.x || bx + bw > wb.x + wb.width ||
        by < wb.y || by + bh > wb.y + wb.height) {
      return false;
    }
    for (const r of this.obstacles) {
      if (bx < r.x + r.w && bx + bw > r.x &&
          by < r.y + r.h && by + bh > r.y) {
        return false;
      }
    }
    return true;
  }

  /**
   * Teleport Axol to a safe position: try lastSafe first, then spiral outward.
   * Uses body.reset() so the physics body is repositioned in the same call.
   */
  private snapToSafePosition(): void {
    this.sprite.setVelocity(0, 0);

    // Fastest path: snap straight back to last confirmed safe position
    if (this.isSafePosition(this.lastSafeX, this.lastSafeY)) {
      this.sprite.body.reset(this.lastSafeX, this.lastSafeY);
      return;
    }

    // Spiral search outward from current position
    const STEP = 16;
    const MAX_R = 300;
    const ANGLE_STEPS = 16; // 22.5° increments
    for (let r = STEP; r <= MAX_R; r += STEP) {
      for (let i = 0; i < ANGLE_STEPS; i++) {
        const angle = (i / ANGLE_STEPS) * Math.PI * 2;
        const cx = this.sprite.x + Math.cos(angle) * r;
        const cy = this.sprite.y + Math.sin(angle) * r;
        if (this.isSafePosition(cx, cy)) {
          this.sprite.body.reset(cx, cy);
          this.lastSafeX = cx;
          this.lastSafeY = cy;
          return;
        }
      }
    }
  }

  // ── Smoke effect ─────────────────────────────────────────────────────────────

  private smokeEffect(x: number, y: number): void {
    const gfx = this.scene.add.graphics();
    gfx.setDepth(9999);
    const obj = { progress: 0 };
    this.scene.tweens.add({
      targets: obj,
      progress: 1,
      duration: 450,
      ease: 'Sine.Out',
      onUpdate: () => {
        const p = obj.progress;
        gfx.clear();
        gfx.fillStyle(0xddddff, 0.75 * (1 - p));
        gfx.fillCircle(x, y, 24 * p);
        gfx.fillStyle(0xbbbbee, 0.5 * (1 - p));
        gfx.fillCircle(x - 12 * p, y - 8 * p, 16 * p);
        gfx.fillCircle(x + 14 * p, y - 5 * p, 14 * p);
      },
      onComplete: () => {
        gfx.destroy();
      },
    });
  }
}
