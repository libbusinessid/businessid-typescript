import { KNOWN_IDENTIFIER_KINDS } from "../assets/kinds.generated.js";

/** A kind token known to the bundle this package ships. */
export type KnownIdentifierKind = (typeof KNOWN_IDENTIFIER_KINDS)[number];

/**
 * The kind of identifier being validated.
 *
 * Deliberately not a closed union: a caller may pass a token this build has
 * never heard of, and the engine reports `unsupported_kind` for it rather than
 * failing to compile. The known kinds are offered for completion only.
 */
export type IdentifierKind = KnownIdentifierKind | (string & {});

export { KNOWN_IDENTIFIER_KINDS };
