import { currentUser } from '@/lib/auth-node'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const u = await currentUser()
  if (!u) return NextResponse.json({ user: null }, { status: 401 })
  return NextResponse.json({ user: u })
}
