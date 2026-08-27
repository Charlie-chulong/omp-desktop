export function daemonPairingOfferQueryKey(serverId: string) {
  return ["daemonPairingOffer", serverId] as const;
}
