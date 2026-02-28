import Phaser from 'phaser';
import {
  ENEMY_BASE_SPEED,
  ENEMY_CHASE_SPEED,
  ENEMY_STUNNED_SPEED,
  VISION_RANGE,
  VISION_HALF_ANGLE_DEG,
  SEARCH_DURATION_MS,
  LOS_LOST_TIMEOUT_MS,
  POOP_STUN_DURATION_MS,
  WAYPOINT_ARRIVE_DIST,
  Rect,
} from '../constants';

export type EnemyState = 'PATROL' | 'CHASE' | 'SEARCH' | 'STUNNED';

/** Roswell's actual chase speed — exported so other entities can derive from it. */
export const ROSWELL_CHASE_SPEED = 140;

export class Enemy {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;

  private shadow: Phaser.GameObjects.Ellipse;
  private visionGraphics: Phaser.GameObjects.Graphics;
  private state: EnemyState = 'PATROL';
  private waypointIndex = 0;
  private facingAngle = 0; // radians, updated each frame by moveToward
  private lastSeenPos = new Phaser.Math.Vector2(0, 0);
  private losTimer = 0;   // ms since LOS was last maintained while in CHASE
  private searchTimer = 0; // ms remaining at last-seen position
  private stunTimer = 0;  // ms remaining in STUNNED state
  private obstacles: Rect[] = [];
  private waypoints: { x: number; y: number }[] = [];
  // Tuned speeds (~24% below imported constants for better game feel)
  private readonly patrolSpeed = 110;
  private readonly chaseSpeed  = ROSWELL_CHASE_SPEED;
  // ── Stuck detection ──────────────────────────────────────────────────────────
  private lastX = 0;
  private lastY = 0;
  private stuckTimer = 0;
  private blockedCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.shadow = scene.add.ellipse(x, y + 10, 16, 6, 0x000000, 0.22);

    this.sprite = scene.physics.add.sprite(x, y, 'roswell');
    this.sprite.setDisplaySize(58, 46);
    this.sprite.body.setSize(16, 24, true);
    this.sprite.setDepth(y);
    this.sprite.setCollideWorldBounds(true);

