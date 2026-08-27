import type { ReactNode } from "react";

export interface DisabledVoiceContext {
  isVoiceMode: false;
  isVoiceSwitching: false;
  isMuted: false;
  activeServerId: null;
  activeAgentId: null;
  startVoice(serverId: string, agentId: string): Promise<void>;
  stopVoice(): Promise<void>;
  isVoiceModeForAgent(serverId: string, agentId: string): boolean;
  toggleMute(): void;
}

export interface DisabledVoiceTelemetry {
  volume: number;
  isSpeaking: boolean;
  segmentDuration: number;
}

interface DisabledVoiceSessionRegistration {
  serverId: string;
  setVoiceMode(enabled: boolean, agentId: string): Promise<void>;
  sendVoiceAudioChunk(audioData: string, mimeType: string): Promise<void>;
  audioPlayed(chunkId: string): Promise<void>;
  abortRequest(): Promise<void>;
  setAssistantAudioPlaying(isPlaying: boolean): void;
}

export interface DisabledVoiceRuntime {
  registerSession(input: DisabledVoiceSessionRegistration): () => void;
  updateSessionConnection(serverId: string, connected: boolean): void;
  onTurnEvent(serverId: string, agentId: string, eventType: string): void;
  handleAudioOutput(serverId: string, payload: unknown): void;
  shouldPlayVoiceAudio(serverId: string): boolean;
  onAssistantAudioStarted(serverId: string): void;
  onAssistantAudioFinished(serverId: string): void;
  onTranscriptionResult(serverId: string, text: string): void;
  onServerSpeechStateChanged(serverId: string, speaking: boolean): void;
}

export interface DisabledVoiceAudioEngine {
  initialize(): Promise<void>;
  play(source: unknown): Promise<void>;
  stop(): void;
}

const DISABLED_TELEMETRY: DisabledVoiceTelemetry = {
  volume: 0,
  isSpeaking: false,
  segmentDuration: 0,
};

export function useVoice(): never {
  throw new Error("Voice is not available in OMP Desktop");
}

export function useVoiceOptional(): DisabledVoiceContext | null {
  return null;
}

export function useVoiceTelemetry(): DisabledVoiceTelemetry {
  return DISABLED_TELEMETRY;
}

export function useVoiceTelemetryOptional(): DisabledVoiceTelemetry | null {
  return null;
}

export function useVoiceRuntimeOptional(): DisabledVoiceRuntime | null {
  return null;
}

export function useVoiceAudioEngineOptional(): DisabledVoiceAudioEngine | null {
  return null;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  return children;
}
