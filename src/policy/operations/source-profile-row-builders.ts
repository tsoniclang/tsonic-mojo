import type {
  MojoSourceProfileCallRow,
  MojoSourceProfileCallbackContract,
  MojoSourceProfileCallbackVariant,
  MojoSourceProfileParameterContract,
  MojoSourceProfileResultContract,
} from "./source-profile-selection.js";

export const jsInstanceRows = (
  owner: string,
  receiver: "imm" | "mut",
  methods: readonly (string | readonly [string, string, boolean?])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name, raises] = typeof method === "string"
    ? [method, snakeCase(method), false] as const
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "instance" as const, name, receiver }),
    ...(raises === true ? { raises: true } : {}),
  });
});

export const jsInstanceParameterRow = (
  owner: string,
  member: string,
  receiver: "imm" | "mut",
  parameterContract: readonly MojoSourceProfileParameterContract[],
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  parameterContract: Object.freeze([...parameterContract]),
  parameterContractMode: "overrides",
  target: Object.freeze({ kind: "instance", name: snakeCase(member), receiver }),
});

export const receiverType = Object.freeze({ kind: "receiver" as const });
export const receiverArgument = (index: number): MojoSourceProfileParameterContract =>
  Object.freeze({ kind: "receiver-argument", index });

export const jsStaticRows = (
  owner: string,
  methods: readonly (string | readonly [string, string, boolean?])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name, raises] = typeof method === "string"
    ? [method, `${snakeCase(owner.replace(/Constructor$/u, ""))}_${snakeCase(method)}`, false] as const
    : method;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({ kind: "function" as const, modulePath: Object.freeze(["tsonic_js"]), name }),
    ...(raises === true ? { raises: true } : {}),
  });
});

export const jsReceiverFunctionRow = (
  owner: string,
  member: string,
  name: string,
  argumentCount: number,
  parameterContract: readonly MojoSourceProfileParameterContract[],
  raises = false,
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  argumentCount,
  parameterContract: Object.freeze([...parameterContract]),
  target: Object.freeze({
    kind: "function",
    modulePath: Object.freeze(["tsonic_js"]),
    name,
    receiver: "imm",
  }),
  ...(raises ? { raises: true } : {}),
});

export const jsReceiverFunctionRows = (
  owner: string,
  prefix: string,
  methods: readonly (string | readonly [string, string, boolean?])[],
): readonly MojoSourceProfileCallRow[] => methods.map((method) => {
  const [member, name, raises] = typeof method === "string"
    ? [method, `${prefix}_${snakeCase(method)}`, false] as const
    : [method[0], `${prefix}_${method[1]}`, method[2] ?? false] as const;
  return Object.freeze({
    profile: "js" as const,
    kind: "call" as const,
    owner,
    member,
    target: Object.freeze({
      kind: "function" as const,
      modulePath: Object.freeze(["tsonic_js"]),
      name,
      receiver: "imm" as const,
    }),
    ...(raises ? { raises: true } : {}),
  });
});

export const jsReceiverArrayRow = (
  owner: string,
  member: string,
  element: Extract<MojoSourceProfileResultContract, { readonly kind: "receiver-array" }>["element"],
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  target: Object.freeze({ kind: "instance", name: snakeCase(member), receiver: "imm" }),
  resultContract: Object.freeze({ kind: "receiver-array", element }),
});

export const jsConstructorRows: readonly MojoSourceProfileCallRow[] = Object.freeze([
  Object.freeze({
    profile: "js",
    kind: "construct",
    owner: "ArrayConstructor",
    member: "constructor",
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "array_new" }),
    resultContract: Object.freeze({ kind: "constructed-explicit-arguments" }),
  }),
  ...["MapConstructor", "SetConstructor"].map((owner): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "construct",
    owner,
    member: "constructor",
    argumentCount: 0,
    parameterContract: Object.freeze([]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: `${snakeCase(owner.replace(/Constructor$/u, ""))}_new`,
    }),
    resultContract: Object.freeze({ kind: "constructed-explicit-arguments" }),
  })),
  Object.freeze({
    profile: "js",
    kind: "construct",
    owner: "SetConstructor",
    member: "constructor",
    argumentCount: 1,
    parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["selected-argument"]),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: "set_new",
    }),
    resultContract: Object.freeze({
      kind: "constructed-explicit-arguments",
      indexes: Object.freeze([0]),
    }),
  }),
  ...[0, 1].map((argumentCount): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind: "construct",
    owner: "DateConstructor",
    member: "constructor",
    argumentCount,
    target: Object.freeze({ kind: "function", modulePath: Object.freeze(["tsonic_js"]), name: "date_new" }),
  })),
]);

export const sourceErrorRows: readonly MojoSourceProfileCallRow[] = Object.freeze(
  (["native", "js"] as const).flatMap((profile) =>
    (["call", "construct"] as const).flatMap((kind) =>
      [0, 1].map((argumentCount): MojoSourceProfileCallRow => Object.freeze({
        profile,
        kind,
        owner: "ErrorConstructor",
        member: kind === "construct" ? "constructor" : "call",
        argumentCount,
        parameterContract: Object.freeze<MojoSourceProfileParameterContract[]>(["native-string"]),
        target: Object.freeze({
          kind: "function",
          modulePath: Object.freeze(["tsonic_runtime"]),
          name: "error_new",
        }),
      }))),
  ),
);

const arrayCallbackVariants = (
  names: readonly string[],
): readonly MojoSourceProfileCallbackVariant[] => Object.freeze(names.map((targetName, arity) =>
  Object.freeze({ arity, targetName })));

export const jsCallbackRow = (
  owner: string,
  member: string,
  receiver: "imm" | "mut",
  result: MojoSourceProfileCallbackContract["result"],
  names: readonly string[],
  argumentCount?: number,
  errorMode: MojoSourceProfileCallbackContract["errorMode"] = "propagate",
): MojoSourceProfileCallRow => Object.freeze({
  profile: "js",
  kind: "call",
  owner,
  member,
  ...(argumentCount === undefined ? {} : { argumentCount }),
  target: Object.freeze({
    kind: "function",
    modulePath: Object.freeze(["tsonic_js"]),
    name: names[names.length - 1]!,
    receiver,
  }),
  ...(errorMode === "native" ? { raises: true } : {}),
  callback: Object.freeze({
    parameterIndex: 0,
    result,
    errorMode,
    variants: arrayCallbackVariants(names),
  }),
});

export function snakeCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter, index) => `${index === 0 ? "" : "_"}${letter.toLowerCase()}`);
}
