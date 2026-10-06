export { parseRelaySettings, parseRelayImport } from '../shared/turn-settings.js';

export function candidateCounts(sdp = ''): { host: number; srflx: number; relay: number } {
    const counts = { host: 0, srflx: 0, relay: 0 };
    for (const line of sdp.split(/\r?\n/)) {
        const type = /^a=candidate:.*\styp (host|srflx|relay)(?:\s|$)/.exec(line)?.[1] as keyof typeof counts | undefined;
        if (type) counts[type]++;
    }
    return counts;
}

/** Inspect the selected pair, not just whether a TURN server was configured. */
export function selectedRoute(stats: RTCStatsReport): 'direct' | 'relay' | undefined {
    let pair: any;
    stats.forEach(stat => {
        if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = stats.get(stat.selectedCandidatePairId);
    });
    if (!pair) stats.forEach(stat => {
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) pair = stat;
    });
    if (!pair) return;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    if (!local || !remote) return;
    return local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct';
}
