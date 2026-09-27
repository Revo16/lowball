import { redirect } from "next/navigation";

// The Bookie tab is gone (everything moved to The Slip). Old links and
// notifications that point here land on The Slip.
export default function BookieMoved() {
  redirect("/");
}
