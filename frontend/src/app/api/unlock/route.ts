import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const unlocked = req.cookies.get("beeb-s1")?.value === "1";
  return NextResponse.json({ unlocked });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.GATE_PASSWORD;

  if (!correct || password !== correct) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("beeb-s1", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // no maxAge = session cookie, clears when browser closes
  });
  return res;
}
