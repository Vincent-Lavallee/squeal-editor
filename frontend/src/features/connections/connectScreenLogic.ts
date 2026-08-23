import type { PasswordUpdate } from '../../../../shared/protocol/index.ts';
import type { FormValues } from './ConnectionForm.tsx';
import type { Screen } from './connectScreenTypes.ts';

export function passwordUpdate(values: FormValues, mode: 'new' | 'edit'): PasswordUpdate {
    if (!values.savePassword) return { mode: 'none' };
    if (mode === 'edit' && !values.passwordTouched) return { mode: 'keep' };
    return { mode: 'store', password: values.password };
}

/**
 * What the card says under its title. It names the screen you are on rather than
 * the app you already opened, so the one line of prose on the page is worth
 * reading more than once.
 */
export function screenSubtitle(screen: Screen): string {
    switch (screen.view) {
        case 'workspaces':
            return 'Choose a workspace.';
        case 'workspaceNew':
            return 'Name a new workspace.';
        case 'workspaceEdit':
            return 'Rename this workspace, or give it another mark.';
        case 'list':
            return 'Pick a connection, or add one.';
        case 'new':
            return 'Describe the server you want to reach.';
        case 'edit':
            return 'Change what this connection points at.';
        case 'password':
            return 'This connection did not save its password.';
    }
}
