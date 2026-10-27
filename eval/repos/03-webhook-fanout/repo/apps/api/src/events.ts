import type { DomainEvent } from '@acme/shared';

/**
 * Called whenever something happens in the product (task created, comment added, ...).
 * Today it does nothing; customers will soon be able to receive these as webhooks.
 */
export async function emitEvent(event: DomainEvent): Promise<void> {
  void event;
}
