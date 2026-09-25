import { BottomNav } from "@/components/nav";
import { SearchView } from "@/components/SearchView";
import { requireMember } from "@/lib/session";
import { boardData } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const sp = await searchParams;
  const { me, all } = await requireMember();
  const data = await boardData(me, all, sp.for);
  return (
    <>
      <SearchView initial={data} key={data.target.userId} />
      <BottomNav current="search" />
    </>
  );
}
