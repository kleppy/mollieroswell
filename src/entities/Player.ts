import Phaser from 'phaser';
import { PLAYER_SPEED, POOP_DURATION_MS, POOP_CHARGES_START } from '../constants';

export class Player {
  sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  poops: Phaser.Physics.Arcade.StaticGroup;

  private scene: Phaser.Scene;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private spaceKey: Phaser.Input.Keyboard.Key;
  private poopCharges: number = POOP_CHARGES_START;
  private treatCount: number = 0;
  private facingRight = true;
  private shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;

    // Generate poop texture: emoji-style pile (16×16)
    if (!scene.textures.exists('poop')) {
      const gfx = scene.add.graphics();
      // Base tier — widest, darkest
      gfx.fillStyle(0x5a2a0a); gfx.fillEllipse(8, 14, 14, 6);
      // Middle tier
      gfx.fillStyle(0x6b3311); gfx.fillEllipse(8, 10, 11, 7);
      // Upper tier
      gfx.fillStyle(0x7a3c18); gfx.fillEllipse(8, 6.5, 8, 6);
      // Top curl
      gfx.fillStyle(0x8a4822); gfx.fillEllipse(8, 3, 5, 5);
      // Highlight on curl
      gfx.fillStyle(0xcc7044); gfx.fillEllipse(6.5, 1.5, 2.5, 2);
      // White eyes
      gfx.fillStyle(0xffffff); gfx.fillCircle(5, 10, 2); gfx.fillCircle(11, 10, 2);
      // Pupils
      gfx.fillStyle(0x111111); gfx.fillCircle(5, 10, 1); gfx.fillCircle(11, 10, 1);
      // Eye shine
      gfx.fillStyle(0xffffff); gfx.fillRect(5, 9, 1, 1); gfx.fillRect(11, 9, 1, 1);
      gfx.generateTexture('poop', 16, 16);
      gfx.destroy();
    }

    this.shadow = scene.add.ellipse(x, y + 6, 20, 7, 0x000000, 0.25);

    this.sprite = scene.physics.add.sprite(x, y, 'mollie');
    this.sprite.setDisplaySize(54, 42);
    this.sprite.body.setSize(20, 12, true);
    this.sprite.setDepth(y);
    this.sprite.setCollideWorldBounds(true);

    this.poops = scene.physics.add.staticGroup();

    const kb = scene.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.spaceKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  update(): void {
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    let vx = 0;
    let vy = 0;
    if (left) vx -= PLAYER_SPEED;
    if (right) vx += PLAYER_SPEED;
    if (up) vy -= PLAYER_SPEED;
    if (down) vy += PLAYER_SPEED;

    // Diagonal normalisation (×0.707)
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    this.sprite.setVelocity(vx, vy);

    // Directional facing (flipX false = head right = moving right)
    if (vx > 0) this.facingRight = true;
    else if (vx < 0) this.facingRight = false;
    this.sprite.setFlipX(!this.facingRight);

    // Y-depth + shadow
    this.sprite.setDepth(this.sprite.y);
    this.shadow.setPosition(this.sprite.x, this.sprite.y + 6);
    this.shadow.setDepth(this.sprite.y - 0.5);

    // Poop drop — JustDown prevents hold-to-spam
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.poopCharges > 0) {
      this.dropPoop();
    }
  }

  private dropPoop(): void {
    this.poopCharges--;
    const poop = this.poops.create(
      this.sprite.x,
      this.sprite.y,
      'poop',
    ) as Phaser.Physics.Arcade.Image;
    poop.setDisplaySize(19, 19);
    poop.setDepth(4);
    poop.refreshBody();

    this.scene.time.delayedCall(POOP_DURATION_MS, () => {
      if (poop.active) {
        poop.destroy();
      }
    });
  }

  collectTreat(): void {
    this.treatCount++;
  }

  getPoopCharges(): number {
    return this.poopCharges;
  }

  getTreatCount(): number {
    return this.treatCount;
  }
}
