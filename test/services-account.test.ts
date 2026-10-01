import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withTestDb, seedMinimal, type TestDb } from './harness';
import { browserContext } from '@/lib/oauth/types';

let tdb: TestDb;
let ids: Awaited<ReturnType<typeof seedMinimal>>;

vi.mock('@/db/client', () => ({
  get db() {
    return (globalThis as { __testDb?: unknown }).__testDb;
  },
}));

beforeEach(async () => {
  tdb = await withTestDb();
  ids = await seedMinimal(tdb);
  (globalThis as { __testDb?: unknown }).__testDb = tdb.db;
});

afterEach(async () => { await tdb.close(); });

const NEW_ADDRESS = {
  label: 'Work', recipient: 'Alice Chen', line1: '2 Office Way',
  city: 'Portland', region: 'OR', postalCode: '97202',
};

describe('profile service', () => {
  it('returns the profile for the requesting customer', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    const profile = await getProfile(browserContext(ids.alice));
    expect(profile.email).toBe('alice@example.com');
    expect(profile.emailVerified).toBe(true);
  });

  it('reports Bob as unverified', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    expect((await getProfile(browserContext(ids.bob))).emailVerified).toBe(false);
  });

  it('throws NotFoundError for an unknown customer', async () => {
    const { getProfile } = await import('@/lib/services/profile');
    const { NotFoundError } = await import('@/lib/services/errors');
    await expect(getProfile(browserContext(999_999))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates a name and rejects an empty one', async () => {
    const { getProfile, updateProfile } = await import('@/lib/services/profile');
    const { ValidationError } = await import('@/lib/services/errors');
    await updateProfile(browserContext(ids.alice), { name: 'Alice C.' });
    expect((await getProfile(browserContext(ids.alice))).name).toBe('Alice C.');
    await expect(updateProfile(browserContext(ids.alice), { name: '   ' }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('address service', () => {
  it('lists only the requesting customer\'s addresses', async () => {
    const { listAddresses } = await import('@/lib/services/addresses');
    const alice = await listAddresses(browserContext(ids.alice));
    expect(alice).toHaveLength(1);
    expect(alice[0].customerId).toBe(ids.alice);
  });

  it('creates an address for the requesting customer', async () => {
    const { listAddresses, upsertAddress } = await import('@/lib/services/addresses');
    await upsertAddress(browserContext(ids.alice), NEW_ADDRESS);
    expect(await listAddresses(browserContext(ids.alice))).toHaveLength(2);
    expect(await listAddresses(browserContext(ids.carol))).toHaveLength(1);
  });

  it('refuses to edit another customer\'s address', async () => {
    const { listAddresses, upsertAddress } = await import('@/lib/services/addresses');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolAddress] = await listAddresses(browserContext(ids.carol));
    await expect(upsertAddress(browserContext(ids.alice), { ...NEW_ADDRESS, id: carolAddress.id }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to delete another customer\'s address', async () => {
    const { listAddresses, deleteAddress } = await import('@/lib/services/addresses');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolAddress] = await listAddresses(browserContext(ids.carol));
    await expect(deleteAddress(browserContext(ids.alice), carolAddress.id))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(await listAddresses(browserContext(ids.carol))).toHaveLength(1);
  });

  it('keeps exactly one default address', async () => {
    const { upsertAddress, listAddresses } = await import('@/lib/services/addresses');
    await upsertAddress(browserContext(ids.alice), { ...NEW_ADDRESS, isDefault: true });
    const all = await listAddresses(browserContext(ids.alice));
    expect(all.filter((a) => a.isDefault)).toHaveLength(1);
    expect(all.find((a) => a.isDefault)?.label).toBe('Work');
  });

  it('refuses to make another customer\'s address the default', async () => {
    const { listAddresses, setDefaultAddress } = await import('@/lib/services/addresses');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolAddress] = await listAddresses(browserContext(ids.carol));
    await expect(setDefaultAddress(browserContext(ids.alice), carolAddress.id))
      .rejects.toBeInstanceOf(NotFoundError);
    // Alice's own default must survive the failed attempt.
    expect((await listAddresses(browserContext(ids.alice))).filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('rejects an address missing required fields', async () => {
    const { upsertAddress } = await import('@/lib/services/addresses');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(upsertAddress(browserContext(ids.alice), { ...NEW_ADDRESS, city: '' }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('payment method service', () => {
  const CARD = {
    brand: 'visa' as const, last4: '1881', expMonth: 9,
    expYear: 2031, holderName: 'Alice Chen',
  };

  it('lists only the requesting customer\'s cards', async () => {
    const { listPaymentMethods } = await import('@/lib/services/paymentMethods');
    expect(await listPaymentMethods(browserContext(ids.alice))).toHaveLength(1);
  });

  it('adds a card', async () => {
    const { addPaymentMethod, listPaymentMethods } =
      await import('@/lib/services/paymentMethods');
    await addPaymentMethod(browserContext(ids.alice), CARD);
    expect(await listPaymentMethods(browserContext(ids.alice))).toHaveLength(2);
  });

  // SECURITY: the schema has nowhere to put a full number, and the service
  // refuses anything that is not exactly four digits.
  it('rejects anything longer than four digits', async () => {
    const { addPaymentMethod } = await import('@/lib/services/paymentMethods');
    const { ValidationError } = await import('@/lib/services/errors');
    await expect(addPaymentMethod(browserContext(ids.alice), { ...CARD, last4: '4242424242424242' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(addPaymentMethod(browserContext(ids.alice), { ...CARD, last4: 'abcd' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to delete another customer\'s card', async () => {
    const { listPaymentMethods, deletePaymentMethod } =
      await import('@/lib/services/paymentMethods');
    const { NotFoundError } = await import('@/lib/services/errors');
    const [carolCard] = await listPaymentMethods(browserContext(ids.carol));
    await expect(deletePaymentMethod(browserContext(ids.alice), carolCard.id))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(await listPaymentMethods(browserContext(ids.carol))).toHaveLength(1);
  });

  it('keeps exactly one default card', async () => {
    const { addPaymentMethod, listPaymentMethods } =
      await import('@/lib/services/paymentMethods');
    await addPaymentMethod(browserContext(ids.alice), { ...CARD, isDefault: true });
    const all = await listPaymentMethods(browserContext(ids.alice));
    expect(all.filter((c) => c.isDefault)).toHaveLength(1);
  });
});
