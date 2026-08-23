import ContextMenu, { type MenuItem } from '../../common/components/ContextMenu.tsx';

const editorBox: React.CSSProperties = {
    minHeight: 0,
    overflow: 'hidden',
};

/**
 * Monaco's mount point and the right-click menu drawn over it.
 *
 * Split out of `EditorPane` purely for length -- the host div and its menu
 * are the one piece of that render with no sibling-component boundary of its
 * own to lean on.
 */
export default function EditorSurface({
    hostRef,
    menu,
    onOpenMenu,
    onCloseMenu,
    menuItems,
}: {
    hostRef: React.RefObject<HTMLDivElement>;
    menu: { x: number; y: number } | null;
    onOpenMenu: (menu: { x: number; y: number }) => void;
    onCloseMenu: () => void;
    menuItems: () => MenuItem[];
}) {
    return (
        <>
            {/* `preventDefault` is what stops the webview's own menu, exactly as the
          tree, the grid and the tab strip already do. */}
            <div
                className="editor"
                style={editorBox}
                ref={hostRef}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenMenu({ x: e.clientX, y: e.clientY });
                }}
            />

            {menu && (
                <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={onCloseMenu} />
            )}
        </>
    );
}
