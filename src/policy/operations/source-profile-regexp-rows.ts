import {
  jsRegExpSourceProfileIdentity,
  jsSourceSemanticsIdentity,
} from "@tsonic/js-source-profile";
import type {
  MojoSourceProfileArgumentCarrierContract,
  MojoSourceProfileCallRow,
  MojoSourceProfileCallbackVariant,
  MojoSourceProfileParameterContract,
} from "./source-profile-selection.js";

const identity = jsRegExpSourceProfileIdentity;
const owners = identity.owners;
const members = identity.regExpMembers;
const symbols = identity.wellKnownMemberKeys;
const stringMembers = identity.stringMembers;

const selectedOne = Object.freeze<MojoSourceProfileParameterContract[]>([
  "selected-argument",
]);
const selectedTwo = Object.freeze<MojoSourceProfileParameterContract[]>([
  "selected-argument",
  "selected-argument",
]);
const optionalNull = Object.freeze({
  kind: "optional-source-union" as const,
  absence: "null" as const,
});

const nativeStringOrRegExp = argumentCarrier(0, ["native-string", "regexp"]);
const exactStringOrRegExp = argumentCarrier(0, ["js-string", "regexp"]);
const nativeReplacement = argumentCarrier(1, ["native-string"]);
const exactReplacement = argumentCarrier(1, ["js-string"]);
const callbackReplacement = argumentCarrier(1, ["callable"]);