    this.visionGraphics = scene.add.graphics();
    // depth is set dynamically each frame in drawVisionCone()
  }

  setObstacles(obstacles: Rect[]): void {
    this.obstacles = obstacles;
  }

  setWaypoints(wps: { x: number; y: number }[]): void {
    this.waypoints = wps;
  }

  // Called by GameScene when enemy steps on a poop
  stun(): void {
    this.state = 'STUNNED';
    this.stunTimer = POOP_STUN_DURATION_MS;
  }

  getState(): EnemyState {
    return this.state;
  }

  // ── Main update ─────────────────────────────────────────────────────────────

  update(delta: number, playerX: number, playerY: number): void {
    // STUNNED overrides everything
    if (this.state === 'STUNNED') {
      this.stunTimer -= delta;
      if (this.stunTimer <= 0) {
        this.state = 'PATROL';
      }
      // Shamble slowly toward current patrol waypoint
      const wp = this.waypoints[this.waypointIndex] ?? { x: this.sprite.x, y: this.sprite.y };
      this.moveToward(wp.x, wp.y, ENEMY_STUNNED_SPEED);
      this.updateAnimAndDepth();
      this.drawVisionCone();
      return;
    }

    // Vision check
    const canSee = this.canSeePlayer(playerX, playerY);

    if (canSee) {
      this.state = 'CHASE';
      this.lastSeenPos.set(playerX, playerY);
      this.losTimer = 0;
    } else if (this.state === 'CHASE') {
      this.losTimer += delta;
      if (this.losTimer >= LOS_LOST_TIMEOUT_MS) {
        this.state = 'SEARCH';
        this.searchTimer = SEARCH_DURATION_MS;
        this.losTimer = 0;
      }
    }

    switch (this.state) {
      case 'PATROL':
        this.updatePatrol();
        break;
      case 'CHASE':
        this.moveToward(playerX, playerY, this.chaseSpeed);
        break;
      case 'SEARCH':
        this.updateSearch(delta);
        break;
    }

    this.updateStuck(delta);
    this.updateAnimAndDepth();
    this.drawVisionCone();
  }

  // ── Animation + depth helper ─────────────────────────────────────────────────

  private updateAnimAndDepth(): void {
    // Directional facing
    this.sprite.setFlipX(Math.cos(this.facingAngle) < 0);
    this.sprite.setDepth(this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + 10);
    this.shadow.setDepth(this.sprite.y - 0.5);
  }

  // ── Stuck detection ──────────────────────────────────────────────────────────

  private updateStuck(delta: number): void {
    // Periodic position snapshot: if < 2 px moved in 500 ms, unstick.
    this.stuckTimer += delta;
    if (this.stuckTimer >= 500) {
      const moved = Math.hypot(this.sprite.x - this.lastX, this.sprite.y - this.lastY);
      if (moved < 2) this.unstick();
      this.lastX = this.sprite.x;
      this.lastY = this.sprite.y;
      this.stuckTimer = 0;
    }
    // Immediate response to wall collision, rate-limited to avoid jitter.
    this.blockedCooldown = Math.max(0, this.blockedCooldown - delta);
    if (this.blockedCooldown === 0) {
      const b = this.sprite.body.blocked;
      const vel = this.sprite.body.velocity;
      if ((b.left || b.right || b.up || b.down) &&
          (Math.abs(vel.x) > 10 || Math.abs(vel.y) > 10)) {
        this.unstick();
        this.blockedCooldown = 350;
      }
    }
  }

  private unstick(): void {
    if (this.state === 'PATROL' && this.waypoints.length) {
      // Skip to the next waypoint instead of fighting the current one.
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
    } else {
      // CHASE / SEARCH: nudge in a random direction offset from current facing.
      const angle = this.facingAngle + (Math.random() - 0.5) * Math.PI;
      const spd = this.state === 'CHASE' ? this.chaseSpeed : this.patrolSpeed;
      this.sprite.setVelocity(Math.cos(angle) * spd, Math.sin(angle) * spd);
    }
  }

  // ── State handlers ──────────────────────────────────────────────────────────

  private updatePatrol(): void {
    if (!this.waypoints.length) return;
    const wp = this.waypoints[this.waypointIndex];
    const dx = wp.x - this.sprite.x;
    const dy = wp.y - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < WAYPOINT_ARRIVE_DIST) {
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
    } else {
      this.moveToward(wp.x, wp.y, this.patrolSpeed);
    }
  }

  private updateSearch(delta: number): void {
    const dx = this.lastSeenPos.x - this.sprite.x;
    const dy = this.lastSeenPos.y - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > WAYPOINT_ARRIVE_DIST) {
      this.moveToward(this.lastSeenPos.x, this.lastSeenPos.y, this.patrolSpeed);
    } else {
      // Arrived — idle and count down
      this.sprite.setVelocity(0, 0);
      this.searchTimer -= delta;
      if (this.searchTimer <= 0) {
        this.state = 'PATROL';
      }
    }
  }

  // ── Vision system ───────────────────────────────────────────────────────────

  private canSeePlayer(playerX: number, playerY: number): boolean {
    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const distSq = dx * dx + dy * dy;

    // 1. Distance check
    if (distSq > VISION_RANGE * VISION_RANGE) return false;

    // 2. Cone check — normalise angle difference to [-π, π]
    const angleToPlayer = Math.atan2(dy, dx);
    const diff = Math.atan2(
      Math.sin(angleToPlayer - this.facingAngle),
      Math.cos(angleToPlayer - this.facingAngle),
    );
    if (Math.abs(diff) > Phaser.Math.DegToRad(VISION_HALF_ANGLE_DEG)) return false;

    // 3. Line-of-sight — ray vs every obstacle rectangle
    return !this.isRayBlocked(this.sprite.x, this.sprite.y, playerX, playerY);
  }

  private isRayBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const ray = new Phaser.Geom.Line(x1, y1, x2, y2);
    for (const obs of this.obstacles) {
      const rect = new Phaser.Geom.Rectangle(obs.x, obs.y, obs.w, obs.h);
      const hits: Phaser.Geom.Point[] = [];
      Phaser.Geom.Intersects.GetLineToRectangle(ray, rect, hits);
      if (hits.length > 0) return true;
    }
    return false;
  }

  // ── Movement helper ─────────────────────────────────────────────────────────

  private moveToward(tx: number, ty: number, speed: number): void {
    const dx = tx - this.sprite.x;
    const dy = ty - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      this.sprite.setVelocity(0, 0);
      return;
    }

    this.sprite.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    this.facingAngle = Math.atan2(dy, dx);
  }

  // ── Vision cone rendering ────────────────────────────────────────────────────

  private drawVisionCone(): void {
    this.visionGraphics.clear();

    const coneColor = this.state === 'STUNNED' ? 0xff6600 : 0xffff00;
    this.visionGraphics.fillStyle(coneColor, 0.22);

    const halfAngle = Phaser.Math.DegToRad(VISION_HALF_ANGLE_DEG);
    const steps = 14;
    const pts: Phaser.Types.Math.Vector2Like[] = [
      { x: this.sprite.x, y: this.sprite.y },
    ];

    for (let i = 0; i <= steps; i++) {
      const angle = this.facingAngle - halfAngle + (2 * halfAngle * i) / steps;
      pts.push({
        x: this.sprite.x + Math.cos(angle) * VISION_RANGE,
        y: this.sprite.y + Math.sin(angle) * VISION_RANGE,
      });
    }

    this.visionGraphics.fillPoints(pts, true);
    this.visionGraphics.setDepth(this.sprite.y - 1);
  }
}
