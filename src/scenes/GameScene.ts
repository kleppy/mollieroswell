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
  private enemy2: Enemy | null = null; // Level 3 only
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
      }
    }

    this.ui = new UI(this, this.levelNum, LEVELS.length, this.cfg.totalTreats, () => {
      const muted = this.audioManager?.toggleMute() ?? false;
      // Persist mute state across scene restarts via Phaser data manager.
      this.data.set('muted', muted);
      return muted;
    });

    // Initial bark offset so Roswell doesn't bark the instant a level starts.
    this.barkTimer = 2000 + Math.random() * 2000;

    // Stop audio when the scene shuts down (restart or transition).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audioManager?.stop());

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
    this.audioManager.playBark(dist);

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
    // Tile 0 (data 1): Grass yard
    gfx.fillStyle(0x3d6b27); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0x356020);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0x477530);
    gfx.fillRect(16, 0, 16, 16); gfx.fillRect(0, 16, 16, 16);
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        gfx.fillRect(c * 8 + (r % 2) * 3, r * 8 + 1, 2, 4);
        gfx.fillRect(c * 8 + 5 - (r % 2) * 2, r * 8 + 3, 1, 3);
      }
    gfx.fillStyle(0xffff80); gfx.fillRect(5, 10, 2, 2);
    gfx.fillStyle(0xffffff); gfx.fillRect(22, 24, 2, 2);

    // Tile 1 (data 2): Living-room hardwood
    gfx.fillStyle(0xd4a870); gfx.fillRect(32, 0, 32, 32);
    gfx.fillStyle(0xb08858);
    for (let i = 0; i < 4; i++) gfx.fillRect(32, i * 8, 32, 1);
    gfx.fillStyle(0xe0b87a);
    gfx.fillRect(32, 2, 14, 1); gfx.fillRect(48, 10, 12, 1);
    gfx.fillRect(36, 18, 16, 1); gfx.fillRect(32, 26, 10, 1);
    gfx.fillStyle(0xb08858);
    gfx.fillRect(32 + 16, 0, 1, 8); gfx.fillRect(32 + 8, 8, 1, 8);
    gfx.fillRect(32 + 20, 16, 1, 8); gfx.fillRect(32 + 12, 24, 1, 8);

    // Tile 2 (data 3): Kitchen ceramic tiles
    gfx.fillStyle(0xe8e0d0); gfx.fillRect(64, 0, 32, 32);
    gfx.fillStyle(0xb4aca0);
    for (let i = 0; i <= 4; i++) gfx.fillRect(64, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(64 + j * 8, 0, 1, 32);
    gfx.fillStyle(0xddd5c5);
    gfx.fillRect(65, 1, 7, 7); gfx.fillRect(81, 1, 7, 7);
    gfx.fillRect(73, 9, 7, 7); gfx.fillRect(89, 9, 7, 7);
    gfx.fillRect(65, 17, 7, 7); gfx.fillRect(81, 17, 7, 7);
    gfx.fillRect(73, 25, 7, 7); gfx.fillRect(89, 25, 7, 7);

    // Tile 3 (data 4): Hallway
    gfx.fillStyle(0xb8956a); gfx.fillRect(96, 0, 32, 32);
    gfx.fillStyle(0x906a48);
    gfx.fillRect(96, 0, 32, 2); gfx.fillRect(96, 30, 32, 2);
    gfx.fillRect(96, 0, 2, 32); gfx.fillRect(126, 0, 2, 32);
    gfx.fillStyle(0xca9f78);
    gfx.fillRect(98, 8, 28, 16);
  }

  private drawTilesetWaterPark(gfx: Phaser.GameObjects.Graphics): void {
    // Tile 0 (data 1): Concrete deck (light tan)
    gfx.fillStyle(0xd8cdb8); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0xc8bcaa);
    for (let i = 0; i <= 4; i++) gfx.fillRect(0, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(j * 8, 0, 1, 32);

    // Tile 1 (data 2): Same as tile 0 (only one tile type used in water park)
    gfx.fillStyle(0xd8cdb8); gfx.fillRect(32, 0, 32, 32);
    gfx.fillStyle(0xc8bcaa);
    for (let i = 0; i <= 4; i++) gfx.fillRect(32, i * 8, 32, 1);

    // Tile 2 (data 3): Sandy border
    gfx.fillStyle(0xe8d898); gfx.fillRect(64, 0, 32, 32);
    gfx.fillStyle(0xd8c880);
    for (let i = 0; i < 3; i++) {
      gfx.fillRect(64 + i * 11, 4, 8, 6);
      gfx.fillRect(64 + i * 11 + 5, 16, 6, 5);
    }

    // Tile 3 (data 4): Grass border
    gfx.fillStyle(0x3d6b27); gfx.fillRect(96, 0, 32, 32);
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        gfx.fillRect(96 + c * 8 + (r % 2) * 3, r * 8 + 1, 2, 4);
  }

  private drawTilesetPark(gfx: Phaser.GameObjects.Graphics): void {
    // Tile 0 (data 1): Grass (main)
    gfx.fillStyle(0x3d6b27); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0x356020);
    gfx.fillRect(0, 0, 16, 16); gfx.fillRect(16, 16, 16, 16);
    gfx.fillStyle(0x5a8c38);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        gfx.fillRect(c * 8 + (r % 2) * 3, r * 8 + 1, 2, 4);
    gfx.fillStyle(0xffff80); gfx.fillRect(5, 10, 2, 2);

    // Tile 1 (data 2): Dirt path (tan-brown)
    gfx.fillStyle(0xc8a870); gfx.fillRect(32, 0, 32, 32);
    gfx.fillStyle(0xb09060);
    gfx.fillRect(32, 8, 32, 1); gfx.fillRect(32, 20, 32, 1);
    gfx.fillStyle(0xd8b880);
    gfx.fillRect(35, 3, 8, 2); gfx.fillRect(50, 13, 6, 2);
    gfx.fillRect(38, 24, 10, 2);

    // Tile 2 (data 3): Dark flowerbed
    gfx.fillStyle(0x3a2818); gfx.fillRect(64, 0, 32, 32);
    gfx.fillStyle(0xff6060); gfx.fillCircle(68, 4, 2); gfx.fillCircle(76, 8, 2);
    gfx.fillStyle(0xffff40); gfx.fillCircle(72, 14, 2); gfx.fillCircle(84, 6, 2);
    gfx.fillStyle(0xff80ff); gfx.fillCircle(80, 18, 2); gfx.fillCircle(68, 20, 2);
    gfx.fillStyle(0x40cc40); gfx.fillRect(66, 2, 1, 4); gfx.fillRect(70, 6, 1, 4);

    // Tile 3 (data 4): Stone border
    gfx.fillStyle(0x909090); gfx.fillRect(96, 0, 32, 32);
    gfx.fillStyle(0x808080);
    gfx.fillRect(96, 10, 32, 2); gfx.fillRect(96, 22, 32, 2);
    gfx.fillRect(104, 0, 2, 32); gfx.fillRect(118, 0, 2, 32);
    gfx.fillStyle(0xa8a8a8);
    gfx.fillRect(97, 1, 6, 8); gfx.fillRect(105, 1, 12, 8);
    gfx.fillRect(97, 13, 10, 8); gfx.fillRect(109, 13, 8, 8);
  }

  private drawTilesetCity(gfx: Phaser.GameObjects.Graphics): void {
    // Tile 0 (data 1): Asphalt (dark grey)
    gfx.fillStyle(0x404048); gfx.fillRect(0, 0, 32, 32);
    gfx.fillStyle(0x383840);
    gfx.fillRect(0, 15, 32, 2);
    gfx.fillStyle(0x484850);
    gfx.fillRect(4, 0, 1, 32); gfx.fillRect(20, 0, 1, 32);

    // Tile 1 (data 2): Sidewalk (light grey)
    gfx.fillStyle(0xb0b0b8); gfx.fillRect(32, 0, 32, 32);
    gfx.fillStyle(0xa0a0a8);
    for (let i = 0; i <= 4; i++) gfx.fillRect(32, i * 8, 32, 1);
    for (let j = 0; j <= 4; j++) gfx.fillRect(32 + j * 8, 0, 1, 32);
    gfx.fillStyle(0xc0c0c8);
    gfx.fillRect(33, 1, 7, 7); gfx.fillRect(49, 9, 7, 7);
    gfx.fillRect(33, 17, 7, 7); gfx.fillRect(49, 25, 7, 7);

    // Tile 2 (data 3): Building base (tan, rarely visible)
    gfx.fillStyle(0xc8b898); gfx.fillRect(64, 0, 32, 32);
    gfx.fillStyle(0xb8a888);
    gfx.fillRect(64, 0, 32, 2); gfx.fillRect(64, 30, 32, 2);

    // Tile 3 (data 4): Road marking (yellow stripe on asphalt)
    gfx.fillStyle(0x404048); gfx.fillRect(96, 0, 32, 32);
    gfx.fillStyle(0xffcc00);
    gfx.fillRect(110, 0, 4, 12); gfx.fillRect(110, 18, 4, 14);
  }

  private buildWalls(): void {
    this.ensureTexture('wall', 8, 8, (gfx) => {
      gfx.fillStyle(0x4a5878); gfx.fillRect(0, 0, 8, 8);
      gfx.fillStyle(0x6878a0); gfx.fillRect(0, 3, 8, 2);
      gfx.fillStyle(0x3e4e6e); gfx.fillRect(0, 0, 3, 3);
      gfx.fillStyle(0x4a5a7c); gfx.fillRect(4, 0, 4, 3);
      gfx.fillStyle(0x3a4a6a); gfx.fillRect(1, 5, 5, 3);
      gfx.fillStyle(0x587090); gfx.fillRect(0, 7, 8, 1);
    });

    for (const wall of this.cfg.walls) {
      this.addStaticRect(this.wallGroup, wall, 'wall');
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
    this.ensureTexture('furniture-couch', 36, 14, (gfx) => {
      gfx.fillStyle(0x4a5888); gfx.fillRect(0, 0, 36, 8);
      gfx.fillStyle(0x5568a0);
      gfx.fillRect(1, 1, 10, 6); gfx.fillRect(13, 1, 10, 6); gfx.fillRect(25, 1, 10, 6);
      gfx.fillStyle(0x6070b0); gfx.fillRect(0, 8, 36, 4);
      gfx.fillStyle(0x3a4878);
      gfx.fillRect(12, 8, 1, 4); gfx.fillRect(24, 8, 1, 4);
      gfx.fillStyle(0x3a4878);
      gfx.fillRect(0, 0, 3, 14); gfx.fillRect(33, 0, 3, 14);
      gfx.fillStyle(0x2a2020);
      gfx.fillRect(3, 12, 3, 2); gfx.fillRect(30, 12, 3, 2);
    });

    this.ensureTexture('furniture-table', 24, 16, (gfx) => {
      gfx.fillStyle(0xc49a50); gfx.fillRect(0, 0, 24, 16);
      gfx.fillStyle(0xad8438);
      gfx.fillRect(0, 2, 24, 1); gfx.fillRect(0, 6, 24, 1);
      gfx.fillRect(0, 10, 24, 1); gfx.fillRect(0, 14, 24, 1);
      gfx.fillStyle(0xd8a85c);
      gfx.fillRect(2, 3, 10, 1); gfx.fillRect(14, 7, 8, 1);
      gfx.fillStyle(0x7a5c28);
      gfx.fillRect(1, 1, 3, 3); gfx.fillRect(20, 1, 3, 3);
      gfx.fillRect(1, 12, 3, 3); gfx.fillRect(20, 12, 3, 3);
      gfx.fillStyle(0xe8dcc8); gfx.fillCircle(12, 8, 3);
      gfx.fillStyle(0xd4704a); gfx.fillCircle(12, 8, 2);
    });

    this.ensureTexture('furniture-bookshelf', 14, 24, (gfx) => {
      gfx.fillStyle(0x3a2a18); gfx.fillRect(0, 0, 14, 24);
      gfx.fillStyle(0x5a4028);
      gfx.fillRect(1, 5, 12, 1); gfx.fillRect(1, 11, 12, 1); gfx.fillRect(1, 17, 12, 1);
      gfx.fillStyle(0xcc3030); gfx.fillRect(1, 1, 2, 4);
      gfx.fillStyle(0x3060cc); gfx.fillRect(3, 1, 2, 4);
      gfx.fillStyle(0x308848); gfx.fillRect(5, 1, 3, 4);
      gfx.fillStyle(0xd4a820); gfx.fillRect(8, 1, 2, 4);
      gfx.fillStyle(0x884488); gfx.fillRect(10, 1, 3, 4);
      gfx.fillStyle(0xd06020); gfx.fillRect(1, 7, 3, 4);
      gfx.fillStyle(0x408848); gfx.fillRect(4, 7, 2, 4);
      gfx.fillStyle(0xcc3030); gfx.fillRect(6, 7, 2, 4);
      gfx.fillStyle(0x304888); gfx.fillRect(8, 7, 3, 4);
      gfx.fillStyle(0xc8b040); gfx.fillRect(11, 7, 2, 4);
      gfx.fillStyle(0x3060cc); gfx.fillRect(1, 13, 2, 4);
      gfx.fillStyle(0x884488); gfx.fillRect(3, 13, 3, 4);
      gfx.fillStyle(0xd4a820); gfx.fillRect(6, 13, 2, 4);
      gfx.fillStyle(0xcc3030); gfx.fillRect(8, 13, 2, 4);
      gfx.fillStyle(0x308848); gfx.fillRect(10, 13, 3, 4);
      gfx.fillStyle(0xd06020); gfx.fillRect(1, 19, 2, 4);
      gfx.fillStyle(0x304888); gfx.fillRect(3, 19, 3, 4);
      gfx.fillStyle(0x408848); gfx.fillRect(6, 19, 2, 4);
      gfx.fillStyle(0xcc3030); gfx.fillRect(8, 19, 3, 4);
    });

    this.ensureTexture('furniture-kitchen-table', 28, 20, (gfx) => {
      gfx.fillStyle(0xe0c080); gfx.fillRect(0, 0, 28, 20);
      gfx.fillStyle(0xc8a860);
      gfx.fillRect(0, 3, 28, 1); gfx.fillRect(0, 7, 28, 1);
      gfx.fillRect(0, 12, 28, 1); gfx.fillRect(0, 16, 28, 1);
      gfx.fillStyle(0xecd090);
      gfx.fillRect(3, 4, 12, 1); gfx.fillRect(16, 8, 10, 1);
      gfx.fillStyle(0x9a7030);
      gfx.fillRect(1, 1, 3, 3); gfx.fillRect(24, 1, 3, 3);
      gfx.fillRect(1, 16, 3, 3); gfx.fillRect(24, 16, 3, 3);
      gfx.fillStyle(0xcc2020); gfx.fillCircle(14, 10, 3);
      gfx.fillStyle(0x208830); gfx.fillRect(14, 7, 1, 2);
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
      gfx.fillStyle(0xb8a888); gfx.fillRect(0, 0, 24, 24);
      gfx.fillStyle(0x606878); gfx.fillRect(0, 0, 24, 8);
      gfx.fillStyle(0x505868);
      for (let px = 0; px < 24; px += 3) gfx.fillRect(px, 0, 1, 8);
      gfx.fillStyle(0x808898); gfx.fillRect(0, 7, 24, 1);
      gfx.fillStyle(0x9a8868);
      gfx.fillRect(0, 8, 24, 1); gfx.fillRect(0, 23, 24, 1);
      gfx.fillRect(0, 8, 1, 16); gfx.fillRect(23, 8, 1, 16);
      gfx.fillStyle(0x7a5830); gfx.fillRect(9, 14, 6, 9);
      gfx.fillStyle(0x5a4020);
      gfx.fillRect(8, 13, 8, 1); gfx.fillRect(8, 23, 8, 1);
      gfx.fillRect(8, 13, 1, 10); gfx.fillRect(15, 13, 1, 10);
      gfx.fillStyle(0xd4a820); gfx.fillRect(14, 18, 1, 2);
      gfx.fillStyle(0x8ab8d8);
      gfx.fillRect(2, 11, 4, 4); gfx.fillRect(18, 11, 4, 4);
      gfx.fillStyle(0x9a8868);
      gfx.fillRect(2, 11, 4, 1); gfx.fillRect(2, 14, 4, 1);
      gfx.fillRect(2, 11, 1, 4); gfx.fillRect(5, 11, 1, 4);
      gfx.fillRect(18, 11, 4, 1); gfx.fillRect(18, 14, 4, 1);
      gfx.fillRect(18, 11, 1, 4); gfx.fillRect(21, 11, 1, 4);
      gfx.fillStyle(0xb8a888);
      gfx.fillRect(3, 12, 2, 1); gfx.fillRect(4, 11, 1, 3);
      gfx.fillRect(19, 12, 2, 1); gfx.fillRect(20, 11, 1, 3);
    });
  }

  private buildTexturesWaterPark(): void {
    // Main pool — bright blue with wave lines
    this.ensureTexture('wpark-pool', 32, 32, (gfx) => {
      gfx.fillStyle(0x0088cc); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x00aaee);
      for (let wy = 4; wy < 32; wy += 7) {
        for (let wx = 0; wx < 32; wx += 8)
          gfx.fillRect(wx, wy, 5, 2);
      }
      gfx.fillStyle(0x66ccff);
      gfx.fillRect(4, 6, 8, 2); gfx.fillRect(18, 12, 6, 2);
      gfx.fillRect(8, 20, 10, 2);
    });

    // Wading pool — shallower teal
    this.ensureTexture('wpark-wading', 32, 32, (gfx) => {
      gfx.fillStyle(0x00ccaa); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x00eebb);
      for (let wy = 4; wy < 32; wy += 8)
        gfx.fillRect(2, wy, 28, 2);
      gfx.fillStyle(0xaaffee); gfx.fillRect(6, 8, 6, 3);
    });

    // Slide tower — yellow/orange platform
    this.ensureTexture('wpark-slide', 32, 32, (gfx) => {
      gfx.fillStyle(0xe08020); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0xffa040);
      gfx.fillRect(2, 2, 28, 6);
      gfx.fillStyle(0xffff60); gfx.fillRect(4, 3, 10, 4);
      gfx.fillStyle(0x804010);
      gfx.fillRect(10, 8, 4, 24);
      gfx.fillStyle(0xcc6010);
      for (let sy = 12; sy < 32; sy += 6) gfx.fillRect(0, sy, 32, 3);
    });

    // Snack stand — striped canopy
    this.ensureTexture('wpark-snack', 32, 32, (gfx) => {
      gfx.fillStyle(0xf0e0c0); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0xdd2020);
      for (let sx = 0; sx < 32; sx += 6) gfx.fillRect(sx, 0, 3, 10);
      gfx.fillStyle(0xffffff); gfx.fillRect(0, 10, 32, 1);
      gfx.fillStyle(0xa08060); gfx.fillRect(2, 11, 28, 20);
      gfx.fillStyle(0x604020); gfx.fillRect(12, 16, 8, 15);
    });

    // Cabin — small hut
    this.ensureTexture('wpark-cabin', 32, 32, (gfx) => {
      gfx.fillStyle(0x8a6a4a); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x6a4a2a);
      gfx.fillRect(0, 0, 32, 1); gfx.fillRect(0, 0, 1, 32);
      gfx.fillRect(31, 0, 1, 32); gfx.fillRect(0, 31, 32, 1);
      gfx.fillStyle(0x554030);
      for (let cy = 4; cy < 32; cy += 6) gfx.fillRect(0, cy, 32, 1);
      gfx.fillStyle(0x8ab8d8);
      gfx.fillRect(4, 8, 8, 6); gfx.fillRect(20, 8, 8, 6);
      gfx.fillStyle(0xaa6030); gfx.fillRect(12, 18, 8, 14);
    });

    // Lounge chair — yellow recliner (tiny)
    this.ensureTexture('wpark-lounge', 16, 8, (gfx) => {
      gfx.fillStyle(0xeebb44); gfx.fillRect(0, 0, 16, 8);
      gfx.fillStyle(0xcc9922);
      gfx.fillRect(0, 0, 16, 2);
      gfx.fillRect(0, 0, 2, 8); gfx.fillRect(14, 0, 2, 8);
      gfx.fillStyle(0xffdd66); gfx.fillRect(2, 3, 12, 2);
    });
  }

  private buildTexturesPark(): void {
    // Fountain — blue circle, spray arcs
    this.ensureTexture('park-fountain', 32, 32, (gfx) => {
      gfx.fillStyle(0x8899aa); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x0077cc); gfx.fillCircle(16, 16, 13);
      gfx.fillStyle(0x55aaff); gfx.fillCircle(16, 16, 8);
      gfx.fillStyle(0xaaddff);
      gfx.fillCircle(16, 8, 3); gfx.fillCircle(16, 8, 2);
      gfx.fillStyle(0xffffff);
      gfx.fillRect(15, 5, 2, 6);
      gfx.fillRect(10, 8, 2, 4); gfx.fillRect(20, 8, 2, 4);
    });

    // Pond — deep blue
    this.ensureTexture('park-pond', 32, 32, (gfx) => {
      gfx.fillStyle(0x005588); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x0077aa);
      gfx.fillRect(2, 2, 28, 28);
      gfx.fillStyle(0x0099cc);
      for (let py = 6; py < 28; py += 7)
        for (let px = 4; px < 28; px += 9)
          gfx.fillRect(px, py, 6, 2);
      gfx.fillStyle(0x55bbdd); gfx.fillRect(8, 10, 6, 3);
    });

    // Tree — same tiered canopy as existing 'tree' but key 'park-tree'
    this.ensureTexture('park-tree', 44, 44, (gfx) => {
      gfx.fillStyle(0x7a5030); gfx.fillRect(19, 28, 6, 12);
      gfx.fillStyle(0x1c5c1c); gfx.fillCircle(22, 18, 16);
      gfx.fillStyle(0x2a7830); gfx.fillCircle(22, 16, 13);
      gfx.fillStyle(0x38922a);
      gfx.fillCircle(14, 14, 7); gfx.fillCircle(28, 13, 8);
      gfx.fillCircle(20, 8, 6); gfx.fillCircle(26, 20, 6);
      gfx.fillStyle(0x58b840);
      gfx.fillCircle(16, 10, 4); gfx.fillCircle(24, 9, 4);
    });

    // Bench — wooden slats
    this.ensureTexture('park-bench', 32, 12, (gfx) => {
      gfx.fillStyle(0x7a5030); gfx.fillRect(0, 0, 32, 12);
      gfx.fillStyle(0x9a6a40);
      for (let bx = 0; bx < 32; bx += 8)
        gfx.fillRect(bx + 1, 1, 6, 6);
      gfx.fillStyle(0x5a3820);
      gfx.fillRect(2, 7, 4, 4); gfx.fillRect(26, 7, 4, 4);
    });

    // Swings — A-frame
    this.ensureTexture('park-swings', 32, 32, (gfx) => {
      gfx.fillStyle(0x888888); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x606060);
      gfx.fillRect(0, 0, 32, 3);
      gfx.fillRect(0, 0, 3, 20); gfx.fillRect(29, 0, 3, 20);
      gfx.fillStyle(0x404040);
      gfx.fillRect(6, 3, 2, 16); gfx.fillRect(14, 3, 2, 16); gfx.fillRect(22, 3, 2, 16);
      gfx.fillStyle(0xcc9944);
      gfx.fillRect(4, 19, 6, 4); gfx.fillRect(12, 19, 6, 4); gfx.fillRect(20, 19, 6, 4);
    });

    // Sandbox — sandy fill with rim
    this.ensureTexture('park-sandbox', 32, 32, (gfx) => {
      gfx.fillStyle(0xa08040); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0xe8d880); gfx.fillRect(3, 3, 26, 26);
      gfx.fillStyle(0xf0e898);
      gfx.fillRect(5, 5, 8, 6); gfx.fillRect(18, 12, 6, 6);
      gfx.fillRect(8, 18, 10, 5);
      gfx.fillStyle(0xcc9930); gfx.fillCircle(20, 7, 3);
    });
  }

  private buildTexturesCity(): void {
    // Building — grey concrete, window grid
    this.ensureTexture('city-building', 32, 32, (gfx) => {
      gfx.fillStyle(0x787878); gfx.fillRect(0, 0, 32, 32);
      gfx.fillStyle(0x686868);
      gfx.fillRect(0, 0, 32, 2); gfx.fillRect(0, 30, 32, 2);
      gfx.fillRect(0, 0, 2, 32); gfx.fillRect(30, 0, 2, 32);
      gfx.fillStyle(0x8ab8d8);
      for (let gy = 4; gy < 28; gy += 8)
        for (let gx = 4; gx < 28; gx += 8)
          gfx.fillRect(gx, gy, 5, 5);
      gfx.fillStyle(0x506070);
      for (let gy = 4; gy < 28; gy += 8)
        for (let gx = 4; gx < 28; gx += 8) {
          gfx.fillRect(gx, gy, 5, 1);
          gfx.fillRect(gx, gy, 1, 5);
        }
    });

    // Car — top-down, coloured body, windshield, wheels
    this.ensureTexture('city-car', 16, 24, (gfx) => {
      gfx.fillStyle(0xcc2020); gfx.fillRect(0, 0, 16, 24);
      gfx.fillStyle(0x8ab8d8);
      gfx.fillRect(2, 3, 12, 6);
      gfx.fillRect(2, 16, 12, 5);
      gfx.fillStyle(0x1a1a1a);
      gfx.fillRect(0, 2, 3, 5); gfx.fillRect(13, 2, 3, 5);
      gfx.fillRect(0, 17, 3, 5); gfx.fillRect(13, 17, 3, 5);
      gfx.fillStyle(0xee4444);
      gfx.fillRect(2, 9, 12, 7);
    });
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
    const rug = this.add.graphics();
    rug.fillStyle(0x7a1515);
    rug.fillRoundedRect(32, 86, 264, 158, 10);
    rug.fillStyle(0x9a2525);
    rug.fillRoundedRect(40, 94, 248, 142, 7);
    rug.fillStyle(0x6a1010);
    rug.fillRect(40, 94, 248, 4); rug.fillRect(40, 232, 248, 4);
    rug.fillRect(40, 94, 4, 142); rug.fillRect(284, 94, 4, 142);
    rug.setDepth(0.5);

    const mat = this.add.graphics();
    mat.fillStyle(0x3a5a2a);
    mat.fillRoundedRect(42, 445, 135, 96, 6);
    mat.fillStyle(0x4a7038);
    mat.fillRoundedRect(50, 452, 119, 82, 4);
    mat.setDepth(0.5);

    const patio = this.add.graphics();
    patio.fillStyle(0x9a9080);
    patio.fillRect(492, 424, 80, 154);
    patio.fillStyle(0x888070);
    for (let py = 424; py < 578; py += 26) patio.fillRect(492, py, 80, 2);
    for (let px = 492; px < 572; px += 26) patio.fillRect(px, 424, 2, 154);
    patio.setDepth(0.5);

    for (let fy = 28; fy <= 405; fy += 28) {
      this.add.rectangle(492, fy + 12, 5, 22, 0xb89050).setDepth(fy + 22);
    }
    for (let fy = 588; fy <= 738; fy += 28) {
      this.add.rectangle(492, fy + 12, 5, 22, 0xb89050).setDepth(fy + 22);
    }
    this.add.rectangle(492, 428, 7, 20, 0x906030).setDepth(438);
    this.add.rectangle(492, 572, 7, 20, 0x906030).setDepth(582);

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
    for (const tp of [{ x: 632, y: 300 }, { x: 882, y: 345 }]) {
      this.add.image(tp.x, tp.y, 'tree').setDepth(tp.y + 18);
    }
  }

  private buildDecorativesWaterPark(): void {
    // Pool lane markings
    const lanes = this.add.graphics();
    lanes.lineStyle(2, 0xffffff, 0.5);
    for (let lx = 160; lx < 480; lx += 64) {
      lanes.beginPath();
      lanes.moveTo(lx, 200);
      lanes.lineTo(lx, 460);
      lanes.strokePath();
    }
    lanes.setDepth(0.6);

    // Path from main pool to wading pool
    const path = this.add.graphics();
    path.fillStyle(0xc8b898, 0.7);
    path.fillRect(180, 460, 60, 240);
    path.setDepth(0.5);

    // Snack stand sign
    this.add.text(940, 105, 'SNACKS', {
      fontSize: '12px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(200);
  }

  private buildDecorativesPark(): void {
    // Curved paths connecting fountain to zones
    const paths = this.add.graphics();
    paths.fillStyle(0xc8a870, 0.8);
    paths.fillRect(100, 460, 440, 32); // horizontal path to fountain
    paths.fillRect(590, 100, 32, 360); // vertical path north to fountain
    paths.fillRect(660, 452, 200, 32); // east path from fountain
    paths.setDepth(0.5);

    // Flowerbed patches
    const flowers = this.add.graphics();
    flowers.fillStyle(0x3a2818);
    flowers.fillEllipse(700, 700, 80, 50);
    flowers.fillEllipse(300, 200, 60, 40);
    flowers.fillEllipse(1100, 500, 70, 45);
    flowers.fillStyle(0xff6060);
    for (const fp of [{ x: 680, y: 695 }, { x: 710, y: 705 }, { x: 695, y: 685 }])
      flowers.fillCircle(fp.x, fp.y, 5);
    flowers.fillStyle(0xffff40);
    for (const fp of [{ x: 290, y: 196 }, { x: 308, y: 202 }])
      flowers.fillCircle(fp.x, fp.y, 4);
    flowers.setDepth(0.6);

    // Bench pads
    const pads = this.add.graphics();
    pads.fillStyle(0xb8a870, 0.6);
    for (const bp of [
      { x: 190, y: 375 }, { x: 190, y: 515 },
      { x: 750, y: 395 }, { x: 750, y: 575 }, { x: 530, y: 695 },
    ]) {
      pads.fillRect(bp.x, bp.y, 100, 38);
    }
    pads.setDepth(0.5);
  }

  private buildDecorativesCity(): void {
    // Road centre lines (dashed yellow)
    const lines = this.add.graphics();
    lines.fillStyle(0xffcc00);
    // Vertical centre lines
    for (const cx of [400, 790]) {
      for (let ly = 80; ly < 940; ly += 32) {
        lines.fillRect(cx - 1, ly, 3, 18);
      }
    }
    // Horizontal centre line (mid E-W crossing)
    for (let lx = 80; lx < 1200; lx += 32) {
      lines.fillRect(lx, 479, 18, 3);
    }
    lines.setDepth(0.6);

    // Sidewalk kerb lines
    const kerbs = this.add.graphics();
    kerbs.lineStyle(3, 0x888888, 0.8);
    // Building outlines (kerb edge)
    for (const b of this.cfg.furniture.filter(f => f.textureKey === 'city-building')) {
      kerbs.strokeRect(b.rect.x - 2, b.rect.y - 2, b.rect.w + 4, b.rect.h + 4);
    }
    kerbs.setDepth(0.7);

    // Streetlight posts (decorative, no physics)
    for (const slp of [
      { x: 375, y: 120 }, { x: 375, y: 380 }, { x: 375, y: 640 },
      { x: 685, y: 120 }, { x: 685, y: 380 }, { x: 685, y: 640 },
      { x: 895, y: 380 },
    ]) {
      this.add.rectangle(slp.x, slp.y, 4, 24, 0x404040).setDepth(slp.y + 12);
      this.add.rectangle(slp.x, slp.y - 12, 12, 4, 0x404040).setDepth(slp.y);
      this.add.rectangle(slp.x + 6, slp.y - 12, 6, 6, 0xffffaa, 0.9).setDepth(slp.y);
    }
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
      this.ui.showWin(this);
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
      this.axol?.poof();
      this.axol = null;
    };
    this.physics.add.overlap(this.enemy.sprite, axol.sprite, catchAxol);
    if (this.enemy2) {
      this.physics.add.overlap(this.enemy2.sprite, axol.sprite, catchAxol);
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
