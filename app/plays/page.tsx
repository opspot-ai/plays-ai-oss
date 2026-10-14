import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";

export const metadata: Metadata = {
  title: "The playbook — Plays",
  description: "Every play in the book. Draft one, drop it into your setup, connect your tools.",
};

export default async function PlaysPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const sp = await searchParams;
  return <CatalogClient initialCat={sp.cat ?? "All"} />;
}
