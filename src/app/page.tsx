import { BottomNav } from "@/components/nav";
import { SlipView } from "@/components/SlipView";
import { requireMember } from "@/lib/session";
import { slipData } from "@/lib/slip";
import { pushEnabled, pushPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

export default async function SlipPage() {
  const { me, all } = await requireMember();
  const data = await slipData(me, all);
  return (
    <>
      <SlipView initial={data} pushKey={pushEnabled() ? pushPublicKey() : ""} />
      <BottomNav current="slip" />
    </>
  );
}
