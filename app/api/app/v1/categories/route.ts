import { jsonResponse } from '@/lib/api/bearer';
import { withCustomer } from '@/lib/api/appBearer';
import { listCategories } from '@/lib/services/catalog';

export const dynamic = 'force-dynamic';

export const GET = withCustomer(async () => {
  const categories = await listCategories();
  return jsonResponse({
    categories: categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
  });
});
