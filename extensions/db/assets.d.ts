/**
 * A committed `.pem` imported for its text, the way `rds-global-bundle.pem` is.
 * Bun's `with { type: 'text' }` loader hands back the file's contents as a
 * string and folds it into the compiled binary; this declares that shape so the
 * typecheck agrees. Same class of ambient declaration as `neutralino.d.ts`.
 */
declare module '*.pem' {
  const content: string;
  export default content;
}
