import Button from '../../common/components/Button.tsx';
import Modal from '../../common/components/Modal.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';

interface Props {
    version: string;
    onClose: () => void;
}

export default function AboutDialog({ version, onClose }: Props) {
    return (
        <Modal onClose={onClose}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                    Squeal Editor
                </h2>
                <p
                    data-testid="about-version"
                    style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}
                >
                    Version <Mono>{version}</Mono>
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: t.GAP_XS }}>
                    <Button onClick={onClose} autoFocus>
                        Close
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
