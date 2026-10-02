import { serveInstructions } from '@/lib/agents/instructionsRoute';

export function GET(request: Request): Response {
  return serveInstructions(request);
}
