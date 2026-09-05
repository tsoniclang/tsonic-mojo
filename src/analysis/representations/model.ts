import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoTargetGenericArgument } from "../../target-model/types/model.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";

declare const mojoPhysicalTypeIdBrand: unique symbol;

export type MojoPhysicalTypeId = string & {
  readonly [mojoPhysicalTypeIdBrand]: "MojoPhysicalTypeId";
};

export interface MojoPhysicalCarrier {
  readonly id: MojoPhysicalTypeId;
  readonly key: string;
  readonly type: MojoTargetTypeRef;
  readonly alias?: string;
}

export type MojoTypeAliasSelection =
  | {
      readonly kind: "authored";
      readonly declaration: Node;
      readonly name: string;
      readonly modulePath: readonly string[];
      readonly genericArguments: readonly MojoTargetGenericArgument[];
      readonly aliasedTypeKey: string;
    }
  | {
      readonly kind: "generated";
      readonly name: string;
      readonly genericArguments: readonly [];
      readonly aliasedTypeKey: string;
    };

export interface MojoNarrowingAlternative {
  readonly carrier: MojoPhysicalTypeId;
  readonly type: MojoTargetTypeRef;
}

export type MojoNarrowingView =
  | {
      readonly kind: "optional-present";
      readonly carrier: MojoPhysicalTypeId;
      readonly value: MojoNarrowingAlternative;
    }
  | {
      readonly kind: "union-member";
      readonly carrier: MojoPhysicalTypeId;
      readonly member: MojoNarrowingAlternative;
    }
  | {
      readonly kind: "union-subset";
      readonly carrier: MojoPhysicalTypeId;
      readonly allowedAlternatives: readonly MojoNarrowingAlternative[];
    }
  | {
      readonly kind: "project-downcast";
      readonly carrier: MojoPhysicalTypeId;
      readonly dispatchType: MojoTargetTypeRef;
      readonly target: MojoNarrowingAlternative;
    };

export interface MojoRepresentationCatalog {
  carrier(id: MojoPhysicalTypeId): MojoPhysicalCarrier | undefined;
  carrierForType(type: MojoTargetTypeRef): MojoPhysicalTypeId;
  bindingCarrier(declaration: Node): MojoPhysicalTypeId | undefined;
  expressionCarrier(expression: Node): MojoPhysicalTypeId | undefined;
  narrowing(expression: Node): MojoNarrowingView | undefined;
  narrowingFor(refinement: MojoValueRefinementSelection): MojoNarrowingView;
  callable(referenceOrExpression: Node): MojoCallableDisposition | undefined;
  parameter(declaration: Node): MojoParameterDisposition | undefined;
  binding(referenceOrDeclaration: Node): MojoBindingDisposition | undefined;
  aliasForType(
    type: MojoTargetTypeRef,
    modulePath: readonly string[],
  ): MojoTypeAliasSelection | undefined;
  carriers(): readonly MojoPhysicalCarrier[];
}

export type MojoCallableDisposition =
  | {
      readonly kind: "direct";
      readonly expression: Node;
      readonly declaration?: Node;
    }
  | {
      readonly kind: "thin";
      readonly expression: Node;
      readonly declaration?: Node;
    }
  | {
      readonly kind: "native-closure";
      readonly expression: Node;
      readonly declaration?: Node;
    }
  | {
      readonly kind: "erased";
      readonly expression: Node;
      readonly declaration?: Node;
      readonly identityObserved: boolean;
    };

export type MojoBindingDisposition =
  | { readonly kind: "comptime" }
  | {
      readonly kind: "direct-function";
      readonly expression: Node;
      readonly callableKind: "direct" | "thin";
    }
  | { readonly kind: "immutable-runtime" }
  | { readonly kind: "live-cell" };

export type MojoParameterDisposition =
  | { readonly kind: "immutable"; readonly localCopy: boolean }
  | { readonly kind: "mutable-reference" }
  | { readonly kind: "parametric-reference" }
  | { readonly kind: "owned" }
  | { readonly kind: "out" };

export type MojoArgumentDisposition =
  | { readonly kind: "plain" }
  | { readonly kind: "copy" }
  | { readonly kind: "transfer" };
