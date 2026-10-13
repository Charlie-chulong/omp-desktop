export interface ExplorerCheckoutContext {
  serverId: string;
  /** Checkout identity for project-scoped layout tabs (not part of cwd matching). */
  workspaceId?: string;
  cwd: string;
  isGit: boolean;
}
