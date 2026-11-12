import { CREATOR_COOKIE, creatorCookieValue, isValidCreatorKey } from "@/lib/creator";

const YEAR = 60 * 60 * 24 * 365;

/** GET /api/creator?key=...  -> sets the creator cookie and goes home. ?logout=1 clears it. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/", url);
  if (url.searchParams.has("logout")) {
    return new Response(null, {
      status: 303,
      headers: { Location: home.toString(), "Set-Cookie": `${CREATOR_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
    });
  }
  if (!isValidCreatorKey(url.searchParams.get("key"))) {
    return Response.json({ error: "Invalid creator key." }, { status: 403 });
  }
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${home.toString()}?creator=1`,
      "Set-Cookie": `${CREATOR_COOKIE}=${creatorCookieValue()}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure}`,
      "Cache-Control": "no-store",
    },
  });
}
