import { escapeRegExp } from "@kira-joo/backend-toolkit-mongoose";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { IsIn, IsOptional } from "class-validator";
import { newsletterSubscriberRepository } from "../core/repositories";
import { NEWSLETTER_STATUSES, type NewsletterStatus, type NewsletterSubscriberSchema } from "./newsletter-subscriber.schema";

export class ListNewsletterSubscribersQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsIn([...NEWSLETTER_STATUSES])
  status?: NewsletterStatus;
}

/** The newsletter list for the console. `search` matches the address; the schema has no `@Searchable()` field, so it is an explicit regex on `email`. */
export async function listNewsletterSubscribers(query: ListNewsletterSubscribersQueryDto): Promise<PaginatedResponse<NewsletterSubscriberSchema>> {
  const { search, status, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search?.trim()) where.email = new RegExp(escapeRegExp(search.trim()), "i");
  return newsletterSubscriberRepository.findAllAndCountPublic({ where, query: rest });
}
