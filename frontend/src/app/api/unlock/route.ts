import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ unlocked: false });
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correct = process.env.GATE_PASSWORD;

  if (!correct || password !== correct) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
