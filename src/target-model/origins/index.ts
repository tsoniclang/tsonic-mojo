export type { MojoOriginRef, MojoOriginToken } from "./model.js";
export { mojoOriginEquals, mojoOriginKey } from "./identity.js";
export {
  parseMojoProviderOrigin,
  parseMojoProviderReferenceOrigin,
} from "./parser.js";
export type { MojoParsedProviderOrigin } from "./parser.js";
export { substituteMojoOrigin } from "./substitution.js";
