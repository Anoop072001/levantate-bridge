import { redirect } from "next/navigation";

/** Old bookmarks and copy pointed here; linking now lives on /wallet. */
export default function VerifyRedirect() {
  redirect("/wallet");
}
