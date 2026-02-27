// ── Speed constants ──────────────────────────────────────────────────────────
export const PLAYER_SPEED = 200;
export const ENEMY_BASE_SPEED = 145;
export const ENEMY_CHASE_SPEED = 185;
export const ENEMY_STUNNED_SPEED = 48; // 40% of base (60% slow)

// ── Vision constants ─────────────────────────────────────────────────────────
export const VISION_RANGE = 250;
export const VISION_HALF_ANGLE_DEG = 35; // 70° total cone

// ── Timer constants (milliseconds) ───────────────────────────────────────────
export const POOP_DURATION_MS = 10000;
export const POOP_STUN_DURATION_MS = 2000;
export const SEARCH_DURATION_MS = 3000;
export const LOS_LOST_TIMEOUT_MS = 3000; // chase→search after losing LOS this long

// ── Gameplay constants ────────────────────────────────────────────────────────
export const WAYPOINT_ARRIVE_DIST = 20;
export const POOP_CHARGES_START = 3;

// ── Obstacle type ─────────────────────────────────────────────────────────────
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Level configuration ───────────────────────────────────────────────────────
export interface LevelConfig {
  name: string;
  worldWidth: number;
  worldHeight: number;
  totalTreats: number;
  playerStart: { x: number; y: number };
  enemyStart:  { x: number; y: number };
  walls:       Rect[];
  /** Each obstacle carries its own texture key; used for physics, LOS, and rendering. */
  furniture:   { rect: Rect; textureKey: string }[];
  treatPositions:  { x: number; y: number }[];
  patrolWaypoints: { x: number; y: number }[];
  audioFrequency: number;   // bandpass Hz for Web Audio ambient noise
  tilePainter: (row: number, col: number) => number;  // returns 1-4
}

// ── Level 1: The House ────────────────────────────────────────────────────────
const LEVEL1: LevelConfig = {
  name: 'The House',
  worldWidth: 1024,
  worldHeight: 768,
  totalTreats: 20,
  playerStart: { x: 80, y: 660 },
  enemyStart:  { x: 200, y: 300 },
  audioFrequency: 200,
  walls: [
    { x: 0,    y: 0,   w: 1024, h: 20  },
    { x: 0,    y: 748, w: 1024, h: 20  },
    { x: 0,    y: 0,   w: 20,   h: 768 },
    { x: 1004, y: 0,   w: 20,   h: 768 },
    { x: 20,   y: 392, w: 130,  h: 16  },
    { x: 374,  y: 20,  w: 16,   h: 80  },
    { x: 374,  y: 220, w: 16,   h: 200 },
    { x: 490,  y: 20,  w: 16,   h: 400 },
    { x: 490,  y: 580, w: 16,   h: 168 },
  ],
  furniture: [
    { rect: { x: 30,  y: 50,  w: 180, h: 70  }, textureKey: 'furniture-couch' },
    { rect: { x: 50,  y: 240, w: 120, h: 80  }, textureKey: 'furniture-table' },
    { rect: { x: 295, y: 50,  w: 70,  h: 120 }, textureKey: 'furniture-bookshelf' },
    { rect: { x: 40,  y: 450, w: 140, h: 100 }, textureKey: 'furniture-kitchen-table' },
    { rect: { x: 550, y: 60,  w: 80,  h: 80  }, textureKey: 'bush' },
    { rect: { x: 740, y: 80,  w: 90,  h: 90  }, textureKey: 'bush' },
    { rect: { x: 750, y: 480, w: 90,  h: 70  }, textureKey: 'bush' },
    { rect: { x: 870, y: 620, w: 120, h: 120 }, textureKey: 'bush-shed' },
  ],
  treatPositions: [
    { x: 220, y: 65  },
    { x: 330, y: 80  },
    { x: 280, y: 180 },
    { x: 200, y: 310 },
    { x: 80,  y: 420 },
    { x: 220, y: 510 },
    { x: 70,  y: 700 },
    { x: 660, y: 90  },
    { x: 850, y: 160 },
    { x: 950, y: 690 },
    { x: 340, y: 300 },
    { x: 390, y: 500 },
    { x: 160, y: 140 },
    { x: 130, y: 680 },
    { x: 250, y: 700 },
    { x: 610, y: 250 },
    { x: 760, y: 350 },
    { x: 900, y: 400 },
    { x: 630, y: 700 },
    { x: 820, y: 700 },
  ],
  patrolWaypoints: [
    { x: 200, y: 300 },
    { x: 390, y: 130 },
    { x: 390, y: 600 },
    { x: 150, y: 600 },
    { x: 150, y: 490 },
    { x: 620, y: 400 },
    { x: 800, y: 200 },
    { x: 920, y: 600 },
    { x: 620, y: 680 },
  ],
  tilePainter: (row, col) => {
    const wx = col * 32;
    const wy = row * 32;
    if (wx >= 506)      return 1;
    if (wx >= 374)      return 4;
    if (wy >= 408)      return 3;
    return 2;
  },
};

