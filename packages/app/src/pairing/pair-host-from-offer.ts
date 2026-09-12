import type { ConnectionOffer } from "@omp-desktop/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";
import {
  applyConfiguredRelayToOffer,
  formatRelayServerAddress,
  normalizeHostPort,
  shouldUseTlsForDefaultHostedRelay,
} from "@/utils/daemon-endpoints";
import { connectToDaemon } from "@/utils/test-daemon-connection";

export interface PairHostRelayContext {
  relay: string;
  advertisedRelay: string;
}

export class PairHostError extends Error {
  constructor(
    message: string,
    public readonly relayContext: PairHostRelayContext,
  ) {
    super(message);
    this.name = "PairHostError";
  }
}

function formatOfferRelayAddress(relay: ConnectionOffer["relay"]): string {
  return formatRelayServerAddress({
    endpoint: normalizeHostPort(relay.endpoint),
    useTls: relay.useTls ?? shouldUseTlsForDefaultHostedRelay(relay.endpoint),
  });
}

export async function pairHostFromOffer(input: {
  offer: ConnectionOffer;
  configuredRelayAddress: string;
  upsertConnectionFromOffer: (offer: ConnectionOffer, label?: string) => Promise<HostProfile>;
}): Promise<HostProfile> {
  const effectiveOffer = applyConfiguredRelayToOffer(input.offer, input.configuredRelayAddress);
  const relayContext = {
    relay: formatOfferRelayAddress(effectiveOffer.relay),
    advertisedRelay: formatOfferRelayAddress(input.offer.relay),
  };

  try {
    const { client, hostname, serverId } = await connectToDaemon(
      {
        id: "probe",
        type: "relay",
        relayEndpoint: normalizeHostPort(effectiveOffer.relay.endpoint),
        useTls: effectiveOffer.relay.useTls,
        daemonPublicKeyB64: effectiveOffer.daemonPublicKeyB64,
      },
      { serverId: effectiveOffer.serverId },
    );
    await client.close().catch(() => undefined);
    if (serverId !== effectiveOffer.serverId) {
      throw new Error("The daemon identity did not match the pairing offer");
    }
    return await input.upsertConnectionFromOffer(effectiveOffer, hostname ?? undefined);
  } catch (error) {
    throw new PairHostError(error instanceof Error ? error.message : String(error), relayContext);
  }
}
