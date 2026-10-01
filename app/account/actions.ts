'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth/session-cookie';
import { browserContext, type ActorContext } from '@/lib/oauth/types';
import { ServiceError } from '@/lib/services/errors';
import { updateProfile } from '@/lib/services/profile';
import {
  deleteAddress, setDefaultAddress, upsertAddress,
} from '@/lib/services/addresses';
import {
  addPaymentMethod, deletePaymentMethod, setDefaultPaymentMethod,
} from '@/lib/services/paymentMethods';

export type AccountState = { error?: string; saved?: boolean };

/**
 * Every action here follows the same three steps: resolve the session, call the
 * service with the customer's own id, translate a ServiceError into a message.
 *
 * None of them validate. Validation lives in the services, so the rules are the
 * same for these forms and for every future caller of the same functions.
 */
async function run(
  work: (ctx: ActorContext) => Promise<unknown>,
  paths: string[],
): Promise<AccountState> {
  const customer = await requireCustomer();

  try {
    await work(browserContext(customer.id));
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }

  for (const path of paths) revalidatePath(path);
  return { saved: true };
}

const asNumber = (value: FormDataEntryValue | null) => Number(value);
const asString = (value: FormDataEntryValue | null) => String(value ?? '');

export async function updateProfileAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => updateProfile(ctx, { name: asString(formData.get('name')) }),
    ['/account'],
  );
}

export async function saveAddressAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const rawId = formData.get('id');

  return run(
    (ctx) => upsertAddress(ctx, {
      id: rawId ? Number(rawId) : undefined,
      label: asString(formData.get('label')),
      recipient: asString(formData.get('recipient')),
      line1: asString(formData.get('line1')),
      line2: asString(formData.get('line2')) || null,
      city: asString(formData.get('city')),
      region: asString(formData.get('region')),
      postalCode: asString(formData.get('postalCode')),
      country: asString(formData.get('country')) || 'US',
      phone: asString(formData.get('phone')) || null,
      isDefault: formData.get('isDefault') === 'on',
    }),
    ['/account/addresses', '/checkout'],
  );
}

export async function deleteAddressAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => deleteAddress(ctx, asNumber(formData.get('id'))),
    ['/account/addresses', '/checkout'],
  );
}

export async function setDefaultAddressAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => setDefaultAddress(ctx, asNumber(formData.get('id'))),
    ['/account/addresses', '/checkout'],
  );
}

export async function addPaymentMethodAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => addPaymentMethod(ctx, {
      brand: asString(formData.get('brand')) as 'visa' | 'mastercard' | 'amex',
      last4: asString(formData.get('last4')),
      expMonth: asNumber(formData.get('expMonth')),
      expYear: asNumber(formData.get('expYear')),
      holderName: asString(formData.get('holderName')),
      isDefault: formData.get('isDefault') === 'on',
    }),
    ['/account/payment-methods', '/checkout'],
  );
}

export async function deletePaymentMethodAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => deletePaymentMethod(ctx, asNumber(formData.get('id'))),
    ['/account/payment-methods', '/checkout'],
  );
}

export async function setDefaultPaymentMethodAction(
  _previous: AccountState,
  formData: FormData,
): Promise<AccountState> {
  return run(
    (ctx) => setDefaultPaymentMethod(ctx, asNumber(formData.get('id'))),
    ['/account/payment-methods', '/checkout'],
  );
}
