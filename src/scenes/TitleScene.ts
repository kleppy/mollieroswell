import Phaser from 'phaser';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    // ── Background ────────────────────────────────────────────────────────
    this.add.rectangle(w / 2, h / 2, w, h, 0x080818);

    // Subtle starfield
    const stars = this.add.graphics();
    for (let i = 0; i < 120; i++) {
      const sx = Math.random() * w;
      const sy = Math.random() * h;
      const sr = Math.random() < 0.8 ? 1 : 2;
      stars.fillStyle(0xffffff, 0.2 + Math.random() * 0.5);
      stars.fillCircle(sx, sy, sr);
    }

    // ── Title text ────────────────────────────────────────────────────────
    const mainTitle = this.add
      .text(w / 2, h / 2 - 120, 'Mollie vs. Roswell', {
        fontSize: '48px',
        color: '#ffdd44',
        stroke: '#000000',
        strokeThickness: 6,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setY(h / 2 - 90);

    const subTitle = this.add
      .text(w / 2, h / 2 - 52, 'Treat Heist', {
        fontSize: '30px',
        color: '#ff8844',
        stroke: '#000000',
        strokeThickness: 4,
        fontStyle: 'italic',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // ── Character blurbs ──────────────────────────────────────────────────
    const blurb = this.add
      .text(
        w / 2,
        h / 2 + 8,
        'Help Mollie the dachshund steal every treat\nbefore Roswell the watchdog catches her!',
        {
          fontSize: '14px',
          color: '#cccccc',
          stroke: '#000000',
          strokeThickness: 2,
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setAlpha(0);

    // ── Controls reminder ──────────────────────────────────────────────────
    const controls = this.add
      .text(w / 2, h / 2 + 72, 'WASD / Arrow Keys — Move     Space — Drop Poop     M — Mute', {
        fontSize: '13px',
        color: '#aaaacc',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // ── Start prompt ──────────────────────────────────────────────────────
    const prompt = this.add
      .text(w / 2, h / 2 + 120, 'Click or press any key to start', {
        fontSize: '18px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // ── Animations ────────────────────────────────────────────────────────

    // Main title drops in from slightly above with bounce
    this.tweens.add({
      targets: mainTitle,
      alpha: 1,
      y: h / 2 - 120,
      duration: 700,
      ease: 'Back.Out',
    });

    // Subtitle fades in
    this.tweens.add({
      targets: subTitle,
      alpha: 1,
      duration: 500,
      delay: 500,
    });

    // Blurb and controls slide in together
    this.tweens.add({
      targets: [blurb, controls],
      alpha: 1,
      duration: 400,
      delay: 900,
    });

    // Prompt pulses after everything else is visible
    this.tweens.add({
      targets: prompt,
      alpha: 1,
      duration: 300,
      delay: 1200,
      onComplete: () => {
        this.tweens.add({
          targets: prompt,
          alpha: 0.25,
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      },
    });

    // Gentle float on the main title (oscillates ±4px vertically)
    this.tweens.add({
      targets: mainTitle,
      y: h / 2 - 116,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      delay: 900,
    });

    // ── Start handlers ────────────────────────────────────────────────────
    const launch = (): void => {
      // Prevent double-fire
      this.input.off('pointerdown', launch);
      // Unlock AudioContext — required by mobile autoplay policy.
      try {
        const ctx = (this.sound as any).context as AudioContext | undefined;
        if (ctx?.state === 'suspended') ctx.resume();
      } catch (_) {}
      this.scene.start('GameScene', { level: 1 });
    };

    this.input.once('pointerdown', launch);
    this.input.keyboard!.once('keydown', launch);
  }
}
