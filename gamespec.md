Title: Mollie vs. Roswell: Treat Heist
1. Game Overview

Genre: Top-Down Stealth / Arcade
Perspective: Bird’s-eye view
Setting: A suburban house and fenced yard
Tone: Lighthearted, playful, slightly chaotic

You control Mollie, a black-and-brown dachshund, who is on a mission to collect hidden Rice Krispie treats around the property.

However…

A very old, skinny, grumpy yellow Lacy dog named Roswell patrols the area. He wears a diaper and moves slowly but relentlessly.

Mollie must collect all treats without being caught.

2. Core Gameplay Loop

Explore house + yard

Find hidden treats

Avoid Roswell’s patrol path

Strategically drop poop obstacles to slow Roswell

Clear all treats to win the level

If Roswell catches Mollie → lose life / restart level.

3. Characters
🐕 Mollie (Player)

Small, fast, agile dachshund

Quick acceleration

Can:

Run

Hide behind furniture/bushes

Drop poop (limited resource)

Special Ability:

“Poop Drop” leaves temporary obstacle on ground

Roswell slows down when stepping on it

🐕 Roswell (Enemy AI)

Very old skinny yellow Lacy dog

Slow base movement

Narrow vision cone

Patrols set paths around house + yard

If Mollie enters vision cone → Roswell chases

Behavior States:

Patrol

Investigate (if hears sound)

Chase

Stunned (after stepping in poop)

4. Map Design
Areas:

Living room

Kitchen

Hallway

Backyard

Garden bushes

Shed area

Treat Placement:

Randomized spawn locations per level

Some hidden:

Behind couch

Under table

Near bushes

By fence corners

5. Mechanics
Movement

WASD or arrow keys

Smooth 2D movement

Sprint (optional stamina mechanic)

Treat Collection

Player must collide with treat sprite

Treat counter increments

Display progress UI:

Treats: 3 / 10
Poop Mechanic

Player has limited poop charges

Press Space to drop

Leaves brown obstacle sprite on ground

Roswell stepping on poop:

Slows movement by 60%

Brief disgust animation

2-second stun

Poop disappears after 10 seconds.

6. Detection System

Roswell has:

Vision cone (triangular area)

Line-of-sight blocked by:

Walls

Large furniture

Bushes

If Mollie enters vision:

Roswell switches to CHASE mode

Speed increases slightly

Chase lasts until:

Mollie breaks line of sight for 3 seconds

7. Win & Lose Conditions
Win:

Collect all treats

Reach dog bed (safe zone)

Lose:

Roswell touches Mollie

Optional: 3 lives system

8. Level Progression Ideas

Level 1:

Small house only

Slow Roswell

Few treats

Level 2:

Backyard unlocked

More patrol paths

Level 3:

Two Roswells (nightmare mode)

Fewer poop charges

9. Visual Style

Cartoon

can you write this up as instructions to claude code

Below is a paste-ready instruction prompt you can drop straight into Claude Code to have it generate the game. It’s written as “do this” steps, with clear scope, tech choices, and acceptance criteria.

Claude Code Instructions: Build “Mollie vs. Roswell: Treat Heist”

You are an expert game-dev engineer. Build a playable prototype of a top-down (bird’s-eye) 2D stealth/arcade game.

Goal

Create a game where the player controls Mollie, a black-and-brown dachshund, who searches a house + yard map for Rice Krispie treats while avoiding Roswell, a grumpy, very old skinny yellow Lacy dog wearing a diaper. Mollie can drop poops to block/slow Roswell.

1) Tech + Project Setup

Use TypeScript + Vite and Phaser 3.

Output should run in a browser at localhost with npm install then npm run dev.

Provide a complete repo structure (package.json, tsconfig, vite config, src, assets placeholders).

Use simple placeholder art (colored rectangles/circles) so the game runs without external images.

Mollie: small brown/black circle/rectangle

Roswell: skinny yellow rectangle + small “diaper” white square overlay

Treats: bright small squares

Poop: brown small circles

2) Game World (Bird’s-Eye Property)

Implement a single “property” scene with two zones:

Interior (House)

Walls that block movement and line-of-sight

A few furniture obstacles (couch, table) that block movement

Exterior (Yard)

Fenced boundary (walls)

Bush obstacles (block movement and LOS)

A “shed” obstacle area

Make the map tile-based or simple rectangle collision bodies (either is fine). Must support:

Solid obstacles (collide)

“Cover” obstacles that block Roswell’s line-of-sight

3) Player Character: Mollie

Implement:

Movement: WASD / arrow keys

Speed: fast relative to Roswell (e.g., 200 vs 120)

Collision with walls/obstacles

Treat pickup on overlap

UI shows Treats: X / Total and Poops: N

Poop Drop Ability

Key: Spacebar

Limited charges (start with 3)

Drops a poop object at Mollie’s feet

Poop persists for 10 seconds then disappears

Poop is a physical obstacle for Roswell (at minimum it slows him; bonus if it also blocks pathfinding)

When Roswell touches poop:

Apply 60% slow for 2 seconds AND show a brief “disgust” pause animation/state

Then resume behavior

4) Enemy AI: Roswell

Roswell should have a simple state machine:

States

PATROL

Follow a loop of waypoints around house and yard.

CHASE

Triggered if Mollie enters vision cone with line-of-sight.

Roswell moves toward Mollie at slightly increased speed.

SEARCH

If Roswell loses sight, go to last seen position and wander for 3 seconds, then return to patrol.

STUNNED/SLOWED

Triggered by poop contact; overrides other states for 2 seconds.

Detection

Implement a vision cone (e.g., 70° cone) with a distance limit (e.g., 250 px).

Line-of-sight must be blocked by walls/furniture/bushes.

If Mollie is detected, switch to CHASE immediately.

If Mollie breaks LOS for 3 seconds, switch to SEARCH.

5) Treat System

Spawn 10 treats per level.

Treats should be placed at predetermined coordinates for now (no RNG needed).

Some treats should be “hidden” behind furniture/bushes to encourage exploration.

6) Win/Lose Conditions
Win

Collect all treats.

When all treats are collected, show a banner: “YOU WIN!” and a button “Restart”.

Lose

If Roswell touches Mollie (overlap collision), show “BUSTED!” and restart button.

7) Controls + UX

Show an on-screen help overlay (small text):

Move: WASD/Arrows

Drop Poop: Space

Smooth camera follow Mollie with a small deadzone (optional).

Add simple sound placeholders optional (can skip if time).

8) Deliverables

Provide:

Full source code for the working prototype

Brief README with:

install/run instructions

controls

how AI works at a high level

Code should be clean, modular:

Player.ts, Enemy.ts, GameScene.ts, UI.ts, constants.ts

9) Acceptance Criteria Checklist

The prototype is acceptable if:

Runs locally via Vite

Mollie moves around house + yard with collisions

Treats can be collected and counted

Roswell patrols and chases when Mollie is in a vision cone with LOS

Poop drop works, consumes charges, and slows/stuns Roswell on contact

Win and lose screens work with restart