// ── Level 2: Water Park ───────────────────────────────────────────────────────
const LEVEL2: LevelConfig = {
  name: 'Water Park',
  worldWidth: 1280,
  worldHeight: 960,
  totalTreats: 25,
  playerStart: { x: 700, y: 800 },
  enemyStart:  { x: 700, y: 400 },
  audioFrequency: 600,
  walls: [
    { x: 0,    y: 0,   w: 1280, h: 20  },
    { x: 0,    y: 940, w: 1280, h: 20  },
    { x: 0,    y: 0,   w: 20,   h: 960 },
    { x: 1260, y: 0,   w: 20,   h: 960 },
  ],
  furniture: [
    { rect: { x: 100, y: 200, w: 380, h: 260 }, textureKey: 'wpark-pool' },
    { rect: { x: 120, y: 700, w: 200, h: 160 }, textureKey: 'wpark-wading' },
    { rect: { x: 580, y: 160, w: 120, h: 120 }, textureKey: 'wpark-slide' },
    { rect: { x: 900, y: 80,  w: 160, h: 120 }, textureKey: 'wpark-snack' },
    { rect: { x: 1060, y: 380, w: 120, h: 140 }, textureKey: 'wpark-cabin' },
    { rect: { x: 1060, y: 600, w: 120, h: 140 }, textureKey: 'wpark-cabin' },
    { rect: { x: 120, y: 120, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 220, y: 120, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 320, y: 120, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 420, y: 120, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 120, y: 480, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 220, y: 480, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 320, y: 480, w: 60, h: 20 }, textureKey: 'wpark-lounge' },
    { rect: { x: 520, y: 240, w: 20, h: 60 }, textureKey: 'wpark-lounge' },
    { rect: { x: 520, y: 340, w: 20, h: 60 }, textureKey: 'wpark-lounge' },
  ],
  treatPositions: [
    { x: 55,   y: 100 },
    { x: 55,   y: 580 },
    { x: 55,   y: 850 },
    { x: 250,  y: 600 },
    { x: 380,  y: 600 },
    { x: 510,  y: 100 },
    { x: 510,  y: 350 },
    { x: 510,  y: 600 },
    { x: 700,  y: 100 },
    { x: 700,  y: 350 },
    { x: 700,  y: 600 },
    { x: 700,  y: 850 },
    { x: 840,  y: 250 },
    { x: 840,  y: 450 },
    { x: 840,  y: 650 },
    { x: 840,  y: 850 },
    { x: 1000, y: 260 },
    { x: 1000, y: 530 },
    { x: 1200, y: 200 },
    { x: 1200, y: 500 },
    { x: 1200, y: 760 },
    { x: 350,  y: 850 },
    { x: 250,  y: 850 },
    { x: 550,  y: 850 },
    { x: 950,  y: 850 },
  ],
  patrolWaypoints: [
    { x: 60,   y: 100 },
    { x: 60,   y: 580 },
    { x: 60,   y: 880 },
    { x: 350,  y: 880 },
    { x: 700,  y: 880 },
    { x: 1200, y: 880 },
    { x: 1200, y: 100 },
    { x: 700,  y: 100 },
    { x: 700,  y: 520 },
    { x: 350,  y: 100 },
  ],
  tilePainter: (_row, _col) => 1,
};

