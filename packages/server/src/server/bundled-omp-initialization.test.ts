import { expect, test } from "vitest";
import type { AgentInitializationPhase } from "@omp-desktop/protocol/messages";
import {
  beginBundledOmpInitialization,
  subscribeBundledOmpInitialization,
} from "./bundled-omp-initialization.js";

test("late observers synchronously replay only the active agent phase", () => {
  const first = beginBundledOmpInitialization("replay-agent");
  first.report("preparing");
  const phases: Array<AgentInitializationPhase | null> = [];
  const unrelated: Array<AgentInitializationPhase | null> = [];
  const unsubscribe = subscribeBundledOmpInitialization("replay-agent", (phase) =>
    phases.push(phase),
  );
  const unsubscribeOther = subscribeBundledOmpInitialization("other-agent", (phase) =>
    unrelated.push(phase),
  );
  try {
    expect(phases).toEqual(["preparing"]);
    first.report("installing");
    first.close();
    expect(phases).toEqual(["preparing", "installing", null]);
    expect(unrelated).toEqual([]);
    const afterClose: Array<AgentInitializationPhase | null> = [];
    const unsubscribeAfterClose = subscribeBundledOmpInitialization("replay-agent", (phase) =>
      afterClose.push(phase),
    );
    expect(afterClose).toEqual([]);
    unsubscribeAfterClose();
  } finally {
    first.close();
    unsubscribe();
    unsubscribeOther();
  }
});

test("a superseded scope cannot report or end a newer operation", () => {
  const phases: Array<AgentInitializationPhase | null> = [];
  const unsubscribe = subscribeBundledOmpInitialization("token-agent", (phase) =>
    phases.push(phase),
  );
  const first = beginBundledOmpInitialization("token-agent");
  first.report("verifying");
  const second = beginBundledOmpInitialization("token-agent");
  try {
    second.report("preparing");
    first.report("installing");
    first.close();
    const replay: Array<AgentInitializationPhase | null> = [];
    const unsubscribeReplay = subscribeBundledOmpInitialization("token-agent", (phase) =>
      replay.push(phase),
    );
    expect(replay).toEqual(["preparing"]);
    unsubscribeReplay();
    second.report("installing");
    second.close();
    second.close();
    expect(phases).toEqual(["verifying", "preparing", "installing", null]);
  } finally {
    first.close();
    second.close();
    unsubscribe();
  }
});

test("detaching one observer leaves shared initialization and other observers active", () => {
  const firstPhases: Array<AgentInitializationPhase | null> = [];
  const secondPhases: Array<AgentInitializationPhase | null> = [];
  const firstUnsubscribe = subscribeBundledOmpInitialization("detach-agent", (phase) =>
    firstPhases.push(phase),
  );
  const secondUnsubscribe = subscribeBundledOmpInitialization("detach-agent", (phase) =>
    secondPhases.push(phase),
  );
  const scope = beginBundledOmpInitialization("detach-agent");
  try {
    scope.report("verifying");
    firstUnsubscribe();
    scope.report("installing");
    scope.close();
    expect(firstPhases).toEqual(["verifying"]);
    expect(secondPhases).toEqual(["verifying", "installing", null]);
  } finally {
    scope.close();
    firstUnsubscribe();
    secondUnsubscribe();
  }
});

test("observer failures during replay, report and close cannot fail provisioning", () => {
  const scope = beginBundledOmpInitialization("failing-observer-agent");
  scope.report("verifying");
  const unsubscribe = subscribeBundledOmpInitialization("failing-observer-agent", () => {
    throw new Error("source disconnected");
  });
  const phases: Array<AgentInitializationPhase | null> = [];
  const unsubscribeHealthy = subscribeBundledOmpInitialization("failing-observer-agent", (phase) =>
    phases.push(phase),
  );
  try {
    expect(() => scope.report("installing")).not.toThrow();
    expect(() => scope.close()).not.toThrow();
    expect(phases).toEqual(["verifying", "installing", null]);
  } finally {
    scope.close();
    unsubscribe();
    unsubscribeHealthy();
  }
});
