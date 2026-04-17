export type ProviderId = string;

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  enabled: boolean;
}

export interface ProviderState {
  providers: ProviderDescriptor[];
  selectedProviderId: ProviderId;
  fetchedAtEpochMs: number;
}

export interface ProviderStateAdapter {
  getProviderState(): Promise<ProviderState>;
  setProvider(providerId: ProviderId): Promise<void>;
}