export const mojoRegExpSourceProfileCallRows: readonly MojoSourceProfileCallRow[] =
  Object.freeze([
    ...regexpConstructorRows("construct", "constructor", "regexp_construct"),
    ...regexpConstructorRows("call", "call", "regexp_call"),
    row(owners.regExpConstructor, identity.regExpConstructorMembers.escape, "regexp_escape", {
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    row(owners.regExp, members.exec, "exec_value", {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
      runtimeResultContract: optionalNull,
    }),
    row(owners.regExp, members.test, "test_value", {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    row(owners.regExp, members.toString, "to_string", { receiver: true }),
    row(owners.regExp, symbols.match, "match_value", {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
      runtimeResultContract: optionalNull,
    }),
    row(owners.regExp, symbols.matchAll, "match_all_value", {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    ...regexpReplaceRows(),
    row(owners.regExp, symbols.search, "search_value", {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    row(owners.regExp, symbols.split, "split_value", {
      receiver: true,
      argumentCount: 1,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    row(owners.regExp, symbols.split, "split_value", {
      receiver: true,
      argumentCount: 2,
      parameterContract: selectedTwo,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string", "js-string"]),
      ]),
    }),
    ...stringRegExpRows(owners.string, "string", nativeStringOrRegExp,
      nativeReplacement),
    ...stringRegExpRows(
      jsSourceSemanticsIdentity.typeExport,
      "js_string",
      exactStringOrRegExp,
      exactReplacement,
    ),
  ]);

function regexpConstructorRows(
  kind: "call" | "construct",
  member: string,
  targetName: string,
): readonly MojoSourceProfileCallRow[] {
  return [0, 1, 2].map((argumentCount): MojoSourceProfileCallRow => Object.freeze({
    profile: "js",
    kind,
    owner: owners.regExpConstructor,
    member,
    argumentCount,
    parameterContract: argumentCount === 0
      ? Object.freeze([])
      : argumentCount === 1
        ? selectedOne
        : selectedTwo,
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: targetName,
    }),
    raises: true,
  }));
}

function regexpReplaceRows(): readonly MojoSourceProfileCallRow[] {
  return [
    row(owners.regExp, symbols.replace, "replace_value", {
      receiver: true,
      parameterContract: selectedTwo,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["native-string"]),
        nativeReplacement,
      ]),
    }),
    row(owners.regExp, symbols.replace, "replace_value", {
      receiver: true,
      parameterContract: selectedTwo,
      argumentCarriers: Object.freeze([
        argumentCarrier(0, ["js-string"]),
        exactReplacement,
      ]),
    }),
    callbackRow(
      owners.regExp,
      symbols.replace,
      "regexp_replace_native_callback",
      argumentCarrier(0, ["native-string"]),
    ),
    callbackRow(
      owners.regExp,
      symbols.replace,
      "regexp_replace_exact_callback",
      argumentCarrier(0, ["js-string"]),
    ),
  ];
}

function stringRegExpRows(
  owner: string,
  prefix: string,
  patternCarrier: MojoSourceProfileArgumentCarrierContract,
  replacementCarrier: MojoSourceProfileArgumentCarrierContract,
): readonly MojoSourceProfileCallRow[] {
  const pattern = Object.freeze([patternCarrier]);
  return [
    row(owner, stringMembers.match, `${prefix}_match_pattern`, {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: pattern,
      runtimeResultContract: optionalNull,
    }),
    row(owner, stringMembers.matchAll, `${prefix}_match_all_pattern`, {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([argumentCarrier(0, ["regexp"])]),
    }),
    row(owner, stringMembers.replace, `${prefix}_replace_pattern`, {
      receiver: true,
      parameterContract: selectedTwo,
      argumentCarriers: Object.freeze([patternCarrier, replacementCarrier]),
    }),
    callbackRow(owner, stringMembers.replace, `${prefix}_replace_callback`, patternCarrier),
    row(owner, stringMembers.replaceAll, `${prefix}_replace_all_pattern`, {
      receiver: true,
      parameterContract: selectedTwo,
      argumentCarriers: Object.freeze([patternCarrier, replacementCarrier]),
    }),
    callbackRow(owner, stringMembers.replaceAll, `${prefix}_replace_all_callback`, patternCarrier),
    row(owner, stringMembers.search, `${prefix}_search_pattern`, {
      receiver: true,
      parameterContract: selectedOne,
      argumentCarriers: pattern,
    }),
    row(owner, stringMembers.split, `${prefix}_split_pattern`, {
      receiver: true,
      argumentCount: 1,
      parameterContract: selectedOne,
      argumentCarriers: pattern,
    }),
    row(owner, stringMembers.split, `${prefix}_split_pattern`, {
      receiver: true,
      argumentCount: 2,
      parameterContract: selectedTwo,
      argumentCarriers: pattern,
    }),
    row(owner, "normalize", `${prefix}_normalize`, {
      receiver: true,
      argumentCount: 0,
      parameterContract: Object.freeze([]),
    }),
    row(owner, "normalize", `${prefix}_normalize`, {
      receiver: true,
      argumentCount: 1,
      parameterContract: selectedOne,
      argumentCarriers: Object.freeze([argumentCarrier(0, ["native-string"])]),
    }),
  ];
}

function callbackRow(
  owner: string,
  member: string,
  prefix: string,
  firstArgument: MojoSourceProfileArgumentCarrierContract,
): MojoSourceProfileCallRow {
  return row(owner, member, `${prefix}_8`, {
    receiver: true,
    parameterContract: selectedTwo,
    argumentCarriers: Object.freeze([firstArgument, callbackReplacement]),
    callback: Object.freeze({
      parameterIndex: 1,
      result: "preserve",
      errorMode: "propagate",
      variants: callbackVariants(prefix),
    }),
    runtimeResultContract: Object.freeze({ kind: "native-error-result" }),
  });
}

function callbackVariants(prefix: string): readonly MojoSourceProfileCallbackVariant[] {
  return Object.freeze(Array.from({ length: 9 }, (_, arity) => Object.freeze({
    arity,
    targetName: `${prefix}_${arity}`,
  })));
}

function row(
  owner: string,
  member: string,
  targetName: string,
  options: {
    readonly receiver?: boolean;
    readonly argumentCount?: number;
    readonly parameterContract?: readonly MojoSourceProfileParameterContract[];
    readonly argumentCarriers?: readonly MojoSourceProfileArgumentCarrierContract[];
    readonly callback?: MojoSourceProfileCallRow["callback"];
    readonly runtimeResultContract?: MojoSourceProfileCallRow["runtimeResultContract"];
  } = {},
): MojoSourceProfileCallRow {
  return Object.freeze({
    profile: "js",
    kind: "call",
    owner,
    member,
    ...(options.argumentCount === undefined ? {} : { argumentCount: options.argumentCount }),
    ...(options.parameterContract === undefined
      ? {}
      : { parameterContract: options.parameterContract }),
    ...(options.argumentCarriers === undefined
      ? {}
      : { argumentCarriers: options.argumentCarriers }),
    target: Object.freeze({
      kind: "function",
      modulePath: Object.freeze(["tsonic_js"]),
      name: targetName,
      ...(options.receiver === true ? { receiver: "imm" as const } : {}),
    }),
    ...(options.runtimeResultContract?.kind === "native-error-result"
      ? {}
      : { raises: true }),
    ...(options.callback === undefined ? {} : { callback: options.callback }),
    ...(options.runtimeResultContract === undefined
      ? {}
      : { runtimeResultContract: options.runtimeResultContract }),
  });
}

function argumentCarrier(
  index: number,
  oneOf: MojoSourceProfileArgumentCarrierContract["oneOf"],
): MojoSourceProfileArgumentCarrierContract {
  return Object.freeze({ index, oneOf: Object.freeze([...oneOf]) });
}
