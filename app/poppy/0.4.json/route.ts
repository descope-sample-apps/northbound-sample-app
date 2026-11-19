// Draft 0.4 of Northbound's Poppy discovery document, kept alongside 1.0.
//
// /.well-known/poppy.json names this URL in `supported_versions`. Before 1.0 two versions
// are compatible only on an exact major.minor match (§3.4), so an agent that speaks 0.4
// refuses a 1.0 document outright rather than reading what it recognizes. Without this
// route, bumping the version would not have been an upgrade — it would have cut off every
// 0.4 agent on the day it shipped.
//
// Same document, same Company: §3.4 requires every version served at once to carry the
// same organization.domain and select the same issuer, so that a bump never changes who
// Northbound is, and with it every User ID and refresh token already issued.
import { NextResponse } from 'next/server';
import { poppyDocument } from '@/lib/api/poppyDocument';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // No `supported_versions` here. "The document there has the protocol_version it is
  // listed under, and no supported_versions" — an agent does not follow a chain.
  return NextResponse.json(poppyDocument(request, '0.4'));
}
