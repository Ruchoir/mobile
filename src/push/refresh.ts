/**
 * Keeping the extensions' access tokens fresh while the app is not on screen (decided on 2026-11-10).
 *
 * The widgets and the notification service read each instance's products with the short-lived
 * access tokens the app wrote for them (`shareSessions`, `push/phone.ts`); they never hold a refresh
 * token, so they cannot renew one. The app renews them itself: whenever it comes back to the
 * foreground (`AccountsProvider`), and here, from a background task the system runs now and then
 * (iOS `BGTaskScheduler`, Android WorkManager, through expo-background-task). The task reads the
 * registry, asks the native client for fresh tokens and writes them again, then redraws the widgets.
 *
 * The registry and the grants are readable only while the phone is unlocked: a run on a locked
 * phone reads nothing and changes nothing, and the entries already written stay.
 *
 * Defined at the top level of a module the entry imports (`index.ts`), as the task manager requires.
 */
import { loadRegistry } from "../accounts/store";
import { refreshWidgets } from "../widgets";
import { backgroundTask, taskManager } from "./native";
import { shareSessions } from "./phone";

export const REFRESH_TASK = "ruchoir.sessions.refresh";

/** How often the system may run the task, at the least, in minutes (it decides when). */
const EVERY_MINUTES = 30;

/** Write fresh tokens for every instance of the registry, and redraw the widgets. */
export async function refreshSharedSessions(): Promise<void> {
  const registry = await loadRegistry();
  // Nothing read (locked, or signed out of everything): leave what the extensions hold alone.
  if (registry.instances.length === 0) return;
  await shareSessions(registry.instances);
  await refreshWidgets();
}

const BackgroundTask = backgroundTask();

taskManager()?.defineTask(REFRESH_TASK, async () => {
  try {
    await refreshSharedSessions();
    return BackgroundTask?.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask?.BackgroundTaskResult.Failed;
  }
});

/** Ask the system to run the task from time to time. Once registered it stays; asking again is harmless. */
export async function scheduleSessionRefresh(): Promise<void> {
  if (!BackgroundTask) return;
  const status = await BackgroundTask.getStatusAsync().catch(() => null);
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: EVERY_MINUTES }).catch(() => {});
}
