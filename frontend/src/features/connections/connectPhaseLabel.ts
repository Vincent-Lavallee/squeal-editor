export function connectPhaseLabel(phase: string | null): string {
    switch (phase) {
        case 'iam-token':
            return 'Authenticating with AWS…';
        case 'connecting':
            return 'Opening connection…';
        case 'verifying':
            return 'Verifying…';
        default:
            return 'Connecting…';
    }
}
