import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { newsletterSubscriberRepository } from "../core/repositories";
import { unsubscribeNewsletter } from "./subscribe";

/**
 * Staff unsubscribe an address (a request received by another channel). The row is
 * kept as a suppression: the public form never re-subscribes it. Repeating on an
 * already-unsubscribed address is a no-op, not an error. Returns the row's state.
 */
export async function adminUnsubscribe(id: string) {
  const subscriber = await newsletterSubscriberRepository.findOne({ where: { _id: id }, skipThrowError: true });
  if (!subscriber) throw new NotFoundError("Subscriber not found");
  await unsubscribeNewsletter({ _id: subscriber._id });
  return newsletterSubscriberRepository.findOne({ where: { _id: id } });
}
