import type { LocalizedString } from "@kira-joo/toolkit-common";

/** More alternatives than this stops reading as "the same item in another colour" on a product page. */
export const MAX_GROUP_MEMBERS = 30;
/** A label is a colour or design name ("Brown", "Teddy bear"), shown on a small tile. */
export const MAX_GROUP_LABEL_LENGTH = 40;
export const MAX_GROUP_NAME_LENGTH = 120;

export interface GroupMemberInput {
  productId: string;
  label: LocalizedString;
}

const LOCALES = ["en", "ar"] as const;
const LANGUAGE = { en: "English", ar: "Arabic" } as const;
const WITH_ARTICLE = { en: "an English", ar: "an Arabic" } as const;

/** Trimmed copies: what a membership save stores. */
export function normalizeMembers(members: GroupMemberInput[]): GroupMemberInput[] {
  return members.map((member) => ({ productId: member.productId.trim(), label: { en: (member.label?.en ?? "").trim(), ar: (member.label?.ar ?? "").trim() } }));
}

/**
 * Why a membership list cannot be saved — empty when it can. Every member needs a label in both languages (the
 * storefront shows it in either), labels must tell members apart, and a product is listed once.
 */
export function membershipProblems(members: GroupMemberInput[]): string[] {
  const problems: string[] = [];
  if (members.length > MAX_GROUP_MEMBERS) problems.push(`A group can hold at most ${MAX_GROUP_MEMBERS} products.`);

  const seenProducts = new Set<string>();
  const seenLabels = { en: new Map<string, number>(), ar: new Map<string, number>() };
  normalizeMembers(members).forEach((member, index) => {
    const position = `Product ${index + 1}`;
    if (!member.productId) problems.push(`${position} has no product.`);
    else if (seenProducts.has(member.productId)) problems.push(`${position} is already in this group.`);
    seenProducts.add(member.productId);

    for (const locale of LOCALES) {
      const label = member.label[locale];
      if (!label) problems.push(`${position} needs ${WITH_ARTICLE[locale]} label.`);
      else if (label.length > MAX_GROUP_LABEL_LENGTH) problems.push(`${position}'s ${LANGUAGE[locale]} label is longer than ${MAX_GROUP_LABEL_LENGTH} characters.`);
      else {
        const key = label.toLocaleLowerCase(locale);
        const first = seenLabels[locale].get(key);
        if (first !== undefined) problems.push(`${position} has the same ${LANGUAGE[locale]} label as product ${first + 1} ("${label}").`);
        else seenLabels[locale].set(key, index);
      }
    }
  });
  return problems;
}

/** Why a group name cannot be saved, or null. One language is enough — the name is for staff. */
export function groupNameProblem(name: LocalizedString | undefined): string | null {
  const en = (name?.en ?? "").trim();
  const ar = (name?.ar ?? "").trim();
  if (!en && !ar) return "Give the group a name.";
  if (en.length > MAX_GROUP_NAME_LENGTH || ar.length > MAX_GROUP_NAME_LENGTH) return `A group name can be at most ${MAX_GROUP_NAME_LENGTH} characters.`;
  return null;
}
