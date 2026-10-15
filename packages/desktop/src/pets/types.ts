export type PetTaskStatus = "needs_input" | "blocked" | "ready" | "running";
export type PetAnimationState = "idle" | PetTaskStatus | "dragging";
export type PetSize = "small" | "medium" | "large";

export interface PetPosition {
  x: number;
  y: number;
}

export interface DesktopPetSettings {
  enabled: boolean;
  size: PetSize;
  selectedId: string;
  position: PetPosition | null;
}

export interface PetAnimation {
  row: number;
  frames: number;
  fps: number;
}

export type PetAnimations = Record<Exclude<PetAnimationState, "dragging">, PetAnimation> & {
  dragging?: PetAnimation;
};

export interface PetManifest {
  version: 1;
  name: string;
  description?: string;
  spritesheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: PetAnimations;
}

export interface PetDescriptor {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  spriteUrl: string;
  previewUrl: string;
  frameWidth: number;
  frameHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  animations: PetAnimations;
}

export interface DesktopPetTask {
  serverId: string;
  agentId: string;
  title: string;
  status: PetTaskStatus;
  updatedAt: number;
}

export interface DesktopPetLabels {
  idle: string;
  offline: string;
  running: string;
  needs_input: string;
  ready: string;
  blocked: string;
  openApp: string;
  openTask: string;
  hide: string;
  resetPosition: string;
  taskCount: string;
}

export interface DesktopPetRevision {
  generation: string;
  seq: number;
  previousGeneration?: string;
}

export interface DesktopPetActivityResult {
  revalidate: Array<{ serverId: string; generation: string }>;
}

export interface DesktopPetActivity {
  tasks: DesktopPetTask[];
  connected: boolean;
  serverIds: string[];
  revisions: Record<string, DesktopPetRevision | null>;
  labels: DesktopPetLabels;
  fontFamily: string;
}

export interface PetCreationWorkspace {
  cwd: string;
  initialPrompt: string;
}
