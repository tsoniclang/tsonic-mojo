import type { MojoValueConversion } from "./model.js";

export function mojoConversionRaises(conversion: MojoValueConversion): boolean {
  switch (conversion.kind) {
    case "provider-record": return conversion.fields.some((field) => mojoConversionRaises(field.conversion));
    case "js-value-extract":
    case "js-to-native-string":
    case "native-error-result-unwrap": return true;
    case "js-data-rest": return mojoConversionRaises(conversion.elementConversion);
    case "collection-map":
      return conversion.source === "js-array" && conversion.elementConversion !== undefined ||
        (conversion.elementConversion !== undefined && mojoConversionRaises(conversion.elementConversion));
    case "optional-some":
    case "optional-map":
    case "optional-present":
    case "optional-to-union":
    case "union-inject": return mojoConversionRaises(conversion.valueConversion);
    case "union-to-optional": return conversion.presentMembers.some((member) => mojoConversionRaises(member.conversion));
    case "union-map":
    case "narrowed-union-map": return conversion.members.some((member) => mojoConversionRaises(member.conversion));
    default: return false;
  }
}
