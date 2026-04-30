import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const unlocked = req.cookies.get("beeb-unlocked")?.value === "1";
  return NextResponse.json({ unlocked });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.GATE_PASSWORD;

  if (!correct || password !== correct) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("beeb-unlocked", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
