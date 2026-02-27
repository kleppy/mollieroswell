import Phaser from 'phaser';
import { LEVELS } from '../constants';

export class TransitionScene extends Phaser.Scene {
  private completedLevel = 1;

  constructor() {
    super({ key: 'TransitionScene' });
  }

  init(data: { completedLevel: number }): void {
    this.completedLevel = data.completedLevel;
  }

  create(): void {
    const next = this.completedLevel + 1;
    const cfg = LEVELS[next - 1];
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(w / 2, h / 2, w, h, 0x0a0a1a);

    this.add.text(w / 2, h / 2 - 130, `Level ${this.completedLevel} Complete!`, {
      fontSize: '44px',
      color: '#00ff88',
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 - 60, `Next: Level ${next} — ${cfg.name}`, {
      fontSize: '28px',
      color: '#ffffcc',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5);

    let rem = 5;
    const cd = this.add.text(w / 2, h / 2 + 20, `Starting in ${rem}...`, {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    this.time.addEvent({
      delay: 1000,
      repeat: 4,
      callback: () => {
        rem--;
        cd.setText(rem > 0 ? `Starting in ${rem}...` : 'Starting...');
      },
    });

    const btn = this.add.text(w / 2, h / 2 + 100, `[ Play Level ${next} → ]`, {
      fontSize: '26px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ color: '#ffff00' }));
    btn.on('pointerout',  () => btn.setStyle({ color: '#ffffff' }));
    btn.on('pointerdown', () => this.startNext());

    this.time.delayedCall(5000, () => this.startNext());
  }

  private startNext(): void {
    this.scene.start('GameScene', { level: this.completedLevel + 1 });
  }
}
