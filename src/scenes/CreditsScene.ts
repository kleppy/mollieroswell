import Phaser from 'phaser';

export class CreditsScene extends Phaser.Scene {
  private creditsMusic: Phaser.Sound.BaseSound | null = null;

  constructor() {
    super({ key: 'CreditsScene' });
  }

  preload(): void {
    this.load.audio('credits-music', '/assets/credits.wav');
    // Images may already be cached if arriving from GameScene; guard prevents re-fetch.
    if (!this.textures.exists('mollie'))  this.load.image('mollie',  '/assets/mollie.png');
    if (!this.textures.exists('roswell')) this.load.image('roswell', '/assets/roswell.png');
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    // ── Background ────────────────────────────────────────────────────────
    this.add.rectangle(w / 2, h / 2, w, h, 0x060612);

    const stars = this.add.graphics();
    for (let i = 0; i < 100; i++) {
      stars.fillStyle(0xffffff, 0.15 + Math.random() * 0.4);
      stars.fillCircle(Math.random() * w, Math.random() * h, Math.random() < 0.8 ? 1 : 2);
    }

    // ── Character images (pinned; depth 12 = above fade bars at depth 10) ─
    // Centered at y=44, inside the top fade-bar zone so they never clash with
    // scrolling text but remain visible the entire time (scroll + finale).
    const charY = 44;
    if (this.textures.exists('mollie')) {
      this.add.image(w / 2 - 58, charY, 'mollie')
        .setDisplaySize(52, 52).setOrigin(0.5).setDepth(12);
    }
    if (this.textures.exists('roswell')) {
      this.add.image(w / 2 + 58, charY, 'roswell')
        .setDisplaySize(52, 52).setOrigin(0.5).setDepth(12);
    }

    // ── Scrolling credits container ───────────────────────────────────────
    const container = this.add.container(w / 2, h + 20);
    let cY = 0;

    const addLine = (
      text: string,
      style: Phaser.Types.GameObjects.Text.TextStyle,
      spacingAfter = 10,
    ): void => {
      const t = this.add.text(0, cY, text, style).setOrigin(0.5, 0);
      container.add(t);
      cY += t.height + spacingAfter;
    };

    const titleSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '30px', color: '#ffdd44', stroke: '#000000',
      strokeThickness: 6, fontStyle: 'bold',
    };
    const subSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '18px', color: '#ff8844', stroke: '#000000',
      strokeThickness: 3, fontStyle: 'italic',
    };
    const divSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '14px', color: '#444466', stroke: '#000000', strokeThickness: 1,
    };
    const headerSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '13px', color: '#888899', stroke: '#000000', strokeThickness: 2,
    };
    const valueSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '22px', color: '#ffffff', stroke: '#000000',
      strokeThickness: 3, fontStyle: 'bold',
    };
    const linkSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '16px', color: '#88aaff', stroke: '#000000', strokeThickness: 2,
    };
    const heartSt: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '20px', color: '#ff8888', stroke: '#000000', strokeThickness: 3,
    };

    addLine('Mollie vs. Roswell', titleSt, 4);
    addLine('Treat Heist', subSt, 56);

    addLine('─ ─ ─ ─ ─ ─ ─ ─', divSt, 44);

    addLine('Developed by', headerSt, 6);
    addLine('Daddy And Julianna', valueSt, 52);

    addLine('Music by', headerSt, 6);
    addLine('Freesound.org', valueSt, 52);

    addLine('Source Code', headerSt, 6);
    addLine('github.com/kleppy/mollieroswell', linkSt, 64);

    addLine('─ ─ ─ ─ ─ ─ ─ ─', divSt, 44);

    addLine('♥  Thank you for playing  ♥', heartSt, 20);

    // Scroll from below screen to above top
    const totalHeight = cY + 100;
    const totalDist   = (h + 20) + totalHeight;
    const scrollMs    = Math.round((totalDist / 55) * 1000); // 55 px / s

    this.tweens.add({
      targets: container,
      y: -totalHeight,
      duration: scrollMs,
      ease: 'Linear',
      onComplete: () => {
        // ── Finale: static "Thank you" message ───────────────────────────
        // Shown indefinitely; credits music continues; Back / ESC still works.
        this.add.text(w / 2, h / 2 - 28, 'Thank you for playing!', {
          fontSize: '36px', color: '#ffdd44',
          stroke: '#000000', strokeThickness: 5, fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(12);

        this.add.text(w / 2, h / 2 + 28, '♥  from Daddy & Julianna  ♥', {
          fontSize: '20px', color: '#ff8888',
          stroke: '#000000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(12);
      },
    });

    // ── Fade bars (hide text at top/bottom edges) ─────────────────────────
    this.add.rectangle(w / 2,      50, w,  100, 0x060612).setDepth(10);
    this.add.rectangle(w / 2, h - 44, w,   88, 0x060612).setDepth(10);

    // ── Back button ───────────────────────────────────────────────────────
    const backBtn = this.add.text(w / 2, h - 32, '[ Back to Menu ]', {
      fontSize: '17px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
      padding: { x: 22, y: 14 },
    })
      .setOrigin(0.5)
      .setDepth(11)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setStyle({ color: '#ffdd44' }));
    backBtn.on('pointerout',  () => backBtn.setStyle({ color: '#ffffff' }));
    backBtn.on('pointerdown', () => this.goBack());

    this.input.keyboard!.once('keydown-ESC', () => this.goBack());

    // ── Credits music ─────────────────────────────────────────────────────
    if (this.cache.audio.exists('credits-music')) {
      this.creditsMusic = this.sound.add('credits-music', { loop: true, volume: 0.45 });
      this.creditsMusic.play();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.creditsMusic?.destroy();
      this.creditsMusic = null;
    });
  }

  private goBack(): void {
    this.scene.start('TitleScene');
  }
}
