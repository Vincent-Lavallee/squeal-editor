import * as t from '../../../common/tokens';

export default function AiConnectIntro() {
    return (
        <>
            <p>
                Bring your own API key. It is kept in this machine&rsquo;s keychain, and the
                requests go straight from this app to the provider — nothing passes through anyone
                else.
            </p>

            {/* Said before they go looking, not after they come back empty-handed: the
          two are sold under the same brand and only one of them has an API key
          behind it, which is the single most likely way this screen wastes
          somebody's afternoon. */}
            <p style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
                This needs a <em>developer API key</em>, billed per token. A ChatGPT Plus or Claude
                Pro subscription is a different product and does not include one.
            </p>
        </>
    );
}
