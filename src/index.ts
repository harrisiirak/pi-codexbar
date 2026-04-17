export function main(): string {
  return 'pi-codexbar scaffold initialized';
}

export type {
  ProviderId,
  ProviderDescriptor,
  ProviderState,
  ProviderStateAdapter,
} from './core/provider-state-contract.ts';

export { createProviderStateAdapter } from './core/provider-state-adapter.ts';

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(main());
}
