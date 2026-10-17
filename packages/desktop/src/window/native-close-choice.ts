import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { BackgroundModeCloseChoice } from "./background-mode.js";

export type StoredCloseBehavior = Exclude<BackgroundModeCloseChoice, "cancel"> | "ask";

type RememberedCloseBehavior = Exclude<StoredCloseBehavior, "ask">;

export interface NativeCloseChoiceDependencies {
  getCloseBehavior(): Promise<StoredCloseBehavior>;
  showMessageBox(window: BrowserWindow, options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
  rememberCloseBehavior(choice: RememberedCloseBehavior): Promise<void>;
  onRememberError(error: unknown): void;
}

const CLOSE_CHOICE_DIALOG_OPTIONS: MessageBoxOptions = {
  type: "question",
  title: "OMP Desktop",
  message: "点击关闭时",
  detail: "选择最小化到系统托盘后，可通过托盘图标恢复窗口。",
  buttons: ["最小化到托盘", "退出应用", "取消"],
  defaultId: 0,
  cancelId: 2,
  checkboxLabel: "记住我的选择，不再提醒",
  checkboxChecked: false,
  noLink: true,
};

function closeChoiceFromResponse(response: number): BackgroundModeCloseChoice {
  if (response === 0) return "background";
  if (response === 1) return "quit";
  return "cancel";
}

export async function promptForNativeCloseChoice(
  window: BrowserWindow,
  dependencies: NativeCloseChoiceDependencies,
): Promise<BackgroundModeCloseChoice> {
  const closeBehavior = await dependencies.getCloseBehavior();
  if (closeBehavior !== "ask") return closeBehavior;

  const result = await dependencies.showMessageBox(window, CLOSE_CHOICE_DIALOG_OPTIONS);
  const choice = closeChoiceFromResponse(result.response);
  if (result.checkboxChecked && choice !== "cancel") {
    try {
      await dependencies.rememberCloseBehavior(choice);
    } catch (error) {
      dependencies.onRememberError(error);
    }
  }
  return choice;
}
