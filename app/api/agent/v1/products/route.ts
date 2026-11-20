import { withPublic, badRequest, jsonResponse, publicOrigin } from '@/lib/api/bearer';
import { productShape } from '@/lib/api/shapes';
import { searchProducts } from '@/lib/services/catalog';

export const dynamic = 'force-dynamic';

const MAX_PER_PAGE = 50;

/**
 * The catalog, so an assistant can find the slug it needs for the cart.
 *
 * NO TOKEN. Browsing is public to people on /shop, so it is public to their assistants
 * too. Putting a scope on it would mean an assistant had to ask the customer for access
 * before it could answer "do you sell rain jackets" — a question the website answers to
 * anyone. It is also why Northbound publishes no catalog scope to request.
 */
export const GET = withPublic(async (request) => {
  const params = new URL(request.url).searchParams;

  const perPageParam = params.get('per_page');
  let perPage = 24;
  if (perPageParam !== null) {
    perPage = Number(perPageParam);
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
      return badRequest(`per_page must be a whole number between 1 and ${MAX_PER_PAGE}.`);
    }
  }

  const pageParam = params.get('page');
  let page = 1;
  if (pageParam !== null) {
    page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1) {
      return badRequest('page must be a whole number of 1 or more.');
    }
  }

  const { items, total } = await searchProducts({
    q: params.get('q') ?? undefined,
    categorySlug: params.get('category') ?? undefined,
    page,
    perPage,
  });

  const origin = publicOrigin(request);
  return jsonResponse({
    products: items.map((product) => productShape(product, origin)),
    total,
    page,
    per_page: perPage,
  });
});
