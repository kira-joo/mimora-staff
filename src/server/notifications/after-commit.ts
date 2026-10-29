import { getActiveTransaction } from "@kira-joo/backend-toolkit-mongoose";

/**
 * Runs a side effect — an email, an in-app notification — only once what it
 * announces is durable.
 *
 * Inside a transaction the task is registered with `onCommit`: it runs after
 * the FINAL successful commit, never on a rolled-back attempt and never twice
 * on a retried one (the toolkit clears registrations before every retry). With
 * no transaction active the write it follows is already durable, so the task
 * runs now.
 *
 * **Never throws.** A failed notification must not fail, or roll back, the
 * business operation it reports on — D-8, "no flow may depend on delivery". The
 * error's NAME is logged (not its message, which can quote a recipient or a
 * connection string) with the label saying what was being sent.
 */
export async function afterCommit(label: string, task: () => Promise<void>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[notifications] ${label} failed: ${error instanceof Error ? error.name : "unknown error"}`);
    }
  };

  const transaction = getActiveTransaction();
  if (transaction) {
    transaction.onCommit(run);
    return;
  }
  await run();
}