// ── Level 3: City Park ────────────────────────────────────────────────────────
const LEVEL3: LevelConfig = {
  name: 'City Park',
  worldWidth: 1280,
  worldHeight: 960,
  totalTreats: 28,
  playerStart: { x: 100, y: 860 },
  enemyStart:  { x: 640, y: 480 },
  audioFrequency: 400,
  walls: [
    { x: 0,    y: 0,   w: 1280, h: 20  },
    { x: 0,    y: 940, w: 1280, h: 20  },
    { x: 0,    y: 0,   w: 20,   h: 960 },
    { x: 1260, y: 0,   w: 20,   h: 960 },
  ],
  furniture: [
    { rect: { x: 540,  y: 420, w: 120, h: 120 }, textureKey: 'park-fountain' },
    { rect: { x: 820,  y: 60,  w: 280, h: 200 }, textureKey: 'park-pond' },
    { rect: { x: 80,   y: 80,  w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 180,  y: 60,  w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 130,  y: 160, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 460,  y: 80,  w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 560,  y: 60,  w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 1080, y: 300, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 1160, y: 260, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 1120, y: 380, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 1000, y: 760, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 1100, y: 800, w: 44,  h: 44  }, textureKey: 'park-tree' },
    { rect: { x: 200,  y: 380, w: 80,  h: 28  }, textureKey: 'park-bench' },
    { rect: { x: 200,  y: 520, w: 80,  h: 28  }, textureKey: 'park-bench' },
    { rect: { x: 760,  y: 400, w: 80,  h: 28  }, textureKey: 'park-bench' },
    { rect: { x: 760,  y: 580, w: 80,  h: 28  }, textureKey: 'park-bench' },
    { rect: { x: 540,  y: 700, w: 80,  h: 28  }, textureKey: 'park-bench' },
    { rect: { x: 80,   y: 680, w: 120, h: 60  }, textureKey: 'park-swings' },
    { rect: { x: 240,  y: 720, w: 120, h: 80  }, textureKey: 'park-sandbox' },
  ],
  treatPositions: [
    { x: 60,   y: 300 },
    { x: 60,   y: 500 },
    { x: 60,   y: 700 },
    { x: 300,  y: 100 },
    { x: 400,  y: 200 },
    { x: 400,  y: 400 },
    { x: 400,  y: 600 },
    { x: 400,  y: 800 },
    { x: 640,  y: 200 },
    { x: 640,  y: 320 },
    { x: 640,  y: 580 },
    { x: 640,  y: 720 },
    { x: 640,  y: 880 },
    { x: 750,  y: 200 },
    { x: 880,  y: 320 },
    { x: 1000, y: 200 },
    { x: 1000, y: 480 },
    { x: 1000, y: 650 },
    { x: 1200, y: 400 },
    { x: 1200, y: 600 },
    { x: 1200, y: 800 },
    { x: 200,  y: 880 },
    { x: 400,  y: 880 },
    { x: 500,  y: 820 },
    { x: 700,  y: 880 },
    { x: 900,  y: 880 },
    { x: 1100, y: 680 },
    { x: 1200, y: 100 },
  ],
  patrolWaypoints: [
    { x: 640,  y: 480 },
    { x: 350,  y: 300 },
    { x: 100,  y: 300 },
    { x: 100,  y: 600 },
    { x: 420,  y: 800 },
    { x: 640,  y: 880 },
    { x: 950,  y: 800 },
    { x: 1200, y: 600 },
    { x: 1200, y: 300 },
    { x: 750,  y: 100 },
    { x: 350,  y: 100 },
  ],
  tilePainter: (row, _col) => {
    const wy = row * 32;
    return (wy < 60 || wy > 900) ? 4 : 1;
  },
};

