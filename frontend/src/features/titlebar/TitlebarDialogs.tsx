import AboutDialog from './AboutDialog.tsx';
import EnvironmentsDialog from './EnvironmentsDialog.tsx';
import ExportConnectionsDialog from './ExportConnectionsDialog.tsx';
import ImportConnectionsDialog from './ImportConnectionsDialog.tsx';
import ShortcutsDialog from './ShortcutsDialog.tsx';

export default function TitlebarDialogs({
    version,
    showing,
    onClose,
}: {
    version: string;
    showing: {
        about: boolean;
        environments: boolean;
        export: boolean;
        import: boolean;
        shortcuts: boolean;
    };
    onClose: {
        about: () => void;
        environments: () => void;
        export: () => void;
        import: () => void;
        shortcuts: () => void;
    };
}) {
    return (
        <>
            {showing.about && <AboutDialog version={version} onClose={onClose.about} />}
            {showing.environments && <EnvironmentsDialog onClose={onClose.environments} />}
            {showing.export && <ExportConnectionsDialog onClose={onClose.export} />}
            {showing.import && <ImportConnectionsDialog onClose={onClose.import} />}
            {showing.shortcuts && <ShortcutsDialog onClose={onClose.shortcuts} />}
        </>
    );
}
