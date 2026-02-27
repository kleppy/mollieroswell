import Phaser from 'phaser';

export class UI {
  private treatsText: Phaser.GameObjects.Text;
  private poopsText: Phaser.GameObjects.Text;
  private helpText: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private muteBtn: Phaser.GameObjects.Text;
  private totalTreats: number;

  /**
   * @param onMuteToggle  Called when the player toggles mute (button or M key).
   *                      Should return the NEW muted state (true = muted).
   */
  constructor(
    scene: Phaser.Scene,
    levelNum: number,
    totalLevels: number,
    totalTreats: number,
    onMuteToggle: () => boolean,
  ) {
    this.totalTreats = totalTreats;

    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    };

    this.treatsText = scene.add
      .text(20, 20, `Treats: 0/${totalTreats}`, textStyle)
      .setScrollFactor(0)
      .setDepth(1000);

    this.poopsText = scene.add
      .text(20, 46, 'Poops: 3', textStyle)
      .setScrollFactor(0)
      .setDepth(1000);

    this.helpText = scene.add
      .text(20, scene.scale.height - 36, 'Move: WASD/Arrows   Drop Poop: Space   Mute: M', {
        fontSize: '14px',
        color: '#dddddd',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.levelText = scene.add
      .text(scene.scale.width - 20, 20, `Level ${levelNum}/${totalLevels}`, textStyle)
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000);

    // Mute toggle button — below level indicator
    this.muteBtn = scene.add
      .text(scene.scale.width - 20, 46, '[SFX ON]', {
        fontSize: '14px',
        color: '#88ff88',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1000)
      .setInteractive({ useHandCursor: true });

    this.muteBtn.on('pointerover', () => this.muteBtn.setAlpha(0.7));
    this.muteBtn.on('pointerout',  () => this.muteBtn.setAlpha(1));
    this.muteBtn.on('pointerdown', () => this.applyMuteToggle(onMuteToggle()));

    // M key shortcut
    scene.input.keyboard!
      .addKey(Phaser.Input.Keyboard.KeyCodes.M)
      .on('down', () => this.applyMuteToggle(onMuteToggle()));
  }

  private applyMuteToggle(isMuted: boolean): void {
    this.muteBtn.setText(isMuted ? '[SFX OFF]' : '[SFX ON]');
    this.muteBtn.setStyle({ color: isMuted ? '#ff8888' : '#88ff88' });
  }

  update(treatCount: number, poopCharges: number): void {
    this.treatsText.setText(`Treats: ${treatCount}/${this.totalTreats}`);
    this.poopsText.setText(`Poops: ${poopCharges}`);
  }

  showWin(scene: Phaser.Scene): void {
    this.showOverlay(scene, 'YOU WIN!', '#00ff88');
  }

  showLose(scene: Phaser.Scene): void {
    this.showOverlay(scene, 'BUSTED!', '#ff4444');
  }

  private showOverlay(scene: Phaser.Scene, message: string, color: string): void {
    const w = scene.scale.width;
    const h = scene.scale.height;

    scene.add
      .rectangle(w / 2, h / 2, 440, 220, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(2000);

    scene.add
      .text(w / 2, h / 2 - 44, message, {
        fontSize: '52px',
        color,
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2001);

    const btn = scene.add
      .text(w / 2, h / 2 + 44, '[ Restart ]', {
        fontSize: '26px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2001)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
    btn.on('pointerout', () => btn.setStyle({ color: '#ffffff' }));
    btn.on('pointerdown', () => scene.scene.restart());
  }
}
