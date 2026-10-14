import { describe, expect, it } from "vitest";
import { ALIASES, PLAYS, getPlay } from "../plays";

const privatePlayerNames = [
  "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_001", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_002", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_003", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_004", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_005", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_006", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_007", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_008", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_009", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_010", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_011", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_012", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_013", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_014", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_015", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_016", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_017", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_018", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_019", "SANITIZED_PRIVATE_PLAYER_PLACEHOLDER_020",
];

describe("play catalog", () => {
  it("has all 25 approved sellable Plays with unique slugs and valid prices", () => {
    expect(new Set(PLAYS.map(({ slug }) => slug)).size).toBe(PLAYS.length);
    expect(PLAYS.every(({ price }) => Number.isInteger(price) && price > 0)).toBe(true);
    expect(PLAYS).toHaveLength(25);
    expect(PLAYS.every(({ availability }) => availability === "available")).toBe(true);
    expect(PLAYS.find(({ slug }) => slug === "lead-bank-engine")?.price).toBe(499);
    expect(PLAYS.find(({ slug }) => slug === "customer-follow-up-machine")?.price).toBe(129);
    expect(PLAYS.find(({ slug }) => slug === "missed-call-ai-answer")?.price).toBe(299);
  });

  it("does not include sanitized private-play placeholders", () => {
    const internalOnly = [
  "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_001", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_002", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_003", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_004", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_005", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_006", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_007", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_008", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_009", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_010", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_011", "SANITIZED_PRIVATE_PLAY_PLACEHOLDER_012",
];
    expect(PLAYS.filter(({ slug }) => internalOnly.includes(slug))).toEqual([]);
  });

  it("keeps sanitized player-denylist placeholders out of public catalog data", () => {
    const publicCatalog = JSON.stringify(PLAYS);
    expect(privatePlayerNames.filter((name) => publicCatalog.includes(name))).toEqual([]);
  });

  it("resolves every storefront alias to its canonical Play", () => {
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      expect(getPlay(alias)?.slug).toBe(canonical);
    }
  });
});
