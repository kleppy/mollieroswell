import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { TransitionScene } from './scenes/TransitionScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  parent: document.body,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  // TitleScene first — it launches GameScene on user interaction,
  // which also satisfies browser autoplay policy.
  scene: [TitleScene, GameScene, TransitionScene],
};

new Phaser.Game(config);
