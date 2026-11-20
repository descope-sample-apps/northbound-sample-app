import { jsonResponse } from '@/lib/api/bearer';
import { withCustomer } from '@/lib/api/appBearer';
import { getProfile } from '@/lib/services/profile';

export const dynamic = 'force-dynamic';

export const GET = withCustomer(async (_request, session) => {
  const profile = await getProfile(session.customer.id);
  return jsonResponse({ name: profile.name, email: profile.email });
});
