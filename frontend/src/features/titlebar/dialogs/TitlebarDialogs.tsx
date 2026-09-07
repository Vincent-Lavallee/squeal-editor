import AboutDialog from './AboutDialog.tsx';
import EnvironmentsDialog from './environments/EnvironmentsDialog.tsx';
import ExportConnectionsDialog from './connections-transfer/ExportConnectionsDialog.tsx';
import ImportConnectionsDialog from './connections-transfer/ImportConnectionsDialog.tsx';
import SettingsDialog from './settings/SettingsDialog.tsx';
import ShortcutsDialog from './shortcuts/ShortcutsDialog.tsx';

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
        settings: boolean;
    };
    onClose: {
        about: () => void;
        environments: () => void;
        export: () => void;
        import: () => void;
        shortcuts: () => void;
        settings: () => void;
    };
}) {
    return (
        <>
            {showing.about && <AboutDialog version={version} onClose={onClose.about} />}
            {showing.environments && <EnvironmentsDialog onClose={onClose.environments} />}
            {showing.export && <ExportConnectionsDialog onClose={onClose.export} />}
            {showing.import && <ImportConnectionsDialog onClose={onClose.import} />}
            {showing.shortcuts && <ShortcutsDialog onClose={onClose.shortcuts} />}
            {showing.settings && <SettingsDialog onClose={onClose.settings} />}
        </>
    );
}
