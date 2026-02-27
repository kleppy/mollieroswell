import Phaser from 'phaser';
import { Rect } from '../constants';

export class Axol {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private shadow: Phaser.GameObjects.Ellipse;
  private alive = true;
  private scene: Phaser.Scene;
  private readonly speed = 230;
  private facingRight = true;
  // ── Stuck detection ──────────────────────────────────────────────────────────
  private lastX = 0;
  private lastY = 0;
  private stuckTimer = 0;
  private blockedCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;

    this.shadow = scene.add.ellipse(x, y + 6, 18, 6, 0x000000, 0.2);

    this.sprite = scene.physics.add.sprite(x, y, 'axol');
    this.sprite.setDisplaySize(48, 38);
    this.sprite.body.setSize(20, 14, true);
    this.sprite.setDepth(y);
    this.sprite.setCollideWorldBounds(true);

    this.smokeEffect(x, y);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setObstacles(_obstacles: Rect[]): void {
    // Reserved for future LOS use; not required for treat-seeking.
  }

  isAlive(): boolean {
    return this.alive;
  }

  /** Disappear with a puff of smoke. Safe to call more than once. */
  poof(): void {
    if (!this.alive) return;
    this.alive = false;
    const x = this.sprite.x;
    const y = this.sprite.y;
    this.sprite.destroy();
    this.shadow.destroy();
    this.smokeEffect(x, y);
  }

  update(delta: number, treatGroup: Phaser.Physics.Arcade.StaticGroup): void {
    if (!this.alive) return;

    const treats = treatGroup.getChildren() as Phaser.Physics.Arcade.Image[];
    const active = treats.filter(t => t.active);

    if (active.length === 0) {
      this.sprite.setVelocity(0, 0);
      this.updateVisuals();
      return;
    }

    // Seek the nearest treat
    let nearest: Phaser.Physics.Arcade.Image = active[0];
    let nearestDistSq = Infinity;
    for (const t of active) {
      const dx = t.x - this.sprite.x;
      const dy = t.y - this.sprite.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearest = t;
      }
    }

    this.moveToward(nearest.x, nearest.y);
    this.updateStuck(delta);
    this.updateVisuals();
  }

  // ── Movement ─────────────────────────────────────────────────────────────────

  private moveToward(tx: number, ty: number): void {
    const dx = tx - this.sprite.x;
    const dy = ty - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
      this.sprite.setVelocity(0, 0);
      return;
    }
    this.sprite.setVelocity((dx / dist) * this.speed, (dy / dist) * this.speed);
    this.facingRight = dx >= 0;
  }

  private updateVisuals(): void {
    this.sprite.setFlipX(!this.facingRight);
    this.sprite.setDepth(this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + 6);
    this.shadow.setDepth(this.sprite.y - 0.5);
  }

  // ── Stuck detection ──────────────────────────────────────────────────────────

  private updateStuck(delta: number): void {
    this.stuckTimer += delta;
    if (this.stuckTimer >= 500) {
      const moved = Math.hypot(this.sprite.x - this.lastX, this.sprite.y - this.lastY);
      if (moved < 2) this.nudge();
      this.lastX = this.sprite.x;
      this.lastY = this.sprite.y;
      this.stuckTimer = 0;
    }
    this.blockedCooldown = Math.max(0, this.blockedCooldown - delta);
    if (this.blockedCooldown === 0) {
      const b = this.sprite.body.blocked;
      const vel = this.sprite.body.velocity;
      if ((b.left || b.right || b.up || b.down) &&
          (Math.abs(vel.x) > 10 || Math.abs(vel.y) > 10)) {
        this.nudge();
        this.blockedCooldown = 350;
      }
    }
  }

  private nudge(): void {
    const vx = this.sprite.body.velocity.x;
    const vy = this.sprite.body.velocity.y;
    const base = (vx === 0 && vy === 0) ? 0 : Math.atan2(vy, vx);
    const angle = base + (Math.random() - 0.5) * Math.PI;
    this.sprite.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);
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
