// Northbound's Poppy discovery document: https://personalagentprotocol.org/docs/1.0/spec
//
// A route rather than a file in public/, so the issuer comes from configuration instead
// of being committed, and so the URLs in it name the host that served it.
//
// The document itself is lib/api/poppyDocument.ts, because it is served twice: this is
// the version Northbound prefers, and /poppy/0.4.json is the older one still offered
// beside it (§3.4). Two routes, one document, so they cannot drift into describing two
// different Companies — which §3.4 makes a MUST, not a tidiness preference.
import { NextResponse } from 'next/server';
import { POPPY_VERSION, poppyDocument } from '@/lib/api/poppyDocument';

// The issuer is read per request, not baked in at build time.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return NextResponse.json(poppyDocument(request, POPPY_VERSION));
}
