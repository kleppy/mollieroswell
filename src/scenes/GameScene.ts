import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Axol } from '../entities/Axol';
import { UI } from '../ui/UI';
import { AudioManager } from '../audio/AudioManager';
import {
  LEVELS,
  LevelConfig,
  Rect,
  VISION_RANGE,
} from '../constants';

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemy!: Enemy;
  private enemy2: Enemy | null = null; // Level 3 + Level 4
  private enemy3: Enemy | null = null; // Level 4 only (third Roswell)
  private axol: Axol | null = null;
  private ui!: UI;
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private furnitureGroup!: Phaser.Physics.Arcade.StaticGroup;
  private treatGroup!: Phaser.Physics.Arcade.StaticGroup;
  private pinkTreatGroup!: Phaser.Physics.Arcade.StaticGroup;
  private isGameOver = false;
  private levelNum = 1;
  private cfg!: LevelConfig;
  private audioManager!: AudioManager;
  /** ms until next bark; initialised on level start. */
  private barkTimer = 0;
  private bgMusic: Phaser.Sound.BaseSound | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  preload(): void {
    this.load.image('mollie', '/assets/mollie.png');
    this.load.image('roswell', '/assets/roswell.png');
    this.load.image('axol', '/assets/axol.png');
    // Required file: public/assets/sfx/crunch.mp3 (or .ogg)
    this.load.audio('crunch', ['/assets/sfx/crunch.mp3', '/assets/sfx/crunch.ogg']);
    // Roswell bark SFX
    this.load.audio('roswell-bark', '/assets/dogbark.wav');
    // Per-level background music (levels 2–4)
    this.load.audio('bg-l2', '/assets/poollevel.mp3');
    this.load.audio('bg-l3', '/assets/cityparklevel.wav');
    this.load.audio('bg-l4', '/assets/citylevel.wav');
  }

  init(data: { level?: number }): void {
    this.levelNum = data?.level ?? 1;
  }

  create(): void {
    this.isGameOver = false;
    this.axol = null;
    this.cfg = LEVELS[this.levelNum - 1];

    this.physics.world.setBounds(0, 0, this.cfg.worldWidth, this.cfg.worldHeight);

    this.buildTilemap();
    this.buildLevelTextures();
    this.buildDecoratives();

    this.wallGroup = this.physics.add.staticGroup();
    this.furnitureGroup = this.physics.add.staticGroup();
    this.treatGroup = this.physics.add.staticGroup();
    this.pinkTreatGroup = this.physics.add.staticGroup();

    this.buildWalls();
    this.buildFurniture();
    this.buildTreats();
    this.buildPinkTreat();

    this.player = new Player(this, this.cfg.playerStart.x, this.cfg.playerStart.y);
    this.enemy  = new Enemy(this, this.cfg.enemyStart.x,  this.cfg.enemyStart.y);
    this.enemy2 = null;
    this.enemy3 = null;

    const allObstacles: Rect[] = [
      ...this.cfg.walls,
      ...this.cfg.furniture.map(f => f.rect),
    ];
    this.enemy.setObstacles(allObstacles);
    this.enemy.setWaypoints(this.cfg.patrolWaypoints);

    // Level 3: spawn a second Roswell on the east side of the park.
    if (this.levelNum === 3) {
      this.enemy2 = new Enemy(this, 1150, 500);
      this.enemy2.setObstacles(allObstacles);
      this.enemy2.setWaypoints(this.cfg.patrolWaypoints);
    }

    // Level 4: two extra Roswells patrolling different city zones.
    if (this.levelNum === 4) {
      this.enemy2 = new Enemy(this, 200, 250);   // NW — near building A
      this.enemy2.setObstacles(allObstacles);
      this.enemy2.setWaypoints(this.cfg.patrolWaypoints);

      this.enemy3 = new Enemy(this, 1000, 700);  // SE — near building F
      this.enemy3.setObstacles(allObstacles);
      this.enemy3.setWaypoints(this.cfg.patrolWaypoints);
    }

    this.wireCollisions();

    this.cameras.main
      .startFollow(this.player.sprite, true, 0.1, 0.1)
      .setBounds(0, 0, this.cfg.worldWidth, this.cfg.worldHeight);

    // ── Audio setup ──────────────────────────────────────────────────────
    const webAudioCtx = (this.sound as Phaser.Sound.WebAudioSoundManager).context as AudioContext | undefined;
    if (webAudioCtx) {
      this.audioManager = new AudioManager(webAudioCtx);
      this.audioManager.setBgFreq(this.cfg.audioFrequency);
      // If the previous mute state was "on", restore it (stored as scene data).
      if (this.data?.get('muted') === true) {
        this.audioManager.toggleMute();
        this.sound.mute = true;  // also mute Phaser sounds (bark + music)
      }
    }

    // Per-level background music (levels 2–4 use real audio files; level 1 keeps white-noise).
    const bgMusicKey = this.levelNum === 2 ? 'bg-l2'
                     : this.levelNum === 3 ? 'bg-l3'
                     : this.levelNum === 4 ? 'bg-l4'
                     : null;
    if (bgMusicKey && this.cache.audio.exists(bgMusicKey)) {
      this.bgMusic = this.sound.add(bgMusicKey, { loop: true, volume: 0.4 });
      this.bgMusic.play();
    }

    this.ui = new UI(this, this.levelNum, LEVELS.length, this.cfg.totalTreats, () => {
      const muted = this.audioManager?.toggleMute() ?? false;
      this.sound.mute = muted;  // sync Phaser sounds (bark WAV + bg music)
      // Persist mute state across scene restarts via Phaser data manager.
      this.data.set('muted', muted);
      return muted;
    });

    // Initial bark offset so Roswell doesn't bark the instant a level starts.
    this.barkTimer = 2000 + Math.random() * 2000;

    // Stop audio when the scene shuts down (restart or transition).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.audioManager?.stop();
      this.bgMusic?.destroy();
      this.bgMusic = null;
    });

    console.assert(
      this.treatGroup.getChildren().length === this.cfg.totalTreats,
      `Treat count mismatch: expected ${this.cfg.totalTreats}, got ${this.treatGroup.getChildren().length}`,
    );
  }

  update(_time: number, delta: number): void {
    if (this.isGameOver) return;

    this.player.update();

    // Enemies prefer chasing Axol when she is within vision range
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const axolActive = this.axol?.isAlive() ?? false;
    const getTarget = (ex: number, ey: number) => {
      if (axolActive) {
        const dax = this.axol!.sprite.x - ex;
        const day = this.axol!.sprite.y - ey;
        if (Math.hypot(dax, day) < VISION_RANGE) {
          return { x: this.axol!.sprite.x, y: this.axol!.sprite.y };
        }
      }
      return { x: px, y: py };
    };
    const t1 = getTarget(this.enemy.sprite.x, this.enemy.sprite.y);
    this.enemy.update(delta, t1.x, t1.y);
    if (this.enemy2) {
      const t2 = getTarget(this.enemy2.sprite.x, this.enemy2.sprite.y);
      this.enemy2.update(delta, t2.x, t2.y);
    }
    if (this.enemy3) {
      const t3 = getTarget(this.enemy3.sprite.x, this.enemy3.sprite.y);
      this.enemy3.update(delta, t3.x, t3.y);
    }
    this.axol?.update(delta, this.treatGroup);

    this.ui.update(this.player.getTreatCount(), this.player.getPoopCharges());

    if (this.audioManager) {
      this.updateBark(delta);
      const vel = this.player.sprite.body.velocity;
      this.audioManager.updatePant(Math.hypot(vel.x, vel.y) > 10, delta);
    }
  }

  private updateBark(delta: number): void {
    this.barkTimer -= delta;
    if (this.barkTimer > 0) return;

    // Use the closer enemy for volume; use whichever is chasing for interval.
    const dx1 = this.enemy.sprite.x - this.player.sprite.x;
    const dy1 = this.enemy.sprite.y - this.player.sprite.y;
    let dist = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    let state = this.enemy.getState();
    if (this.enemy2) {
      const dx2 = this.enemy2.sprite.x - this.player.sprite.x;
      const dy2 = this.enemy2.sprite.y - this.player.sprite.y;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (dist2 < dist) { dist = dist2; }
      if (this.enemy2.getState() === 'CHASE') { state = 'CHASE'; }
    }
    if (this.enemy3) {
      const dx3 = this.enemy3.sprite.x - this.player.sprite.x;
      const dy3 = this.enemy3.sprite.y - this.player.sprite.y;
      const dist3 = Math.sqrt(dx3 * dx3 + dy3 * dy3);
      if (dist3 < dist) { dist = dist3; }
      if (this.enemy3.getState() === 'CHASE') { state = 'CHASE'; }
    }
    // Play real bark WAV (distance-attenuated); fall back to synth if not loaded.
    if (this.cache.audio.exists('roswell-bark')) {
      const maxDist = 500;
      const vol = (1 - Math.min(dist / maxDist, 1) * 0.85) * 0.55;
      if (vol > 0.002) this.sound.play('roswell-bark', { volume: vol });
    } else {
      this.audioManager.playBark(dist);
    }

    // Bark interval: Chase = very frequent, Patrol = occasional, else rare.
    const interval =
      state === 'CHASE'   ? 900  + Math.random() * 700  :
      state === 'PATROL'  ? 3500 + Math.random() * 2000 :
      state === 'SEARCH'  ? 4000 + Math.random() * 2000 :
      /* STUNNED */         7000 + Math.random() * 3000;
    this.barkTimer = interval;
  }

  // ── Map construction ────────────────────────────────────────────────────────

  private buildTilemap(): void {
    const tilesetKey = `ground-tileset-L${this.levelNum}`;
    this.ensureTexture(tilesetKey, 128, 32, (gfx) => this.drawTilesetForLevel(gfx));

    const TILE = 32;
    const mapW = Math.ceil(this.cfg.worldWidth  / TILE);
    const mapH = Math.ceil(this.cfg.worldHeight / TILE);

    const mapData: number[][] = [];
    for (let row = 0; row < mapH; row++) {
      const rowData: number[] = [];
      for (let col = 0; col < mapW; col++) {
        rowData.push(this.cfg.tilePainter(row, col));
      }
      mapData.push(rowData);
    }

    const tilemap = this.make.tilemap({ data: mapData, tileWidth: TILE, tileHeight: TILE });
    const tileset = tilemap.addTilesetImage('tiles', tilesetKey, TILE, TILE, 0, 0, 1);
    if (tileset) {
      tilemap.createLayer(0, tileset, 0, 0)?.setDepth(0);
    }
  }

  private drawTilesetForLevel(gfx: Phaser.GameObjects.Graphics): void {
    switch (this.levelNum) {
      case 1: this.drawTilesetHouse(gfx);    break;
      case 2: this.drawTilesetWaterPark(gfx); break;
      case 3: this.drawTilesetPark(gfx);     break;
      case 4: this.drawTilesetCity(gfx);     break;
      default: this.drawTilesetHouse(gfx);   break;
    }
  }

  private drawTilesetHouse(gfx: Phaser.GameObjects.Graphics): void {
    // ── Tile 0 (data 1): Grass yard — layered blades + wildflowers ───────────
    gfx.fillStyle(0x3d6b27); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0x356020);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0x477530);
    gfx.fillRect(16, 0, 16, 16); gfx.fillRect(0, 16, 16, 16);
    // Primary blades
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(c * 8 + (r % 2) * 3, r * 8 + 1, 2, 5);
        gfx.fillRect(c * 8 + 5 - (r % 2) * 2, r * 8 + 3, 1, 4);
      }
    // Bright accent blades
    gfx.fillStyle(0x72a840);
    gfx.fillRect(3, 6, 1, 4); gfx.fillRect(19, 14, 1, 5);
    gfx.fillRect(11, 22, 1, 4); gfx.fillRect(26, 7, 1, 5);
    gfx.fillRect(7, 28, 1, 3); gfx.fillRect(23, 2, 1, 4);
    // Dark undergrass (base shadow)
    gfx.fillStyle(0x284d18);
    gfx.fillRect(0, 30, 32, 2);
    // Tiny wildflowers + clover
    gfx.fillStyle(0xffff80); gfx.fillRect(5, 10, 2, 2);
    gfx.fillStyle(0xffffff); gfx.fillRect(22, 24, 2, 2);
    gfx.fillStyle(0xff99aa); gfx.fillRect(14, 18, 2, 2);
    gfx.fillStyle(0xffee55); gfx.fillRect(28, 20, 1, 1);
    gfx.fillStyle(0x88dd44); gfx.fillRect(9, 29, 1, 1); gfx.fillRect(17, 5, 1, 1);

    // ── Tile 1 (data 2): Living-room hardwood — varied plank tones + knots ───
    gfx.fillStyle(0xc8a060); gfx.fillRect(32, 0, 32, 32);
    // Plank row dividers
    gfx.fillStyle(0x906040);
    for (let i = 0; i < 4; i++) gfx.fillRect(32, i * 8, 32, 1);
    // Alternating plank tones
    gfx.fillStyle(0xd4b068); gfx.fillRect(32, 1, 18, 7);
    gfx.fillStyle(0xba9450); gfx.fillRect(50, 1, 14, 7);
    gfx.fillStyle(0xd0a860); gfx.fillRect(32, 9, 22, 7);
    gfx.fillStyle(0xb89050); gfx.fillRect(54, 9, 10, 7);
    gfx.fillStyle(0xc49058); gfx.fillRect(32, 17, 13, 7);
    gfx.fillStyle(0xd8b46e); gfx.fillRect(45, 17, 19, 7);
    gfx.fillStyle(0xbea060); gfx.fillRect(32, 25, 19, 7);
    gfx.fillStyle(0xd0aa68); gfx.fillRect(51, 25, 13, 7);
    // Grain highlight streaks
    gfx.fillStyle(0xe8c880);
    gfx.fillRect(34, 3, 12, 1); gfx.fillRect(51, 5, 10, 1);
    gfx.fillRect(36, 11, 17, 1); gfx.fillRect(55, 13, 8, 1);
    gfx.fillRect(33, 19, 9, 1); gfx.fillRect(47, 21, 13, 1);
    gfx.fillRect(36, 27, 14, 1); gfx.fillRect(53, 29, 9, 1);
    // Plank end-grain joins
    gfx.fillStyle(0x886030);
    gfx.fillRect(49, 1, 1, 7); gfx.fillRect(41, 9, 1, 7);
    gfx.fillRect(57, 17, 1, 7); gfx.fillRect(44, 25, 1, 7);
    // Knot details (dark oval + inner highlight)
    gfx.fillStyle(0x7a5030);
    gfx.fillRect(39, 3, 3, 2); gfx.fillRect(58, 18, 3, 2); gfx.fillRect(43, 27, 2, 2);
    gfx.fillStyle(0x9a6848);
    gfx.fillRect(40, 4, 1, 1); gfx.fillRect(59, 19, 1, 1);

    // ── Tile 2 (data 3): Kitchen ceramic — bevel shading per tile ────────────
    gfx.fillStyle(0xe0d8c8); gfx.fillRect(64, 0, 32, 32);
    // Grout lines
    gfx.fillStyle(0xa8a09a);
    for (let i = 0; i <= 4; i++) gfx.fillRect(64, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(64 + j * 8, 0, 1, 32);
    // Tile face
    gfx.fillStyle(0xddd5c5);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        gfx.fillRect(64 + c * 8 + 1, r * 8 + 1, 7, 7);
    // Top-left highlight bevel
    gfx.fillStyle(0xf0e8d8);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(64 + c * 8 + 1, r * 8 + 1, 7, 1);
        gfx.fillRect(64 + c * 8 + 1, r * 8 + 1, 1, 7);
      }
    // Bottom-right shadow bevel
    gfx.fillStyle(0xb8b0a0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(64 + c * 8 + 1, r * 8 + 7, 7, 1);
        gfx.fillRect(64 + c * 8 + 7, r * 8 + 1, 1, 7);
      }

    // ── Tile 3 (data 4): Hallway — light maple hardwood ──────────────────────
    gfx.fillStyle(0xdab87c); gfx.fillRect(96, 0, 32, 32); // base maple tone
    // Plank row dividers
    gfx.fillStyle(0xb8904c);
    for (let i = 0; i <= 4; i++) gfx.fillRect(96, i * 8, 32, 1);
    // Alternating plank tones
    gfx.fillStyle(0xe8c888); gfx.fillRect(96, 1, 20, 7);
    gfx.fillStyle(0xc8a060); gfx.fillRect(116, 1, 12, 7);
    gfx.fillStyle(0xd4b070); gfx.fillRect(96, 9, 14, 7);
    gfx.fillStyle(0xeacc90); gfx.fillRect(110, 9, 18, 7);
    gfx.fillStyle(0xdcc07c); gfx.fillRect(96, 17, 22, 7);
    gfx.fillStyle(0xc8a458); gfx.fillRect(118, 17, 10, 7);
    gfx.fillStyle(0xe2ba78); gfx.fillRect(96, 25, 17, 7);
    gfx.fillStyle(0xceac68); gfx.fillRect(113, 25, 15, 7);
    // Grain highlights
    gfx.fillStyle(0xf4d898);
    gfx.fillRect(98, 3, 14, 1); gfx.fillRect(118, 5, 8, 1);
    gfx.fillRect(97, 11, 11, 1); gfx.fillRect(112, 13, 13, 1);
    gfx.fillRect(99, 19, 18, 1); gfx.fillRect(120, 21, 6, 1);
    gfx.fillRect(98, 27, 12, 1); gfx.fillRect(114, 29, 10, 1);
    // Plank end-grain joins
    gfx.fillStyle(0xa07840);
    gfx.fillRect(115, 1, 1, 7); gfx.fillRect(109, 9, 1, 7);
    gfx.fillRect(117, 17, 1, 7); gfx.fillRect(112, 25, 1, 7);
    // Knot detail
    gfx.fillStyle(0x9a7038); gfx.fillRect(104, 4, 3, 2);
    gfx.fillStyle(0xb88850); gfx.fillRect(105, 5, 1, 1);
  }

  private drawTilesetWaterPark(gfx: Phaser.GameObjects.Graphics): void {
    // ── Tile 0 (data 1): Concrete deck — expansion joints + aggregate ────────
    gfx.fillStyle(0xd8cdb8); gfx.fillRect(0, 0, 32, 32);
    // Slight colour variation patches
    gfx.fillStyle(0xd2c8b2);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0xddd2bc);
    gfx.fillRect(16, 0, 16, 16); gfx.fillRect(0, 16, 16, 16);
    // Expansion joint lines
    gfx.fillStyle(0xb8ac9a);
    for (let i = 0; i <= 4; i++) gfx.fillRect(0, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(j * 8, 0, 1, 32);
    // Aggregate specks
    gfx.fillStyle(0xc0b5a2);
    gfx.fillRect(5, 3, 1, 1); gfx.fillRect(19, 11, 1, 1); gfx.fillRect(12, 22, 1, 1);
    gfx.fillRect(27, 5, 1, 1); gfx.fillRect(3, 26, 1, 1); gfx.fillRect(24, 29, 1, 1);
    // Wet drain streak
    gfx.fillStyle(0xc8bfae);
    gfx.fillRect(14, 0, 4, 8);

    // ── Tile 1 (data 2): Worn concrete — scuff marks + puddle sheen ──────────
    gfx.fillStyle(0xd8cdb8); gfx.fillRect(32, 0, 32, 32);
    gfx.fillStyle(0xb8ac9a);
    for (let i = 0; i <= 4; i++) gfx.fillRect(32, i * 8, 32, 1);
    // Scuff/wear marks
    gfx.fillStyle(0xc4b8a6);
    gfx.fillRect(35, 3, 6, 2); gfx.fillRect(46, 14, 4, 2); gfx.fillRect(54, 25, 5, 2);
    // Puddle sheen (slight blue tint)
    gfx.fillStyle(0xc8d4d8);
    gfx.fillRect(37, 18, 8, 5);
    // More aggregate
    gfx.fillStyle(0xbfb4a1);
    gfx.fillRect(40, 6, 1, 1); gfx.fillRect(52, 21, 1, 1); gfx.fillRect(34, 28, 1, 1);

    // ── Tile 2 (data 3): Sandy border — grain texture ────────────────────────
    gfx.fillStyle(0xe8d898); gfx.fillRect(64, 0, 32, 32);
    // Sand grain patches
    gfx.fillStyle(0xd8c880);
    for (let i = 0; i < 3; i++) {
      gfx.fillRect(64 + i * 11, 4, 8, 6);
      gfx.fillRect(64 + i * 11 + 5, 16, 6, 5);
    }
    // Fine grain specks
    gfx.fillStyle(0xc8b870);
    gfx.fillRect(66, 2, 1, 1); gfx.fillRect(74, 9, 1, 1); gfx.fillRect(83, 3, 1, 1);
    gfx.fillRect(68, 20, 1, 1); gfx.fillRect(80, 27, 1, 1); gfx.fillRect(90, 18, 1, 1);
    // Bright sand highlights
    gfx.fillStyle(0xf8eaaa);
    gfx.fillRect(70, 12, 2, 1); gfx.fillRect(85, 22, 2, 1);
    // Dark shadow near edge
    gfx.fillStyle(0xb8a860);
    gfx.fillRect(64, 30, 32, 2);

    // ── Tile 3 (data 4): Grass border — blades + flowers ─────────────────────
    gfx.fillStyle(0x3d6b27); gfx.fillRect(96, 0, 32, 32);
    gfx.fillStyle(0x356020);
    gfx.fillRect(96, 0, 16, 16); gfx.fillRect(112, 16, 16, 16);
    gfx.fillStyle(0x477530);
    gfx.fillRect(112, 0, 16, 16); gfx.fillRect(96, 16, 16, 16);
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(96 + c * 8 + (r % 2) * 3, r * 8 + 1, 2, 5);
        gfx.fillRect(96 + c * 8 + 5 - (r % 2) * 2, r * 8 + 3, 1, 3);
      }
    gfx.fillStyle(0xffff80); gfx.fillRect(101, 10, 2, 2);
    gfx.fillStyle(0x284d18); gfx.fillRect(96, 30, 32, 2);
  }

  private drawTilesetPark(gfx: Phaser.GameObjects.Graphics): void {
    // ── Tile 0 (data 1): Park grass — rich multi-tone + clover + daisies ─────
    gfx.fillStyle(0x3d6b27); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0x356020);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0x477530);
    gfx.fillRect(16, 0, 16, 16); gfx.fillRect(0, 16, 16, 16);
    // Primary blades
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(c * 8 + (r % 2) * 3, r * 8 + 1, 2, 5);
        gfx.fillRect(c * 8 + 5 - (r % 2) * 2, r * 8 + 3, 1, 3);
      }
    // Accent blades
    gfx.fillStyle(0x70a040);
    gfx.fillRect(2, 7, 1, 4); gfx.fillRect(25, 3, 1, 5); gfx.fillRect(13, 25, 1, 4);
    // Wildflowers: daisy, dandelion, clover
    gfx.fillStyle(0xffff80); gfx.fillRect(5, 10, 2, 2);
    gfx.fillStyle(0xffffff); gfx.fillRect(22, 24, 2, 2);
    gfx.fillStyle(0xff99cc); gfx.fillRect(14, 18, 2, 2);
    gfx.fillStyle(0x80dd40); gfx.fillRect(28, 14, 1, 1); gfx.fillRect(9, 29, 1, 1);
    // Bottom edge shadow
    gfx.fillStyle(0x284d18); gfx.fillRect(0, 30, 32, 2);

    // ── Tile 1 (data 2): Dirt path — packed earth + pebbles + track marks ────
    gfx.fillStyle(0xc8a870); gfx.fillRect(32, 0, 32, 32);
    // Packed-earth tone variation
    gfx.fillStyle(0xb8986a);
    gfx.fillRect(32, 0, 16, 16); gfx.fillRect(48, 16, 16, 16);
    gfx.fillStyle(0xd4b07a);
    gfx.fillRect(48, 0, 16, 16); gfx.fillRect(32, 16, 16, 16);
    // Rut lines (worn track)
    gfx.fillStyle(0xa08050);
    gfx.fillRect(32, 9, 32, 1); gfx.fillRect(32, 21, 32, 1);
    // Pebble suggestions
    gfx.fillStyle(0x987848);
    gfx.fillRect(36, 4, 2, 2); gfx.fillRect(44, 15, 2, 2); gfx.fillRect(55, 6, 2, 2);
    gfx.fillRect(38, 26, 2, 2); gfx.fillRect(52, 28, 2, 2); gfx.fillRect(48, 3, 1, 1);
    // Light earth highlights
    gfx.fillStyle(0xdcba88);
    gfx.fillRect(35, 3, 7, 2); gfx.fillRect(50, 13, 5, 2);
    gfx.fillRect(40, 24, 9, 2); gfx.fillRect(56, 19, 6, 2);

    // ── Tile 2 (data 3): Flowerbed — rich dark soil + varied blooms ───────────
    gfx.fillStyle(0x2e1e10); gfx.fillRect(64, 0, 32, 32);
    // Soil variation
    gfx.fillStyle(0x3a2818);
    gfx.fillRect(64, 0, 16, 16); gfx.fillRect(80, 16, 16, 16);
    gfx.fillStyle(0x442e1c);
    gfx.fillRect(80, 0, 16, 16); gfx.fillRect(64, 16, 16, 16);
    // Green foliage stems
    gfx.fillStyle(0x40cc40);
    gfx.fillRect(66, 2, 1, 5); gfx.fillRect(70, 7, 1, 4);
    gfx.fillRect(79, 12, 1, 5); gfx.fillRect(85, 4, 1, 4);
    gfx.fillRect(74, 20, 1, 5); gfx.fillRect(90, 17, 1, 4);
    gfx.fillRect(67, 26, 1, 4); gfx.fillRect(83, 24, 1, 4);
    // Blooms: red, yellow, pink, white, purple
    gfx.fillStyle(0xff4040); gfx.fillCircle(68, 4, 2); gfx.fillCircle(76, 8, 2);
    gfx.fillStyle(0xffee40); gfx.fillCircle(72, 14, 2); gfx.fillCircle(84, 6, 2);
    gfx.fillStyle(0xff80ff); gfx.fillCircle(80, 18, 2); gfx.fillCircle(68, 20, 2);
    gfx.fillStyle(0xffffff); gfx.fillCircle(76, 26, 2); gfx.fillCircle(88, 22, 2);
    gfx.fillStyle(0xaa44ff); gfx.fillCircle(91, 9, 2); gfx.fillCircle(66, 28, 2);
    // Petal highlights
    gfx.fillStyle(0xffffaa);
    gfx.fillRect(67, 3, 1, 1); gfx.fillRect(79, 17, 1, 1); gfx.fillRect(75, 25, 1, 1);

    // ── Tile 3 (data 4): Stone path — irregular flagstones + moss ────────────
    gfx.fillStyle(0x808080); gfx.fillRect(96, 0, 32, 32);
    // Flagstone shapes
    gfx.fillStyle(0xa0a0a0);
    gfx.fillRect(97, 1, 12, 9); gfx.fillRect(111, 1, 16, 9);
    gfx.fillRect(97, 12, 16, 9); gfx.fillRect(115, 12, 12, 9);
    gfx.fillRect(97, 23, 10, 8); gfx.fillRect(109, 23, 18, 8);
    // Stone highlights (top-left corner)
    gfx.fillStyle(0xbababa);
    gfx.fillRect(97, 1, 12, 1); gfx.fillRect(97, 1, 1, 9);
    gfx.fillRect(111, 1, 16, 1); gfx.fillRect(111, 1, 1, 9);
    gfx.fillRect(97, 12, 16, 1); gfx.fillRect(97, 12, 1, 9);
    // Stone shadows (bottom-right corner)
    gfx.fillStyle(0x686868);
    gfx.fillRect(97, 9, 12, 1); gfx.fillRect(108, 1, 1, 9);
    gfx.fillRect(111, 9, 16, 1); gfx.fillRect(126, 1, 1, 9);
    // Grout lines
    gfx.fillStyle(0x707070);
    gfx.fillRect(96, 10, 32, 2); gfx.fillRect(96, 21, 32, 2);
    gfx.fillRect(109, 0, 2, 10); gfx.fillRect(126, 0, 2, 10);
    gfx.fillRect(113, 12, 2, 9); gfx.fillRect(107, 23, 2, 9);
    // Moss patches in grout
    gfx.fillStyle(0x508040);
    gfx.fillRect(98, 10, 2, 2); gfx.fillRect(118, 21, 2, 2);
    gfx.fillRect(110, 0, 1, 2); gfx.fillRect(123, 10, 2, 1);
  }

  private drawTilesetCity(gfx: Phaser.GameObjects.Graphics): void {
    // ── Tile 0 (data 1): Asphalt — aggregate texture + worn streaks ──────────
    gfx.fillStyle(0x404048); gfx.fillRect(0, 0, 32, 32);
    // Subtle aggregate speckle pattern
    gfx.fillStyle(0x3a3a42);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0x484850);
    gfx.fillRect(16, 0, 16, 16); gfx.fillRect(0, 16, 16, 16);
    // Micro aggregate dots
    gfx.fillStyle(0x505058);
    gfx.fillRect(3, 5, 1, 1); gfx.fillRect(11, 2, 1, 1); gfx.fillRect(22, 9, 1, 1);
    gfx.fillRect(7, 19, 1, 1); gfx.fillRect(18, 25, 1, 1); gfx.fillRect(29, 14, 1, 1);
    gfx.fillRect(14, 28, 1, 1); gfx.fillRect(25, 3, 1, 1); gfx.fillRect(5, 28, 1, 1);
    // Light stone aggregate
    gfx.fillStyle(0x5c5c64);
    gfx.fillRect(8, 8, 1, 1); gfx.fillRect(24, 16, 1, 1); gfx.fillRect(16, 24, 1, 1);
    // Oil/tire streak
    gfx.fillStyle(0x383840);
    gfx.fillRect(12, 0, 3, 32);
    // Edge shadow
    gfx.fillStyle(0x2e2e36);
    gfx.fillRect(0, 30, 32, 2);

    // ── Tile 1 (data 2): Sidewalk — block slabs with bevel + grime ───────────
    gfx.fillStyle(0xb0b0b8); gfx.fillRect(32, 0, 32, 32);
    // Grout lines
    gfx.fillStyle(0x909098);
    for (let i = 0; i <= 4; i++) gfx.fillRect(32, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(32 + j * 8, 0, 1, 32);
    // Slab face with top-left highlight bevel
    gfx.fillStyle(0xc0c0c8);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        gfx.fillRect(32 + c * 8 + 1, r * 8 + 1, 7, 7);
    gfx.fillStyle(0xd0d0d8);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(32 + c * 8 + 1, r * 8 + 1, 7, 1);
        gfx.fillRect(32 + c * 8 + 1, r * 8 + 1, 1, 7);
      }
    // Bottom-right shadow bevel
    gfx.fillStyle(0x9898a0);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(32 + c * 8 + 1, r * 8 + 7, 7, 1);
        gfx.fillRect(32 + c * 8 + 7, r * 8 + 1, 1, 7);
      }
    // Grime/scuff in one corner slab
    gfx.fillStyle(0xa0a0a8);
    gfx.fillRect(50, 18, 3, 2);

    // ── Tile 2 (data 3): Building lobby floor — marble/tile pattern ──────────
    gfx.fillStyle(0xd0c8b0); gfx.fillRect(64, 0, 32, 32);
    gfx.fillStyle(0xc0b8a0);
    for (let i = 0; i <= 4; i++) gfx.fillRect(64, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(64 + j * 8, 0, 1, 32);
    // Marble veins
    gfx.fillStyle(0xe0d8c0);
    gfx.fillRect(65, 1, 7, 7); gfx.fillRect(81, 9, 7, 7);
    gfx.fillRect(65, 17, 7, 7); gfx.fillRect(81, 25, 7, 7);
    gfx.fillStyle(0xb0a888);
    gfx.fillRect(65, 0, 32, 2); gfx.fillRect(64, 30, 32, 2);
    // Vein accents
    gfx.fillStyle(0xa89870);
    gfx.fillRect(67, 3, 3, 1); gfx.fillRect(83, 11, 4, 1); gfx.fillRect(68, 20, 2, 1);

    // ── Tile 3 (data 4): Road centre marking — dashed yellow stripe ──────────
    gfx.fillStyle(0x404048); gfx.fillRect(96, 0, 32, 32);
    // Same aggregate
    gfx.fillStyle(0x484850);
    gfx.fillRect(98, 4, 1, 1); gfx.fillRect(118, 22, 1, 1); gfx.fillRect(108, 14, 1, 1);
    // Dashed centre stripe
    gfx.fillStyle(0xffcc00);
    gfx.fillRect(110, 0, 4, 13); gfx.fillRect(110, 17, 4, 15);
    // Stripe worn edge (slightly faded sides)
    gfx.fillStyle(0xd4a800);
    gfx.fillRect(110, 0, 1, 13); gfx.fillRect(113, 0, 1, 13);
    gfx.fillRect(110, 17, 1, 15); gfx.fillRect(113, 17, 1, 15);
  }

  private buildWalls(): void {
    // Level-specific wall texture key so each level can have its own look.
    const wallKey = `wall-L${this.levelNum}`;

    if (this.levelNum === 1) {
      // ── L1: warm cream painted drywall with baseboard trim ──────────────────
      this.ensureTexture(wallKey, 64, 32, (gfx) => {
        // Base: warm cream/eggshell
        gfx.fillStyle(0xeeead8); gfx.fillRect(0, 0, 64, 32);
        // Subtle paint-colour variation (left/right halves slightly different)
        gfx.fillStyle(0xe8e4cc); gfx.fillRect(0, 0, 32, 20);
        gfx.fillStyle(0xf4f0e0); gfx.fillRect(32, 0, 32, 20);
        // Paint-texture noise specks
        gfx.fillStyle(0xdedac6);
        gfx.fillRect(7,  5, 1, 1); gfx.fillRect(22, 12, 1, 1); gfx.fillRect(48, 7, 1, 1);
        gfx.fillRect(14, 18, 1, 1); gfx.fillRect(38, 16, 1, 1); gfx.fillRect(58, 4, 1, 1);
        gfx.fillRect(30, 9, 1, 1); gfx.fillRect(52, 19, 1, 1); gfx.fillRect(3,  14, 1, 1);
        // Ceiling-join highlight (top 3 px)
        gfx.fillStyle(0xfef8ea); gfx.fillRect(0, 0, 64, 3);
        gfx.fillStyle(0xf6f2e0); gfx.fillRect(0, 3, 64, 1);
        // Mid-wall ambient shadow (transition to baseboard)
        gfx.fillStyle(0xddd8c4); gfx.fillRect(0, 19, 64, 2);
        // Baseboard trim (rows 21-28)
        gfx.fillStyle(0xd8d0ba); gfx.fillRect(0, 21, 64, 7);
        gfx.fillStyle(0xece8d0); gfx.fillRect(0, 21, 64, 1); // highlight top
        gfx.fillStyle(0xc6bc9e); gfx.fillRect(0, 27, 64, 2); // lower shadow
        // Floor-contact shadow (bottom 2 px)
        gfx.fillStyle(0x686050); gfx.fillRect(0, 29, 64, 3);
        // Subtle baseboard panel groove (centre line)
        gfx.fillStyle(0xccc4ae); gfx.fillRect(0, 24, 64, 1);
      });
    } else {
      // ── Other levels: keep original blue-grey wall ──────────────────────────
      this.ensureTexture(wallKey, 8, 8, (gfx) => {
        gfx.fillStyle(0x4a5878); gfx.fillRect(0, 0, 8, 8);
        gfx.fillStyle(0x6878a0); gfx.fillRect(0, 3, 8, 2);
        gfx.fillStyle(0x3e4e6e); gfx.fillRect(0, 0, 3, 3);
        gfx.fillStyle(0x4a5a7c); gfx.fillRect(4, 0, 4, 3);
        gfx.fillStyle(0x3a4a6a); gfx.fillRect(1, 5, 5, 3);
        gfx.fillStyle(0x587090); gfx.fillRect(0, 7, 8, 1);
      });
    }

    for (const wall of this.cfg.walls) {
      this.addStaticRect(this.wallGroup, wall, wallKey);
    }
    this.wallGroup.refresh();
  }

  private buildFurniture(): void {
    for (const item of this.cfg.furniture) {
      this.addStaticRect(this.furnitureGroup, item.rect, item.textureKey);
    }
    this.furnitureGroup.refresh();
  }

  /** Generate all level-specific obstacle textures (guarded by ensureTexture). */
  private buildLevelTextures(): void {
    switch (this.levelNum) {
      case 1: this.buildTexturesHouse();    break;
      case 2: this.buildTexturesWaterPark(); break;
      case 3: this.buildTexturesPark();     break;
      case 4: this.buildTexturesCity();     break;
    }
    // Treats + sparkle are common to all levels
    this.ensureTexture('sparkle', 8, 8, (gfx) => {
      gfx.fillStyle(0xaaddff); gfx.fillCircle(4, 4, 4);
    });
    this.ensureTexture('treat', 10, 10, (gfx) => {
      gfx.fillStyle(0x0077ff); gfx.fillRect(0, 0, 10, 10);
      gfx.fillStyle(0x2299ff); gfx.fillRect(1, 1, 8, 8);
      gfx.fillStyle(0x88ccff); gfx.fillRect(1, 1, 3, 2);
      gfx.fillStyle(0x0044cc);
      gfx.fillRect(0, 8, 10, 2); gfx.fillRect(8, 0, 2, 8);
    });
    // Pink treat (optional, spawns Axol helper)
    this.ensureTexture('pink-treat', 12, 12, (gfx) => {
      gfx.fillStyle(0xff44aa); gfx.fillRect(0, 0, 12, 12);
      gfx.fillStyle(0xff77cc); gfx.fillRect(1, 1, 10, 10);
      gfx.fillStyle(0xffaaee); gfx.fillRect(1, 1, 4, 3);
      gfx.fillStyle(0xcc0077);
      gfx.fillRect(0, 10, 12, 2); gfx.fillRect(10, 0, 2, 10);
      // Star cross highlight
      gfx.fillStyle(0xffffff);
      gfx.fillRect(5, 1, 2, 4); gfx.fillRect(4, 2, 4, 2);
    });
  }

  private buildTexturesHouse(): void {
    // ── Couch: 72×28 → displayed at 180×70 (2.5× scale) ─────────────────────
    this.ensureTexture('furniture-couch', 72, 28, (gfx) => {
      // Fill entire couch body
      gfx.fillStyle(0x3c4878); gfx.fillRect(0, 0, 72, 28);

      // Back rest (top 8 rows — viewed from above this is the rear of the couch)
      gfx.fillStyle(0x3a4876); gfx.fillRect(0, 0, 72, 8);
      gfx.fillStyle(0x506098); gfx.fillRect(5, 1, 62, 5);
      gfx.fillStyle(0x6070ac); gfx.fillRect(6, 1, 60, 3);
      gfx.fillStyle(0x788ccc); gfx.fillRect(7, 1, 58, 1); // top-edge highlight

      // Armrests (solid blocks on both sides)
      gfx.fillStyle(0x2c3468); gfx.fillRect(0, 0, 6, 28);
      gfx.fillStyle(0x2c3468); gfx.fillRect(66, 0, 6, 28);
      // Armrest top-face highlight
      gfx.fillStyle(0x4858a4); gfx.fillRect(0, 0, 6, 3);
      gfx.fillStyle(0x4858a4); gfx.fillRect(66, 0, 6, 3);
      // Armrest inner shadow
      gfx.fillStyle(0x222858); gfx.fillRect(5, 0, 1, 28);
      gfx.fillStyle(0x222858); gfx.fillRect(66, 0, 1, 28);

      // Seat area
      gfx.fillStyle(0x4c5c9c); gfx.fillRect(6, 8, 60, 16);

      // Three cushions with puffed-top highlights and side shadows
      const cx = [7, 28, 49];
      for (const x of cx) {
        gfx.fillStyle(0x5870bc); gfx.fillRect(x, 9, 19, 13);
        gfx.fillStyle(0x6882d0); gfx.fillRect(x + 1, 10, 17, 5); // puff highlight
        gfx.fillStyle(0x7898e0); gfx.fillRect(x + 3, 10, 11, 2); // peak
        gfx.fillStyle(0x3a4880); gfx.fillRect(x, 20, 19, 2);     // front shadow
        gfx.fillStyle(0x2e3870); gfx.fillRect(x, 22, 19, 1);     // deep shadow
      }

      // Cushion seam dividers
      gfx.fillStyle(0x202448);
      gfx.fillRect(26, 9, 2, 13);
      gfx.fillRect(47, 9, 2, 13);

      // Seat front rail
      gfx.fillStyle(0x3c5090); gfx.fillRect(6, 24, 60, 3);
      gfx.fillStyle(0x5060a0); gfx.fillRect(6, 24, 60, 1);

      // Legs
      gfx.fillStyle(0x222020); gfx.fillRect(7, 25, 6, 3);
      gfx.fillStyle(0x222020); gfx.fillRect(59, 25, 6, 3);
      gfx.fillStyle(0x484040); gfx.fillRect(7, 25, 2, 3);
      gfx.fillStyle(0x484040); gfx.fillRect(59, 25, 2, 3);

      // Scatter pillows on back rest
      // Left: burgundy pillow
      gfx.fillStyle(0x882030); gfx.fillRect(7, 1, 16, 7);
      gfx.fillStyle(0xb02840); gfx.fillRect(9, 2, 12, 4);
      gfx.fillStyle(0xcc3050); gfx.fillRect(10, 2, 10, 2);
      gfx.fillStyle(0x661828); gfx.fillRect(7, 7, 16, 1);
      // Right: gold pillow
      gfx.fillStyle(0x906020); gfx.fillRect(49, 1, 16, 7);
      gfx.fillStyle(0xba8030); gfx.fillRect(51, 2, 12, 4);
      gfx.fillStyle(0xd0a040); gfx.fillRect(52, 2, 10, 2);
      gfx.fillStyle(0x704818); gfx.fillRect(49, 7, 16, 1);
    });

    // ── Coffee table: 48×32 → displayed at 120×80 (2.5× scale) ──────────────
    this.ensureTexture('furniture-table', 48, 32, (gfx) => {
      // Main hardwood surface
      gfx.fillStyle(0xc49a50); gfx.fillRect(0, 0, 48, 32);

      // Plank-tone alternation (8-px rows)
      gfx.fillStyle(0xd4aa58); gfx.fillRect(0, 0, 25, 8);
      gfx.fillStyle(0xba9048); gfx.fillRect(25, 0, 23, 8);
      gfx.fillStyle(0xd0a450); gfx.fillRect(0, 8, 32, 8);
      gfx.fillStyle(0xb89040); gfx.fillRect(32, 8, 16, 8);
      gfx.fillStyle(0xc49850); gfx.fillRect(0, 16, 18, 8);
      gfx.fillStyle(0xd8b060); gfx.fillRect(18, 16, 30, 8);
      gfx.fillStyle(0xbc9648); gfx.fillRect(0, 24, 28, 8);
      gfx.fillStyle(0xd0aa58); gfx.fillRect(28, 24, 20, 8);

      // Grain dividers
      gfx.fillStyle(0xa88238);
      gfx.fillRect(0, 8, 48, 1); gfx.fillRect(0, 16, 48, 1); gfx.fillRect(0, 24, 48, 1);
      // Plank-end joins (short vertical)
      gfx.fillStyle(0x9a7030);
      gfx.fillRect(24, 0, 1, 8); gfx.fillRect(31, 8, 1, 8);
      gfx.fillRect(17, 16, 1, 8); gfx.fillRect(27, 24, 1, 8);

      // Grain highlight streaks
      gfx.fillStyle(0xe0ba68);
      gfx.fillRect(3, 2, 16, 1); gfx.fillRect(28, 4, 12, 1);
      gfx.fillRect(2, 10, 24, 1); gfx.fillRect(34, 13, 10, 1);
      gfx.fillRect(6, 18, 8, 1); gfx.fillRect(22, 21, 18, 1);
      gfx.fillRect(4, 26, 18, 1); gfx.fillRect(30, 29, 14, 1);

      // Knot details
      gfx.fillStyle(0x886030); gfx.fillRect(14, 10, 4, 3);
      gfx.fillStyle(0xa07840); gfx.fillRect(15, 11, 2, 1);

      // Table legs in corners (darker)
      gfx.fillStyle(0x7a5c28);
      gfx.fillRect(0, 0, 5, 5); gfx.fillRect(43, 0, 5, 5);
      gfx.fillRect(0, 27, 5, 5); gfx.fillRect(43, 27, 5, 5);
      // Leg highlights
      gfx.fillStyle(0x9a7840);
      gfx.fillRect(0, 0, 5, 1); gfx.fillRect(0, 0, 1, 5);
      gfx.fillRect(43, 0, 5, 1); gfx.fillRect(43, 0, 1, 5);

      // Table edge shadow (right + bottom rim)
      gfx.fillStyle(0x9a7830); gfx.fillRect(44, 0, 4, 32); gfx.fillRect(0, 28, 44, 4);
      // Table edge highlight (top + left rim)
      gfx.fillStyle(0xdcb868); gfx.fillRect(0, 0, 44, 2); gfx.fillRect(0, 0, 2, 28);

      // Vase decoration (centre-left)
      gfx.fillStyle(0x3a78b8); gfx.fillRect(8, 9, 7, 12);     // vase body
      gfx.fillStyle(0x5a9ad8); gfx.fillRect(9, 9, 5, 4);      // vase gloss
      gfx.fillStyle(0x2858a0); gfx.fillRect(8, 19, 7, 2);     // vase bottom lip
      gfx.fillStyle(0x2a6020); gfx.fillRect(11, 5, 2, 5);     // stem
      gfx.fillStyle(0xff4070); gfx.fillCircle(12, 4, 3);       // bloom
      gfx.fillStyle(0xff8090); gfx.fillRect(10, 3, 4, 2);     // bloom highlight
      gfx.fillStyle(0x50b040); gfx.fillRect(8, 7, 2, 2);      // leaf left
      gfx.fillStyle(0x50b040); gfx.fillRect(14, 7, 2, 2);     // leaf right

      // Remote control (right side)
      gfx.fillStyle(0x1a1a20); gfx.fillRect(33, 11, 8, 14);
      gfx.fillStyle(0x2a2a30); gfx.fillRect(34, 12, 6, 12);
      gfx.fillStyle(0xcc3030); gfx.fillRect(35, 13, 4, 2);    // power button
      gfx.fillStyle(0x888888);
      gfx.fillRect(35, 17, 1, 1); gfx.fillRect(37, 17, 1, 1); // small buttons
      gfx.fillRect(35, 19, 1, 1); gfx.fillRect(37, 19, 1, 1);
      gfx.fillRect(35, 21, 1, 1); gfx.fillRect(37, 21, 1, 1);
    });

    // ── Bookshelf: 28×48 → displayed at 70×120 (2.5× scale) ─────────────────
    this.ensureTexture('furniture-bookshelf', 28, 48, (gfx) => {
      // Dark wood frame
      gfx.fillStyle(0x2e2010); gfx.fillRect(0, 0, 28, 48);
      // Frame highlight (left edge)
      gfx.fillStyle(0x4a3420); gfx.fillRect(0, 0, 2, 48);
      // Frame shadow (right edge)
      gfx.fillStyle(0x1c1408); gfx.fillRect(26, 0, 2, 48);

      // Back panel (lighter wood, visible behind short books)
      gfx.fillStyle(0x5a4028); gfx.fillRect(2, 0, 24, 48);

      // Four shelves (horizontal dividers with thickness)
      gfx.fillStyle(0x3a2818);
      gfx.fillRect(2, 10, 24, 2); gfx.fillRect(2, 22, 24, 2);
      gfx.fillRect(2, 34, 24, 2); gfx.fillRect(2, 46, 24, 2);
      // Shelf front-edge highlight
      gfx.fillStyle(0x6a5038);
      gfx.fillRect(2, 10, 24, 1); gfx.fillRect(2, 22, 24, 1);
      gfx.fillRect(2, 34, 24, 1); gfx.fillRect(2, 46, 24, 1);

      // ── Shelf 1 (y=0-10): books ──────────────────────────────────────────
      const s1: [number, number, string][] = [
        [2,  4, '#cc2828'], [5,  4, '#3060cc'], [8,  4, '#208840'],
        [11, 4, '#c89820'], [14, 4, '#804488'], [17, 4, '#c84820'],
        [21, 3, '#285890'], [24, 4, '#9a2020'],
      ];
      for (const [bx, bw, col] of s1) {
        gfx.fillStyle(parseInt(col.slice(1), 16)); gfx.fillRect(bx, 1, bw, 8);
        // Spine highlight
        gfx.fillStyle(0xffffff); gfx.fillRect(bx, 1, 1, 8);
      }

      // ── Shelf 2 (y=12-22): books ──────────────────────────────────────────
      const s2: [number, number, string][] = [
        [2,  4, '#c86020'], [6,  4, '#308848'], [10, 3, '#cc2828'],
        [13, 5, '#304888'], [18, 4, '#c8a840'], [22, 4, '#5c3088'],
      ];
      for (const [bx, bw, col] of s2) {
        gfx.fillStyle(parseInt(col.slice(1), 16)); gfx.fillRect(bx, 13, bw, 8);
        gfx.fillStyle(0xffffff); gfx.fillRect(bx, 13, 1, 8);
      }

      // ── Shelf 3 (y=24-34): books (slightly shorter) ───────────────────────
      const s3: [number, number, string][] = [
        [2,  3, '#2860cc'], [5,  4, '#884488'], [9,  4, '#c89020'],
        [13, 3, '#cc3028'], [16, 4, '#208048'], [20, 4, '#c04820'],
        [24, 3, '#305888'],
      ];
      for (const [bx, bw, col] of s3) {
        gfx.fillStyle(parseInt(col.slice(1), 16)); gfx.fillRect(bx, 25, bw, 8);
        gfx.fillStyle(0xffffff); gfx.fillRect(bx, 25, 1, 8);
      }

      // ── Shelf 4 (y=36-46): books + small decorative item ──────────────────
      const s4: [number, number, string][] = [
        [2,  4, '#cc2828'], [6,  4, '#30a050'], [10, 3, '#3060cc'],
        [13, 5, '#c8a840'],
      ];
      for (const [bx, bw, col] of s4) {
        gfx.fillStyle(parseInt(col.slice(1), 16)); gfx.fillRect(bx, 37, bw, 8);
        gfx.fillStyle(0xffffff); gfx.fillRect(bx, 37, 1, 8);
      }
      // Small photo frame on shelf 4
      gfx.fillStyle(0x705030); gfx.fillRect(19, 37, 8, 8);
      gfx.fillStyle(0xf0e8d8); gfx.fillRect(20, 38, 6, 6);
      gfx.fillStyle(0x5080a0); gfx.fillRect(21, 39, 4, 4);
    });

    // ── Kitchen / dining table: 56×40 → displayed at 140×100 (2.5× scale) ───
    this.ensureTexture('furniture-kitchen-table', 56, 40, (gfx) => {
      // Light birch surface
      gfx.fillStyle(0xe0c880); gfx.fillRect(0, 0, 56, 40);

      // Plank alternation
      gfx.fillStyle(0xd4ba70); gfx.fillRect(0, 0, 28, 10);
      gfx.fillStyle(0xecce90); gfx.fillRect(28, 0, 28, 10);
      gfx.fillStyle(0xe8ca88); gfx.fillRect(0, 10, 36, 10);
      gfx.fillStyle(0xd8b878); gfx.fillRect(36, 10, 20, 10);
      gfx.fillStyle(0xdabc78); gfx.fillRect(0, 20, 22, 10);
      gfx.fillStyle(0xeece90); gfx.fillRect(22, 20, 34, 10);
      gfx.fillStyle(0xe4c882); gfx.fillRect(0, 30, 40, 10);
      gfx.fillStyle(0xd2b668); gfx.fillRect(40, 30, 16, 10);

      // Grain lines
      gfx.fillStyle(0xb89850);
      gfx.fillRect(0, 10, 56, 1); gfx.fillRect(0, 20, 56, 1); gfx.fillRect(0, 30, 56, 1);
      // Plank joins
      gfx.fillStyle(0xaa8840);
      gfx.fillRect(27, 0, 1, 10); gfx.fillRect(35, 10, 1, 10);
      gfx.fillRect(21, 20, 1, 10); gfx.fillRect(39, 30, 1, 10);

      // Grain highlight streaks
      gfx.fillStyle(0xf8dea0);
      gfx.fillRect(4, 2, 18, 1); gfx.fillRect(32, 5, 16, 1);
      gfx.fillRect(3, 12, 28, 1); gfx.fillRect(38, 17, 14, 1);
      gfx.fillRect(6, 22, 10, 1); gfx.fillRect(26, 27, 20, 1);
      gfx.fillRect(5, 32, 30, 1); gfx.fillRect(42, 37, 10, 1);

      // Legs (dark blocks at corners)
      gfx.fillStyle(0x9a7830);
      gfx.fillRect(0, 0, 6, 6); gfx.fillRect(50, 0, 6, 6);
      gfx.fillRect(0, 34, 6, 6); gfx.fillRect(50, 34, 6, 6);
      // Leg highlights
      gfx.fillStyle(0xb89040);
      gfx.fillRect(0, 0, 6, 1); gfx.fillRect(0, 0, 1, 6);
      gfx.fillRect(50, 0, 6, 1); gfx.fillRect(50, 0, 1, 6);

      // Table edge shadow (bottom + right rim)
      gfx.fillStyle(0xb09040); gfx.fillRect(0, 36, 50, 4); gfx.fillRect(52, 0, 4, 40);
      // Table edge highlight (top + left rim)
      gfx.fillStyle(0xf8e0a0); gfx.fillRect(0, 0, 50, 2); gfx.fillRect(0, 0, 2, 36);

      // Tablecloth (subtle oval suggesting cloth draped over centre)
      gfx.fillStyle(0xfaf2d8); gfx.fillEllipse(28, 20, 36, 24);
      gfx.fillStyle(0xf0e8c8); gfx.fillEllipse(28, 20, 28, 18);

      // Centre fruit bowl
      gfx.fillStyle(0x8a6828); gfx.fillCircle(28, 20, 8);
      gfx.fillStyle(0xa8882c); gfx.fillCircle(27, 19, 7);
      // Fruits
      gfx.fillStyle(0xee3030); gfx.fillCircle(25, 18, 3); // apple
      gfx.fillStyle(0xff9020); gfx.fillCircle(31, 17, 3); // orange
      gfx.fillStyle(0x40cc30); gfx.fillCircle(28, 23, 3); // pear/grape
      gfx.fillStyle(0xff60a0); gfx.fillCircle(24, 23, 2); // berry
      // Bowl rim highlight
      gfx.fillStyle(0xc8a848); gfx.fillRect(22, 12, 12, 1);
    });

    this.ensureTexture('bush', 8, 8, (gfx) => {
      gfx.fillStyle(0x1e5c1e); gfx.fillRect(0, 0, 8, 8);
      gfx.fillStyle(0x308030);
      gfx.fillCircle(2.5, 3, 2.5); gfx.fillCircle(5.5, 2, 2);
      gfx.fillCircle(4, 6, 2.5);   gfx.fillCircle(7, 5.5, 1.5);
      gfx.fillStyle(0x50a050);
      gfx.fillCircle(2, 2, 1); gfx.fillCircle(6, 1, 1);
      gfx.fillStyle(0x184818);
      gfx.fillRect(0, 7, 8, 1); gfx.fillRect(7, 0, 1, 8);
    });

    this.ensureTexture('bush-shed', 24, 24, (gfx) => {
      // Shed walls (tan/beige siding)
      gfx.fillStyle(0xb8a888); gfx.fillRect(0, 0, 24, 24);
      // Roof (slate grey)
      gfx.fillStyle(0x606878); gfx.fillRect(0, 0, 24, 8);
      // Roof shingles
      gfx.fillStyle(0x505868);
      for (let px = 0; px < 24; px += 3) gfx.fillRect(px, 0, 1, 8);
      // Roof highlight
      gfx.fillStyle(0x808898); gfx.fillRect(0, 7, 24, 1);
      // Siding horizontal lines
      gfx.fillStyle(0x9a8868);
      gfx.fillRect(0, 8, 24, 1); gfx.fillRect(0, 14, 24, 1); gfx.fillRect(0, 20, 24, 1);
      gfx.fillRect(0, 23, 24, 1);
      // Siding edge shadows
      gfx.fillRect(0, 8, 1, 16); gfx.fillRect(23, 8, 1, 16);
      // Door
      gfx.fillStyle(0x7a5830); gfx.fillRect(9, 14, 6, 9);
      gfx.fillStyle(0x5a4020);
      gfx.fillRect(8, 13, 8, 1); gfx.fillRect(8, 23, 8, 1);
      gfx.fillRect(8, 13, 1, 10); gfx.fillRect(15, 13, 1, 10);
      // Door shadow / panel line
      gfx.fillStyle(0x8a6840); gfx.fillRect(10, 15, 4, 4); gfx.fillRect(10, 20, 4, 2);
      // Doorknob
      gfx.fillStyle(0xd4a820); gfx.fillRect(14, 18, 1, 2);
      // Windows with frame
      gfx.fillStyle(0x8ab8d8);
      gfx.fillRect(2, 11, 4, 4); gfx.fillRect(18, 11, 4, 4);
      // Window frame
      gfx.fillStyle(0x9a8868);
      gfx.fillRect(2, 11, 4, 1); gfx.fillRect(2, 14, 4, 1);
      gfx.fillRect(2, 11, 1, 4); gfx.fillRect(5, 11, 1, 4);
      gfx.fillRect(18, 11, 4, 1); gfx.fillRect(18, 14, 4, 1);
      gfx.fillRect(18, 11, 1, 4); gfx.fillRect(21, 11, 1, 4);
      // Window pane cross
      gfx.fillRect(3, 12, 2, 1); gfx.fillRect(4, 11, 1, 3);
      gfx.fillRect(19, 12, 2, 1); gfx.fillRect(20, 11, 1, 3);
      // Window highlight (glass glint)
      gfx.fillStyle(0xd4eef8); gfx.fillRect(3, 11, 1, 1); gfx.fillRect(19, 11, 1, 1);
    });
  }

  private buildTexturesWaterPark(): void {
    // Main pool — deep blue, multi-layer water with mosaic floor tiles visible
    this.ensureTexture('wpark-pool', 64, 64, (gfx) => {
      // Deep-water base
      gfx.fillStyle(0x005577); gfx.fillRect(0, 0, 64, 64);
      // Mid-depth layer
      gfx.fillStyle(0x0077aa); gfx.fillRect(3, 3, 58, 58);
      // Shallow / bright centre
      gfx.fillStyle(0x0099cc); gfx.fillRect(8, 8, 48, 48);
      // Underwater tile grid (visible through water)
      gfx.fillStyle(0x0088bb);
      for (let gy = 8; gy < 56; gy += 10) gfx.fillRect(8, gy, 48, 1);
      for (let gx = 8; gx < 56; gx += 10) gfx.fillRect(gx, 8, 1, 48);
      // Wave shimmer bands (diagonal)
      gfx.fillStyle(0x33ccff);
      for (let wy = 0; wy < 64; wy += 11) {
        for (let wx = 0; wx < 64; wx += 14)
          gfx.fillRect(wx + (wy % 14), wy, 7, 2);
      }
      // Bright specular flecks
      gfx.fillStyle(0x99eeff);
      gfx.fillRect(10, 14, 8, 2); gfx.fillRect(35, 8,  6, 2);
      gfx.fillRect(48, 22, 9, 2); gfx.fillRect(18, 38, 7, 2);
      gfx.fillRect(42, 48, 6, 2); gfx.fillRect(24, 54, 8, 2);
      // Very bright highlights (sun glints)
      gfx.fillStyle(0xddf8ff);
      gfx.fillRect(12, 12, 3, 1); gfx.fillRect(40, 30, 3, 1);
      gfx.fillRect(22, 50, 4, 1); gfx.fillRect(55, 18, 3, 1);
      // Edge inset shadow
      gfx.fillStyle(0x003a55);
      gfx.fillRect(0, 0, 64, 3); gfx.fillRect(0, 0, 3, 64);
      gfx.fillRect(0, 61, 64, 3); gfx.fillRect(61, 0, 3, 64);
    });

    // Wading pool — shallow turquoise, sandy floor showing through
    this.ensureTexture('wpark-wading', 64, 64, (gfx) => {
      gfx.fillStyle(0x00886a); gfx.fillRect(0, 0, 64, 64);
      gfx.fillStyle(0x00aaaa); gfx.fillRect(2, 2, 60, 60);
      // Sandy floor tint
      gfx.fillStyle(0x44bb99); gfx.fillRect(6, 6, 52, 52);
      // Ripple ellipses
      gfx.fillStyle(0x00ddb8);
      for (let ry = 10; ry < 60; ry += 14) gfx.fillRect(6, ry, 52, 3);
      // Water glints
      gfx.fillStyle(0xaaffdd);
      gfx.fillRect(12, 18, 10, 2); gfx.fillRect(36, 10, 8, 2);
      gfx.fillRect(44, 36, 12, 2); gfx.fillRect(18, 48, 9, 2);
      gfx.fillStyle(0xeeffee);
      gfx.fillRect(14, 16, 3, 1); gfx.fillRect(46, 38, 3, 1);
      // Foam at shallow entry
      gfx.fillStyle(0xffffff, 1.0); gfx.fillRect(4, 58, 56, 3);
      gfx.fillStyle(0xddffee); gfx.fillRect(8, 55, 48, 2);
      // Edge shadow
      gfx.fillStyle(0x005544);
      gfx.fillRect(0, 0, 64, 3); gfx.fillRect(0, 0, 3, 64);
    });

    // Slide tower — orange/yellow platform with structural detail
    this.ensureTexture('wpark-slide', 64, 64, (gfx) => {
      gfx.fillStyle(0xd07010); gfx.fillRect(0, 0, 64, 64);
      // Platform deck (top)
      gfx.fillStyle(0xff9930); gfx.fillRect(2, 2, 60, 16);
      gfx.fillStyle(0xffcc55); gfx.fillRect(4, 3,  56, 5);  // deck highlight
      gfx.fillStyle(0xb86010); gfx.fillRect(2, 17, 60, 2);  // deck shadow
      // Non-slip deck texture
      gfx.fillStyle(0xe88820, 0.6);
      for (let dx = 6; dx < 58; dx += 8) gfx.fillRect(dx, 5, 4, 8);
      // Support column
      gfx.fillStyle(0x7a3808); gfx.fillRect(26, 20, 12, 44);
      gfx.fillStyle(0xaa5818); gfx.fillRect(27, 20, 4, 44);  // column highlight
      gfx.fillStyle(0x5a2804); gfx.fillRect(36, 20, 2, 44);  // column shadow
      // Cross-bracing
      gfx.fillStyle(0x8a4010);
      gfx.fillRect(0,  28, 26, 3); gfx.fillRect(38, 28, 26, 3);
      gfx.fillRect(0,  44, 26, 3); gfx.fillRect(38, 44, 26, 3);
      // Slide chute sections
      gfx.fillStyle(0x1a88cc); gfx.fillRect(0, 20, 24, 44);
      gfx.fillStyle(0x22aaee); gfx.fillRect(1, 20, 10, 44); // chute highlight
      // Handrail posts
      gfx.fillStyle(0xe0e0e0);
      gfx.fillRect(0,  2, 3, 18); gfx.fillRect(61, 2, 3, 18);
      gfx.fillStyle(0xffffff); gfx.fillRect(1, 2, 1, 18);
    });

    // Snack / ice-cream stand — detailed kiosk
    this.ensureTexture('wpark-snack', 64, 64, (gfx) => {
      // Main wall (cream)
      gfx.fillStyle(0xf5e8cc); gfx.fillRect(0, 0, 64, 64);
      // Red & white canopy stripes
      gfx.fillStyle(0xdd2020);
      for (let sx = 0; sx < 64; sx += 10) gfx.fillRect(sx, 0, 5, 16);
      gfx.fillStyle(0xffffff);
      for (let sx = 5; sx < 64; sx += 10) gfx.fillRect(sx, 0, 5, 16);
      // Canopy underside / shadow edge
      gfx.fillStyle(0x880000); gfx.fillRect(0, 14, 64, 3);
      // Awning fringe triangles
      gfx.fillStyle(0xdd2020);
      for (let fx = 0; fx < 64; fx += 8)
        gfx.fillTriangle(fx, 17, fx + 4, 24, fx + 8, 17);
      // Wall body
      gfx.fillStyle(0xe0c898); gfx.fillRect(2, 27, 60, 36);
      // Counter ledge
      gfx.fillStyle(0xfaf0d8); gfx.fillRect(0, 34, 64, 8);
      gfx.fillStyle(0xc09858); gfx.fillRect(0, 41, 64, 2);
      gfx.fillStyle(0xd4aa70); gfx.fillRect(0, 34, 64, 1);  // counter top edge
      // Serving window
      gfx.fillStyle(0x7a5830); gfx.fillRect(14, 27, 36, 6);
      gfx.fillStyle(0x99ddcc); gfx.fillRect(16, 28, 32, 5);
      gfx.fillStyle(0xbbeeee); gfx.fillRect(17, 28, 8, 4);  // glass glint
      // Display: ice cream cones on counter
      gfx.fillStyle(0xd4a860); // cone 1
      gfx.fillTriangle(20, 43, 25, 34, 30, 43);
      gfx.fillStyle(0xfffae0); gfx.fillCircle(25, 31, 6);
      gfx.fillStyle(0xff9090); // cone 2
      gfx.fillTriangle(36, 43, 41, 34, 46, 43);
      gfx.fillStyle(0xff7070); gfx.fillCircle(41, 31, 6);
      // Door
      gfx.fillStyle(0x7a5030); gfx.fillRect(22, 44, 20, 20);
      gfx.fillStyle(0x5a3818); gfx.fillRect(22, 44, 20, 1);
      gfx.fillRect(22, 44, 1, 20); gfx.fillRect(41, 44, 1, 20);
      gfx.fillStyle(0xd4a820); gfx.fillRect(39, 54, 2, 4);
    });

    // Cabin — log cabin with shingle roof detail
    this.ensureTexture('wpark-cabin', 64, 64, (gfx) => {
      // Log walls
      gfx.fillStyle(0x9a7a58); gfx.fillRect(0, 0, 64, 64);
      // Log rows
      gfx.fillStyle(0x7a5838);
      for (let cy = 6; cy < 64; cy += 6) gfx.fillRect(0, cy, 64, 1);
      // Log highlight
      gfx.fillStyle(0xb89468);
      for (let cy = 5; cy < 64; cy += 6) gfx.fillRect(0, cy, 64, 1);
      // Corner knot
      gfx.fillStyle(0x6a4a28); gfx.fillRect(0, 0, 6, 64); gfx.fillRect(58, 0, 6, 64);
      // Shingle roof band (top)
      gfx.fillStyle(0x554030); gfx.fillRect(0, 0, 64, 10);
      gfx.fillStyle(0x7a6048);
      for (let sx = 0; sx < 64; sx += 8) gfx.fillRect(sx, 2, 7, 6);
      gfx.fillStyle(0x4a3020);
      for (let sx = 0; sx < 64; sx += 8) gfx.fillRect(sx + 6, 2, 1, 6);
      // Windows
      gfx.fillStyle(0x8ab8d8); gfx.fillRect(6, 14, 18, 16); gfx.fillRect(40, 14, 18, 16);
      gfx.fillStyle(0x6a4a2a);
      gfx.fillRect(6, 22,  18, 1); gfx.fillRect(15, 14, 1, 16);
      gfx.fillRect(40, 22, 18, 1); gfx.fillRect(49, 14, 1, 16);
      gfx.fillStyle(0xd4eef8); gfx.fillRect(7, 15, 5, 5); gfx.fillRect(41, 15, 5, 5);
      // Door
      gfx.fillStyle(0x7a5030); gfx.fillRect(22, 36, 20, 28);
      gfx.fillStyle(0x5a3818);
      gfx.fillRect(22, 36, 20, 1); gfx.fillRect(22, 36, 1, 28); gfx.fillRect(41, 36, 1, 28);
      gfx.fillStyle(0xd4a820); gfx.fillRect(38, 50, 2, 4);
    });

    // Lounge chair — recliner with towel + armrests
    this.ensureTexture('wpark-lounge', 32, 14, (gfx) => {
      // Frame (aluminium)
      gfx.fillStyle(0xd0c890); gfx.fillRect(0, 0, 32, 14);
      // Fabric stripes
      gfx.fillStyle(0x44ccaa);
      for (let sx = 4; sx < 30; sx += 8) gfx.fillRect(sx, 1, 4, 12);
      // Headrest block
      gfx.fillStyle(0xffe090); gfx.fillRect(0, 0, 6, 13);
      gfx.fillStyle(0xfff0aa); gfx.fillRect(1, 1, 4, 10);
      // Armrest lines
      gfx.fillStyle(0xb0a050);
      gfx.fillRect(0, 0, 32, 1); gfx.fillRect(0, 13, 32, 1);
      gfx.fillRect(0, 0, 1, 14); gfx.fillRect(31, 0, 1, 14);
      // Folded towel on chair
      gfx.fillStyle(0x2255cc); gfx.fillRect(8, 2, 20, 10);
      gfx.fillStyle(0xffffff, 0.4);
      for (let ts = 10; ts < 28; ts += 6) gfx.fillRect(ts, 2, 3, 10);
    });
  }

  private buildTexturesPark(): void {
    // Fountain — stone basin, multi-layer water, spray jets (128×128)
    this.ensureTexture('park-fountain', 128, 128, (gfx) => {
      gfx.fillStyle(0x909aa8); gfx.fillRect(0, 0, 128, 128);
      gfx.fillStyle(0x8090a0); gfx.fillCircle(64, 64, 60);
      gfx.fillStyle(0xb0bac8); gfx.fillCircle(64, 58, 56);
      // Stone rim rings
      gfx.fillStyle(0x788898); gfx.fillCircle(64, 64, 52);
      gfx.fillStyle(0xa0b0c0); gfx.fillCircle(64, 62, 50);
      gfx.fillStyle(0x788898); gfx.fillCircle(64, 64, 46);
      // Water
      gfx.fillStyle(0x0077cc); gfx.fillCircle(64, 64, 44);
      gfx.fillStyle(0x3399ee); gfx.fillCircle(64, 64, 36);
      gfx.fillStyle(0x55aaff); gfx.fillCircle(64, 62, 26);
      // Ripple arcs
      gfx.fillStyle(0x77ccff);
      for (let ri = 0; ri < 6; ri++) {
        const ang = ri * Math.PI / 3;
        const rx = Math.round(64 + Math.cos(ang) * 20);
        const ry = Math.round(64 + Math.sin(ang) * 20);
        gfx.fillRect(rx - 4, ry - 1, 8, 3);
      }
      // Bright specular
      gfx.fillStyle(0x99ddff);
      gfx.fillRect(48, 56, 16, 5); gfx.fillRect(74, 66, 14, 4);
      gfx.fillRect(52, 78, 10, 4); gfx.fillRect(40, 70, 8, 3);
      // Pedestal
      gfx.fillStyle(0xa0aab8); gfx.fillCircle(64, 64, 10);
      gfx.fillStyle(0xb8c2d0); gfx.fillCircle(62, 62, 8);
      // Water jet
      gfx.fillStyle(0xbbddff); gfx.fillCircle(64, 48, 9);
      gfx.fillStyle(0xddeeff); gfx.fillCircle(62, 38, 6);
      gfx.fillStyle(0xffffff); gfx.fillRect(62, 16, 4, 36);
      // Side sprays
      gfx.fillStyle(0xcceeFF);
      gfx.fillRect(36, 42, 4, 6); gfx.fillRect(30, 38, 4, 4);
      gfx.fillRect(88, 42, 4, 6); gfx.fillRect(92, 38, 4, 4);
      gfx.fillRect(46, 28, 4, 6); gfx.fillRect(78, 28, 4, 6);
      // Basin shadow
      gfx.fillStyle(0x607080);
      gfx.fillRect(0, 118, 128, 10); gfx.fillRect(118, 0, 10, 128);
    });

    // Pond — multi-layer water, lily pads, ripples (64×64)
    this.ensureTexture('park-pond', 64, 64, (gfx) => {
      gfx.fillStyle(0x003a55); gfx.fillRect(0, 0, 64, 64);
      gfx.fillStyle(0x005577); gfx.fillRect(2, 2, 60, 60);
      gfx.fillStyle(0x006688); gfx.fillRect(4, 4, 56, 56);
      // Ripple rows
      gfx.fillStyle(0x0099bb);
      for (let py = 8; py < 60; py += 10)
        for (let px = 6; px < 60; px += 14)
          gfx.fillRect(px, py, 8, 3);
      // Specular glints
      gfx.fillStyle(0x55bbdd);
      gfx.fillRect(16, 20, 10, 3); gfx.fillRect(38, 36, 8, 3); gfx.fillRect(26, 52, 7, 2);
      gfx.fillStyle(0xaaddee); gfx.fillRect(18, 18, 3, 1); gfx.fillRect(40, 38, 3, 1);
      // Lily pads (2)
      gfx.fillStyle(0x208a18); gfx.fillCircle(46, 16, 9);
      gfx.fillStyle(0x30aa20); gfx.fillCircle(44, 14, 6);
      gfx.fillStyle(0xff3366); gfx.fillCircle(46, 14, 2); // flower
      gfx.fillStyle(0x209010); gfx.fillCircle(18, 50, 7);
      gfx.fillStyle(0x28b020); gfx.fillCircle(16, 48, 4);
      gfx.fillStyle(0x3a3a18); // lily pad slice
      gfx.fillRect(45, 16, 2, 4); gfx.fillRect(17, 50, 2, 3);
      // Bank shadow
      gfx.fillStyle(0x002233);
      gfx.fillRect(0, 0, 64, 3); gfx.fillRect(0, 0, 3, 64);
      gfx.fillRect(0, 61, 64, 3); gfx.fillRect(61, 0, 3, 64);
    });

    // Tree — 88×88 doubled-coord canopy (displayed at 44×44) for rich detail
    this.ensureTexture('park-tree', 88, 88, (gfx) => {
      // Trunk
      gfx.fillStyle(0x7a5030); gfx.fillRect(38, 56, 12, 28);
      gfx.fillStyle(0x5a3818); gfx.fillRect(46, 56, 4, 28);
      gfx.fillStyle(0xa06840); gfx.fillRect(39, 56, 3, 28); // trunk highlight
      // Dark outer shadow canopy
      gfx.fillStyle(0x1a5218); gfx.fillCircle(44, 36, 34);
      // Main canopy
      gfx.fillStyle(0x2a7830); gfx.fillCircle(44, 33, 29);
      // Sub-canopy clusters
      gfx.fillStyle(0x359a2a);
      gfx.fillCircle(28, 30, 15); gfx.fillCircle(57, 27, 17);
      gfx.fillCircle(40, 17, 13); gfx.fillCircle(55, 44, 12);
      gfx.fillCircle(30, 44, 10);
      // Bright highlight clusters
      gfx.fillStyle(0x55b83a);
      gfx.fillCircle(32, 20, 9); gfx.fillCircle(51, 18, 9);
      gfx.fillCircle(24, 36, 7); gfx.fillCircle(60, 34, 7);
      gfx.fillCircle(44, 14, 6);
      // Top highlight
      gfx.fillStyle(0x78d448);
      gfx.fillCircle(40, 12, 7); gfx.fillCircle(50, 20, 5);
      gfx.fillCircle(30, 26, 4); gfx.fillCircle(58, 26, 4);
      // Dappled highlight spots
      gfx.fillStyle(0x98e870);
      gfx.fillCircle(36, 16, 3); gfx.fillCircle(52, 14, 3);
      gfx.fillCircle(28, 32, 2); gfx.fillCircle(61, 40, 2);
      // Spring blossoms (pink)
      gfx.fillStyle(0xffaacc);
      gfx.fillRect(30, 16, 5, 5); gfx.fillRect(50, 28, 5, 5);
      gfx.fillRect(42, 10, 4, 4); gfx.fillRect(58, 38, 4, 4);
      gfx.fillStyle(0xffddee);
      gfx.fillRect(38, 10, 2, 2); gfx.fillRect(55, 36, 2, 2);
    });

    // Bench — 80×28 (matches display size) for crisp 1:1 pixel detail
    this.ensureTexture('park-bench', 80, 28, (gfx) => {
      // Base shadow
      gfx.fillStyle(0x2a1808); gfx.fillRect(0, 0, 80, 28);
      // Wood seat slats (6 planks)
      gfx.fillStyle(0xa06840);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 1, 11, 16);
      // Slat top highlights
      gfx.fillStyle(0xc08858);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 1, 11, 3);
      // Slat grain lines
      gfx.fillStyle(0x906030);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx + 5, 4, 1, 9);
      // Slat shadow bottoms
      gfx.fillStyle(0x7a5028);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 14, 11, 3);
      // Backrest slats (upper portion)
      gfx.fillStyle(0x8c5a34);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 17, 11, 8);
      gfx.fillStyle(0xaa7040);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 17, 11, 2);
      gfx.fillStyle(0x6a4020);
      for (let bx = 1; bx < 78; bx += 13) gfx.fillRect(bx, 23, 11, 2);
      // Metal legs (both ends)
      gfx.fillStyle(0x6878a0); gfx.fillRect(1, 16, 6, 11);  gfx.fillRect(73, 16, 6, 11);
      gfx.fillStyle(0x8898c0); gfx.fillRect(1, 16, 2, 11);  gfx.fillRect(73, 16, 2, 11);
      gfx.fillStyle(0x505870); gfx.fillRect(5, 16, 2, 11);  gfx.fillRect(77, 16, 2, 11);
    });

    // Swings — 64×64 (displayed at 120×60) A-frame with cushioned seats
    this.ensureTexture('park-swings', 64, 64, (gfx) => {
      // Rubber safety mat
      gfx.fillStyle(0x5a6840); gfx.fillRect(0, 42, 64, 22);
      gfx.fillStyle(0x6a7850);
      for (let sx = 4; sx < 64; sx += 10) gfx.fillRect(sx, 44, 6, 18);
      // Top beam
      gfx.fillStyle(0x4a5060); gfx.fillRect(0, 0, 64, 7);
      gfx.fillStyle(0x6870a0); gfx.fillRect(0, 0, 64, 2);
      gfx.fillStyle(0x303040); gfx.fillRect(0, 6, 64, 1);
      // Side posts (A-frame)
      gfx.fillStyle(0x5a6070); gfx.fillRect(0, 0, 7, 46); gfx.fillRect(57, 0, 7, 46);
      gfx.fillStyle(0x7880a0); gfx.fillRect(1, 0, 2, 46); gfx.fillRect(58, 0, 2, 46);
      gfx.fillStyle(0x404050); gfx.fillRect(5, 0, 2, 46); gfx.fillRect(62, 0, 2, 46);
      // Diagonal braces
      gfx.fillStyle(0x484858);
      gfx.fillRect(0, 40, 7, 3); gfx.fillRect(57, 40, 7, 3);
      // Chain ropes
      gfx.fillStyle(0x353545);
      gfx.fillRect(13, 7, 3, 30); gfx.fillRect(28, 7, 3, 30); gfx.fillRect(44, 7, 3, 30);
      gfx.fillStyle(0x6060a0);
      gfx.fillRect(14, 7, 1, 30); gfx.fillRect(29, 7, 1, 30); gfx.fillRect(45, 7, 1, 30);
      // Swing seats (thick + highlight)
      gfx.fillStyle(0xcc2222); gfx.fillRect(8, 37, 13, 7);
      gfx.fillStyle(0xff5555); gfx.fillRect(9, 37, 11, 2);
      gfx.fillStyle(0x2255cc); gfx.fillRect(26, 37, 13, 7);
      gfx.fillStyle(0x4488ee); gfx.fillRect(27, 37, 11, 2);
      gfx.fillStyle(0xcc9922); gfx.fillRect(44, 37, 13, 7);
      gfx.fillStyle(0xeebb44); gfx.fillRect(45, 37, 11, 2);
    });

    // Sandbox — 64×64 (displayed at 120×80) detailed wood frame + toys
    this.ensureTexture('park-sandbox', 64, 64, (gfx) => {
      // Outer frame (wood)
      gfx.fillStyle(0x9a7838); gfx.fillRect(0, 0, 64, 64);
      gfx.fillStyle(0xb09050); gfx.fillRect(0, 0, 64, 5); gfx.fillRect(0, 0, 5, 64);
      gfx.fillStyle(0x7a5828); gfx.fillRect(0, 59, 64, 5); gfx.fillRect(59, 0, 5, 64);
      // Plank detail on frame
      gfx.fillStyle(0x8a6830);
      gfx.fillRect(5, 5, 54, 2); gfx.fillRect(5, 57, 54, 2);
      gfx.fillRect(5, 5, 2, 54); gfx.fillRect(57, 5, 2, 54);
      // Sand fill
      gfx.fillStyle(0xecd878); gfx.fillRect(5, 5, 54, 54);
      // Sand tone variation
      gfx.fillStyle(0xdcc060); gfx.fillRect(5, 5, 26, 26); gfx.fillRect(34, 34, 25, 25);
      gfx.fillStyle(0xf8f0a0); gfx.fillRect(18, 15, 14, 10); gfx.fillRect(40, 10, 15, 8);
      gfx.fillStyle(0xd0b840); gfx.fillRect(10, 38, 14, 12);
      // Fine sand grain noise
      gfx.fillStyle(0xc8b038);
      gfx.fillRect(14, 22, 2, 2); gfx.fillRect(28, 12, 2, 2); gfx.fillRect(50, 30, 2, 2);
      gfx.fillRect(38, 48, 2, 2); gfx.fillRect(20, 52, 2, 2);
      // Toys: red bucket
      gfx.fillStyle(0xdd2222); gfx.fillRect(40, 10, 12, 12);
      gfx.fillStyle(0xff4444); gfx.fillRect(41, 10, 10, 3);
      gfx.fillStyle(0xbb1111); gfx.fillRect(40, 21, 12, 1);
      gfx.fillStyle(0xddaaaa); gfx.fillRect(43, 7, 6, 5); // bucket handle
      // Yellow spade
      gfx.fillStyle(0xeecc00); gfx.fillRect(12, 38, 8, 20);
      gfx.fillStyle(0xffee44); gfx.fillRect(13, 38, 6, 7);
      gfx.fillStyle(0xbb9900); gfx.fillRect(10, 56, 12, 5);
      gfx.fillStyle(0xaa7700); gfx.fillRect(10, 59, 12, 2);
      // Blue watering can
      gfx.fillStyle(0x2266cc); gfx.fillRect(28, 40, 16, 14);
      gfx.fillStyle(0x4488ee); gfx.fillRect(29, 41, 14, 12);
      gfx.fillStyle(0x2266cc); gfx.fillRect(42, 43, 10, 4); // spout
      gfx.fillStyle(0x1144aa); gfx.fillRect(28, 38, 16, 4); // rim
    });

    // Picnic table — top-down 80×60, table + two bench sides
    this.ensureTexture('park-picnic-table', 80, 60, (gfx) => {
      // Table top (centre)
      gfx.fillStyle(0x8a6040); gfx.fillRect(16, 10, 48, 40);
      // Table plank lines
      gfx.fillStyle(0xa07850);
      for (let tx = 17; tx < 64; tx += 9) gfx.fillRect(tx, 10, 8, 40);
      gfx.fillStyle(0x9a7248);
      for (let tx = 17; tx < 64; tx += 9) gfx.fillRect(tx + 6, 10, 1, 40);
      // Top edge highlight
      gfx.fillStyle(0xc09060); gfx.fillRect(16, 10, 48, 3);
      // Bottom shadow edge
      gfx.fillStyle(0x6a4a28); gfx.fillRect(16, 47, 48, 3);
      // Left bench seat
      gfx.fillStyle(0x9a7040); gfx.fillRect(1, 18, 15, 24);
      gfx.fillStyle(0xb89060); gfx.fillRect(2, 19, 13, 22);
      gfx.fillStyle(0xc8a070); gfx.fillRect(2, 19, 13, 3);
      gfx.fillStyle(0x886030); gfx.fillRect(2, 39, 13, 3);
      // Right bench seat
      gfx.fillStyle(0x9a7040); gfx.fillRect(64, 18, 15, 24);
      gfx.fillStyle(0xb89060); gfx.fillRect(65, 19, 13, 22);
      gfx.fillStyle(0xc8a070); gfx.fillRect(65, 19, 13, 3);
      gfx.fillStyle(0x886030); gfx.fillRect(65, 39, 13, 3);
      // Support legs
      gfx.fillStyle(0x888898);
      gfx.fillRect(20, 48, 5, 12); gfx.fillRect(55, 48, 5, 12);
      gfx.fillRect(3, 40, 10, 4);  gfx.fillRect(67, 40, 10, 4);
      gfx.fillStyle(0xaaaacc);
      gfx.fillRect(20, 48, 2, 12); gfx.fillRect(55, 48, 2, 12);
    });
  }

  private buildTexturesCity(): void {
    // Building tile — upgraded concrete facade (stretched over building rect)
    this.ensureTexture('city-building', 64, 64, (gfx) => {
      gfx.fillStyle(0x7e7e86); gfx.fillRect(0, 0, 64, 64);
      // Panel reveal lines
      gfx.fillStyle(0x606068);
      for (let fy = 0; fy < 64; fy += 16) gfx.fillRect(0, fy, 64, 1);
      for (let fx = 0; fx < 64; fx += 16) gfx.fillRect(fx, 0, 1, 64);
      // Edge highlights
      gfx.fillStyle(0x969699); gfx.fillRect(0, 0, 64, 1); gfx.fillRect(0, 0, 1, 64);
      gfx.fillStyle(0x565660); gfx.fillRect(0, 63, 64, 1); gfx.fillRect(63, 0, 1, 64);
      // 3×3 window grid
      for (let wr = 0; wr < 3; wr++) {
        for (let wc = 0; wc < 3; wc++) {
          const wx = 5 + wc * 19, wy = 5 + wr * 19;
          const lit = ((wr * 3 + wc) * 7 + 3) % 11 > 4;
          gfx.fillStyle(0x505055); gfx.fillRect(wx, wy, 13, 12);
          gfx.fillStyle(lit ? 0xffe880 : 0x3a5060); gfx.fillRect(wx + 1, wy + 1, 11, 10);
          if (lit) { gfx.fillStyle(0xffeeaa, 0.7); gfx.fillRect(wx + 1, wy + 1, 5, 3); }
          gfx.fillStyle(0x888890); gfx.fillRect(wx - 1, wy + 11, 15, 2);
        }
      }
    });

    // Car — red (base color, keep key for backward compat)
    this.ensureTexture('city-car', 16, 24, (gfx) => {
      gfx.fillStyle(0xcc2020); gfx.fillRect(0, 0, 16, 24);
      gfx.fillStyle(0x8ab8d8); gfx.fillRect(2, 3, 12, 6);
      gfx.fillStyle(0xccddee); gfx.fillRect(2, 3, 5, 2);
      gfx.fillStyle(0x6a9ab8); gfx.fillRect(2, 16, 12, 5);
      gfx.fillStyle(0x99bbd4); gfx.fillRect(2, 16, 4, 2);
      gfx.fillStyle(0x1a1a1a);
      gfx.fillRect(0, 2, 3, 5); gfx.fillRect(13, 2, 3, 5);
      gfx.fillRect(0, 17, 3, 5); gfx.fillRect(13, 17, 3, 5);
      gfx.fillStyle(0x888888);
      gfx.fillRect(0, 3, 1, 3); gfx.fillRect(15, 3, 1, 3);
      gfx.fillRect(0, 18, 1, 3); gfx.fillRect(15, 18, 1, 3);
      gfx.fillStyle(0xee4444); gfx.fillRect(2, 9, 12, 7);
      gfx.fillStyle(0xaa1818); gfx.fillRect(7, 9, 2, 7);
    });

    // Car color variants — blue, yellow, green, white
    for (const [key, body, roof, stripe] of [
      ['city-car-blue',   0x2244aa, 0x3355cc, 0x112288],
      ['city-car-yellow', 0xddaa00, 0xeecc22, 0xaa8800],
      ['city-car-green',  0x228844, 0x33aa55, 0x116633],
      ['city-car-white',  0xdddddd, 0xeeeeee, 0xaaaaaa],
    ] as Array<[string, number, number, number]>) {
      this.ensureTexture(key, 16, 24, (gfx) => {
        gfx.fillStyle(body);     gfx.fillRect(0, 0, 16, 24);
        gfx.fillStyle(0x8ab8d8); gfx.fillRect(2, 3, 12, 6);
        gfx.fillStyle(0xccddee); gfx.fillRect(2, 3, 5, 2);
        gfx.fillStyle(0x6a9ab8); gfx.fillRect(2, 16, 12, 5);
        gfx.fillStyle(0x99bbd4); gfx.fillRect(2, 16, 4, 2);
        gfx.fillStyle(0x1a1a1a);
        gfx.fillRect(0, 2, 3, 5); gfx.fillRect(13, 2, 3, 5);
        gfx.fillRect(0, 17, 3, 5); gfx.fillRect(13, 17, 3, 5);
        gfx.fillStyle(0x888888);
        gfx.fillRect(0, 3, 1, 3); gfx.fillRect(15, 3, 1, 3);
        gfx.fillRect(0, 18, 1, 3); gfx.fillRect(15, 18, 1, 3);
        gfx.fillStyle(roof);   gfx.fillRect(2, 9, 12, 7);
        gfx.fillStyle(stripe); gfx.fillRect(7, 9, 2, 7);
      });
    }
  }

  private buildTreats(): void {
    const S = 16, R = 160;
    const searchGrid: [number, number][] = [];
    for (let dy = -R; dy <= R; dy += S)
      for (let dx = -R; dx <= R; dx += S)
        searchGrid.push([dx, dy]);
    searchGrid.sort(([ax, ay], [bx, by]) => ax * ax + ay * ay - bx * bx - by * by);

    for (const pos of this.cfg.treatPositions) {
      let tx = this.cfg.playerStart.x + 40, ty = this.cfg.playerStart.y;
      for (const [dx, dy] of searchGrid) {
        if (this.isWalkable(pos.x + dx, pos.y + dy)) {
          tx = pos.x + dx; ty = pos.y + dy; break;
        }
      }
      const t = this.treatGroup.create(tx, ty, 'treat') as Phaser.Physics.Arcade.Image;
      t.setDisplaySize(12, 12);
      t.setDepth(9990);
      t.refreshBody();
      const emitter = this.add.particles(tx, ty, 'sparkle', {
        lifespan: 700,
        speed: { min: 12, max: 28 },
        scale: { start: 0.55, end: 0 },
        alpha: { start: 0.8, end: 0 },
        quantity: 1,
        frequency: 900,
        blendMode: Phaser.BlendModes.ADD,
      });
      emitter.setDepth(9991);
      t.setData('emitter', emitter);
    }
    this.treatGroup.refresh();
  }

  // ── Decorative layer (no physics) ───────────────────────────────────────────

  private buildDecoratives(): void {
    switch (this.levelNum) {
      case 1: this.buildDecorativesHouse();    break;
      case 2: this.buildDecorativesWaterPark(); break;
      case 3: this.buildDecorativesPark();     break;
      case 4: this.buildDecorativesCity();     break;
    }
  }

  private buildDecorativesHouse(): void {
    // ── Living-room rug — Persian medallion ──────────────────────────────────
    const rug = this.add.graphics();
    // Outer border fill
    rug.fillStyle(0x8b1a1a); rug.fillRoundedRect(32, 86, 264, 158, 10);
    // Inner field (slightly lighter red)
    rug.fillStyle(0xb02020); rug.fillRoundedRect(46, 98, 236, 134, 6);
    // Outer border frame (dark)
    rug.fillStyle(0x500a0a);
    rug.fillRect(46, 98, 236, 3); rug.fillRect(46, 229, 236, 3);
    rug.fillRect(46, 98, 3, 134); rug.fillRect(279, 98, 3, 134);
    // Inner border frame (gold)
    rug.fillStyle(0xd4941e);
    rug.fillRect(56, 106, 216, 2); rug.fillRect(56, 222, 216, 2);
    rug.fillRect(56, 106, 2, 118); rug.fillRect(270, 106, 2, 118);
    // Diamond key motifs along top/bottom border
    rug.fillStyle(0xe8b030);
    for (let bx = 68; bx < 270; bx += 16) {
      rug.fillRect(bx, 108, 4, 4); rug.fillRect(bx + 2, 106, 4, 4);   // top
      rug.fillRect(bx, 218, 4, 4); rug.fillRect(bx + 2, 220, 4, 4);   // bottom
    }
    // Diamond key motifs along left/right border
    for (let by = 118; by < 218; by += 16) {
      rug.fillRect(58, by, 4, 4);   // left
      rug.fillRect(266, by, 4, 4);  // right
    }
    // Center medallion — concentric ovals
    rug.fillStyle(0x6a1010); rug.fillEllipse(164, 165, 100, 72);
    rug.fillStyle(0xc83030); rug.fillEllipse(164, 165, 84, 58);
    rug.fillStyle(0xd4941e); rug.fillEllipse(164, 165, 68, 42);
    rug.fillStyle(0xb02020); rug.fillEllipse(164, 165, 50, 28);
    // Center rosette
    rug.fillStyle(0xe8b030); rug.fillCircle(164, 165, 10);
    rug.fillStyle(0x500a0a); rug.fillCircle(164, 165, 6);
    rug.fillStyle(0xd4941e); rug.fillCircle(164, 165, 3);
    // Spoke petals radiating from medallion
    rug.fillStyle(0xe8b030);
    for (let sp = 0; sp < 8; sp++) {
      const ang = sp * Math.PI / 4;
      const px = Math.round(164 + Math.cos(ang) * 22);
      const py = Math.round(165 + Math.sin(ang) * 14);
      rug.fillRect(px - 2, py - 2, 4, 4);
    }
    // Corner ornaments
    rug.fillStyle(0xe8b030);
    const rugCorners: [number, number][] = [[64,114],[268,114],[64,214],[268,214]];
    for (const [cx, cy] of rugCorners) {
      rug.fillRect(cx - 5, cy - 1, 10, 2);
      rug.fillRect(cx - 1, cy - 5, 2, 10);
      rug.fillRect(cx - 3, cy - 3, 6, 6);
      rug.fillStyle(0x500a0a); rug.fillRect(cx - 1, cy - 1, 2, 2);
      rug.fillStyle(0xe8b030);
    }
    rug.setDepth(0.5);

    // ── Kitchen floor mat ────────────────────────────────────────────────────
    const mat = this.add.graphics();
    mat.fillStyle(0x3a5a2a); mat.fillRoundedRect(42, 445, 135, 96, 6);
    mat.fillStyle(0x4a7038); mat.fillRoundedRect(50, 452, 119, 82, 4);
    // Mat stripe detail
    mat.fillStyle(0x5a8048);
    for (let ms = 0; ms < 6; ms++) mat.fillRect(55, 460 + ms * 12, 109, 4);
    mat.setDepth(0.5);

    // ── Patio tiles ──────────────────────────────────────────────────────────
    const patio = this.add.graphics();
    patio.fillStyle(0x9a9080); patio.fillRect(492, 424, 80, 154);
    patio.fillStyle(0x888070);
    for (let py = 424; py < 578; py += 26) patio.fillRect(492, py, 80, 2);
    for (let px = 492; px < 572; px += 26) patio.fillRect(px, 424, 2, 154);
    // Patio edge shadow
    patio.fillStyle(0x707060); patio.fillRect(492, 575, 80, 3); patio.fillRect(569, 424, 3, 154);
    patio.setDepth(0.5);

    // ── Fence posts on room divider wall ────────────────────────────────────
    for (let fy = 28; fy <= 405; fy += 28)
      this.add.rectangle(492, fy + 12, 5, 22, 0xb89050).setDepth(fy + 22);
    for (let fy = 588; fy <= 738; fy += 28)
      this.add.rectangle(492, fy + 12, 5, 22, 0xb89050).setDepth(fy + 22);
    this.add.rectangle(492, 428, 7, 20, 0x906030).setDepth(438);
    this.add.rectangle(492, 572, 7, 20, 0x906030).setDepth(582);

    // ── Decorative trees (yard) ───────────────────────────────────────────────
    this.ensureTexture('tree', 48, 48, (gfx) => {
      gfx.fillStyle(0x7a5030); gfx.fillRect(21, 30, 6, 14);
      gfx.fillStyle(0x6a4020); gfx.fillRect(22, 30, 1, 14); gfx.fillRect(25, 32, 1, 10);
      gfx.fillStyle(0x1c5c1c); gfx.fillCircle(24, 20, 18);
      gfx.fillStyle(0x2a7830); gfx.fillCircle(24, 18, 15);
      gfx.fillStyle(0x38922a);
      gfx.fillCircle(16, 16, 7); gfx.fillCircle(30, 15, 8);
      gfx.fillCircle(22, 10, 7); gfx.fillCircle(28, 22, 6);
      gfx.fillStyle(0x58b840);
      gfx.fillCircle(18, 12, 5); gfx.fillCircle(26, 11, 4);
    });
    for (const tp of [{ x: 632, y: 300 }, { x: 882, y: 345 }])
      this.add.image(tp.x, tp.y, 'tree').setDepth(tp.y + 18);

    // ── Wall art / picture frames (living room) ───────────────────────────────
    // Frame: dark border, white mat, small coloured "painting"
    const frames = [
      { x: 270, y: 60, fw: 40, fh: 30 },   // above bookshelf wall
      { x: 190, y: 60, fw: 36, fh: 28 },   // second painting
    ];
    for (const f of frames) {
      this.add.rectangle(f.x, f.y, f.fw, f.fh, 0x3a2a18).setDepth(0.6);
      this.add.rectangle(f.x, f.y, f.fw - 4, f.fh - 4, 0xf0e8d8).setDepth(0.7);
      this.add.rectangle(f.x - 2, f.y - 2, f.fw - 12, f.fh - 12, 0x5080a0).setDepth(0.8);
    }

    // ── Floor lamp (near couch) ───────────────────────────────────────────────
    const lamp = this.add.graphics();
    lamp.fillStyle(0x404040); lamp.fillRect(228, 80, 4, 32); // pole
    lamp.fillStyle(0xffee88); lamp.fillEllipse(230, 80, 22, 12); // shade
    lamp.fillStyle(0xcc8800); lamp.fillRect(224, 108, 12, 4); // base
    lamp.setDepth(115);

    // ── Potted plant near bookshelf ───────────────────────────────────────────
    const plant = this.add.graphics();
    plant.fillStyle(0x804020); plant.fillRect(330, 155, 14, 12); // pot
    plant.fillStyle(0x603010); plant.fillRect(328, 163, 18, 4); // pot rim
    plant.fillStyle(0x208020); plant.fillCircle(337, 148, 9);
    plant.fillStyle(0x30a030); plant.fillCircle(333, 144, 6); plant.fillCircle(341, 145, 7);
    plant.fillStyle(0x50c050); plant.fillCircle(335, 140, 4); plant.fillCircle(341, 141, 4);
    plant.setDepth(165);

    // ── Window light rays (exterior wall windows) ─────────────────────────────
    const wlight = this.add.graphics();
    wlight.fillStyle(0xffffcc, 0.12);
    // Two windows on east wall (exterior side)
    wlight.fillRect(600, 90, 40, 70);  // window glow patch
    wlight.fillRect(760, 120, 40, 60);
    // Interior light pools (very faint yellow on floor)
    wlight.fillStyle(0xffffc8, 0.06);
    wlight.fillRect(605, 160, 35, 50);
    wlight.fillRect(765, 180, 35, 40);
    wlight.setDepth(0.4);

    // ── Doormat at front entry ────────────────────────────────────────────────
    const dmat = this.add.graphics();
    dmat.fillStyle(0x4a3a28); dmat.fillRoundedRect(38, 730, 50, 30, 4);
    dmat.fillStyle(0x6a5038); dmat.fillRoundedRect(42, 734, 42, 22, 3);
    // Stripe on doormat
    dmat.fillStyle(0x8a6848);
    for (let ds = 0; ds < 4; ds++) dmat.fillRect(44, 736 + ds * 5, 38, 3);
    dmat.setDepth(0.5);

    // ── Baseboard trim overlay (non-physics) ──────────────────────────────────
    // Draw a cream highlight strip along every interior-facing wall edge.
    // Depth 0.45 → sits above the ground tilemap but below all furniture.
    const brd = this.add.graphics();
    brd.fillStyle(0xf8f4e8); // bright cream matching the new wall top highlight
    // Top outer wall — room-side face at y=20
    brd.fillRect(20, 18, 354, 3);    // living-room west section
    brd.fillRect(390, 18, 100, 3);   // hallway gap
    brd.fillRect(506, 18, 498, 3);   // east yard section
    // Bottom outer wall — room-side face at y=748
    brd.fillRect(20, 748, 470, 3);
    brd.fillRect(506, 748, 498, 3);
    // Left outer wall — room-side face at x=20
    brd.fillRect(18, 20, 3, 372);    // above room divider
    brd.fillRect(18, 408, 3, 340);   // below room divider
    // Right outer wall — room-side face at x=1004
    brd.fillRect(1003, 20, 3, 728);
    // Room divider (x=20-150, y=392-408) — both faces
    brd.fillRect(20, 390, 130, 3);   // north face
    brd.fillRect(20, 406, 130, 3);   // south face
    // Hallway-L1 (x=374-390, y=20-100) — both faces
    brd.fillRect(371, 20, 3, 80);
    brd.fillRect(390, 20, 3, 80);
    // Hallway-L2 (x=374-390, y=220-420) — both faces
    brd.fillRect(371, 220, 3, 200);
    brd.fillRect(390, 220, 3, 200);
    // Exterior-N (x=490-506, y=20-420) — both faces
    brd.fillRect(487, 20, 3, 400);
    brd.fillRect(506, 20, 3, 400);
    // Exterior-S (x=490-506, y=580-748) — both faces
    brd.fillRect(487, 580, 3, 168);
    brd.fillRect(506, 580, 3, 168);
    // Baseboard cap shadow (dark line, 1px, just below trim)
    brd.fillStyle(0x8a8060);
    brd.fillRect(20, 21, 354, 1); brd.fillRect(390, 21, 100, 1); brd.fillRect(506, 21, 498, 1);
    brd.fillRect(20, 750, 470, 1); brd.fillRect(506, 750, 498, 1);
    brd.setDepth(0.45);

    // ── Furniture ambient-occlusion shadows ───────────────────────────────────
    // Each piece gets its own graphics at depth (rect_depth - 0.2) so shadows
    // sort correctly relative to nearby objects. Offset +3,+4 fakes a top-left
    // light source casting shadow down-right.
    const aoItems = [
      // [x, y, w, h, rect_depth]
      [30, 50, 180, 70, 85],   // couch     rect y=50 h=70  → depth 85
      [50, 240, 120, 80, 280], // table     rect y=240 h=80 → depth 280
      [295, 50, 70, 120, 110], // bookshelf rect y=50 h=120 → depth 110
      [40, 450, 140, 100, 500],// k-table   rect y=450 h=100→ depth 500
      [550, 60, 80, 80, 100],  // bush-NE   depth 100
      [740, 80, 90, 90, 125],  // bush-N    depth 125
      [750, 480, 90, 70, 515], // bush-S    depth 515
      [870, 620, 120, 120, 680]// shed      depth 680
    ] as const;
    for (const [rx, ry, rw, rh, rdepth] of aoItems) {
      const sg = this.add.graphics();
      sg.fillStyle(0x000000, 0.20);
      sg.fillRect(rx + 4, ry + 6, rw, rh);  // shadow offset
      sg.setDepth(rdepth - 0.2);
    }

    // ── Furniture surface toppers ─────────────────────────────────────────────
    // These are cosmetic only — no physics. Drawn on top of each furniture
    // sprite at depth + 0.5.

    // Couch toppers (depth 85.5) — arm-top highlight strips
    const ctop = this.add.graphics();
    // Left armrest top-face (brighter to suggest 3D)
    ctop.fillStyle(0x6070b4); ctop.fillRect(30, 50, 6, 70);
    ctop.fillStyle(0x7888cc); ctop.fillRect(30, 50, 6, 4);
    // Right armrest top-face
    ctop.fillStyle(0x6070b4); ctop.fillRect(204, 50, 6, 70);
    ctop.fillStyle(0x7888cc); ctop.fillRect(204, 50, 6, 4);
    // Back-rest top rim (bright strip at very back of couch)
    ctop.fillStyle(0x8090cc); ctop.fillRect(36, 50, 168, 4);
    ctop.setDepth(85.5);

    // Coffee-table toppers (depth 280.5) — glass rim + tabletop gloss strip
    const ttop = this.add.graphics();
    // Gloss strip across the table surface (diagonal band suggesting polish)
    ttop.fillStyle(0xffd870, 0.4); ttop.fillRect(50, 240, 120, 6);
    ttop.fillStyle(0xffe890, 0.25); ttop.fillRect(50, 246, 120, 4);
    ttop.setDepth(280.5);

    // Kitchen-table toppers (depth 500.5) — 4 place mats + table runner
    const ktop = this.add.graphics();
    const matC = 0x6a8a50;
    // Place mats (ovals near each of the 4 sides of the table)
    ktop.fillStyle(matC);
    ktop.fillEllipse(110,  460, 55, 22); // top seat
    ktop.fillEllipse(110,  540, 55, 22); // bottom seat
    ktop.fillEllipse(55,   500, 22, 55); // left seat
    ktop.fillEllipse(165,  500, 22, 55); // right seat
    // Mat highlight
    ktop.fillStyle(0x8aaa70);
    ktop.fillEllipse(109, 459, 45, 14);
    ktop.fillEllipse(109, 539, 45, 14);
    // Cutlery (tiny grey lines beside each mat)
    ktop.fillStyle(0xb0a888);
    ktop.fillRect(98, 452, 1, 10); ktop.fillRect(120, 452, 1, 10); // top — fork/knife
    ktop.fillRect(98, 532, 1, 10); ktop.fillRect(120, 532, 1, 10); // bottom
    ktop.setDepth(500.5);

    // Bookshelf topper (depth 110.5) — very top edge highlight + tiny plant
    const bstop = this.add.graphics();
    // Shelf-top highlight (brightest edge of the bookcase)
    bstop.fillStyle(0x6a5038); bstop.fillRect(295, 50, 70, 3);
    bstop.fillStyle(0x8a6848); bstop.fillRect(295, 50, 70, 1);
    // Tiny succulent / plant on top
    bstop.fillStyle(0x703820); bstop.fillRect(318, 52, 14, 9);  // pot
    bstop.fillStyle(0x501a08); bstop.fillRect(316, 58, 18, 3);  // pot rim
    bstop.fillStyle(0x208020); bstop.fillCircle(325, 47, 8);
    bstop.fillStyle(0x30a030); bstop.fillCircle(321, 44, 5);
    bstop.fillStyle(0x30a030); bstop.fillCircle(329, 44, 5);
    bstop.fillStyle(0x50c050); bstop.fillCircle(325, 41, 4);
    bstop.setDepth(110.5);

    // ── Hallway runner rug ────────────────────────────────────────────────────
    // Centered in the walkable corridor (x=390-490, center x=440).
    // Two sections: between L1/L2 wall gaps (y=102-216) and south of L2 (y=422-744).
    const runner = this.add.graphics();
    // Navy base
    runner.fillStyle(0x1c2b5e);
    runner.fillRoundedRect(428, 422, 24, 322, 4);  // long south run
    runner.fillRoundedRect(428, 102, 24, 114, 4);  // central gap section
    // Teal inner stripe
    runner.fillStyle(0x2a7a7a);
    runner.fillRect(433, 426, 14, 314);
    runner.fillRect(433, 106, 14, 106);
    // Gold border stripes (both sides)
    runner.fillStyle(0xd4a820);
    runner.fillRect(431, 426, 1, 314); runner.fillRect(447, 426, 1, 314);
    runner.fillRect(431, 106, 1, 106); runner.fillRect(447, 106, 1, 106);
    // Geometric cross motifs
    runner.fillStyle(0xf0cc50);
    for (let ry = 440; ry < 742; ry += 28) {
      runner.fillRect(436, ry, 8, 2);
      runner.fillRect(439, ry - 3, 2, 8);
    }
    for (let ry = 116; ry < 212; ry += 28) {
      runner.fillRect(436, ry, 8, 2);
      runner.fillRect(439, ry - 3, 2, 8);
    }
    // End caps (fringe hints)
    runner.fillStyle(0xd4a820);
    runner.fillRect(429, 423, 22, 2); runner.fillRect(429, 743, 22, 2);
    runner.fillRect(429, 103, 22, 2); runner.fillRect(429, 215, 22, 2);
    runner.setDepth(0.5);

    // ── Outdoor flower clusters ───────────────────────────────────────────────
    // Decorative only, depth 0.55, no physics. Avoids bushes/trees:
    //   bush1(550-630,60-140), bush2(740-830,80-170), bush3(750-840,480-550),
    //   bush-shed(870-990,620-740), tree1(632,300)±24, tree2(882,345)±24.
    const drawFlower = (
      fg: Phaser.GameObjects.Graphics,
      fx: number, fy: number, col: number, sz: number,
    ) => {
      fg.fillStyle(col);
      fg.fillEllipse(fx,      fy - sz, sz * 1.4, sz * 2.0);
      fg.fillEllipse(fx,      fy + sz, sz * 1.4, sz * 2.0);
      fg.fillEllipse(fx - sz, fy,      sz * 2.0, sz * 1.4);
      fg.fillEllipse(fx + sz, fy,      sz * 2.0, sz * 1.4);
      fg.fillStyle(0xffe060);
      fg.fillCircle(fx, fy, sz * 0.7);
    };
    const fl = this.add.graphics();
    // Cluster A — south border, clear of shed (x<870): pink
    for (const [fx, fy] of [[525,730],[552,724],[582,732],[618,726],[652,735],[688,728]] as [number,number][])
      drawFlower(fl, fx, fy, 0xff69b4, 3);
    // Cluster B — north yard east of bush1 (x>636, y<56): purple
    for (const [fx, fy] of [[648,28],[676,38],[706,28],[734,40]] as [number,number][])
      drawFlower(fl, fx, fy, 0xcc44cc, 3);
    // Cluster C — mid-east yard north (x>836, y=190-300, clear of tree2 at 882,345): red-pink
    for (const [fx, fy] of [[842,210],[874,228],[912,208],[948,222],[978,212]] as [number,number][])
      drawFlower(fl, fx, fy, 0xff3355, 3);
    // Cluster D — mid yard above bush3 (y<478, x=520-700): magenta
    for (const [fx, fy] of [[526,408],[558,422],[592,406],[628,418],[668,408],[700,422]] as [number,number][])
      drawFlower(fl, fx, fy, 0xee4488, 3);
    // Cluster E — south-east of tree2 (x>910, y=380-460): violet
    for (const [fx, fy] of [[918,385],[948,400],[978,384],[988,418]] as [number,number][])
      drawFlower(fl, fx, fy, 0xbb22dd, 3);
    fl.setDepth(0.55);
  }

  private buildDecorativesWaterPark(): void {
    // Pool rect: x=100,y=200,w=380,h=260  (furniture depth = 200+130 = 330)
    // Wading pool: x=120,y=700,w=200,h=160  (depth = 780)
    // Slide tower: x=580,y=160,w=120,h=120  (depth = 220)
    // Snack stand: x=900,y=80,w=160,h=120   (depth = 140)

    // ── Stone tile border around main pool ────────────────────────────────────
    const poolBorder = this.add.graphics();
    poolBorder.fillStyle(0xddd5c2); poolBorder.fillRect(82, 186, 418, 290);
    // Tile grid on border
    poolBorder.fillStyle(0xccc4b0);
    for (let bx = 82; bx < 500; bx += 18) poolBorder.fillRect(bx, 186, 1, 290);
    for (let by = 186; by < 476; by += 18) poolBorder.fillRect(82, by, 418, 1);
    // Inner pool-edge shadow
    poolBorder.fillStyle(0x003a55, 1.0);
    poolBorder.fillRect(100, 200, 380, 5);
    poolBorder.fillRect(100, 200, 5, 260);
    poolBorder.fillRect(475, 200, 5, 260);
    poolBorder.fillRect(100, 455, 380, 5);
    poolBorder.setDepth(1);

    // ── Water shimmer overlay (above pool sprite) ─────────────────────────────
    const shimmer = this.add.graphics();
    shimmer.fillStyle(0x88ddff, 1.0);
    const shimPts: [number,number,number,number][] = [
      [118,218,58,9],[205,228,72,7],[325,214,48,11],[402,232,55,8],
      [132,288,44,6],[258,298,68,9],[375,290,50,7],[148,358,76,8],
      [285,368,58,7],[408,348,48,10],[124,428,52,7],[228,438,70,6],[348,418,60,8],
    ];
    for (const [sx,sy,sw,sh] of shimPts) shimmer.fillRect(sx, sy, sw, sh);
    shimmer.setDepth(331);
    this.tweens.add({ targets: shimmer, alpha: 0.08, duration: 1800,
      ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // ── Pool lane rope dividers ───────────────────────────────────────────────
    const lanes = this.add.graphics();
    lanes.fillStyle(0xffffff, 0.7);
    for (let lx = 163; lx < 480; lx += 64) lanes.fillRect(lx - 1, 204, 2, 252);
    // Buoy floats — red then white, alternating
    const buoyRed = this.add.graphics();
    buoyRed.fillStyle(0xdd2222);
    const buoyWht = this.add.graphics();
    buoyWht.fillStyle(0xffffff);
    for (let lx = 163; lx < 480; lx += 64) {
      for (let ly = 212; ly < 456; ly += 26) buoyRed.fillCircle(lx, ly, 4);
      for (let ly = 225; ly < 456; ly += 26) buoyWht.fillCircle(lx, ly, 4);
    }
    // Depth marker tiles at pool corners
    lanes.fillStyle(0xffcc00);
    lanes.fillRect(100, 200, 12, 5); lanes.fillRect(100, 454, 12, 5);
    lanes.fillRect(466, 200, 12, 5); lanes.fillRect(466, 454, 12, 5);
    lanes.setDepth(332); buoyRed.setDepth(332); buoyWht.setDepth(332);

    // ── Pool ladder at south edge ─────────────────────────────────────────────
    const ladder = this.add.graphics();
    ladder.fillStyle(0xc0c0c0);
    ladder.fillRect(108, 446, 5, 22); ladder.fillRect(127, 446, 5, 22);
    ladder.fillStyle(0xd8d8d8);
    ladder.fillRect(109, 446, 2, 22); ladder.fillRect(128, 446, 2, 22);
    ladder.fillStyle(0xaaaaaa);
    ladder.fillRect(108, 452, 24, 2); ladder.fillRect(108, 459, 24, 2);
    ladder.fillRect(108, 465, 24, 2);
    ladder.setDepth(470);

    // ── Swimmers in pool ──────────────────────────────────────────────────────
    const swimmerData: { x: number; y: number; capColor: number }[] = [
      { x: 152, y: 262, capColor: 0xee2222 },
      { x: 256, y: 315, capColor: 0x2255ee },
      { x: 348, y: 242, capColor: 0xeeaa00 },
      { x: 423, y: 372, capColor: 0x22aa55 },
      { x: 192, y: 412, capColor: 0xcc22cc },
      { x: 318, y: 435, capColor: 0x00aaee },
    ];
    for (let i = 0; i < swimmerData.length; i++) {
      const sd = swimmerData[i];
      const sw = this.add.graphics();
      // Wake (water disturbance behind swimmer)
      sw.fillStyle(0x55ccee, 0.55); sw.fillEllipse(0, 5, 22, 9);
      // Arms
      sw.fillStyle(0xf0c090);
      sw.fillEllipse(-10, 3, 12, 6); sw.fillEllipse(10, 3, 12, 6);
      // Head
      sw.fillStyle(0xf4c890); sw.fillCircle(0, 0, 7);
      // Swim cap
      sw.fillStyle(sd.capColor); sw.fillEllipse(0, -2, 14, 10);
      sw.fillStyle(0xffffff, 0.35); sw.fillEllipse(-2, -4, 5, 3); // cap glint
      // Goggles
      sw.fillStyle(0x202040);
      sw.fillRect(-4, 1, 3, 2); sw.fillRect(2, 1, 3, 2);
      sw.fillStyle(0x88ccff, 0.55);
      sw.fillRect(-3, 1, 2, 1); sw.fillRect(3, 1, 2, 1);
      sw.setPosition(sd.x, sd.y);
      sw.setDepth(sd.y + 5);
      // Bob animation
      this.tweens.add({
        targets: sw, y: sd.y + 4,
        duration: 1600 + i * 220,
        ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: i * 310,
      });
    }

    // ── Periodic splash rings ─────────────────────────────────────────────────
    const spawnSplash = () => {
      const sx = 115 + Math.random() * 358;
      const sy = 212 + Math.random() * 238;
      const ring = this.add.graphics();
      ring.setPosition(sx, sy);
      ring.lineStyle(1.5, 0xaaddff, 1.0);
      ring.strokeCircle(0, 0, 4);
      ring.setDepth(336);
      this.tweens.add({
        targets: ring, scaleX: 5, scaleY: 5, alpha: 0,
        duration: 900, ease: 'Quad.Out',
        onComplete: () => ring.destroy(),
      });
    };
    this.time.addEvent({ delay: 2100, loop: true, callback: spawnSplash });
    this.time.addEvent({ delay: 3500, loop: true, callback: spawnSplash });

    // ── Pool inflatables ──────────────────────────────────────────────────────
    // Pink inflatable ring
    const inflatRing = this.add.graphics();
    inflatRing.fillStyle(0xff4488); inflatRing.fillCircle(232, 382, 15);
    inflatRing.fillStyle(0xff88bb); inflatRing.fillEllipse(228, 377, 10, 6); // highlight
    inflatRing.fillStyle(0x0088bb, 0.75); inflatRing.fillCircle(232, 382, 8); // hole
    inflatRing.fillStyle(0x33aadd, 0.5); inflatRing.fillEllipse(229, 379, 6, 4);
    inflatRing.setDepth(392);
    this.tweens.add({ targets: inflatRing, y: 4, duration: 2100,
      ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // Rubber duck
    const duck = this.add.graphics();
    duck.fillStyle(0xffffaa, 0.5); duck.fillEllipse(392, 308, 24, 8); // water reflection
    duck.fillStyle(0xffdd00); duck.fillCircle(392, 302, 10);           // body
    duck.fillStyle(0xffee55); duck.fillEllipse(392, 298, 14, 5);       // body highlight
    duck.fillStyle(0xffee44); duck.fillCircle(387, 293, 7);            // head
    duck.fillStyle(0xff8800); duck.fillRect(384, 291, 7, 3);           // beak
    duck.fillStyle(0xffd040); duck.fillRect(384, 291, 7, 1);           // beak top highlight
    duck.fillStyle(0x201010); duck.fillCircle(385, 291, 1.5);          // eye
    duck.fillStyle(0xffffff); duck.fillCircle(384, 290, 0.7);          // eye glint
    duck.setDepth(314);
    this.tweens.add({ targets: duck, y: 3, duration: 2500,
      ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 400 });

    // ── Wet footprint trail from pool exit ────────────────────────────────────
    const footprints = this.add.graphics();
    footprints.fillStyle(0xaaccdd, 0.4);
    for (let fp = 0; fp < 10; fp++) {
      const foff = fp % 2 === 0 ? -7 : 7;
      footprints.fillEllipse(212 + foff, 468 + fp * 20, 9, 13);
    }
    footprints.setDepth(0.55);

    // ── Connecting path from pool to wading pool ──────────────────────────────
    const walkpath = this.add.graphics();
    walkpath.fillStyle(0xc8b898, 0.8); walkpath.fillRect(178, 462, 62, 242);
    walkpath.fillStyle(0xb8a888, 0.5);
    for (let pd = 474; pd < 702; pd += 22) walkpath.fillRect(183, pd, 52, 8);
    // Non-slip grip dots
    walkpath.fillStyle(0xa89878, 0.5);
    for (let pd = 480; pd < 700; pd += 22)
      for (let dx = 0; dx < 4; dx++) walkpath.fillCircle(190 + dx * 11, pd + 4, 2);
    walkpath.setDepth(0.5);

    // ── Scattered towels near lounge chairs ───────────────────────────────────
    type TowelSpec = { x: number; y: number; w: number; h: number; col: number; sc: number };
    const towelSpecs: TowelSpec[] = [
      { x: 148, y: 152, w: 54, h: 15, col: 0x2266dd, sc: 0xffffff },
      { x: 252, y: 148, w: 54, h: 15, col: 0xee2222, sc: 0xffee00 },
      { x: 357, y: 154, w: 54, h: 15, col: 0x22aa66, sc: 0xffffff },
      { x: 460, y: 150, w: 54, h: 15, col: 0xee8800, sc: 0xffffff },
      { x: 148, y: 505, w: 54, h: 15, col: 0x9922dd, sc: 0xffccff },
      { x: 252, y: 505, w: 54, h: 15, col: 0x2299cc, sc: 0xffffff },
      { x: 357, y: 505, w: 54, h: 15, col: 0x22cc44, sc: 0xffff88 },
    ];
    for (const t of towelSpecs) {
      const tw = this.add.graphics();
      tw.fillStyle(t.col); tw.fillRoundedRect(t.x - t.w/2, t.y - t.h/2, t.w, t.h, 3);
      tw.fillStyle(t.sc, 0.45);
      for (let ts = 0; ts < t.w - 4; ts += 10)
        tw.fillRect(t.x - t.w/2 + ts + 4, t.y - t.h/2, 4, t.h);
      // Fringe
      tw.fillStyle(t.col, 0.65);
      for (let tf = 0; tf < t.h; tf += 3)
        tw.fillRect(t.x + t.w/2, t.y - t.h/2 + tf, 5, 2);
      tw.setDepth(t.y + 10);
    }

    // ── Umbrellas over lounge chairs ──────────────────────────────────────────
    const umbrellaCols = [0xcc2222, 0x2266cc, 0x22aa44, 0xcc8800, 0xcc2266, 0x6622cc, 0x22aacc];
    const umbPos = [
      { x: 148, y: 120 }, { x: 250, y: 120 }, { x: 352, y: 120 }, { x: 454, y: 120 },
      { x: 148, y: 480 }, { x: 250, y: 480 }, { x: 352, y: 480 },
    ];
    for (let i = 0; i < umbPos.length; i++) {
      const up = umbPos[i]; const col = umbrellaCols[i];
      this.add.rectangle(up.x + 1, up.y + 10, 2, 22, 0x000000, 0.18).setDepth(up.y - 6);
      this.add.rectangle(up.x, up.y + 8,  2, 20, 0x909090).setDepth(up.y - 5);
      const umb = this.add.graphics();
      umb.fillStyle(col, 0.92); umb.fillEllipse(up.x, up.y - 2, 36, 15);
      umb.fillStyle(0xffffff, 0.38);
      umb.fillRect(up.x - 16, up.y - 7, 6, 11);
      umb.fillRect(up.x - 1,  up.y - 7, 6, 11);
      umb.fillRect(up.x + 13, up.y - 7, 5, 11);
      umb.fillStyle(0x000000, 0.12); umb.fillEllipse(up.x, up.y + 6, 38, 8);
      umb.setDepth(up.y - 4);
    }

    // ── Ice cream stand — detailed props ──────────────────────────────────────
    // Stand rect: x=900,y=80,w=160,h=120  depth=140
    // Awning fringe along south face (y≈200)
    const fringe = this.add.graphics();
    fringe.fillStyle(0xdd2020);
    for (let ax = 900; ax < 1060; ax += 10)
      fringe.fillTriangle(ax, 198, ax + 5, 210, ax + 10, 198);
    fringe.fillStyle(0xffffff);
    for (let ax = 905; ax < 1060; ax += 10)
      fringe.fillTriangle(ax, 198, ax + 4, 208, ax - 1, 198);
    fringe.setDepth(141);

    // Counter display: 3 ice cream cones
    const cones = this.add.graphics();
    // Cone 1 — vanilla
    cones.fillStyle(0xd4a860); cones.fillTriangle(924, 191, 932, 202, 940, 191);
    cones.fillStyle(0xb8903a, 0.55);
    cones.fillRect(924, 194, 16, 1); cones.fillRect(928, 191, 1, 11); cones.fillRect(934, 191, 1, 11);
    cones.fillStyle(0xfffae0); cones.fillCircle(932, 186, 7);
    cones.fillStyle(0xfff0c0); cones.fillCircle(930, 183, 4);
    cones.fillStyle(0xffffff, 0.5); cones.fillEllipse(929, 181, 4, 2);
    // Cone 2 — strawberry
    cones.fillStyle(0xd4a860); cones.fillTriangle(948, 191, 956, 202, 964, 191);
    cones.fillStyle(0xff8888); cones.fillCircle(956, 186, 7);
    cones.fillStyle(0xff6666); cones.fillCircle(954, 183, 4);
    cones.fillStyle(0xffcccc, 0.5); cones.fillEllipse(953, 181, 4, 2);
    // Cone 3 — chocolate + sprinkles
    cones.fillStyle(0xd4a860); cones.fillTriangle(972, 191, 980, 202, 988, 191);
    cones.fillStyle(0x8b4513); cones.fillCircle(980, 186, 7);
    cones.fillStyle(0x7a3a0a); cones.fillCircle(978, 183, 4);
    cones.fillStyle(0xffffff, 0.45); cones.fillEllipse(977, 181, 4, 2);
    cones.fillStyle(0xee2222); cones.fillRect(976, 181, 2, 1);
    cones.fillStyle(0xffee00); cones.fillRect(981, 184, 2, 1);
    cones.fillStyle(0x44aaff); cones.fillRect(984, 182, 2, 1);
    cones.setDepth(201);

    // Price/menu board above stand
    const menuBoard = this.add.graphics();
    menuBoard.fillStyle(0x3a2810); menuBoard.fillRect(908, 63, 84, 42);
    menuBoard.fillStyle(0xfff8e0); menuBoard.fillRect(912, 66, 76, 36);
    // Simulated price-list lines
    menuBoard.fillStyle(0xee2222); menuBoard.fillRect(915, 70, 6, 3);
    menuBoard.fillStyle(0x222222); menuBoard.fillRect(924, 70, 32, 3); menuBoard.fillRect(958, 70, 9, 3);
    menuBoard.fillStyle(0xff7777); menuBoard.fillRect(915, 79, 6, 3);
    menuBoard.fillStyle(0x222222); menuBoard.fillRect(924, 79, 28, 3); menuBoard.fillRect(958, 79, 9, 3);
    menuBoard.fillStyle(0x8b4513); menuBoard.fillRect(915, 88, 6, 3);
    menuBoard.fillStyle(0x222222); menuBoard.fillRect(924, 88, 30, 3); menuBoard.fillRect(958, 88, 9, 3);
    menuBoard.setDepth(142);
    this.add.rectangle(950, 72, 3, 12, 0x605030).setDepth(141); // board pole

    // Ice cream cone signpost on east side of stand
    const signPole = this.add.graphics();
    signPole.fillStyle(0x808080); signPole.fillRect(1056, 88, 4, 42);
    signPole.fillStyle(0xd4a860); signPole.fillTriangle(1048, 108, 1060, 124, 1072, 108);
    signPole.fillStyle(0xff99cc); signPole.fillCircle(1060, 100, 13);
    signPole.fillStyle(0xff77aa); signPole.fillCircle(1058, 97, 8);
    signPole.fillStyle(0xffffff, 0.45); signPole.fillCircle(1055, 94, 4);
    signPole.setDepth(130);

    // Condiment/napkin table to the left of stand
    const condTable = this.add.graphics();
    condTable.fillStyle(0xe8dcc8); condTable.fillRect(868, 144, 30, 50);
    condTable.fillStyle(0xd8ccb8); condTable.fillRect(868, 144, 30, 3);
    // Napkin holder (small white box)
    condTable.fillStyle(0xffffff); condTable.fillRect(874, 148, 12, 10);
    condTable.fillStyle(0xeeeeee); condTable.fillRect(876, 149, 8, 8);
    // Ketchup bottle
    condTable.fillStyle(0xdd1111); condTable.fillRect(876, 162, 6, 16);
    condTable.fillStyle(0xffd700); condTable.fillRect(877, 160, 4, 4);
    condTable.setDepth(194);

    // Trash can
    const trash = this.add.graphics();
    trash.fillStyle(0x507050); trash.fillRect(1062, 206, 24, 28);
    trash.fillStyle(0x406040); trash.fillRect(1060, 206, 28, 5);  // lid
    trash.fillStyle(0x3a5a3a); trash.fillRect(1061, 208, 26, 3);  // lid groove
    trash.fillStyle(0x608060); trash.fillRect(1064, 212, 20, 20); // body
    trash.fillStyle(0x487048); trash.fillRect(1064, 212, 2, 20);  // body edge highlight
    trash.fillStyle(0x406040); trash.fillRect(1062, 232, 24, 2);  // base
    trash.setDepth(235);

    // ── "NO RUNNING" sign ────────────────────────────────────────────────────
    this.add.rectangle(504, 180, 3, 32, 0x505050).setDepth(200);
    this.add.rectangle(504, 165, 46, 24, 0xffffff).setDepth(201);
    this.add.rectangle(504, 165, 44, 22, 0x1a44aa).setDepth(202);
    this.add.text(504, 165, 'NO\nRUNNING', {
      fontSize: '7px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setDepth(203);

    // "POOL OPEN" sign
    this.add.rectangle(544, 170, 3, 28, 0x505050).setDepth(200);
    this.add.rectangle(544, 157, 52, 24, 0x207a20).setDepth(201);
    this.add.text(544, 157, 'POOL\nOPEN', {
      fontSize: '7px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setDepth(202);

    // Stand name text
    this.add.text(980, 100, 'ICE CREAM', {
      fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(202);

    // ── Life preserver rings ──────────────────────────────────────────────────
    const drawLifeRing = (
      gfx: Phaser.GameObjects.Graphics, cx: number, cy: number, r1: number, col: number,
    ) => {
      gfx.fillStyle(col);    gfx.fillCircle(cx, cy, r1);
      gfx.fillStyle(0xffffff); gfx.fillCircle(cx, cy, r1 - 4);
      gfx.fillStyle(col);
      gfx.fillRect(cx - 4, cy - r1 - 2, 8, 4); gfx.fillRect(cx - 4, cy + r1 - 2, 8, 4);
      gfx.fillRect(cx - r1 - 2, cy - 4, 4, 8); gfx.fillRect(cx + r1 - 2, cy - 4, 4, 8);
      gfx.fillStyle(0xffffff); gfx.fillCircle(cx, cy, r1 - 8);
    };
    const lr1 = this.add.graphics(); drawLifeRing(lr1, 94, 330, 13, 0xee2222); lr1.setDepth(340);
    const lr2 = this.add.graphics(); drawLifeRing(lr2, 115, 668, 11, 0xff9900); lr2.setDepth(680);

    // ── Wading pool props ─────────────────────────────────────────────────────
    // Entry steps at north edge of wading pool
    const steps = this.add.graphics();
    steps.fillStyle(0xd8d0c0); steps.fillRect(172, 695, 84, 8);
    steps.fillStyle(0xc8c0b0); steps.fillRect(177, 699, 74, 4);
    steps.fillStyle(0xe0d8c8); steps.fillRect(175, 702, 78, 4);
    steps.fillStyle(0xb0a898); steps.fillRect(172, 702, 3, 4); steps.fillRect(253, 702, 3, 4);
    steps.setDepth(701);

    // Rubber ball in wading pool
    const ball = this.add.graphics();
    ball.fillStyle(0xffffaa, 0.45); ball.fillEllipse(202, 768, 26, 8);
    ball.fillStyle(0xff6622); ball.fillCircle(202, 762, 10);
    ball.fillStyle(0xffeedd); ball.fillEllipse(202, 760, 14, 5);
    ball.fillStyle(0xff4400); ball.fillRect(192, 761, 20, 3);  // equator band
    ball.fillStyle(0xff8844); ball.fillCircle(198, 756, 4);    // upper highlight
    ball.fillStyle(0xffddcc, 0.65); ball.fillCircle(196, 754, 2);
    ball.setDepth(778);
    this.tweens.add({ targets: ball, y: 4, duration: 1900,
      ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 600 });

    // ── Slide: chute + staircase + splash basin ───────────────────────────────
    // Staircase on east side of slide tower (x=700-730, y=160-280)
    const stairs = this.add.graphics();
    stairs.fillStyle(0xe88818);
    for (let st = 0; st < 7; st++) stairs.fillRect(698 + st * 3, 163 + st * 16, 22, 13);
    stairs.fillStyle(0xb86010);
    for (let st = 0; st < 7; st++) stairs.fillRect(698 + st * 3, 174 + st * 16, 22, 2);
    stairs.fillStyle(0xffcc55);
    for (let st = 0; st < 7; st++) stairs.fillRect(699 + st * 3, 163 + st * 16, 10, 1);
    // Railing posts
    stairs.fillStyle(0xdddddd);
    for (let st = 0; st < 7; st++) stairs.fillRect(718 + st * 3, 158 + st * 16, 2, 18);
    // Railing top bar
    stairs.fillStyle(0xcccccc);
    for (let st = 0; st < 6; st++) {
      const x1 = 719 + st * 3; const y1 = 158 + st * 16;
      stairs.fillRect(x1, y1, 5, 1);
    }
    stairs.setDepth(295);

    // Slide chute (blue fibreglass, stepping diagonally SW from tower base)
    const chute = this.add.graphics();
    chute.fillStyle(0x1a88cc);
    for (let cs = 0; cs < 8; cs++) chute.fillRect(592 + cs * 7, 282 + cs * 11, 26, 11);
    chute.fillStyle(0x33aaee, 0.5);
    for (let cs = 0; cs < 8; cs++) chute.fillRect(592 + cs * 7, 282 + cs * 11, 26, 3);
    chute.fillStyle(0x0060aa, 0.45);
    for (let cs = 0; cs < 8; cs++) chute.fillRect(592 + cs * 7, 291 + cs * 11, 26, 2);
    chute.setDepth(305);

    // Splash basin at chute exit
    const splashBasin = this.add.graphics();
    splashBasin.fillStyle(0x003a55, 0.6); splashBasin.fillEllipse(649, 372, 76, 36);
    splashBasin.fillStyle(0x0099cc, 0.8); splashBasin.fillEllipse(649, 372, 62, 28);
    splashBasin.fillStyle(0x44ccee, 0.55); splashBasin.fillEllipse(647, 368, 40, 18);
    splashBasin.setDepth(0.55);

    // ── Wooden deck between cabins ────────────────────────────────────────────
    const deck = this.add.graphics();
    deck.fillStyle(0xb88858); deck.fillRect(1062, 522, 116, 76);
    deck.fillStyle(0xa87848);
    for (let dy = 530; dy < 598; dy += 12) deck.fillRect(1062, dy, 116, 2);
    deck.fillStyle(0xcc9a68);
    for (let dy = 527; dy < 598; dy += 12) deck.fillRect(1062, dy, 116, 1);
    deck.setDepth(560);

    // Potted plant on deck
    const deckPlant = this.add.graphics();
    deckPlant.fillStyle(0x804020); deckPlant.fillRect(1094, 551, 16, 14);
    deckPlant.fillStyle(0x603010); deckPlant.fillRect(1092, 561, 20, 4);
    deckPlant.fillStyle(0x208020); deckPlant.fillCircle(1102, 543, 10);
    deckPlant.fillStyle(0x30a030); deckPlant.fillCircle(1098, 540, 7);
    deckPlant.fillStyle(0x50c050); deckPlant.fillCircle(1104, 538, 5);
    deckPlant.setDepth(579);
  }

  private buildDecorativesPark(): void {
    // ── Tree ground shadows (below each tree sprite) ──────────────────────────
    const treeCenters: [number, number, number][] = [
      // [cx, cy, treeRectTop]
      [102,102,80], [202,82,60], [152,182,160],
      [482,102,80], [582,82,60],
      [1102,322,300], [1182,282,260], [1142,402,380],
      [1022,782,760], [1122,822,800],
    ];
    const treeShadow = this.add.graphics();
    treeShadow.fillStyle(0x1a3a10, 0.35);
    for (const [cx, cy] of treeCenters) treeShadow.fillEllipse(cx + 4, cy + 16, 52, 18);
    treeShadow.setDepth(0.3);

    // ── Fallen leaves near NW + N tree clusters ───────────────────────────────
    const leafCols = [0xd4a820, 0xcc6010, 0xb83010, 0xe8c030, 0xa85020];
    const leaves = this.add.graphics();
    const leafZones: [number,number,number,number][] = [
      [60,70,250,220], [430,50,640,160],
    ];
    for (const [x1,y1,x2,y2] of leafZones) {
      for (let li = 0; li < 40; li++) {
        const lx = x1 + Math.floor(((li * 137 + 31) % (x2 - x1)));
        const ly = y1 + Math.floor(((li * 97  + 17) % (y2 - y1)));
        leaves.fillStyle(leafCols[li % leafCols.length], 0.75);
        leaves.fillEllipse(lx, ly, 6, 4);
      }
    }
    leaves.setDepth(0.7);

    // ── Richer dirt paths ─────────────────────────────────────────────────────
    const paths = this.add.graphics();
    // Base path colour
    paths.fillStyle(0xc4a268, 0.9);
    paths.fillRect(100, 460, 490, 32);  // W-E horizontal to fountain
    paths.fillRect(590, 100, 32, 360);  // N-S vertical to fountain
    paths.fillRect(660, 452, 240, 32);  // E from fountain
    // Worn centre (lighter, compacted)
    paths.fillStyle(0xd8b87a, 0.6);
    paths.fillRect(100, 471, 490, 10);
    paths.fillRect(598, 100, 14, 360);
    paths.fillRect(660, 463, 240, 10);
    // Rut lines (tyre/foot grooves)
    paths.fillStyle(0xa88050, 0.55);
    paths.fillRect(100, 468, 490, 2); paths.fillRect(100, 484, 490, 2);
    paths.fillRect(594, 100, 2, 360); paths.fillRect(614, 100, 2, 360);
    paths.setDepth(0.5);

    // Path moss-fringe (organic edge)
    const pathEdge = this.add.graphics();
    pathEdge.fillStyle(0x4a6a2a, 0.45);
    for (let mx = 105; mx < 590; mx += 14) pathEdge.fillEllipse(mx, 456, 10, 5);
    for (let mx = 112; mx < 590; mx += 14) pathEdge.fillEllipse(mx, 493, 10, 5);
    for (let my = 108; my < 460; my += 14) pathEdge.fillEllipse(587, my, 5, 10);
    for (let my = 108; my < 460; my += 14) pathEdge.fillEllipse(625, my, 5, 10);
    pathEdge.setDepth(0.51);

    // Scattered pebbles along path edges
    const rocks = this.add.graphics();
    const pebbleData: [number,number][] = [
      [128,455],[175,457],[242,456],[318,455],[390,457],[468,455],[540,456],
      [148,494],[210,495],[290,494],[368,495],[445,494],[520,495],
      [590,130],[591,200],[590,280],[592,350],[590,420],
    ];
    rocks.fillStyle(0x8a8070);
    for (const [rx,ry] of pebbleData) rocks.fillEllipse(rx, ry, 8, 5);
    rocks.fillStyle(0x9a9080);
    for (const [rx,ry] of pebbleData) rocks.fillEllipse(rx - 1, ry - 1, 3, 2);
    rocks.setDepth(0.55);

    // ── Flowerbed patches (5 beds) ────────────────────────────────────────────
    // Helper: draw a circular bed with mixed blooms
    const drawBed = (
      bg: Phaser.GameObjects.Graphics,
      bx: number, by: number, bw: number, bh: number,
      colors: number[],
    ) => {
      bg.fillStyle(0x2e1a0c); bg.fillEllipse(bx, by, bw, bh);
      bg.fillStyle(0x3a2410); bg.fillEllipse(bx - 2, by - 3, bw - 6, bh - 4);
      // Stems
      bg.fillStyle(0x40aa30);
      for (let si = 0; si < 8; si++) {
        const sx = bx - bw/2 + 4 + si * (bw - 8) / 7;
        bg.fillRect(Math.round(sx), by - 3, 1, 5);
      }
      // Blooms
      for (let bi = 0; bi < 10; bi++) {
        const bfx = bx - bw/2 + 5 + (bi * 113) % (bw - 10);
        const bfy = by - bh/2 + 3 + (bi * 79)  % (bh - 6);
        bg.fillStyle(colors[bi % colors.length]);
        bg.fillCircle(Math.round(bfx), Math.round(bfy), 4);
        bg.fillStyle(0xffffaa, 0.6);
        bg.fillCircle(Math.round(bfx), Math.round(bfy), 1);
      }
    };
    const fb = this.add.graphics();
    drawBed(fb, 700, 700, 90, 55, [0xff3030,0xffee30,0xff88ff,0xffffff,0xaa55ff]);
    drawBed(fb, 295, 200, 70, 44, [0xffff30,0xff5080,0xffffff,0xaaff44]);
    drawBed(fb, 1100, 500, 80, 50, [0xaa44ff,0xffaa40,0x44ffaa,0xff4488]);
    drawBed(fb, 430, 540, 65, 40, [0xff4040,0xffcc00,0xffffff,0xff88cc]);
    drawBed(fb, 820, 840, 75, 48, [0xaa44ff,0xff6644,0x88ffaa,0xffee44]);
    fb.setDepth(0.6);

    // ── Bench gravel pads ─────────────────────────────────────────────────────
    const pads = this.add.graphics();
    pads.fillStyle(0xb0a868, 0.55);
    for (const [px,py] of [[185,374],[185,514],[744,394],[744,574],[524,694]] as [number,number][])
      pads.fillRoundedRect(px, py, 104, 42, 4);
    pads.fillStyle(0xa09858, 0.3);
    for (const [px,py] of [[185,374],[185,514],[744,394],[744,574],[524,694]] as [number,number][])
      for (let pi = 0; pi < 12; pi++)
        pads.fillRect(px + 5 + (pi * 37) % 90, py + 4 + (pi * 23) % 32, 4, 3);
    pads.setDepth(0.5);

    // ── Trash cans ────────────────────────────────────────────────────────────
    for (const [tx,ty] of [[160,450],[682,430],[950,782]] as [number,number][]) {
      this.add.rectangle(tx + 1, ty + 1, 16, 20, 0x000000, 0.2).setDepth(ty + 7);
      this.add.rectangle(tx, ty, 15, 19, 0x2a5a2a).setDepth(ty + 8);
      this.add.rectangle(tx, ty - 8, 17, 5, 0x1a4a1a).setDepth(ty + 11);
      this.add.rectangle(tx, ty - 6, 13, 2, 0x3a6a3a).setDepth(ty + 12);
      this.add.rectangle(tx + 5, ty - 2, 3, 10, 0x3a6a3a, 0.4).setDepth(ty + 9);
    }

    // ── Lamp posts ────────────────────────────────────────────────────────────
    for (const [lx,ly] of [[155,460],[590,440],[722,460],[900,832]] as [number,number][]) {
      const halo = this.add.graphics();
      halo.fillStyle(0xffffcc, 0.07); halo.fillCircle(lx, ly, 35);
      halo.setDepth(ly - 8);
      this.add.rectangle(lx, ly + 20, 8, 6, 0x303030).setDepth(ly + 23); // base
      this.add.rectangle(lx, ly + 7, 4, 32, 0x3a3a3a).setDepth(ly + 10);  // pole
      this.add.rectangle(lx, ly - 9, 16, 7, 0x3a3a3a).setDepth(ly - 5);   // head
      this.add.rectangle(lx, ly - 5, 13, 6, 0xffffaa).setDepth(ly - 4);   // glow
      this.add.rectangle(lx - 1, ly - 5, 4, 4, 0xffffff, 0.4).setDepth(ly - 3); // glint
    }

    // ── Drinking fountain beside main path ─────────────────────────────────────
    this.add.rectangle(132, 479, 3, 20, 0x606080).setDepth(490);
    this.add.rectangle(132, 468, 15, 9, 0x8090a8).setDepth(491);
    this.add.rectangle(132, 465, 12, 4, 0xa0b0c0).setDepth(492);
    const dwf = this.add.graphics();
    dwf.fillStyle(0x66aaee, 0.65); dwf.fillEllipse(136, 461, 8, 4);
    dwf.setDepth(493);

    // ── Information kiosk sign ─────────────────────────────────────────────────
    this.add.rectangle(494, 382, 3, 30, 0x4a3a18).setDepth(396);
    this.add.rectangle(494, 367, 52, 28, 0xf0e0c0).setDepth(397);
    this.add.rectangle(494, 367, 48, 24, 0x2255aa).setDepth(398);
    this.add.rectangle(494, 367, 2, 24, 0x88aaff, 0.4).setDepth(399);
    this.add.text(494, 367, 'CITY PARK\n★ MAP ★', {
      fontSize: '7px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setDepth(400);

    // ── Fountain water shimmer (animated) ─────────────────────────────────────
    const fShimmer = this.add.graphics();
    fShimmer.fillStyle(0x88ccff, 1.0);
    fShimmer.fillRect(555, 440, 40, 8); fShimmer.fillRect(600, 455, 35, 7);
    fShimmer.fillRect(545, 465, 30, 6); fShimmer.fillRect(590, 478, 42, 7);
    fShimmer.fillRect(558, 492, 36, 6); fShimmer.fillRect(610, 440, 28, 7);
    fShimmer.setDepth(542);
    this.tweens.add({ targets: fShimmer, alpha: 0.06, duration: 1600,
      ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // ── Pond props: duck with bob + lily overlay + periodic ripple ─────────────
    // Lily overlay (decorative extra pads, not physics)
    const lilyOver = this.add.graphics();
    lilyOver.fillStyle(0x258a15); lilyOver.fillCircle(1000, 100, 11);
    lilyOver.fillStyle(0x38aa25); lilyOver.fillCircle(998, 97, 7);
    lilyOver.fillStyle(0xff3388); lilyOver.fillCircle(1001, 95, 2);
    lilyOver.fillStyle(0x206010); lilyOver.fillCircle(950, 145, 9);
    lilyOver.fillStyle(0x30881e); lilyOver.fillCircle(948, 142, 5);
    lilyOver.setDepth(162);

    const duck = this.add.graphics();
    duck.fillStyle(0xffffaa, 0.4); duck.fillEllipse(892, 158, 32, 10); // water glow
    duck.fillStyle(0xdddddd); duck.fillEllipse(885, 150, 12, 8);        // wing
    duck.fillStyle(0xffffff); duck.fillEllipse(892, 150, 20, 12);       // body
    duck.fillStyle(0xeecc00); duck.fillCircle(902, 146, 7);             // head
    duck.fillStyle(0xffee44); duck.fillEllipse(900, 143, 9, 5);         // head highlight
    duck.fillStyle(0xff8800); duck.fillRect(908, 145, 6, 3);            // beak
    duck.fillStyle(0xff9900); duck.fillRect(908, 145, 6, 1);            // beak top
    duck.fillStyle(0x111111); duck.fillCircle(904, 143, 1.5);           // eye
    duck.fillStyle(0xffffff); duck.fillCircle(903, 142, 0.8);           // eye glint
    duck.setDepth(158);
    this.tweens.add({ targets: duck, y: 4, duration: 2200,
      ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // Periodic pond ripple rings
    const spawnPondRipple = () => {
      const rx = 840 + Math.random() * 250;
      const ry = 70  + Math.random() * 170;
      const ring = this.add.graphics();
      ring.setPosition(rx, ry);
      ring.lineStyle(1, 0x4499bb, 0.7);
      ring.strokeCircle(0, 0, 5);
      ring.setDepth(165);
      this.tweens.add({ targets: ring, scaleX: 4, scaleY: 4, alpha: 0,
        duration: 1400, ease: 'Quad.Out', onComplete: () => ring.destroy() });
    };
    this.time.addEvent({ delay: 2800, loop: true, callback: spawnPondRipple });

    // ── Playground slide (decorative, north of swings) ─────────────────────────
    // Swings rect: x=80,y=680. Slide visual fits y=600-678, x=82-210.
    const slide = this.add.graphics();
    // Platform
    slide.fillStyle(0xe08018); slide.fillRect(84, 604, 54, 18);
    slide.fillStyle(0xffcc55); slide.fillRect(86, 605, 50, 7); // top highlight
    slide.fillStyle(0xb86010); slide.fillRect(84, 621, 54, 2); // platform edge shadow
    // Platform support posts
    slide.fillStyle(0x707080);
    slide.fillRect(84, 620, 5, 48); slide.fillRect(133, 620, 5, 48); // left+right posts
    slide.fillStyle(0x9090b0); slide.fillRect(85, 620, 2, 48); slide.fillRect(134, 620, 2, 48);
    // Slide chute (blue, angled from platform bottom to ground)
    slide.fillStyle(0x1a88cc);
    for (let sc = 0; sc < 6; sc++) slide.fillRect(136 + sc * 8, 612 + sc * 10, 18, 10);
    slide.fillStyle(0x44aaee, 0.5);
    for (let sc = 0; sc < 6; sc++) slide.fillRect(136 + sc * 8, 612 + sc * 10, 18, 3);
    // Ladder rungs on left side
    slide.fillStyle(0xaaaaaa);
    for (let rg = 0; rg < 5; rg++) slide.fillRect(80, 624 + rg * 10, 10, 2);
    slide.setDepth(668);

    // Sandbox fence posts (decorative, 4 corner posts)
    for (const [fpx, fpy] of [[240,720],[360,720],[240,800],[360,800]] as [number,number][]) {
      this.add.rectangle(fpx, fpy, 6, 8, 0xa08040).setDepth(fpy + 4);
      this.add.rectangle(fpx, fpy - 3, 8, 3, 0xc0a060).setDepth(fpy + 5);
    }

    // ── Picnic table (decorative, no physics) ─────────────────────────────────
    this.ensureTexture('park-picnic-table', 80, 60, () => {}); // already built in buildTexturesPark
    this.add.image(420, 820, 'park-picnic-table').setDisplaySize(80, 60).setDepth(850);

    // ── Picnic blanket beside table ─────────────────────────────────────────────
    const blanket = this.add.graphics();
    blanket.fillStyle(0xcc4040); blanket.fillRect(310, 802, 72, 52);
    blanket.fillStyle(0x882828, 0.6);
    for (let bc = 0; bc < 6; bc++) blanket.fillRect(310 + bc * 12, 802, 4, 52);
    for (let br = 0; br < 5; br++) blanket.fillRect(310, 802 + br * 10, 72, 3);
    blanket.fillStyle(0xffdddd);
    for (let bf = 0; bf < 6; bf++) blanket.fillRect(314 + bf * 12, 853, 5, 7);
    blanket.setDepth(0.55);

    // Food on blanket (decorative)
    const food = this.add.graphics();
    food.fillStyle(0xee4422); food.fillCircle(330, 820, 8); // apple
    food.fillStyle(0xcc1100); food.fillCircle(328, 817, 4);
    food.fillStyle(0x22aa22); food.fillRect(330, 811, 2, 5); // apple stem
    food.fillStyle(0xffe080); food.fillRect(348, 814, 22, 14); // sandwich
    food.fillStyle(0xe8c060); food.fillRect(350, 815, 18, 5);
    food.fillStyle(0x80c030); food.fillRect(349, 819, 20, 3);  // lettuce
    food.fillStyle(0xff7070); food.fillRect(350, 822, 18, 4);  // tomato
    food.setDepth(826);

    // ── Decorative walking NPCs ───────────────────────────────────────────────
    const drawWalkerShape = (
      wg: Phaser.GameObjects.Graphics, shirtCol: number, pantsCol: number,
    ) => {
      wg.fillStyle(0x000000, 0.18); wg.fillEllipse(0, 9, 13, 5);   // shadow
      wg.fillStyle(pantsCol);       wg.fillRect(-4, 2, 8, 9);       // legs
      wg.fillStyle(shirtCol);       wg.fillEllipse(0, 0, 11, 12);   // torso
      wg.fillStyle(0xf4c890);       wg.fillCircle(0, -7, 5);        // head
      wg.fillStyle(0x3a2510);       wg.fillEllipse(0, -10, 9, 4);   // hair
      wg.fillStyle(0x111111);
      wg.fillRect(-2, -8, 1, 1); wg.fillRect(2, -8, 1, 1);         // eyes
    };

    const walkLoop = (
      wg: Phaser.GameObjects.Graphics,
      pts: { x: number; y: number }[],
      speed: number,
    ): void => {
      let idx = 0;
      const move = () => {
        const tgt = pts[idx % pts.length];
        const dist = Math.hypot(tgt.x - wg.x, tgt.y - wg.y);
        idx++;
        this.tweens.add({
          targets: wg, x: tgt.x, y: tgt.y,
          duration: Math.max(80, (dist / speed) * 1000),
          ease: 'Linear',
          onUpdate: () => { wg.setDepth(wg.y + 8); },
          onComplete: move,
        });
      };
      move();
    };

    // Walker 1 — circles the fountain slowly (blue shirt)
    const w1 = this.add.graphics();
    drawWalkerShape(w1, 0x2266cc, 0x334466);
    const orb = { a: 0 };
    w1.setPosition(600 + 112, 480);
    w1.setDepth(490);
    this.tweens.add({
      targets: orb, a: Math.PI * 2, duration: 13000, ease: 'Linear', repeat: -1,
      onUpdate: () => {
        w1.setPosition(600 + Math.cos(orb.a) * 112, 480 + Math.sin(orb.a) * 112);
        w1.setDepth(w1.y + 8);
      },
    });
    this.tweens.add({ targets: w1, scaleX: 1.06, scaleY: 1.06,
      duration: 380, ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // Walker 2 — strolls along horizontal path E-W (green shirt)
    const w2 = this.add.graphics();
    drawWalkerShape(w2, 0x228844, 0x334433);
    w2.setPosition(140, 476); w2.setDepth(484);
    walkLoop(w2, [{ x: 140, y: 476 }, { x: 548, y: 476 }, { x: 140, y: 476 }], 42);
    this.tweens.add({ targets: w2, scaleX: 1.06, scaleY: 1.06,
      duration: 360, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 80 });

    // Walker 3 — plays near playground / sandbox area (red shirt)
    const w3 = this.add.graphics();
    drawWalkerShape(w3, 0xcc2222, 0x443333);
    w3.setPosition(310, 848); w3.setDepth(856);
    walkLoop(w3, [
      { x: 310, y: 848 }, { x: 420, y: 860 }, { x: 472, y: 840 },
      { x: 432, y: 810 }, { x: 358, y: 820 }, { x: 310, y: 848 },
    ], 36);
    this.tweens.add({ targets: w3, scaleX: 1.07, scaleY: 1.07,
      duration: 340, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 120 });

    // Walker 4 — walks up and down the vertical path (yellow shirt)
    const w4 = this.add.graphics();
    drawWalkerShape(w4, 0xddcc00, 0x443322);
    w4.setPosition(606, 140); w4.setDepth(148);
    walkLoop(w4, [{ x: 606, y: 140 }, { x: 606, y: 445 }, { x: 606, y: 140 }], 44);
    this.tweens.add({ targets: w4, scaleX: 1.06, scaleY: 1.06,
      duration: 370, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 50 });

    // Walker 5 — SE lawn stroller (purple shirt)
    const w5 = this.add.graphics();
    drawWalkerShape(w5, 0x8833cc, 0x332244);
    w5.setPosition(760, 642); w5.setDepth(650);
    walkLoop(w5, [
      { x: 760, y: 642 }, { x: 958, y: 660 }, { x: 958, y: 740 },
      { x: 760, y: 742 }, { x: 760, y: 642 },
    ], 38);
    this.tweens.add({ targets: w5, scaleX: 1.06, scaleY: 1.06,
      duration: 350, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 160 });

    // ── Pollen motes near NW/N tree clusters ──────────────────────────────────
    const pollenTreePts = [
      { x: 102, y: 102 }, { x: 202, y: 82 }, { x: 152, y: 182 },
      { x: 482, y: 102 }, { x: 582, y: 82 },
    ];
    const spawnPollen = () => {
      const tp = pollenTreePts[Math.floor(Math.random() * pollenTreePts.length)];
      const mx = tp.x + (Math.random() - 0.5) * 28;
      const my = tp.y + (Math.random() - 0.5) * 18;
      const mote = this.add.graphics();
      mote.fillStyle(0xffff88, 1.0);
      mote.fillRect(0, 0, 2, 2);
      mote.setPosition(mx, my);
      mote.setDepth(210);
      this.tweens.add({
        targets: mote,
        y: my - 38,
        x: mx + (Math.random() - 0.5) * 22,
        alpha: 0,
        duration: 3000 + Math.random() * 1800,
        ease: 'Quad.In',
        onComplete: () => mote.destroy(),
      });
    };
    this.time.addEvent({ delay: 1400, loop: true, callback: spawnPollen });
  }

  private buildDecorativesCity(): void {
    // ── Road centre lines (dashed yellow) ────────────────────────────────────
    const lines = this.add.graphics();
    lines.fillStyle(0xffcc00);
    for (const cx of [400, 790])
      for (let ly = 80; ly < 940; ly += 32)
        lines.fillRect(cx - 1, ly, 3, 18);
    for (let lx = 80; lx < 1200; lx += 32)
      lines.fillRect(lx, 479, 18, 3);
    lines.setDepth(0.6);

    // ── Crosswalk stripes at intersections ────────────────────────────────────
    const crosswalks = this.add.graphics();
    crosswalks.fillStyle(0xffffff, 0.75);
    // Intersection at left street (x≈400) crossing mid E-W (y≈480)
    for (let cw = 0; cw < 5; cw++) {
      crosswalks.fillRect(330 + cw * 8, 460, 5, 18); // north side
      crosswalks.fillRect(330 + cw * 8, 500, 5, 18); // south side
    }
    // Intersection at right street (x≈790)
    for (let cw = 0; cw < 5; cw++) {
      crosswalks.fillRect(720 + cw * 8, 460, 5, 18);
      crosswalks.fillRect(720 + cw * 8, 500, 5, 18);
    }
    crosswalks.setDepth(0.61);

    // ── Parking space lines in left street ───────────────────────────────────
    const parking = this.add.graphics();
    parking.fillStyle(0xffffff, 0.4);
    // Left side parking (x≈330-370, north section y=140-360)
    for (let py = 160; py < 360; py += 50) {
      parking.fillRect(330, py, 40, 2);  // space dividers
    }
    // Right side (x≈370-410)
    for (let py = 600; py < 800; py += 50) {
      parking.fillRect(330, py, 40, 2);
    }
    parking.setDepth(0.62);

    // ── Sidewalk kerb lines ───────────────────────────────────────────────────
    const kerbs = this.add.graphics();
    kerbs.lineStyle(3, 0x888888, 0.8);
    for (const b of this.cfg.furniture.filter(f => f.textureKey === 'city-building'))
      kerbs.strokeRect(b.rect.x - 2, b.rect.y - 2, b.rect.w + 4, b.rect.h + 4);
    kerbs.setDepth(0.7);

    // ── Streetlight posts ─────────────────────────────────────────────────────
    for (const slp of [
      { x: 375, y: 120 }, { x: 375, y: 380 }, { x: 375, y: 640 },
      { x: 685, y: 120 }, { x: 685, y: 380 }, { x: 685, y: 640 },
      { x: 895, y: 380 }, { x: 895, y: 640 },
    ]) {
      // Layered ground light pool: outer → mid → bright inner
      const glow = this.add.graphics();
      glow.fillStyle(0xffffcc, 0.04); glow.fillEllipse(slp.x + 9, slp.y + 8, 88, 44);
      glow.fillStyle(0xffffcc, 0.09); glow.fillEllipse(slp.x + 9, slp.y + 8, 52, 26);
      glow.fillStyle(0xffe880, 0.19); glow.fillEllipse(slp.x + 9, slp.y + 8, 22, 11);
      glow.setDepth(0.66);
      this.tweens.add({
        targets: glow, alpha: { from: 1, to: 0.52 },
        duration: 2800 + (slp.x % 7) * 280,
        ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: (slp.y % 9) * 190,
      });
      // Pole
      this.add.rectangle(slp.x, slp.y, 4, 24, 0x404040).setDepth(slp.y + 12);
      // Arm
      this.add.rectangle(slp.x + 4, slp.y - 12, 12, 4, 0x404040).setDepth(slp.y);
      // Lamp housing
      this.add.rectangle(slp.x + 9, slp.y - 12, 8, 6, 0x303030).setDepth(slp.y + 1);
      // Soft halo behind bulb
      this.add.rectangle(slp.x + 9, slp.y - 9, 20, 14, 0xffffee).setAlpha(0.14).setDepth(slp.y + 1.5);
      // Bright bulb point
      this.add.rectangle(slp.x + 9, slp.y - 9, 6, 4, 0xffffaa).setDepth(slp.y + 2);
    }

    // ── Fire hydrants ─────────────────────────────────────────────────────────
    for (const fh of [
      { x: 338, y: 138 }, { x: 338, y: 380 },
      { x: 678, y: 138 }, { x: 678, y: 380 },
      { x: 900, y: 575 }, { x: 480, y: 840 },
    ]) {
      // Body
      this.add.rectangle(fh.x, fh.y + 3, 9, 12, 0xcc2222).setDepth(fh.y + 9);
      // Cap
      this.add.rectangle(fh.x, fh.y - 3, 11, 5, 0xaa1818).setDepth(fh.y + 11);
      // Nozzle caps (sides)
      this.add.rectangle(fh.x - 5, fh.y + 3, 4, 4, 0xdd3333).setDepth(fh.y + 10);
      this.add.rectangle(fh.x + 5, fh.y + 3, 4, 4, 0xdd3333).setDepth(fh.y + 10);
      // Base
      this.add.rectangle(fh.x, fh.y + 10, 12, 3, 0x881818).setDepth(fh.y + 8);
      // Silver nozzle highlights
      this.add.rectangle(fh.x - 5, fh.y + 3, 2, 2, 0xcccccc).setDepth(fh.y + 11);
      this.add.rectangle(fh.x + 5, fh.y + 3, 2, 2, 0xcccccc).setDepth(fh.y + 11);
    }

    // ── Mailbox ───────────────────────────────────────────────────────────────
    // Blue USPS mailbox near south sidewalk
    this.add.rectangle(460, 848, 3, 14, 0x303030).setDepth(856); // post
    this.add.rectangle(460, 840, 18, 12, 0x1a44aa).setDepth(858); // body
    this.add.rectangle(460, 835, 18, 5, 0x2255cc).setDepth(859);  // curved top
    this.add.rectangle(462, 840, 2, 12, 0x3366dd).setDepth(860);  // highlight
    this.add.rectangle(455, 843, 3, 2, 0x888888).setDepth(861);   // slot

    // ── Stop signs at key intersections ──────────────────────────────────────
    for (const ss of [{ x: 326, y: 118 }, { x: 680, y: 118 }, { x: 880, y: 374 }]) {
      this.add.rectangle(ss.x, ss.y + 8, 2, 18, 0x505050).setDepth(ss.y + 16); // pole
      // Octagon (simplified as circle with border)
      const stop = this.add.graphics();
      stop.fillStyle(0xcc1111); stop.fillCircle(ss.x, ss.y - 2, 9);
      stop.fillStyle(0xffffff); stop.fillCircle(ss.x, ss.y - 2, 7);
      stop.fillStyle(0xcc1111); stop.fillCircle(ss.x, ss.y - 2, 6);
      stop.setDepth(ss.y + 10);
      this.add.text(ss.x, ss.y - 2, 'STOP', {
        fontSize: '4px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(ss.y + 11);
    }

    // ── Trash cans on sidewalks ───────────────────────────────────────────────
    for (const tc of [
      { x: 350, y: 368 }, { x: 350, y: 572 }, { x: 700, y: 368 },
      { x: 700, y: 572 }, { x: 480, y: 860 }, { x: 792, y: 860 },
    ]) {
      this.add.rectangle(tc.x, tc.y + 2, 10, 14, 0x444444).setDepth(tc.y + 9);
      this.add.rectangle(tc.x, tc.y - 5, 12, 4, 0x333333).setDepth(tc.y + 12);
      this.add.rectangle(tc.x + 3, tc.y - 2, 2, 10, 0x555555).setDepth(tc.y + 10);
    }

    // ── Manhole covers on road surface ───────────────────────────────────────
    for (const [mx, my] of [[400, 300], [790, 490], [400, 720]] as [number, number][]) {
      const mc = this.add.graphics();
      mc.fillStyle(0x484848); mc.fillEllipse(mx, my, 20, 20);
      mc.fillStyle(0x383838); mc.fillEllipse(mx, my, 16, 16);
      mc.lineStyle(1, 0x585858, 0.9); mc.strokeEllipse(mx, my, 10, 10);
      mc.strokeEllipse(mx, my, 4, 4);
      mc.setDepth(my + 0.8);
    }

    // ── Building facade overlays ──────────────────────────────────────────────
    const bldgCfgs: { x: number; y: number; w: number; h: number; style: 'brick' | 'glass' | 'concrete' }[] = [
      { x: 80,  y: 120, w: 240, h: 260, style: 'brick' },
      { x: 480, y: 120, w: 200, h: 220, style: 'glass' },
      { x: 900, y: 120, w: 240, h: 260, style: 'concrete' },
      { x: 80,  y: 580, w: 240, h: 260, style: 'brick' },
      { x: 480, y: 580, w: 200, h: 260, style: 'glass' },
      { x: 900, y: 580, w: 240, h: 260, style: 'concrete' },
    ];

    for (const b of bldgCfgs) {
      const baseDepth = b.y + b.h / 2 + 2;
      const litSeed   = (b.x >> 3) + (b.y >> 2);
      const fg        = this.add.graphics().setDepth(baseDepth);

      if (b.style === 'brick') {
        // Base brick color
        fg.fillStyle(0x8a3820, 0.93); fg.fillRect(b.x, b.y, b.w, b.h);
        // Horizontal mortar lines
        fg.fillStyle(0xbaa882, 0.6);
        for (let ry = b.y + 14; ry < b.y + b.h; ry += 14) fg.fillRect(b.x, ry, b.w, 2);
        // Vertical mortar (alternating row offset)
        fg.fillStyle(0xa09870, 0.4);
        for (let rr = 0; rr * 14 < b.h; rr++) {
          const off = (rr % 2) * 18;
          for (let bxOff = off; bxOff < b.w; bxOff += 36) fg.fillRect(b.x + bxOff, b.y + rr * 14, 2, 14);
        }
        // Cornice top band
        fg.fillStyle(0xd0b090); fg.fillRect(b.x, b.y, b.w, 9);
        fg.fillStyle(0x907050); fg.fillRect(b.x, b.y + 8, b.w, 2);
        // Window grid (5 cols × 6 rows)
        const wCols = 5, wRows = 6, wW = 20, wH = 22;
        const wStepX = Math.floor((b.w - 40) / (wCols - 1));
        const wStepY = Math.floor((b.h - 70) / (wRows - 1));
        for (let wr = 0; wr < wRows; wr++) {
          for (let wc = 0; wc < wCols; wc++) {
            const wx = b.x + 18 + wc * wStepX, wy = b.y + 18 + wr * wStepY;
            const lit = ((litSeed + wr * 7 + wc * 3) * 11) % 13 > 4;
            fg.fillStyle(0x3a2810); fg.fillRect(wx - 2, wy - 2, wW + 4, wH + 4);
            fg.fillStyle(lit ? 0xffd870 : 0x1c2c38); fg.fillRect(wx, wy, wW, wH);
            if (lit) { fg.fillStyle(0xfff0aa, 0.55); fg.fillRect(wx, wy, 8, 6); }
            fg.fillStyle(0xb09070); fg.fillRect(wx - 2, wy + wH + 2, wW + 4, 3);
          }
        }
        // Ground floor entrance
        const dx = b.x + Math.floor(b.w / 2) - 12;
        fg.fillStyle(0x1a1008); fg.fillRect(dx, b.y + b.h - 52, 24, 50);
        fg.fillStyle(0x4a7090); fg.fillRect(dx + 2, b.y + b.h - 50, 20, 48);
        fg.fillStyle(0x88aabb, 0.4); fg.fillRect(dx + 2, b.y + b.h - 50, 8, 14);

      } else if (b.style === 'glass') {
        // Dark blue-grey base
        fg.fillStyle(0x2a3c4e, 0.93); fg.fillRect(b.x, b.y, b.w, b.h);
        // Steel mullion grid
        const mColW = 22, mRowH = 20;
        fg.fillStyle(0x1a2a38, 0.85);
        for (let gx = b.x; gx <= b.x + b.w; gx += mColW) fg.fillRect(gx, b.y, 2, b.h);
        for (let gy = b.y; gy <= b.y + b.h; gy += mRowH) fg.fillRect(b.x, gy, b.w, 2);
        // Glass panels with sky reflection
        for (let pc = 0; pc * mColW < b.w; pc++) {
          for (let pr = 0; pr * mRowH < b.h; pr++) {
            const px = b.x + 2 + pc * mColW, py = b.y + 2 + pr * mRowH;
            const pw = Math.min(mColW - 2, b.x + b.w - px);
            const ph = Math.min(mRowH - 2, b.y + b.h - py);
            if (pw <= 0 || ph <= 0) continue;
            const vr = (pc + pr) % 3;
            fg.fillStyle(vr === 0 ? 0x3a5566 : vr === 1 ? 0x2e4a58 : 0x445e70, 0.75);
            fg.fillRect(px, py, pw, ph);
            if (pc % 3 === 0) { fg.fillStyle(0x88aacc, 0.13); fg.fillRect(px, py, 5, ph); }
          }
        }
        // Parapet cap
        fg.fillStyle(0x506878); fg.fillRect(b.x, b.y, b.w, 7);

      } else { // concrete
        fg.fillStyle(0x7c7c84, 0.93); fg.fillRect(b.x, b.y, b.w, b.h);
        // Horizontal panel reveals every 40px
        fg.fillStyle(0x5c5c64);
        for (let ry = b.y; ry <= b.y + b.h; ry += 40) fg.fillRect(b.x, ry, b.w, 3);
        // Vertical column reveals (thirds)
        fg.fillRect(b.x + Math.floor(b.w / 3), b.y, 3, b.h);
        fg.fillRect(b.x + Math.floor(b.w * 2 / 3), b.y, 3, b.h);
        // Cornice
        fg.fillStyle(0x8c8c94); fg.fillRect(b.x, b.y, b.w, 10);
        fg.fillStyle(0x606068); fg.fillRect(b.x, b.y + 9, b.w, 2);
        // Window grid (4 cols × 6 rows)
        const wCols = 4, wRows = 6, wW = 22, wH = 18;
        const wStepX = Math.floor((b.w - 40) / (wCols - 1));
        const wStepY = Math.floor((b.h - 50) / (wRows - 1));
        for (let wr = 0; wr < wRows; wr++) {
          for (let wc = 0; wc < wCols; wc++) {
            const wx = b.x + 14 + wc * wStepX, wy = b.y + 16 + wr * wStepY;
            const lit = ((litSeed + wr * 5 + wc * 11) * 7) % 11 > 4;
            fg.fillStyle(0x484850); fg.fillRect(wx - 2, wy - 2, wW + 4, wH + 4);
            fg.fillStyle(lit ? 0xffe070 : 0x2e4050); fg.fillRect(wx, wy, wW, wH);
            if (lit) { fg.fillStyle(0xfff0aa, 0.5); fg.fillRect(wx, wy, 8, 5); }
            fg.fillStyle(0x8888a0); fg.fillRect(wx - 2, wy + wH + 2, wW + 4, 3);
          }
        }
      }

      // Flickering warm-light windows (separate layer, tweened alpha)
      const fw = this.add.graphics().setDepth(baseDepth + 1);
      const fCols = 3, fRows = 2;
      const fStepX = Math.floor(b.w / (fCols + 1)), fStepY = Math.floor(b.h / (fRows + 2));
      for (let fr = 0; fr < fRows; fr++) {
        for (let fc = 0; fc < fCols; fc++) {
          fw.fillStyle(0xffcc44, 0.75);
          fw.fillRect(b.x + (fc + 1) * fStepX - 7, b.y + (fr + 1) * fStepY - 5, 14, 10);
        }
      }
      this.tweens.add({
        targets: fw, alpha: { from: 1, to: 0.08 },
        duration: 2000 + (litSeed % 9) * 380,
        ease: 'Sine.InOut', yoyo: true, repeat: -1,
        delay: (litSeed % 7) * 250,
      });
    }

    // ── Person silhouettes in windows (brick buildings A and D) ──────────────
    for (const [bx, by, dep] of [[80, 120, 254], [80, 580, 714]] as [number, number, number][]) {
      const sg = this.add.graphics().setDepth(dep);
      for (const [sx, sy] of [[bx + 38, by + 54], [bx + 126, by + 90], [bx + 82, by + 162]] as [number, number][]) {
        sg.fillStyle(0x0a0604, 0.65);
        sg.fillRect(sx + 2, sy, 7, 10);
        sg.fillCircle(sx + 5, sy - 4, 4.5);
      }
    }

    // ── Traffic lights at N-S × E-W intersections ────────────────────────────
    for (const [tlx, tly] of [
      [326, 376], [478, 376], [682, 376], [898, 376],
    ] as [number, number][]) {
      const tld = tly + 20;
      this.add.rectangle(tlx, tly + 10, 4, 28, 0x303030).setDepth(tld);
      this.add.rectangle(tlx + 8, tly - 4, 18, 4, 0x303030).setDepth(tld + 1);
      this.add.rectangle(tlx + 16, tly - 4, 10, 24, 0x202020).setDepth(tld + 2);
      const tlg = this.add.graphics().setDepth(tld + 3);
      const isRed = ((tlx >> 1) + tly) % 3 !== 0;
      tlg.fillStyle(isRed ? 0xff2222 : 0x441111); tlg.fillCircle(tlx + 16, tly - 10, 3);
      tlg.fillStyle(0x443300);                     tlg.fillCircle(tlx + 16, tly - 4,  3);
      tlg.fillStyle(isRed ? 0x114411 : 0x22ff44);  tlg.fillCircle(tlx + 16, tly + 2,  3);
    }

    // ── Driving cars (looping across road lanes) ──────────────────────────────
    const carKeys = ['city-car', 'city-car-blue', 'city-car-yellow', 'city-car-green', 'city-car-white'];
    let ckIdx = 0;
    const spawnCar = (
      sx: number, sy: number, ex: number, ey: number,
      ang: number, spd: number, delayMs: number,
    ) => {
      const car = this.add.image(sx, sy, carKeys[ckIdx++ % carKeys.length])
        .setAngle(ang).setDisplaySize(16, 24).setDepth(sy + 12);
      const dist = Math.hypot(ex - sx, ey - sy);
      const dur  = (dist / spd) * 1000;
      const loop = () => {
        car.setPosition(sx, sy);
        this.tweens.add({
          targets: car, x: ex, y: ey, duration: dur, ease: 'Linear',
          onUpdate: () => car.setDepth(car.y + 12),
          onComplete: loop,
        });
      };
      this.time.delayedCall(delayMs, loop);
    };

    // Left N-S street (x 320–480): southbound x=418, northbound x=352
    spawnCar(418,  70, 418, 950, 180, 95,    0);
    spawnCar(418,  70, 418, 950, 180, 90, 4200);
    spawnCar(352, 950, 352,  70,   0, 88, 1400);
    spawnCar(352, 950, 352,  70,   0, 93, 5600);
    // Right N-S street (x 680–900): southbound x=844, northbound x=718
    spawnCar(844,  70, 844, 950, 180, 100,  700);
    spawnCar(844,  70, 844, 950, 180,  86, 4900);
    spawnCar(718, 950, 718,  70,   0,  97, 2500);
    spawnCar(718, 950, 718,  70,   0,  91, 6300);
    // Mid E-W crossing (y 380–580): eastbound y=548, westbound y=432
    spawnCar(  60, 548, 1240, 548,  90, 87,  900);
    spawnCar(  60, 548, 1240, 548,  90, 94, 5200);
    spawnCar(1240, 432,   60, 432, -90, 91, 2100);
    spawnCar(1240, 432,   60, 432, -90, 85, 6700);

    // ── Sidewalk pedestrians ──────────────────────────────────────────────────
    const drawCityWalker = (wg: Phaser.GameObjects.Graphics, shirt: number, pants: number) => {
      wg.fillStyle(0x000000, 0.18); wg.fillEllipse(0, 9, 12, 5);
      wg.fillStyle(pants);          wg.fillRect(-4, 2, 8, 9);
      wg.fillStyle(shirt);          wg.fillEllipse(0, 0, 11, 12);
      wg.fillStyle(0xf4c890);       wg.fillCircle(0, -7, 5);
      wg.fillStyle(0x2a1808);       wg.fillEllipse(0, -10, 9, 4);
      wg.fillStyle(0x111111);       wg.fillRect(-2, -8, 1, 1); wg.fillRect(2, -8, 1, 1);
    };
    const cityWalkLoop = (wg: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], spd: number) => {
      let idx = 0;
      const move = () => {
        const t = pts[idx++ % pts.length];
        const d = Math.hypot(t.x - wg.x, t.y - wg.y);
        this.tweens.add({
          targets: wg, x: t.x, y: t.y,
          duration: Math.max(80, (d / spd) * 1000), ease: 'Linear',
          onUpdate: () => wg.setDepth(wg.y + 8),
          onComplete: move,
        });
      };
      move();
    };

    // Walker 1 — north sidewalk, pacing above building A
    const cw1 = this.add.graphics(); drawCityWalker(cw1, 0x3355cc, 0x223344);
    cw1.setPosition(180, 90); cw1.setDepth(98);
    cityWalkLoop(cw1, [{ x: 88, y: 90 }, { x: 318, y: 90 }, { x: 88, y: 90 }], 38);
    this.tweens.add({ targets: cw1, scaleX: 1.06, scaleY: 1.06, duration: 360, ease: 'Sine.InOut', yoyo: true, repeat: -1 });

    // Walker 2 — south sidewalk, pacing below building D
    const cw2 = this.add.graphics(); drawCityWalker(cw2, 0xcc5522, 0x332211);
    cw2.setPosition(180, 876); cw2.setDepth(884);
    cityWalkLoop(cw2, [{ x: 88, y: 876 }, { x: 318, y: 876 }, { x: 88, y: 876 }], 42);
    this.tweens.add({ targets: cw2, scaleX: 1.06, scaleY: 1.06, duration: 350, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 90 });

    // Walker 3 — east sidewalk beside building C
    const cw3 = this.add.graphics(); drawCityWalker(cw3, 0x44aa44, 0x224422);
    cw3.setPosition(1158, 200); cw3.setDepth(208);
    cityWalkLoop(cw3, [{ x: 1158, y: 130 }, { x: 1158, y: 368 }, { x: 1158, y: 130 }], 36);
    this.tweens.add({ targets: cw3, scaleX: 1.06, scaleY: 1.06, duration: 370, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 140 });

    // Walker 4 — mid E-W corridor between building rows
    const cw4 = this.add.graphics(); drawCityWalker(cw4, 0xaa4488, 0x332233);
    cw4.setPosition(560, 457); cw4.setDepth(465);
    cityWalkLoop(cw4, [
      { x: 492, y: 457 }, { x: 668, y: 457 }, { x: 668, y: 538 }, { x: 492, y: 538 }, { x: 492, y: 457 },
    ], 40);
    this.tweens.add({ targets: cw4, scaleX: 1.06, scaleY: 1.06, duration: 345, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 200 });

    // ── Rooftop steam vents (periodic particles) ──────────────────────────────
    const ventPts: [number, number][] = [
      [200, 120], [560, 120], [1020, 120],
      [200, 580], [560, 580], [1020, 580],
    ];
    const spawnSteam = (vx: number, vy: number) => {
      const sg = this.add.graphics();
      sg.fillStyle(0xbbbbbb, 0.55 + Math.random() * 0.35);
      sg.fillCircle(0, 0, 2 + Math.random() * 3);
      sg.setPosition(vx + (Math.random() - 0.5) * 10, vy);
      sg.setDepth(vy - 10);
      this.tweens.add({
        targets: sg,
        y: vy - 44 - Math.random() * 24,
        alpha: 0,
        scaleX: 2 + Math.random(),
        scaleY: 2 + Math.random(),
        duration: 2200 + Math.random() * 1400,
        ease: 'Quad.In',
        onComplete: () => sg.destroy(),
      });
    };
    this.time.addEvent({
      delay: 1100, loop: true,
      callback: () => {
        const [vx, vy] = ventPts[Math.floor(Math.random() * ventPts.length)];
        spawnSteam(vx, vy);
      },
    });

    // ── Night atmosphere tint (darkens ground/road layer; below buildings+chars) ─
    // Depth 0.5: above tilemap (0) and below road markings (0.6+), so only the
    // bare pavement is darkened. Streetlight glow pools at depth 0.66 remain lit.
    this.add.rectangle(
      this.cfg.worldWidth / 2, this.cfg.worldHeight / 2,
      this.cfg.worldWidth, this.cfg.worldHeight,
      0x08101e,
    ).setAlpha(0.32).setDepth(0.5);

    // ── More sidewalk pedestrians ─────────────────────────────────────────────
    // Reuse drawCityWalker / cityWalkLoop defined above in this same call chain.
    // Walker 5 — north sidewalk above building B
    const cw5 = this.add.graphics(); drawCityWalker(cw5, 0xdd8822, 0x443311);
    cw5.setPosition(580, 92); cw5.setDepth(100);
    cityWalkLoop(cw5, [{ x: 492, y: 92 }, { x: 678, y: 92 }, { x: 492, y: 92 }], 36);
    this.tweens.add({ targets: cw5, scaleX: 1.06, scaleY: 1.06, duration: 355, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 60 });

    // Walker 6 — north sidewalk above building C
    const cw6 = this.add.graphics(); drawCityWalker(cw6, 0x22aacc, 0x112233);
    cw6.setPosition(1020, 92); cw6.setDepth(100);
    cityWalkLoop(cw6, [{ x: 902, y: 92 }, { x: 1138, y: 92 }, { x: 902, y: 92 }], 40);
    this.tweens.add({ targets: cw6, scaleX: 1.06, scaleY: 1.06, duration: 368, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 170 });

    // Walker 7 — south sidewalk below building E
    const cw7 = this.add.graphics(); drawCityWalker(cw7, 0xcc3388, 0x332233);
    cw7.setPosition(580, 874); cw7.setDepth(882);
    cityWalkLoop(cw7, [{ x: 492, y: 874 }, { x: 678, y: 874 }, { x: 492, y: 874 }], 39);
    this.tweens.add({ targets: cw7, scaleX: 1.06, scaleY: 1.06, duration: 342, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 110 });

    // Walker 8 — south sidewalk below building F
    const cw8 = this.add.graphics(); drawCityWalker(cw8, 0x88cc44, 0x223311);
    cw8.setPosition(1020, 874); cw8.setDepth(882);
    cityWalkLoop(cw8, [{ x: 902, y: 874 }, { x: 1138, y: 874 }, { x: 902, y: 874 }], 37);
    this.tweens.add({ targets: cw8, scaleX: 1.06, scaleY: 1.06, duration: 375, ease: 'Sine.InOut', yoyo: true, repeat: -1, delay: 220 });
  }

  // ── Collision wiring ────────────────────────────────────────────────────────

  private wireCollisions(): void {
    this.physics.add.collider(this.player.sprite, this.wallGroup);
    this.physics.add.collider(this.player.sprite, this.furnitureGroup);
    this.physics.add.collider(this.enemy.sprite, this.wallGroup);
    this.physics.add.collider(this.enemy.sprite, this.furnitureGroup);

    if (this.enemy2) {
      this.physics.add.collider(this.enemy2.sprite, this.wallGroup);
      this.physics.add.collider(this.enemy2.sprite, this.furnitureGroup);
      this.physics.add.overlap(this.enemy2.sprite, this.player.poops, (_e, poopObj) => {
        (poopObj as Phaser.Physics.Arcade.Image).destroy();
        this.enemy2!.stun();
      });
      this.physics.add.overlap(this.player.sprite, this.enemy2.sprite, () => this.triggerLose());
    }

    if (this.enemy3) {
      this.physics.add.collider(this.enemy3.sprite, this.wallGroup);
      this.physics.add.collider(this.enemy3.sprite, this.furnitureGroup);
      this.physics.add.overlap(this.enemy3.sprite, this.player.poops, (_e, poopObj) => {
        (poopObj as Phaser.Physics.Arcade.Image).destroy();
        this.enemy3!.stun();
      });
      this.physics.add.overlap(this.player.sprite, this.enemy3.sprite, () => this.triggerLose());
    }

    // Pink treat: collect to spawn Axol helper
    this.physics.add.overlap(
      this.player.sprite,
      this.pinkTreatGroup,
      (_playerObj, pinkTreatObj) => {
        if (this.axol) return; // already spawned
        const pt = pinkTreatObj as Phaser.Physics.Arcade.Image;
        (pt.getData('emitter') as Phaser.GameObjects.Particles.ParticleEmitter)?.destroy();
        const spawnX = pt.x;
        const spawnY = pt.y;
        pt.destroy();
        this.spawnAxol(spawnX, spawnY);
      },
    );

    this.physics.add.overlap(
      this.player.sprite,
      this.treatGroup,
      (_playerObj, treatObj) => {
        const treat = treatObj as Phaser.Physics.Arcade.Image;
        (treat.getData('emitter') as Phaser.GameObjects.Particles.ParticleEmitter)?.destroy();
        treat.destroy();
        this.player.collectTreat();
        if (this.cache.audio.exists('crunch')) this.sound.play('crunch', { volume: 0.6 });
        if (this.player.getTreatCount() >= this.cfg.totalTreats) {
          this.triggerWin();
        }
      },
    );

    this.physics.add.overlap(
      this.enemy.sprite,
      this.player.poops,
      (_enemyObj, poopObj) => {
        (poopObj as Phaser.Physics.Arcade.Image).destroy();
        this.enemy.stun();
      },
    );

    this.physics.add.overlap(
      this.player.sprite,
      this.enemy.sprite,
      () => this.triggerLose(),
    );
  }

  // ── Win / Lose ──────────────────────────────────────────────────────────────

  private triggerWin(): void {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.axol?.poof(); this.axol = null;
    this.player.sprite.setVelocity(0, 0);
    this.audioManager?.stop();
    if (this.levelNum >= LEVELS.length) {
      // Stop level music immediately so it doesn't bleed into the win pause.
      this.bgMusic?.destroy();
      this.bgMusic = null;
      // Show "YOU WIN!" overlay for ~3 s, then roll credits.
      const ow = this.scale.width, oh = this.scale.height;
      this.add.rectangle(ow / 2, oh / 2, 460, 180, 0x000000, 0.82)
        .setScrollFactor(0).setDepth(2000);
      this.add.text(ow / 2, oh / 2, 'YOU WIN!', {
        fontSize: '64px', color: '#00ff88',
        stroke: '#000000', strokeThickness: 6, fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
      this.time.delayedCall(3000, () => this.scene.start('CreditsScene'));
    } else {
      this.time.delayedCall(400, () =>
        this.scene.start('TransitionScene', { completedLevel: this.levelNum }),
      );
    }
  }

  private triggerLose(): void {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.axol?.poof(); this.axol = null;
    this.player.sprite.setVelocity(0, 0);
    this.audioManager?.stop();
    this.ui.showLose(this);
  }

  // ── Axol / pink treat ───────────────────────────────────────────────────────

  private buildPinkTreat(): void {
    // One pink treat per level at a fixed hint position (walkable search fallback)
    const hints: Record<number, { x: number; y: number }> = {
      1: { x: 450, y: 350 },
      2: { x: 700, y: 650 },
      3: { x: 640, y: 650 },
      4: { x: 600, y: 480 },
    };
    const hint = hints[this.levelNum] ?? { x: 300, y: 300 };

    const S = 16, R = 160;
    const searchGrid: [number, number][] = [];
    for (let dy = -R; dy <= R; dy += S)
      for (let dx = -R; dx <= R; dx += S)
        searchGrid.push([dx, dy]);
    searchGrid.sort(([ax, ay], [bx, by]) => ax * ax + ay * ay - bx * bx - by * by);

    let tx = hint.x, ty = hint.y;
    for (const [dx, dy] of searchGrid) {
      if (this.isWalkable(hint.x + dx, hint.y + dy)) {
        tx = hint.x + dx; ty = hint.y + dy; break;
      }
    }

    const pt = this.pinkTreatGroup.create(tx, ty, 'pink-treat') as Phaser.Physics.Arcade.Image;
    pt.setDepth(9992);
    pt.refreshBody();

    const emitter = this.add.particles(tx, ty, 'sparkle', {
      lifespan: 900,
      speed: { min: 15, max: 35 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: 0xff88cc,
      quantity: 1,
      frequency: 700,
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.setDepth(9993);
    pt.setData('emitter', emitter);
    this.pinkTreatGroup.refresh();
  }

  private spawnAxol(x: number, y: number): void {
    this.axol = new Axol(this, x, y);
    const allObstacles: Rect[] = [
      ...this.cfg.walls,
      ...this.cfg.furniture.map(f => f.rect),
    ];
    this.axol.setObstacles(allObstacles);
    this.wireAxolCollisions();
  }

  private wireAxolCollisions(): void {
    const axol = this.axol!;

    // Axol collides with walls and furniture so she doesn't clip through
    this.physics.add.collider(axol.sprite, this.wallGroup);
    this.physics.add.collider(axol.sprite, this.furnitureGroup);

    // Axol collects blue treats (counted toward Mollie's total)
    this.physics.add.overlap(
      axol.sprite,
      this.treatGroup,
      (_axolSprite, treatObj) => {
        if (this.isGameOver) return;
        if (!this.axol?.isAlive()) return;
        const treat = treatObj as Phaser.Physics.Arcade.Image;
        (treat.getData('emitter') as Phaser.GameObjects.Particles.ParticleEmitter)?.destroy();
        treat.destroy();
        this.player.collectTreat();
        if (this.cache.audio.exists('crunch')) this.sound.play('crunch', { volume: 0.35 });
        if (this.player.getTreatCount() >= this.cfg.totalTreats) {
          this.triggerWin();
        }
      },
    );

    // Roswell catches Axol → poof
    const catchAxol = () => {
      if (!this.axol?.isAlive()) return;
      this.axol.poof();
      this.axol = null;
    };
    this.physics.add.overlap(this.enemy.sprite, axol.sprite, catchAxol);
    if (this.enemy2) {
      this.physics.add.overlap(this.enemy2.sprite, axol.sprite, catchAxol);
    }
    if (this.enemy3) {
      this.physics.add.overlap(this.enemy3.sprite, axol.sprite, catchAxol);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private addStaticRect(
    group: Phaser.Physics.Arcade.StaticGroup,
    rect: Rect,
    texture: string,
  ): void {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const sprite = group.create(cx, cy, texture) as Phaser.Physics.Arcade.Image;
    sprite.setDisplaySize(rect.w, rect.h);
    sprite.refreshBody();
    sprite.setDepth(rect.y + rect.h / 2);
  }

  private isWalkable(x: number, y: number): boolean {
    if (x < 0 || x > this.cfg.worldWidth || y < 0 || y > this.cfg.worldHeight) return false;
    const C = 14;
    for (const r of [...this.cfg.walls, ...this.cfg.furniture.map(f => f.rect)]) {
      if (x >= r.x - C && x <= r.x + r.w + C &&
          y >= r.y - C && y <= r.y + r.h + C) return false;
    }
    return true;
  }

  private ensureTexture(
    key: string,
    w: number,
    h: number,
    draw: (gfx: Phaser.GameObjects.Graphics) => void,
  ): void {
    if (this.textures.exists(key)) return;
    const gfx = this.add.graphics();
    draw(gfx);
    gfx.generateTexture(key, w, h);
    gfx.destroy();
  }
}
