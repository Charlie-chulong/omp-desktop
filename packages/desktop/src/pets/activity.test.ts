import { describe, expect, it } from "vitest";
import { DEFAULT_PET_ACTIVITY, PetActivitySnapshots, parsePetActivity } from "./activity.js";
import type { DesktopPetTask, PetTaskStatus } from "./types.js";

function task(
  agentId: string,
  status: PetTaskStatus,
  updatedAt = 1,
  serverId = "local",
): DesktopPetTask {
  return { serverId, agentId, title: agentId, status, updatedAt };
}

describe("companion activity snapshots", () => {
  it("prioritizes real attention before blocked, review and working tasks", () => {
    const snapshots = new PetActivitySnapshots();
    snapshots.publish(1, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [
        task("a", "running", 999),
        task("b", "ready"),
        task("c", "blocked"),
        task("d", "needs_input"),
      ],
    });
    expect(snapshots.get().tasks.map((entry) => entry.agentId)).toEqual(["d", "c", "b", "a"]);
  });

  it("deduplicates by host and task with latest timestamp, not stale attention", () => {
    const snapshots = new PetActivitySnapshots();
    snapshots.publish(1, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [task("same", "needs_input", 1)],
    });
    snapshots.publish(2, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local", "remote"],
      tasks: [task("same", "running", 2), task("same", "ready", 1, "remote")],
    });
    expect(snapshots.get().tasks).toEqual([
      task("same", "ready", 1, "remote"),
      task("same", "running", 2),
    ]);
    snapshots.publish(1, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [],
    });
    snapshots.remove(2);
    expect(snapshots.get().tasks).toEqual([]);
    snapshots.remove(1);
    expect(snapshots.get().connected).toBe(false);
  });

  it("does not resurrect acknowledged attention from an older window after the newer window closes", () => {
    const snapshots = new PetActivitySnapshots();
    snapshots.publish(1, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [task("acknowledged", "ready")],
    });
    snapshots.publish(2, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [],
    });
    expect(snapshots.get().tasks).toEqual([]);
    snapshots.remove(2);
    expect(snapshots.get().tasks).toEqual([]);
  });

  it("replaces latest sender snapshots and clears disconnected task reports", () => {
    const snapshots = new PetActivitySnapshots();
    snapshots.publish(
      1,
      parsePetActivity({
        ...DEFAULT_PET_ACTIVITY,
        connected: true,
        serverIds: ["local"],
        tasks: [task("a", "ready")],
      }),
    );
    snapshots.publish(
      1,
      parsePetActivity({ ...DEFAULT_PET_ACTIVITY, connected: false, tasks: [task("a", "ready")] }),
    );
    expect(snapshots.get().tasks).toEqual([]);
    expect(() =>
      parsePetActivity({ ...DEFAULT_PET_ACTIVITY, tasks: [task("a", "running", NaN)] }),
    ).toThrow("Invalid pet task");
    expect(() => parsePetActivity({ ...DEFAULT_PET_ACTIVITY, labels: {} })).toThrow(
      "Invalid pet label",
    );
  });

  it("keeps stable priority ties when independent hosts report in different orders", () => {
    const a = new PetActivitySnapshots();
    const b = new PetActivitySnapshots();
    const first = {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local"],
      tasks: [task("b", "needs_input")],
    };
    const second = {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["remote"],
      tasks: [task("a", "needs_input", 1, "remote")],
    };
    a.publish(1, first);
    a.publish(2, second);
    b.publish(2, second);
    b.publish(1, first);
    expect(a.get().tasks).toEqual([
      task("b", "needs_input"),
      task("a", "needs_input", 1, "remote"),
    ]);
    expect(a.get().tasks).toEqual(b.get().tasks);
  });
});
