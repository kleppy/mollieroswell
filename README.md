# Mollie vs. Roswell: Treat Heist

A top-down stealth game built with **TypeScript 5.6 + Vite 6 + Phaser 3.87**.

Help Mollie the dachshund steal every treat across 4 levels while avoiding Roswell the watchdog. Drop poop to stun him. Survive all four locations to win.

---

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:3000
npm run build      # production build → dist/
```

---

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move Mollie |
| Space | Drop poop (3 charges) |
| M | Toggle mute |

---

## Level Progression

| Level | Name | Treats | Ambience |
|-------|------|--------|----------|
| 1 | The House | 20 | Low rumble (200 Hz) |
| 2 | Water Park | 25 | Splashy hiss (600 Hz) |
| 3 | City Park | 28 | Wind (400 Hz) |
| 4 | City Streets | 30 | Bass drone (100 Hz) |

After Level 4 the "YOU WIN!" overlay appears. Getting caught restarts the current level.

---

## How the AI Works

Roswell uses a four-state FSM:

| State | Behaviour |
|-------|-----------|
| **PATROL** | Loops through level-specific waypoints |
| **CHASE** | Pursues Mollie at increased speed when she enters his vision cone |
| **SEARCH** | Moves to last-seen position, waits 3 s, then resumes patrol |
| **STUNNED** | Steps on poop → 40% speed for 2 s |

**Vision cone:** 70° wide, 250 px range. LOS is blocked by all solid obstacles — hiding behind furniture breaks detection.

**Bark audio:** Roswell barks periodically (every 3.5–5.5 s on patrol, every 0.9–1.6 s while chasing). Volume is attenuated linearly with distance — you can hear him approaching before he sees you.

---

## Audio System

All sound is synthesised via the Web Audio API — no external audio files are required.

| Sound | Trigger | Notes |
|-------|---------|-------|
| Ambient noise | Looping per level | Unique bandpass frequency per location |
| Roswell bark | Periodic; faster during Chase | Distance-attenuated (closer = louder) |
| Mollie pant | While moving | Fades in/out; slightly louder after 3 s continuous movement |

Audio starts after the first user interaction on the Title Screen (click or any key), satisfying browser autoplay policy. Press **M** or click **[SFX ON]** in the HUD to toggle mute. Mute state persists across level transitions.

---

## How to Add a New Level

### 1. Define a `LevelConfig` in `src/constants.ts`

```typescript
const LEVEL5: LevelConfig = {
  name: 'My Level',
  worldWidth: 1280, worldHeight: 960,
  totalTreats: 32,
  playerStart: { x: 100, y: 860 },
  enemyStart:  { x: 640, y: 480 },
  audioFrequency: 350,        // Hz for bandpass ambient noise
  walls: [
    // Outer boundary (required)
    { x: 0,    y: 0,   w: 1280, h: 20  },
    { x: 0,    y: 940, w: 1280, h: 20  },
    { x: 0,    y: 0,   w: 20,   h: 960 },
    { x: 1260, y: 0,   w: 20,   h: 960 },
    // ...internal walls
  ],
  furniture: [
    // textureKey must be generated in buildLevelTextures() (see step 2)
    { rect: { x: 100, y: 100, w: 200, h: 200 }, textureKey: 'my-obstacle' },
  ],
  treatPositions: [ { x: 60, y: 200 }, /* ...32 total */ ],
  patrolWaypoints: [
    { x: 640, y: 480 }, /* ...8-12 waypoints forming a clear loop */
  ],
  tilePainter: (row, col) => {
    // Return 1–4 to select a tile from your tileset (see step 2)
    return col * 32 < 640 ? 1 : 2;
  },
};
```

### 2. Append to `LEVELS`

```typescript
export const LEVELS: LevelConfig[] = [LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5];
```

### 3. Add textures in `src/scenes/GameScene.ts`

- `buildLevelTextures()` → add `case 5: this.buildTexturesMyLevel(); break;`
  Create a `buildTexturesMyLevel()` method that calls `ensureTexture(key, w, h, gfx => ...)` for each `textureKey` used in your furniture array.
- `drawTilesetForLevel()` → add `case 5: this.drawTilesetMyLevel(gfx); break;`
  Draw 4 tile variants into a 128×32 canvas (each tile is 32×32 px, left to right = data values 1–4).
- `buildDecoratives()` → optionally add `case 5:` for purely visual elements (no physics).

### 4. Patrol waypoint rules

- Every straight-line leg between consecutive waypoints must be obstacle-free.
- Inflate each obstacle by 14 px on all sides when checking clearance (matches `isWalkable()` buffer).
- Test patrol paths in-browser with `arcade: { debug: true }` in `main.ts`.

---

## Asset Placement

All files under `public/` are served at the root path.

```
public/
  audio/
    roswell_bark.mp3      ← single short bark  (replaces synth bark)
    mollie_pant.mp3       ← soft breath loop   (replaces synth pant)
    bg_house.mp3          ← Level 1 ambient    (replaces synth noise)
    bg_waterpark.mp3      ← Level 2 ambient
    bg_park.mp3           ← Level 3 ambient
    bg_city.mp3           ← Level 4 ambient
  sprites/
    mollie.png            ← 112×18 spritesheet, 4 frames, head faces RIGHT
    roswell.png           ← 72×28  spritesheet, 4 frames, head faces RIGHT
    treat.png             ← 10×10 blue square (Rice Krispie treat)
    poop.png              ← 16×16 emoji-style pile
  tiles/
    tileset_house.png     ← 128×32, four 32×32 tiles side-by-side
    tileset_waterpark.png
    tileset_park.png
    tileset_city.png
```

### Expected asset formats

| Asset | Format | Max size | Notes |
|-------|--------|----------|-------|
| `roswell_bark.mp3` | MP3 / OGG | 200 KB | < 0.5 s, no silence padding |
| `mollie_pant.mp3` | MP3 / OGG | 100 KB | 0.5–1 s seamless loop |
| `bg_*.mp3` | MP3 / OGG | 2 MB | 2–4 s seamless loop |
| Sprite PNGs | PNG, RGBA | — | Pixel-art, load via `scene.load.spritesheet()` |
| Tileset PNGs | PNG, RGBA | — | Exactly 128×32 px, no margins |

### Wiring real audio files

1. Add a `preload()` method to `GameScene` and load the assets:
   ```typescript
   preload(): void {
     this.load.audio('bark', 'audio/roswell_bark.mp3');
     this.load.audio('pant', 'audio/mollie_pant.mp3');
     this.load.audio(`bg-${this.levelNum}`, `audio/bg_${this.cfg?.name.toLowerCase().replace(' ', '')}.mp3`);
   }
   ```
2. In `AudioManager.ts` replace `setBgFreq()`, `playBark()`, and `firePantBurst()` with calls to `scene.sound.play()` / `scene.sound.add()`.
3. Pass the Phaser scene to AudioManager's constructor.

---

## Tech Stack

- [Phaser 3.87](https://phaser.io/) — game engine (arcade physics, scene management, Web Audio)
- [Vite 6](https://vitejs.dev/) — dev server & bundler
- [TypeScript 5.6](https://www.typescriptlang.org/) — type-safe source
- All sprites, tiles, and audio are generated at runtime — **zero external assets required** to run the game
