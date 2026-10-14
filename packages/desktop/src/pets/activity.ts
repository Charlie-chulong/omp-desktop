import type {
  DesktopPetActivity,
  DesktopPetLabels,
  DesktopPetTask,
  PetTaskStatus,
} from "./types.js";

const PRIORITY: Record<PetTaskStatus, number> = {
  needs_input: 0,
  blocked: 1,
  ready: 2,
  running: 3,
};
export const DEFAULT_PET_ACTIVITY: DesktopPetActivity = {
  connected: false,
  serverIds: [],
  tasks: [],
  fontFamily: "Segoe UI",
  labels: {
    idle: "All quiet",
    offline: "Offline",
    running: "Working",
    needs_input: "Needs your input",
    ready: "Ready to review",
    blocked: "Blocked",
    openApp: "Open OMP",
    openTask: "Open task",
    hide: "Hide companion",
    resetPosition: "Reset position",
    taskCount: "{{count}} tasks",
  },
};

export function parsePetActivity(value: unknown): DesktopPetActivity {
  if (!value || typeof value !== "object") throw new Error("Invalid pet activity");
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length > 10000 ||
    typeof input.connected !== "boolean" ||
    !Array.isArray(input.serverIds) ||
    !input.serverIds.every(
      (id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 512,
    ) ||
    typeof input.fontFamily !== "string" ||
    input.fontFamily.length > 512 ||
    !input.labels ||
    typeof input.labels !== "object"
  )
    throw new Error("Invalid pet activity snapshot");
  const rawLabels = input.labels as Record<string, unknown>;
  const labels = {} as DesktopPetLabels;
  for (const key of Object.keys(DEFAULT_PET_ACTIVITY.labels) as (keyof DesktopPetLabels)[]) {
    if (typeof rawLabels[key] !== "string" || rawLabels[key].length > 512)
      throw new Error(`Invalid pet label: ${key}`);
    labels[key] = rawLabels[key];
  }
  const serverIds = new Set<string>(input.connected ? (input.serverIds as string[]) : []);
  const tasks: DesktopPetTask[] = input.tasks.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid pet task");
    const task = raw as Record<string, unknown>;
    if (
      typeof task.serverId !== "string" ||
      !task.serverId ||
      task.serverId.length > 512 ||
      typeof task.agentId !== "string" ||
      !task.agentId ||
      task.agentId.length > 512 ||
      typeof task.title !== "string" ||
      task.title.length > 2048 ||
      typeof task.updatedAt !== "number" ||
      !Number.isFinite(task.updatedAt) ||
      typeof task.status !== "string" ||
      !Object.hasOwn(PRIORITY, task.status) ||
      (input.connected && !serverIds.has(task.serverId))
    )
      throw new Error("Invalid pet task fields");
    return {
      serverId: task.serverId,
      agentId: task.agentId,
      title: task.title,
      updatedAt: task.updatedAt,
      status: task.status as PetTaskStatus,
    };
  });
  return {
    tasks: input.connected ? tasks : [],
    connected: input.connected,
    serverIds: [...serverIds],
    fontFamily: input.fontFamily,
    labels,
  };
}

export class PetActivitySnapshots {
  private readonly snapshots = new Map<number, DesktopPetActivity>();
  private readonly hostTasks = new Map<string, DesktopPetTask[]>();

  publish(senderId: number, activity: DesktopPetActivity): void {
    this.snapshots.delete(senderId);
    this.snapshots.set(senderId, activity);
    if (!activity.connected) return;
    const reports = new Map<string, Map<string, DesktopPetTask>>();
    for (const serverId of activity.serverIds) reports.set(serverId, new Map());
    for (const task of activity.tasks) {
      const report = reports.get(task.serverId);
      if (!report) continue;
      const previous = report.get(task.agentId);
      if (
        !previous ||
        task.updatedAt > previous.updatedAt ||
        (task.updatedAt === previous.updatedAt && PRIORITY[task.status] < PRIORITY[previous.status])
      ) {
        report.set(task.agentId, task);
      }
    }
    // Each publisher reports the complete outstanding directory for these hosts.
    // Keep an empty acknowledgement even if that window subsequently closes.
    for (const [serverId, report] of reports) this.hostTasks.set(serverId, [...report.values()]);
  }

  remove(senderId: number): void {
    this.snapshots.delete(senderId);
  }

  get(): DesktopPetActivity {
    let latest = DEFAULT_PET_ACTIVITY;
    const activeServers = new Set<string>();
    for (const activity of this.snapshots.values()) {
      latest = activity;
      if (activity.connected) {
        for (const serverId of activity.serverIds) activeServers.add(serverId);
      }
    }
    const tasks: DesktopPetTask[] = [];
    for (const [serverId, report] of this.hostTasks) {
      if (activeServers.has(serverId)) tasks.push(...report);
      else this.hostTasks.delete(serverId);
    }
    tasks.sort(
      (a, b) =>
        PRIORITY[a.status] - PRIORITY[b.status] ||
        b.updatedAt - a.updatedAt ||
        a.serverId.localeCompare(b.serverId) ||
        a.agentId.localeCompare(b.agentId),
    );
    return { ...latest, connected: activeServers.size > 0, tasks };
  }
}
