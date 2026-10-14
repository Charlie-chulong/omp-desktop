---
name: hatch-pet
description: Create and install a custom animated desktop pet for OMP from a description or reference images, using the configured image-generation tool and the included local installation helper.
---

# Create an OMP desktop pet

Use this skill in the author workspace opened by **Settings > Appearance > Desktop pet > Create with OMP**. Keep authoring files in that workspace. Do not overwrite built-in pets, the user's other skills, or existing custom pet packages.

## Confirm the character

Use the user's description and any attached reference images. If no description was supplied, ask what creature, style, and personality they want before generating art. `iris-reference.png` is an optional example, not permission to substitute Iris for the requested character.

Use OMP's configured `generate_image` tool. Do not introduce a different cloud service, credentials, subscription, or hardcoded model. If image generation is unavailable, explain the missing image-model configuration; do not claim a pet was created or manufacture a placeholder.

## Generate a real animation atlas

Generate **a coherent animation frame sequence**, not a collection of unrelated poses. A suitable default is a 1536 × 1024 atlas: twelve columns of 128 × 128 tiles, six action rows at the top, and two completely empty padding rows at the bottom. Each action row is a twelve-frame temporal loop. Keep character identity, proportions, lighting, scale, registration point, and bottom baseline identical across frames. Move limbs, ears, eyelids, and props gradually; make the last frame join the first without a jump. Leave clear padding so nothing crosses tile boundaries. No grid lines, text, logos, or scene backgrounds.

Request transparent background. If the image tool cannot produce transparency, request a perfectly flat **#00FF00 chroma-key green** background, with no green inside the character. The helper removes this green automatically. If the requested pet itself is green, use transparency rather than chroma-key.

Action rows, each a coherent twelve-frame loop rather than twelve different expressions:

1. `idle`: breathing, looking around, a natural blink.
2. `running`: working/focused, with a small action or typing motion.
3. `needs_input`: curious or expectant, asking for attention.
4. `ready`: a happy completion/wave.
5. `blocked`: worried or confused, without disturbing flashing.
6. `dragging`: being carried, leaning gently.

Inspect the actual atlas before installation, including adjacent frames and the loop seam. Fix character drift, abrupt pose changes, missing intermediate frames, missing rows, incorrect dimensions, cut-off body parts, overlapping frames, or incorrect backgrounds. Regenerate inconsistent sequences; do not disguise four unrelated still pictures with duplicated frames or a slideshow crossfade. The generated file may be PNG, JPEG, or WebP; pass its actual returned path to the helper rather than guessing its extension.

## Write `pet.json`

Write this manifest in the author workspace, replacing the name and description with the user's completed design:

```json
{
  "version": 1,
  "name": "The user's pet name",
  "description": "A concise description of the finished character",
  "spritesheet": "sprites.png",
  "frameWidth": 128,
  "frameHeight": 128,
  "animations": {
    "idle": { "row": 0, "frames": 12, "fps": 12 },
    "running": { "row": 1, "frames": 12, "fps": 12 },
    "needs_input": { "row": 2, "frames": 12, "fps": 12 },
    "ready": { "row": 3, "frames": 12, "fps": 12 },
    "blocked": { "row": 4, "frames": 12, "fps": 12 },
    "dragging": { "row": 5, "frames": 12, "fps": 12 }
  }
}
```

A different atlas size is allowed only when the manifest's frame dimensions and animation bounds match it exactly. All five non-dragging states are required; `dragging` is optional. The image must be a decodable transparent PNG no larger than 20 MiB and 4096 × 4096 pixels after conversion. Packages contain only data, not scripts or executable UI.

OMP adds continuous subtle breathing/sway and click reactions locally. Idle, waiting, completion, and blocked sequences play intermittently with quiet pauses rather than looping constantly; working and dragging loops continue. System reduced-motion preferences show a static pose. Use enough genuine in-between frames for fluid motion; longer or higher-resolution sequences are allowed within the atlas limits.

## Install and prove success

Run the included helper from this workspace, passing the generated image path:

- **Windows:** explicitly invoke `cmd.exe /d /c install-pet.cmd "<actual image path>"`.
- **macOS/Linux:** `./install-pet.sh '<actual image path>'`.

The helper uses OMP Desktop's bundled Electron runtime; no global Node.js or Python installation is needed. It converts the actual image to PNG, removes green where appropriate, validates the manifest/atlas, and atomically installs a uniquely identified package in OMP's local pet library. It does not replace the built-in Iris pet or change the user's current selection.

Do not report success unless the command exits with code zero and prints the installed pet descriptor, including its name and ID. Correct validation failures before retrying; never suppress them. Keep the completed authoring workspace so the user can refine the pet later.

After successful installation, tell the user to return to **Settings > Appearance > Desktop pet**, click **Refresh**, and select the new pet. Selecting it while the pet is enabled updates the live companion. Creating artwork uses the configured image model; ordinary animation and task-status updates do not call a model.
