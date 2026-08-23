import { useEffect, useRef } from 'react';

import type { SavedConnection, TestPassword } from '../../../../../shared/protocol/index.ts';
import { useAwsSignIn } from '../../../store/awsSignInSlice.ts';
import { useConnectionTest } from '../../../store/connectionTestSlice.ts';
import type { FormState } from '../connectionFormTypes.ts';

/**
 * The connection test and the AWS sign-in it may need, plus the actions row's
 * scroll-into-view -- everything in `useConnectionForm` that is about
 * *verifying* the form rather than about the fields themselves.
 */
export function useConnectionFormTest(args: {
    form: FormState;
    mode: 'new' | 'edit';
    initial: SavedConnection | undefined;
    iam: boolean;
    fileBased: boolean;
    busy: boolean;
    connectInFlight: boolean;
}) {
    const { form, mode, initial, iam, fileBased, busy, connectInFlight } = args;
    const actions = useRef<HTMLDivElement>(null);
    const { testing, serverVersion, error: testError, test, clear } = useConnectionTest();
    const signIn = useAwsSignIn();

    // A result describes the values as they were when it ran, so any edit
    // withdraws it -- leaving "Connected to PostgreSQL 16.2" under a host that has
    // since been retyped would be the app vouching for something it never reached.
    // Keyed on the whole form rather than on a handler, so a field added later
    // cannot forget to do it; testing changes no field, so the answer survives the
    // render that lands it.
    useEffect(() => {
        clear();
    }, [form, clear]);

    // The sign-in answer is about the profile and nothing else, so it survives
    // every edit that is not one -- unlike a test, which describes the whole form.
    useEffect(() => {
        signIn.clear();
    }, [form.awsProfile, signIn.clear]);

    /*
     * Bring the actions row into view when an attempt starts, because that row is
     * now the only way to stop it. Pressing *Connect* leaves it under the cursor
     * already -- `block: 'nearest'` is a no-op then -- but submitting with Enter
     * from a field near the top of a form this tall does not, and the abort would
     * be below the fold at the exact moment it is the one control that matters.
     */
    useEffect(() => {
        if (connectInFlight) actions.current?.scrollIntoView({ block: 'nearest' });
    }, [connectInFlight]);

    /**
     * An edit form is never sent the password it is editing, so testing one whose
     * box is still untouched has to reach for the stored secret by name -- the
     * same case `PasswordUpdate.keep` exists for on the way out. Switching the
     * edit to IAM or to a file leaves nothing to decrypt, which is why the mode
     * is read off the form rather than off the row it started as.
     */
    const testPassword: TestPassword =
        mode === 'edit' &&
        !iam &&
        !fileBased &&
        (initial?.hasPassword ?? false) &&
        !form.passwordTouched
            ? { mode: 'stored', savedConnectionId: initial!.id }
            : { mode: 'typed', password: iam || fileBased ? '' : form.password };

    // A test writes no record, so it asks for none of what saving one needs: the
    // name is not part of reaching a server, and refusing to test until one is
    // typed would put the form's own bookkeeping in front of the question.
    const testable = !busy && !testing && (!fileBased || form.database.trim() !== '');

    return { actions, testing, serverVersion, testError, test, testPassword, testable };
}
