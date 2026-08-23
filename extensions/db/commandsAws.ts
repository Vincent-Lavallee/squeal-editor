import { AWS_SSO_PROMPT_EVENT } from '../../shared/protocol/index.ts';
import { credentialStatus, ssoLogin } from './iam.ts';
import type { Handlers, Send } from './commandTypes.ts';

export function commandsAws(send: Send): Pick<Handlers, 'aws.credentialStatus' | 'aws.ssoLogin'> {
    return {
        async 'aws.credentialStatus'({ profile }) {
            return credentialStatus(profile);
        },

        async 'aws.ssoLogin'({ profile }) {
            // Broadcast rather than returned: the URL and the code are what the user has
            // to act on, and they arrive while this is still waiting for them to.
            await ssoLogin(profile, (prompt) => send(AWS_SSO_PROMPT_EVENT, prompt));
            return { ok: true };
        },
    };
}