// ── Level 4: City Streets ─────────────────────────────────────────────────────
const LEVEL4: LevelConfig = {
  name: 'City Streets',
  worldWidth: 1280,
  worldHeight: 960,
  totalTreats: 30,
  playerStart: { x: 400, y: 480 },
  enemyStart:  { x: 790, y: 480 },
  audioFrequency: 100,
  walls: [
    { x: 0,    y: 0,   w: 1280, h: 20  },
    { x: 0,    y: 940, w: 1280, h: 20  },
    { x: 0,    y: 0,   w: 20,   h: 960 },
    { x: 1260, y: 0,   w: 20,   h: 960 },
  ],
  furniture: [
    { rect: { x: 80,  y: 120, w: 240, h: 260 }, textureKey: 'city-building' },
    { rect: { x: 480, y: 120, w: 200, h: 220 }, textureKey: 'city-building' },
    { rect: { x: 900, y: 120, w: 240, h: 260 }, textureKey: 'city-building' },
    { rect: { x: 80,  y: 580, w: 240, h: 260 }, textureKey: 'city-building' },
    { rect: { x: 480, y: 580, w: 200, h: 260 }, textureKey: 'city-building' },
    { rect: { x: 900, y: 580, w: 240, h: 260 }, textureKey: 'city-building' },
    { rect: { x: 325, y: 140, w: 50,  h: 90  }, textureKey: 'city-car' },
    { rect: { x: 325, y: 260, w: 50,  h: 90  }, textureKey: 'city-car' },
    { rect: { x: 325, y: 600, w: 50,  h: 90  }, textureKey: 'city-car' },
    { rect: { x: 325, y: 720, w: 50,  h: 90  }, textureKey: 'city-car' },
    { rect: { x: 840, y: 140, w: 50,  h: 90  }, textureKey: 'city-car' },
    { rect: { x: 840, y: 260, w: 50,  h: 90  }, textureKey: 'city-car' },
  ],
  treatPositions: [
    { x: 400, y: 60  },
    { x: 600, y: 60  },
    { x: 790, y: 60  },
    { x: 400, y: 200 },
    { x: 400, y: 320 },
    { x: 600, y: 200 },
    { x: 600, y: 350 },
    { x: 790, y: 200 },
    { x: 790, y: 350 },
    { x: 1100, y: 60  },
    { x: 1100, y: 200 },
    { x: 1100, y: 400 },
    { x: 400, y: 480 },
    { x: 600, y: 480 },
    { x: 790, y: 480 },
    { x: 1100, y: 480 },
    { x: 60,  y: 480 },
    { x: 60,  y: 200 },
    { x: 60,  y: 700 },
    { x: 400, y: 600 },
    { x: 400, y: 750 },
    { x: 600, y: 680 },
    { x: 790, y: 680 },
    { x: 1100, y: 600 },
    { x: 1100, y: 760 },
    { x: 400, y: 890 },
    { x: 600, y: 890 },
    { x: 790, y: 890 },
    { x: 1100, y: 890 },
    { x: 60,  y: 890 },
  ],
  patrolWaypoints: [
    { x: 400,  y: 60  },
    { x: 790,  y: 60  },
    { x: 1200, y: 60  },
    { x: 1200, y: 480 },
    { x: 1200, y: 890 },
    { x: 790,  y: 890 },
    { x: 400,  y: 890 },
    { x: 60,   y: 890 },
    { x: 60,   y: 480 },
    { x: 60,   y: 60  },
  ],
  tilePainter: (row, col) => {
    const wx = col * 32;
    const wy = row * 32;
    return (wx < 80 || wx > 1180 || wy < 80 || wy > 880) ? 2 : 1;
  },
};

export const LEVELS: LevelConfig[] = [LEVEL1, LEVEL2, LEVEL3, LEVEL4];
