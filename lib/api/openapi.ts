import { SCOPE_READ, SCOPE_WRITE } from './resource';

/**
 * The OpenAPI description an agent reads to learn what it can do here.
 *
 * WHY THIS EXISTS AT ALL. Northbound's poppy.json used to describe the store and its
 * scopes and then offer nowhere to spend a token: no `apis`, no agent endpoint. An agent
 * sent to buy something got as far as signing the customer in and then refused, correctly,
 * because `https://northbound.camp/api/orders` was not an API the site had listed. This
 * document is what makes that URL something the site vouches for — Poppy 0.4 (3.2) has
 * agents resolve an API's identity from `servers[0]`, and `apis` in poppy.json points here.
 *
 * `servers[0].url` IS THE RESOURCE IDENTIFIER. It is the string tokens are minted for and
 * the string the protected resource metadata has to repeat character for character, so it
 * is built from the same API_BASE_PATH the routes are mounted on rather than written out
 * again here.
 *
 * Built from the request's own origin, so the copy served to a visitor on one host never
 * names another. An agent checks that the APIs a site advertises are on the site it opened
 * and refuses a document that points somewhere else.
 */
export function openApiDocument(baseUrl: string, openIdConnectUrl?: string) {
  const securitySchemes = openIdConnectUrl
    ? {
        // openIdConnect rather than a hand-written oauth2 block: the authorization and
        // token endpoints are the issuer's to publish and change, and copying them here
        // creates a second copy to go stale. An agent follows this URL and reads the
        // live ones. The same issuer is named by the protected resource metadata, which
        // is where a client that starts from a 401 finds it.
        descope: { type: 'openIdConnect', openIdConnectUrl },
      }
    : {};
  const secured = (scope: string) => (openIdConnectUrl ? [{ descope: [scope] }] : []);

  return {
    openapi: '3.1.0',
    info: {
      title: 'Northbound Agent API',
      version: '1.0.0',
      description:
        'Browse Northbound, build the customer\'s cart and place orders for them. '
        + 'Browsing is public. Everything else needs an access token the customer approved '
        + 'for their assistant, sent as `Authorization: Bearer <token>` — or, when the '
        + 'authorization server bound the token to a key, as `Authorization: DPoP <token>` '
        + 'with an RFC 9449 proof in the `DPoP` header. '
        + `Reading needs ${SCOPE_READ}; changing the cart or placing an order needs `
        + `${SCOPE_WRITE}, which also satisfies a read. `
        + 'Sign-in is described in /.well-known/poppy.json, and the authorization server '
        + 'for this API in /.well-known/oauth-protected-resource/api/agent/v1. '
        + 'Orders record which assistant placed them.',
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes,
      schemas: {
        Money: {
          type: 'object',
          description: 'Every amount appears twice: integer cents to compute with, and a '
            + 'formatted string to repeat to the customer.',
        },
        Product: {
          type: 'object',
          description: 'One item in the catalog. `slug` is what the cart is built from; '
            + '`url` is where to send the customer.',
          properties: {
            slug: { type: 'string', description: 'The id the cart and this API use.' },
            name: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'string', examples: ['$650.00'] },
            price_cents: { type: 'integer' },
            in_stock: { type: 'boolean' },
            stock_quantity: { type: 'integer' },
            url: {
              type: 'string',
              format: 'uri',
              description: 'The product page on the website. Link to this rather than '
                + 'building a URL from the slug — the page is /product/{slug}, which is '
                + 'not the plural path this API is served on.',
            },
          },
        },
        OrderSummary: {
          type: 'object',
          properties: {
            order_number: { type: 'integer' },
            status: { type: 'string', enum: ['placed', 'shipped', 'delivered', 'cancelled'] },
            placed_at: { type: 'string', format: 'date-time' },
            item_count: { type: 'integer' },
            total: { type: 'string', examples: ['$428.95'] },
            total_cents: { type: 'integer' },
            placed_by_agent: {
              type: ['string', 'null'],
              description: 'The assistant that placed it, or null if the customer did.',
            },
            url: { type: 'string', format: 'uri', description: 'The customer\'s own order page.' },
          },
        },
        Order: {
          type: 'object',
          description: 'An order with its items, shipping address and the card charged.',
          properties: {
            order_number: { type: 'integer' },
            status: { type: 'string', enum: ['placed', 'shipped', 'delivered', 'cancelled'] },
            placed_at: { type: 'string', format: 'date-time' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'The name as it was when the order was placed.',
                  },
                  quantity: { type: 'integer' },
                  unit_price_cents: { type: 'integer' },
                  line_total_cents: { type: 'integer' },
                },
              },
            },
            total_cents: { type: 'integer' },
            shipping_address: { type: 'object' },
            payment_method: {
              type: 'object',
              description: 'Brand, last four digits and expiry. Nothing else is stored.',
            },
          },
        },
        Cart: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  name: { type: 'string' },
                  quantity: { type: 'integer' },
                  unit_price: { type: 'string', examples: ['$650.00'] },
                  unit_price_cents: { type: 'integer' },
                  line_total: { type: 'string' },
                  line_total_cents: { type: 'integer' },
                  in_stock: {
                    type: 'boolean',
                    description: 'False once the catalog can no longer fill this line.',
                  },
                  url: {
                    type: 'string',
                    format: 'uri',
                    description: 'The product page, the same link listProducts gives.',
                  },
                },
              },
            },
            total_cents: {
              type: 'integer',
              description: 'What placing an order right now would charge. Send this as '
                + 'expected_total_cents.',
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'No token, or a token Northbound will not accept. The '
            + 'WWW-Authenticate header carries resource_metadata, which is where to find '
            + 'the authorization server.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'The customer has not approved this scope for this assistant. The '
            + 'WWW-Authenticate header names the scope to ask for.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/products': {
        get: {
          operationId: 'listProducts',
          summary: 'Search the catalog',
          description: 'Public. Returns product slugs, which is what the cart is built '
            + 'from, and the page URL to link the customer to.',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Name search.' },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
          ],
          responses: {
            200: {
              description: 'Matching products.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      products: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Product' },
                      },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      per_page: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/cart': {
        get: {
          operationId: 'getCart',
          summary: "The customer's cart and what it would cost",
          description: 'The same cart the customer sees on the website, not a separate one '
            + 'for assistants.',
          security: secured(SCOPE_READ),
          responses: {
            200: {
              description: 'The cart.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Cart' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      '/cart/items': {
        post: {
          operationId: 'setCartItem',
          summary: 'Set how many of one product the cart holds',
          description: 'Sets rather than adds, so sending the same request twice is '
            + 'harmless. quantity 0 removes the line. Answers with the whole cart, so the '
            + 'new total can go straight into placeOrder.',
          security: secured(SCOPE_WRITE),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['slug', 'quantity'],
                  properties: {
                    slug: { type: 'string', description: 'From listProducts.' },
                    quantity: { type: 'integer', minimum: 0, maximum: 99 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'The cart after the change.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Cart' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { description: 'No product with that slug.' },
            409: { description: 'Not enough stock.' },
          },
        },
      },
      '/checkout-options': {
        get: {
          operationId: 'listCheckoutOptions',
          summary: 'Saved addresses and cards an order can be placed against',
          description: 'Read only. An assistant may never add, change or remove either; '
            + 'the customer does that themselves.',
          security: secured(SCOPE_READ),
          responses: {
            200: { description: 'Addresses and payment methods.' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
      },
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: "The customer's orders, newest first",
          description: 'Start here to answer "where is my order": each entry carries its '
            + 'status, and getOrder has the items.',
          security: secured(SCOPE_READ),
          parameters: [
            {
              name: 'mine',
              in: 'query',
              schema: { type: 'boolean' },
              description: 'Only orders this assistant placed itself.',
            },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
          ],
          responses: {
            200: {
              description: 'Orders.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      orders: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/OrderSummary' },
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
          },
        },
        post: {
          operationId: 'placeOrder',
          summary: "Place the customer's cart as an order",
          description: 'Buys what is in the cart. There is no items parameter — build the '
            + 'cart with setCartItem first, read the total, then commit to it. '
            + 'Send expected_total_cents: the order is refused rather than charged if the '
            + 'total has moved since. address_id and payment_method_id default to the '
            + "customer's saved defaults. This is not undoable.",
          security: secured(SCOPE_WRITE),
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    expected_total_cents: {
                      type: 'integer',
                      description: 'The total the assistant read from the cart. Strongly '
                        + 'recommended.',
                    },
                    address_id: { type: 'integer' },
                    payment_method_id: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'The order, with everything bought.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
            },
            400: { description: 'The cart is empty, or no saved address or card.' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            409: { description: 'The total changed, or something went out of stock.' },
            503: { description: 'Another checkout held the write lock. Retry.' },
          },
        },
      },
      '/orders/{orderNumber}': {
        get: {
          operationId: 'getOrder',
          summary: 'One order, with its items',
          security: secured(SCOPE_READ),
          parameters: [
            {
              name: 'orderNumber',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            200: {
              description: 'The order.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: {
              description: "No such order for this customer. Someone else's order is a 404 "
                + 'here too, so this never confirms one exists.',
            },
          },
        },
      },
    },
  };
}
